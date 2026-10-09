// Parses a JSONPath query (SPEC.md, Well-formed and valid queries) into the tree the
// evaluator runs. A query that is not well formed or not valid throws QueryError
// (REQ-RQ-004). Input is read as code points: each element of `cs` is one code point.

export class QueryError extends Error {}

export type Literal = number | string | boolean | null;

export type Selector =
  | { kind: "name"; name: string }
  | { kind: "index"; index: number }
  | { kind: "slice"; start: number | null; end: number | null; step: number | null }
  | { kind: "wild" }
  | { kind: "filter"; expr: Expr };

export interface Segment {
  descendant: boolean;
  selectors: Selector[];
  // True for `.name` and for a bracket holding one name or index and no blank space (REQ-SY-009).
  singular: boolean;
}

export interface Query {
  root: "$" | "@";
  segments: Segment[];
  singular: boolean;
}

export interface Call {
  name: string;
  args: Operand[];
}

export type Operand =
  | { kind: "literal"; value: Literal }
  | { kind: "query"; query: Query }
  | { kind: "call"; call: Call };

export type Expr =
  | { kind: "or"; items: Expr[] }
  | { kind: "and"; items: Expr[] }
  | { kind: "not"; expr: Expr }
  | { kind: "test"; query: Query }
  | { kind: "call"; call: Call }
  | { kind: "compare"; op: string; left: Operand; right: Operand };

// Parameter types and result type of each function (REQ-SY-010, REQ-SY-011).
interface Signature {
  params: Array<"value" | "nodes">;
  result: "value" | "logical";
}

const FUNCTIONS = new Map<string, Signature>([
  ["length", { params: ["value"], result: "value" }],
  ["count", { params: ["nodes"], result: "value" }],
  ["match", { params: ["value", "value"], result: "logical" }],
  ["search", { params: ["value", "value"], result: "logical" }],
  ["value", { params: ["nodes"], result: "value" }],
]);

const COMPARE_OPS = ["==", "!=", "<=", ">="];

const SIMPLE_ESCAPES: Record<string, string> = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  "/": "/",
  "\\": "\\",
};

interface Input {
  cs: string[];
  pos: number;
  // Count of blank space code points skipped so far; used to tell whether a bracket has any.
  blanks: number;
}

function fail(reason: string): never {
  throw new QueryError(reason);
}

function peek(p: Input, k = 0): string {
  return p.cs[p.pos + k] ?? "";
}

function isBlank(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

function skipBlank(p: Input): void {
  while (isBlank(peek(p))) {
    p.pos++;
    p.blanks++;
  }
}

function eat(p: Input, c: string): void {
  if (peek(p) !== c) fail(`expected ${c}`);
  p.pos++;
}

function isDigit(c: string): boolean {
  return c.length === 1 && c >= "0" && c <= "9";
}

function isNonZeroDigit(c: string): boolean {
  return c.length === 1 && c >= "1" && c <= "9";
}

function isLower(c: string): boolean {
  return c.length === 1 && c >= "a" && c <= "z";
}

function isAsciiLetter(c: string): boolean {
  return c.length === 1 && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));
}

function isNameStart(c: string): boolean {
  return isAsciiLetter(c) || c === "_" || (c !== "" && c.codePointAt(0)! >= 0x80);
}

function isNameChar(c: string): boolean {
  return isNameStart(c) || isDigit(c);
}

function isLiteralStart(c: string): boolean {
  return c === "'" || c === '"' || c === "-" || isDigit(c) || c === "t" || c === "f" || c === "n";
}

function takeDigits(p: Input): void {
  while (isDigit(peek(p))) p.pos++;
}

// A JSON-like integer (REQ-SY-004): 0, or an optional minus and a digit 1-9 and more digits.
// Returns null when no integer starts here; the caller decides whether that is an error.
function parseInteger(p: Input): number | null {
  const c = peek(p);
  if (c !== "-" && !isDigit(c)) return null;
  const start = p.pos;
  if (c === "-") p.pos++;
  const d = peek(p);
  if (d === "0") {
    if (c === "-") fail("-0 is not an integer here");
    p.pos++;
    return 0;
  }
  if (!isNonZeroDigit(d)) fail("bad integer");
  takeDigits(p);
  const n = Number(p.cs.slice(start, p.pos).join(""));
  if (Math.abs(n) > Number.MAX_SAFE_INTEGER) fail("integer out of range");
  return n;
}

