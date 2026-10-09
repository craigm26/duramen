// Query evaluation (RFC 9535 sections 2.1.2 to 2.7). A query yields a nodelist;
// each node keeps a link to its parent so normalized paths are built on demand.

import { compareNum, intNum, Num } from './json.ts';
import type { Json } from './json.ts';
import type { Expr, FnExpr, Query, Segment, Selector } from './query.ts';
import { compileIRegexp } from './iregexp.ts';

// The special result Nothing (RFC 9535 section 2.4.1): distinct from every JSON value.
export const NOTHING = Symbol('Nothing');
export type Value = Json | typeof NOTHING;

export interface Node {
  value: Json;
  parent: Node | null;
  key: string | number | null;
}

interface Ctx {
  root: Node;
  current: Node | null;
}

export interface Result {
  values: Json[];
  paths: string[];
}

export function evaluate(q: Query, document: Json): Result {
  const root: Node = { value: document, parent: null, key: null };
  const nodes = runQuery(q, { root, current: null });
  return { values: nodes.map((n) => n.value), paths: nodes.map((n) => normalizedPath(n)) };
}

function child(parent: Node, key: string | number, value: Json): Node {
  return { value, parent, key };
}

function children(n: Node): Node[] {
  const v = n.value;
  if (Array.isArray(v)) return v.map((x, i) => child(n, i, x));
  if (v instanceof Map) return Array.from(v, ([k, x]) => child(n, k, x));
  return [];
}

// The node and all its descendants, in the order the descendant segment visits them:
// a node before its descendants, array elements in order.
function descendants(n: Node): Node[] {
  const out: Node[] = [];
  const stack: Node[] = [n];
  while (stack.length > 0) {
    const x = stack.pop() as Node;
    out.push(x);
    const kids = children(x);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
}

function runQuery(q: Query, ctx: Ctx): Node[] {
  let list: Node[] = [q.root ? ctx.root : (ctx.current as Node)];
  for (const seg of q.segs) list = applySegment(seg, list, ctx);
  return list;
}

function applySegment(seg: Segment, list: Node[], ctx: Ctx): Node[] {
  const out: Node[] = [];
  for (const n of list) {
    const inputs = seg.desc ? descendants(n) : [n];
    for (const d of inputs) {
      for (const s of seg.sels) select(s, d, ctx, out);
    }
  }
  return out;
}

function select(s: Selector, n: Node, ctx: Ctx, out: Node[]): void {
  const v = n.value;
  switch (s.k) {
    case 'name':
      if (v instanceof Map && v.has(s.name)) out.push(child(n, s.name, v.get(s.name) as Json));
      return;
    case 'index':
      if (Array.isArray(v)) {
        const i = s.i < 0 ? v.length + s.i : s.i;
        if (i >= 0 && i < v.length) out.push(child(n, i, v[i]));
      }
      return;
    case 'wild':
      for (const c of children(n)) out.push(c);
      return;
    case 'slice':
      if (Array.isArray(v)) {
        for (const i of sliceIndices(s, v.length)) out.push(child(n, i, v[i]));
      }
      return;
    case 'filter':
      for (const c of children(n)) {
        if (evalLogical(s.e, { root: ctx.root, current: c })) out.push(c);
      }
      return;
  }
}

// Indices selected by start:end:step over an array of length len (RFC 9535 2.3.4.2.2).
function sliceIndices(
  s: { start: number | null; end: number | null; step: number | null },
  len: number,
): number[] {
  const step = s.step ?? 1;
  if (step === 0) return [];
  const norm = (i: number): number => (i >= 0 ? i : len + i);
  const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);
  const start = norm(s.start ?? (step >= 0 ? 0 : len - 1));
  const end = norm(s.end ?? (step >= 0 ? len : -len - 1));
  const out: number[] = [];
  if (step > 0) {
    const lower = clamp(start, 0, len);
    const upper = clamp(end, 0, len);
    for (let i = lower; i < upper; i += step) out.push(i);
  } else {
    const upper = clamp(start, -1, len - 1);
    const lower = clamp(end, -1, len - 1);
    for (let i = upper; lower < i; i += step) out.push(i);
  }
  return out;
}

