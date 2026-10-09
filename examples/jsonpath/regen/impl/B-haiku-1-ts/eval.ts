// Evaluation of parsed queries (R3-R26) and normalized paths (R29).

import { JNum } from './json.ts';
import type { JVal } from './json.ts';
import { iregexpTest } from './iregexp.ts';
import type { Expr, Query, Segment, Selector } from './query.ts';

// A node: its value, and its location as a link to its parent plus the step taken from it.
// Paths are built only for the nodes that are returned (see pathOf).
export interface Node {
  v: JVal;
  up: Node | null;
  step: string;
}

// "Nothing": no value. Distinct from every JSON value, including null.
export const NOTHING: unique symbol = Symbol('Nothing');

type Value = JVal | typeof NOTHING;

// The normalized path of a node (R29).
export function pathOf(n: Node): string {
  const steps: string[] = [];
  for (let c: Node | null = n; c !== null; c = c.up) steps.push(c.step);
  return '$' + steps.reverse().join('');
}

export function evaluate(q: Query, doc: JVal): Node[] {
  const root: Node = { v: doc, up: null, step: '' };
  return run(q, root, root);
}

function run(q: Query, cur: Node, root: Node): Node[] {
  let list: Node[] = [q.root === '$' ? root : cur];
  for (const seg of q.segs) list = step(seg, list, root);
  return list;
}

// Applies one segment to each node of the list, concatenating the results in order.
function step(seg: Segment, list: Node[], root: Node): Node[] {
  const next: Node[] = [];
  for (const n of list) {
    const targets = seg.desc ? descendants(n) : [n];
    for (const t of targets) {
      for (const hit of select(seg.sels, t, root)) next.push(hit);
    }
  }
  return next;
}

// The node and all its descendants in pre-order (R6). Uses an explicit stack, so the
// depth of the document is not limited by the call stack.
function descendants(n: Node): Node[] {
  const out: Node[] = [];
  const pending: Node[] = [n];
  while (pending.length > 0) {
    const cur = pending.pop() as Node;
    out.push(cur);
    const kids = childrenOf(cur);
    for (let k = kids.length - 1; k >= 0; k--) pending.push(kids[k]);
  }
  return out;
}

// Children in document order for objects and index order for arrays (R30).
function childrenOf(n: Node): Node[] {
  const out: Node[] = [];
  if (Array.isArray(n.v)) {
    n.v.forEach((x, k) => out.push({ v: x, up: n, step: `[${k}]` }));
  } else if (n.v instanceof Map) {
    for (const [k, x] of n.v) out.push({ v: x, up: n, step: quoteName(k) });
  }
  return out;
}

// The results of a list of selectors applied to one node (R4).
function select(sels: Selector[], node: Node, root: Node): Node[] {
  const out: Node[] = [];
  for (const sel of sels) {
    if (sel.k === 'name') {
      if (node.v instanceof Map && node.v.has(sel.name)) {
        out.push({ v: node.v.get(sel.name) as JVal, up: node, step: quoteName(sel.name) });
      }
    } else if (sel.k === 'wild') {
      for (const c of childrenOf(node)) out.push(c);
    } else if (sel.k === 'filter') {
      for (const c of childrenOf(node)) {
        if (holds(sel.e, c, root)) out.push(c);
      }
    } else if (Array.isArray(node.v)) {
      const len = node.v.length;
      const ks = sel.k === 'index' ? [sel.i < 0 ? len + sel.i : sel.i] : sliceIndices(len, sel);
      for (const k of ks) {
        if (k >= 0 && k < len) out.push({ v: node.v[k], up: node, step: `[${k}]` });
      }
    }
  }
  return out;
}

// Indices selected by a slice (R11.2), in the order they are selected.
function sliceIndices(
  len: number,
  s: { start: number | null; end: number | null; step: number | null },
): number[] {
  const step = s.step ?? 1;
  const out: number[] = [];
  if (step === 0) return out;
  const norm = (i: number): number => (i >= 0 ? i : len + i);
  if (step > 0) {
    const lower = Math.min(Math.max(norm(s.start ?? 0), 0), len);
    const upper = Math.min(Math.max(norm(s.end ?? len), 0), len);
    for (let i = lower; i < upper; i += step) out.push(i);
  } else {
    const upper = Math.min(Math.max(norm(s.start ?? len - 1), -1), len - 1);
    const lower = Math.min(Math.max(norm(s.end ?? -len - 1), -1), len - 1);
    for (let i = upper; i > lower; i += step) out.push(i);
  }
  return out;
}

