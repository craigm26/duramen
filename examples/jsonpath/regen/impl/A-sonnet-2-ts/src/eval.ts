// Evaluation of a parsed JSONPath query against a JSON value.
import { RawNum } from './json.ts';
import { compile } from './iregexp.ts';
import type { Expr, Query, Selector } from './parse.ts';

export interface Node {
  v: unknown;
  p: string;
}

const NOTHING = Symbol('Nothing');
type Val = unknown | typeof NOTHING;

const isArr = Array.isArray;
const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !isArr(v) && !(v instanceof RawNum);
const isNum = (v: unknown): v is number | RawNum => typeof v === 'number' || v instanceof RawNum;

function escName(k: string): string {
  let out = '';
  for (const c of k) {
    const cp = c.codePointAt(0)!;
    if (c === "'") out += "\\'";
    else if (c === '\\') out += '\\\\';
    else if (c === '\b') out += '\\b';
    else if (c === '\f') out += '\\f';
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else if (cp < 0x20) out += '\\u' + cp.toString(16).padStart(4, '0');
    else out += c;
  }
  return out;
}

// ---- comparison ----
function cmpNum(a: number | RawNum, b: number | RawNum): number {
  const big = (x: number | RawNum): bigint | null => {
    if (x instanceof RawNum) return /^-?\d+$/.test(x.text) ? BigInt(x.text) : null;
    return Number.isInteger(x) ? BigInt(x) : null;
  };
  const x = a instanceof RawNum ? a.n : a;
  const y = b instanceof RawNum ? b.n : b;
  if (a instanceof RawNum || b instanceof RawNum) {
    const ba = big(a);
    const bb = big(b);
    if (ba !== null && bb !== null) return ba < bb ? -1 : ba > bb ? 1 : 0;
  }
  return x < y ? -1 : x > y ? 1 : x === y ? 0 : NaN;
}

function equal(a: Val, b: Val): boolean {
  if (a === NOTHING || b === NOTHING) return a === b;
  if (isNum(a) || isNum(b)) return isNum(a) && isNum(b) && cmpNum(a, b) === 0;
  if (isArr(a)) return isArr(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (isObj(a)) {
    if (!isObj(b)) return false;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]));
  }
  return a === b;
}

function lessStr(a: string, b: string): boolean {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(j)!;
    if (x !== y) return x < y;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  return i >= a.length && j < b.length;
}

function less(a: Val, b: Val): boolean {
  if (isNum(a) && isNum(b)) return cmpNum(a, b) < 0;
  if (typeof a === 'string' && typeof b === 'string') return lessStr(a, b);
  return false;
}

function compare(op: string, a: Val, b: Val): boolean {
  switch (op) {
    case '==': return equal(a, b);
    case '!=': return !equal(a, b);
    case '<': return less(a, b);
    case '<=': return less(a, b) || equal(a, b);
    case '>': return less(b, a);
    default: return less(b, a) || equal(a, b);
  }
}

// ---- selection ----
function children(n: Node): Node[] {
  const v = n.v;
  if (isArr(v)) return v.map((x, i) => ({ v: x, p: `${n.p}[${i}]` }));
  if (isObj(v)) return Object.keys(v).map((k) => ({ v: v[k], p: `${n.p}['${escName(k)}']` }));
  return [];
}

function select(sel: Selector, n: Node, root: Node, out: Node[]): void {
  const v = n.v;
  switch (sel.k) {
    case 'name':
      if (isObj(v) && Object.hasOwn(v, sel.name)) out.push({ v: v[sel.name], p: `${n.p}['${escName(sel.name)}']` });
      return;
    case 'index':
      if (isArr(v)) {
        const i = sel.i < 0 ? v.length + sel.i : sel.i;
        if (i >= 0 && i < v.length) out.push({ v: v[i], p: `${n.p}[${i}]` });
      }
      return;
    case 'wild':
      out.push(...children(n));
      return;
    case 'slice': {
      if (!isArr(v)) return;
      const len = v.length;
      const step = sel.step ?? 1;
      if (step === 0) return;
      const norm = (i: number) => (i >= 0 ? i : len + i);
      const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
      if (step > 0) {
        const lower = clamp(norm(sel.start ?? 0), 0, len);
        const upper = clamp(norm(sel.end ?? len), 0, len);
        for (let i = lower; i < upper; i += step) out.push({ v: v[i], p: `${n.p}[${i}]` });
      } else {
        const upper = clamp(norm(sel.start ?? len - 1), -1, len - 1);
        const lower = clamp(norm(sel.end ?? -len - 1), -1, len - 1);
        for (let i = upper; lower < i; i += step) out.push({ v: v[i], p: `${n.p}[${i}]` });
      }
      return;
    }
    case 'filter':
      for (const c of children(n)) if (truthy(sel.expr, c, root)) out.push(c);
      return;
  }
}

function runQuery(q: Query, start: Node, root: Node): Node[] {
  let cur: Node[] = [start];
  for (const seg of q.segs) {
    const next: Node[] = [];
    for (const n of cur) {
      if (!seg.desc) {
        for (const s of seg.sels) select(s, n, root, next);
        continue;
      }
      const stack = [n];
      while (stack.length) {
        const d = stack.pop()!;
        for (const s of seg.sels) select(s, d, root, next);
        const kids = children(d);
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      }
    }
    cur = next;
  }
  return cur;
}

// ---- filter expressions ----
function nodesOf(e: Expr, cur: Node, root: Node): Node[] {
  if (e.t !== 'q') throw new Error('nodes expected');
  return runQuery(e.q, e.q.root === '$' ? root : cur, root);
}

function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

function value(e: Expr, cur: Node, root: Node): Val {
  switch (e.t) {
    case 'lit': return e.v;
    case 'q': {
      const ns = nodesOf(e, cur, root);
      return ns.length === 1 ? ns[0].v : NOTHING;
    }
    case 'fn': {
      if (e.name === 'count') return nodesOf(e.args[0], cur, root).length;
      if (e.name === 'value') {
        const ns = nodesOf(e.args[0], cur, root);
        return ns.length === 1 ? ns[0].v : NOTHING;
      }
      const a = value(e.args[0], cur, root);
      if (typeof a === 'string') return codePoints(a);
      if (isArr(a)) return a.length;
      if (isObj(a)) return Object.keys(a).length;
      return NOTHING;
    }
    default: throw new Error('value expected');
  }
}

function truthy(e: Expr, cur: Node, root: Node): boolean {
  switch (e.t) {
    case 'or': return e.items.some((x) => truthy(x, cur, root));
    case 'and': return e.items.every((x) => truthy(x, cur, root));
    case 'not': return !truthy(e.e, cur, root);
    case 'cmp': return compare(e.op, value(e.l, cur, root), value(e.r, cur, root));
    case 'exists': return runQuery(e.q, e.q.root === '$' ? root : cur, root).length > 0;
    case 'fn': {
      const s = value(e.args[0], cur, root);
      const p = value(e.args[1], cur, root);
      if (typeof s !== 'string' || typeof p !== 'string') return false;
      const re = compile(p, e.name === 'match');
      return re !== null && re.test(s);
    }
    default: throw new Error('logical expected');
  }
}

export function evaluate(q: Query, doc: unknown): Node[] {
  const root: Node = { v: doc, p: '$' };
  return runQuery(q, root, root);
}