export function evalLogical(e: Expr, ctx: Ctx): boolean {
  switch (e.k) {
    case 'query':
      return runQuery(e.q, ctx).length > 0;
    case 'paren':
      return evalLogical(e.e, ctx);
    case 'not':
      return !evalLogical(e.e, ctx);
    case 'and':
      return evalLogical(e.l, ctx) && evalLogical(e.r, ctx);
    case 'or':
      return evalLogical(e.l, ctx) || evalLogical(e.r, ctx);
    case 'cmp':
      return compare(e.op, evalValue(e.l, ctx), evalValue(e.r, ctx));
    case 'fn':
      return callFn(e, ctx) === true;
    default:
      throw new Error('not a logical expression');
  }
}

function evalValue(e: Expr, ctx: Ctx): Value {
  switch (e.k) {
    case 'lit':
      return e.v;
    case 'vq': {
      const ns = runQuery(e.q, ctx);
      return ns.length > 0 ? ns[0].value : NOTHING;
    }
    case 'fn':
      return callFn(e, ctx);
    default:
      throw new Error('not a value expression');
  }
}

function evalNodes(e: Expr, ctx: Ctx): Node[] {
  if (e.k !== 'query') throw new Error('not a nodelist expression');
  return runQuery(e.q, ctx);
}

function callFn(e: FnExpr, ctx: Ctx): Value {
  const a = e.args[0];
  switch (e.name) {
    case 'length': {
      const v = evalValue(a, ctx);
      if (typeof v === 'string') return intNum([...v].length);
      if (Array.isArray(v)) return intNum(v.length);
      if (v instanceof Map) return intNum(v.size);
      return NOTHING;
    }
    case 'count':
      return intNum(evalNodes(a, ctx).length);
    case 'value': {
      const ns = evalNodes(a, ctx);
      return ns.length === 1 ? ns[0].value : NOTHING;
    }
    case 'match':
    case 'search': {
      const s = evalValue(a, ctx);
      const pattern = evalValue(e.args[1], ctx);
      if (typeof s !== 'string' || typeof pattern !== 'string') return false;
      const rx = compileIRegexp(pattern);
      if (rx === null) return false;
      return e.name === 'match' ? rx.full(s) : rx.search(s);
    }
    default:
      throw new Error(`unknown function ${e.name}`);
  }
}

function compare(op: string, a: Value, b: Value): boolean {
  switch (op) {
    case '==':
      return eq(a, b);
    case '!=':
      return !eq(a, b);
    case '<':
      return lt(a, b);
    case '>':
      return lt(b, a);
    case '<=':
      return lt(a, b) || eq(a, b);
    case '>=':
      return lt(b, a) || eq(a, b);
    default:
      throw new Error(`unknown operator ${op}`);
  }
}

function eq(a: Value, b: Value): boolean {
  if (a === NOTHING || b === NOTHING) return a === b;
  return sameJson(a, b);
}

function sameJson(a: Json, b: Json): boolean {
  if (a instanceof Num) return b instanceof Num && compareNum(a, b) === 0;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  }
  if (a instanceof Map) {
    return (
      b instanceof Map &&
      a.size === b.size &&
      Array.from(a).every(([k, x]) => b.has(k) && sameJson(x, b.get(k) as Json))
    );
  }
  return a === b;
}

function lt(a: Value, b: Value): boolean {
  if (a instanceof Num && b instanceof Num) return compareNum(a, b) < 0;
  if (typeof a === 'string' && typeof b === 'string') return compareStrings(a, b) < 0;
  return false;
}

// Compares by Unicode scalar value, not by UTF-16 code unit.
function compareStrings(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const p = x[i].codePointAt(0) as number;
    const q = y[i].codePointAt(0) as number;
    if (p !== q) return p < q ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

// Normalized Path (RFC 9535 section 2.7): $['name'][index] with the fixed escaping.
export function normalizedPath(n: Node): string {
  const keys: (string | number)[] = [];
  for (let x: Node | null = n; x !== null && x.parent !== null; x = x.parent) {
    keys.push(x.key as string | number);
  }
  let out = '$';
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i];
    out += typeof k === 'number' ? `[${k}]` : `['${escapeName(k)}']`;
  }
  return out;
}

function escapeName(name: string): string {
  let out = '';
  for (const ch of name) {
    const cp = ch.codePointAt(0) as number;
    switch (cp) {
      case 0x08: out += '\\b'; break;
      case 0x09: out += '\\t'; break;
      case 0x0a: out += '\\n'; break;
      case 0x0c: out += '\\f'; break;
      case 0x0d: out += '\\r'; break;
      case 0x27: out += "\\'"; break;
      case 0x5c: out += '\\\\'; break;
      default:
        out += cp < 0x20 ? '\\u' + cp.toString(16).padStart(4, '0') : ch;
    }
  }
  return out;
}
