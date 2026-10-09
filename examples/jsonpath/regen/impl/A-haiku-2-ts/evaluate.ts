// JSONPath evaluation (RFC 9535 Sections 2.1.2, 2.3, 2.4, 2.5 and 2.7). A query
// has already been checked by query.ts, so evaluation only has to select.

import { isObject, Num } from './json.ts';
import { compileIRegexp } from './iregexp.ts';
import type { Expr, Query, Sel, Seg } from './query.ts';

// A comparison needed a number outside the exact range of I-JSON (Section 2.1):
// the query cannot be processed correctly, so the implementation reports it.
export class Overflow extends Error {}

const MAX_EXACT = 2 ** 53 - 1;
// The special result Nothing (Section 2.4.1), distinct from every JSON value, null included.
const NOTHING = Symbol('Nothing');

// A node: a value and its location (Section 1.1), as the member names and indexes from the root.
interface Node {
  v: any;
  p: (string | number)[];
}

export function evaluate(q: Query, document: any): { values: any[]; paths: string[] } {
  const root: Node = { v: document, p: [] };
  const nodes = runQuery(q, root, root);
  return { values: nodes.map((n) => n.v), paths: nodes.map((n) => normalizedPath(n.p)) };
}

// Applies the query to the start node (or the root, for an absolute query).
function runQuery(q: Query, cur: Node, root: Node): Node[] {
  let nodes = [q.abs ? root : cur];
  for (const seg of q.segs) nodes = applySegment(seg, nodes, root);
  return nodes;
}

function applySegment(seg: Seg, nodes: Node[], root: Node): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    for (const t of seg.desc ? descendants(n) : [n]) {
      for (const sel of seg.sels) select(sel, t, root, out);
    }
  }
  return out;
}

// The node and its descendants, in the visiting order of Section 2.5.2.2.
function descendants(n: Node): Node[] {
  const out: Node[] = [];
  const stack = [n];
  while (stack.length > 0) {
    const x = stack.pop()!;
    out.push(x);
    const kids = children(x);
    for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
  }
  return out;
}

// The children of a node: array elements, or object member values.
function children(n: Node): Node[] {
  const v = n.v;
  if (Array.isArray(v)) return v.map((x, k) => ({ v: x, p: [...n.p, k] }));
  if (isObject(v)) return Object.keys(v).map((k) => ({ v: v[k], p: [...n.p, k] }));
  return [];
}

function select(sel: Sel, n: Node, root: Node, out: Node[]): void {
  const v = n.v;
  if (sel.k === 'name') {
    if (isObject(v) && Object.hasOwn(v, sel.name)) out.push({ v: v[sel.name], p: [...n.p, sel.name] });
  } else if (sel.k === 'wild') {
    for (const c of children(n)) out.push(c);
  } else if (sel.k === 'index') {
    if (Array.isArray(v)) {
      const k = sel.i < 0 ? v.length + sel.i : sel.i;
      if (k >= 0 && k < v.length) out.push({ v: v[k], p: [...n.p, k] });
    }
  } else if (sel.k === 'slice') {
    if (Array.isArray(v)) {
      for (const k of sliceIndexes(sel, v.length)) out.push({ v: v[k], p: [...n.p, k] });
    }
  } else {
    for (const c of children(n)) if (logical(sel.expr, c, root)) out.push(c);
  }
}

// The indexes an array slice selects, in order (Section 2.3.4.2.2).
function sliceIndexes(sel: { s: number | null; e: number | null; st: number | null }, len: number): number[] {
  const step = sel.st ?? 1;
  const out: number[] = [];
  if (step === 0) return out;
  const norm = (i: number): number => (i >= 0 ? i : len + i);
  if (step > 0) {
    const lower = Math.min(Math.max(norm(sel.s ?? 0), 0), len);
    const upper = Math.min(Math.max(norm(sel.e ?? len), 0), len);
    for (let i = lower; i < upper; i += step) out.push(i);
  } else {
    const upper = Math.min(Math.max(norm(sel.s ?? len - 1), -1), len - 1);
    const lower = Math.min(Math.max(norm(sel.e ?? -len - 1), -1), len - 1);
    for (let i = upper; lower < i; i += step) out.push(i);
  }
  return out;
}