// A number literal (REQ-SY-008). Its value is not range-checked (decision D-002).
function parseNumber(p: Input): number {
  const start = p.pos;
  if (peek(p) === "-") p.pos++;
  if (peek(p) === "0") {
    p.pos++;
  } else if (isNonZeroDigit(peek(p))) {
    takeDigits(p);
  } else {
    fail("bad number");
  }
  if (peek(p) === ".") {
    p.pos++;
    if (!isDigit(peek(p))) fail("digit expected after .");
    takeDigits(p);
  }
  if (peek(p) === "e" || peek(p) === "E") {
    p.pos++;
    if (peek(p) === "+" || peek(p) === "-") p.pos++;
    if (!isDigit(peek(p))) fail("digit expected in exponent");
    takeDigits(p);
  }
  return Number(p.cs.slice(start, p.pos).join(""));
}

function hex4(p: Input): number {
  const digits = p.cs.slice(p.pos, p.pos + 4).join("");
  if (!/^[0-9A-Fa-f]{4}$/.test(digits)) fail("\\u needs four hexadecimal digits");
  p.pos += 4;
  return parseInt(digits, 16);
}

// The code point after \u (REQ-SY-003): one escape, or a high and a low surrogate escape.
function unicodeEscape(p: Input): string {
  const hi = hex4(p);
  if (hi >= 0xdc00 && hi <= 0xdfff) fail("lone low surrogate");
  if (hi < 0xd800 || hi > 0xdbff) return String.fromCharCode(hi);
  if (peek(p) !== "\\" || peek(p, 1) !== "u") fail("lone high surrogate");
  p.pos += 2;
  const lo = hex4(p);
  if (lo < 0xdc00 || lo > 0xdfff) fail("high surrogate not followed by a low one");
  return String.fromCharCode(hi, lo);
}

// One escape in a string literal; p is at the backslash.
function stringEscape(p: Input, quote: string): string {
  const e = peek(p, 1);
  p.pos += 2;
  if (e in SIMPLE_ESCAPES && e.length === 1) return SIMPLE_ESCAPES[e];
  if (e === "'" && quote === "'") return "'";
  if (e === '"' && quote === '"') return '"';
  if (e === "u") return unicodeEscape(p);
  return fail("unknown escape");
}

// A string literal, single or double quoted (REQ-SY-003).
function parseString(p: Input): string {
  const quote = peek(p);
  p.pos++;
  let out = "";
  for (;;) {
    const c = peek(p);
    if (c === "") fail("unclosed string");
    if (c === quote) {
      p.pos++;
      return out;
    }
    if (c === "\\") {
      out += stringEscape(p, quote);
      continue;
    }
    if (c.codePointAt(0)! < 0x20) fail("control code point in a string");
    out += c;
    p.pos++;
  }
}

const WORDS: Array<[string, Literal]> = [
  ["true", true],
  ["false", false],
  ["null", null],
];

function parseLiteral(p: Input): Literal {
  const c = peek(p);
  if (c === "'" || c === '"') return parseString(p);
  if (c === "-" || isDigit(c)) return parseNumber(p);
  for (const [word, value] of WORDS) {
    if (p.cs.slice(p.pos, p.pos + word.length).join("") === word) {
      p.pos += word.length;
      return value;
    }
  }
  return fail("bad literal");
}

// A member name after a dot (REQ-SY-002).
function memberName(p: Input): string {
  if (!isNameStart(peek(p))) fail("bad member name");
  let name = "";
  while (isNameChar(peek(p))) {
    name += peek(p);
    p.pos++;
  }
  return name;
}

function parseDotSegment(p: Input): Segment {
  p.pos++;
  if (peek(p) === "*") {
    p.pos++;
    return { descendant: false, selectors: [{ kind: "wild" }], singular: false };
  }
  if (peek(p) !== ".") {
    return { descendant: false, selectors: [{ kind: "name", name: memberName(p) }], singular: true };
  }
  p.pos++;
  if (peek(p) === "[") {
    return { descendant: true, selectors: parseBracketed(p).selectors, singular: false };
  }
  if (peek(p) === "*") {
    p.pos++;
    return { descendant: true, selectors: [{ kind: "wild" }], singular: false };
  }
  return { descendant: true, selectors: [{ kind: "name", name: memberName(p) }], singular: false };
}

