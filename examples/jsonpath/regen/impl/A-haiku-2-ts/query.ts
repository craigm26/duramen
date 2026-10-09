// JSONPath query syntax (RFC 9535 Sections 2.1 to 2.5 and Appendix A). A query
// is parsed into a small tree. Every filter's function expressions are checked
// for well-typedness (Section 2.4.3) here, so any rejection is an InvalidQuery
// and nothing is left to find during evaluation.

export class InvalidQuery extends Error {}

// The three declared types of Table 13.
export type Kind = 'value' | 'logical' | 'nodes';
export type Expr = { k: string; [key: string]: any };
export type Sel =
  | { k: 'name'; name: string }
  | { k: 'wild' }
  | { k: 'index'; i: number }
  | { k: 'slice'; s: number | null; e: number | null; st: number | null }
  | { k: 'filter'; expr: Expr };
export interface Seg {
  desc: boolean;
  sels: Sel[];
  // False when the segment is bracketed with white space inside, which the
  // grammar does not allow in a singular query.
  plain: boolean;
}
export interface Query {
  abs: boolean;
  segs: Seg[];
}

// The initial Function Extensions subregistry (Table 19).
export const FUNCTIONS = new Map<string, { params: Kind[]; result: Kind }>([
  ['length', { params: ['value'], result: 'value' }],
  ['count', { params: ['nodes'], result: 'value' }],
  ['match', { params: ['value', 'value'], result: 'logical' }],
  ['search', { params: ['value', 'value'], result: 'logical' }],
  ['value', { params: ['nodes'], result: 'value' }],
]);

const MAX_EXACT = 2 ** 53 - 1;
const WS = new Set([' ', '\t', '\n', '\r']);
const SIMPLE_ESC: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const DIGIT = /^[0-9]$/;
const LOWER = /^[a-z]$/;
const FN_CHAR = /^[a-z_0-9]$/;
const HEX4 = /^[0-9A-Fa-f]{4}$/;
const NAME_FIRST = /^[A-Za-z_]$/;
const COMPARISONS = ['==', '!=', '<=', '>=', '<', '>'];

const invalid = (why: string): never => {
  throw new InvalidQuery(why);
};
const ok = (cond: boolean, why: string): void => {
  if (!cond) invalid(why);
};
const isDigit = (c?: string): boolean => c !== undefined && DIGIT.test(c);
const isIntStart = (c?: string): boolean => c === '-' || isDigit(c);
// name-first and name-char of member-name-shorthand (Section 2.5.1.1).
const nameFirst = (c?: string): boolean => {
  if (c === undefined) return false;
  const cp = c.codePointAt(0)!;
  return NAME_FIRST.test(c) || (cp >= 0x80 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0x10ffff);
};
const nameChar = (c?: string): boolean => nameFirst(c) || isDigit(c);

class Parser {
  private s: string[];
  private i = 0;

  constructor(s: string[]) {
    this.s = s;
  }

  done(): boolean {
    return this.i === this.s.length;
  }

  private fail(): never {
    return invalid(`not a well-formed query at ${this.i}`);
  }

  // White space (Section 2.1.1, B); returns whether any was consumed.
  private ws(): boolean {
    const start = this.i;
    while (this.i < this.s.length && WS.has(this.s[this.i])) this.i++;
    return this.i > start;
  }

  private at(t: string): boolean {
    return this.s.slice(this.i, this.i + t.length).join('') === t;
  }

  // Consumes a token, with white space before and after it, if it is next.
  private tok(t: string): boolean {
    const save = this.i;
    this.ws();
    if (!this.at(t)) {
      this.i = save;
      return false;
    }
    this.i += t.length;
    this.ws();
    return true;
  }

  // Consumes a token with white space before it (not after it).
  private need(t: string): void {
    this.ws();
    if (!this.at(t)) this.fail();
    this.i += t.length;
  }

  query(): Query {
    const abs = this.s[this.i] === '$';
    this.i++;
    return { abs, segs: this.segments() };
  }

  // segments = *(S segment). White space is consumed only before a segment.
  private segments(): Seg[] {
    const segs: Seg[] = [];
    for (;;) {
      const save = this.i;
      this.ws();
      const c = this.s[this.i];
      if (c !== '.' && c !== '[') {
        this.i = save;
        return segs;
      }
      segs.push(this.segment());
    }
  }

  private segment(): Seg {
    if (this.at('..')) {
      this.i += 2;
      if (this.s[this.i] === '[') {
        const b = this.bracketed();
        return { desc: true, sels: b.sels, plain: b.plain };
      }
      return { desc: true, sels: [this.dotSelector()], plain: true };
    }
    if (this.s[this.i] === '.') {
      this.i++;
      return { desc: false, sels: [this.dotSelector()], plain: true };
    }
    const b = this.bracketed();
    return { desc: false, sels: b.sels, plain: b.plain };
  }

  private dotSelector(): Sel {
    if (this.s[this.i] === '*') {
      this.i++;
      return { k: 'wild' };
    }
    return { k: 'name', name: this.memberName() };
  }

