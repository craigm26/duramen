// JSONPath query parser (RFC 9535 grammar) producing a typed syntax tree.

export class QueryError extends Error {}

export type Selector =
  | { t: 'name'; name: string }
  | { t: 'index'; i: number }
  | { t: 'wild' }
  | { t: 'slice'; start: number | null; end: number | null; step: number | null }
  | { t: 'filter'; expr: Logical };

export interface Segment {
  desc: boolean;
  sels: Selector[];
  // a child segment of one name or index selector with no blank space inside the brackets
  singular: boolean;
}

export interface Query {
  root: '$' | '@';
  segs: Segment[];
}

export type Logical =
  | { t: 'or'; l: Logical; r: Logical }
  | { t: 'and'; l: Logical; r: Logical }
  | { t: 'not'; e: Logical }
  | { t: 'exists'; q: Query }
  | { t: 'call'; f: Call }
  | { t: 'cmp'; op: string; l: Operand; r: Operand };

export interface Call {
  name: string;
  args: Operand[];
}

// Operands that yield a value (or Nothing).
export type Operand =
  | { t: 'lit'; v: unknown }
  | { t: 'sq'; q: Query }
  | { t: 'fn'; f: Call }
  // a query used where a nodelist is wanted
  | { t: 'nodes'; q: Query };

const MAX_INT = 9007199254740991n;

const FUNCS: Record<string, { params: ('value' | 'nodes')[]; ret: 'value' | 'logical' }> = {
  length: { params: ['value'], ret: 'value' },
  count: { params: ['nodes'], ret: 'value' },
  match: { params: ['value', 'value'], ret: 'logical' },
  search: { params: ['value', 'value'], ret: 'logical' },
  value: { params: ['nodes'], ret: 'value' },
};

const isBlank = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;
const isAlpha = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isLower = (c: number) => c >= 0x61 && c <= 0x7a;
const isNameFirst = (c: number) =>
  isAlpha(c) || c === 0x5f || (c >= 0x80 && c <= 0x10ffff && c !== 0x2cb);
const isNameChar = (c: number) => isNameFirst(c) || isDigit(c);

function fail(): never {
  throw new QueryError('invalid query');
}

class Parser {
  cps: number[];
  pos = 0;
  constructor(src: string) {
    this.cps = Array.from(src, (ch) => ch.codePointAt(0)!);
  }
  peek(off = 0): number {
    const i = this.pos + off;
    return i < this.cps.length ? this.cps[i] : -1;
  }
  ws(): void {
    while (isBlank(this.peek())) this.pos++;
  }
  eat(c: string): boolean {
    if (this.peek() === c.codePointAt(0)) {
      this.pos++;
      return true;
    }
    return false;
  }
  expect(c: string): void {
    if (!this.eat(c)) fail();
  }
  startsWith(s: string): boolean {
    for (let i = 0; i < s.length; i++) if (this.peek(i) !== s.charCodeAt(i)) return false;
    return true;
  }

  parseTop(): Query {
    if (this.peek() !== 0x24) fail();
    const q = this.parseQueryRest('$');
    if (this.pos !== this.cps.length) fail();
    return q;
  }

  // After the identifier: segments, each optionally preceded by blank space. Blank space
  // after the last segment is left unconsumed.
  parseQueryRest(root: '$' | '@'): Query {
    this.pos++;
    const segs: Segment[] = [];
    for (;;) {
      const save = this.pos;
      this.ws();
      const c = this.peek();
      if (c === 0x5b) {
        segs.push(this.parseBracket(false));
      } else if (c === 0x2e) {
        segs.push(this.parseDot());
      } else {
        this.pos = save;
        return { root, segs };
      }
    }
  }

  parseDot(): Segment {
    this.pos++;
    let desc = false;
    if (this.peek() === 0x2e) {
      desc = true;
      this.pos++;
      if (this.peek() === 0x5b) return this.parseBracket(true);
    }
    if (this.eat('*')) return { desc, sels: [{ t: 'wild' }], singular: false };
    if (!isNameFirst(this.peek())) fail();
    let name = '';
    while (isNameChar(this.peek())) {
      name += String.fromCodePoint(this.peek());
      this.pos++;
    }
    return { desc, sels: [{ t: 'name', name }], singular: !desc };
  }

