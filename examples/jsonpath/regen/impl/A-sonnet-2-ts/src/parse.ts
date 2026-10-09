// JSONPath (RFC 9535) query parser: text -> AST, with validity (range, well-typedness) checks.
import { numberFromLexeme } from './json.ts';
import type { RawNum } from './json.ts';

export class QueryError extends Error {}

export type Selector =
  | { k: 'name'; name: string }
  | { k: 'index'; i: number }
  | { k: 'wild' }
  | { k: 'slice'; start: number | null; end: number | null; step: number | null }
  | { k: 'filter'; expr: Expr };
export interface Segment {
  desc: boolean;
  sels: Selector[];
}
export interface Query {
  root: '$' | '@';
  segs: Segment[];
  singular: boolean;
}
type FType = 'V' | 'L' | 'N';
export type Expr =
  | { t: 'or' | 'and'; items: Expr[] }
  | { t: 'not'; e: Expr }
  | { t: 'cmp'; op: string; l: Expr; r: Expr }
  | { t: 'exists'; q: Query }
  | { t: 'lit'; v: unknown }
  | { t: 'q'; q: Query }
  | { t: 'fn'; name: string; args: Expr[]; rt: FType };

const FUNCS: Record<string, { p: FType[]; r: FType }> = {
  length: { p: ['V'], r: 'V' },
  count: { p: ['N'], r: 'V' },
  match: { p: ['V', 'V'], r: 'L' },
  search: { p: ['V', 'V'], r: 'L' },
  value: { p: ['N'], r: 'V' },
};

const MAX_INT = 2 ** 53 - 1;
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

