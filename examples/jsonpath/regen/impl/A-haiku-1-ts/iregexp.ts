// I-Regexp (RFC 9485) for match() and search(). A pattern is parsed into a small
// tree and compiled to a Thompson NFA that is simulated over the input, so matching
// never backtracks: time is proportional to input length times pattern size.
// Patterns that are not I-Regexps, or that would need an oversized automaton, are
// reported as null; the caller then treats the function as LogicalFalse.

export interface IRegexp {
  full(s: string): boolean;
  search(s: string): boolean;
}

type Test = (cp: number) => boolean;

type Tree =
  | { k: 'set'; test: Test }
  | { k: 'cat'; items: Tree[] }
  | { k: 'alt'; alts: Tree[] }
  | { k: 'rep'; e: Tree; min: number; max: number }; // max -1: unbounded

class NotIRegexp extends Error {}

// General categories allowed by the \p{...} grammar of RFC 9485 Figure 1.
const CATEGORIES = new Set([
  'L', 'Ll', 'Lm', 'Lo', 'Lt', 'Lu',
  'M', 'Mc', 'Me', 'Mn',
  'N', 'Nd', 'Nl', 'No',
  'P', 'Pc', 'Pd', 'Pe', 'Pf', 'Pi', 'Po', 'Ps',
  'Z', 'Zl', 'Zp', 'Zs',
  'S', 'Sc', 'Sk', 'Sm', 'So',
  'C', 'Cc', 'Cf', 'Cn', 'Co',
]);

// Punctuation that may follow a backslash (SingleCharEsc), besides n, r and t.
const ESCAPABLE = '()*+-.?[\\]^{|}';
// Characters that are not NormalChar and are not handled as special cases.
const SPECIAL = '()*+.?[\\]{|}';
const STATE_LIMIT = 20000;

function eq(x: number): Test {
  return (cp) => cp === x;
}

function isDigit(c: string): boolean {
  return c.length === 1 && c >= '0' && c <= '9';
}

function escapeValue(c: string): number | null {
  if (c === 'n') return 0x0a;
  if (c === 'r') return 0x0d;
  if (c === 't') return 0x09;
  if (c !== '' && ESCAPABLE.includes(c)) return c.codePointAt(0) as number;
  return null;
}

function scalar(cp: number): void {
  if (cp >= 0xd800 && cp <= 0xdfff) throw new NotIRegexp('surrogate code point');
}

class IParser {
  cs: string[];
  i: number;

  constructor(src: string) {
    this.cs = Array.from(src);
    this.i = 0;
  }

  cur(): string {
    return this.cs[this.i] ?? '';
  }

  fail(): never {
    throw new NotIRegexp(`not an I-Regexp at ${this.i}`);
  }

  alt(): Tree {
    const alts = [this.branch()];
    while (this.cur() === '|') {
      this.i++;
      alts.push(this.branch());
    }
    return alts.length === 1 ? alts[0] : { k: 'alt', alts };
  }

  branch(): Tree {
    const items: Tree[] = [];
    while (this.i < this.cs.length && this.cur() !== '|' && this.cur() !== ')') {
      items.push(this.piece());
    }
    return { k: 'cat', items };
  }

  piece(): Tree {
    const atom = this.atom();
    const q = this.quantifier();
    return q === null ? atom : { k: 'rep', e: atom, min: q.min, max: q.max };
  }

  atom(): Tree {
    const c = this.cur();
    if (c === '(') {
      this.i++;
      const t = this.alt();
      if (this.cur() !== ')') this.fail();
      this.i++;
      return t;
    }
    if (c === '.') {
      this.i++;
      return { k: 'set', test: (cp) => cp !== 0x0a && cp !== 0x0d };
    }
    if (c === '[') return this.charClass();
    if (c === '\\') return this.escape();
    if (c === '' || SPECIAL.includes(c)) this.fail();
    const cp = c.codePointAt(0) as number;
    scalar(cp);
    this.i++;
    return { k: 'set', test: eq(cp) };
  }

