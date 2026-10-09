// Query evaluation.

import { JNum } from './json.ts';
import type { Value } from './json.ts';
import type { Expr, Query, Segment, Selector } from './parse.ts';
import { iregexpMatch, iregexpSearch } from './regexp.ts';

export interface Node {
  value: Value;
  path: string;
}

type Maybe = Value | undefined; // undefined is Nothing

export function escapeName(name: string): string {
  let out = '';
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === "'") out += "\\'";
    else if (ch === '\\') out += '\\\\';
    else if (c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out;
}

function children(n: Node): Node[] {
  const v = n.value;
  if (Array.isArray(v)) return v.map((x, i) => ({ value: x, path: n.path + '[' + i + ']' }));
  if (v instanceof Map) {
    const out: Node[] = [];
    for (const [k, x] of v) out.push({ value: x, path: n.path + "['" + escapeName(k) + "']" });
    return out;
  }
  return [];
}

function sliceIndices(start: number | null, end: number | null, step: number | null, len: number): number[] {
  const st = step ?? 1;
  if (st === 0) return [];
  const norm = (i: number) => (i >= 0 ? i : len + i);
  const out: number[] = [];
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

interface Ctx {
  root: Node;
  current: Node;
}

function applySelector(sel: Selector, n: Node, ctx: Ctx): Node[] {
  const v = n.value;
  switch (sel.k) {
    case 'name': {
      if (!(v instanceof Map) || !v.has(sel.name)) return [];
      return [{ value: v.get(sel.name)!, path: n.path + "['" + escapeName(sel.name) + "']" }];
    }
    case 'wild': return children(n);
    case 'index': {
      if (!Array.isArray(v)) return [];
      const i = sel.i >= 0 ? sel.i : v.length + sel.i;
      if (i < 0 || i >= v.length) return [];
      return [{ value: v[i], path: n.path + '[' + i + ']' }];
    }
    case 'slice': {
      if (!Array.isArray(v)) return [];
      return sliceIndices(sel.start, sel.end, sel.step, v.length).map((i) => ({
        value: v[i],
        path: n.path + '[' + i + ']',
      }));
    }
    case 'filter':
      return children(n).filter((c) => truthy(sel.e, { root: ctx.root, current: c }));
  }
}

function applySegment(seg: Segment, n: Node, ctx: Ctx): Node[] {
  const out: Node[] = [];
  const visit = (d: Node) => {
    for (const s of seg.selectors) for (const r of applySelector(s, d, ctx)) out.push(r);
  };
  if (!seg.desc) {
    visit(n);
    return out;
  }
  const stack: Node[] = [n];
  while (stack.length > 0) {
    const d = stack.pop()!;
    visit(d);
    const ch = children(d);
    for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]);
  }
  return out;
}

function evalQuery(q: Query, ctx: Ctx): Node[] {
  let nodes: Node[] = [q.root === '$' ? ctx.root : ctx.current];
  for (const seg of q.segments) {
    const next: Node[] = [];
    for (const n of nodes) for (const r of applySegment(seg, n, ctx)) next.push(r);
    nodes = next;
    if (nodes.length === 0) break;
  }
  return nodes;
}

function cmpStr(a: string, b: string): number {
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

function equal(a: Maybe, b: Maybe): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a instanceof JNum) return b instanceof JNum && a.v === b.v;
  if (typeof a === 'string') return typeof b === 'string' && a === b;
  if (a === null || typeof a === 'boolean') return a === b;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
  }
  if (!(b instanceof Map) || a.size !== b.size) return false;
  for (const [k, x] of a) {
    if (!b.has(k) || !equal(x, b.get(k))) return false;
  }
  return true;
}

function less(a: Maybe, b: Maybe): boolean {
  if (a instanceof JNum && b instanceof JNum) return a.v < b.v;
  if (typeof a === 'string' && typeof b === 'string') return cmpStr(a, b) < 0;
  return false;
}

function num(n: number): JNum {
  return new JNum(String(n), n);
}

function charCount(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

function valueOf(e: Expr, ctx: Ctx): Maybe {
  switch (e.k) {
    case 'lit': return e.v;
    case 'query': {
      const r = evalQuery(e.q, ctx);
      return r.length === 1 ? r[0].value : undefined;
    }
    case 'func': {
      if (e.name === 'count') return num(argNodes(e.args[0], ctx).length);
      if (e.name === 'value') {
        const r = argNodes(e.args[0], ctx);
        return r.length === 1 ? r[0].value : undefined;
      }
      const v = valueOf(e.args[0], ctx);
      if (typeof v === 'string') return num(charCount(v));
      if (Array.isArray(v)) return num(v.length);
      if (v instanceof Map) return num(v.size);
      return undefined;
    }
    default: return undefined;
  }
}

function argNodes(e: Expr, ctx: Ctx): Node[] {
  return e.k === 'query' ? evalQuery(e.q, ctx) : [];
}

function truthy(e: Expr, ctx: Ctx): boolean {
  switch (e.k) {
    case 'or': return truthy(e.a, ctx) || truthy(e.b, ctx);
    case 'and': return truthy(e.a, ctx) && truthy(e.b, ctx);
    case 'not': return !truthy(e.e, ctx);
    case 'paren': return truthy(e.e, ctx);
    case 'query': return evalQuery(e.q, ctx).length > 0;
    case 'func': {
      const s = valueOf(e.args[0], ctx);
      const r = valueOf(e.args[1], ctx);
      if (typeof s !== 'string' || typeof r !== 'string') return false;
      return e.name === 'match' ? iregexpMatch(s, r) : iregexpSearch(s, r);
    }
    case 'cmp': {
      const l = valueOf(e.l, ctx);
      const r = valueOf(e.r, ctx);
      switch (e.op) {
        case '==': return equal(l, r);
        case '!=': return !equal(l, r);
        case '<': return less(l, r);
        case '>': return less(r, l);
        case '<=': return less(l, r) || equal(l, r);
        default: return less(r, l) || equal(l, r);
      }
    }
    default: return false;
  }
}

export function runQuery(q: Query, doc: Value): Node[] {
  const root: Node = { value: doc, path: '$' };
  return evalQuery(q, { root, current: root });
}
