// JSONPath query syntax (RFC 9535, sections 2.1 to 2.4.3). parseQuery turns a
// query text into a tree and rejects anything that is not well-formed and valid:
// index and slice integers must be in the I-JSON range, and function calls must
// be well-typed. Nothing else can fail once a query has been parsed.

import { numberFrom } from './json.ts';
import type { Json } from './json.ts';

export class QueryError extends Error {}

export interface Query {
  root: boolean;
  segs: Segment[];
  singular: boolean;
}

export interface Segment {
  desc: boolean;
  sels: Selector[];
  singular: boolean;
}

export type Selector =
  | { k: 'name'; name: string }
  | { k: 'index'; i: number }
  | { k: 'slice'; start: number | null; end: number | null; step: number | null }
  | { k: 'wild' }
  | { k: 'filter'; e: Expr };

export type FnExpr = { k: 'fn'; name: string; args: Expr[]; rtype: 'value' | 'logical' };

export type Expr =
  | { k: 'lit'; v: Json }
  | { k: 'vq'; q: Query }
  | { k: 'query'; q: Query }
  | FnExpr
  | { k: 'cmp'; op: string; l: Expr; r: Expr }
  | { k: 'and'; l: Expr; r: Expr }
  | { k: 'or'; l: Expr; r: Expr }
  | { k: 'not'; e: Expr }
  | { k: 'paren'; e: Expr };

type Param = 'V' | 'N' | 'L';

// Function extensions (RFC 9535 Table 19): parameter types and result type.
const SIGS = new Map<string, { params: Param[]; result: 'value' | 'logical' }>([
  ['length', { params: ['V'], result: 'value' }],
  ['count', { params: ['N'], result: 'value' }],
  ['match', { params: ['V', 'V'], result: 'logical' }],
  ['search', { params: ['V', 'V'], result: 'logical' }],
  ['value', { params: ['N'], result: 'value' }],
]);

const MAX_INT = 9007199254740991n;
const WS = new Set([' ', '\t', '\n', '\r']);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function invalid(why: string): never {
  throw new QueryError(why);
}

function kindOf(e: Expr): 'value' | 'nodes' | 'logical' {
  if (e.k === 'lit' || e.k === 'vq') return 'value';
  if (e.k === 'query') return 'nodes';
  if (e.k === 'fn') return e.rtype === 'value' ? 'value' : 'logical';
  return 'logical';
}

// A test expression must not be ValueType (RFC 9535 section 2.4.3).
function asLogical(e: Expr): Expr {
  if (kindOf(e) === 'value') invalid('a value is used as a test');
  return e;
}

// Function arguments: ValueType takes literals, singular queries and ValueType
// calls; NodesType takes queries; LogicalType takes logical expressions and
// queries (existence tests) but not ValueType.
function adaptArg(e: Expr, p: Param): Expr {
  const kind = kindOf(e);
  if (p === 'V' && kind === 'value') return e;
  if (p === 'V' && e.k === 'query' && e.q.singular) return { k: 'vq', q: e.q };
  if (p === 'N' && e.k === 'query') return e;
  if (p === 'L' && (kind === 'logical' || e.k === 'query')) return e;
  return invalid('function argument is not well-typed');
}

function makeQuery(root: boolean, segs: Segment[]): Query {
  return { root, segs, singular: segs.every((s) => s.singular) };
}

function isNameFirst(c: string): boolean {
  if (c === '') return false;
  if (/^[A-Za-z_]$/.test(c)) return true;
  const cp = c.codePointAt(0) as number;
  return (cp >= 0x80 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0x10ffff);
}

function isNameChar(c: string): boolean {
  return isNameFirst(c) || /^[0-9]$/.test(c);
}

class Parser {
  cs: string[];
  i: number;

  constructor(text: string) {
    this.cs = Array.from(text);
    this.i = 0;
  }

  peek(k = 0): string {
    return this.cs[this.i + k] ?? '';
  }

  fail(): never {
    return invalid(`malformed query at ${this.i}`);
  }

  // Skips blank space; reports whether any was skipped.
  skipS(): boolean {
    let any = false;
    while (this.i < this.cs.length && WS.has(this.cs[this.i])) {
      this.i++;
      any = true;
    }
    return any;
  }

  segments(): Segment[] {
    const segs: Segment[] = [];
    for (;;) {
      const save = this.i;
      this.skipS();
      const c = this.peek();
      if (c !== '.' && c !== '[') {
        this.i = save;
        return segs;
      }
      segs.push(this.segment());
    }
  }

