// JSONPath query parser (RFC 9535 grammar as given in SPEC Appendix A).
import { JNum } from './json.ts';
import type { JValue } from './json.ts';

export class QueryError extends Error {}

export type Selector =
  | { k: 'name'; name: string }
  | { k: 'wild' }
  | { k: 'idx'; i: number }
  | { k: 'slice'; start: number | null; end: number | null; step: number | null }
  | { k: 'filter'; e: Expr };
export type Segment = { desc: boolean; sels: Selector[] };
export type FQuery = { k: 'q'; root: '@' | '$'; segs: Segment[]; singular: boolean };
export type Lit = { k: 'lit'; v: JValue };
export type Fn = { k: 'fn'; name: string; args: Expr[]; ret: 'value' | 'logical' };
export type Expr =
  | Lit
  | FQuery
  | Fn
  | { k: 'or' | 'and'; l: Expr; r: Expr }
  | { k: 'not' | 'paren'; e: Expr }
  | { k: 'cmp'; op: string; l: Expr; r: Expr };

const MAX_INT = 9007199254740991n;
const SIGS: Record<string, { params: ('V' | 'N')[]; ret: 'value' | 'logical' }> = {
  length: { params: ['V'], ret: 'value' },
  count: { params: ['N'], ret: 'value' },
  match: { params: ['V', 'V'], ret: 'logical' },
  search: { params: ['V', 'V'], ret: 'logical' },
  value: { params: ['N'], ret: 'value' },
};

const isDigit = (c: number | undefined) => c !== undefined && c >= 0x30 && c <= 0x39;
const isAlpha = (c: number | undefined) =>
  c !== undefined && ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a));
const isNameFirst = (c: number | undefined) => isAlpha(c) || c === 0x5f || (c !== undefined && c >= 0x80);
const isHex = (c: number | undefined) =>
  isDigit(c) || (c !== undefined && ((c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66)));
const ch = (s: string) => s.charCodeAt(0);