  private memberName(): string {
    if (!nameFirst(this.s[this.i])) this.fail();
    let name = '';
    while (nameChar(this.s[this.i])) name += this.s[this.i++];
    return name;
  }

  // bracketed-selection = "[" S selector *(S "," S selector) S "]"
  private bracketed(): { sels: Sel[]; plain: boolean } {
    if (this.s[this.i] !== '[') this.fail();
    this.i++;
    const sels: Sel[] = [];
    let plain = true;
    for (;;) {
      if (this.ws()) plain = false;
      sels.push(this.selector());
      if (this.ws()) plain = false;
      if (this.s[this.i] !== ',') break;
      this.i++;
      plain = false;
    }
    this.need(']');
    return { sels, plain };
  }

  private selector(): Sel {
    const c = this.s[this.i];
    if (c === "'" || c === '"') return { k: 'name', name: this.str() };
    if (c === '*') {
      this.i++;
      return { k: 'wild' };
    }
    if (c === '?') {
      this.i++;
      this.ws();
      const expr = this.logicalOr();
      checkType(expr, 'logical');
      return { k: 'filter', expr };
    }
    if (c === ':' || isIntStart(c)) return this.indexOrSlice();
    return this.fail();
  }

  private indexOrSlice(): Sel {
    const start = this.s[this.i] === ':' ? null : this.int();
    const save = this.i;
    this.ws();
    if (this.s[this.i] !== ':') {
      this.i = save;
      return { k: 'index', i: start as number };
    }
    this.i++;
    this.ws();
    const end = isIntStart(this.s[this.i]) ? this.int() : null;
    this.ws();
    let step: number | null = null;
    if (this.s[this.i] === ':') {
      this.i++;
      this.ws();
      if (isIntStart(this.s[this.i])) step = this.int();
    }
    return { k: 'slice', s: start, e: end, st: step };
  }

  // int = "0" / (["-"] DIGIT1 *DIGIT), within the I-JSON range (Section 2.1).
  private int(): number {
    const neg = this.s[this.i] === '-';
    if (neg) this.i++;
    const c = this.s[this.i];
    if (!isDigit(c)) this.fail();
    let digits = '';
    if (c === '0') {
      if (neg) this.fail();
      digits = '0';
      this.i++;
    } else {
      while (isDigit(this.s[this.i])) digits += this.s[this.i++];
    }
    const n = Number(digits) * (neg ? -1 : 1);
    if (Math.abs(n) > MAX_EXACT) invalid('integer outside the I-JSON range');
    return n;
  }

  // string-literal: either quote style, with the escapes of Section 2.3.1.1.
  private str(): string {
    const quote = this.s[this.i++];
    let out = '';
    for (;;) {
      const c = this.s[this.i];
      if (c === undefined) this.fail();
      if (c === quote) {
        this.i++;
        return out;
      }
      if (c === '\\') {
        out += this.escape(quote);
        continue;
      }
      if (c.codePointAt(0)! < 0x20) this.fail();
      out += c;
      this.i++;
    }
  }

  private escape(quote: string): string {
    const d = this.s[this.i + 1];
    if (d === quote || d === '\\' || d === '/') {
      this.i += 2;
      return d;
    }
    if (d !== undefined && Object.hasOwn(SIMPLE_ESC, d)) {
      this.i += 2;
      return SIMPLE_ESC[d];
    }
    if (d !== 'u') this.fail();
    const hi = this.hex4(this.i + 2);
    this.i += 6;
    if (hi < 0xd800 || hi > 0xdfff) return String.fromCharCode(hi);
    // A high surrogate must be followed by an escaped low surrogate.
    if (hi >= 0xdc00 || this.s[this.i] !== '\\' || this.s[this.i + 1] !== 'u') this.fail();
    const lo = this.hex4(this.i + 2);
    if (lo < 0xdc00 || lo > 0xdfff) this.fail();
    this.i += 6;
    return String.fromCharCode(hi, lo);
  }

  private hex4(at: number): number {
    const h = this.s.slice(at, at + 4).join('');
    if (!HEX4.test(h)) this.fail();
    return parseInt(h, 16);
  }

  // logical-expr: || binds less tightly than &&, which binds less than the rest.
  private logicalOr(): Expr {
    const items = [this.logicalAnd()];
    while (this.tok('||')) items.push(this.logicalAnd());
    return items.length === 1 ? items[0] : { k: 'or', items };
  }

  private logicalAnd(): Expr {
    const items = [this.basic()];
    while (this.tok('&&')) items.push(this.basic());
    return items.length === 1 ? items[0] : { k: 'and', items };
  }

  // basic-expr: a parenthesized expression, a comparison, or a test.
  private basic(): Expr {
    let neg = false;
    if (this.s[this.i] === '!') {
      this.i++;
      this.ws();
      neg = true;
    }
    if (this.s[this.i] === '(') {
      this.i++;
      this.ws();
      const e = this.logicalOr();
      this.need(')');
      return neg ? { k: 'not', e } : e;
    }
    const left = this.operand();
    if (!neg) {
      const op = this.comparison();
      if (op !== null) return { k: 'cmp', op, l: left, r: this.operand() };
    }
    if (left.k === 'lit') this.fail(); // a bare literal is not a test
    return neg ? { k: 'not', e: left } : left;
  }

