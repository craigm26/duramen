// Query evaluation.
import { JNum } from './json.ts';
import type { JValue } from './json.ts';
import type { Expr, FQuery, Segment, Selector } from './query.ts';
import { iregexpMatch } from './iregexp.ts';

export type Node = { v: JValue; par: Node | null; key: string | number };

const NOTHING = undefined;
type Val = JValue | undefined;

function escapeName(name: string): string {
  let out = '';
  for (const c of name) {
    const n = c.codePointAt(0)!;
    if (c === '\b') out += '\\b';
    else if (c === '\f') out += '\\f';
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else if (c === "'") out += "\\'";
    else if (c === '\\') out += '\\\\';
    else if (n < 0x20) out += '\\u' + n.toString(16).padStart(4, '0');
    else out += c;
  }
  return out;
}

export function normalizedPath(n: Node): string {
  const parts: string[] = [];
  for (let c: Node | null = n; c && c.par; c = c.par) {
    parts.push(typeof c.key === 'number' ? `[${c.key}]` : `['${escapeName(c.key)}']`);
  }
  return '$' + parts.reverse().join('');
}

function children(n: Node): Node[] {
  const v = n.v;
  if (Array.isArray(v)) return v.map((x, i) => ({ v: x, par: n, key: i }));
  if (v instanceof Map) return Array.from(v, ([k, x]) => ({ v: x, par: n, key: k }));
  return [];
}

function cmpString(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0)!);
  const y = Array.from(b, (c) => c.codePointAt(0)!);
  const m = Math.min(x.length, y.length);
  for (let i = 0; i < m; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return x.length - y.length;
}

function equal(a: Val, b: Val): boolean {
  if (a === NOTHING || b === NOTHING) return a === b;
  if (a instanceof JNum) return b instanceof JNum && a.n === b.n;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
  }
  if (a instanceof Map) {
    if (!(b instanceof Map) || a.size !== b.size) return false;
    for (const [k, x] of a) if (!b.has(k) || !equal(x, b.get(k))) return false;
    return true;
  }
  return a === b;
}

function less(a: Val, b: Val): boolean {
  if (a instanceof JNum && b instanceof JNum) return a.n < b.n;
  if (typeof a === 'string' && typeof b === 'string') return cmpString(a, b) < 0;
  return false;
}

function compare(op: string, a: Val, b: Val): boolean {
  switch (op) {
    case '==': return equal(a, b);
    case '!=': return !equal(a, b);
    case '<': return less(a, b);
    case '>': return less(b, a);
    case '<=': return less(a, b) || equal(a, b);
    default: return less(b, a) || equal(a, b);
  }
}

function applySelector(sel: Selector, n: Node, out: Node[], root: JValue): void {
  const v = n.v;
  switch (sel.k) {
    case 'name':
      if (v instanceof Map && v.has(sel.name)) out.push({ v: v.get(sel.name)!, par: n, key: sel.name });
      return;
    case 'wild':
      out.push(...children(n));
      return;
    case 'idx': {
      if (!Array.isArray(v)) return;
      const i = sel.i < 0 ? v.length + sel.i : sel.i;
      if (i >= 0 && i < v.length) out.push({ v: v[i], par: n, key: i });
      return;
    }
    case 'slice': {
      if (!Array.isArray(v)) return;
      const len = v.length;
      const step = sel.step ?? 1;
      if (step === 0) return;
      const norm = (i: number) => (i >= 0 ? i : len + i);
      const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
      if (step > 0) {
        const lower = clamp(norm(sel.start ?? 0), 0, len);
        const upper = clamp(norm(sel.end ?? len), 0, len);
        for (let i = lower; i < upper; i += step) out.push({ v: v[i], par: n, key: i });
      } else {
        const upper = clamp(norm(sel.start ?? len - 1), -1, len - 1);
        const lower = clamp(norm(sel.end ?? -len - 1), -1, len - 1);
        for (let i = upper; i > lower; i += step) out.push({ v: v[i], par: n, key: i });
      }
      return;
    }
    case 'filter':
      for (const c of children(n)) if (truth(sel.e, c.v, root)) out.push(c);
  }
}

export function applySegment(seg: Segment, nodes: Node[], root: JValue): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    if (!seg.desc) {
      for (const s of seg.sels) applySelector(s, n, out, root);
      continue;
    }
    const stack = [n];
    while (stack.length) {
      const d = stack.pop()!;
      for (const s of seg.sels) applySelector(s, d, out, root);
      const ch = children(d);
      for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]);
    }
  }
  return out;
}

export function evalSegments(segs: Segment[], start: Node, root: JValue): Node[] {
  let nodes = [start];
  for (const seg of segs) {
    nodes = applySegment(seg, nodes, root);
    if (nodes.length === 0) break;
  }
  return nodes;
}

function queryNodes(q: FQuery, cur: JValue, root: JValue): Node[] {
  return evalSegments(q.segs, { v: q.root === '@' ? cur : root, par: null, key: '' }, root);
}

function num(n: number): JNum {
  return new JNum(String(n));
}

function value(e: Expr, cur: JValue, root: JValue): Val {
  switch (e.k) {
    case 'lit': return e.v;
    case 'q': {
      const ns = queryNodes(e, cur, root);
      return ns.length === 1 ? ns[0].v : NOTHING;
    }
    case 'fn': {
      if (e.name === 'count') return num(queryNodes(e.args[0] as FQuery, cur, root).length);
      if (e.name === 'value') {
        const ns = queryNodes(e.args[0] as FQuery, cur, root);
        return ns.length === 1 ? ns[0].v : NOTHING;
      }
      const a = value(e.args[0], cur, root);
      if (typeof a === 'string') {
        let n = 0;
        for (const _ of a) n++;
        return num(n);
      }
      if (Array.isArray(a)) return num(a.length);
      if (a instanceof Map) return num(a.size);
      return NOTHING;
    }
    default: return NOTHING;
  }
}

function truth(e: Expr, cur: JValue, root: JValue): boolean {
  switch (e.k) {
    case 'or': return truth(e.l, cur, root) || truth(e.r, cur, root);
    case 'and': return truth(e.l, cur, root) && truth(e.r, cur, root);
    case 'not': return !truth(e.e, cur, root);
    case 'paren': return truth(e.e, cur, root);
    case 'cmp': return compare(e.op, value(e.l, cur, root), value(e.r, cur, root));
    case 'q': return queryNodes(e, cur, root).length > 0;
    case 'fn': {
      const s = value(e.args[0], cur, root);
      const r = value(e.args[1], cur, root);
      return typeof s === 'string' && typeof r === 'string' && iregexpMatch(s, r, e.name === 'match');
    }
    default: return false;
  }
}