  segment(): Segment {
    if (this.peek() === '.' && this.peek(1) === '.') {
      this.i += 2;
      if (this.peek() === '[') return { desc: true, sels: this.bracketed().sels, singular: false };
      if (this.peek() === '*') {
        this.i++;
        return { desc: true, sels: [{ k: 'wild' }], singular: false };
      }
      return { desc: true, sels: [{ k: 'name', name: this.memberName() }], singular: false };
    }
    if (this.peek() === '.') {
      this.i++;
      if (this.peek() === '*') {
        this.i++;
        return { desc: false, sels: [{ k: 'wild' }], singular: false };
      }
      return { desc: false, sels: [{ k: 'name', name: this.memberName() }], singular: true };
    }
    const b = this.bracketed();
    const single = b.sels.length === 1 && (b.sels[0].k === 'name' || b.sels[0].k === 'index');
    return { desc: false, sels: b.sels, singular: b.tight && single };
  }

  // Returns the selectors; `tight` is true when the brackets hold no blank space.
  bracketed(): { sels: Selector[]; tight: boolean } {
    this.i++;
    const sels: Selector[] = [];
    let tight = true;
    for (;;) {
      if (this.skipS()) tight = false;
      sels.push(this.selector());
      if (this.skipS()) tight = false;
      const c = this.peek();
      if (c === ']') {
        this.i++;
        return { sels, tight };
      }
      if (c !== ',') this.fail();
      this.i++;
    }
  }

  selector(): Selector {
    const c = this.peek();
    if (c === "'" || c === '"') return { k: 'name', name: this.stringLiteral() };
    if (c === '*') {
      this.i++;
      return { k: 'wild' };
    }
    if (c === '?') {
      this.i++;
      this.skipS();
      return { k: 'filter', e: this.filterExpr() };
    }
    return this.indexOrSlice();
  }

  indexOrSlice(): Selector {
    const start = this.integer();
    const save = this.i;
    this.skipS();
    if (this.peek() !== ':') {
      if (start === null) this.fail();
      this.i = save;
      return { k: 'index', i: start };
    }
    this.i++;
    this.skipS();
    const end = this.integer();
    const save2 = this.i;
    this.skipS();
    let step: number | null = null;
    if (this.peek() === ':') {
      this.i++;
      this.skipS();
      step = this.integer();
    } else {
      this.i = save2;
    }
    return { k: 'slice', start, end, step };
  }

  // An integer in the I-JSON range, or null when no integer starts here.
  integer(): number | null {
    let s = '';
    while (/^[-0-9]$/.test(this.peek())) {
      s += this.peek();
      this.i++;
    }
    if (s === '') return null;
    if (!/^(0|-?[1-9][0-9]*)$/.test(s)) this.fail();
    const big = BigInt(s);
    if (big > MAX_INT || big < -MAX_INT) this.fail();
    return Number(big);
  }

  stringLiteral(): string {
    const quote = this.peek();
    this.i++;
    let out = '';
    for (;;) {
      const c = this.peek();
      if (c === '') this.fail();
      if (c === quote) {
        this.i++;
        return out;
      }
      if (c === '\\') {
        const e = this.peek(1);
        this.i += 2;
        switch (e) {
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case '/': case '\\': out += e; break;
          case 'u': out += this.unicodeEscape(); break;
          default:
            // Only the other kind of quote may follow a backslash as a plain escape.
            if (e === quote) out += e;
            else this.fail();
        }
        continue;
      }
      if ((c.codePointAt(0) as number) < 0x20) this.fail();
      out += c;
      this.i++;
    }
  }

  unicodeEscape(): string {
    const u = this.hex4();
    if (u >= 0xdc00 && u <= 0xdfff) this.fail();
    if (u < 0xd800 || u > 0xdbff) return String.fromCharCode(u);
    if (this.peek() !== '\\' || this.peek(1) !== 'u') this.fail();
    this.i += 2;
    const lo = this.hex4();
    if (lo < 0xdc00 || lo > 0xdfff) this.fail();
    return String.fromCharCode(u, lo);
  }

  hex4(): number {
    const h = this.cs.slice(this.i, this.i + 4).join('');
    if (!/^[0-9a-fA-F]{4}$/.test(h)) this.fail();
    this.i += 4;
    return parseInt(h, 16);
  }

  memberName(): string {
    if (!isNameFirst(this.peek())) this.fail();
    let s = '';
    while (isNameChar(this.peek())) {
      s += this.peek();
      this.i++;
    }
    return s;
  }

  word(w: string): boolean {
    if (this.cs.slice(this.i, this.i + w.length).join('') !== w) return false;
    this.i += w.length;
    return true;
  }

  // A literal at the current position, or undefined (consuming nothing).
  tryLiteral(): Json | undefined {
    const c = this.peek();
    if (c === "'" || c === '"') return this.stringLiteral();
    if (c === '-' || (c >= '0' && c <= '9')) return this.numberLiteral();
    if (this.word('true')) return true;
    if (this.word('false')) return false;
    if (this.word('null')) return null;
    return undefined;
  }

  numberLiteral(): Json {
    let s = '';
    while (/^[-+.0-9eE]$/.test(this.peek())) {
      s += this.peek();
      this.i++;
    }
    const n = numberFrom(s);
    if (n === null) this.fail();
    return n;
  }