  private comparison(): string | null {
    for (const op of COMPARISONS) if (this.tok(op)) return op;
    return null;
  }

  // comparable or filter-query or function-expr.
  private operand(): Expr {
    const c = this.s[this.i];
    if (c === '@' || c === '$') return { k: 'q', q: this.query() };
    if (this.at('true') || this.at('false') || this.at('null')) return this.literal();
    if (LOWER.test(c ?? '')) return this.funcCall();
    return this.literal();
  }

  private literalStart(): boolean {
    const c = this.s[this.i];
    return c === "'" || c === '"' || isDigit(c) || c === '-' || this.at('true') || this.at('false') || this.at('null');
  }

  private literal(): Expr {
    const c = this.s[this.i];
    if (c === "'" || c === '"') return { k: 'lit', v: this.str() };
    if (this.at('true')) {
      this.i += 4;
      return { k: 'lit', v: true };
    }
    if (this.at('false')) {
      this.i += 5;
      return { k: 'lit', v: false };
    }
    if (this.at('null')) {
      this.i += 4;
      return { k: 'lit', v: null };
    }
    return { k: 'lit', v: this.number() };
  }

  // number = (int / "-0") [ frac ] [ exp ]
  private number(): number {
    const s = this.s;
    let j = this.i;
    if (s[j] === '-') j++;
    if (s[j] === '0') {
      j++;
    } else {
      if (!isDigit(s[j])) this.fail();
      while (isDigit(s[j])) j++;
    }
    if (s[j] === '.') {
      j++;
      if (!isDigit(s[j])) this.fail();
      while (isDigit(s[j])) j++;
    }
    if (s[j] === 'e' || s[j] === 'E') {
      j++;
      if (s[j] === '+' || s[j] === '-') j++;
      if (!isDigit(s[j])) this.fail();
      while (isDigit(s[j])) j++;
    }
    const text = s.slice(this.i, j).join('');
    this.i = j;
    return Number(text);
  }

  private funcCall(): Expr {
    let name = '';
    while (FN_CHAR.test(this.s[this.i] ?? '')) name += this.s[this.i++];
    if (this.s[this.i] !== '(') this.fail();
    this.i++;
    this.ws();
    const args: Expr[] = [];
    if (!this.tok(')')) {
      do {
        args.push(this.argument());
      } while (this.tok(','));
      this.need(')');
    }
    return { k: 'fn', name, args };
  }

  // A function argument may be a bare literal only when it is the whole argument.
  private argument(): Expr {
    const save = this.i;
    if (this.literalStart()) {
      const lit = this.literal();
      const end = this.i;
      this.ws();
      if (this.s[this.i] === ',' || this.s[this.i] === ')') {
        this.i = end;
        return lit;
      }
      this.i = save;
    }
    return this.logicalOr();
  }
}

// The declared result type of an expression, checked against where it appears.
function checkType(e: Expr, want: Kind): void {
  if (e.k === 'lit') return ok(want === 'value', 'a literal is not a logical or nodes argument');
  if (e.k === 'q') return ok(want !== 'value' || singular(e.q), 'a non-singular query where a value is needed');
  if (e.k === 'cmp') {
    ok(want === 'logical', 'a comparison where a value is needed');
    checkType(e.l, 'value');
    return checkType(e.r, 'value');
  }
  if (e.k === 'and' || e.k === 'or') {
    ok(want === 'logical', 'a logical operator where a value is needed');
    return e.items.forEach((x: Expr) => checkType(x, 'logical'));
  }
  if (e.k === 'not') {
    ok(want === 'logical', 'a negation where a value is needed');
    return checkType(e.e, 'logical');
  }
  const f = FUNCTIONS.get(e.name);
  ok(f !== undefined, `unknown function ${e.name}()`);
  ok(
    want === 'logical' ? f!.result !== 'value' : f!.result === want,
    `${e.name}() does not return ${want}`,
  );
  ok(e.args.length === f!.params.length, `${e.name}() takes ${f!.params.length} argument(s)`);
  e.args.forEach((a: Expr, n: number) => checkType(a, f!.params[n]));
}

// A singular query (Section 2.3.5.1): plain name and index segments only.
function singular(q: Query): boolean {
  return q.segs.every(
    (g) => !g.desc && g.plain && g.sels.length === 1 && (g.sels[0].k === 'name' || g.sels[0].k === 'index'),
  );
}

// Parses a whole query. Throws InvalidQuery unless it is well-formed and valid.
export function compileQuery(text: string): Query {
  const s = [...text];
  if (s.some((c) => c.length === 1 && c >= '\uD800' && c <= '\uDFFF')) {
    invalid('a query is a sequence of Unicode scalar values');
  }
  if (s[0] !== '$') invalid('a query starts with $');
  const p = new Parser(s);
  const q = p.query();
  if (!p.done()) invalid('unexpected text after the query');
  return q;
}
