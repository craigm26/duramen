// JSONPath (RFC 9535): parser and evaluator.
import { iregexpMatch, iregexpSearch } from './iregexp.ts';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export class QueryError extends Error {}

type Sel =
  | { t: 'name'; name: string }
  | { t: 'wild' }
  | { t: 'idx'; i: number }
  | { t: 'slice'; start: number | null; end: number | null; step: number | null }
  | { t: 'filter'; e: Expr };
type Seg = { desc: boolean; sels: Sel[]; singular: boolean };
type Query = { root: '$' | '@'; segs: Seg[]; singular: boolean };
type Fn = { name: string; args: Arg[] };
type Arg = { a: 'lit'; v: Json } | { a: 'q'; q: Query } | { a: 'fn'; f: Fn };
type Expr =
  | { k: 'or' | 'and'; l: Expr[] }
  | { k: 'not'; e: Expr }
  | { k: 'test'; q: Query }
  | { k: 'fn'; f: Fn }
  | { k: 'cmp'; op: string; l: Arg; r: Arg };

// 'v' value, 'n' nodelist, 'l' logical
const FUNCTIONS: Record<string, { params: string[]; ret: string }> = {
  length: { params: ['v'], ret: 'v' },
  count: { params: ['n'], ret: 'v' },
  match: { params: ['v', 'v'], ret: 'l' },
  search: { params: ['v', 'v'], ret: 'l' },
  value: { params: ['n'], ret: 'v' },
};

const MAX_INT = 9007199254740991;
const INT = /-?(?:0|[1-9][0-9]*)/y;
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const WORD = /[A-Za-z0-9_]*/y;
const HEX4 = /^[0-9a-fA-F]{4}$/;

function isBlank(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9';
}

// U+02CB is refused in shorthand names although the prose admits it (see CHOICES.md C-1).
const REFUSED_NAME_CHAR = 0x2cb;

function isNameFirst(code: number): boolean {
  if (code >= 0x80) return code !== REFUSED_NAME_CHAR;
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || code === 0x5f;
}

class Parser {
  s: string;
  p = 0;
  constructor(s: string) {
    this.s = s;
  }

  fail(): never {
    throw new QueryError('invalid query at ' + this.p);
  }

  peek(): string | undefined {
    return this.s[this.p];
  }

  blank(): void {
    while (isBlank(this.s[this.p])) this.p++;
  }

  eat(c: string): boolean {
    if (this.s.startsWith(c, this.p)) {
      this.p += c.length;
      return true;
    }
    return false;
  }

  expect(c: string): void {
    if (!this.eat(c)) this.fail();
  }

  parseTop(): Query {
    if (this.peek() !== '$') this.fail();
    const q = this.query();
    if (this.p !== this.s.length) this.fail();
    return q;
  }

  query(): Query {
    const root = this.s[this.p++] as '$' | '@';
    const segs: Seg[] = [];
    for (;;) {
      const save = this.p;
      this.blank();
      const c = this.peek();
      if (c === '.' || c === '[') {
        segs.push(this.segment());
      } else {
        this.p = save;
        break;
      }
    }
    return { root, segs, singular: segs.every((g) => g.singular) };
  }

  shorthandName(): string {
    const start = this.p;
    while (this.p < this.s.length) {
      const cp = this.s.codePointAt(this.p)!;
      const ch = String.fromCodePoint(cp);
      const ok = isNameFirst(cp) || (this.p > start && cp >= 0x30 && cp <= 0x39);
      if (!ok) break;
      this.p += ch.length;
    }
    if (this.p === start) this.fail();
    return this.s.slice(start, this.p);
  }

  segment(): Seg {
    if (this.eat('..')) {
      if (this.eat('*')) return { desc: true, sels: [{ t: 'wild' }], singular: false };
      if (this.peek() === '[') return { ...this.bracket(), desc: true, singular: false };
      return { desc: true, sels: [{ t: 'name', name: this.shorthandName() }], singular: false };
    }
    if (this.eat('.')) {
      if (this.eat('*')) return { desc: false, sels: [{ t: 'wild' }], singular: false };
      return { desc: false, sels: [{ t: 'name', name: this.shorthandName() }], singular: true };
    }
    return this.bracket();
  }