  filterExpr(): Expr {
    return asLogical(this.logicalOr());
  }

  logicalOr(): Expr {
    let e = this.logicalAnd();
    for (;;) {
      const save = this.i;
      this.skipS();
      if (this.peek() !== '|' || this.peek(1) !== '|') {
        this.i = save;
        return e;
      }
      this.i += 2;
      this.skipS();
      const l = asLogical(e);
      e = { k: 'or', l, r: asLogical(this.logicalAnd()) };
    }
  }

  logicalAnd(): Expr {
    let e = this.basic();
    for (;;) {
      const save = this.i;
      this.skipS();
      if (this.peek() !== '&' || this.peek(1) !== '&') {
        this.i = save;
        return e;
      }
      this.i += 2;
      this.skipS();
      const l = asLogical(e);
      e = { k: 'and', l, r: asLogical(this.basic()) };
    }
  }

  basic(): Expr {
    const c = this.peek();
    if (c === '(') return this.paren();
    if (c === '!') {
      this.i++;
      this.skipS();
      if (this.peek() === '(') return { k: 'not', e: this.paren() };
      return { k: 'not', e: asLogical(this.testOperand()) };
    }
    const left = this.operand();
    const save = this.i;
    this.skipS();
    const op = this.cmpOp();
    if (op === null) {
      this.i = save;
      if (left.k === 'lit') this.fail();
      return left;
    }
    const l = this.toValue(left);
    this.skipS();
    return { k: 'cmp', op, l, r: this.toValue(this.operand()) };
  }

  paren(): Expr {
    this.i++;
    this.skipS();
    const e = this.logicalOr();
    this.skipS();
    if (this.peek() !== ')') this.fail();
    this.i++;
    return { k: 'paren', e: asLogical(e) };
  }

  // A comparable or a test: literal, query or function call.
  operand(): Expr {
    const c = this.peek();
    if (c === '@' || c === '$') return { k: 'query', q: this.filterQuery() };
    const v = this.tryLiteral();
    if (v !== undefined) return { k: 'lit', v };
    if (c >= 'a' && c <= 'z') return this.functionCall();
    return this.fail();
  }

  // The operand of a negated test: a query or a function call, never a literal.
  testOperand(): Expr {
    const c = this.peek();
    if (c === '@' || c === '$') return { k: 'query', q: this.filterQuery() };
    if (c >= 'a' && c <= 'z') return this.functionCall();
    return this.fail();
  }

  cmpOp(): string | null {
    for (const op of ['==', '!=', '<=', '>=', '<', '>']) {
      if (this.cs[this.i] === op[0] && (op.length === 1 || this.cs[this.i + 1] === op[1])) {
        this.i += op.length;
        return op;
      }
    }
    return null;
  }

  // Comparisons take singular queries and ValueType calls only.
  toValue(e: Expr): Expr {
    if (e.k === 'query') {
      if (!e.q.singular) this.fail();
      return { k: 'vq', q: e.q };
    }
    if (kindOf(e) !== 'value') this.fail();
    return e;
  }

  filterQuery(): Query {
    const root = this.peek() === '$';
    this.i++;
    return makeQuery(root, this.segments());
  }

  functionCall(): Expr {
    const start = this.i;
    while (/^[a-z0-9_]$/.test(this.peek())) this.i++;
    const name = this.cs.slice(start, this.i).join('');
    const sig = SIGS.get(name);
    if (sig === undefined || this.peek() !== '(') this.fail();
    this.i++;
    const args: Expr[] = [];
    this.skipS();
    if (this.peek() !== ')') {
      for (;;) {
        if (args.length === sig.params.length) this.fail();
        const p = sig.params[args.length];
        args.push(adaptArg(this.argument(), p));
        this.skipS();
        if (this.peek() !== ',') break;
        this.i++;
        this.skipS();
      }
    }
    this.skipS();
    if (this.peek() !== ')') this.fail();
    this.i++;
    if (args.length !== sig.params.length) this.fail();
    return { k: 'fn', name, args, rtype: sig.result };
  }

  argument(): Expr {
    const save = this.i;
    const v = this.tryLiteral();
    if (v !== undefined) {
      this.skipS();
      if (this.peek() === ',' || this.peek() === ')') return { k: 'lit', v };
    }
    this.i = save;
    return this.logicalOr();
  }

}

// Parses a JSONPath query. Throws QueryError when it is not well-formed and valid.
export function parseQuery(text: string): Query {
  if (LONE_SURROGATE.test(text)) invalid('query contains a lone surrogate');
  const p = new Parser(text);
  if (p.peek() !== '$') p.fail();
  p.i++;
  const segs = p.segments();
  if (p.i !== p.cs.length) p.fail();
  return makeQuery(true, segs);
}