// The integers and colons of an index or a slice (REQ-SY-004, REQ-SY-005).
function parseIndexOrSlice(p: Input): Selector {
  const first = parseInteger(p);
  skipBlank(p);
  if (peek(p) !== ":") {
    if (first === null) fail("empty selector");
    return { kind: "index", index: first };
  }
  p.pos++;
  skipBlank(p);
  const end = parseInteger(p);
  skipBlank(p);
  let step: number | null = null;
  if (peek(p) === ":") {
    p.pos++;
    skipBlank(p);
    step = parseInteger(p);
    skipBlank(p);
  }
  return { kind: "slice", start: first, end, step };
}

function parseSelector(p: Input): Selector {
  const c = peek(p);
  if (c === "'" || c === '"') return { kind: "name", name: parseString(p) };
  if (c === "*") {
    p.pos++;
    return { kind: "wild" };
  }
  if (c === "?") {
    p.pos++;
    skipBlank(p);
    return { kind: "filter", expr: parseLogicalOr(p) };
  }
  return parseIndexOrSlice(p);
}

// A bracketed selection (REQ-SY-006). `plain` is true when no blank space sits inside it.
function parseBracketed(p: Input): { selectors: Selector[]; plain: boolean } {
  eat(p, "[");
  const before = p.blanks;
  skipBlank(p);
  const selectors: Selector[] = [];
  for (;;) {
    selectors.push(parseSelector(p));
    skipBlank(p);
    if (peek(p) !== ",") break;
    p.pos++;
    skipBlank(p);
  }
  eat(p, "]");
  return { selectors, plain: p.blanks === before };
}

function parseBracketSegment(p: Input): Segment {
  const { selectors, plain } = parseBracketed(p);
  const single = selectors.length === 1 && (selectors[0].kind === "name" || selectors[0].kind === "index");
  return { descendant: false, selectors, singular: plain && single };
}

// Segments follow, each with blank space allowed before it (REQ-SY-001). Blank space that is
// not followed by a segment is left for the caller.
function parseSegments(p: Input): Segment[] {
  const segments: Segment[] = [];
  for (;;) {
    const save = p.pos;
    skipBlank(p);
    const c = peek(p);
    if (c === ".") {
      segments.push(parseDotSegment(p));
    } else if (c === "[") {
      segments.push(parseBracketSegment(p));
    } else {
      p.pos = save;
      return segments;
    }
  }
}

// A query from `$` or `@` and its segments.
function parseEmbeddedQuery(p: Input): Query {
  const root = peek(p) === "@" ? "@" : "$";
  p.pos++;
  const segments = parseSegments(p);
  return { root, segments, singular: segments.every((s) => s.singular) };
}

// A function call, with its arguments checked against the signature (REQ-SY-010, REQ-SY-011).
function parseCall(p: Input): Call {
  let name = "";
  while (isLower(peek(p)) || isDigit(peek(p)) || peek(p) === "_") {
    name += peek(p);
    p.pos++;
  }
  eat(p, "(");
  skipBlank(p);
  const args: Operand[] = [];
  if (peek(p) !== ")") {
    for (;;) {
      args.push(parseArgument(p));
      skipBlank(p);
      if (peek(p) !== ",") break;
      p.pos++;
      skipBlank(p);
    }
  }
  eat(p, ")");
  const signature = FUNCTIONS.get(name);
  if (signature === undefined || signature.params.length !== args.length) fail("unknown function or wrong arity");
  signature.params.forEach((kind, i) => checkArgument(kind, args[i]));
  return { name, args };
}

// An argument is a literal, a query or a function call. A logical expression is none of
// these, so a comparison or a parenthesized expression here ends the call with an error.
function parseArgument(p: Input): Operand {
  const c = peek(p);
  if (c === "@" || c === "$") return { kind: "query", query: parseEmbeddedQuery(p) };
  if (isLiteralStart(c)) return { kind: "literal", value: parseLiteral(p) };
  if (isLower(c)) return { kind: "call", call: parseCall(p) };
  return fail("expected an argument");
}

