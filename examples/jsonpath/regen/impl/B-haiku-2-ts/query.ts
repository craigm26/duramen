// JSONPath query text: parsing (SPEC R2-R20 and Appendix A/B) and static checks (R17, R21).
// Every query that is not well formed and valid is reported as InvalidQuery.

import { JsonNumber } from './json.ts';
import type { Json } from './json.ts';

export class InvalidQuery extends Error {}

export type CompareOp = '==' | '!=' | '<=' | '>=' | '<' | '>';
export type Type = 'value' | 'logical' | 'nodes';

export type Operand =
  | { kind: 'literal'; value: Json }
  | { kind: 'query'; query: Query }
  | { kind: 'call'; name: string; args: Expr[] };

export type Expr =
  | { kind: 'or'; left: Expr; right: Expr }
  | { kind: 'and'; left: Expr; right: Expr }
  | { kind: 'not'; expr: Expr }
  | { kind: 'group'; expr: Expr }
  | { kind: 'compare'; op: CompareOp; left: Operand; right: Operand }
  | { kind: 'operand'; operand: Operand };

export type Selector =
  | { kind: 'name'; name: string }
  | { kind: 'wildcard' }
  | { kind: 'index'; index: number }
  | { kind: 'slice'; start: number | null; end: number | null; step: number | null }
  | { kind: 'filter'; expr: Expr };

export interface Segment {
  descendant: boolean;
  selectors: Selector[];
}

export interface Query {
  root: '$' | '@';
  segments: Segment[];
  singular: boolean;
}

