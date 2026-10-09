// JSONPath (RFC 9535) query parser and well-typedness checker.
import { Num } from "./json.ts";
import type { Json } from "./json.ts";

export type Selector =
  | { k: "name"; name: string }
  | { k: "wild" }
  | { k: "index"; i: number }
  | { k: "slice"; start: number | null; end: number | null; step: number | null }
  | { k: "filter"; expr: Expr };
export interface Segment {
  desc: boolean;
  sels: Selector[];
}
export interface Query {
  root: "$" | "@";
  segs: Segment[];
  singular: boolean;
}
export interface Func {
  name: string;
  args: Operand[];
}
export type Operand =
  | { t: "lit"; v: Json }
  | { t: "q"; q: Query }
  | { t: "fn"; f: Func };
export type Expr =
  | { t: "or" | "and"; l: Expr; r: Expr }
  | { t: "not"; e: Expr }
  | { t: "test"; q: Query }
  | { t: "ftest"; f: Func }
  | { t: "cmp"; op: string; l: Operand; r: Operand };

type Type = "V" | "L" | "N";
const FUNCS: Record<string, { params: Type[]; ret: Type }> = {
  length: { params: ["V"], ret: "V" },
  count: { params: ["N"], ret: "V" },
  match: { params: ["V", "V"], ret: "L" },
  search: { params: ["V", "V"], ret: "L" },
  value: { params: ["N"], ret: "V" },
};

const MAX_INT = 2n ** 53n - 1n;

class Parser {
  s: string;
  i = 0;
  depth = 0;
  constructor(s: string) {
    this.s = s;
  }
  fail(): never {
    throw new SyntaxError("invalid query at " + this.i);
  }
  peek(): string {
    return this.s[this.i] ?? "";
  }
  ws() {
    while (this.i < this.s.length && " \t\n\r".includes(this.s[this.i])) this.i++;
  }
  eat(c: string) {
    if (this.s.startsWith(c, this.i)) this.i += c.length;
    else this.fail();
  }

  query(): Query {
    const root = this.peek();
    if (root !== "$" && root !== "@") this.fail();
    this.i++;
    const segs: Segment[] = [];
    for (;;) {
      const save = this.i;
      this.ws();
      const c = this.peek();
      if (c === "." || c === "[") segs.push(this.segment());
      else {
        this.i = save;
        break;
      }
    }
    const singular = segs.every(
      (g) => !g.desc && g.sels.length === 1 && (g.sels[0].k === "name" || g.sels[0].k === "index"),
    );
    return { root, segs, singular };
  }

  isNameFirst(c: string): boolean {
    return c !== "" && (/[A-Za-z_]/.test(c) || c.charCodeAt(0) >= 0x80);
  }

  shorthand(): Selector {
    const c = this.peek();
    if (c === "*") {
      this.i++;
      return { k: "wild" };
    }
    if (!this.isNameFirst(c)) this.fail();
    const st = this.i;
    while (this.isNameFirst(this.peek()) || /[0-9]/.test(this.peek() || "x")) this.i++;
    return { k: "name", name: this.s.slice(st, this.i) };
  }

  segment(): Segment {
    if (this.s.startsWith("..", this.i)) {
      this.i += 2;
      if (this.peek() === "[") return { desc: true, sels: this.bracketed() };
      return { desc: true, sels: [this.shorthand()] };
    }
    if (this.peek() === ".") {
      this.i++;
      return { desc: false, sels: [this.shorthand()] };
    }
    return { desc: false, sels: this.bracketed() };
  }

  bracketed(): Selector[] {
    this.eat("[");
    this.ws();
    const sels = [this.selector()];
    for (;;) {
      this.ws();
      if (this.peek() === ",") {
        this.i++;
        this.ws();
        sels.push(this.selector());
      } else break;
    }
    this.eat("]");
    return sels;
  }

  int(): number {
    const st = this.i;
    if (this.peek() === "-") this.i++;
    const d = this.peek();
    if (!/^[0-9]$/.test(d)) this.fail();
    if (d === "0") {
      this.i++;
      if (this.s[st] === "-") this.fail(); // "-0" is not an int
    } else while (/^[0-9]$/.test(this.peek() || "x")) this.i++;
    const n = BigInt(this.s.slice(st, this.i));
    if (n > MAX_INT || n < -MAX_INT) this.fail();
    return Number(n);
  }

  isIntStart(): boolean {
    const c = this.peek();
    return c === "-" || /^[0-9]$/.test(c || "x");
  }

  selector(): Selector {
    const c = this.peek();
    if (c === '"' || c === "'") return { k: "name", name: this.string() };
    if (c === "*") {
      this.i++;
      return { k: "wild" };
    }
    if (c === "?") {
      this.i++;
      this.ws();
      return { k: "filter", expr: this.logicalOr() };
    }
    let start: number | null = null;
    if (this.isIntStart()) start = this.int();
    else if (c !== ":") this.fail();
    this.ws();
    if (this.peek() !== ":") {
      if (start === null) this.fail();
      return { k: "index", i: start! };
    }
    this.i++;
    this.ws();
    let end: number | null = null;
    let step: number | null = null;
    if (this.isIntStart()) end = this.int();
    this.ws();
    if (this.peek() === ":") {
      this.i++;
      this.ws();
      if (this.isIntStart()) step = this.int();
    }
    return { k: "slice", start, end, step };
  }