// A logical expression as a boolean (LogicalTrue / LogicalFalse).
function holds(e: Expr, cur: Node, root: Node): boolean {
  switch (e.k) {
    case 'and':
      return holds(e.l, cur, root) && holds(e.r, cur, root);
    case 'or':
      return holds(e.l, cur, root) || holds(e.r, cur, root);
    case 'not':
      return !holds(e.e, cur, root);
    case 'group':
      return holds(e.e, cur, root);
    case 'query':
      return run(e.q, cur, root).length > 0;
    case 'cmp':
      return compare(e, cur, root);
    case 'fn':
      return regexCall(e, cur, root);
    default:
      return false; // literals are rejected by the static checks
  }
}

// A comparable or function argument as a value, or NOTHING.
function value(e: Expr, cur: Node, root: Node): Value {
  switch (e.k) {
    case 'lit':
      return e.v;
    case 'query': {
      const hits = run(e.q, cur, root);
      return hits.length > 0 ? hits[0].v : NOTHING;
    }
    case 'fn':
      return fnValue(e, cur, root);
    default:
      return NOTHING;
  }
}

function fnValue(e: { name: string; args: Expr[] }, cur: Node, root: Node): Value {
  const arg = e.args[0];
  switch (e.name) {
    case 'length': {
      const v = value(arg, cur, root);
      if (typeof v === 'string') return num([...v].length);
      if (Array.isArray(v)) return num(v.length);
      if (v instanceof Map) return num(v.size);
      return NOTHING;
    }
    case 'count':
      return num(nodes(arg, cur, root).length);
    case 'value': {
      const hits = nodes(arg, cur, root);
      return hits.length === 1 ? hits[0].v : NOTHING;
    }
    default:
      return regexCall(e, cur, root);
  }
}

function nodes(e: Expr, cur: Node, root: Node): Node[] {
  return e.k === 'query' ? run(e.q, cur, root) : [];
}

function num(n: number): JNum {
  return new JNum(String(n), n);
}

// match() and search() (R24, R25).
function regexCall(e: { name: string; args: Expr[] }, cur: Node, root: Node): boolean {
  const s = value(e.args[0], cur, root);
  const r = value(e.args[1], cur, root);
  if (typeof s !== 'string' || typeof r !== 'string') return false;
  return iregexpTest(s, r, e.name === 'match');
}

// Comparisons (R18).
function compare(e: { op: string; l: Expr; r: Expr }, cur: Node, root: Node): boolean {
  const a = value(e.l, cur, root);
  const b = value(e.r, cur, root);
  switch (e.op) {
    case '==':
      return equal(a, b);
    case '!=':
      return !equal(a, b);
    case '<':
      return less(a, b);
    case '>':
      return less(b, a);
    case '<=':
      return less(a, b) || equal(a, b);
    default:
      return less(b, a) || equal(a, b); // >=
  }
}

function equal(a: Value, b: Value): boolean {
  if (a === NOTHING || b === NOTHING) return a === b;
  return same(a, b);
}

// Structural equality (R18.2), with an explicit stack of pairs to compare.
function same(a: JVal, b: JVal): boolean {
  const pending: Array<[JVal, JVal]> = [[a, b]];
  while (pending.length > 0) {
    const [x, y] = pending.pop() as [JVal, JVal];
    if (x instanceof JNum) {
      if (!(y instanceof JNum) || x.n !== y.n) return false;
    } else if (Array.isArray(x)) {
      if (!Array.isArray(y) || x.length !== y.length) return false;
      for (let k = 0; k < x.length; k++) pending.push([x[k], y[k]]);
    } else if (x instanceof Map) {
      if (!(y instanceof Map) || x.size !== y.size) return false;
      for (const [k, xv] of x) {
        if (!y.has(k)) return false;
        pending.push([xv, y.get(k) as JVal]);
      }
    } else if (x !== y) {
      return false; // null, booleans, strings
    }
  }
  return true;
}

function less(a: Value, b: Value): boolean {
  if (a instanceof JNum && b instanceof JNum) return a.n < b.n;
  if (typeof a === 'string' && typeof b === 'string') return compareCodePoints(a, b) < 0;
  return false;
}

// Orders strings by Unicode scalar values, not UTF-16 code units (R18.3).
function compareCodePoints(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const n = Math.min(x.length, y.length);
  for (let k = 0; k < n; k++) {
    const d = (x[k].codePointAt(0) as number) - (y[k].codePointAt(0) as number);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

// A member-name step of a normalized path: ['name'] with the escapes of R29.2.
export function quoteName(name: string): string {
  let out = "['";
  for (const ch of name) {
    switch (ch) {
      case '\b':
        out += '\\b';
        break;
      case '\f':
        out += '\\f';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      case "'":
        out += "\\'";
        break;
      case '\\':
        out += '\\\\';
        break;
      default: {
        const cp = ch.codePointAt(0) as number;
        out += cp < 0x20 ? '\\u00' + cp.toString(16).padStart(2, '0') : ch;
      }
    }
  }
  return out + "']";
}