// SPEC R12: the largest integer an index or slice may use.
const MAX_INT = 9007199254740991;
const BLANK = new Set([' ', '\t', '\n', '\r']);
const SIMPLE_ESCAPES = new Map([
  ['b', '\b'],
  ['f', '\f'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
  ['/', '/'],
  ['\\', '\\'],
]);

// SPEC R21.2: the five functions, with their parameter and result types.
export const SIGNATURES = new Map<string, { params: Type[]; result: Type }>([
  ['length', { params: ['value'], result: 'value' }],
  ['count', { params: ['nodes'], result: 'value' }],
  ['match', { params: ['value', 'value'], result: 'logical' }],
  ['search', { params: ['value', 'value'], result: 'logical' }],
  ['value', { params: ['nodes'], result: 'value' }],
]);

export function compileQuery(text: string): Query {
  const query = new Parser(text).parse();
  checkQuery(query);
  return query;
}

function isDigit(c: string): boolean {
  return c.length === 1 && c >= '0' && c <= '9';
}

function isNameFirst(c: string): boolean {
  if (c === '') return false;
  const cp = c.codePointAt(0) ?? 0;
  return (
    cp === 0x5f ||
    (cp >= 0x41 && cp <= 0x5a) ||
    (cp >= 0x61 && cp <= 0x7a) ||
    (cp >= 0x80 && cp <= 0xd7ff) ||
    (cp >= 0xe000 && cp <= 0x10ffff)
  );
}

function isFunctionStart(c: string): boolean {
  return /^[a-z]$/.test(c);
}

class Parser {
  private readonly cs: string[] = [];
  private pos = 0;

  constructor(text: string) {
    // R2.1: a lone surrogate is not a scalar value.
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp >= 0xd800 && cp <= 0xdfff) throw new InvalidQuery('lone surrogate');
      this.cs.push(ch);
    }
  }

  parse(): Query {
    if (this.at() !== '$') this.fail();
    const query = this.pathQuery();
    if (this.pos !== this.cs.length) this.fail();
    return query;
  }

  private at(offset = 0): string {
    return this.cs[this.pos + offset] ?? '';
  }

  private fail(): never {
    throw new InvalidQuery(`unexpected input at character ${this.pos}`);
  }

  private expect(c: string): void {
    if (this.at() !== c) this.fail();
    this.pos++;
  }

  // Consumes blank space (R2.2); reports whether any was consumed.
  private skipBlank(): boolean {
    const start = this.pos;
    while (BLANK.has(this.at())) this.pos++;
    return this.pos > start;
  }

  // A root identifier ($ or @) followed by segments. Blank space before a segment is consumed
  // only when a segment follows (Appendix B).
  private pathQuery(): Query {
    const root = this.at() === '@' ? '@' : '$';
    this.pos++;
    const segments: Segment[] = [];
    let singular = true;
    for (;;) {
      const save = this.pos;
      this.skipBlank();
      const c = this.at();
      if (c !== '[' && c !== '.') {
        this.pos = save;
        break;
      }
      const parsed = this.segment();
      segments.push(parsed.segment);
      singular = singular && parsed.singular;
    }
    return { root, segments, singular };
  }

  private segment(): { segment: Segment; singular: boolean } {
    if (this.at() === '[') {
      const bracket = this.bracketed();
      const one = bracket.selectors.length === 1 && !bracket.blank;
      const kind = bracket.selectors[0]?.kind;
      return {
        segment: { descendant: false, selectors: bracket.selectors },
        singular: one && (kind === 'name' || kind === 'index'),
      };
    }
    this.pos++; // the '.'
    if (this.at() === '.') {
      this.pos++;
      const selectors =
        this.at() === '[' ? this.bracketed().selectors : [this.dotSelector()];
      return { segment: { descendant: true, selectors }, singular: false };
    }
    const selector = this.dotSelector();
    return {
      segment: { descendant: false, selectors: [selector] },
      singular: selector.kind === 'name',
    };
  }

  private dotSelector(): Selector {
    if (this.at() === '*') {
      this.pos++;
      return { kind: 'wildcard' };
    }
    if (!isNameFirst(this.at())) this.fail();
    let name = '';
    while (isNameFirst(this.at()) || isDigit(this.at())) name += this.cs[this.pos++];
    return { kind: 'name', name };
  }

  // A bracketed selection. `blank` records whether blank space appears inside the brackets, which
  // makes a singular-query segment non-singular (R17.1).
  private bracketed(): { selectors: Selector[]; blank: boolean } {
    this.pos++; // the '['
    const selectors: Selector[] = [];
    let blank = this.skipBlank();
    selectors.push(this.selector());
    for (;;) {
      blank = this.skipBlank() || blank;
      if (this.at() !== ',') break;
      this.pos++;
      blank = this.skipBlank() || blank;
      selectors.push(this.selector());
    }
    this.expect(']');
    return { selectors, blank };
  }

  private selector(): Selector {
    const c = this.at();
    if (c === '"' || c === "'") return { kind: 'name', name: this.stringLiteral() };
    if (c === '*') {
      this.pos++;
      return { kind: 'wildcard' };
    }
    if (c === '?') {
      this.pos++;
      this.skipBlank();
      return { kind: 'filter', expr: this.logicalOr() };
    }
    const start = this.integer();
    const save = this.pos;
    this.skipBlank();
    if (this.at() !== ':') {
      this.pos = save;
      if (start === null) this.fail();
      return { kind: 'index', index: start };
    }
    this.pos++;
    this.skipBlank();
    const end = this.integer();
    this.skipBlank();
    let step: number | null = null;
    if (this.at() === ':') {
      this.pos++;
      this.skipBlank();
      step = this.integer();
    }
    return { kind: 'slice', start, end, step };
  }

  // int = "0" / (["-"] DIGIT1 *DIGIT), checked against R12. Returns null when no integer is here.
  private integer(): number | null {
    const start = this.pos;
    const negative = this.at() === '-';
    if (negative) this.pos++;
    const first = this.at();
    if (first === '0' && !negative) {
      this.pos++;
      return 0;
    }
    if (!isDigit(first) || first === '0') {
      this.pos = start;
      return null;
    }
    let digits = '';
    while (isDigit(this.at())) digits += this.cs[this.pos++];
    const value = Number(`${negative ? '-' : ''}${digits}`);
    if (Math.abs(value) > MAX_INT) throw new InvalidQuery('integer out of range');
    return value;
  }

  private stringLiteral(): string {
    const quote = this.at();
    this.pos++;
    let out = '';
    for (;;) {
      const c = this.at();
      if (c === '') this.fail();
      this.pos++;
      if (c === quote) return out;
      if (c < ' ') this.fail();
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = this.at();
      this.pos++;
      if (e === quote) {
        out += e;
      } else if (e === 'u') {
        out += this.unicodeEscape();
      } else {
        const simple = SIMPLE_ESCAPES.get(e);
        if (simple === undefined) this.fail();
        out += simple;
      }
    }
  }

  private unicodeEscape(): string {
    const cp = this.hex4();
    if (cp >= 0xd800 && cp <= 0xdbff) {
      if (this.at() !== '\\' || this.at(1) !== 'u') this.fail();
      this.pos += 2;
      const low = this.hex4();
      if (low < 0xdc00 || low > 0xdfff) this.fail();
      return String.fromCodePoint(0x10000 + (cp - 0xd800) * 0x400 + (low - 0xdc00));
    }
    if (cp >= 0xdc00 && cp <= 0xdfff) this.fail();
    return String.fromCharCode(cp);
  }

  private hex4(): number {
    const digits = this.cs.slice(this.pos, this.pos + 4).join('');
    if (!/^[0-9a-fA-F]{4}$/.test(digits)) this.fail();
    this.pos += 4;
    return parseInt(digits, 16);
  }

  // R16: logical-expr, with the precedence of R19 (&& binds tighter than ||).
  private logicalOr(): Expr {
    let left = this.logicalAnd();
    for (;;) {
      const save = this.pos;
      this.skipBlank();
      if (this.at() !== '|' || this.at(1) !== '|') {
        this.pos = save;
        return left;
      }
      this.pos += 2;
      this.skipBlank();
      left = { kind: 'or', left, right: this.logicalAnd() };
    }
  }

  private logicalAnd(): Expr {
    let left = this.basic();
    for (;;) {
      const save = this.pos;
      this.skipBlank();
      if (this.at() !== '&' || this.at(1) !== '&') {
        this.pos = save;
        return left;
      }
      this.pos += 2;
      this.skipBlank();
      left = { kind: 'and', left, right: this.basic() };
    }
  }

  // basic-expr: a parenthesized expression, a negated test, a comparison, or a test.
  private basic(): Expr {
    if (this.at() === '(') return this.paren();
    if (this.at() === '!') {
      this.pos++;
      this.skipBlank();
      const inner: Expr =
        this.at() === '(' ? this.paren() : { kind: 'operand', operand: this.primary() };
      return { kind: 'not', expr: inner };
    }
    const left = this.primary();
    const save = this.pos;
    this.skipBlank();
    const op = this.compareOp();
    if (op === null) {
      this.pos = save;
      return { kind: 'operand', operand: left };
    }
    this.skipBlank();
    return { kind: 'compare', op, left, right: this.primary() };
  }

  private paren(): Expr {
    this.expect('(');
    this.skipBlank();
    const expr = this.logicalOr();
    this.skipBlank();
    this.expect(')');
    return { kind: 'group', expr };
  }

  private compareOp(): CompareOp | null {
    const two = this.at() + this.at(1);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
      this.pos += 2;
      return two;
    }
    const one = this.at();
    if (one === '<' || one === '>') {
      this.pos++;
      return one;
    }
    return null;
  }

  // A literal, a query, or a function call.
  private primary(): Operand {
    const c = this.at();
    if (c === '$' || c === '@') return { kind: 'query', query: this.pathQuery() };
    if (c === '"' || c === "'") return { kind: 'literal', value: this.stringLiteral() };
    if (c === '-' || isDigit(c)) return { kind: 'literal', value: this.numberLiteral() };
    if (isFunctionStart(c)) {
      let name = '';
      while (/^[a-z0-9_]$/.test(this.at())) name += this.cs[this.pos++];
      if (this.at() === '(') return { kind: 'call', name, args: this.callArguments() };
      if (name === 'true') return { kind: 'literal', value: true };
      if (name === 'false') return { kind: 'literal', value: false };
      if (name === 'null') return { kind: 'literal', value: null };
    }
    this.fail();
  }

  // R16.2 number syntax. Range is not checked here (R12 does not apply to literals).
  private numberLiteral(): JsonNumber {
    const start = this.pos;
    if (this.at() === '-') this.pos++;
    if (this.at() === '0') {
      this.pos++;
    } else if (isDigit(this.at()) && this.at() !== '0') {
      while (isDigit(this.at())) this.pos++;
    } else {
      this.fail();
    }
    if (this.at() === '.') {
      this.pos++;
      if (!isDigit(this.at())) this.fail();
      while (isDigit(this.at())) this.pos++;
    }
    if (this.at() === 'e' || this.at() === 'E') {
      this.pos++;
      if (this.at() === '+' || this.at() === '-') this.pos++;
      if (!isDigit(this.at())) this.fail();
      while (isDigit(this.at())) this.pos++;
    }
    return new JsonNumber(this.cs.slice(start, this.pos).join(''));
  }

  // R20.1: "(" S [argument *(S "," S argument)] S ")". Arguments are full logical expressions;
  // a bare literal, query or call is classified later (R20.4).
  private callArguments(): Expr[] {
    this.expect('(');
    const args: Expr[] = [];
    this.skipBlank();
    if (this.at() === ')') {
      this.pos++;
      return args;
    }
    for (;;) {
      args.push(this.logicalOr());
      this.skipBlank();
      if (this.at() !== ',') break;
      this.pos++;
      this.skipBlank();
    }
    this.expect(')');
    return args;
  }
}

