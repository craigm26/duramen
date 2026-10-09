// JSONPath evaluation over parsed queries.
import { Num } from "./json.ts";
import type { Json } from "./json.ts";
import { compileIRegexp } from "./regex.ts";
import type { Expr, Func, Operand, Query, Selector } from "./parse.ts";

export interface PNode {
  v: Json;
  parent: PNode | null;
  key: string | number;
}

type Val = Json | undefined; // undefined is Nothing

function child(parent: PNode, v: Json, key: string | number): PNode {
  return { v, parent, key };
}

function* children(n: PNode): Generator<PNode> {
  const v = n.v;
  if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield child(n, v[i], i);
  else if (v instanceof Map) for (const [k, x] of v) yield child(n, x, k);
}

export function normalizedPath(n: PNode): string {
  const parts: string[] = [];
  for (let c: PNode | null = n; c && c.parent; c = c.parent) {
    parts.push(typeof c.key === "number" ? `[${c.key}]` : `['${escapeName(c.key)}']`);
  }
  return "$" + parts.reverse().join("");
}

function escapeName(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "'") out += "\\'";
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out;
}

function cpLess(a: string, b: string): boolean {
  let i = 0;
  while (i < a.length && i < b.length) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(i)!;
    if (x !== y) return x < y;
    i += x > 0xffff ? 2 : 1;
  }
  return a.length < b.length;
}

function equal(a: Val, b: Val): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a instanceof Num) return b instanceof Num && Num.cmp(a, b) === 0;
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
  if (a instanceof Num && b instanceof Num) return Num.cmp(a, b) < 0;
  if (typeof a === "string" && typeof b === "string") return cpLess(a, b);
  return false;
}

function compare(op: string, a: Val, b: Val): boolean {
  switch (op) {
    case "==": return equal(a, b);
    case "!=": return !equal(a, b);
    case "<": return less(a, b);
    case "<=": return less(a, b) || equal(a, b);
    case ">": return less(b, a);
    default: return less(b, a) || equal(a, b);
  }
}

interface Ctx {
  root: PNode;
}

export function runQuery(q: Query, start: PNode, ctx: Ctx): PNode[] {
  let list: PNode[] = [q.root === "$" ? ctx.root : start];
  for (const seg of q.segs) {
    const out: PNode[] = [];
    for (const n of list) {
      if (!seg.desc) applyAll(seg.sels, n, out, ctx);
      else {
        // pre-order walk: node before descendants, array order
        const stack: PNode[] = [n];
        while (stack.length) {
          const d = stack.pop()!;
          applyAll(seg.sels, d, out, ctx);
          const kids = [...children(d)];
          for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
        }
      }
    }
    list = out;
  }
  return list;
}

function applyAll(sels: Selector[], n: PNode, out: PNode[], ctx: Ctx) {
  for (const s of sels) apply(s, n, out, ctx);
}

function apply(s: Selector, n: PNode, out: PNode[], ctx: Ctx) {
  const v = n.v;
  switch (s.k) {
    case "name":
      if (v instanceof Map && v.has(s.name)) out.push(child(n, v.get(s.name)!, s.name));
      break;
    case "wild":
      for (const c of children(n)) out.push(c);
      break;
    case "index":
      if (Array.isArray(v)) {
        const i = s.i < 0 ? v.length + s.i : s.i;
        if (i >= 0 && i < v.length) out.push(child(n, v[i], i));
      }
      break;
    case "slice":
      if (Array.isArray(v)) slice(s, n, v, out);
      break;
    case "filter":
      for (const c of children(n)) if (test(s.expr, c, ctx)) out.push(c);
      break;
  }
}

function slice(
  s: { start: number | null; end: number | null; step: number | null },
  n: PNode,
  a: Json[],
  out: PNode[],
) {
  const len = a.length;
  const step = s.step ?? 1;
  if (step === 0) return;
  const norm = (i: number) => (i >= 0 ? i : len + i);
  const start = s.start ?? (step > 0 ? 0 : len - 1);
  const end = s.end ?? (step > 0 ? len : -len - 1);
  const ns = norm(start);
  const ne = norm(end);
  if (step > 0) {
    const lower = Math.min(Math.max(ns, 0), len);
    const upper = Math.min(Math.max(ne, 0), len);
    for (let i = lower; i < upper; i += step) out.push(child(n, a[i], i));
  } else {
    const upper = Math.min(Math.max(ns, -1), len - 1);
    const lower = Math.min(Math.max(ne, -1), len - 1);
    for (let i = upper; lower < i; i += step) out.push(child(n, a[i], i));
  }
}

function test(e: Expr, cur: PNode, ctx: Ctx): boolean {
  switch (e.t) {
    case "or": return test(e.l, cur, ctx) || test(e.r, cur, ctx);
    case "and": return test(e.l, cur, ctx) && test(e.r, cur, ctx);
    case "not": return !test(e.e, cur, ctx);
    case "test": return runQuery(e.q, cur, ctx).length > 0;
    case "ftest": return callFunc(e.f, cur, ctx) === true;
    case "cmp": return compare(e.op, operand(e.l, cur, ctx), operand(e.r, cur, ctx));
  }
}

function operand(o: Operand, cur: PNode, ctx: Ctx): Val {
  if (o.t === "lit") return o.v;
  if (o.t === "q") {
    const r = runQuery(o.q, cur, ctx);
    return r.length === 1 ? r[0].v : undefined;
  }
  return callFunc(o.f, cur, ctx) as Val;
}

function callFunc(f: Func, cur: PNode, ctx: Ctx): Val | boolean {
  const [a, b] = f.args;
  switch (f.name) {
    case "length": {
      const v = operand(a, cur, ctx);
      if (typeof v === "string") {
        let n = 0;
        for (const _ of v) n++;
        return new Num(String(n));
      }
      if (Array.isArray(v)) return new Num(String(v.length));
      if (v instanceof Map) return new Num(String(v.size));
      return undefined;
    }
    case "count":
      return new Num(String(runQuery((a as { q: Query }).q, cur, ctx).length));
    case "value": {
      const r = runQuery((a as { q: Query }).q, cur, ctx);
      return r.length === 1 ? r[0].v : undefined;
    }
    default: {
      const s = operand(a, cur, ctx);
      const p = operand(b, cur, ctx);
      if (typeof s !== "string" || typeof p !== "string") return false;
      const re = compileIRegexp(p);
      if (!re) return false;
      return (f.name === "match" ? re.full : re.partial).test(s);
    }
  }
}

export function evaluate(q: Query, doc: Json): PNode[] {
  const root: PNode = { v: doc, parent: null, key: "" };
  return runQuery(q, root, { root });
}
