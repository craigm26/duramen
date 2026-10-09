// Order-preserving JSON parser; numbers keep their source text.

export class JNum {
  raw: string;
  n: number;
  constructor(raw: string) {
    this.raw = raw;
    this.n = Number(raw);
  }
}

export type JValue = null | boolean | string | JNum | JValue[] | Map<string, JValue>;

export class JsonError extends Error {}

const NUM_RE = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

export function parseJson(text: string): JValue {
  let i = 0;
  const fail = (): never => {
    throw new JsonError('invalid json');
  };
  const ws = () => {
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
      else break;
    }
  };
  const str = (): string => {
    i++; // opening quote
    let out = '';
    let start = i;
    for (;;) {
      if (i >= text.length) fail();
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        out += text.slice(start, i);
        i++;
        return out;
      }
      if (c < 0x20) fail();
      if (c === 0x5c) {
        out += text.slice(start, i);
        i++;
        const e = text[i];
        i++;
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
            const h = text.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(h)) fail();
            out += String.fromCharCode(parseInt(h, 16));
            i += 4;
            break;
          }
          default: fail();
        }
        start = i;
      } else {
        i++;
      }
    }
  };
  const value = (): JValue => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const m = new Map<string, JValue>();
      ws();
      if (text[i] === '}') {
        i++;
        return m;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail();
        const k = str();
        ws();
        if (text[i] !== ':') fail();
        i++;
        m.set(k, value());
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return m;
        }
        fail();
      }
    }
    if (c === '[') {
      i++;
      const a: JValue[] = [];
      ws();
      if (text[i] === ']') {
        i++;
        return a;
      }
      for (;;) {
        a.push(value());
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return a;
        }
        fail();
      }
    }
    if (c === '"') return str();
    if (text.startsWith('true', i)) { i += 4; return true; }
    if (text.startsWith('false', i)) { i += 5; return false; }
    if (text.startsWith('null', i)) { i += 4; return null; }
    NUM_RE.lastIndex = i;
    const m = NUM_RE.exec(text);
    if (!m) return fail();
    i += m[0].length;
    return new JNum(m[0]);
  };
  const v = value();
  ws();
  if (i !== text.length) fail();
  return v;
}

export function stringify(v: JValue): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (v instanceof JNum) return v.raw;
  if (Array.isArray(v)) return '[' + v.map(stringify).join(',') + ']';
  const parts: string[] = [];
  for (const [k, x] of v) parts.push(JSON.stringify(k) + ':' + stringify(x));
  return '{' + parts.join(',') + '}';
}