  quantifier(): { min: number; max: number } | null {
    const c = this.cur();
    if (c === '*') {
      this.i++;
      return { min: 0, max: -1 };
    }
    if (c === '+') {
      this.i++;
      return { min: 1, max: -1 };
    }
    if (c === '?') {
      this.i++;
      return { min: 0, max: 1 };
    }
    if (c !== '{') return null;
    this.i++;
    const min = this.digits();
    let max = min;
    if (this.cur() === ',') {
      this.i++;
      max = isDigit(this.cur()) ? this.digits() : -1;
    }
    if (this.cur() !== '}') this.fail();
    this.i++;
    if (max !== -1 && max < min) this.fail();
    return { min, max };
  }

  digits(): number {
    let s = '';
    while (isDigit(this.cur())) {
      s += this.cur();
      this.i++;
    }
    if (s === '') this.fail();
    return Number(s);
  }

  // A backslash outside a class: \p{..}, \P{..} or a single-character escape.
  escape(): Tree {
    this.i++;
    const c = this.cur();
    if (c === 'p' || c === 'P') {
      this.i++;
      return { k: 'set', test: this.category(c === 'P') };
    }
    const v = escapeValue(c);
    if (v === null) this.fail();
    this.i++;
    return { k: 'set', test: eq(v) };
  }

  // Starts at the '{' after \p or \P.
  category(negated: boolean): Test {
    if (this.cur() !== '{') this.fail();
    this.i++;
    let name = '';
    while (this.cur() !== '}' && this.cur() !== '') {
      name += this.cur();
      this.i++;
    }
    if (this.cur() !== '}' || !CATEGORIES.has(name)) this.fail();
    this.i++;
    const re = new RegExp('^\\p{' + name + '}$', 'u');
    return (cp) => re.test(String.fromCodePoint(cp)) !== negated;
  }

  charClass(): Tree {
    this.i++;
    let negated = false;
    if (this.cur() === '^') {
      negated = true;
      this.i++;
    }
    const tests: Test[] = [];
    for (;;) {
      const c = this.cur();
      if (c === ']') break;
      if (c === '') this.fail();
      if (c === '-') {
        // A leading '-' or a trailing '-' before ']' is a literal hyphen.
        if (tests.length === 0 || this.cs[this.i + 1] === ']') {
          this.i++;
          tests.push(eq(0x2d));
          continue;
        }
        this.fail();
      }
      if (c === '\\' && (this.cs[this.i + 1] === 'p' || this.cs[this.i + 1] === 'P')) {
        const negCat = this.cs[this.i + 1] === 'P';
        this.i += 2;
        tests.push(this.category(negCat));
        continue;
      }
      const lo = this.classChar();
      if (this.cur() === '-' && this.cs[this.i + 1] !== ']') {
        this.i++;
        const hi = this.classChar();
        if (hi < lo) this.fail();
        tests.push((cp) => cp >= lo && cp <= hi);
      } else {
        tests.push(eq(lo));
      }
    }
    this.i++;
    if (tests.length === 0) this.fail();
    const any: Test = (cp) => tests.some((t) => t(cp));
    return { k: 'set', test: negated ? (cp) => !any(cp) : any };
  }

  classChar(): number {
    const c = this.cur();
    if (c === '') this.fail();
    if (c === '\\') {
      const v = escapeValue(this.cs[this.i + 1] ?? '');
      if (v === null) this.fail();
      this.i += 2;
      return v;
    }
    if (c === '-' || c === '[' || c === ']') this.fail();
    const cp = c.codePointAt(0) as number;
    scalar(cp);
    this.i++;
    return cp;
  }
}

type RepTree = { e: Tree; min: number; max: number };

const CHAR = 0;
const SPLIT = 1;
const MATCH = 2;

interface State {
  kind: number;
  test: Test | null;
  out: number;
  alt: number;
}

