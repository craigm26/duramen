// JSON values: null, boolean, string, Num, JsonArray, Map (objects).
// Numbers keep their lexeme so that arbitrary precision survives a round trip
// and comparisons are exact.

export class Num {
  text: string;
  private norm: { sign: number; m: bigint; e: bigint; mag: bigint } | null = null;

  constructor(text: string) {
    this.text = text;
  }

  private n() {
    if (this.norm) return this.norm;
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(this.text)!;
    const frac = m[3] ?? "";
    let mant = BigInt(m[2] + frac);
    let e = BigInt(m[4] ?? "0") - BigInt(frac.length);
    let sign = mant === 0n ? 0 : m[1] === "-" ? -1 : 1;
    if (mant === 0n) {
      this.norm = { sign: 0, m: 0n, e: 0n, mag: 0n };
      return this.norm;
    }
    while (mant % 10n === 0n) {
      mant /= 10n;
      e += 1n;
    }
    this.norm = { sign, m: mant, e, mag: BigInt(mant.toString().length) + e };
    return this.norm;
  }

  static cmp(a: Num, b: Num): number {
    const x = a.n();
    const y = b.n();
    if (x.sign !== y.sign) return x.sign < y.sign ? -1 : 1;
    if (x.sign === 0) return 0;
    let r: number;
    if (x.mag !== y.mag) {
      r = x.mag < y.mag ? -1 : 1;
    } else {
      let xm = x.m;
      let ym = y.m;
      if (x.e > y.e) xm *= 10n ** (x.e - y.e);
      else if (y.e > x.e) ym *= 10n ** (y.e - x.e);
      r = xm === ym ? 0 : xm < ym ? -1 : 1;
    }
    return r * x.sign;
  }
}

export type Json = null | boolean | string | Num | Json[] | Map<string, Json>;

const WS = new Set([" ", "\t", "\n", "\r"]);
const NUM_RE = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const ESC: Record<string, string> = {
  '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t",
};

// Strict RFC 8259 parser, iterative so that deep nesting cannot overflow the stack.
export function parseJson(s: string): Json {
  let i = 0;
  const fail = (): never => {
    throw new SyntaxError("bad json at " + i);
  };
  const ws = () => {
    while (i < s.length && WS.has(s[i])) i++;
  };
  const str = (): string => {
    // s[i] === '"'
    i++;
    let out = "";
    let start = i;
    for (;;) {
      if (i >= s.length) fail();
      const c = s.charCodeAt(i);
      if (c === 0x22) {
        out += s.slice(start, i);
        i++;
        return out;
      }
      if (c < 0x20) fail();
      if (c === 0x5c) {
        out += s.slice(start, i);
        const e = s[i + 1];
        if (e === "u") {
          const h = s.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(h)) fail();
          out += String.fromCharCode(parseInt(h, 16));
          i += 6;
        } else if (e !== undefined && Object.hasOwn(ESC, e)) {
          out += ESC[e];
          i += 2;
        } else fail();
        start = i;
      } else i++;
    }
  };
  type Frame = { arr: Json[] | null; map: Map<string, Json> | null; key: string };
  const stack: Frame[] = [];
  let result: Json = null;
  let done = false;

  const key = (f: Frame) => {
    ws();
    if (s[i] !== '"') fail();
    f.key = str();
    ws();
    if (s[i] !== ":") fail();
    i++;
  };
  // Hand a finished value to the enclosing container, then consume separators/closers.
  // Returns true when a new value is expected next.
  const emit = (v: Json): void => {
    for (;;) {
      if (stack.length === 0) {
        result = v;
        done = true;
        return;
      }
      const f = stack[stack.length - 1];
      if (f.arr) f.arr.push(v);
      else f.map!.set(f.key, v);
      ws();
      const c = s[i];
      if (c === ",") {
        i++;
        if (!f.arr) key(f);
        return;
      }
      if ((f.arr && c === "]") || (f.map && c === "}")) {
        i++;
        stack.pop();
        v = f.arr ?? f.map!;
        continue;
      }
      fail();
    }
  };

  while (!done) {
    ws();
    const c = s[i];
    if (c === "[") {
      i++;
      ws();
      if (s[i] === "]") {
        i++;
        emit([]);
      } else stack.push({ arr: [], map: null, key: "" });
    } else if (c === "{") {
      i++;
      ws();
      if (s[i] === "}") {
        i++;
        emit(new Map());
      } else {
        const f: Frame = { arr: null, map: new Map(), key: "" };
        stack.push(f);
        key(f);
      }
    } else if (c === '"') {
      emit(str());
    } else if (s.startsWith("true", i)) {
      i += 4;
      emit(true);
    } else if (s.startsWith("false", i)) {
      i += 5;
      emit(false);
    } else if (s.startsWith("null", i)) {
      i += 4;
      emit(null);
    } else {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(s);
      if (!m) fail();
      i += m![0].length;
      emit(new Num(m![0]));
    }
  }
  ws();
  if (i !== s.length) fail();
  return result;
}

// Iterative serializer producing compact single-line JSON.
export function stringify(v: Json): string {
  const out: string[] = [];
  const stack: (Json | { raw: string })[] = [v];
  while (stack.length) {
    const x = stack.pop()!;
    if (x === null) out.push("null");
    else if (typeof x === "string") out.push(JSON.stringify(x));
    else if (typeof x === "boolean") out.push(x ? "true" : "false");
    else if (x instanceof Num) out.push(x.text);
    else if (Array.isArray(x)) {
      out.push("[");
      stack.push({ raw: "]" });
      for (let k = x.length - 1; k >= 0; k--) {
        stack.push(x[k]);
        if (k > 0) stack.push({ raw: "," });
      }
    } else if (x instanceof Map) {
      out.push("{");
      stack.push({ raw: "}" });
      const entries = [...x];
      for (let k = entries.length - 1; k >= 0; k--) {
        stack.push(entries[k][1]);
        stack.push({ raw: JSON.stringify(entries[k][0]) + ":" });
        if (k > 0) stack.push({ raw: "," });
      }
    } else out.push((x as { raw: string }).raw);
  }
  return out.join("");
}