  bracket(): Seg {
    this.expect('[');
    const open = this.p;
    const sels: Sel[] = [];
    for (;;) {
      this.blank();
      sels.push(this.selector());
      this.blank();
      if (this.eat(',')) continue;
      this.expect(']');
      break;
    }
    const single = sels.length === 1 && (sels[0].t === 'name' || sels[0].t === 'idx');
    const tight = !isBlank(this.s[open]) && !isBlank(this.s[this.p - 2]);
    return { desc: false, sels, singular: single && tight };
  }

  selector(): Sel {
    const c = this.peek();
    if (c === "'" || c === '"') return { t: 'name', name: this.string() };
    if (c === '*') {
      this.p++;
      return { t: 'wild' };
    }
    if (c === '?') {
      this.p++;
      this.blank();
      return { t: 'filter', e: this.or() };
    }
    if (c === '-' || c === ':' || isDigit(c)) return this.indexOrSlice();
    return this.fail();
  }

  int(): number | null {
    INT.lastIndex = this.p;
    const m = INT.exec(this.s);
    if (!m) return null;
    if (m[0] === '-0') this.fail();
    const n = Number(m[0]);
    if (Math.abs(n) > MAX_INT) this.fail();
    this.p += m[0].length;
    return n;
  }

  indexOrSlice(): Sel {
    const start = this.int();
    this.blank();
    if (!this.eat(':')) {
      if (start === null) this.fail();
      return { t: 'idx', i: start };
    }
    this.blank();
    const end = this.int();
    this.blank();
    let step: number | null = null;
    if (this.eat(':')) {
      this.blank();
      step = this.int();
      this.blank();
    }
    return { t: 'slice', start, end, step };
  }

  string(): string {
    const quote = this.s[this.p++];
    let out = '';
    for (;;) {
      if (this.p >= this.s.length) this.fail();
      const c = this.s[this.p++];
      if (c === quote) return out;
      if (c.charCodeAt(0) < 0x20) this.fail();
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = this.s[this.p++];
      switch (e) {
        case 'b': out += '\b'; break;
        case 't': out += '\t'; break;
        case 'n': out += '\n'; break;
        case 'f': out += '\f'; break;
        case 'r': out += '\r'; break;
        case '/': out += '/'; break;
        case '\\': out += '\\'; break;
        case 'u': {
          const code = this.hex4();
          if (code >= 0xd800 && code <= 0xdbff) {
            if (!this.eat('\\u')) this.fail();
            const low = this.hex4();
            if (low < 0xdc00 || low > 0xdfff) this.fail();
            out += String.fromCharCode(code, low);
          } else if (code >= 0xdc00 && code <= 0xdfff) {
            this.fail();
          } else {
            out += String.fromCharCode(code);
          }
          break;
        }
        default:
          if (e === quote) out += e;
          else this.fail();
      }
    }
  }

  hex4(): number {
    const h = this.s.slice(this.p, this.p + 4);
    if (!HEX4.test(h)) this.fail();
    this.p += 4;
    return parseInt(h, 16);
  }

  // Logical expressions

  or(): Expr {
    const l = [this.and()];
    for (;;) {
      const save = this.p;
      this.blank();
      if (this.eat('||')) {
        l.push(this.and());
      } else {
        this.p = save;
        break;
      }
    }
    return l.length === 1 ? l[0] : { k: 'or', l };
  }

  and(): Expr {
    const l = [this.basic()];
    for (;;) {
      const save = this.p;
      this.blank();
      if (this.eat('&&')) {
        l.push(this.basic());
      } else {
        this.p = save;
        break;
      }
    }
    return l.length === 1 ? l[0] : { k: 'and', l };
  }

  paren(): Expr {
    this.expect('(');
    this.blank();
    const e = this.or();
    this.blank();
    this.expect(')');
    return e;
  }

  basic(): Expr {
    this.blank();
    const c = this.peek();
    if (c === '!') {
      this.p++;
      this.blank();
      if (this.peek() === '(') return { k: 'not', e: this.paren() };
      return { k: 'not', e: this.asTest(this.operand()) };
    }
    if (c === '(') return this.paren();
    const left = this.operand();
    const save = this.p;
    this.blank();
    const op = this.operator();
    if (op === null) {
      this.p = save;
      return this.asTest(left);
    }
    this.blank();
    const right = this.operand();
    this.checkComparable(left);
    this.checkComparable(right);
    return { k: 'cmp', op, l: left, r: right };
  }

