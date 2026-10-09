// I-Regexp (RFC 9485) validation and translation to a JavaScript RegExp.

class Invalid extends Error {}

const SINGLE_ESC = new Set(Array.from('()*+-.?[\\]^{|}').map((c) => c.codePointAt(0)!));
const NORMAL_EXCLUDED = new Set(Array.from('.\\?*+{}()[]|').map((c) => c.codePointAt(0)!));
const PROPS: Record<string, string> = {
  L: 'lmotu', M: 'cen', N: 'dlo', P: 'cdefios', Z: 'lps', S: 'ckmo', C: 'cfno',
};

const hex = (c: number) => `\\u{${c.toString(16)}}`;

function translate(src: string): string {
  const cp = Array.from(src, (c) => c.codePointAt(0)!);
  let i = 0;

  // Returns the code point denoted by a single-character escape after the backslash.
  const singleEsc = (): number => {
    const e = cp[i];
    if (e === 0x6e) { i++; return 0x0a; }
    if (e === 0x72) { i++; return 0x0d; }
    if (e === 0x74) { i++; return 0x09; }
    if (e !== undefined && SINGLE_ESC.has(e)) { i++; return e; }
    throw new Invalid();
  };
  const category = (): string => {
    // at the letter p/P
    const neg = cp[i] === 0x50;
    i++;
    if (cp[i] !== 0x7b) throw new Invalid();
    i++;
    const first = String.fromCodePoint(cp[i] ?? 0);
    if (!(first in PROPS)) throw new Invalid();
    i++;
    let name = first;
    const second = cp[i] === undefined ? '' : String.fromCodePoint(cp[i]);
    if (second !== '' && PROPS[first].includes(second)) {
      name += second;
      i++;
    }
    if (cp[i] !== 0x7d) throw new Invalid();
    i++;
    return `\\${neg ? 'P' : 'p'}{${name}}`;
  };
  const classChar = (): number => {
    const c = cp[i];
    if (c === undefined || c === 0x2d || c === 0x5b || c === 0x5d) throw new Invalid();
    i++;
    if (c === 0x5c) return singleEsc();
    return c;
  };
  const charClass = (): string => {
    i++; // [
    let out = '[';
    if (cp[i] === 0x5e) {
      out += '^';
      i++;
    }
    if (cp[i] === 0x2d) {
      out += hex(0x2d);
      i++;
    } else if (cp[i] === 0x5d || cp[i] === undefined) {
      throw new Invalid();
    }
    for (;;) {
      const c = cp[i];
      if (c === undefined) throw new Invalid();
      if (c === 0x5d) {
        i++;
        return out + ']';
      }
      if (c === 0x2d) {
        i++;
        if (cp[i] !== 0x5d) throw new Invalid();
        out += hex(0x2d);
        continue;
      }
      if (c === 0x5c && (cp[i + 1] === 0x70 || cp[i + 1] === 0x50)) {
        i++;
        out += category();
        continue;
      }
      const lo = classChar();
      if (cp[i] === 0x2d && cp[i + 1] !== 0x5d) {
        i++;
        const hi = classChar();
        if (lo > hi) throw new Invalid();
        out += hex(lo) + '-' + hex(hi);
      } else {
        out += hex(lo);
      }
    }
  };
  const digits = (): string => {
    const s = i;
    while (cp[i] >= 0x30 && cp[i] <= 0x39) i++;
    if (i === s) throw new Invalid();
    return String.fromCodePoint(...cp.slice(s, i));
  };
  const quantifier = (): string => {
    const c = cp[i];
    if (c === 0x2a || c === 0x2b || c === 0x3f) {
      i++;
      return String.fromCodePoint(c);
    }
    if (c === 0x7b) {
      i++;
      const n = digits();
      let out = '{' + n;
      if (cp[i] === 0x2c) {
        i++;
        out += ',';
        if (cp[i] !== 0x7d) {
          const m = digits();
          if (BigInt(n) > BigInt(m)) throw new Invalid();
          out += m;
        }
      }
      if (cp[i] !== 0x7d) throw new Invalid();
      i++;
      return out + '}';
    }
    return '';
  };
  const alternation = (): string => {
    const branches: string[] = [];
    for (;;) {
      let branch = '';
      while (i < cp.length && cp[i] !== 0x7c && cp[i] !== 0x29) {
        const c = cp[i];
        let atom: string;
        if (c === 0x28) {
          i++;
          atom = '(?:' + alternation() + ')';
          if (cp[i] !== 0x29) throw new Invalid();
          i++;
        } else if (c === 0x5b) {
          atom = charClass();
        } else if (c === 0x2e) {
          i++;
          atom = '[^\\n\\r]';
        } else if (c === 0x5c) {
          i++;
          atom = cp[i] === 0x70 || cp[i] === 0x50 ? category() : hex(singleEsc());
        } else if (NORMAL_EXCLUDED.has(c)) {
          throw new Invalid();
        } else {
          i++;
          atom = hex(c);
        }
        branch += atom + quantifier();
      }
      branches.push(branch);
      if (cp[i] === 0x7c) {
        i++;
        continue;
      }
      return branches.join('|');
    }
  };
  const out = alternation();
  if (i < cp.length) throw new Invalid(); // stray ")"
  return out;
}

const cache = new Map<string, { full: RegExp; part: RegExp } | null>();

function compile(pattern: string) {
  let c = cache.get(pattern);
  if (c === undefined) {
    try {
      const body = translate(pattern);
      c = { full: new RegExp(`^(?:${body})$`, 'u'), part: new RegExp(body, 'u') };
    } catch (e) {
      if (!(e instanceof Invalid) && !(e instanceof SyntaxError)) throw e;
      c = null;
    }
    cache.set(pattern, c);
  }
  return c;
}

export function iregexpMatch(s: string, pattern: string, whole: boolean): boolean {
  const c = compile(pattern);
  if (!c) return false;
  return (whole ? c.full : c.part).test(s);
}
