// Strict JSON (RFC 8259) reader and writer. A number keeps its source text, so
// output reproduces it exactly even where a double cannot (see Num).

// A JSON number: its source text, and its double value for comparisons.
export class Num {
  text: string;
  n: number;

  constructor(text: string, n: number) {
    this.text = text;
    this.n = n;
  }
}

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const SIMPLE: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

// A JSON object (not an array, a number or a primitive). Objects are built
// without a prototype, so any member name, even "__proto__", is an own name.
export function isObject(v: any): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Num);
}

export function parseJson(text: string): any {
  let i = 0;
  const fail = (): never => {
    throw new SyntaxError(`invalid JSON at offset ${i}`);
  };
  const skip = (): void => {
    while (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r') i++;
  };
  const string = (): string => {
    i++;
    let out = '';
    for (;;) {
      const c = text[i++];
      if (c === undefined || c < ' ') return fail();
      if (c === '"') return out;
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = text[i++];
      if (e !== undefined && Object.hasOwn(SIMPLE, e)) {
        out += SIMPLE[e];
        continue;
      }
      if (e !== 'u' || !/^[0-9a-fA-F]{4}$/.test(text.slice(i, i + 4))) return fail();
      out += String.fromCharCode(parseInt(text.slice(i, i + 4), 16));
      i += 4;
    }
  };
  const object = (): any => {
    i++;
    const o = Object.create(null);
    skip();
    if (text[i] === '}') {
      i++;
      return o;
    }
    for (;;) {
      skip();
      if (text[i] !== '"') return fail();
      const key = string();
      skip();
      if (text[i] !== ':') return fail();
      i++;
      skip();
      o[key] = value();
      skip();
      if (text[i] === ',') {
        i++;
      } else if (text[i] === '}') {
        i++;
        return o;
      } else {
        return fail();
      }
    }
  };
  const array = (): any[] => {
    i++;
    const a: any[] = [];
    skip();
    if (text[i] === ']') {
      i++;
      return a;
    }
    for (;;) {
      skip();
      a.push(value());
      skip();
      if (text[i] === ',') {
        i++;
      } else if (text[i] === ']') {
        i++;
        return a;
      } else {
        return fail();
      }
    }
  };
  const value = (): any => {
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
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m === null) return fail();
    i += m[0].length;
    return new Num(m[0], Number(m[0]));
  };
  skip();
  const v = value();
  skip();
  if (i !== text.length) fail();
  return v;
}

// Serializes a parsed value (or a plain object or array of them) as one JSON text.
export function stringify(v: any): string {
  if (v instanceof Num) return v.text;
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'object' || v === null) return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => stringify(x)).join(',')}]`;
  return `{${Object.keys(v).map((k) => `${JSON.stringify(k)}:${stringify(v[k])}`).join(',')}}`;
}
