// Evaluation of a parsed JSONPath query against a JSON document.

import { iregexpMatch } from './iregexp.ts';
import type { Call, Logical, Operand, Query, Selector } from './parse.ts';

export interface Node {
  v: unknown;
  p: string;
}

const NOTHING = Symbol('nothing');
type Val = unknown | typeof NOTHING;

interface Ctx {
  root: Node;
  cur: Node;
}

function cmpCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(j)!;
    if (x !== y) return x < y ? -1 : 1;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  if (i < a.length) return 1;
  if (j < b.length) return -1;
  return 0;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function sortedKeys(o: Record<string, unknown>): string[] {
  return Object.keys(o).sort(cmpCodePoints);
}

function escName(name: string): string {
  let out = '';
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    if (ch === "'") out += "\\'";
    else if (ch === '\\') out += '\\\\';
    else if (c === 8) out += '\\b';
    else if (c === 9) out += '\\t';
    else if (c === 10) out += '\\n';
    else if (c === 12) out += '\\f';
    else if (c === 13) out += '\\r';
    else if (c < 0x20) out += '\\u00' + c.toString(16).padStart(2, '0');
    else out += ch;
  }
  return out;
}

const memberPath = (p: string, name: string) => p + "['" + escName(name) + "']";
const elemPath = (p: string, i: number) => p + '[' + i + ']';

// The children of a node, in order: array elements, or member values by name.
function children(n: Node): Node[] {
  const v = n.v;
  if (Array.isArray(v)) return v.map((e, i) => ({ v: e, p: elemPath(n.p, i) }));
  if (isObj(v)) return sortedKeys(v).map((k) => ({ v: v[k], p: memberPath(n.p, k) }));
  return [];
}

function sliceIndexes(start: number | null, end: number | null, step: number | null, len: number): number[] {
  const st = step ?? 1;
  const out: number[] = [];
  if (st === 0) return out;
  const norm = (x: number) => (x < 0 ? x + len : x);
  if (st > 0) {
    const lower = Math.min(Math.max(norm(start ?? 0), 0), len);
    const upper = Math.min(Math.max(norm(end ?? len), 0), len);
    for (let i = lower; i < upper; i += st) out.push(i);
  } else {
    const upper = Math.min(Math.max(norm(start ?? len - 1), -1), len - 1);
    const lower = Math.min(Math.max(norm(end ?? -len - 1), -1), len - 1);
    for (let i = upper; i > lower; i += st) out.push(i);
  }
  return out;
}

function applySelector(sel: Selector, n: Node, ctx: Ctx, out: Node[]): void {
  const v = n.v;
  switch (sel.t) {
    case 'name':
      if (isObj(v) && Object.hasOwn(v, sel.name)) out.push({ v: v[sel.name], p: memberPath(n.p, sel.name) });
      return;
    case 'index':
      if (Array.isArray(v)) {
        const i = sel.i < 0 ? sel.i + v.length : sel.i;
        if (i >= 0 && i < v.length) out.push({ v: v[i], p: elemPath(n.p, i) });
      }
      return;
    case 'wild':
      out.push(...children(n));
      return;
    case 'slice':
      if (Array.isArray(v)) {
        for (const i of sliceIndexes(sel.start, sel.end, sel.step, v.length)) {
          out.push({ v: v[i], p: elemPath(n.p, i) });
        }
      }
      return;
    case 'filter':
      for (const c of children(n)) {
        if (evalLogical(sel.expr, { root: ctx.root, cur: c })) out.push(c);
      }
      return;
  }
}

export function evalQuery(q: Query, root: Node, cur: Node): Node[] {
  const ctx: Ctx = { root, cur };
  let nodes: Node[] = [q.root === '$' ? root : cur];
  for (const seg of q.segs) {
    const next: Node[] = [];
    for (const n of nodes) {
      if (!seg.desc) {
        for (const sel of seg.sels) applySelector(sel, n, ctx, next);
        continue;
      }
      const stack: Node[] = [n];
      while (stack.length > 0) {
        const m = stack.pop()!;
        for (const sel of seg.sels) applySelector(sel, m, ctx, next);
        const kids = children(m);
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      }
    }
    nodes = next;
  }
  return nodes;
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
  }
  if (isObj(a)) {
    if (!isObj(b)) return false;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]));
  }
  return false;
}

function less(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  if (typeof a === 'string' && typeof b === 'string') return cmpCodePoints(a, b) < 0;
  return false;
}

function eq(a: Val, b: Val): boolean {
  if (a === NOTHING || b === NOTHING) return a === b;
  return equal(a, b);
}

function lt(a: Val, b: Val): boolean {
  if (a === NOTHING || b === NOTHING) return false;
  return less(a, b);
}

function evalLogical(e: Logical, ctx: Ctx): boolean {
  switch (e.t) {
    case 'or':
      return evalLogical(e.l, ctx) || evalLogical(e.r, ctx);
    case 'and':
      return evalLogical(e.l, ctx) && evalLogical(e.r, ctx);
    case 'not':
      return !evalLogical(e.e, ctx);
    case 'exists':
      return evalQuery(e.q, ctx.root, ctx.cur).length > 0;
    case 'call':
      return callLogical(e.f, ctx);
    case 'cmp': {
      const a = evalOperand(e.l, ctx);
      const b = evalOperand(e.r, ctx);
      switch (e.op) {
        case '==': return eq(a, b);
        case '!=': return !eq(a, b);
        case '<': return lt(a, b);
        case '<=': return lt(a, b) || eq(a, b);
        case '>': return lt(b, a);
        default: return lt(b, a) || eq(a, b);
      }
    }
  }
}

function evalOperand(o: Operand, ctx: Ctx): Val {
  switch (o.t) {
    case 'lit':
      return o.v;
    case 'sq': {
      const nodes = evalQuery(o.q, ctx.root, ctx.cur);
      return nodes.length === 1 ? nodes[0].v : NOTHING;
    }
    case 'fn':
      return callValue(o.f, ctx);
    case 'nodes':
      throw new Error('unexpected nodelist operand');
  }
}

function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

function callValue(f: Call, ctx: Ctx): Val {
  switch (f.name) {
    case 'length': {
      const v = evalOperand(f.args[0], ctx);
      if (typeof v === 'string') return codePointLength(v);
      if (Array.isArray(v)) return v.length;
      if (isObj(v)) return Object.keys(v).length;
      return NOTHING;
    }
    case 'count':
      return evalQuery((f.args[0] as { q: Query }).q, ctx.root, ctx.cur).length;
    default: {
      const nodes = evalQuery((f.args[0] as { q: Query }).q, ctx.root, ctx.cur);
      return nodes.length === 1 ? nodes[0].v : NOTHING;
    }
  }
}

function callLogical(f: Call, ctx: Ctx): boolean {
  const s = evalOperand(f.args[0], ctx);
  const re = evalOperand(f.args[1], ctx);
  if (typeof s !== 'string' || typeof re !== 'string') return false;
  return iregexpMatch(s, re, f.name === 'match');
}

export function runQuery(q: Query, doc: unknown): { values: unknown[]; paths: string[] } {
  const root: Node = { v: doc, p: '$' };
  const nodes = evalQuery(q, root, root);
  return { values: nodes.map((n) => n.v), paths: nodes.map((n) => n.p) };
}
