// Parser and static checks for JSONPath queries: syntax (R2-R17, Appendix A),
// integer range (R12), function arity and well-typedness (R20, R21).
// Any violation throws QueryError, which the protocol reports as invalid_query.

import type { JVal } from './json.ts';
import { JNum } from './json.ts';

export class QueryError extends Error {}

export type Selector =
  | { k: 'name'; name: string }
  | { k: 'wild' }
  | { k: 'index'; i: number }
  | { k: 'slice'; start: number | null; end: number | null; step: number | null }
  | { k: 'filter'; e: Expr };

export interface Segment {
  desc: boolean;
  sels: Selector[];
  blank: boolean; // blank space occurred inside its brackets
}

export interface Query {
  root: '$' | '@';
  segs: Segment[];
  singular: boolean;
}

export type Expr =
  | { k: 'lit'; v: JVal }
  | { k: 'query'; q: Query }
  | { k: 'fn'; name: string; args: Expr[] }
  | { k: 'cmp'; op: string; l: Expr; r: Expr }
  | { k: 'and'; l: Expr; r: Expr }
  | { k: 'or'; l: Expr; r: Expr }
  | { k: 'not'; e: Expr }
  | { k: 'group'; e: Expr };

type Ty = 'value' | 'logical' | 'nodes';

interface FnSpec {
  params: Ty[];
  result: Ty;
}

const FUNCS = new Map<string, FnSpec>([
  ['length', { params: ['value'], result: 'value' }],
  ['count', { params: ['nodes'], result: 'value' }],
  ['match', { params: ['value', 'value'], result: 'logical' }],
  ['search', { params: ['value', 'value'], result: 'logical' }],
  ['value', { params: ['nodes'], result: 'value' }],
]);

const MAX_INT = 9007199254740991n;

const isBlank = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9' && c.length === 1;
const isLower = (c: string | undefined): boolean => c !== undefined && c >= 'a' && c <= 'z' && c.length === 1;
const isNameFirst = (c: string | undefined): boolean => {
  if (c === undefined) return false;
  const cp = c.codePointAt(0) as number;
  return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || cp === 0x5f || cp >= 0x80;
};
const isNameChar = (c: string | undefined): boolean => isNameFirst(c) || isDigit(c);
const isFnChar = (c: string | undefined): boolean => isLower(c) || isDigit(c) || c === '_';
const isIntStart = (c: string | undefined): boolean => c === '-' || isDigit(c);

// Parses a query given as an array of characters (code points).
class Parser {
  cs: string[];
  i = 0;

  constructor(cs: string[]) {
    this.cs = cs;
  }

  fail(): never {
    throw new QueryError(`invalid query at character ${this.i}`);
  }

  // Skips blank space; reports whether any was skipped.
  skip(): boolean {
    const start = this.i;
    while (isBlank(this.cs[this.i])) this.i++;
    return this.i > start;
  }

  top(): Query {
    if (this.cs[0] !== '$') this.fail();
    this.i = 1;
    const segs = this.segments();
    if (this.i !== this.cs.length) this.fail();
    return mkQuery('$', segs);
  }

  // segments = *(S segment); blank space that is not followed by a segment is given back.
  segments(): Segment[] {
    const segs: Segment[] = [];
    for (;;) {
      const save = this.i;
      this.skip();
      const c = this.cs[this.i];
      if (c !== '[' && c !== '.') {
        this.i = save;
        return segs;
      }
      segs.push(this.segment());
    }
  }

  segment(): Segment {
    if (this.cs[this.i] === '[') {
      const b = this.bracketed();
      return { desc: false, sels: b.sels, blank: b.blank };
    }
    this.i++;
    if (this.cs[this.i] === '.') {
      this.i++;
      if (this.cs[this.i] === '[') {
        const b = this.bracketed();
        return { desc: true, sels: b.sels, blank: b.blank };
      }
      return { desc: true, sels: [this.dotSelector()], blank: false };
    }
    return { desc: false, sels: [this.dotSelector()], blank: false };
  }

  // The selector after `.` or `..`: `*` or a member-name shorthand.
  dotSelector(): Selector {
    const c = this.cs[this.i];
    if (c === '*') {
      this.i++;
      return { k: 'wild' };
    }
    if (!isNameFirst(c)) this.fail();
    let name = '';
    while (isNameChar(this.cs[this.i])) name += this.cs[this.i++];
    return { k: 'name', name };
  }

  bracketed(): { sels: Selector[]; blank: boolean } {
    this.i++;
    let blank = this.skip();
    const sels: Selector[] = [this.selector()];
    for (;;) {
      if (this.skip()) blank = true;
      if (this.cs[this.i] !== ',') break;
      this.i++;
      if (this.skip()) blank = true;
      sels.push(this.selector());
    }
    if (this.cs[this.i] !== ']') this.fail();
    this.i++;
    return { sels, blank };
  }

  selector(): Selector {
    const c = this.cs[this.i];
    if (c === "'" || c === '"') return { k: 'name', name: this.str(c) };
    if (c === '*') {
      this.i++;
      return { k: 'wild' };
    }
    if (c === '?') {
      this.i++;
      this.skip();
      return { k: 'filter', e: this.logicalOr() };
    }
    return this.indexOrSlice();
  }

