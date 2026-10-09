// I-Regexp (RFC 9485, SPEC.md REQ-RX) for match() and search(). A pattern is checked against
// the grammar and rewritten as a JavaScript RegExp with the u flag. Every literal becomes a
// code point escape, and `.` becomes [^\n\r], so the engine cannot read a pattern differently.

// The general categories REQ-RX-004 names. Cs is not among them.
const CATEGORIES = new Set([
  "L", "Lu", "Ll", "Lt", "Lm", "Lo", "M", "Mn", "Mc", "Me", "N", "Nd", "Nl", "No",
  "P", "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po", "Z", "Zs", "Zl", "Zp", "S", "Sm", "Sc",
  "Sk", "So", "C", "Cc", "Cf", "Co", "Cn",
]);

// Code points that stand for themselves after a backslash, besides n, r and t (REQ-RX-005).
const ESCAPABLE = "()*+-.?[\\]^{|}";
const LETTER_ESCAPES = new Map([
  ["n", 0x0a],
  ["r", 0x0d],
  ["t", 0x09],
]);

class NotIRegexp extends Error {}

function reject(): never {
  throw new NotIRegexp("not an I-Regexp");
}

interface Cursor {
  cs: string[];
  pos: number;
}

// The JavaScript source of a pattern, or null when the pattern is not an I-Regexp.
export function translate(pattern: string): string | null {
  const c: Cursor = { cs: Array.from(pattern), pos: 0 };
  try {
    const src = alternation(c);
    return c.pos === c.cs.length ? src : null;
  } catch (e) {
    if (e instanceof NotIRegexp) return null;
    throw e;
  }
}

function codePoint(cp: number): string {
  return `\\u{${cp.toString(16)}}`;
}

function isNormalChar(cp: number): boolean {
  return (
    cp <= 0x27 ||
    cp === 0x2c ||
    cp === 0x2d ||
    (cp >= 0x2f && cp <= 0x3e) ||
    (cp >= 0x40 && cp <= 0x5a) ||
    (cp >= 0x5e && cp <= 0x7a) ||
    (cp >= 0x7e && cp <= 0xd7ff) ||
    (cp >= 0xe000 && cp <= 0x10ffff)
  );
}

// A character allowed in a class, as CCchar gives it (before escapes are considered).
function isClassChar(cp: number): boolean {
  return cp <= 0x2c || (cp >= 0x2e && cp <= 0x5a) || (cp >= 0x5e && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0x10ffff);
}

function isAsciiDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch.length === 1 && ch >= "0" && ch <= "9";
}

// The code point a backslash escape stands for, or null when the escape is not one (REQ-RX-005).
function singleEscape(ch: string | undefined): number | null {
  if (ch === undefined || ch.length !== 1) return null;
  if (LETTER_ESCAPES.has(ch)) return LETTER_ESCAPES.get(ch)!;
  if (ESCAPABLE.includes(ch)) return ch.charCodeAt(0);
  return null;
}

// i-regexp = branch *( "|" branch )
function alternation(c: Cursor): string {
  const branches = [branch(c)];
  while (c.cs[c.pos] === "|") {
    c.pos++;
    branches.push(branch(c));
  }
  return branches.join("|");
}

// branch = *piece
function branch(c: Cursor): string {
  let out = "";
  while (c.pos < c.cs.length && c.cs[c.pos] !== "|" && c.cs[c.pos] !== ")") {
    out += atom(c) + quantifier(c);
  }
  return out;
}

// atom = NormalChar / charClass / ( "(" i-regexp ")" )
function atom(c: Cursor): string {
  const ch = c.cs[c.pos];
  if (ch === "(") {
    c.pos++;
    const inner = alternation(c);
    if (c.cs[c.pos] !== ")") reject();
    c.pos++;
    return `(?:${inner})`;
  }
  if (ch === "[") return charClass(c);
  if (ch === "\\") return escape(c);
  if (ch === ".") {
    c.pos++;
    return "[^\\n\\r]";
  }
  const cp = ch.codePointAt(0)!;
  if (!isNormalChar(cp)) reject();
  c.pos++;
  return codePoint(cp);
}