class Builder {
  states: State[];

  constructor() {
    this.states = [];
  }

  push(kind: number, test: Test | null, out: number, alt: number): number {
    if (this.states.length >= STATE_LIMIT) throw new NotIRegexp('pattern too large');
    this.states.push({ kind, test, out, alt });
    return this.states.length - 1;
  }

  // Builds the automaton for t so that it continues at `next`; returns its entry.
  build(t: Tree, next: number): number {
    if (t.k === 'set') return this.push(CHAR, t.test, next, -1);
    if (t.k === 'cat') {
      let s = next;
      for (let i = t.items.length - 1; i >= 0; i--) s = this.build(t.items[i], s);
      return s;
    }
    if (t.k === 'alt') {
      const entries = t.alts.map((a) => this.build(a, next));
      let s = entries[entries.length - 1];
      for (let i = entries.length - 2; i >= 0; i--) s = this.push(SPLIT, null, entries[i], s);
      return s;
    }
    return this.rep(t, next);
  }

  rep(t: RepTree, next: number): number {
    let s = next;
    if (t.max === -1) {
      const loop = this.push(SPLIT, null, next, next);
      this.states[loop].out = this.build(t.e, loop);
      s = loop;
    } else {
      // Optional copies x(x(x)?)? : each may be skipped straight to `next`.
      for (let k = 0; k < t.max - t.min; k++) {
        const body = this.build(t.e, s);
        s = this.push(SPLIT, null, body, next);
      }
    }
    for (let k = 0; k < t.min; k++) s = this.build(t.e, s);
    return s;
  }
}

// Thompson simulation: a set of states, advanced one code point at a time.
function compile(tree: Tree): IRegexp {
  const b = new Builder();
  const accept = b.push(MATCH, null, -1, -1);
  const start = b.build(tree, accept);
  const states = b.states;
  const mark = new Int32Array(states.length);
  let gen = 0;

  const addClosure = (from: number, list: number[], g: number): void => {
    const stack = [from];
    while (stack.length > 0) {
      const x = stack.pop() as number;
      if (mark[x] === g) continue;
      mark[x] = g;
      const st = states[x];
      if (st.kind === SPLIT) stack.push(st.alt, st.out);
      else list.push(x);
    }
  };
  const step = (list: number[], cp: number, g: number): number[] => {
    const next: number[] = [];
    for (const x of list) {
      const st = states[x];
      if (st.kind === CHAR && (st.test as Test)(cp)) addClosure(st.out, next, g);
    }
    return next;
  };
  const accepts = (list: number[]): boolean => list.some((x) => states[x].kind === MATCH);

  return {
    full(s: string): boolean {
      let g = ++gen;
      let cur: number[] = [];
      addClosure(start, cur, g);
      for (const ch of s) {
        g = ++gen;
        cur = step(cur, ch.codePointAt(0) as number, g);
        if (cur.length === 0) return false;
      }
      return accepts(cur);
    },
    search(s: string): boolean {
      let g = ++gen;
      let cur: number[] = [];
      addClosure(start, cur, g);
      if (accepts(cur)) return true;
      for (const ch of s) {
        g = ++gen;
        cur = step(cur, ch.codePointAt(0) as number, g);
        addClosure(start, cur, g);
        if (accepts(cur)) return true;
      }
      return false;
    },
  };
}

const cache = new Map<string, IRegexp | null>();

// The matcher for an I-Regexp, or null if src is not one (or is too large to build).
export function compileIRegexp(src: string): IRegexp | null {
  const known = cache.get(src);
  if (known !== undefined) return known;
  let result: IRegexp | null;
  try {
    const p = new IParser(src);
    const tree = p.alt();
    if (p.i !== p.cs.length) p.fail();
    result = compile(tree);
  } catch (e) {
    if (!(e instanceof NotIRegexp)) throw e;
    result = null;
  }
  if (cache.size >= 500) cache.clear();
  cache.set(src, result);
  return result;
}
