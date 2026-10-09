// I-Regexp (RFC 9485) validation and translation to a JavaScript RegExp.

const PROPS = new Set([
  'L', 'Ll', 'Lm', 'Lo', 'Lt', 'Lu',
  'M', 'Mc', 'Me', 'Mn',
  'N', 'Nd', 'Nl', 'No',
  'P', 'Pc', 'Pd', 'Pe', 'Pf', 'Pi', 'Po', 'Ps',
  'Z', 'Zl', 'Zp', 'Zs',
  'S', 'Sc', 'Sk', 'Sm', 'So',
  'C', 'Cc', 'Cf', 'Cn', 'Co',
]);

const SINGLE_ESC = '()*+-.?[\\]^nrt{|}';
const NORMAL_EXCLUDED = '.\\?*+{}()[]|';

class Invalid extends Error {}

function hex(cp: number): string {
  return '\\u{' + cp.toString(16) + '}';
}

class Translator {
  cs: string[];
  i = 0;
  constructor(cs: string[]) {
    this.cs = cs;
  }

  bad(): never {
    throw new Invalid();
  }

  peek(): string | undefined {
    return this.cs[this.i];
  }

  regexp(): string {
    const branches = [this.branch()];
    while (this.peek() === '|') {
      this.i++;
      branches.push(this.branch());
    }
    return branches.join('|');
  }

  branch(): string {
    let out = '';
    for (;;) {
      const c = this.peek();
      if (c === undefined || c === '|' || c === ')') return out;
      out += this.piece();
    }
  }

  piece(): string {
    const a = this.atom();
    const c = this.peek();
    if (c === '*' || c === '+' || c === '?') {
      this.i++;
      return a + c;
    }
    if (c === '{') return a + this.rangeQuant();
    return a;
  }

  digits(): string {
    let d = '';
    while (this.peek() !== undefined && this.peek()! >= '0' && this.peek()! <= '9') d += this.cs[this.i++];
    if (d === '') this.bad();
    return d;
  }

  rangeQuant(): string {
    this.i++;
    const n = this.digits();
    let out = '{' + BigInt(n);
    if (this.peek() === ',') {
      this.i++;
      out += ',';
      if (this.peek() !== '}') {
        const m = this.digits();
        if (BigInt(n) > BigInt(m)) this.bad();
        out += BigInt(m);
      }
    }
    if (this.peek() !== '}') this.bad();
    this.i++;
    return out + '}';
  }

  atom(): string {
    const c = this.peek();
    if (c === undefined) return this.bad();
    if (c === '(') {
      this.i++;
      const inner = this.regexp();
      if (this.peek() !== ')') this.bad();
      this.i++;
      return '(?:' + inner + ')';
    }
    if (c === '.') {
      this.i++;
      return '[^\\n\\r]';
    }
    if (c === '[') return this.classExpr();
    if (c === '\\') {
      const p = this.prop();
      if (p !== null) return p;
      return hex(this.singleEsc());
    }
    if (NORMAL_EXCLUDED.includes(c)) this.bad();
    this.i++;
    return hex(c.codePointAt(0)!);
  }

  // At a backslash: parse \p{..} / \P{..}, or return null if it is not one.
  prop(): string | null {
    const k = this.cs[this.i + 1];
    if (k !== 'p' && k !== 'P') return null;
    if (this.cs[this.i + 2] !== '{') this.bad();
    let j = this.i + 3;
    let name = '';
    while (j < this.cs.length && this.cs[j] !== '}') name += this.cs[j++];
    if (j >= this.cs.length || !PROPS.has(name)) this.bad();
    this.i = j + 1;
    return '\\' + k + '{' + name + '}';
  }

  singleEsc(): number {
    const e = this.cs[this.i + 1];
    if (e === undefined || !SINGLE_ESC.includes(e)) this.bad();
    this.i += 2;
    if (e === 'n') return 10;
    if (e === 'r') return 13;
    if (e === 't') return 9;
    return e.codePointAt(0)!;
  }

  // CCchar: any char except - [ \ ], or a SingleCharEsc.
  ccChar(): number | null {
    const c = this.peek();
    if (c === undefined) return null;
    if (c === '\\') {
      const k = this.cs[this.i + 1];
      if (k === 'p' || k === 'P') return null;
      return this.singleEsc();
    }
    if (c === '-' || c === '[' || c === ']') return null;
    this.i++;
    return c.codePointAt(0)!;
  }

  classExpr(): string {
    this.i++;
    let neg = false;
    if (this.peek() === '^') {
      neg = true;
      this.i++;
    }
    let body = '';
    let first = true;
    for (;;) {
      const c = this.peek();
      if (c === undefined) this.bad();
      if (c === ']') {
        if (first) this.bad();
        this.i++;
        break;
      }
      if (c === '-') {
        const nx = this.cs[this.i + 1];
        if (first || nx === ']') {
          this.i++;
          body += hex(45);
          first = false;
          continue;
        }
        this.bad();
      }
      first = false;
      const p = this.prop();
      if (p !== null) {
        body += p;
        continue;
      }
      const lo = this.ccChar();
      if (lo === null) this.bad();
      if (this.peek() === '-' && this.cs[this.i + 1] !== ']') {
        this.i++;
        const hi = this.ccChar();
        if (hi === null || hi < lo) this.bad();
        body += hex(lo) + '-' + hex(hi);
      } else {
        body += hex(lo);
      }
    }
    return '[' + (neg ? '^' : '') + body + ']';
  }
}

const cache = new Map<string, { m: RegExp; s: RegExp } | null>();

function compile(pattern: string): { m: RegExp; s: RegExp } | null {
  if (cache.has(pattern)) return cache.get(pattern)!;
  let res: { m: RegExp; s: RegExp } | null = null;
  try {
    const t = new Translator(Array.from(pattern));
    const src = t.regexp();
    if (t.i !== t.cs.length) throw new Invalid();
    res = { m: new RegExp('^(?:' + src + ')$', 'u'), s: new RegExp(src, 'u') };
  } catch {
    res = null;
  }
  cache.set(pattern, res);
  return res;
}

export function isValidRegexp(pattern: string): boolean {
  return compile(pattern) !== null;
}

export function iregexpMatch(s: string, pattern: string): boolean {
  const c = compile(pattern);
  return c !== null && c.m.test(s);
}

export function iregexpSearch(s: string, pattern: string): boolean {
  const c = compile(pattern);
  return c !== null && c.s.test(s);
}
