// Parses a JSONPath query into a tree, or throws InvalidQuery. The grammar is the one SPEC.md
// restates from RFC 9535 (Appendix A), with the well-typedness rules of REQ-SY-009 to REQ-SY-011.
// Nothing here looks at a document: a query is valid or not before it is evaluated.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export class InvalidQuery extends Error {}

export type CmpOp = '==' | '!=' | '<' | '<=' | '>' | '>=';
export type FnName = 'length' | 'count' | 'match' | 'search' | 'value';

interface FnType {
  params: ('value' | 'nodes')[];
  returns: 'value' | 'logical';
}

// The five functions of RFC 9535 section 3.2 and their declared types (REQ-SY-010, REQ-SY-011).
const FUNCTIONS: Record<FnName, FnType> = {
  length: { params: ['value'], returns: 'value' },
  count: { params: ['nodes'], returns: 'value' },
  match: { params: ['value', 'value'], returns: 'logical' },
  search: { params: ['value', 'value'], returns: 'logical' },
  value: { params: ['nodes'], returns: 'value' },
};

export interface Query {
  absolute: boolean; // begins with $; otherwise @, inside a filter
  segments: Segment[];
  singular: boolean; // every segment is a singular step (REQ-SY-009)
}

export interface Segment {
  descendant: boolean;
  selectors: Selector[];
  single: boolean; // one name or index with no blank space in its brackets
}

export type Selector =
  | { kind: 'name'; name: string }
  | { kind: 'wild' }
  | { kind: 'index'; index: number }
  | { kind: 'slice'; start?: number; end?: number; step?: number }
  | { kind: 'filter'; expr: Expr };

export type Expr =
  | { kind: 'lit'; value: Json }
  | { kind: 'query'; query: Query }
  | { kind: 'call'; name: FnName; args: Expr[] }
  | { kind: 'or'; items: Expr[] }
  | { kind: 'and'; items: Expr[] }
  | { kind: 'not'; expr: Expr }
  | { kind: 'paren'; expr: Expr }
  | { kind: 'cmp'; op: CmpOp; left: Expr; right: Expr };

type CallExpr = Extract<Expr, { kind: 'call' }>;

const MAX_INDEX = 9007199254740991;
const CMP_OPS: CmpOp[] = ['==', '!=', '<=', '>=', '<', '>'];
const KEYWORDS = ['true', 'false', 'null'];
const SIMPLE_ESCAPES: Record<string, string> = {
  b: '\b',
  t: '\t',
  n: '\n',
  f: '\f',
  r: '\r',
  '/': '/',
  '\\': '\\',
};

// Parses a whole query. Throws InvalidQuery unless the text is a well-formed, well-typed query.
export function parseQuery(text: string): Query {
  const parser = new Parser(text);
  if (parser.peek() !== '$') parser.fail('a query begins with $');
  const query = parser.parseQueryAt();
  if (!parser.atEnd()) parser.fail('text after the end of the query');
  checkQuery(query);
  return query;
}

class Parser {
  readonly cps: string[];
  pos = 0;

  constructor(text: string) {
    this.cps = Array.from(text);
  }

  peek(offset = 0): string {
    return this.cps[this.pos + offset] ?? '';
  }

  atEnd(): boolean {
    return this.pos >= this.cps.length;
  }

  fail(reason: string): never {
    throw new InvalidQuery(`${reason} (at code point ${this.pos})`);
  }

  matchAt(text: string): boolean {
    return this.cps.slice(this.pos, this.pos + text.length).join('') === text;
  }

  // Skips blank space (REQ-SY-001); reports whether any was skipped.
  skipBlanks(): boolean {
    const start = this.pos;
    while (isBlank(this.peek())) this.pos++;
    return this.pos > start;
  }

  // A query starting at $ or @. Blank space may come before a segment, and is consumed only
  // when a segment follows it.
  parseQueryAt(): Query {
    const absolute = this.peek() === '$';
    this.pos++;
    const segments: Segment[] = [];
    for (;;) {
      const save = this.pos;
      this.skipBlanks();
      const segment = this.parseSegment();
      if (segment === undefined) {
        this.pos = save;
        break;
      }
      segments.push(segment);
    }
    return { absolute, segments, singular: segments.every((s) => s.single) };
  }

  private parseSegment(): Segment | undefined {
    if (this.matchAt('..')) {
      this.pos += 2;
      if (this.peek() === '[') {
        return { descendant: true, selectors: this.parseBracket().selectors, single: false };
      }
      return { descendant: true, selectors: [this.parseDotSelector()], single: false };
    }
    if (this.peek() === '.') {
      this.pos++;
      const selector = this.parseDotSelector();
      return { descendant: false, selectors: [selector], single: selector.kind === 'name' };
    }
    if (this.peek() === '[') {
      const { selectors, blank } = this.parseBracket();
      const single =
        selectors.length === 1 &&
        !blank &&
        (selectors[0].kind === 'name' || selectors[0].kind === 'index');
      return { descendant: false, selectors, single };
    }
    return undefined;
  }

