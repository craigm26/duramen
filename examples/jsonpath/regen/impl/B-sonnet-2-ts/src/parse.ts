// JSONPath query parser (RFC 9535 grammar, Appendix A of SPEC.md) with static type checks.

import { JNum } from './json.ts';
import type { Value } from './json.ts';

export type Selector =
  | { k: 'name'; name: string }
  | { k: 'wild' }
  | { k: 'index'; i: number }
  | { k: 'slice'; start: number | null; end: number | null; step: number | null }
  | { k: 'filter'; e: Expr };

export interface Segment {
  desc: boolean;
  selectors: Selector[];
  singular: boolean; // usable inside a singular query
}

export interface Query {
  root: '$' | '@';
  segments: Segment[];
}

export type Expr =
  | { k: 'lit'; v: Value }
  | { k: 'query'; q: Query }
  | { k: 'func'; name: string; args: Expr[] }
  | { k: 'cmp'; op: string; l: Expr; r: Expr }
  | { k: 'and'; a: Expr; b: Expr }
  | { k: 'or'; a: Expr; b: Expr }
  | { k: 'not'; e: Expr }
  | { k: 'paren'; e: Expr };

class QueryError extends Error {}

const FUNCS: Record<string, { params: ('value' | 'nodes')[]; result: 'value' | 'logical' }> = {
  length: { params: ['value'], result: 'value' },
  count: { params: ['nodes'], result: 'value' },
  match: { params: ['value', 'value'], result: 'logical' },
  search: { params: ['value', 'value'], result: 'logical' },
  value: { params: ['nodes'], result: 'value' },
};

const MAX_INT = 9007199254740991n;

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9';
}

function isNameFirst(c: string | undefined): boolean {
  if (c === undefined) return false;
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c.codePointAt(0)! >= 0x80;
}

function isSingular(q: Query): boolean {
  return q.segments.every((s) => s.singular);
}

class P {
  cs: string[];
  i = 0;
  depth = 0;
  constructor(cs: string[]) {
    this.cs = cs;
  }

  bad(): never {
    throw new QueryError('invalid');
  }

  peek(o = 0): string | undefined {
    return this.cs[this.i + o];
  }

  eat(c: string): boolean {
    if (this.cs[this.i] === c) {
      this.i++;
      return true;
    }
    return false;
  }

  expect(c: string): void {
    if (!this.eat(c)) this.bad();
  }

  startsWith(s: string): boolean {
    for (let j = 0; j < s.length; j++) if (this.cs[this.i + j] !== s[j]) return false;
    return true;
  }

