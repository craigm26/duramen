// I-Regexp (RFC 9485): a checking parser that translates to a JavaScript
// Unicode-mode RegExp. Every literal is emitted as \u{...} so no JS-special
// character can leak through.

const CATS = new Set(
  ("L Ll Lm Lo Lt Lu M Mc Me Mn N Nd Nl No P Pc Pd Pe Pf Pi Po Ps Z Zl Zp Zs " +
    "S Sc Sk Sm So C Cc Cf Cn Co").split(" "),
);
const SINGLE_ESC: Record<string, number> = { n: 10, r: 13, t: 9 };
const SINGLE_ESC_LITERAL = "()*+-.?[\\]^{|}";
const NOT_NORMAL = "()*+.?[\\]{|}";

const lit = (cp: number) => `\\u{${cp.toString(16)}}`;

class RegexParser {
  cps: number[];
  i = 0;
  constructor(cps: number[]) {
    this.cps = cps;
  }
  fail(): never {
    throw new SyntaxError("bad i-regexp");
  }
  peek(): string {
    return this.i < this.cps.length ? String.fromCodePoint(this.cps[this.i]) : "";
  }

  alt(): string {
    const parts = [this.branch()];
    while (this.peek() === "|") {
      this.i++;
      parts.push(this.branch());
    }
    return parts.join("|");
  }

  branch(): string {
    let out = "";
    while (this.i < this.cps.length && this.peek() !== "|" && this.peek() !== ")") {
      out += this.atom() + this.quantifier();
    }
    return out;
  }

  quantifier(): string {
    const c = this.peek();
    if (c === "*" || c === "+" || c === "?") {
      this.i++;
      return c;
    }
    if (c !== "{") return "";
    this.i++;
    const num = (): string => {
      let d = "";
      while (/^[0-9]$/.test(this.peek())) d += String.fromCodePoint(this.cps[this.i++]);
      return d;
    };
    const lo = num();
    if (lo === "") this.fail();
    let out = "{" + lo;
    if (this.peek() === ",") {
      this.i++;
      out += ",";
      const hi = num();
      if (hi !== "") {
        if (BigInt(hi) < BigInt(lo)) this.fail();
        out += hi;
      }
    }
    if (this.peek() !== "}") this.fail();
    this.i++;
    return out + "}";
  }

  atom(): string {
    const c = this.peek();
    if (c === ".") {
      this.i++;
      return "[^\\n\\r]";
    }
    if (c === "\\") return this.escape(false);
    if (c === "[") return this.cls();
    if (c === "(") {
      this.i++;
      const inner = this.alt();
      if (this.peek() !== ")") this.fail();
      this.i++;
      return "(?:" + inner + ")";
    }
    if (c === "" || NOT_NORMAL.includes(c)) this.fail();
    this.i++;
    return lit(c.codePointAt(0)!);
  }

  // At a backslash. Returns regex text for a single-char escape or category.
  escape(inClass: boolean): string {
    this.i++;
    const c = this.peek();
    if (c === "") this.fail();
    this.i++;
    if (c === "p" || c === "P") {
      if (this.peek() !== "{") this.fail();
      this.i++;
      let name = "";
      while (this.peek() !== "}" && this.peek() !== "") name += this.peek(), this.i++;
      if (this.peek() !== "}" || !CATS.has(name)) this.fail();
      this.i++;
      return `\\${c}{${name}}`;
    }
    if (c in SINGLE_ESC) return lit(SINGLE_ESC[c]);
    if (SINGLE_ESC_LITERAL.includes(c)) return lit(c.codePointAt(0)!);
    return this.fail();
  }

  // One CCchar; returns its code point, or -1 when the next item is a category escape.
  ccChar(): number {
    const c = this.peek();
    if (c === "\\") {
      const nx = this.cps[this.i + 1];
      if (nx === 0x70 || nx === 0x50) return -1;
      const r = this.escape(true);
      return parseInt(/\{([0-9a-f]+)\}/.exec(r)![1], 16);
    }
    if (c === "" || c === "-" || c === "[" || c === "]") this.fail();
    this.i++;
    return c.codePointAt(0)!;
  }

  cls(): string {
    this.i++; // [
    let neg = false;
    if (this.peek() === "^") {
      neg = true;
      this.i++;
    }
    let body = "";
    let first = true;
    for (;;) {
      const c = this.peek();
      if (c === "") this.fail();
      if (c === "]") {
        if (first) this.fail(); // [] and [^]
        this.i++;
        break;
      }
      if (c === "-") {
        // leading or trailing dash only
        if (!first && this.cps[this.i + 1] !== 0x5d) this.fail();
        this.i++;
        body += lit(0x2d);
        first = false;
        continue;
      }
      first = false;
      const lo = this.ccChar();
      if (lo === -1) {
        body += this.escape(true);
        continue;
      }
      if (this.peek() === "-" && this.cps[this.i + 1] !== 0x5d) {
        this.i++;
        const hi = this.ccChar();
        if (hi === -1 || hi < lo) this.fail();
        body += lit(lo) + "-" + lit(hi);
      } else body += lit(lo);
    }
    return "[" + (neg ? "^" : "") + body + "]";
  }
}

export interface Compiled {
  full: RegExp;
  partial: RegExp;
}

const cache = new Map<string, Compiled | null>();

export function compileIRegexp(pattern: string): Compiled | null {
  if (cache.has(pattern)) return cache.get(pattern)!;
  let res: Compiled | null = null;
  try {
    if (!pattern.isWellFormed()) throw new SyntaxError("surrogate");
    const p = new RegexParser(Array.from(pattern, (ch) => ch.codePointAt(0)!));
    const body = p.alt();
    if (p.i !== p.cps.length) p.fail(); // unmatched ")"
    res = { full: new RegExp("^(?:" + body + ")$", "u"), partial: new RegExp(body, "u") };
  } catch {
    res = null;
  }
  cache.set(pattern, res);
  return res;
}
