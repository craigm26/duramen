// JSON text in and out. Numbers keep their source text and an exact decimal
// reading (sign, digits, power of ten), so comparisons are exact and output
// reproduces the number as it was written.

export class Num {
  text: string;
  sign: number;
  mant: bigint;
  exp: number;
  constructor(text: string, sign: number, mant: bigint, exp: number) {
    this.text = text;
    this.sign = sign;
    this.mant = mant;
    this.exp = exp;
  }
}

export type Json = null | boolean | string | Num | Json[] | Map<string, Json>;

export class JsonError extends Error {}

const NUMBER = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
const NUMBER_AT = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

// Reads a JSON number lexeme (also the JSONPath number grammar); null if malformed.
export function numberFrom(text: string): Num | null {
  const m = NUMBER.exec(text);
  if (m === null) return null;
  const frac = m[3] ?? '';
  const digits = (m[2] + frac).replace(/^0+/, '');
  const trimmed = digits.replace(/0+$/, '');
  if (trimmed === '') return new Num(text, 0, 0n, 0);
  const exp = Number(m[4] ?? '0') - frac.length + (digits.length - trimmed.length);
  return new Num(text, m[1] === '-' ? -1 : 1, BigInt(trimmed), exp);
}

export function intNum(n: number): Num {
  return numberFrom(String(n)) as Num;
}

// Exact three-way comparison of two numbers.
export function compareNum(a: Num, b: Num): number {
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
  if (a.sign === 0) return 0;
  const magA = a.mant.toString().length + a.exp;
  const magB = b.mant.toString().length + b.exp;
  let c: number;
  if (magA !== magB) {
    c = magA < magB ? -1 : 1;
  } else {
    // Equal orders of magnitude bound the power-of-ten gap by the digit counts.
    const e = Math.min(a.exp, b.exp);
    const x = a.mant * 10n ** BigInt(a.exp - e);
    const y = b.mant * 10n ** BigInt(b.exp - e);
    c = x < y ? -1 : x > y ? 1 : 0;
  }
  return a.sign < 0 ? -c : c;
}

// Strict RFC 8259 parser. Objects become Maps in member order; a repeated name
// keeps its first position and takes the last value.
export function parseJson(text: string): Json {
  let i = 0;
  const fail = (): never => {
    throw new JsonError(`bad JSON at ${i}`);
  };
  const ws = (): void => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };
  const string = (): string => {
    i++;
    let out = '';
    for (;;) {
      const c = text[i];
      if (c === undefined) fail();
      if (c === '"') {
        i++;
        return out;
      }
      if (c === '\\') {
        const e = text[i + 1];
        i += 2;
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
        continue;
      }
      if (c < ' ') fail();
      out += c;
      i++;
    }
  };
  const array = (): Json[] => {
    i++;
    const arr: Json[] = [];
    ws();
    if (text[i] === ']') {
      i++;
      return arr;
    }
    for (;;) {
      arr.push(value());
      ws();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === ']') {
        i++;
        return arr;
      }
      fail();
    }
  };
  const object = (): Map<string, Json> => {
    i++;
    const map = new Map<string, Json>();
    ws();
    if (text[i] === '}') {
      i++;
      return map;
    }
    for (;;) {
      ws();
      if (text[i] !== '"') fail();
      const key = string();
      ws();
      if (text[i] !== ':') fail();
      i++;
      map.set(key, value());
      ws();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') {
        i++;
        return map;
      }
      fail();
    }
  };
  const value = (): Json => {
    ws();
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (text.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return null;
    }
    NUMBER_AT.lastIndex = i;
    const m = NUMBER_AT.exec(text);
    if (m === null) fail();
    i += m[0].length;
    return numberFrom(m[0]) as Num;
  };
  const result = value();
  ws();
  if (i !== text.length) fail();
  return result;
}

export function serialize(v: Json): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (v instanceof Num) return v.text;
  if (Array.isArray(v)) return '[' + v.map((x) => serialize(x)).join(',') + ']';
  const parts: string[] = [];
  for (const [k, x] of v) parts.push(JSON.stringify(k) + ':' + serialize(x));
  return '{' + parts.join(',') + '}';
}
