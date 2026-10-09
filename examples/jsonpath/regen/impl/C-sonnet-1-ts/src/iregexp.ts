// I-Regexp (RFC 9485) validation, translated to a JavaScript RegExp source.

const CATEGORIES = new Set([
  'L', 'Lu', 'Ll', 'Lt', 'Lm', 'Lo', 'M', 'Mn', 'Mc', 'Me', 'N', 'Nd', 'Nl', 'No',
  'P', 'Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po', 'Z', 'Zs', 'Zl', 'Zp',
  'S', 'Sm', 'Sc', 'Sk', 'So', 'C', 'Cc', 'Cf', 'Co', 'Cn',
]);

class Bad extends Error {}

const lit = (cp: number): string => '\\u{' + cp.toString(16) + '}';

function isNormalChar(c: number): boolean {
  return (
    c <= 0x27 || c === 0x2c || c === 0x2d || (c >= 0x2f && c <= 0x3e) ||
    (c >= 0x40 && c <= 0x5a) || (c >= 0x5e && c <= 0x7a) ||
    (c >= 0x7e && c <= 0xd7ff) || (c >= 0xe000 && c <= 0x10ffff)
  );
}

function isCCchar(c: number): boolean {
  return (
    c <= 0x2c || (c >= 0x2e && c <= 0x5a) || (c >= 0x5e && c <= 0xd7ff) ||
    (c >= 0xe000 && c <= 0x10ffff)
  );
}

// SingleCharEsc after the backslash: ( ) * + - . ? [ \ ] ^ { | } n r t
const ESC_PUNCT = new Set('()*+-.?[\\]^{|}'.split('').map((s) => s.codePointAt(0)!));
const ESC_NAMED: Record<string, number> = { n: 10, r: 13, t: 9 };

class RegexParser {
  cps: number[];
  pos = 0;
  constructor(s: string) {
    this.cps = Array.from(s, (ch) => ch.codePointAt(0)!);
  }
  peek(): number {
    return this.pos < this.cps.length ? this.cps[this.pos] : -1;
  }
  parseAll(): string {
    const r = this.parseRegex();
    if (this.pos < this.cps.length) throw new Bad();
    return r;
  }
  parseRegex(): string {
    const branches = [this.parseBranch()];
    while (this.peek() === 0x7c) {
      this.pos++;
      branches.push(this.parseBranch());
    }
    return branches.join('|');
  }
  parseBranch(): string {
    let out = '';
    for (;;) {
      const c = this.peek();
      if (c === -1 || c === 0x7c || c === 0x29) return out;
      out += this.parseAtom() + this.parseQuantifier();
    }
  }
  parseQuantifier(): string {
    const c = this.peek();
    if (c === 0x2a || c === 0x2b || c === 0x3f) {
      this.pos++;
      return String.fromCharCode(c);
    }
    if (c !== 0x7b) return '';
    this.pos++;
    const n = this.digits();
    let q = '{' + n;
    if (this.peek() === 0x2c) {
      this.pos++;
      q += ',';
      if (this.peek() >= 0x30 && this.peek() <= 0x39) {
        const m = this.digits();
        if (BigInt(m) < BigInt(n)) throw new Bad();
        q += m;
      }
    }
    if (this.peek() !== 0x7d) throw new Bad();
    this.pos++;
    return q + '}';
  }
  digits(): string {
    const start = this.pos;
    while (this.peek() >= 0x30 && this.peek() <= 0x39) this.pos++;
    if (start === this.pos) throw new Bad();
    return String.fromCodePoint(...this.cps.slice(start, this.pos));
  }
  parseAtom(): string {
    const c = this.peek();
    if (c === 0x28) {
      this.pos++;
      const inner = this.parseRegex();
      if (this.peek() !== 0x29) throw new Bad();
      this.pos++;
      return '(?:' + inner + ')';
    }
    if (c === 0x2e) {
      this.pos++;
      return '[^\\n\\r]';
    }
    if (c === 0x5b) return this.parseClass();
    if (c === 0x5c) {
      const e = this.parseEscape();
      return e.prop ? e.src : lit(e.cp);
    }
    if (c !== -1 && isNormalChar(c)) {
      this.pos++;
      return lit(c);
    }
    throw new Bad();
  }
  // At the backslash: a single-character escape, or \p{X} / \P{X}.
  parseEscape(): { prop: boolean; cp: number; src: string } {
    this.pos++;
    const c = this.peek();
    if (c === -1) throw new Bad();
    this.pos++;
    const ch = String.fromCodePoint(c);
    if (ESC_PUNCT.has(c)) return { prop: false, cp: c, src: '' };
    if (Object.hasOwn(ESC_NAMED, ch)) return { prop: false, cp: ESC_NAMED[ch], src: '' };
    if (ch === 'p' || ch === 'P') {
      if (this.peek() !== 0x7b) throw new Bad();
      this.pos++;
      let name = '';
      while (this.peek() !== -1 && this.peek() !== 0x7d) {
        name += String.fromCodePoint(this.peek());
        this.pos++;
      }
      if (this.peek() !== 0x7d || !CATEGORIES.has(name)) throw new Bad();
      this.pos++;
      return { prop: true, cp: 0, src: '\\' + ch + '{' + name + '}' };
    }
    throw new Bad();
  }
  // A CCchar: returns its code point.
  ccChar(): number {
    const c = this.peek();
    if (c === 0x5c) {
      const e = this.parseEscape();
      if (e.prop) throw new Bad();
      return e.cp;
    }
    if (c === -1 || !isCCchar(c)) throw new Bad();
    this.pos++;
    return c;
  }
  parseClass(): string {
    this.pos++;
    let out = '[';
    if (this.peek() === 0x5e) {
      this.pos++;
      out += '^';
    }
    let items = 0;
    if (this.peek() === 0x2d) {
      this.pos++;
      out += lit(0x2d);
      items++;
    }
    for (;;) {
      const c = this.peek();
      if (c === -1) throw new Bad();
      if (c === 0x5d) break;
      if (c === 0x2d) {
        this.pos++;
        if (this.peek() !== 0x5d) throw new Bad();
        out += lit(0x2d);
        break;
      }
      items++;
      const next = this.cps[this.pos + 1];
      if (c === 0x5c && (next === 0x70 || next === 0x50)) {
        out += this.parseEscape().src;
        continue;
      }
      const lo = this.ccChar();
      if (this.peek() === 0x2d && this.cps[this.pos + 1] !== 0x5d) {
        this.pos++;
        const hi = this.ccChar();
        if (hi < lo) throw new Bad();
        out += lit(lo) + '-' + lit(hi);
      } else {
        out += lit(lo);
      }
    }
    if (items === 0) throw new Bad();
    this.pos++;
    return out + ']';
  }
}

interface Compiled {
  full: RegExp;
  part: RegExp;
}

const cache = new Map<string, Compiled | null>();

function compile(pattern: string): Compiled | null {
  if (cache.has(pattern)) return cache.get(pattern)!;
  let res: Compiled | null = null;
  try {
    const src = new RegexParser(pattern).parseAll();
    res = { full: new RegExp('^(?:' + src + ')$', 'u'), part: new RegExp(src, 'u') };
  } catch {
    res = null;
  }
  cache.set(pattern, res);
  return res;
}

// `whole`: the whole string must match (match()); otherwise some substring (search()).
export function iregexpMatch(s: string, pattern: string, whole: boolean): boolean {
  const re = compile(pattern);
  if (!re) return false;
  return (whole ? re.full : re.part).test(s);
}