  indexOrSlice(): Selector {
    let start: number | null = null;
    if (this.cs[this.i] !== ':') start = this.int();
    const save = this.i;
    this.skip();
    if (this.cs[this.i] !== ':') {
      if (start === null) this.fail();
      this.i = save;
      return { k: 'index', i: start };
    }
    this.i++;
    this.skip();
    let end: number | null = null;
    if (isIntStart(this.cs[this.i])) end = this.int();
    const save2 = this.i;
    this.skip();
    let step: number | null = null;
    if (this.cs[this.i] === ':') {
      this.i++;
      this.skip();
      if (isIntStart(this.cs[this.i])) step = this.int();
    } else {
      this.i = save2;
    }
    return { k: 'slice', start, end, step };
  }

  // int = "0" / (["-"] DIGIT1 *DIGIT), within the range of R12.
  int(): number {
    let neg = false;
    if (this.cs[this.i] === '-') {
      neg = true;
      this.i++;
    }
    if (!isDigit(this.cs[this.i])) this.fail();
    let digits = '';
    while (isDigit(this.cs[this.i])) digits += this.cs[this.i++];
    if (digits.length > 1 && digits[0] === '0') this.fail();
    if (neg && digits === '0') this.fail();
    const v = BigInt((neg ? '-' : '') + digits);
    if (v > MAX_INT || v < -MAX_INT) this.fail();
    return Number(v);
  }

  // A string literal (R7) delimited by q; returns its value.
  str(q: string): string {
    this.i++;
    let out = '';
    for (;;) {
      const c = this.cs[this.i];
      if (c === undefined) this.fail();
      if (c === q) {
        this.i++;
        return out;
      }
      if (c === '\\') {
        out += this.escape(q);
        continue;
      }
      if ((c.codePointAt(0) as number) < 0x20) this.fail();
      out += c;
      this.i++;
    }
  }

  escape(q: string): string {
    const e = this.cs[this.i + 1];
    this.i += 2;
    switch (e) {
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '/':
      case '\\':
        return e;
      case '"':
      case "'":
        if (e === q) return e;
        return this.fail();
      case 'u':
        return this.unicodeEscape();
      default:
        return this.fail();
    }
  }

  unicodeEscape(): string {
    const cp = this.hex4();
    if (cp >= 0xd800 && cp <= 0xdbff) {
      if (this.cs[this.i] !== '\\' || this.cs[this.i + 1] !== 'u') this.fail();
      this.i += 2;
      const lo = this.hex4();
      if (lo < 0xdc00 || lo > 0xdfff) this.fail();
      return String.fromCodePoint(0x10000 + (cp - 0xd800) * 0x400 + (lo - 0xdc00));
    }
    if (cp >= 0xdc00 && cp <= 0xdfff) this.fail();
    return String.fromCodePoint(cp);
  }

  hex4(): number {
    let v = 0;
    for (let k = 0; k < 4; k++) {
      const h = this.cs[this.i];
      if (h === undefined || !/^[0-9a-fA-F]$/.test(h)) this.fail();
      v = v * 16 + parseInt(h, 16);
      this.i++;
    }
    return v;
  }

  // Filter expressions (R13).
  logicalOr(): Expr {
    let e = this.logicalAnd();
    for (;;) {
      const save = this.i;
      this.skip();
      if (this.cs[this.i] !== '|' || this.cs[this.i + 1] !== '|') {
        this.i = save;
        return e;
      }
      this.i += 2;
      this.skip();
      e = { k: 'or', l: e, r: this.logicalAnd() };
    }
  }

  logicalAnd(): Expr {
    let e = this.basic();
    for (;;) {
      const save = this.i;
      this.skip();
      if (this.cs[this.i] !== '&' || this.cs[this.i + 1] !== '&') {
        this.i = save;
        return e;
      }
      this.i += 2;
      this.skip();
      e = { k: 'and', l: e, r: this.basic() };
    }
  }

  basic(): Expr {
    this.skip();
    if (this.cs[this.i] === '!') {
      this.i++;
      this.skip();
      if (this.cs[this.i] === '(') return { k: 'not', e: this.paren() };
      return { k: 'not', e: this.primary() };
    }
    if (this.cs[this.i] === '(') return this.paren();
    const left = this.primary();
    const save = this.i;
    this.skip();
    const op = this.cmpOp();
    if (op === null) {
      this.i = save;
      return left;
    }
    this.i += op.length;
    this.skip();
    return { k: 'cmp', op, l: left, r: this.primary() };
  }

  paren(): Expr {
    this.i++;
    this.skip();
    const e = this.logicalOr();
    this.skip();
    if (this.cs[this.i] !== ')') this.fail();
    this.i++;
    return { k: 'group', e };
  }

  cmpOp(): string | null {
    const a = this.cs[this.i];
    const b = this.cs[this.i + 1];
    if (a === '=' && b === '=') return '==';
    if (a === '!' && b === '=') return '!=';
    if (a === '<') return b === '=' ? '<=' : '<';
    if (a === '>') return b === '=' ? '>=' : '>';
    return null;
  }

