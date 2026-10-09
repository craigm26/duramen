// I-Regexp (RFC 9485, as restated in R27) validation. A valid pattern is
// translated to a JavaScript RegExp with the `u` flag (Appendix D). Anything
// invalid makes match() and search() return false (R24, R25).

class RegexError extends Error {}

// charProp names from R27 (no Cs: surrogates never occur in strings).
const CHAR_PROPS = new Set([
  'L', 'Ll', 'Lm', 'Lo', 'Lt', 'Lu',
  'M', 'Mc', 'Me', 'Mn',
  'N', 'Nd', 'Nl', 'No',
  'P', 'Pc', 'Pd', 'Pe', 'Pf', 'Pi', 'Po', 'Ps',
  'Z', 'Zl', 'Zp', 'Zs',
  'S', 'Sc', 'Sk', 'Sm', 'So',
  'C', 'Cc', 'Cf', 'Cn', 'Co',
]);

// SingleCharEsc characters that stand for themselves (n, r and t are handled apart).
const SINGLE_ESC = new Set(['(', ')', '*', '+', '-', '.', '?', '[', '\\', ']', '^', '{', '|', '}']);

// Characters that are not NormalChar (R27).
const NOT_NORMAL = new Set(['.', '\\', '?', '*', '+', '{', '}', '(', ')', '[', ']', '|']);

const hexEsc = (cp: number): string => `\\u{${cp.toString(16)}}`;
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

class RxParser {
  cs: string[];
  i = 0;

  constructor(cs: string[]) {
    this.cs = cs;
  }

  fail(): never {
    throw new RegexError('invalid I-Regexp');
  }

  alt(): string {
    const parts = [this.branch()];
    while (this.cs[this.i] === '|') {
      this.i++;
      parts.push(this.branch());
    }
    return parts.join('|');
  }

  branch(): string {
    let out = '';
    while (this.i < this.cs.length && this.cs[this.i] !== '|' && this.cs[this.i] !== ')') {
      out += this.piece();
    }
    return out;
  }

  // piece = atom [quantifier]; a second quantifier is not an atom, so it fails.
  piece(): string {
    const atom = this.atom();
    const c = this.cs[this.i];
    if (c === '*' || c === '+' || c === '?') {
      this.i++;
      return atom + c;
    }
    if (c === '{') return atom + this.range();
    return atom;
  }

  range(): string {
    this.i++;
    const lo = this.quantExact();
    let quant = `{${lo}`;
    if (this.cs[this.i] === ',') {
      this.i++;
      if (isDigit(this.cs[this.i])) {
        const hi = this.quantExact();
        if (hi < lo) this.fail();
        quant += `,${hi}`;
      } else {
        quant += ',';
      }
    }
    if (this.cs[this.i] !== '}') this.fail();
    this.i++;
    return quant + '}';
  }

  // QuantExact = 1*DIGIT; leading zeros are allowed and dropped.
  quantExact(): bigint {
    let d = '';
    while (isDigit(this.cs[this.i])) d += this.cs[this.i++];
    if (d === '') this.fail();
    return BigInt(d);
  }

  atom(): string {
    const c = this.cs[this.i];
    if (c === '(') {
      this.i++;
      const inner = this.alt();
      if (this.cs[this.i] !== ')') this.fail();
      this.i++;
      return `(?:${inner})`;
    }
    if (c === '.') {
      this.i++;
      return '[^\\u{a}\\u{d}]';
    }
    if (c === '[') return this.cls();
    if (c === '\\') {
      this.i++;
      const e = this.cs[this.i];
      if (e === 'p' || e === 'P') {
        this.i++;
        return this.prop(e);
      }
      return hexEsc(this.escChar());
    }
    if (c === undefined || NOT_NORMAL.has(c)) this.fail();
    this.i++;
    return hexEsc((c as string).codePointAt(0) as number);
  }

  // The character after a backslash (SingleCharEsc), as a code point.
  escChar(): number {
    const e = this.cs[this.i];
    if (e === undefined) this.fail();
    this.i++;
    if (e === 'n') return 0x0a;
    if (e === 'r') return 0x0d;
    if (e === 't') return 0x09;
    if (SINGLE_ESC.has(e)) return (e as string).codePointAt(0) as number;
    return this.fail();
  }

  // The `{name}` after \p or \P.
  prop(e: string): string {
    if (this.cs[this.i] !== '{') this.fail();
    this.i++;
    let name = '';
    while (this.i < this.cs.length && this.cs[this.i] !== '}') name += this.cs[this.i++];
    if (this.cs[this.i] !== '}' || !CHAR_PROPS.has(name)) this.fail();
    this.i++;
    return `\\${e}{${name}}`;
  }

  // charClassExpr = "[" ["^"] ("-" / CCE1) *CCE1 ["-"] "]"
  cls(): string {
    this.i++;
    let neg = '';
    if (this.cs[this.i] === '^') {
      neg = '^';
      this.i++;
    }
    let items = '';
    let count = 0;
    for (;;) {
      const c = this.cs[this.i];
      if (c === undefined) this.fail();
      if (c === ']') {
        if (count === 0) this.fail();
        break;
      }
      if (c === '-' && (count === 0 || this.cs[this.i + 1] === ']')) {
        this.i++;
        items += hexEsc(0x2d);
      } else if (c === '\\' && (this.cs[this.i + 1] === 'p' || this.cs[this.i + 1] === 'P')) {
        const e = this.cs[this.i + 1] as string;
        this.i += 2;
        items += this.prop(e);
      } else {
        const lo = this.ccChar();
        if (this.cs[this.i] === '-' && this.cs[this.i + 1] !== undefined && this.cs[this.i + 1] !== ']') {
          this.i++;
          const hi = this.ccChar();
          if (hi < lo) this.fail();
          items += `${hexEsc(lo)}-${hexEsc(hi)}`;
        } else {
          items += hexEsc(lo);
        }
      }
      count++;
    }
    this.i++;
    return `[${neg}${items}]`;
  }

  // CCchar: any character except - [ \ ], or a SingleCharEsc.
  ccChar(): number {
    const c = this.cs[this.i];
    if (c === undefined || c === '-' || c === '[' || c === ']') this.fail();
    if (c === '\\') {
      this.i++;
      return this.escChar();
    }
    this.i++;
    return (c as string).codePointAt(0) as number;
  }
}

// Returns the JavaScript source for a valid I-Regexp, or null when it is not one.
export function compileIRegexp(pattern: string): string | null {
  const cs = Array.from(pattern);
  for (const c of cs) {
    const u = c.charCodeAt(0);
    if (c.length === 1 && u >= 0xd800 && u <= 0xdfff) return null;
  }
  const p = new RxParser(cs);
  try {
    const src = p.alt();
    return p.i === cs.length ? src : null;
  } catch (e) {
    if (e instanceof RegexError) return null;
    throw e;
  }
}

interface Compiled {
  whole: RegExp;
  part: RegExp;
}

const cache = new Map<string, Compiled | null>();

function build(pattern: string): Compiled | null {
  const src = compileIRegexp(pattern);
  if (src === null) return null;
  try {
    return { whole: new RegExp(`^(?:${src})$`, 'u'), part: new RegExp(src, 'u') };
  } catch {
    return null;
  }
}

// match (whole = true) or search (whole = false) of s against the I-Regexp pattern.
export function iregexpTest(s: string, pattern: string, whole: boolean): boolean {
  let c = cache.get(pattern);
  if (c === undefined) {
    c = build(pattern);
    cache.set(pattern, c);
  }
  if (c === null) return false;
  return (whole ? c.whole : c.part).test(s);
}