export function parseQuery(text: string): Segment[] {
  const cp = Array.from(text, (c) => c.codePointAt(0)!);
  for (const c of cp) if (c >= 0xd800 && c <= 0xdfff) throw new QueryError('surrogate');
  let pos = 0;
  const fail = (): never => {
    throw new QueryError('invalid query');
  };
  const peek = (o = 0) => cp[pos + o];
  const isBlank = (c: number | undefined) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
  const skipS = () => {
    while (isBlank(cp[pos])) pos++;
  };
  const expect = (s: string) => {
    if (cp[pos] !== ch(s)) fail();
    pos++;
  };
  const lookingAt = (s: string) => {
    for (let k = 0; k < s.length; k++) if (cp[pos + k] !== s.charCodeAt(k)) return false;
    return true;
  };

  const parseInteger = (): number => {
    const s = pos;
    if (peek() === ch('-')) pos++;
    const d = pos;
    while (isDigit(peek())) pos++;
    const digits = cp.slice(d, pos);
    if (digits.length === 0) fail();
    if (digits[0] === 0x30 && (digits.length > 1 || cp[s] === ch('-'))) fail();
    const big = BigInt(String.fromCodePoint(...cp.slice(s, pos)));
    if (big > MAX_INT || big < -MAX_INT) fail();
    return Number(big);
  };

  const parseString = (): string => {
    const q = cp[pos++];
    let out = '';
    const hex4 = (): number => {
      let v = 0;
      for (let k = 0; k < 4; k++) {
        if (!isHex(peek())) fail();
        v = v * 16 + parseInt(String.fromCodePoint(cp[pos++]), 16);
      }
      return v;
    };
    for (;;) {
      const c = cp[pos++];
      if (c === undefined || c < 0x20) return fail();
      if (c === q) return out;
      if (c !== 0x5c) {
        out += String.fromCodePoint(c);
        continue;
      }
      const e = cp[pos++];
      if (e === q) out += String.fromCodePoint(q);
      else if (e === ch('"') || e === ch("'")) fail();
      else if (e === ch('b')) out += '\b';
      else if (e === ch('f')) out += '\f';
      else if (e === ch('n')) out += '\n';
      else if (e === ch('r')) out += '\r';
      else if (e === ch('t')) out += '\t';
      else if (e === ch('/')) out += '/';
      else if (e === ch('\\')) out += '\\';
      else if (e === ch('u')) {
        const v = hex4();
        if (v >= 0xd800 && v <= 0xdbff) {
          if (peek() !== 0x5c || peek(1) !== ch('u')) fail();
          pos += 2;
          const lo = hex4();
          if (lo < 0xdc00 || lo > 0xdfff) fail();
          out += String.fromCodePoint(0x10000 + (v - 0xd800) * 0x400 + (lo - 0xdc00));
        } else if (v >= 0xdc00 && v <= 0xdfff) {
          fail();
        } else {
          out += String.fromCodePoint(v);
        }
      } else fail();
    }
  };

  const parseShorthand = (): string => {
    if (!isNameFirst(peek())) fail();
    const s = pos;
    while (isNameFirst(peek()) || isDigit(peek())) pos++;
    return String.fromCodePoint(...cp.slice(s, pos));
  };

  // ---- segments ----
  const parseBracketed = (): { sels: Selector[]; plain: boolean } => {
    expect('[');
    let plain = !isBlank(peek());
    skipS();
    const sels: Selector[] = [parseSelector()];
    for (;;) {
      if (isBlank(peek())) plain = false;
      skipS();
      if (peek() === ch(',')) {
        pos++;
        skipS();
        sels.push(parseSelector());
      } else break;
    }
    expect(']');
    const only = sels[0];
    return { sels, plain: plain && sels.length === 1 && (only.k === 'name' || only.k === 'idx') };
  };

  const startsInt = (c: number | undefined) => c === ch('-') || isDigit(c);
  const parseSelector = (): Selector => {
    const c = peek();
    if (c === ch('"') || c === ch("'")) return { k: 'name', name: parseString() };
    if (c === ch('*')) {
      pos++;
      return { k: 'wild' };
    }
    if (c === ch('?')) {
      pos++;
      skipS();
      return { k: 'filter', e: asLogical(parseOr()) };
    }
    let start: number | null = null;
    if (startsInt(c)) {
      start = parseInteger();
      const save = pos;
      skipS();
      if (peek() !== ch(':')) {
        pos = save;
        return { k: 'idx', i: start };
      }
    } else if (c !== ch(':')) {
      return fail();
    }
    expect(':');
    skipS();
    let end: number | null = null;
    let step: number | null = null;
    if (startsInt(peek())) end = parseInteger();
    skipS();
    if (peek() === ch(':')) {
      pos++;
      skipS();
      if (startsInt(peek())) step = parseInteger();
    }
    return { k: 'slice', start, end, step };
  };

  const parseSegment = (): { seg: Segment; singular: boolean } => {
    if (peek() === ch('[')) {
      const b = parseBracketed();
      return { seg: { desc: false, sels: b.sels }, singular: b.plain };
    }
    expect('.');
    if (peek() === ch('.')) {
      pos++;
      if (peek() === ch('[')) return { seg: { desc: true, sels: parseBracketed().sels }, singular: false };
      if (peek() === ch('*')) {
        pos++;
        return { seg: { desc: true, sels: [{ k: 'wild' }] }, singular: false };
      }
      return { seg: { desc: true, sels: [{ k: 'name', name: parseShorthand() }] }, singular: false };
    }
    if (peek() === ch('*')) {
      pos++;
      return { seg: { desc: false, sels: [{ k: 'wild' }] }, singular: false };
    }
    return { seg: { desc: false, sels: [{ k: 'name', name: parseShorthand() }] }, singular: true };
  };

  const parseSegments = (): { segs: Segment[]; singular: boolean } => {
    const segs: Segment[] = [];
    let singular = true;
    for (;;) {
      const save = pos;
      skipS();
      if (peek() !== ch('[') && peek() !== ch('.')) {
        pos = save;
        return { segs, singular };
      }
      const r = parseSegment();
      segs.push(r.seg);
      if (!r.singular) singular = false;
    }
  };

  // ---- filter expressions ----
  const asLogical = (e: Expr): Expr => {
    if (e.k === 'lit') fail();
    if (e.k === 'fn' && e.ret !== 'logical') fail();
    return e;
  };
  const isComparable = (e: Expr) =>
    e.k === 'lit' || (e.k === 'q' && e.singular) || (e.k === 'fn' && e.ret === 'value');

  const parseNumber = (): JNum => {
    const s = pos;
    if (peek() === ch('-')) pos++;
    if (peek() === ch('0')) pos++;
    else if (isDigit(peek())) while (isDigit(peek())) pos++;
    else fail();
    if (peek() === ch('.') && isDigit(peek(1))) {
      pos++;
      while (isDigit(peek())) pos++;
    }
    if (peek() === ch('e') || peek() === ch('E')) {
      const k = peek(1) === ch('+') || peek(1) === ch('-') ? 2 : 1;
      if (isDigit(peek(k))) {
        pos += k;
        while (isDigit(peek())) pos++;
      }
    }
    return new JNum(String.fromCodePoint(...cp.slice(s, pos)));
  };

  const parseFQuery = (): FQuery => {
    const root = cp[pos] === ch('@') ? '@' : '$';
    pos++;
    const { segs, singular } = parseSegments();
    return { k: 'q', root, segs, singular };
  };

  const checkArg = (a: Expr, p: 'V' | 'N') => {
    if (p === 'N') {
      if (a.k !== 'q') fail();
    } else if (!(a.k === 'lit' || (a.k === 'q' && a.singular) || (a.k === 'fn' && a.ret === 'value'))) {
      fail();
    }
  };

  const parsePrimary = (): Expr => {
    const c = peek();
    if (c === ch('@') || c === ch('$')) return parseFQuery();
    if (c === ch('"') || c === ch("'")) return { k: 'lit', v: parseString() };
    if (c === ch('-') || isDigit(c)) return { k: 'lit', v: parseNumber() };
    if (c !== undefined && c >= 0x61 && c <= 0x7a) {
      const s = pos;
      while (
        (peek() !== undefined && peek() >= 0x61 && peek() <= 0x7a) ||
        isDigit(peek()) ||
        peek() === ch('_')
      )
        pos++;
      const name = String.fromCodePoint(...cp.slice(s, pos));
      if (peek() === ch('(')) {
        const sig = SIGS[name];
        if (!Object.hasOwn(SIGS, name)) fail();
        pos++;
        skipS();
        const args: Expr[] = [];
        if (peek() !== ch(')')) {
          args.push(parseOr());
          for (;;) {
            skipS();
            if (peek() !== ch(',')) break;
            pos++;
            skipS();
            args.push(parseOr());
          }
        }
        skipS();
        expect(')');
        if (args.length !== sig.params.length) fail();
        args.forEach((a, k) => checkArg(a, sig.params[k]));
        return { k: 'fn', name, args, ret: sig.ret };
      }
      if (name === 'true') return { k: 'lit', v: true };
      if (name === 'false') return { k: 'lit', v: false };
      if (name === 'null') return { k: 'lit', v: null };
    }
    return fail();
  };

  const parseParen = (): Expr => {
    expect('(');
    skipS();
    const e = asLogical(parseOr());
    skipS();
    expect(')');
    return { k: 'paren', e };
  };

  const parseBasic = (): Expr => {
    if (peek() === ch('!')) {
      pos++;
      skipS();
      if (peek() === ch('(')) return { k: 'not', e: parseParen() };
      const p = parsePrimary();
      if (p.k !== 'q' && p.k !== 'fn') fail();
      return { k: 'not', e: asLogical(p) };
    }
    if (peek() === ch('(')) return parseParen();
    const l = parsePrimary();
    const save = pos;
    skipS();
    let op = '';
    for (const o of ['==', '!=', '<=', '>=', '<', '>']) {
      if (lookingAt(o)) {
        op = o;
        break;
      }
    }
    if (!op) {
      pos = save;
      return l;
    }
    pos += op.length;
    skipS();
    const r = parsePrimary();
    if (!isComparable(l) || !isComparable(r)) fail();
    return { k: 'cmp', op, l, r };
  };

  const parseChain = (sep: string, kind: 'or' | 'and', next: () => Expr): Expr => {
    let node = next();
    let multi = false;
    for (;;) {
      const save = pos;
      skipS();
      if (!lookingAt(sep)) {
        pos = save;
        return node;
      }
      pos += 2;
      skipS();
      if (!multi) {
        node = asLogical(node);
        multi = true;
      }
      node = { k: kind, l: node, r: asLogical(next()) };
    }
  };
  const parseAnd = (): Expr => parseChain('&&', 'and', parseBasic);
  const parseOr = (): Expr => parseChain('||', 'or', parseAnd);

  expect('$');
  const { segs } = parseSegments();
  if (pos !== cp.length) fail();
  return segs;
}