  operator(): string | null {
    for (const op of ['==', '!=', '<=', '>=', '<', '>']) {
      if (this.eat(op)) return op;
    }
    return null;
  }

  asTest(a: Arg): Expr {
    if (a.a === 'q') return { k: 'test', q: a.q };
    if (a.a === 'fn' && FUNCTIONS[a.f.name].ret === 'l') return { k: 'fn', f: a.f };
    return this.fail();
  }

  checkComparable(a: Arg): void {
    if (a.a === 'q' && !a.q.singular) this.fail();
    if (a.a === 'fn' && FUNCTIONS[a.f.name].ret !== 'v') this.fail();
  }

  operand(): Arg {
    const c = this.peek();
    if (c === '@' || c === '$') return { a: 'q', q: this.query() };
    if (c === "'" || c === '"') return { a: 'lit', v: this.string() };
    if (c === '-' || isDigit(c)) {
      NUMBER.lastIndex = this.p;
      const m = NUMBER.exec(this.s);
      if (!m) this.fail();
      this.p += m[0].length;
      return { a: 'lit', v: Number(m[0]) };
    }
    if (c !== undefined && c >= 'a' && c <= 'z') {
      WORD.lastIndex = this.p;
      const word = WORD.exec(this.s)![0];
      this.p += word.length;
      if (this.peek() === '(') return { a: 'fn', f: this.call(word) };
      if (word === 'true') return { a: 'lit', v: true };
      if (word === 'false') return { a: 'lit', v: false };
      if (word === 'null') return { a: 'lit', v: null };
    }
    return this.fail();
  }

  call(name: string): Fn {
    const def = FUNCTIONS[name];
    if (!Object.hasOwn(FUNCTIONS, name)) this.fail();
    this.expect('(');
    this.blank();
    const args: Arg[] = [];
    if (!this.eat(')')) {
      for (;;) {
        this.blank();
        args.push(this.operand());
        this.blank();
        if (this.eat(',')) continue;
        this.expect(')');
        break;
      }
    }
    if (args.length !== def.params.length) this.fail();
    args.forEach((a, i) => {
      if (def.params[i] === 'n') {
        if (a.a !== 'q') this.fail();
      } else if (a.a === 'q' ? !a.q.singular : a.a === 'fn' && FUNCTIONS[a.f.name].ret !== 'v') {
        this.fail();
      }
    });
    return { name, args };
  }
}

export function parse(src: string): Query {
  return new Parser(src).parseTop();
}

// Evaluation

type Node = { v: Json; parent: Node | null; key: string | number };

function isObject(v: unknown): v is { [k: string]: Json } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function compareCodePoints(a: string, b: string): number {
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
  return j < b.length ? -1 : 0;
}

function children(n: Node): Node[] {
  const v = n.v;
  if (Array.isArray(v)) return v.map((x, i) => ({ v: x, parent: n, key: i }));
  if (isObject(v)) {
    return Object.keys(v).sort(compareCodePoints).map((k) => ({ v: v[k], parent: n, key: k }));
  }
  return [];
}