  // What follows . or ..: * or a name in shorthand form (REQ-SY-002).
  private parseDotSelector(): Selector {
    if (this.peek() === '*') {
      this.pos++;
      return { kind: 'wild' };
    }
    if (!isNameStart(this.peek())) this.fail('expected a name or * after .');
    let name = '';
    while (isNameChar(this.peek())) {
      name += this.peek();
      this.pos++;
    }
    return { kind: 'name', name };
  }

  // A bracketed selection (REQ-SY-006). `blank` records blank space inside the brackets.
  private parseBracket(): { selectors: Selector[]; blank: boolean } {
    this.pos++; // [
    let blank = this.skipBlanks();
    const selectors: Selector[] = [];
    for (;;) {
      selectors.push(this.parseSelector());
      if (this.skipBlanks()) blank = true;
      if (this.peek() === ']') {
        this.pos++;
        return { selectors, blank };
      }
      if (this.peek() !== ',') this.fail('expected , or ]');
      this.pos++;
      if (this.skipBlanks()) blank = true;
    }
  }

  private parseSelector(): Selector {
    const ch = this.peek();
    if (ch === "'" || ch === '"') return { kind: 'name', name: this.parseStringLiteral() };
    if (ch === '*') {
      this.pos++;
      return { kind: 'wild' };
    }
    if (ch === '?') {
      this.pos++;
      this.skipBlanks();
      return { kind: 'filter', expr: this.parseLogicalOr() };
    }
    if (ch === ':' || ch === '-' || isDigit(ch)) return this.parseIndexOrSlice();
    return this.fail('expected a selector');
  }

  private parseIndexOrSlice(): Selector {
    const start = this.parseInteger();
    this.skipBlanks();
    if (this.peek() !== ':') {
      if (start === undefined) this.fail('expected an index or a slice');
      return { kind: 'index', index: start };
    }
    this.pos++;
    this.skipBlanks();
    const end = this.parseInteger();
    this.skipBlanks();
    let step: number | undefined;
    if (this.peek() === ':') {
      this.pos++;
      this.skipBlanks();
      step = this.parseInteger();
    }
    return { kind: 'slice', start, end, step };
  }

  // An integer selector or slice bound: 0, or an optional - and 1-9 and more digits, within
  // the I-JSON range (REQ-SY-004). Undefined when no integer starts here.
  private parseInteger(): number | undefined {
    let text = '';
    if (this.peek() === '-') {
      text = '-';
      this.pos++;
      if (!isNonZeroDigit(this.peek())) this.fail('- must be followed by 1 to 9');
    } else if (this.peek() === '0') {
      this.pos++;
      return 0;
    } else if (!isNonZeroDigit(this.peek())) {
      return undefined;
    }
    while (isDigit(this.peek())) {
      text += this.peek();
      this.pos++;
    }
    const value = Number(text);
    if (Math.abs(value) > MAX_INDEX) this.fail('integer outside the I-JSON range');
    return value;
  }

  // A string literal in single or double quotes (REQ-SY-003).
  private parseStringLiteral(): string {
    const quote = this.peek();
    this.pos++;
    let out = '';
    for (;;) {
      const ch = this.peek();
      if (ch === '') this.fail('unclosed string literal');
      this.pos++;
      if (ch === quote) return out;
      if (cp(ch) < 0x20) this.fail('control code point in string literal');
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      const esc = this.peek();
      this.pos++;
      if (esc === 'u') {
        out += this.parseUnicodeEscape();
      } else if (Object.hasOwn(SIMPLE_ESCAPES, esc)) {
        out += SIMPLE_ESCAPES[esc];
      } else if (esc === quote) {
        out += esc; // \' only in single quotes, \" only in double quotes
      } else {
        this.fail('bad escape in string literal');
      }
    }
  }