// ---- Static checks (R17.2, R20.2-3, R21) ----

function checkQuery(query: Query): void {
  for (const segment of query.segments) {
    for (const selector of segment.selectors) {
      if (selector.kind === 'filter') checkTest(selector.expr);
    }
  }
}

// Every expression in a filter must be a logical expression built from tests and comparisons.
function checkTest(expr: Expr): void {
  switch (expr.kind) {
    case 'or':
    case 'and':
      checkTest(expr.left);
      checkTest(expr.right);
      return;
    case 'not':
    case 'group':
      checkTest(expr.expr);
      return;
    case 'compare':
      checkComparable(expr.left);
      checkComparable(expr.right);
      return;
    case 'operand': {
      const op = expr.operand;
      if (op.kind === 'literal') throw new InvalidQuery('literal used as a test');
      if (op.kind === 'query') {
        checkQuery(op.query);
        return;
      }
      if (checkCall(op.name, op.args) === 'value') throw new InvalidQuery('value function as a test');
    }
  }
}

function checkComparable(op: Operand): void {
  if (op.kind === 'literal') return;
  if (op.kind === 'query') {
    checkQuery(op.query);
    if (!op.query.singular) throw new InvalidQuery('non-singular query in a comparison');
    return;
  }
  if (checkCall(op.name, op.args) !== 'value') throw new InvalidQuery('non-value function in a comparison');
}

// Checks a call and returns its result type.
function checkCall(name: string, args: Expr[]): Type {
  const signature = SIGNATURES.get(name);
  if (signature === undefined || signature.params.length !== args.length) {
    throw new InvalidQuery(`unknown function or wrong arity: ${name}`);
  }
  args.forEach((arg, i) => checkArgument(arg, signature.params[i]));
  return signature.result;
}

function checkArgument(expr: Expr, want: Type): void {
  if (expr.kind !== 'operand') throw new InvalidQuery('logical expression as a function argument');
  const op = expr.operand;
  if (op.kind === 'literal') {
    if (want !== 'value') throw new InvalidQuery('literal where a nodelist is required');
    return;
  }
  if (op.kind === 'query') {
    checkQuery(op.query);
    if (want === 'value' && !op.query.singular) throw new InvalidQuery('non-singular query as a value');
    return;
  }
  if (checkCall(op.name, op.args) !== want) throw new InvalidQuery('function result has the wrong type');
}
