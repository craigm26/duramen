// I-Regexp (RFC 9485, as SPEC.md's REQ-RX sections state it). A pattern is checked against that
// grammar in full; a valid one is translated to a JavaScript RegExp with the same meaning. Every
// literal code point is written as an escape, so JavaScript's own syntax never applies to it.

export interface IRegexp {
  full: RegExp; // the whole string matches (match())
  partial: RegExp; // some substring matches (search())
}

// The General Category names of REQ-RX-004.
const CATEGORIES = new Set([
  'L', 'Lu', 'Ll', 'Lt', 'Lm', 'Lo',
  'M', 'Mn', 'Mc', 'Me',
  'N', 'Nd', 'Nl', 'No',
  'P', 'Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po',
  'Z', 'Zs', 'Zl', 'Zp',
  'S', 'Sm', 'Sc', 'Sk', 'So',
  'C', 'Cc', 'Cf', 'Co', 'Cn',
]);

// The characters that a backslash may escape (SingleCharEsc, besides n, r and t).
const ESCAPABLE = '()*+-.?[\\]^{|}';

const cache = new Map<string, IRegexp | undefined>();

// Returns the compiled pattern, or undefined when the string is not an I-Regexp.
export function compileIRegexp(pattern: string): IRegexp | undefined {
  if (!cache.has(pattern)) cache.set(pattern, build(pattern));
  return cache.get(pattern);
}

function build(pattern: string): IRegexp | undefined {
  const source = translate(pattern);
  if (source === undefined) return undefined;
  try {
    return { full: new RegExp(`^(?:${source})$`, 'u'), partial: new RegExp(source, 'u') };
  } catch {
    return undefined; // the engine refuses it, e.g. a repeat count it cannot hold (OPEN-OP-004)
  }
}

// The JavaScript source for an I-Regexp, or undefined when the pattern is not one.
export function translate(pattern: string): string | undefined {
  const translator = new Translator(pattern);
  try {
    const source = translator.alternation(0);
    return translator.atEnd() ? source : undefined;
  } catch (error) {
    if (error instanceof NotIRegexp) return undefined;
    throw error;
  }
}

class NotIRegexp extends Error {}

class Translator {
  readonly cps: string[];
  i = 0;

  constructor(pattern: string) {
    this.cps = Array.from(pattern);
  }

  atEnd(): boolean {
    return this.i >= this.cps.length;
  }

  peek(offset = 0): string {
    return this.cps[this.i + offset] ?? '';
  }

  fail(): never {
    throw new NotIRegexp();
  }

  expect(ch: string): void {
    if (this.peek() !== ch) this.fail();
    this.i++;
  }

  // i-regexp = branch *( "|" branch )
  alternation(depth: number): string {
    const branches = [this.branch(depth)];
    while (this.peek() === '|') {
      this.i++;
      branches.push(this.branch(depth));
    }
    return branches.join('|');
  }

  // branch = *piece, where piece = atom [ quantifier ]
  private branch(depth: number): string {
    let out = '';
    while (!this.atEnd() && this.peek() !== '|' && !(depth > 0 && this.peek() === ')')) {
      out += this.atom(depth) + this.quantifier();
    }
    return out;
  }

  private atom(depth: number): string {
    const ch = this.peek();
    if (ch === '(') {
      this.i++;
      const inner = this.alternation(depth + 1);
      this.expect(')');
      return `(?:${inner})`;
    }
    if (ch === '.') {
      this.i++;
      return '[^\\u{a}\\u{d}]'; // any code point but LF and CR
    }
    if (ch === '[') return this.charClass();
    if (ch === '\\') return this.escape();
    const code = cp(ch);
    if (!isNormalChar(code)) this.fail();
    this.i++;
    return literal(code);
  }

  // quantifier = ( "*" / "+" / "?" ) / "{" QuantExact [ "," [ QuantExact ] ] "}"
  private quantifier(): string {
    const ch = this.peek();
    if (ch === '*' || ch === '+' || ch === '?') {
      this.i++;
      return ch;
    }
    if (ch !== '{') return '';
    this.i++;
    const min = this.digits();
    if (min === undefined) this.fail();
    if (this.peek() === '}') {
      this.i++;
      return `{${min}}`;
    }
    this.expect(',');
    const max = this.digits();
    this.expect('}');
    if (max === undefined) return `{${min},}`;
    if (max < min) this.fail(); // a range out of order is not an I-Regexp (OPEN-OP-006)
    return `{${min},${max}}`;
  }