  parseBracket(desc: boolean): Segment {
    this.expect('[');
    const tight = !isBlank(this.peek());
    this.ws();
    const sels: Selector[] = [];
    let tightEnd = false;
    for (;;) {
      sels.push(this.parseSelector());
      const before = this.pos;
      this.ws();
      tightEnd = before === this.pos;
      if (this.eat(',')) {
        this.ws();
        continue;
      }
      this.expect(']');
      break;
    }
    const s0 = sels[0];
    const singular =
      !desc && sels.length === 1 && tight && tightEnd && (s0.t === 'name' || s0.t === 'index');
    return { desc, sels, singular };
  }

  parseInt(): number | null {
    const start = this.pos;
    this.eat('-');
    const c = this.peek();
    if (!isDigit(c)) {
      if (this.pos !== start) fail();
      return null;
    }
    if (c === 0x30) {
      if (this.pos !== start) fail();
      this.pos++;
      return 0;
    }
    while (isDigit(this.peek())) this.pos++;
    const v = BigInt(String.fromCodePoint(...this.cps.slice(start, this.pos)));
    if (v > MAX_INT || v < -MAX_INT) fail();
    return Number(v);
  }

  parseSelector(): Selector {
    const c = this.peek();
    if (c === 0x27 || c === 0x22) return { t: 'name', name: this.parseString() };
    if (c === 0x2a) {
      this.pos++;
      return { t: 'wild' };
    }
    if (c === 0x3f) {
      this.pos++;
      this.ws();
      return { t: 'filter', expr: this.parseOr() };
    }
    if (c === 0x3a || c === 0x2d || isDigit(c)) {
      const first = this.parseInt();
      this.ws();
      if (this.peek() !== 0x3a) {
        if (first === null) fail();
        return { t: 'index', i: first };
      }
      this.pos++;
      this.ws();
      const end = this.parseInt();
      this.ws();
      let step: number | null = null;
      if (this.eat(':')) {
        this.ws();
        step = this.parseInt();
        this.ws();
      }
      return { t: 'slice', start: first, end, step };
    }
    return fail();
  }

  parseString(): string {
    const quote = this.peek();
    this.pos++;
    let out = '';
    for (;;) {
      const c = this.peek();
      if (c === -1 || c < 0x20) fail();
      this.pos++;
      if (c === quote) return out;
      if (c !== 0x5c) {
        out += String.fromCodePoint(c);
        continue;
      }
      const e = this.peek();
      this.pos++;
      switch (e) {
        case 0x62: out += '\b'; break;
        case 0x74: out += '\t'; break;
        case 0x6e: out += '\n'; break;
        case 0x66: out += '\f'; break;
        case 0x72: out += '\r'; break;
        case 0x2f: out += '/'; break;
        case 0x5c: out += '\\'; break;
        case 0x75: {
          const u = this.hex4();
          if (u >= 0xd800 && u <= 0xdbff) {
            if (!(this.peek() === 0x5c && this.peek(1) === 0x75)) fail();
            this.pos += 2;
            const lo = this.hex4();
            if (lo < 0xdc00 || lo > 0xdfff) fail();
            out += String.fromCodePoint(0x10000 + ((u - 0xd800) << 10) + (lo - 0xdc00));
          } else if (u >= 0xdc00 && u <= 0xdfff) {
            fail();
          } else {
            out += String.fromCodePoint(u);
          }
          break;
        }
        default:
          if (e === quote) out += String.fromCodePoint(e);
          else fail();
      }
    }
  }

