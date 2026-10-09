// I-Regexp (RFC 9485) as SPEC R27 and R28 define it. A pattern is checked against the grammar of
// R27 (plus its three extra rules) and translated to a JavaScript RegExp with the u flag, which is
// the translation Appendix D allows. An invalid pattern gives null, never an error (R24).

// SPEC Appendix A / R27: the general-category names that charProp accepts. The grammar has no Cs.
const PROPERTIES = new Set([
  'L', 'Ll', 'Lm', 'Lo', 'Lt', 'Lu',
  'M', 'Mc', 'Me', 'Mn',
  'N', 'Nd', 'Nl', 'No',
  'P', 'Pc', 'Pd', 'Pe', 'Pf', 'Pi', 'Po', 'Ps',
  'Z', 'Zl', 'Zp', 'Zs',
  'S', 'Sc', 'Sk', 'Sm', 'So',
  'C', 'Cc', 'Cf', 'Cn', 'Co',
]);
// SingleCharEsc characters that stand for themselves; \n, \r and \t are handled separately.
const ESCAPABLE = '()*+-.?[\\]^|{}';

export interface CompiledPattern {
  readonly full: RegExp;
  readonly search: RegExp;
}

class InvalidPattern extends Error {}

const cache = new Map<string, CompiledPattern | null>();

export function compileIRegexp(pattern: string): CompiledPattern | null {
  let compiled = cache.get(pattern);
  if (compiled === undefined) {
    compiled = build(pattern);
    cache.set(pattern, compiled);
  }
  return compiled;
}

function build(pattern: string): CompiledPattern | null {
  let source: string;
  try {
    source = new Translator(pattern).translate();
  } catch (error) {
    if (error instanceof InvalidPattern) return null;
    throw error;
  }
  return { full: new RegExp(`^(?:${source})$`, 'u'), search: new RegExp(source, 'u') };
}

function codeUnit(cp: number): string {
  return `\\u{${cp.toString(16)}}`;
}

function singleEscape(c: string): number | null {
  if (c === 'n') return 0x0a;
  if (c === 'r') return 0x0d;
  if (c === 't') return 0x09;
  if (c !== '' && ESCAPABLE.includes(c)) return c.codePointAt(0) ?? null;
  return null;
}

// Parses the pattern and emits the equivalent JavaScript source. Throws InvalidPattern.
class Translator {
  private readonly cs: string[] = [];
  private pos = 0;

  constructor(pattern: string) {
    for (const ch of pattern) {
      const cp = ch.codePointAt(0) ?? 0;
      // Characters of an I-Regexp are scalar values (R27).
      if (cp >= 0xd800 && cp <= 0xdfff) throw new InvalidPattern('lone surrogate');
      this.cs.push(ch);
    }
  }

  translate(): string {
    const source = this.alternation();
    if (this.pos !== this.cs.length) throw new InvalidPattern('unmatched )');
    return source;
  }

  private at(offset = 0): string {
    return this.cs[this.pos + offset] ?? '';
  }

  private alternation(): string {
    const branches = [this.branch()];
    while (this.at() === '|') {
      this.pos++;
      branches.push(this.branch());
    }
    return branches.join('|');
  }

  private branch(): string {
    let out = '';
    while (this.pos < this.cs.length && this.at() !== '|' && this.at() !== ')') {
      out += this.piece();
    }
    return out;
  }

  private piece(): string {
    const atom = this.atom();
    return atom + this.quantifier();
  }

  private atom(): string {
    const c = this.at();
    if (c === '(') {
      this.pos++;
      const inner = this.alternation();
      if (this.at() !== ')') throw new InvalidPattern('unclosed (');
      this.pos++;
      return `(?:${inner})`;
    }
    if (c === '[') return this.charClass();
    if (c === '.') {
      this.pos++;
      return `[^${codeUnit(0x0a)}${codeUnit(0x0d)}]`;
    }
    if (c === '\\') return this.escape();
    if (c === '*' || c === '+' || c === '?' || c === '{' || c === '}' || c === ']') {
      throw new InvalidPattern('quantifier or bracket without an atom');
    }
    this.pos++;
    return codeUnit(c.codePointAt(0) ?? 0);
  }