  // A literal, a query, or a function call.
  primary(): Expr {
    const c = this.cs[this.i];
    if (c === '$' || c === '@') {
      const root = c === '@' ? '@' : '$';
      this.i++;
      return { k: 'query', q: mkQuery(root, this.segments()) };
    }
    if (c === "'" || c === '"') return { k: 'lit', v: this.str(c) };
    if (c === '-' || isDigit(c)) return { k: 'lit', v: this.number() };
    if (isLower(c)) {
      let word = '';
      while (isFnChar(this.cs[this.i])) word += this.cs[this.i++];
      if (this.cs[this.i] === '(') return this.call(word);
      if (word === 'true') return { k: 'lit', v: true };
      if (word === 'false') return { k: 'lit', v: false };
      if (word === 'null') return { k: 'lit', v: null };
    }
    return this.fail();
  }

  // number = (int / "-0") [frac] [exp]; not range-checked (R16.3).
  number(): JNum {
    const start = this.i;
    if (this.cs[this.i] === '-') this.i++;
    if (this.cs[this.i] === '0') {
      this.i++;
    } else if (isDigit(this.cs[this.i]) && this.cs[this.i] !== '0') {
      this.digits();
    } else {
      this.fail();
    }
    if (this.cs[this.i] === '.') {
      this.i++;
      if (!isDigit(this.cs[this.i])) this.fail();
      this.digits();
    }
    if (this.cs[this.i] === 'e' || this.cs[this.i] === 'E') {
      this.i++;
      if (this.cs[this.i] === '+' || this.cs[this.i] === '-') this.i++;
      if (!isDigit(this.cs[this.i])) this.fail();
      this.digits();
    }
    const text = this.cs.slice(start, this.i).join('');
    return new JNum(text, Number(text));
  }

  digits(): void {
    while (isDigit(this.cs[this.i])) this.i++;
  }

  // A function call; the name has been read and the next character is "(".
  call(name: string): Expr {
    this.i++;
    const args: Expr[] = [];
    this.skip();
    if (this.cs[this.i] === ')') {
      this.i++;
    } else {
      for (;;) {
        args.push(this.logicalOr());
        this.skip();
        if (this.cs[this.i] === ',') {
          this.i++;
          this.skip();
        } else if (this.cs[this.i] === ')') {
          this.i++;
          break;
        } else {
          this.fail();
        }
      }
    }
    const spec = FUNCS.get(name);
    if (spec === undefined || spec.params.length !== args.length) this.fail();
    return { k: 'fn', name, args };
  }
}

function mkQuery(root: '$' | '@', segs: Segment[]): Query {
  const singular = segs.every(
    (s) => !s.desc && !s.blank && s.sels.length === 1 && (s.sels[0].k === 'name' || s.sels[0].k === 'index'),
  );
  return { root, segs, singular };
}

// Parses and statically checks a query string. Throws QueryError when it is not valid.
export function parseQuery(text: string): Query {
  const cs = Array.from(text);
  for (const c of cs) {
    const u = c.charCodeAt(0);
    if (c.length === 1 && u >= 0xd800 && u <= 0xdfff) throw new QueryError('lone surrogate');
  }
  const q = new Parser(cs).top();
  checkQuery(q);
  return q;
}

// ---- static checks (R17, R20, R21) ----

function checkQuery(q: Query): void {
  for (const seg of q.segs) {
    for (const sel of seg.sels) {
      if (sel.k === 'filter') checkTest(sel.e);
    }
  }
}

function fail(): never {
  throw new QueryError('ill-typed query');
}

// An expression used as a logical expression (test context).
function checkTest(e: Expr): void {
  switch (e.k) {
    case 'lit':
      fail();
      break;
    case 'query':
      checkQuery(e.q);
      break;
    case 'fn':
      if (FUNCS.get(e.name)?.result !== 'logical') fail();
      checkCall(e.name, e.args);
      break;
    case 'cmp':
      checkComparable(e.l);
      checkComparable(e.r);
      break;
    case 'and':
    case 'or':
      checkTest(e.l);
      checkTest(e.r);
      break;
    case 'not':
    case 'group':
      checkTest(e.e);
      break;
  }
}

// A comparable: a literal, a singular query, or a function with a ValueType result.
// The same rule applies to a ValueType parameter.
function checkComparable(e: Expr): void {
  switch (e.k) {
    case 'lit':
      break;
    case 'query':
      if (!e.q.singular) fail();
      checkQuery(e.q);
      break;
    case 'fn':
      if (FUNCS.get(e.name)?.result !== 'value') fail();
      checkCall(e.name, e.args);
      break;
    default:
      fail();
  }
}

function checkCall(name: string, args: Expr[]): void {
  const spec = FUNCS.get(name);
  if (spec === undefined) fail();
  args.forEach((arg, k) => {
    const ty = spec.params[k];
    if (ty === 'value') {
      checkComparable(arg);
    } else if (ty === 'nodes') {
      if (arg.k !== 'query') fail();
      checkQuery(arg.q);
    } else {
      fail();
    }
  });
}