export function parseQuery(src: string): Query {
  let pos = 0;
  const fail = (msg = 'syntax error'): never => {
    throw new QueryError(`${msg} at ${pos}`);
  };
  const skipWs = () => {
    while (pos < src.length && ' \t\n\r'.includes(src[pos])) pos++;
  };
  const expect = (c: string) => {
    if (src[pos] !== c) fail(`expected ${c}`);
    pos++;
  };
  // Consumes optional blank space and then op if it follows; otherwise restores the position.
  const tryOp = (op: string): boolean => {
    const save = pos;
    skipWs();
    if (src.startsWith(op, pos)) {
      pos += op.length;
      return true;
    }
    pos = save;
    return false;
  };

  const parseInt_ = (): number => {
    const start = pos;
    if (src[pos] === '-') pos++;
    if (src[pos] === '0') pos++;
    else if (isDigit(src[pos])) while (isDigit(src[pos])) pos++;
    else fail('bad integer');
    const text = src.slice(start, pos);
    if (text === '-0') fail('-0 is not an integer');
    const n = Number(text);
    if (Math.abs(n) > MAX_INT) fail('integer out of range');
    return n;
  };
  const intStart = () => src[pos] === '-' || isDigit(src[pos]);

  const parseStringLit = (): string => {
    const q = src[pos++];
    let out = '';
    for (;;) {
      if (pos >= src.length) fail('unterminated string');
      const cp = src.codePointAt(pos)!;
      const c = String.fromCodePoint(cp);
      if (c === q) {
        pos++;
        return out;
      }
      if (cp < 0x20 || (cp >= 0xd800 && cp <= 0xdfff)) fail('bad character in string');
      if (c !== '\\') {
        out += c;
        pos += c.length;
        continue;
      }
      pos++;
      const e = src[pos++];
      const simple: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', '/': '/', '\\': '\\' };
      if (e === q) out += q;
      else if (e !== undefined && e in simple) out += simple[e];
      else if (e === 'u') {
        const hi = readHex4();
        if (hi >= 0xd800 && hi <= 0xdbff) {
          if (src[pos] !== '\\' || src[pos + 1] !== 'u') fail('lone surrogate');
          pos += 2;
          const lo = readHex4();
          if (lo < 0xdc00 || lo > 0xdfff) fail('lone surrogate');
          out += String.fromCharCode(hi, lo);
        } else if (hi >= 0xdc00 && hi <= 0xdfff) fail('lone surrogate');
        else out += String.fromCharCode(hi);
      } else fail('bad escape');
    }
  };
  const readHex4 = (): number => {
    const h = src.slice(pos, pos + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(h)) fail('bad \\u escape');
    pos += 4;
    return parseInt(h, 16);
  };

  const parseNumberLit = (): number | RawNum => {
    const start = pos;
    parseIntLexeme();
    if (src[pos] === '.') {
      pos++;
      if (!isDigit(src[pos])) fail('bad fraction');
      while (isDigit(src[pos])) pos++;
    }
    if (src[pos] === 'e' || src[pos] === 'E') {
      pos++;
      if (src[pos] === '+' || src[pos] === '-') pos++;
      if (!isDigit(src[pos])) fail('bad exponent');
      while (isDigit(src[pos])) pos++;
    }
    return numberFromLexeme(src.slice(start, pos));
  };
  const parseIntLexeme = () => {
    if (src[pos] === '-') pos++;
    if (src[pos] === '0') pos++;
    else if (isDigit(src[pos])) while (isDigit(src[pos])) pos++;
    else fail('bad number');
  };

  const parseShorthandName = (): string => {
    const start = pos;
    for (;;) {
      const cp = src.codePointAt(pos);
      if (cp === undefined) break;
      const first =
        (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || cp === 0x5f ||
        (cp >= 0x80 && !(cp >= 0xd800 && cp <= 0xdfff));
      if (!(first || (pos > start && cp >= 0x30 && cp <= 0x39))) break;
      pos += cp > 0xffff ? 2 : 1;
    }
    if (pos === start) fail('expected member name');
    return src.slice(start, pos);
  };

  const parseSelector = (): Selector => {
    const c = src[pos];
    if (c === '"' || c === "'") return { k: 'name', name: parseStringLit() };
    if (c === '*') {
      pos++;
      return { k: 'wild' };
    }
    if (c === '?') {
      pos++;
      skipWs();
      return { k: 'filter', expr: parseOr(false) };
    }
    if (c === ':' || intStart()) {
      const start = intStart() ? parseInt_() : null;
      skipWs();
      if (src[pos] !== ':') {
        if (start === null) fail();
        return { k: 'index', i: start! };
      }
      pos++;
      skipWs();
      const end = intStart() ? parseInt_() : null;
      skipWs();
      let step: number | null = null;
      if (src[pos] === ':') {
        pos++;
        skipWs();
        if (intStart()) step = parseInt_();
      }
      return { k: 'slice', start, end, step };
    }
    return fail('expected selector');
  };
  const parseBracketed = (): Selector[] => {
    expect('[');
    skipWs();
    const sels = [parseSelector()];
    for (;;) {
      skipWs();
      if (src[pos] === ',') {
        pos++;
        skipWs();
        sels.push(parseSelector());
      } else {
        expect(']');
        return sels;
      }
    }
  };
  const parseSegments = (): Segment[] => {
    const segs: Segment[] = [];
    for (;;) {
      const save = pos;
      skipWs();
      const c = src[pos];
      if (c === '[') segs.push({ desc: false, sels: parseBracketed() });
      else if (c === '.' && src[pos + 1] === '.') {
        pos += 2;
        if (src[pos] === '[') segs.push({ desc: true, sels: parseBracketed() });
        else if (src[pos] === '*') {
          pos++;
          segs.push({ desc: true, sels: [{ k: 'wild' }] });
        } else segs.push({ desc: true, sels: [{ k: 'name', name: parseShorthandName() }] });
      } else if (c === '.') {
        pos++;
        if (src[pos] === '*') {
          pos++;
          segs.push({ desc: false, sels: [{ k: 'wild' }] });
        } else segs.push({ desc: false, sels: [{ k: 'name', name: parseShorthandName() }] });
      } else {
        pos = save;
        return segs;
      }
    }
  };
  const parseRelOrAbs = (): Query => {
    const root = src[pos] as '$' | '@';
    pos++;
    const segs = parseSegments();
    const singular = segs.every((s) => !s.desc && s.sels.length === 1 && (s.sels[0].k === 'name' || s.sels[0].k === 'index'));
    return { root, segs, singular };
  };

  // ---- filter expressions ----
  const isLogical = (e: Expr) => e.t === 'or' || e.t === 'and' || e.t === 'not' || e.t === 'cmp' || e.t === 'exists';
  const toLogical = (e: Expr): Expr => {
    if (isLogical(e)) return e;
    if (e.t === 'q') return { t: 'exists', q: e.q };
    if (e.t === 'fn' && e.rt === 'L') return e;
    return fail('not usable as a logical expression');
  };
  const parseFn = (name: string): Expr => {
    const sig = FUNCS[name];
    if (!sig) fail(`unknown function ${name}`);
    expect('(');
    skipWs();
    const args: Expr[] = [];
    if (src[pos] !== ')') {
      for (;;) {
        args.push(parseOr(true));
        skipWs();
        if (src[pos] === ',') {
          pos++;
          skipWs();
        } else break;
      }
    }
    expect(')');
    if (args.length !== sig.p.length) fail('wrong number of arguments');
    args.forEach((a, i) => checkArg(a, sig.p[i]));
    return { t: 'fn', name, args, rt: sig.r };
  };
  const checkArg = (a: Expr, p: FType) => {
    const ok =
      p === 'V' ? a.t === 'lit' || (a.t === 'q' && a.q.singular) || (a.t === 'fn' && a.rt === 'V')
      : p === 'N' ? a.t === 'q'
      : isLogical(a) || a.t === 'q' || (a.t === 'fn' && a.rt !== 'V');
    if (!ok) fail('ill-typed function argument');
  };
  const parseOperand = (): Expr => {
    const c = src[pos];
    if (c === '@' || c === '$') return { t: 'q', q: parseRelOrAbs() };
    if (c === '"' || c === "'") return { t: 'lit', v: parseStringLit() };
    if (c === '-' || isDigit(c)) return { t: 'lit', v: parseNumberLit() };
    if (c !== undefined && c >= 'a' && c <= 'z') {
      const start = pos;
      while (pos < src.length && /[a-z0-9_]/.test(src[pos])) pos++;
      const name = src.slice(start, pos);
      if (src[pos] === '(') return parseFn(name);
      if (name === 'true') return { t: 'lit', v: true };
      if (name === 'false') return { t: 'lit', v: false };
      if (name === 'null') return { t: 'lit', v: null };
      return fail('unexpected identifier');
    }
    return fail('expected expression');
  };
  const isComparable = (e: Expr) => e.t === 'lit' || (e.t === 'q' && e.q.singular) || (e.t === 'fn' && e.rt === 'V');
  const parseBasic = (bare: boolean): Expr => {
    let neg = false;
    if (src[pos] === '!') {
      neg = true;
      pos++;
      skipWs();
    }
    if (src[pos] === '(') {
      pos++;
      skipWs();
      const e = parseOr(false);
      skipWs();
      expect(')');
      return neg ? { t: 'not', e } : e;
    }
    const left = parseOperand();
    const save = pos;
    skipWs();
    const m = /^(==|!=|<=|>=|<|>)/.exec(src.slice(pos, pos + 2));
    if (m) {
      if (neg || !isComparable(left)) fail('bad comparison');
      pos += m[1].length;
      skipWs();
      const right = parseOperand();
      if (!isComparable(right)) fail('bad comparison');
      return { t: 'cmp', op: m[1], l: left, r: right };
    }
    pos = save;
    if (neg) return { t: 'not', e: toLogical(left) };
    return bare ? left : toLogical(left);
  };
  const parseAnd = (bare: boolean): Expr => {
    const first = parseBasic(bare);
    if (!tryOp('&&')) return first;
    const items = [toLogical(first)];
    do {
      skipWs();
      items.push(toLogical(parseBasic(false)));
    } while (tryOp('&&'));
    return { t: 'and', items };
  };
  function parseOr(bare: boolean): Expr {
    const first = parseAnd(bare);
    if (!tryOp('||')) return first;
    const items = [toLogical(first)];
    do {
      skipWs();
      items.push(toLogical(parseAnd(false)));
    } while (tryOp('||'));
    return { t: 'or', items };
  }

  if (src[0] !== '$') fail('query must start with $');
  const q = parseRelOrAbs();
  if (pos !== src.length) fail('unexpected trailing characters');
  return q;
}