  private quantifier(): string {
    const c = this.at();
    if (c === '*' || c === '+' || c === '?') {
      this.pos++;
      return c;
    }
    if (c !== '{') return '';
    this.pos++;
    const min = this.digits();
    if (min === null) throw new InvalidPattern('range quantifier without a minimum');
    let text = `{${min}`;
    if (this.at() === ',') {
      this.pos++;
      const max = this.digits();
      if (max !== null && BigInt(min) > BigInt(max)) throw new InvalidPattern('{n,m} with n > m');
      text += `,${max ?? ''}`;
    }
    if (this.at() !== '}') throw new InvalidPattern('unclosed {');
    this.pos++;
    return `${text}}`;
  }

  private digits(): string | null {
    let out = '';
    while (/^[0-9]$/.test(this.at())) out += this.cs[this.pos++];
    return out === '' ? null : BigInt(out).toString();
  }

  // escape outside a class: SingleCharEsc or charClassEsc.
  private escape(): string {
    this.pos++;
    const c = this.at();
    if (c === 'p' || c === 'P') {
      this.pos++;
      return `\\${c}{${this.property()}}`;
    }
    const cp = singleEscape(c);
    if (cp === null) throw new InvalidPattern('invalid escape');
    this.pos++;
    return codeUnit(cp);
  }

  // charProp, after "\p" or "\P", up to and including the closing brace.
  private property(): string {
    if (this.at() !== '{') throw new InvalidPattern('expected {');
    this.pos++;
    let name = '';
    while (/^[A-Za-z]$/.test(this.at())) name += this.cs[this.pos++];
    if (this.at() !== '}' || !PROPERTIES.has(name)) throw new InvalidPattern('unknown property');
    this.pos++;
    return name;
  }

  // charClassExpr: "[" ["^"] ("-" / CCE1) *CCE1 ["-"] "]"
  private charClass(): string {
    this.pos++;
    let negation = '';
    if (this.at() === '^') {
      negation = '^';
      this.pos++;
    }
    const items: string[] = [];
    if (this.at() === '-') {
      items.push(codeUnit(0x2d));
      this.pos++;
    } else {
      items.push(this.classItem());
    }
    while (this.at() !== ']' && this.at() !== '-' && this.at() !== '') {
      items.push(this.classItem());
    }
    if (this.at() === '-') {
      items.push(codeUnit(0x2d));
      this.pos++;
    }
    if (this.at() !== ']') throw new InvalidPattern('unclosed [');
    this.pos++;
    return `[${negation}${items.join('')}]`;
  }

  // CCE1 = (CCchar ["-" CCchar]) / charClassEsc
  private classItem(): string {
    if (this.at() === '\\' && /^[pP]$/.test(this.at(1))) {
      this.pos++;
      const kind = this.at();
      this.pos++;
      return `\\${kind}{${this.property()}}`;
    }
    const first = this.classChar();
    if (first === null) throw new InvalidPattern('invalid character in a class');
    if (this.at() !== '-') return codeUnit(first);
    const save = this.pos;
    this.pos++;
    const last = this.classChar();
    if (last === null) {
      this.pos = save;
      return codeUnit(first);
    }
    if (last < first) throw new InvalidPattern('class range out of order');
    return `${codeUnit(first)}-${codeUnit(last)}`;
  }

  // CCchar: any character except - [ \ ], or a SingleCharEsc. Returns null where a CCchar cannot
  // start (the closing bracket, a dash, an opening bracket, or a charClassEsc).
  private classChar(): number | null {
    const c = this.at();
    if (c === '' || c === '-' || c === '[' || c === ']') return null;
    if (c === '\\') {
      const next = this.at(1);
      if (next === 'p' || next === 'P') return null;
      const cp = singleEscape(next);
      if (cp === null) throw new InvalidPattern('invalid escape in a class');
      this.pos += 2;
      return cp;
    }
    this.pos++;
    return c.codePointAt(0) ?? 0;
  }
}
