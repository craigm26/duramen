// JSON values that keep member order and the original number text.

export class JNum {
  raw: string;
  v: number;
  constructor(raw: string, v: number) {
    this.raw = raw;
    this.v = v;
  }
}

export type Value = null | boolean | string | JNum | Value[] | Map<string, Value>;

class Parser {
  s: string;
  i = 0;
  constructor(s: string) {
    this.s = s;
  }

  fail(): never {
    throw new SyntaxError('bad json');
  }

  ws(): void {
    const s = this.s;
    while (this.i < s.length) {
      const c = s.charCodeAt(this.i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.i++;
      else break;
    }
  }

  value(): Value {
    this.ws();
    const s = this.s;
    const c = s[this.i];
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '"') return this.string();
    if (c === 't') return this.word('true', true);
    if (c === 'f') return this.word('false', false);
    if (c === 'n') return this.word('null', null);
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) return this.number();
    return this.fail();
  }

  word(w: string, v: Value): Value {
    if (this.s.startsWith(w, this.i)) {
      this.i += w.length;
      return v;
    }
    return this.fail();
  }

  number(): Value {
    const m = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
    m.lastIndex = this.i;
    const r = m.exec(this.s);
    if (!r) return this.fail();
    this.i += r[0].length;
    return new JNum(r[0], Number(r[0]));
  }

  string(): string {
    const s = this.s;
    this.i++;
    let out = '';
    let start = this.i;
    for (;;) {
      if (this.i >= s.length) this.fail();
      const c = s.charCodeAt(this.i);
      if (c === 0x22) {
        out += s.slice(start, this.i);
        this.i++;
        return out;
      }
      if (c < 0x20) this.fail();
      if (c === 0x5c) {
        out += s.slice(start, this.i);
        const e = s[this.i + 1];
        this.i += 2;
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
            const h = s.slice(this.i, this.i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(h)) this.fail();
            out += String.fromCharCode(parseInt(h, 16));
            this.i += 4;
            break;
          }
          default: this.fail();
        }
        start = this.i;
      } else {
        this.i++;
      }
    }
  }

  array(): Value {
    this.i++;
    const out: Value[] = [];
    this.ws();
    if (this.s[this.i] === ']') {
      this.i++;
      return out;
    }
    for (;;) {
      out.push(this.value());
      this.ws();
      const c = this.s[this.i++];
      if (c === ',') continue;
      if (c === ']') return out;
      this.fail();
    }
  }

  object(): Value {
    this.i++;
    const out = new Map<string, Value>();
    this.ws();
    if (this.s[this.i] === '}') {
      this.i++;
      return out;
    }
    for (;;) {
      this.ws();
      if (this.s[this.i] !== '"') this.fail();
      const k = this.string();
      this.ws();
      if (this.s[this.i++] !== ':') this.fail();
      const v = this.value();
      out.set(k, v); // an existing key keeps its first position
      this.ws();
      const c = this.s[this.i++];
      if (c === ',') continue;
      if (c === '}') return out;
      this.fail();
    }
  }
}

export function parseJson(text: string): Value {
  const p = new Parser(text);
  const v = p.value();
  p.ws();
  if (p.i !== text.length) p.fail();
  return v;
}

export function stringify(v: Value): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (v instanceof JNum) return v.raw;
  if (Array.isArray(v)) return '[' + v.map(stringify).join(',') + ']';
  const parts: string[] = [];
  for (const [k, x] of v) parts.push(JSON.stringify(k) + ':' + stringify(x));
  return '{' + parts.join(',') + '}';
}
