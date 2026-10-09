// I-Regexp (RFC 9485) validation, translated to a JavaScript regular expression source (u flag).

const CATEGORIES = new Set([
  'L', 'Lu', 'Ll', 'Lt', 'Lm', 'Lo', 'M', 'Mn', 'Mc', 'Me', 'N', 'Nd', 'Nl', 'No',
  'P', 'Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po', 'Z', 'Zs', 'Zl', 'Zp',
  'S', 'Sm', 'Sc', 'Sk', 'So', 'C', 'Cc', 'Cf', 'Co', 'Cn',
]);

class Bad extends Error {}

function lit(c: number): string {
  return '\\u{' + c.toString(16) + '}';
}

function isNormalChar(c: number): boolean {
  return c <= 0x27 || c === 0x2c || c === 0x2d || (c >= 0x2f && c <= 0x3e) ||
    (c >= 0x40 && c <= 0x5a) || (c >= 0x5e && c <= 0x7a) ||
    (c >= 0x7e && c <= 0xd7ff) || (c >= 0xe000 && c <= 0x10ffff);
}

function isClassChar(c: number): boolean {
  return c <= 0x2c || (c >= 0x2e && c <= 0x5a) || (c >= 0x5e && c <= 0xd7ff) ||
    (c >= 0xe000 && c <= 0x10ffff);
}

class Reader {
  cp: number[];
  i = 0;
  constructor(s: string) {
    this.cp = Array.from(s, (c) => c.codePointAt(0)!);
  }

  fail(): never {
    throw new Bad();
  }

  alt(): string {
    let out = this.branch();
    while (this.cp[this.i] === 0x7c) {
      this.i++;
      out += '|' + this.branch();
    }
    return out;
  }

  branch(): string {
    let out = '';
    while (this.i < this.cp.length && this.cp[this.i] !== 0x7c && this.cp[this.i] !== 0x29) {
      out += this.piece();
    }
    return out;
  }

  piece(): string {
    return this.atom() + this.quantifier();
  }

  quantifier(): string {
    const c = this.cp[this.i];
    if (c === 0x2a || c === 0x2b || c === 0x3f) {
      this.i++;
      return String.fromCharCode(c);
    }
    if (c !== 0x7b) return '';
    this.i++;
    const digits = (): string => {
      let d = '';
      while (this.cp[this.i] >= 0x30 && this.cp[this.i] <= 0x39) d += String.fromCharCode(this.cp[this.i++]);
      return d;
    };
    const n = digits();
    if (n === '') this.fail();
    let out = '{' + n;
    if (this.cp[this.i] === 0x2c) {
      this.i++;
      out += ',' + digits();
    }
    if (this.cp[this.i] !== 0x7d) this.fail();
    this.i++;
    return out + '}';
  }

  atom(): string {
    const c = this.cp[this.i];
    if (c === 0x28) {
      this.i++;
      const inner = this.alt();
      if (this.cp[this.i] !== 0x29) this.fail();
      this.i++;
      return '(?:' + inner + ')';
    }
    if (c === 0x2e) {
      this.i++;
      return '[^\\n\\r]';
    }
    if (c === 0x5b) return this.charClass();
    if (c === 0x5c) {
      const d = this.cp[this.i + 1];
      if (d === 0x70 || d === 0x50) return this.category();
      return lit(this.singleEscape());
    }
    if (c === undefined || !isNormalChar(c)) this.fail();
    this.i++;
    return lit(c);
  }

  singleEscape(): number {
    const d = this.cp[this.i + 1];
    this.i += 2;
    if ((d >= 0x28 && d <= 0x2b) || d === 0x2d || d === 0x2e || d === 0x3f ||
      (d >= 0x5b && d <= 0x5e) || (d >= 0x7b && d <= 0x7d)) return d;
    if (d === 0x6e) return 10;
    if (d === 0x72) return 13;
    if (d === 0x74) return 9;
    return this.fail();
  }

  category(): string {
    const kind = String.fromCharCode(this.cp[this.i + 1]);
    this.i += 2;
    if (this.cp[this.i] !== 0x7b) this.fail();
    this.i++;
    let name = '';
    while (this.i < this.cp.length && this.cp[this.i] !== 0x7d) name += String.fromCodePoint(this.cp[this.i++]);
    if (this.cp[this.i] !== 0x7d || !CATEGORIES.has(name)) this.fail();
    this.i++;
    return '\\' + kind + '{' + name + '}';
  }

  classChar(): number {
    const c = this.cp[this.i];
    if (c === 0x5c) return this.singleEscape();
    if (c === undefined || !isClassChar(c)) this.fail();
    this.i++;
    return c;
  }

  charClass(): string {
    this.i++;
    let out = '[';
    if (this.cp[this.i] === 0x5e) {
      out += '^';
      this.i++;
    }
    let first = true;
    for (;;) {
      const c = this.cp[this.i];
      if (c === undefined) this.fail();
      if (c === 0x5d) {
        if (first) this.fail();
        this.i++;
        return out + ']';
      }
      if (c === 0x2d) {
        if (!first && this.cp[this.i + 1] !== 0x5d) this.fail();
        out += lit(0x2d);
        this.i++;
        first = false;
        continue;
      }
      first = false;
      if (c === 0x5c && (this.cp[this.i + 1] === 0x70 || this.cp[this.i + 1] === 0x50)) {
        out += this.category();
        continue;
      }
      const lo = this.classChar();
      if (this.cp[this.i] === 0x2d && this.cp[this.i + 1] !== 0x5d) {
        this.i++;
        const hi = this.classChar();
        if (hi < lo) this.fail();
        out += lit(lo) + '-' + lit(hi);
      } else {
        out += lit(lo);
      }
    }
  }
}

/** The JavaScript source (for the `u` flag) equivalent to the I-Regexp, or null if it is not one. */
export function toJsSource(pattern: string): string | null {
  try {
    const r = new Reader(pattern);
    const src = r.alt();
    if (r.i !== r.cp.length) return null;
    return src;
  } catch (e) {
    if (e instanceof Bad) return null;
    throw e;
  }
}

const cache = new Map<string, { full: RegExp; part: RegExp } | null>();

function compile(pattern: string) {
  if (cache.has(pattern)) return cache.get(pattern)!;
  let res: { full: RegExp; part: RegExp } | null = null;
  const src = toJsSource(pattern);
  if (src !== null) {
    try {
      res = { full: new RegExp('^(?:' + src + ')$', 'u'), part: new RegExp(src, 'u') };
    } catch {
      res = null;
    }
  }
  cache.set(pattern, res);
  return res;
}

export function iregexpMatch(s: string, pattern: string): boolean {
  const re = compile(pattern);
  return re !== null && re.full.test(s);
}

export function iregexpSearch(s: string, pattern: string): boolean {
  const re = compile(pattern);
  return re !== null && re.part.test(s);
}