  // The four hex digits after \u, and the second half of a surrogate pair when there is one.
  private parseUnicodeEscape(): string {
    const unit = this.hex4();
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (this.peek() !== '\\' || this.peek(1) !== 'u') this.fail('high surrogate without a low one');
      this.pos += 2;
      const low = this.hex4();
      if (low < 0xdc00 || low > 0xdfff) this.fail('high surrogate not followed by a low one');
      return String.fromCodePoint(0x10000 + ((unit - 0xd800) << 10) + (low - 0xdc00));
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) this.fail('low surrogate without a high one');
    return String.fromCodePoint(unit);
  }

  private hex4(): number {
    let value = 0;
    for (let k = 0; k < 4; k++) {
      const digit = this.peek();
      if (!/^[0-9A-Fa-f]$/.test(digit)) this.fail('\\u must be followed by four hex digits');
      value = value * 16 + parseInt(digit, 16);
      this.pos++;
    }
    return value;
  }

  // A number (REQ-SY-008). Its value is the number it writes; the I-JSON range does not apply.
  private parseNumber(): number {
    const start = this.pos;
    if (this.peek() === '-') this.pos++;
    if (this.peek() === '0') {
      this.pos++;
    } else if (isNonZeroDigit(this.peek())) {
      while (isDigit(this.peek())) this.pos++;
    } else {
      this.fail('expected a number');
    }
    if (this.peek() === '.' && isDigit(this.peek(1))) {
      this.pos++;
      while (isDigit(this.peek())) this.pos++;
    }
    if (this.peek() === 'e' || this.peek() === 'E') {
      const signed = this.peek(1) === '+' || this.peek(1) === '-';
      if (isDigit(this.peek(signed ? 2 : 1))) {
        this.pos += signed ? 2 : 1;
        while (isDigit(this.peek())) this.pos++;
      }
    }
    return Number(this.cps.slice(start, this.pos).join(''));
  }

  private keywordAt(): string | undefined {
    return KEYWORDS.find((word) => this.matchAt(word) && !isWordChar(this.peek(word.length)));
  }

  private atLiteral(): boolean {
    const ch = this.peek();
    return ch === "'" || ch === '"' || ch === '-' || isDigit(ch) || this.keywordAt() !== undefined;
  }

  private parseLiteral(): Json {
    const ch = this.peek();
    if (ch === "'" || ch === '"') return this.parseStringLiteral();
    const word = this.keywordAt();
    if (word !== undefined) {
      this.pos += word.length;
      return word === 'true' ? true : word === 'false' ? false : null;
    }
    return this.parseNumber();
  }

  // A logical expression (REQ-SY-007): conjunctions joined by ||.
  parseLogicalOr(): Expr {
    const items = [this.parseLogicalAnd()];
    while (this.tryOp('||')) items.push(this.parseLogicalAnd());
    return items.length === 1 ? items[0] : { kind: 'or', items };
  }

  private parseLogicalAnd(): Expr {
    const items = [this.parseBasic()];
    while (this.tryOp('&&')) items.push(this.parseBasic());
    return items.length === 1 ? items[0] : { kind: 'and', items };
  }

  // A basic expression: a parenthesized one, a test, or a comparison, each maybe negated.
  private parseBasic(): Expr {
    let negated = false;
    if (this.peek() === '!') {
      this.pos++;
      this.skipBlanks();
      negated = true;
    }
    if (this.peek() === '(') {
      this.pos++;
      this.skipBlanks();
      const expr: Expr = { kind: 'paren', expr: this.parseLogicalOr() };
      this.skipBlanks();
      if (this.peek() !== ')') this.fail('expected )');
      this.pos++;
      return negated ? { kind: 'not', expr } : expr;
    }
    if (negated) return { kind: 'not', expr: this.parseTest() };
    return this.parseTestOrComparison();
  }

  // What ! applies to: a query or a function call, never a literal or a comparison.
  private parseTest(): Expr {
    const ch = this.peek();
    if (ch === '@' || ch === '$') return { kind: 'query', query: this.parseQueryAt() };
    if (isLowerAscii(ch) && !this.atLiteral()) return this.parseCall();
    return this.fail('! must be followed by a query, a function call or ( ');
  }

  private parseTestOrComparison(): Expr {
    const ch = this.peek();
    if (ch === '@' || ch === '$') {
      return this.maybeComparison({ kind: 'query', query: this.parseQueryAt() }, false);
    }
    if (this.atLiteral()) return this.maybeComparison({ kind: 'lit', value: this.parseLiteral() }, true);
    if (isLowerAscii(ch)) return this.maybeComparison(this.parseCall(), false);
    return this.fail('expected a test or a comparison');
  }

  private maybeComparison(left: Expr, mustCompare: boolean): Expr {
    const op = this.tryCmpOp();
    if (op === undefined) {
      if (mustCompare) this.fail('a literal is only allowed in a comparison');
      return left;
    }
    return { kind: 'cmp', op, left, right: this.parseComparable() };
  }

  // A comparable: a literal, a query or a function call. Its type is checked afterwards.
  private parseComparable(): Expr {
    if (this.atLiteral()) return { kind: 'lit', value: this.parseLiteral() };
    const ch = this.peek();
    if (ch === '@' || ch === '$') return { kind: 'query', query: this.parseQueryAt() };
    if (isLowerAscii(ch)) return this.parseCall();
    return this.fail('expected a literal, a query or a function call');
  }

  // A function argument: a literal, or else a logical expression that the typing rules may
  // still reject (a query, a function call and a comparison all come out of parseLogicalOr).
  private parseArgument(): Expr {
    if (this.atLiteral()) return { kind: 'lit', value: this.parseLiteral() };
    return this.parseLogicalOr();
  }

  // name "(" [arguments] ")" (REQ-SY-010). The name must be followed at once by (.
  private parseCall(): Expr {
    let name = this.peek();
    this.pos++;
    while (isLowerAscii(this.peek()) || isDigit(this.peek()) || this.peek() === '_') {
      name += this.peek();
      this.pos++;
    }
    if (this.peek() !== '(') this.fail('a function name must be followed at once by (');
    this.pos++;
    const args: Expr[] = [];
    this.skipBlanks();
    if (this.peek() === ')') {
      this.pos++;
    } else {
      for (;;) {
        args.push(this.parseArgument());
        this.skipBlanks();
        if (this.peek() === ')') {
          this.pos++;
          break;
        }
        if (this.peek() !== ',') this.fail('expected , or )');
        this.pos++;
        this.skipBlanks();
      }
    }
    if (!Object.hasOwn(FUNCTIONS, name)) this.fail(`no function named ${name}`);
    const fn = name as FnName;
    const arity = FUNCTIONS[fn].params.length;
    if (arity !== args.length) this.fail(`${fn} takes ${arity} argument(s)`);
    return { kind: 'call', name: fn, args };
  }

  // Consumes an operator of the given text, with blank space around it; restores the position
  // when the text is not there.
  private tryOp(op: string): boolean {
    const save = this.pos;
    this.skipBlanks();
    if (!this.matchAt(op)) {
      this.pos = save;
      return false;
    }
    this.pos += op.length;
    this.skipBlanks();
    return true;
  }

  private tryCmpOp(): CmpOp | undefined {
    const save = this.pos;
    this.skipBlanks();
    for (const op of CMP_OPS) {
      if (this.matchAt(op)) {
        this.pos += op.length;
        this.skipBlanks();
        return op;
      }
    }
    this.pos = save;
    return undefined;
  }
}

