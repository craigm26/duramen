// I-Regexp (RFC 9485) checker; translates a valid I-Regexp to an ECMAScript "u" regexp source.

const CATEGORIES = new Set([
  'L', 'Ll', 'Lm', 'Lo', 'Lt', 'Lu', 'M', 'Mc', 'Me', 'Mn', 'N', 'Nd', 'Nl', 'No',
  'P', 'Pc', 'Pd', 'Pe', 'Pf', 'Pi', 'Po', 'Ps', 'Z', 'Zl', 'Zp', 'Zs',
  'S', 'Sc', 'Sk', 'Sm', 'So', 'C', 'Cc', 'Cf', 'Cn', 'Co',
]);

class Bad extends Error {}

const lit = (cp: number) => `\\u{${cp.toString(16)}}`;
const inRange = (c: number, lo: number, hi: number) => c >= lo && c <= hi;

function isNormalChar(c: number): boolean {
  return (
    inRange(c, 0x00, 0x27) || c === 0x2c || c === 0x2d || inRange(c, 0x2f, 0x3e) ||
    inRange(c, 0x40, 0x5a) || inRange(c, 0x5e, 0x7a) || inRange(c, 0x7e, 0xd7ff) ||
    inRange(c, 0xe000, 0x10ffff)
  );
}

function isCCchar(c: number): boolean {
  return (
    inRange(c, 0x00, 0x2c) || inRange(c, 0x2e, 0x5a) || inRange(c, 0x5e, 0xd7ff) ||
    inRange(c, 0xe000, 0x10ffff)
  );
}

const isSingleEsc = (c: number) =>
  inRange(c, 0x28, 0x2b) || c === 0x2d || c === 0x2e || c === 0x3f || inRange(c, 0x5b, 0x5e) ||
  c === 0x6e || c === 0x72 || c === 0x74 || inRange(c, 0x7b, 0x7d);

function translate(pat: string): string {
  const cps = Array.from(pat, (ch) => ch.codePointAt(0)!);
  let pos = 0;
  const bad = (): never => {
    throw new Bad();
  };
  const ch = (c: string) => cps[pos] === c.charCodeAt(0);

  // After a backslash (pos at the char after it): a SingleCharEsc code point.
  const singleEsc = (): number => {
    const c = cps[pos];
    if (c === undefined || !isSingleEsc(c)) bad();
    pos++;
    return c === 0x6e ? 0x0a : c === 0x72 ? 0x0d : c === 0x74 ? 0x09 : c;
  };
  // At 'p' or 'P' after a backslash.
  const category = (): string => {
    const neg = cps[pos] === 0x50;
    pos++;
    if (!ch('{')) bad();
    pos++;
    let name = '';
    while (pos < cps.length && !ch('}')) name += String.fromCodePoint(cps[pos++]);
    if (!ch('}') || !CATEGORIES.has(name)) bad();
    pos++;
    return `\\${neg ? 'P' : 'p'}{${name}}`;
  };
  const isCat = () => cps[pos] === 0x70 || cps[pos] === 0x50;

  const charClass = (): string => {
    pos++; // [
    let neg = false;
    if (ch('^')) {
      neg = true;
      pos++;
    }
    let out = '';
    let count = 0;
    if (ch('-')) {
      out += lit(0x2d);
      pos++;
      count++;
    }
    for (;;) {
      const c = cps[pos];
      if (c === undefined) bad();
      if (c === 0x5d) {
        pos++;
        break;
      }
      if (c === 0x2d) {
        // only a trailing "-" is allowed here
        if (cps[pos + 1] !== 0x5d) bad();
        out += lit(0x2d);
        pos++;
        count++;
        continue;
      }
      let lo: number;
      if (c === 0x5c) {
        pos++;
        if (isCat()) {
          out += category();
          count++;
          continue;
        }
        lo = singleEsc();
      } else {
        if (!isCCchar(c)) bad();
        lo = c;
        pos++;
      }
      count++;
      if (cps[pos] === 0x2d && cps[pos + 1] !== 0x5d) {
        pos++;
        let hi: number;
        if (ch('\\')) {
          pos++;
          hi = singleEsc();
        } else {
          hi = cps[pos];
          if (hi === undefined || !isCCchar(hi)) bad();
          pos++;
        }
        if (hi < lo) bad();
        out += `${lit(lo)}-${lit(hi)}`;
      } else {
        out += lit(lo);
      }
    }
    if (count === 0) bad(); // "[]" and "[^]"
    return `[${neg ? '^' : ''}${out}]`;
  };

  const atom = (depth: number): string => {
    const c = cps[pos];
    if (c === 0x28) {
      pos++;
      const inner = alternation(depth + 1);
      if (!ch(')')) bad();
      pos++;
      return `(?:${inner})`;
    }
    if (c === 0x2e) {
      pos++;
      return '[^\\n\\r]';
    }
    if (c === 0x5b) return charClass();
    if (c === 0x5c) {
      pos++;
      if (isCat()) return category();
      return lit(singleEsc());
    }
    if (c === undefined || !isNormalChar(c)) bad();
    pos++;
    return lit(c);
  };
  const quantExact = (): string => {
    let s = '';
    while (pos < cps.length && inRange(cps[pos], 0x30, 0x39)) s += String.fromCharCode(cps[pos++]);
    if (s === '') bad();
    return s;
  };
  const piece = (depth: number): string => {
    const a = atom(depth);
    const c = cps[pos];
    if (c === 0x2a || c === 0x2b || c === 0x3f) {
      pos++;
      return a + String.fromCharCode(c);
    }
    if (c === 0x7b) {
      pos++;
      const lo = quantExact();
      let q = `{${lo}`;
      if (ch(',')) {
        pos++;
        q += ',';
        if (inRange(cps[pos] ?? 0, 0x30, 0x39)) {
          const hi = quantExact();
          if (Number(hi) < Number(lo)) bad();
          q += hi;
        }
      }
      if (!ch('}')) bad();
      pos++;
      return a + q + '}';
    }
    return a;
  };
  const alternation = (depth: number): string => {
    const branches: string[] = [];
    for (;;) {
      let b = '';
      while (pos < cps.length && !ch('|') && !(depth > 0 && ch(')'))) b += piece(depth);
      branches.push(b);
      if (ch('|')) pos++;
      else break;
    }
    return branches.join('|');
  };

  const src = alternation(0);
  if (pos !== cps.length) bad();
  return src;
}

const cache = new Map<string, RegExp | null>();

// Returns a compiled regexp for the I-Regexp, anchored to the whole string or not; null if invalid.
export function compile(pattern: string, whole: boolean): RegExp | null {
  const key = (whole ? 'm' : 's') + pattern;
  if (cache.has(key)) return cache.get(key)!;
  let re: RegExp | null = null;
  try {
    const body = translate(pattern);
    re = new RegExp(whole ? `^(?:${body})$` : `(?:${body})`, 'u');
  } catch {
    re = null;
  }
  cache.set(key, re);
  return re;
}