function checkArgument(kind: "value" | "nodes", arg: Operand): void {
  if (kind === "nodes") {
    if (arg.kind !== "query") fail("expected a nodelist argument");
    return;
  }
  if (arg.kind === "query" && !arg.query.singular) fail("expected a singular query");
  if (arg.kind === "call" && FUNCTIONS.get(arg.call.name)!.result !== "value") fail("expected a value");
}

// A comparison operator, with blank space allowed before it. Consumes nothing when there is none.
function readCompareOp(p: Input): string | null {
  const save = p.pos;
  skipBlank(p);
  const two = peek(p) + peek(p, 1);
  if (COMPARE_OPS.includes(two)) {
    p.pos += 2;
    return two;
  }
  const one = peek(p);
  if (one === "<" || one === ">") {
    p.pos++;
    return one;
  }
  p.pos = save;
  return null;
}

// The right-hand side of a comparison (REQ-SY-009).
function parseComparable(p: Input): Operand {
  skipBlank(p);
  const c = peek(p);
  if (c === "@" || c === "$") {
    const query = parseEmbeddedQuery(p);
    if (!query.singular) fail("comparison needs a singular query");
    return { kind: "query", query };
  }
  if (isLiteralStart(c)) return { kind: "literal", value: parseLiteral(p) };
  if (isLower(c)) {
    const call = parseCall(p);
    if (FUNCTIONS.get(call.name)!.result !== "value") fail("comparison needs a value");
    return { kind: "call", call };
  }
  return fail("expected a comparable");
}

function compare(p: Input, op: string, left: Operand): Expr {
  return { kind: "compare", op, left, right: parseComparable(p) };
}

function negate(negated: boolean, expr: Expr): Expr {
  return negated ? { kind: "not", expr } : expr;
}

// A basic expression (REQ-SY-007): a parenthesized expression, a test or a comparison.
function parseBasic(p: Input): Expr {
  let negated = false;
  if (peek(p) === "!") {
    p.pos++;
    skipBlank(p);
    negated = true;
  }
  const c = peek(p);
  if (c === "(") {
    p.pos++;
    skipBlank(p);
    const expr = parseLogicalOr(p);
    skipBlank(p);
    eat(p, ")");
    return negate(negated, expr);
  }
  if (c === "@" || c === "$") {
    const query = parseEmbeddedQuery(p);
    const op = readCompareOp(p);
    if (op === null) return negate(negated, { kind: "test", query });
    if (negated || !query.singular) fail("comparison needs a singular query");
    return compare(p, op, { kind: "query", query });
  }
  if (isLiteralStart(c)) {
    if (negated) fail("! applies to a test or a parenthesized expression");
    const value = parseLiteral(p);
    const op = readCompareOp(p);
    if (op === null) fail("a literal is not a test");
    return compare(p, op, { kind: "literal", value });
  }
  if (isLower(c)) {
    const call = parseCall(p);
    const result = FUNCTIONS.get(call.name)!.result;
    const op = readCompareOp(p);
    if (op !== null) {
      if (negated || result !== "value") fail("comparison needs a value");
      return compare(p, op, { kind: "call", call });
    }
    if (result !== "logical") fail("a function that gives a value is not a test");
    return negate(negated, { kind: "call", call });
  }
  return fail("expected a basic expression");
}

function parseLogicalAnd(p: Input): Expr {
  const items = [parseBasic(p)];
  for (;;) {
    skipBlank(p);
    if (peek(p) !== "&" || peek(p, 1) !== "&") break;
    p.pos += 2;
    skipBlank(p);
    items.push(parseBasic(p));
  }
  return items.length === 1 ? items[0] : { kind: "and", items };
}

function parseLogicalOr(p: Input): Expr {
  const items = [parseLogicalAnd(p)];
  for (;;) {
    skipBlank(p);
    if (peek(p) !== "|" || peek(p, 1) !== "|") break;
    p.pos += 2;
    skipBlank(p);
    items.push(parseLogicalAnd(p));
  }
  return items.length === 1 ? items[0] : { kind: "or", items };
}

// Parses a whole query text (REQ-SY-001). Only `$` may begin it.
export function parseQuery(text: string): Query {
  const p: Input = { cs: Array.from(text), pos: 0, blanks: 0 };
  if (peek(p) !== "$") fail("a query begins with $");
  const query = parseEmbeddedQuery(p);
  if (p.pos !== p.cs.length) fail("text after the query");
  return query;
}