// Well-formed queries whose parts must be well typed (REQ-SY-011).

function checkQuery(query: Query): void {
  for (const segment of query.segments) {
    for (const selector of segment.selectors) {
      if (selector.kind === 'filter') checkLogical(selector.expr);
    }
  }
}

// A logical expression: a test (any query, or a function with a logical result), a comparison,
// or a combination of them.
function checkLogical(expr: Expr): void {
  switch (expr.kind) {
    case 'or':
    case 'and':
      expr.items.forEach((item) => checkLogical(item));
      return;
    case 'not':
    case 'paren':
      checkLogical(expr.expr);
      return;
    case 'query':
      checkQuery(expr.query);
      return;
    case 'call':
      if (FUNCTIONS[expr.name].returns !== 'logical') throw new InvalidQuery(`${expr.name} is not a test`);
      checkCall(expr);
      return;
    case 'cmp':
      checkValue(expr.left);
      checkValue(expr.right);
      return;
    case 'lit':
      throw new InvalidQuery('a literal is not a test');
  }
}

// A value: a literal, a singular query, or a function with a value result.
function checkValue(expr: Expr): void {
  if (expr.kind === 'lit') return;
  if (expr.kind === 'query' && expr.query.singular) {
    checkQuery(expr.query);
    return;
  }
  if (expr.kind === 'call' && FUNCTIONS[expr.name].returns === 'value') {
    checkCall(expr);
    return;
  }
  throw new InvalidQuery('a value is expected here');
}

function checkCall(call: CallExpr): void {
  FUNCTIONS[call.name].params.forEach((param, i) => {
    const arg = call.args[i];
    if (param === 'value') {
      checkValue(arg);
      return;
    }
    if (arg.kind !== 'query') throw new InvalidQuery('a nodelist is expected here');
    checkQuery(arg.query);
  });
}

// Character classes (REQ-SE-003 and the grammar of REQ-SY-002 to REQ-SY-008).

function cp(ch: string): number {
  return ch === '' ? -1 : (ch.codePointAt(0) as number);
}

function isBlank(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isDigit(ch: string): boolean {
  const c = cp(ch);
  return c >= 0x30 && c <= 0x39;
}

function isNonZeroDigit(ch: string): boolean {
  return ch !== '0' && isDigit(ch);
}

function isLowerAscii(ch: string): boolean {
  const c = cp(ch);
  return c >= 0x61 && c <= 0x7a;
}

// A name starts with an ASCII letter, _, or a code point from U+0080 up (REQ-SY-002).
function isNameStart(ch: string): boolean {
  const c = cp(ch);
  return c === 0x5f || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c >= 0x80;
}

function isNameChar(ch: string): boolean {
  return isNameStart(ch) || isDigit(ch);
}

function isWordChar(ch: string): boolean {
  return /^[A-Za-z0-9_]$/.test(ch);
}