  ws(): void {
    for (;;) {
      const c = this.cs[this.i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') this.i++;
      else return;
    }
  }

  query(): Query {
    const c = this.peek();
    if (c !== '$' && c !== '@') this.bad();
    this.i++;
    return { root: c, segments: this.segments() };
  }

  segments(): Segment[] {
    const out: Segment[] = [];
    for (;;) {
      const save = this.i;
      this.ws();
      const c = this.peek();
      if (c === '[' || c === '.') out.push(this.segment());
      else {
        this.i = save;
        return out;
      }
    }
  }

  segment(): Segment {
    if (this.startsWith('..')) {
      this.i += 2;
      const c = this.peek();
      if (c === '[') {
        const b = this.bracketed();
        return { desc: true, selectors: b.selectors, singular: false };
      }
      if (c === '*') {
        this.i++;
        return { desc: true, selectors: [{ k: 'wild' }], singular: false };
      }
      return { desc: true, selectors: [{ k: 'name', name: this.shorthand() }], singular: false };
    }
    if (this.peek() === '.') {
      this.i++;
      if (this.eat('*')) return { desc: false, selectors: [{ k: 'wild' }], singular: false };
      return { desc: false, selectors: [{ k: 'name', name: this.shorthand() }], singular: true };
    }
    const b = this.bracketed();
    const s = b.selectors;
    const singular = s.length === 1 && (s[0].k === 'name' || s[0].k === 'index') && b.tight;
    return { desc: false, selectors: s, singular };
  }

  shorthand(): string {
    if (!isNameFirst(this.peek())) this.bad();
    let n = '';
    while (isNameFirst(this.peek()) || isDigit(this.peek())) n += this.cs[this.i++];
    return n;
  }

  bracketed(): { selectors: Selector[]; tight: boolean } {
    this.expect('[');
    const afterOpen = this.i;
    this.ws();
    const selectors: Selector[] = [this.selector()];
    let beforeClose = this.i;
    this.ws();
    while (this.peek() === ',') {
      this.i++;
      this.ws();
      selectors.push(this.selector());
      beforeClose = this.i;
      this.ws();
    }
    const closeAt = this.i;
    this.expect(']');
    return { selectors, tight: this.tightCheck(selectors, afterOpen, beforeClose, closeAt) };
  }

  tightCheck(sel: Selector[], afterOpen: number, beforeClose: number, closeAt: number): boolean {
    if (sel.length !== 1) return false;
    const c = this.cs[afterOpen];
    return c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r' && beforeClose === closeAt;
  }

  int(): number {
    const start = this.i;
    if (this.peek() === '-') this.i++;
    const c = this.peek();
    if (c === '0') {
      if (this.i > start) this.bad(); // -0
      this.i++;
    } else if (c !== undefined && c >= '1' && c <= '9') {
      while (isDigit(this.peek())) this.i++;
    } else this.bad();
    const text = this.cs.slice(start, this.i).join('');
    const n = BigInt(text);
    if (n > MAX_INT || n < -MAX_INT) this.bad();
    return Number(n);
  }

  isIntStart(): boolean {
    const c = this.peek();
    return c === '-' || isDigit(c);
  }

  selector(): Selector {
    const c = this.peek();
    if (c === '"' || c === "'") return { k: 'name', name: this.stringLit() };
    if (c === '*') {
      this.i++;
      return { k: 'wild' };
    }
    if (c === '?') {
      this.i++;
      this.ws();
      const e = this.logicalExpr(false);
      return { k: 'filter', e };
    }
    if (c === ':' || this.isIntStart()) {
      let start: number | null = null;
      if (c !== ':') {
        start = this.int();
        const save = this.i;
        this.ws();
        if (this.peek() !== ':') {
          this.i = save;
          return { k: 'index', i: start };
        }
      }
      this.expect(':');
      this.ws();
      let end: number | null = null;
      let step: number | null = null;
      if (this.isIntStart()) {
        end = this.int();
        this.ws();
      }
      if (this.eat(':')) {
        this.ws();
        if (this.isIntStart()) step = this.int();
      }
      return { k: 'slice', start, end, step };
    }
    return this.bad();
  }

  stringLit(): string {
    const q = this.cs[this.i++];
    let out = '';
    for (;;) {
      const c = this.cs[this.i++];
      if (c === undefined) this.bad();
      if (c === q) return out;
      const cp = c.codePointAt(0)!;
      if (cp < 0x20) this.bad();
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = this.cs[this.i++];
      switch (e) {
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case '/': out += '/'; break;
        case '\\': out += '\\'; break;
        case '"': if (q !== '"') this.bad(); out += '"'; break;
        case "'": if (q !== "'") this.bad(); out += "'"; break;
        case 'u': {
          const u = this.hex4();
          if (u >= 0xdc00 && u <= 0xdfff) this.bad();
          if (u >= 0xd800 && u <= 0xdbff) {
            if (this.cs[this.i] !== '\\' || this.cs[this.i + 1] !== 'u') this.bad();
            this.i += 2;
            const lo = this.hex4();
            if (lo < 0xdc00 || lo > 0xdfff) this.bad();
            out += String.fromCharCode(u, lo);
          } else out += String.fromCharCode(u);
          break;
        }
        default: this.bad();
      }
    }
  }

  hex4(): number {
    let h = '';
    for (let j = 0; j < 4; j++) {
      const c = this.cs[this.i + j];
      if (c === undefined || !/^[0-9a-fA-F]$/.test(c)) this.bad();
      h += c;
    }
    this.i += 4;
    return parseInt(h, 16);
  }

  // ---- filter expressions ----

  logicalExpr(argMode: boolean): Expr {
    if (++this.depth > 500) this.bad();
    let l = this.andExpr(argMode);
    for (;;) {
      const save = this.i;
      this.ws();
      if (this.startsWith('||')) {
        this.i += 2;
        this.ws();
        const r = this.andExpr(argMode);
        l = { k: 'or', a: this.asLogical(l), b: this.asLogical(r) };
      } else {
        this.i = save;
        break;
      }
    }
    this.depth--;
    return argMode ? l : this.asLogical(l);
  }

  andExpr(argMode: boolean): Expr {
    let l = this.basic();
    for (;;) {
      const save = this.i;
      this.ws();
      if (this.startsWith('&&')) {
        this.i += 2;
        this.ws();
        const r = this.basic();
        l = { k: 'and', a: this.asLogical(l), b: this.asLogical(r) };
      } else {
        this.i = save;
        break;
      }
    }
    void argMode;
    return l;
  }

  // Check that an expression can serve as a logical operand (test context).
  asLogical(e: Expr): Expr {
    switch (e.k) {
      case 'lit': return this.bad();
      case 'func': return FUNCS[e.name].result === 'logical' ? e : this.bad();
      default: return e;
    }
  }

  basic(): Expr {
    const c = this.peek();
    if (c === '!') {
      this.i++;
      this.ws();
      if (this.peek() === '(') return { k: 'not', e: this.paren() };
      const p = this.primary();
      if (p.k === 'query' || (p.k === 'func' && FUNCS[p.name].result === 'logical')) return { k: 'not', e: p };
      return this.bad();
    }
    if (c === '(') return this.paren();
    const l = this.primary();
    const save = this.i;
    this.ws();
    const op = this.cmpOp();
    if (op === null) {
      this.i = save;
      return l;
    }
    this.ws();
    const r = this.primary();
    this.checkComparable(l);
    this.checkComparable(r);
    return { k: 'cmp', op, l, r };
  }

  paren(): Expr {
    this.expect('(');
    this.ws();
    const e = this.logicalExpr(false);
    this.ws();
    this.expect(')');
    return { k: 'paren', e };
  }

  cmpOp(): string | null {
    for (const op of ['==', '!=', '<=', '>=', '<', '>']) {
      if (this.startsWith(op)) {
        this.i += op.length;
        return op;
      }
    }
    return null;
  }

  checkComparable(e: Expr): void {
    if (e.k === 'lit') return;
    if (e.k === 'query' && isSingular(e.q)) return;
    if (e.k === 'func' && FUNCS[e.name].result === 'value') return;
    this.bad();
  }

  primary(): Expr {
    const c = this.peek();
    if (c === '@' || c === '$') return { k: 'query', q: this.query() };
    if (c === '"' || c === "'") return { k: 'lit', v: this.stringLit() };
    if (c === '-' || isDigit(c)) return { k: 'lit', v: this.number() };
    if (c !== undefined && c >= 'a' && c <= 'z') {
      let name = '';
      while (this.peek() !== undefined && /^[a-z0-9_]$/.test(this.peek()!)) name += this.cs[this.i++];
      if (this.peek() === '(') return this.call(name);
      if (name === 'true') return { k: 'lit', v: true };
      if (name === 'false') return { k: 'lit', v: false };
      if (name === 'null') return { k: 'lit', v: null };
    }
    return this.bad();
  }

  number(): Value {
    const start = this.i;
    this.eat('-');
    if (this.eat('0')) {
      // single zero
    } else if (this.peek() !== undefined && this.peek()! >= '1' && this.peek()! <= '9') {
      while (isDigit(this.peek())) this.i++;
    } else this.bad();
    if (this.peek() === '.' && isDigit(this.peek(1))) {
      this.i++;
      while (isDigit(this.peek())) this.i++;
    }
    const e = this.peek();
    if (e === 'e' || e === 'E') {
      let j = 1;
      if (this.peek(j) === '+' || this.peek(j) === '-') j++;
      if (!isDigit(this.peek(j))) this.bad();
      this.i += j;
      while (isDigit(this.peek())) this.i++;
    }
    const raw = this.cs.slice(start, this.i).join('');
    return new JNum(raw, Number(raw));
  }

  call(name: string): Expr {
    const f = FUNCS[name];
    if (!Object.hasOwn(FUNCS, name)) this.bad();
    this.expect('(');
    this.ws();
    const args: Expr[] = [];
    if (this.peek() !== ')') {
      args.push(this.logicalExpr(true));
      for (;;) {
        this.ws();
        if (!this.eat(',')) break;
        this.ws();
        args.push(this.logicalExpr(true));
      }
    }
    this.ws();
    this.expect(')');
    if (args.length !== f.params.length) this.bad();
    args.forEach((a, n) => this.checkArg(a, f.params[n]));
    return { k: 'func', name, args };
  }

  checkArg(a: Expr, param: 'value' | 'nodes'): void {
    if (param === 'value') {
      if (a.k === 'lit') return;
      if (a.k === 'query' && isSingular(a.q)) return;
      if (a.k === 'func' && FUNCS[a.name].result === 'value') return;
      this.bad();
    } else {
      if (a.k === 'query') return;
      this.bad();
    }
  }
}

export function parseQuery(query: string): Query | null {
  // A lone surrogate cannot be part of a query of Unicode scalar values.
  for (let i = 0; i < query.length; i++) {
    const c = query.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = query.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
      else return null;
    } else if (c >= 0xdc00 && c <= 0xdfff) return null;
  }
  const p = new P(Array.from(query));
  try {
    if (p.peek() !== '$') return null;
    const q = p.query();
    if (p.i !== p.cs.length) return null;
    return q;
  } catch (e) {
    if (e instanceof QueryError || e instanceof RangeError) return null;
    throw e;
  }
}
