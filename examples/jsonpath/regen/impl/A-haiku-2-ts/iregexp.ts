// I-Regexp (RFC 9485): a checking parser, plus the translation of each valid
// I-Regexp into an equivalent JavaScript RegExp source (RFC 9485 Section 5.3).
// The whole-string form for match() is anchored as Section 5.4 describes.

// The general categories Figure 1 allows inside \p{...} and \P{...}.
const CATEGORIES = new Set([
  'L', 'Ll', 'Lm', 'Lo', 'Lt', 'Lu', 'M', 'Mc', 'Me', 'Mn', 'N', 'Nd', 'Nl', 'No',
  'P', 'Pc', 'Pd', 'Pe', 'Pf', 'Pi', 'Po', 'Ps', 'S', 'Sc', 'Sk', 'Sm', 'So',
  'Z', 'Zl', 'Zp', 'Zs', 'C', 'Cc', 'Cf', 'Cn', 'Co',
]);
// The punctuation that may follow a backslash (SingleCharEsc), besides n, r and t.
const ESC_PUNCT = '()*+-.?[\\]^{|}';
const DIGIT = /^[0-9]$/;
const ALPHA = /^[A-Za-z]$/;

class NotIRegexp extends Error {}

const bad = (): never => {
  throw new NotIRegexp();
};
const code = (c: string | undefined): number => (c === undefined ? NaN : c.codePointAt(0)!);
const lit = (cp: number): string => `\\u{${cp.toString(16)}}`;

// NormalChar in Figure 1.
const isNormalChar = (c: number): boolean =>
  c <= 0x27 || c === 0x2c || c === 0x2d || (c >= 0x2f && c <= 0x3e) || (c >= 0x40 && c <= 0x5a) ||
  (c >= 0x5e && c <= 0x7a) || (c >= 0x7e && c <= 0xd7ff) || (c >= 0xe000 && c <= 0x10ffff);

// CCchar in Figure 1, before a backslash escape is considered.
const isClassChar = (c: number): boolean =>
  c !== 0x2d && c !== 0x5b && c !== 0x5c && c !== 0x5d &&
  ((c >= 0 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0x10ffff));

class Translator {
  private s: string[];
  private i = 0;

  constructor(text: string) {
    this.s = [...text];
    for (const c of this.s) if (c.length === 1 && c >= '\uD800' && c <= '\uDFFF') bad();
  }

  run(): string {
    const src = this.alt();
    if (this.i < this.s.length) bad(); // an unmatched ")"
    return src;
  }

  private alt(): string {
    const branches = [this.branch()];
    while (this.s[this.i] === '|') {
      this.i++;
      branches.push(this.branch());
    }
    return branches.join('|');
  }

  private branch(): string {
    let out = '';
    while (this.i < this.s.length && this.s[this.i] !== '|' && this.s[this.i] !== ')') {
      out += this.atom() + this.quantifier();
    }
    return out;
  }

  private atom(): string {
    const c = this.s[this.i];
    if (c === '(') {
      this.i++;
      const inner = this.alt();
      this.expect(')');
      return `(?:${inner})`;
    }
    if (c === '[') return this.charClass();
    if (c === '.') {
      this.i++;
      return '[^\\n\\r]';
    }
    if (c === '\\') {
      const d = this.s[this.i + 1];
      return d === 'p' || d === 'P' ? this.catEsc() : lit(this.singleEsc());
    }
    if (!isNormalChar(code(c))) bad();
    this.i++;
    return lit(code(c));
  }

  private quantifier(): string {
    const c = this.s[this.i];
    if (c === '*' || c === '+' || c === '?') {
      this.i++;
      return c;
    }
    if (c !== '{') return '';
    this.i++;
    const lo = this.digits();
    if (this.s[this.i] === '}') {
      this.i++;
      return `{${lo}}`;
    }
    this.expect(',');
    if (this.s[this.i] === '}') {
      this.i++;
      return `{${lo},}`;
    }
    const hi = this.digits();
    this.expect('}');
    if (Number(hi) < Number(lo)) bad(); // XSD: the minimum may not exceed the maximum
    return `{${lo},${hi}}`;
  }

  private expect(c: string): void {
    if (this.s[this.i] !== c) bad();
    this.i++;
  }

  private digits(): string {
    let d = '';
    while (DIGIT.test(this.s[this.i] ?? '')) d += this.s[this.i++];
    if (d === '') bad();
    return d.replace(/^0+(?=[0-9])/, '');
  }

  // A backslash escape from SingleCharEsc, returned as a code point.
  private singleEsc(): number {
    const d = this.s[this.i + 1];
    this.i += 2;
    if (d === 'n') return 0x0a;
    if (d === 'r') return 0x0d;
    if (d === 't') return 0x09;
    if (d !== undefined && d.length === 1 && ESC_PUNCT.includes(d)) return code(d);
    return bad();
  }

  private catEsc(): string {
    const kind = this.s[this.i + 1];
    this.i += 2;
    this.expect('{');
    let name = '';
    while (ALPHA.test(this.s[this.i] ?? '')) name += this.s[this.i++];
    this.expect('}');
    if (!CATEGORIES.has(name)) bad();
    return `\\${kind}{${name}}`;
  }

  // One CCchar or SingleCharEsc inside a class; \p and \P cannot be range ends.
  private classChar(): number {
    if (this.s[this.i] === '\\') {
      if (this.s[this.i + 1] === 'p' || this.s[this.i + 1] === 'P') bad();
      return this.singleEsc();
    }
    if (!isClassChar(code(this.s[this.i]))) bad();
    return code(this.s[this.i++]);
  }

  private charClass(): string {
    this.i++;
    const neg = this.s[this.i] === '^' ? '^' : '';
    if (neg) this.i++;
    let items = '';
    // A "-" may open the class; it is then a plain member.
    if (this.s[this.i] === '-') {
      items = lit(0x2d);
      this.i++;
    }
    for (;;) {
      const c = this.s[this.i];
      if (c === undefined) bad();
      if (c === ']') {
        if (items === '') bad(); // "[]" and "[^]" are not I-Regexps
        this.i++;
        return `[${neg}${items}]`;
      }
      if (c === '-') {
        // Elsewhere a "-" can only be the last member, just before "]".
        if (this.s[this.i + 1] !== ']') bad();
        items += lit(0x2d);
        this.i++;
      } else if (c === '\\' && (this.s[this.i + 1] === 'p' || this.s[this.i + 1] === 'P')) {
        items += this.catEsc();
      } else {
        const lo = this.classChar();
        if (this.s[this.i] === '-' && this.s[this.i + 1] !== ']') {
          this.i++;
          const hi = this.classChar();
          if (hi < lo) bad(); // a range must run upward
          items += `${lit(lo)}-${lit(hi)}`;
        } else {
          items += lit(lo);
        }
      }
    }
  }
}

// The JavaScript RegExp source equivalent to an I-Regexp, or undefined if the
// text is not an I-Regexp.
export function iregexpToJs(re: string): string | undefined {
  try {
    return new Translator(re).run();
  } catch (e) {
    if (e instanceof NotIRegexp) return undefined;
    throw e;
  }
}

// The RegExp for an I-Regexp: whole-string for match(), any substring for search().
export function compileIRegexp(re: string, whole: boolean): RegExp | undefined {
  const src = iregexpToJs(re);
  if (src === undefined) return undefined;
  try {
    return new RegExp(whole ? `^(?:${src})$` : src, 'u');
  } catch {
    return undefined;
  }
}