  string(): string {
    const q = this.peek();
    this.i++;
    let out = "";
    for (;;) {
      if (this.i >= this.s.length) this.fail();
      const ch = this.s[this.i];
      const code = ch.charCodeAt(0);
      if (ch === q) {
        this.i++;
        return out;
      }
      if (code < 0x20) this.fail();
      if (ch !== "\\") {
        out += ch;
        this.i++;
        continue;
      }
      const e = this.s[this.i + 1];
      this.i += 2;
      switch (e) {
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case "n": out += "\n"; break;
        case "r": out += "\r"; break;
        case "t": out += "\t"; break;
        case "/": out += "/"; break;
        case "\\": out += "\\"; break;
        case "u": {
          const hi = this.hex4();
          if (hi >= 0xd800 && hi <= 0xdbff) {
            if (!this.s.startsWith("\\u", this.i)) this.fail();
            this.i += 2;
            const lo = this.hex4();
            if (lo < 0xdc00 || lo > 0xdfff) this.fail();
            out += String.fromCharCode(hi, lo);
          } else if (hi >= 0xdc00 && hi <= 0xdfff) this.fail();
          else out += String.fromCharCode(hi);
          break;
        }
        default:
          if (e === q) out += q;
          else this.fail();
      }
    }
  }

  hex4(): number {
    const h = this.s.slice(this.i, this.i + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(h)) this.fail();
    this.i += 4;
    return parseInt(h, 16);
  }

  // ---- filter expressions ----

  logicalOr(): Expr {
    if (++this.depth > 500) this.fail();
    let l = this.logicalAnd();
    for (;;) {
      const save = this.i;
      this.ws();
      if (this.s.startsWith("||", this.i)) {
        this.i += 2;
        this.ws();
        l = { t: "or", l, r: this.logicalAnd() };
      } else {
        this.i = save;
        break;
      }
    }
    this.depth--;
    return l;
  }

  logicalAnd(): Expr {
    let l = this.basic();
    for (;;) {
      const save = this.i;
      this.ws();
      if (this.s.startsWith("&&", this.i)) {
        this.i += 2;
        this.ws();
        l = { t: "and", l, r: this.basic() };
      } else {
        this.i = save;
        break;
      }
    }
    return l;
  }

  paren(): Expr {
    this.eat("(");
    this.ws();
    const e = this.logicalOr();
    this.ws();
    this.eat(")");
    return e;
  }

  testOf(o: Operand): Expr {
    if (o.t === "q") return { t: "test", q: o.q };
    if (o.t === "fn" && FUNCS[o.f.name].ret !== "V") return { t: "ftest", f: o.f };
    return this.fail();
  }

  basic(): Expr {
    const c = this.peek();
    if (c === "!") {
      this.i++;
      this.ws();
      if (this.peek() === "(") return { t: "not", e: this.paren() };
      const o = this.term();
      return { t: "not", e: this.testOf(o) };
    }
    if (c === "(") return this.paren();
    const l = this.term();
    const save = this.i;
    this.ws();
    const m = /^(==|!=|<=|>=|<|>)/.exec(this.s.slice(this.i, this.i + 2));
    if (!m) {
      this.i = save;
      return this.testOf(l);
    }
    this.i += m[1].length;
    this.ws();
    const r = this.term();
    for (const o of [l, r]) {
      if (o.t === "q" && !o.q.singular) this.fail();
      if (o.t === "fn" && FUNCS[o.f.name].ret !== "V") this.fail();
    }
    return { t: "cmp", op: m[1], l, r };
  }

  number(): Num {
    const m = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(this.s.slice(this.i));
    if (!m) this.fail();
    this.i += m![0].length;
    return new Num(m![0]);
  }

  term(): Operand {
    const c = this.peek();
    if (c === "@" || c === "$") return { t: "q", q: this.query() };
    if (c === '"' || c === "'") return { t: "lit", v: this.string() };
    if (c === "-" || /^[0-9]$/.test(c || "x")) return { t: "lit", v: this.number() };
    const m = /^[a-z][a-z0-9_]*/.exec(this.s.slice(this.i));
    if (!m) this.fail();
    const name = m![0];
    this.i += name.length;
    if (this.peek() === "(") return { t: "fn", f: this.func(name) };
    if (name === "true") return { t: "lit", v: true };
    if (name === "false") return { t: "lit", v: false };
    if (name === "null") return { t: "lit", v: null };
    return this.fail();
  }

  func(name: string): Func {
    const sig = FUNCS[name];
    if (!sig) this.fail();
    this.eat("(");
    this.ws();
    const args: Operand[] = [];
    if (this.peek() !== ")") {
      args.push(this.term());
      for (;;) {
        this.ws();
        if (this.peek() !== ",") break;
        this.i++;
        this.ws();
        args.push(this.term());
      }
    }
    this.ws();
    this.eat(")");
    if (args.length !== sig.params.length) this.fail();
    args.forEach((a, k) => {
      const want = sig.params[k];
      if (want === "V") {
        if (a.t === "q" && !a.q.singular) this.fail();
        if (a.t === "fn" && FUNCS[a.f.name].ret !== "V") this.fail();
      } else if (a.t !== "q") this.fail(); // NodesType needs a query
    });
    return { name, args };
  }
}

export function parseQuery(s: string): Query {
  if (!s.isWellFormed()) throw new SyntaxError("not Unicode scalar values");
  const p = new Parser(s);
  if (p.peek() !== "$") p.fail();
  const q = p.query();
  if (p.i !== s.length) p.fail();
  return q;
}
