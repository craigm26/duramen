// JSON text to values, and values back to JSON text.
// Objects are Maps so that member order is the document order (SPEC R30.3), and a duplicate name
// keeps its first position with its last value (R31.3). Numbers keep their text (R31.2).

export class JsonNumber {
  readonly text: string;
  readonly value: number;

  constructor(text: string) {
    this.text = text;
    this.value = Number(text);
  }
}

export type Json = null | boolean | string | JsonNumber | Json[] | Map<string, Json>;

export class JsonSyntaxError extends Error {}

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);
const SIMPLE_ESCAPES = new Map([
  ['"', '"'],
  ['\\', '\\'],
  ['/', '/'],
  ['b', '\b'],
  ['f', '\f'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
]);
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

export function parseJson(text: string): Json {
  const parser = new Parser(text);
  parser.skipWhitespace();
  const value = parser.value();
  parser.skipWhitespace();
  if (parser.pos !== text.length) throw parser.error();
  return value;
}

// Serializes a value as JSON text. Member order is kept; numbers are written as their original text.
export function jsonText(value: Json): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (value instanceof JsonNumber) return value.text;
  if (Array.isArray(value)) return `[${value.map((item) => jsonText(item)).join(',')}]`;
  const members = [...value].map(([name, item]) => `${JSON.stringify(name)}:${jsonText(item)}`);
  return `{${members.join(',')}}`;
}

class Parser {
  readonly text: string;
  pos = 0;

  constructor(text: string) {
    this.text = text;
  }

  error(): JsonSyntaxError {
    return new JsonSyntaxError(`JSON syntax error at offset ${this.pos}`);
  }

  skipWhitespace(): void {
    while (WHITESPACE.has(this.text[this.pos])) this.pos++;
  }

  value(): Json {
    const c = this.text[this.pos];
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '"') return this.string();
    if (c === '-' || (c >= '0' && c <= '9')) return this.number();
    if (this.text.startsWith('true', this.pos)) return this.keyword(4, true);
    if (this.text.startsWith('false', this.pos)) return this.keyword(5, false);
    if (this.text.startsWith('null', this.pos)) return this.keyword(4, null);
    throw this.error();
  }

  private keyword(length: number, value: boolean | null): Json {
    this.pos += length;
    return value;
  }

  private number(): JsonNumber {
    NUMBER.lastIndex = this.pos;
    const found = NUMBER.exec(this.text);
    if (found === null) throw this.error();
    this.pos += found[0].length;
    return new JsonNumber(found[0]);
  }

  private string(): string {
    let out = '';
    let i = this.pos + 1;
    for (;;) {
      if (i >= this.text.length) {
        this.pos = i;
        throw this.error();
      }
      const c = this.text[i];
      if (c === '"') {
        this.pos = i + 1;
        return out;
      }
      if (c < ' ') {
        this.pos = i;
        throw this.error();
      }
      if (c !== '\\') {
        out += c;
        i++;
        continue;
      }
      const e = this.text[i + 1];
      if (e === 'u') {
        const hex = this.text.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          this.pos = i;
          throw this.error();
        }
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      const simple = SIMPLE_ESCAPES.get(e);
      if (simple === undefined) {
        this.pos = i;
        throw this.error();
      }
      out += simple;
      i += 2;
    }
  }

  private array(): Json[] {
    const out: Json[] = [];
    this.pos++;
    this.skipWhitespace();
    if (this.text[this.pos] === ']') {
      this.pos++;
      return out;
    }
    for (;;) {
      out.push(this.value());
      this.skipWhitespace();
      const c = this.text[this.pos++];
      if (c === ']') return out;
      if (c !== ',') throw this.error();
      this.skipWhitespace();
    }
  }

  private object(): Map<string, Json> {
    const out = new Map<string, Json>();
    this.pos++;
    this.skipWhitespace();
    if (this.text[this.pos] === '}') {
      this.pos++;
      return out;
    }
    for (;;) {
      if (this.text[this.pos] !== '"') throw this.error();
      const name = this.string();
      this.skipWhitespace();
      if (this.text[this.pos++] !== ':') throw this.error();
      this.skipWhitespace();
      out.set(name, this.value());
      this.skipWhitespace();
      const c = this.text[this.pos++];
      if (c === '}') return out;
      if (c !== ',') throw this.error();
      this.skipWhitespace();
    }
  }
}
