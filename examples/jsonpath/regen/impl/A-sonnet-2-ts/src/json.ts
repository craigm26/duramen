// Strict JSON parser and serializer that keep numbers exact where a JS number cannot.

// A number whose lexeme a JS number cannot carry exactly (huge integers, overflow, long decimals).
export class RawNum {
  text: string;
  n: number;
  constructor(text: string, n: number) {
    this.text = text;
    this.n = n;
  }
}

export class JsonError extends Error {}

// A JS number when it carries the lexeme exactly, else a RawNum that keeps the text.
export function numberFromLexeme(text: string): number | RawNum {
  const n = Number(text);
  if (!Number.isFinite(n)) return new RawNum(text, n);
  if (/^-?[0-9]+$/.test(text)) return Number.isSafeInteger(n) ? n : new RawNum(text, n);
  const digits = text.replace(/[eE].*$/, '').replace(/[-.]/g, '').replace(/^0+/, '').replace(/0+$/, '');
  return digits.length > 15 ? new RawNum(text, n) : n;
}

const NUM = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;
const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);

export function parseJson(src: string): unknown {
  let pos = 0;
  const fail = (): never => {
    throw new JsonError(`invalid JSON at ${pos}`);
  };
  const skip = () => {
    while (pos < src.length && WS.has(src.charCodeAt(pos))) pos++;
  };
  const parseString = (): string => {
    pos++; // opening quote
    let out = '';
    let start = pos;
    for (;;) {
      if (pos >= src.length) fail();
      const c = src.charCodeAt(pos);
      if (c === 0x22) {
        out += src.slice(start, pos);
        pos++;
        return out;
      }
      if (c < 0x20) fail();
      if (c === 0x5c) {
        out += src.slice(start, pos);
        pos++;
        const e = src[pos];
        pos++;
        switch (e) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'u': {
            const hex = src.slice(pos, pos + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
            out += String.fromCharCode(parseInt(hex, 16));
            pos += 4;
            break;
          }
          default: fail();
        }
        start = pos;
      } else {
        pos++;
      }
    }
  };
  const parseNumber = (): unknown => {
    NUM.lastIndex = pos;
    const m = NUM.exec(src);
    if (!m) fail();
    pos += m![0].length;
    return numberFromLexeme(m![0]);
  };
  const parseValue = (): unknown => {
    skip();
    const c = src[pos];
    if (c === '{') {
      pos++;
      const obj: Record<string, unknown> = Object.create(null);
      skip();
      if (src[pos] === '}') {
        pos++;
        return obj;
      }
      for (;;) {
        skip();
        if (src[pos] !== '"') fail();
        const k = parseString();
        skip();
        if (src[pos] !== ':') fail();
        pos++;
        obj[k] = parseValue();
        skip();
        if (src[pos] === ',') pos++;
        else if (src[pos] === '}') {
          pos++;
          return obj;
        } else fail();
      }
    }
    if (c === '[') {
      pos++;
      const arr: unknown[] = [];
      skip();
      if (src[pos] === ']') {
        pos++;
        return arr;
      }
      for (;;) {
        arr.push(parseValue());
        skip();
        if (src[pos] === ',') pos++;
        else if (src[pos] === ']') {
          pos++;
          return arr;
        } else fail();
      }
    }
    if (c === '"') return parseString();
    if (src.startsWith('true', pos)) { pos += 4; return true; }
    if (src.startsWith('false', pos)) { pos += 5; return false; }
    if (src.startsWith('null', pos)) { pos += 4; return null; }
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) return parseNumber();
    return fail();
  };
  const v = parseValue();
  skip();
  if (pos !== src.length) fail();
  return v;
}

export function stringify(v: unknown): string {
  if (v instanceof RawNum) return v.text;
  if (Array.isArray(v)) return '[' + v.map(stringify).join(',') + ']';
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).map((k) => JSON.stringify(k) + ':' + stringify(o[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}