function normalizedName(name: string): string {
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

function pathOf(n: Node): string {
  const parts: string[] = [];
  for (let x: Node | null = n; x !== null && x.parent !== null; x = x.parent) {
    parts.push(typeof x.key === 'number' ? '[' + x.key + ']' : "['" + normalizedName(x.key) + "']");
  }
  return '$' + parts.reverse().join('');
}

function slice(n: Node, start: number | null, end: number | null, step: number | null, out: Node[]): void {
  const arr = n.v;
  if (!Array.isArray(arr)) return;
  const len = arr.length;
  const st = step ?? 1;
  if (st === 0) return;
  const norm = (i: number) => (i >= 0 ? i : len + i);
  if (st > 0) {
    const lower = Math.min(Math.max(norm(start ?? 0), 0), len);
    const upper = Math.min(Math.max(norm(end ?? len), 0), len);
    for (let i = lower; i < upper; i += st) out.push({ v: arr[i], parent: n, key: i });
  } else {
    const upper = Math.min(Math.max(norm(start ?? len - 1), -1), len - 1);
    const lower = Math.min(Math.max(norm(end ?? -len - 1), -1), len - 1);
    for (let i = upper; i > lower; i += st) out.push({ v: arr[i], parent: n, key: i });
  }
}

function applySelectors(n: Node, sels: Sel[], root: Node, out: Node[]): void {
  for (const sel of sels) {
    switch (sel.t) {
      case 'name':
        if (isObject(n.v) && Object.hasOwn(n.v, sel.name)) out.push({ v: n.v[sel.name], parent: n, key: sel.name });
        break;
      case 'wild':
        out.push(...children(n));
        break;
      case 'idx':
        if (Array.isArray(n.v)) {
          const i = sel.i >= 0 ? sel.i : n.v.length + sel.i;
          if (i >= 0 && i < n.v.length) out.push({ v: n.v[i], parent: n, key: i });
        }
        break;
      case 'slice':
        slice(n, sel.start, sel.end, sel.step, out);
        break;
      case 'filter':
        for (const c of children(n)) if (evalExpr(sel.e, root, c)) out.push(c);
        break;
    }
  }
}

function descend(n: Node, sels: Sel[], root: Node, out: Node[]): void {
  applySelectors(n, sels, root, out);
  for (const c of children(n)) descend(c, sels, root, out);
}

function evalQuery(q: Query, root: Node, cur: Node): Node[] {
  let nodes = [q.root === '$' ? root : cur];
  for (const seg of q.segs) {
    const out: Node[] = [];
    for (const n of nodes) {
      if (seg.desc) descend(n, seg.sels, root, out);
      else applySelectors(n, seg.sels, root, out);
    }
    nodes = out;
  }
  return nodes;
}

function equal(a: Json | undefined, b: Json | undefined): boolean {
  if (a === undefined || b === undefined || a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
  }
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]));
  }
  return a === b && !Array.isArray(b);
}

function less(a: Json | undefined, b: Json | undefined): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  if (typeof a === 'string' && typeof b === 'string') return compareCodePoints(a, b) < 0;
  return false;
}

function compare(op: string, a: Json | undefined, b: Json | undefined): boolean {
  switch (op) {
    case '==': return equal(a, b);
    case '!=': return !equal(a, b);
    case '<': return less(a, b);
    case '<=': return less(a, b) || equal(a, b);
    case '>': return less(b, a);
    default: return less(b, a) || equal(a, b);
  }
}

type Val = Json | undefined;

function argValue(a: Arg, root: Node, cur: Node): Val {
  if (a.a === 'lit') return a.v;
  if (a.a === 'q') {
    const nodes = evalQuery(a.q, root, cur);
    return nodes.length === 1 ? nodes[0].v : undefined;
  }
  return evalFn(a.f, root, cur);
}

function evalFn(f: Fn, root: Node, cur: Node): boolean | Val {
  const def = FUNCTIONS[f.name];
  const vals = f.args.map((a, i): Val | Node[] =>
    def.params[i] === 'n' ? evalQuery((a as { q: Query }).q, root, cur) : argValue(a, root, cur));
  switch (f.name) {
    case 'length': {
      const v = vals[0] as Val;
      if (typeof v === 'string') return Array.from(v).length;
      if (Array.isArray(v)) return v.length;
      if (isObject(v)) return Object.keys(v).length;
      return undefined;
    }
    case 'count':
      return (vals[0] as Node[]).length;
    case 'value': {
      const nodes = vals[0] as Node[];
      return nodes.length === 1 ? nodes[0].v : undefined;
    }
    default: {
      const [s, re] = vals as Val[];
      if (typeof s !== 'string' || typeof re !== 'string') return false;
      return f.name === 'match' ? iregexpMatch(s, re) : iregexpSearch(s, re);
    }
  }
}

function evalExpr(e: Expr, root: Node, cur: Node): boolean {
  switch (e.k) {
    case 'or': return e.l.some((x) => evalExpr(x, root, cur));
    case 'and': return e.l.every((x) => evalExpr(x, root, cur));
    case 'not': return !evalExpr(e.e, root, cur);
    case 'test': return evalQuery(e.q, root, cur).length > 0;
    case 'fn': return evalFn(e.f, root, cur) === true;
    case 'cmp': return compare(e.op, argValue(e.l, root, cur), argValue(e.r, root, cur));
  }
}

export function run(q: Query, document: Json): { values: Json[]; paths: string[] } {
  const root: Node = { v: document, parent: null, key: '' };
  const nodes = evalQuery(q, root, root);
  return { values: nodes.map((n) => n.v), paths: nodes.map(pathOf) };
}

export function query(src: string, document: Json): { values: Json[]; paths: string[] } {
  return run(parse(src), document);
}