  hex4(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const c = this.peek();
      let d: number;
      if (c >= 0x30 && c <= 0x39) d = c - 0x30;
      else if (c >= 0x41 && c <= 0x46) d = c - 0x41 + 10;
      else if (c >= 0x61 && c <= 0x66) d = c - 0x61 + 10;
      else return fail();
      v = v * 16 + d;
      this.pos++;
    }
    return v;
  }

  // ---- filters ----

  parseOr(): Logical {
    let l = this.parseAnd();
    for (;;) {
      const save = this.pos;
      this.ws();
      if (this.startsWith('||')) {
        this.pos += 2;
        this.ws();
        l = { t: 'or', l, r: this.parseAnd() };
      } else {
        this.pos = save;
        return l;
      }
    }
  }

  parseAnd(): Logical {
    let l = this.parseBasic();
    for (;;) {
      const save = this.pos;
      this.ws();
      if (this.startsWith('&&')) {
        this.pos += 2;
        this.ws();
        l = { t: 'and', l, r: this.parseBasic() };
      } else {
        this.pos = save;
        return l;
      }
    }
  }

  parseParen(): Logical {
    this.expect('(');
    this.ws();
    const e = this.parseOr();
    this.ws();
    this.expect(')');
    return e;
  }

  parseBasic(): Logical {
    if (this.eat('!')) {
      this.ws();
      if (this.peek() === 0x28) return { t: 'not', e: this.parseParen() };
      return { t: 'not', e: this.asTest(this.parseOperand()) };
    }
    if (this.peek() === 0x28) return this.parseParen();
    const l = this.parseOperand();
    const save = this.pos;
    this.ws();
    const op = this.parseCmpOp();
    if (op === null) {
      this.pos = save;
      return this.asTest(l);
    }
    this.ws();
    const r = this.parseOperand();
    return { t: 'cmp', op, l: this.asComparable(l), r: this.asComparable(r) };
  }

  parseCmpOp(): string | null {
    for (const op of ['==', '!=', '<=', '>=', '<', '>']) {
      if (this.startsWith(op)) {
        this.pos += op.length;
        return op;
      }
    }
    return null;
  }

  asTest(o: Operand): Logical {
    if (o.t === 'nodes') return { t: 'exists', q: o.q };
    if (o.t === 'sq') return { t: 'exists', q: o.q };
    if (o.t === 'fn' && FUNCS[o.f.name].ret === 'logical') return { t: 'call', f: o.f };
    return fail();
  }

  asComparable(o: Operand): Operand {
    if (o.t === 'lit') return o;
    if (o.t === 'nodes') return this.asValue(o);
    if (o.t === 'fn' && FUNCS[o.f.name].ret === 'value') return o;
    if (o.t === 'sq') return o;
    return fail();
  }

  // Operand as parsed: a literal, a query ('nodes', with singularity noted by the caller),
  // or a function expression.
  parseOperand(): Operand {
    const c = this.peek();
    if (c === 0x40 || c === 0x24) {
      const q = this.parseQueryRest(c === 0x40 ? '@' : '$');
      return { t: 'nodes', q };
    }
    if (c === 0x27 || c === 0x22) return { t: 'lit', v: this.parseString() };
    if (c === 0x2d || isDigit(c)) return { t: 'lit', v: this.parseNumber() };
    if (isLower(c)) {
      let name = '';
      while (isLower(this.peek()) || isDigit(this.peek()) || this.peek() === 0x5f) {
        name += String.fromCodePoint(this.peek());
        this.pos++;
      }
      if (this.peek() === 0x28) return { t: 'fn', f: this.parseCall(name) };
      if (name === 'true') return { t: 'lit', v: true };
      if (name === 'false') return { t: 'lit', v: false };
      if (name === 'null') return { t: 'lit', v: null };
    }
    return fail();
  }

  parseNumber(): number {
    const start = this.pos;
    this.eat('-');
    if (this.eat('0')) {
      // no further digits as part of the integer part
    } else if (isDigit(this.peek())) {
      while (isDigit(this.peek())) this.pos++;
    } else {
      fail();
    }
    if (this.peek() === 0x2e && isDigit(this.peek(1))) {
      this.pos++;
      while (isDigit(this.peek())) this.pos++;
    }
    if (this.peek() === 0x65 || this.peek() === 0x45) {
      const save = this.pos;
      this.pos++;
      if (this.peek() === 0x2b || this.peek() === 0x2d) this.pos++;
      if (isDigit(this.peek())) {
        while (isDigit(this.peek())) this.pos++;
      } else {
        this.pos = save;
      }
    }
    return Number(String.fromCodePoint(...this.cps.slice(start, this.pos)));
  }

  asValue(o: Operand): Operand {
    if (o.t === 'nodes') {
      if (!o.q.segs.every((s) => s.singular)) fail();
      return { t: 'sq', q: o.q };
    }
    if (o.t === 'lit') return o;
    if (o.t === 'fn' && FUNCS[o.f.name].ret === 'value') return o;
    return fail();
  }

  parseCall(name: string): Call {
    const spec = Object.hasOwn(FUNCS, name) ? FUNCS[name] : null;
    if (!spec) fail();
    this.expect('(');
    this.ws();
    const raw: Operand[] = [];
    if (!this.eat(')')) {
      for (;;) {
        raw.push(this.parseOperand());
        this.ws();
        if (this.eat(',')) {
          this.ws();
          continue;
        }
        this.expect(')');
        break;
      }
    }
    if (raw.length !== spec.params.length) fail();
    const args = raw.map((o, i) => {
      if (spec.params[i] === 'nodes') {
        if (o.t !== 'nodes') fail();
        return o;
      }
      return this.asValue(o);
    });
    return { name, args };
  }
}

export function parseQuery(src: string): Query {
  return new Parser(src).parseTop();
}