function logical(e: Expr, cur: Node, root: Node): boolean {
  switch (e.k) {
    case 'or':
      return e.items.some((x: Expr) => logical(x, cur, root));
    case 'and':
      return e.items.every((x: Expr) => logical(x, cur, root));
    case 'not':
      return !logical(e.e, cur, root);
    case 'cmp':
      return compare(e.op, value(e.l, cur, root), value(e.r, cur, root));
    case 'q':
      return runQuery(e.q, cur, root).length > 0;
    default:
      return callFunction(e, cur, root) as boolean;
  }
}

// The ValueType of an operand: a value, or NOTHING.
function value(e: Expr, cur: Node, root: Node): any {
  if (e.k === 'lit') return e.v;
  if (e.k === 'q') {
    const ns = runQuery(e.q, cur, root);
    return ns.length > 0 ? ns[0].v : NOTHING;
  }
  return callFunction(e, cur, root);
}

// Function extensions (Section 2.4). Arguments are already well-typed.
function callFunction(e: Expr, cur: Node, root: Node): any {
  const [a, b] = e.args;
  switch (e.name) {
    case 'length': {
      const v = value(a, cur, root);
      if (typeof v === 'string') return [...v].length;
      if (Array.isArray(v)) return v.length;
      if (isObject(v)) return Object.keys(v).length;
      return NOTHING;
    }
    case 'count':
      return runQuery(a.q, cur, root).length;
    case 'value': {
      const ns = runQuery(a.q, cur, root);
      return ns.length === 1 ? ns[0].v : NOTHING;
    }
    default: {
      // match() and search()
      const subject = value(a, cur, root);
      const pattern = value(b, cur, root);
      if (typeof subject !== 'string' || typeof pattern !== 'string') return false;
      const re = compileIRegexp(pattern, e.name === 'match');
      return re !== undefined && re.test(subject);
    }
  }
}

function kind(v: any): string {
  if (v === NOTHING) return 'nothing';
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'string') return 'str';
  if (typeof v === 'number' || v instanceof Num) return 'num';
  return Array.isArray(v) ? 'arr' : 'obj';
}

// The double value of a number; throws Overflow if it is outside the exact range.
function exact(v: any): number {
  const n = v instanceof Num ? v.n : v;
  if (!Number.isFinite(n) || (Number.isInteger(n) && Math.abs(n) > MAX_EXACT)) {
    throw new Overflow('a number outside the exact range is compared');
  }
  return n;
}

// Equality (Section 2.3.5.2.2).
function eq(a: any, b: any): boolean {
  const ka = kind(a);
  if (ka === 'nothing' || kind(b) === 'nothing') return a === b;
  if (ka !== kind(b)) return false;
  if (ka === 'num') return exact(a) === exact(b);
  if (ka === 'arr') return a.length === b.length && a.every((x: any, k: number) => eq(x, b[k]));
  if (ka === 'obj') {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && eq(a[k], b[k]));
  }
  return a === b;
}

// Less-than: numbers with numbers, strings with strings, anything else is false.
function lt(a: any, b: any): boolean {
  const ka = kind(a);
  if (ka !== kind(b)) return false;
  if (ka === 'num') return exact(a) < exact(b);
  if (ka === 'str') return compareCodePoints(a, b) < 0;
  return false;
}

// Strings order by Unicode scalar value (Section 2.3.5.2.2), not by UTF-16 unit.
function compareCodePoints(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let k = 0; k < Math.min(x.length, y.length); k++) {
    const d = x[k].codePointAt(0)! - y[k].codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

function compare(op: string, a: any, b: any): boolean {
  switch (op) {
    case '==':
      return eq(a, b);
    case '!=':
      return !eq(a, b);
    case '<':
      return lt(a, b);
    case '<=':
      return lt(a, b) || eq(a, b);
    case '>':
      return lt(b, a);
    default:
      return lt(b, a) || eq(a, b); // '>='
  }
}

const ESCAPES: Record<number, string> = { 8: '\\b', 9: '\\t', 10: '\\n', 12: '\\f', 13: '\\r' };

// The Normalized Path of a location (Section 2.7).
export function normalizedPath(p: (string | number)[]): string {
  return '$' + p.map((seg) => (typeof seg === 'number' ? `[${seg}]` : `['${escapeName(seg)}']`)).join('');
}

function escapeName(name: string): string {
  let out = '';
  for (const ch of name) {
    const cp = ch.codePointAt(0)!;
    if (ch === "'") out += "\\'";
    else if (ch === '\\') out += '\\\\';
    else if (cp < 0x20) out += ESCAPES[cp] ?? `\\u${cp.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return out;
}