// quantifier = ( "*" / "+" / "?" ) / range-quantifier, and nothing when none is there.
function quantifier(c: Cursor): string {
  const ch = c.cs[c.pos];
  if (ch === "*" || ch === "+" || ch === "?") {
    c.pos++;
    return ch;
  }
  if (ch !== "{") return "";
  c.pos++;
  const min = digits(c);
  if (min === null) reject();
  let out = `{${min}}`;
  if (c.cs[c.pos] === ",") {
    c.pos++;
    const max = digits(c);
    out = max === null ? `{${min},}` : `{${min},${max}}`;
  }
  if (c.cs[c.pos] !== "}") reject();
  c.pos++;
  return out;
}

function digits(c: Cursor): string | null {
  let s = "";
  while (isAsciiDigit(c.cs[c.pos])) {
    s += c.cs[c.pos];
    c.pos++;
  }
  return s === "" ? null : String(Number(s));
}

// A backslash outside a class: an escape or a category (REQ-RX-004, REQ-RX-005).
function escape(c: Cursor): string {
  const next = c.cs[c.pos + 1];
  if (next === "p" || next === "P") return property(c);
  const cp = singleEscape(next);
  if (cp === null) reject();
  c.pos += 2;
  return codePoint(cp);
}

// \p{X} or \P{X}, with X one of the names in CATEGORIES; c is at the backslash.
function property(c: Cursor): string {
  const negated = c.cs[c.pos + 1] === "P";
  if (c.cs[c.pos + 2] !== "{") reject();
  let end = c.pos + 3;
  let name = "";
  while (c.cs[end] !== undefined && c.cs[end] !== "}") {
    name += c.cs[end];
    end++;
  }
  if (c.cs[end] !== "}" || !CATEGORIES.has(name)) reject();
  c.pos = end + 1;
  return `\\${negated ? "P" : "p"}{${name}}`;
}

// One code point of a class (CCchar), escapes included.
function classChar(c: Cursor): number {
  const ch = c.cs[c.pos];
  if (ch === undefined) reject();
  if (ch === "\\") {
    const cp = singleEscape(c.cs[c.pos + 1]);
    if (cp === null) reject();
    c.pos += 2;
    return cp;
  }
  const cp = ch.codePointAt(0)!;
  if (!isClassChar(cp)) reject();
  c.pos++;
  return cp;
}

// charClassExpr = "[" [ "^" ] ( "-" / CCE1 ) *CCE1 [ "-" ] "]"
function charClass(c: Cursor): string {
  c.pos++;
  let negated = false;
  if (c.cs[c.pos] === "^") {
    negated = true;
    c.pos++;
  }
  let items = "";
  let count = 0;
  for (;;) {
    const ch = c.cs[c.pos];
    if (ch === undefined) reject();
    if (ch === "]") {
      if (count === 0) reject();
      c.pos++;
      break;
    }
    // A "-" first in the class, or one right before "]", stands for itself.
    if (ch === "-" && (count === 0 || c.cs[c.pos + 1] === "]")) {
      items += codePoint(0x2d);
      c.pos++;
    } else if (ch === "\\" && (c.cs[c.pos + 1] === "p" || c.cs[c.pos + 1] === "P")) {
      items += property(c);
    } else {
      const lo = classChar(c);
      if (c.cs[c.pos] === "-" && c.cs[c.pos + 1] !== "]") {
        c.pos++;
        const hi = classChar(c);
        if (hi < lo) reject();
        items += `${codePoint(lo)}-${codePoint(hi)}`;
      } else {
        items += codePoint(lo);
      }
    }
    count++;
  }
  return `[${negated ? "^" : ""}${items}]`;
}

const cache = new Map<string, { whole: RegExp; part: RegExp } | null>();

function compile(pattern: string): { whole: RegExp; part: RegExp } | null {
  let compiled = cache.get(pattern);
  if (compiled !== undefined) return compiled;
  const src = translate(pattern);
  compiled = null;
  if (src !== null) {
    try {
      compiled = { whole: new RegExp(`^(?:${src})$`, "u"), part: new RegExp(src, "u") };
    } catch {
      // The engine refuses some valid-looking patterns, such as a range {3,2}; they are not I-Regexps.
      compiled = null;
    }
  }
  cache.set(pattern, compiled);
  return compiled;
}

// match(): the whole subject matches the pattern. False when the pattern is not an I-Regexp.
export function matchesWhole(subject: string, pattern: string): boolean {
  const re = compile(pattern);
  return re !== null && re.whole.test(subject);
}

// search(): some substring of the subject matches the pattern.
export function matchesPart(subject: string, pattern: string): boolean {
  const re = compile(pattern);
  return re !== null && re.part.test(subject);
}