  private digits(): number | undefined {
    let text = '';
    while (/^[0-9]$/.test(this.peek())) {
      text += this.peek();
      this.i++;
    }
    return text === '' ? undefined : Number(text);
  }

  // An escape outside a class: \n \r \t, \p{X} and \P{X}, or a single-character escape.
  private escape(): string {
    this.i++; // the backslash
    const ch = this.peek();
    if (ch === 'p' || ch === 'P') return this.property();
    const code = singleEscape(ch);
    if (code === undefined) this.fail();
    this.i++;
    return literal(code as number);
  }

  // \p{X} or \P{X}, with the p or P at the current position.
  private property(): string {
    const kind = this.peek();
    this.i++;
    if (this.peek() !== '{') this.fail();
    this.i++;
    let name = '';
    while (!this.atEnd() && this.peek() !== '}') {
      name += this.peek();
      this.i++;
    }
    this.expect('}');
    if (!CATEGORIES.has(name)) this.fail();
    return `\\${kind}{${name}}`;
  }

  // charClassExpr = "[" [ "^" ] ( "-" / CCE1 ) *CCE1 [ "-" ] "]"
  private charClass(): string {
    this.i++; // [
    const negated = this.peek() === '^';
    if (negated) this.i++;
    let body = '';
    if (this.peek() === '-') {
      this.i++;
      body += literal(0x2d);
    } else {
      body += this.classElement();
    }
    while (!this.atEnd() && this.peek() !== ']' && this.peek() !== '-') {
      body += this.classElement();
    }
    if (this.peek() === '-') {
      this.i++;
      body += literal(0x2d);
    }
    this.expect(']');
    return `[${negated ? '^' : ''}${body}]`;
  }

  // CCE1 = ( CCchar [ "-" CCchar ] ) / charClassEsc
  private classElement(): string {
    if (this.peek() === '\\' && (this.peek(1) === 'p' || this.peek(1) === 'P')) {
      this.i++;
      return this.property();
    }
    const low = this.classChar();
    if (this.peek() !== '-' || this.peek(1) === ']') return literal(low);
    this.i++;
    const high = this.classChar();
    if (high < low) this.fail(); // a range out of order is not an I-Regexp (OPEN-OP-006)
    return `${literal(low)}-${literal(high)}`;
  }

  // CCchar: a code point that a class may hold as itself, or a single-character escape.
  private classChar(): number {
    const ch = this.peek();
    if (ch === '\\') {
      const code = singleEscape(this.peek(1));
      if (code === undefined) this.fail();
      this.i += 2;
      return code as number;
    }
    const code = cp(ch);
    if (!isClassChar(code)) this.fail();
    this.i++;
    return code;
  }
}

function cp(ch: string): number {
  return ch === '' ? -1 : (ch.codePointAt(0) as number);
}

function literal(code: number): string {
  return `\\u{${code.toString(16)}}`;
}

// The code point a single-character escape stands for, or undefined if the character after the
// backslash may not be escaped.
function singleEscape(ch: string): number | undefined {
  if (ch === 'n') return 0x0a;
  if (ch === 'r') return 0x0d;
  if (ch === 't') return 0x09;
  if (ch.length === 1 && ESCAPABLE.includes(ch)) return ch.codePointAt(0);
  return undefined;
}

// NormalChar: any scalar value except the characters the grammar reserves.
function isNormalChar(c: number): boolean {
  return (
    c >= 0 &&
    (c <= 0x27 ||
      c === 0x2c ||
      c === 0x2d ||
      (c >= 0x2f && c <= 0x3e) ||
      (c >= 0x40 && c <= 0x5a) ||
      (c >= 0x5e && c <= 0x7a) ||
      (c >= 0x7e && c <= 0xd7ff) ||
      (c >= 0xe000 && c <= 0x10ffff))
  );
}

// CCchar: a code point that a class holds as itself (no "-", "[", "\" or "]").
function isClassChar(c: number): boolean {
  return (
    c >= 0 &&
    (c <= 0x2c ||
      (c >= 0x2e && c <= 0x5a) ||
      (c >= 0x5e && c <= 0xd7ff) ||
      (c >= 0xe000 && c <= 0x10ffff))
  );
}
