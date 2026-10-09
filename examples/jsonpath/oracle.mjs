// The model of jsonpath: JSONPath queries as RFC 9535 defines them, with RFC 9485 (I-Regexp) for
// the regular expressions of match() and search(). Written to jsonpath.duramen, from the two RFC
// texts. A query is parsed by recursive descent on its code points, following the ABNF of RFC 9535
// (Appendix A); then checked for what the grammar alone does not say (singular queries where a
// value is needed, and the types of function expressions, section 2.4.3); and only then
// evaluated. Object members are visited in the order of their names, compared code point by code
// point (the record's decision D-001).

export class InvalidQuery extends Error {}
const fail = (why) => { throw new InvalidQuery(why); };

const MAX_EXACT = 2 ** 53 - 1; // I-JSON: integers in [-(2^53)+1, (2^53)-1]
export const NOTHING = Symbol('Nothing');
const VALUE = 'ValueType', LOGICAL = 'LogicalType', NODES = 'NodesType';
const FUNCTIONS = new Map([
  ['length', { params: [VALUE], result: VALUE }],
  ['count', { params: [NODES], result: VALUE }],
  ['match', { params: [VALUE, VALUE], result: LOGICAL }],
  ['search', { params: [VALUE, VALUE], result: LOGICAL }],
  ['value', { params: [NODES], result: VALUE }],
]);

// ---------- characters (each a string of one code point, or undefined at the end)
const cp = (c) => c.codePointAt(0);
const isBlank = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const isDigit = (c) => c !== undefined && c.length === 1 && c >= '0' && c <= '9';
const isDigit1 = (c) => isDigit(c) && c !== '0';
const isAlpha = (c) => c !== undefined && c.length === 1 && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'));
const isLcAlpha = (c) => c !== undefined && c.length === 1 && c >= 'a' && c <= 'z';
const isScalar = (n) => (n >= 0 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0x10ffff);
const isNameFirst = (c) => c !== undefined && (isAlpha(c) || c === '_' || (cp(c) >= 0x80 && isScalar(cp(c))));
const isNameChar = (c) => isNameFirst(c) || isDigit(c);

// Strings compared by their Unicode scalar values (not UTF-16 code units).
export function cmpCodePoints(a, b) {
  const x = [...a], y = [...b];
  for (let k = 0; k < x.length && k < y.length; k++) {
    const d = cp(x[k]) - cp(y[k]);
    if (d) return d;
  }
  return x.length - y.length;
}

// ---------- the query parser
class Parser {
  constructor(text) { this.s = [...text]; this.i = 0; }
  get c() { return this.s[this.i]; }
  skipS() { while (this.c !== undefined && isBlank(this.c)) this.i++; }
  eat(ch) { if (this.c === ch) { this.i++; return true; } return false; }
  need(ch, why) { if (!this.eat(ch)) fail(why ?? `expected ${ch}`); }
  ahead(str) { return [...str].every((ch, k) => this.s[this.i + k] === ch); }

  // segments = *(S segment): blank space is taken only when a segment follows it
  segments() {
    const out = [];
    for (;;) {
      const save = this.i;
      this.skipS();
      if (this.c === '.' || this.c === '[') out.push(this.segment());
      else { this.i = save; return out; }
    }
  }

  segment() {
    if (this.eat('[')) return { desc: false, ...this.bracketed() };
    this.need('.');
    if (this.eat('.')) {
      if (this.eat('[')) return { desc: true, ...this.bracketed() };
      if (this.eat('*')) return { desc: true, selectors: [{ kind: 'wild' }], singular: false };
      if (isNameFirst(this.c)) return { desc: true, selectors: [{ kind: 'name', name: this.shorthand() }], singular: false };
      fail('.. is followed by a bracketed selection, * or a member name');
    }
    if (this.eat('*')) return { desc: false, selectors: [{ kind: 'wild' }], singular: false };
    if (isNameFirst(this.c)) return { desc: false, selectors: [{ kind: 'name', name: this.shorthand() }], singular: true };
    fail('. is followed by * or a member name');
  }

  shorthand() { let n = ''; while (isNameChar(this.c)) n += this.s[this.i++]; return n; }

  // "[" S selector *(S "," S selector) S "]", after the "[". It is in the form a singular query
  // allows when it holds one name or index selector and no blank space (decision D-003).
  bracketed() {
    const start = this.i;
    this.skipS();
    const selectors = [this.selector()];
    for (;;) {
      this.skipS();
      if (!this.eat(',')) break;
      this.skipS();
      selectors.push(this.selector());
    }
    const end = this.i;
    this.need(']', 'expected , or ]');
    const one = selectors.length === 1 && (selectors[0].kind === 'name' || selectors[0].kind === 'index');
    return { selectors, singular: one && !isBlank(this.s[start]) && !isBlank(this.s[end - 1]) };
  }

  selector() {
    const c = this.c;
    if (c === "'" || c === '"') return { kind: 'name', name: this.stringLiteral() };
    if (c === '*') { this.i++; return { kind: 'wild' }; }
    if (c === '?') { this.i++; this.skipS(); return { kind: 'filter', expr: this.logicalOr() }; }
    const start = this.int();
    const save = this.i;
    this.skipS();
    if (this.eat(':')) {
      this.skipS();
      const end = this.int();
      this.skipS();
      let step = null;
      if (this.eat(':')) { this.skipS(); step = this.int(); }
      return { kind: 'slice', start, end, step };
    }
    this.i = save;
    if (start === null) fail('expected a selector');
    return { kind: 'index', index: start };
  }

  // int = "0" / (["-"] DIGIT1 *DIGIT), within the I-JSON range; null when no int starts here
  int() {
    let t = '';
    if (this.c === '-') { t = '-'; this.i++; if (!isDigit1(this.c)) fail('- is followed by a digit 1 to 9'); }
    else if (this.c === '0') { this.i++; return 0; }
    else if (!isDigit1(this.c)) return null;
    while (isDigit(this.c)) t += this.s[this.i++];
    const v = Number(t);
    if (Math.abs(v) > MAX_EXACT) fail('an integer outside the I-JSON range');
    return v;
  }

  stringLiteral() {
    const q = this.s[this.i++];
    const other = q === "'" ? '"' : "'";
    let out = '';
    for (;;) {
      const c = this.c;
      if (c === undefined) fail('a string literal without its closing quote');
      this.i++;
      if (c === q) return out;
      if (c === '\\') { out += this.escape(q); continue; }
      const n = cp(c);
      if (c === other || (n >= 0x20 && n !== 0x22 && n !== 0x27 && n !== 0x5c && isScalar(n))) { out += c; continue; }
      fail('a character that must be escaped in a string literal');
    }
  }

  escape(q) {
    const e = this.c;
    this.i++;
    switch (e) {
      case 'b': return '\b';
      case 'f': return '\f';
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case '/': return '/';
      case '\\': return '\\';
      case 'u': {
        const hi = this.hex4();
        if (hi >= 0xd800 && hi <= 0xdbff) {
          if (!(this.eat('\\') && this.eat('u'))) fail('a high surrogate escape is followed by a low one');
          const lo = this.hex4();
          if (!(lo >= 0xdc00 && lo <= 0xdfff)) fail('a high surrogate escape is followed by a low one');
          return String.fromCodePoint(0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00));
        }
        if (hi >= 0xdc00 && hi <= 0xdfff) fail('a low surrogate escape on its own');
        return String.fromCodePoint(hi);
      }
      default:
        if (e === q) return q;
        return fail('an escape the grammar does not have');
    }
  }

  hex4() {
    let v = 0;
    for (let k = 0; k < 4; k++) {
      const c = this.c;
      if (c === undefined || !/^[0-9A-Fa-f]$/.test(c)) fail('\\u is followed by four hexadecimal digits');
      v = v * 16 + parseInt(c, 16);
      this.i++;
    }
    return v;
  }

  // logical-or-expr, logical-and-expr: S "||" S and S "&&" S between their parts
  logicalOr() {
    const items = [this.logicalAnd()];
    for (;;) {
      const save = this.i;
      this.skipS();
      if (this.ahead('||')) { this.i += 2; this.skipS(); items.push(this.logicalAnd()); } else { this.i = save; break; }
    }
    return items.length === 1 ? items[0] : { kind: 'or', items };
  }

  logicalAnd() {
    const items = [this.basic()];
    for (;;) {
      const save = this.i;
      this.skipS();
      if (this.ahead('&&')) { this.i += 2; this.skipS(); items.push(this.basic()); } else { this.i = save; break; }
    }
    return items.length === 1 ? items[0] : { kind: 'and', items };
  }

  // basic-expr = paren-expr / comparison-expr / test-expr
  basic() {
    if (this.eat('!')) {
      this.skipS();
      if (this.c === '(') return { kind: 'not', expr: this.paren() };
      const o = this.operand();
      if (o.kind === 'lit') fail('! is followed by a query, a function expression or (');
      return { kind: 'not', expr: { kind: 'test', operand: o } };
    }
    if (this.c === '(') return this.paren();
    const left = this.operand();
    const save = this.i;
    this.skipS();
    const op = this.comparisonOp();
    if (op) {
      this.skipS();
      return { kind: 'cmp', op, left, right: this.operand() };
    }
    this.i = save;
    if (left.kind === 'lit') fail('a literal on its own is not a test');
    return { kind: 'test', operand: left };
  }

  paren() {
    this.need('(');
    this.skipS();
    const e = this.logicalOr();
    this.skipS();
    this.need(')', 'expected )');
    return { kind: 'paren', expr: e };
  }

  comparisonOp() {
    for (const op of ['==', '!=', '<=', '>=', '<', '>']) if (this.ahead(op)) { this.i += op.length; return op; }
    return null;
  }

  // A query (relative or absolute), a literal, or a function expression.
  operand() {
    const c = this.c;
    if (c === '@' || c === '$') {
      this.i++;
      const segments = this.segments();
      return { kind: 'query', root: c, segments, singular: segments.every((s) => !s.desc && s.singular) };
    }
    if (c === "'" || c === '"') return { kind: 'lit', value: this.stringLiteral() };
    if (c === '-' || isDigit(c)) return { kind: 'lit', value: this.number() };
    if (isLcAlpha(c)) {
      let name = '';
      while (isLcAlpha(this.c) || isDigit(this.c) || this.c === '_') name += this.s[this.i++];
      if (this.c === '(') return this.functionExpr(name);
      if (name === 'true') return { kind: 'lit', value: true };
      if (name === 'false') return { kind: 'lit', value: false };
      if (name === 'null') return { kind: 'lit', value: null };
      fail(`${name} is not a literal, and no ( follows it`);
    }
    return fail('expected a query, a literal or a function expression');
  }

  // number = (int / "-0") [ frac ] [ exp ]
  number() {
    const rest = this.s.slice(this.i, this.i + 400).join('');
    const m = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?/.exec(rest);
    if (!m) fail('not a number');
    this.i += [...m[0]].length;
    return Number(m[0]);
  }

  functionExpr(name) {
    this.need('(');
    this.skipS();
    const args = [];
    if (this.c !== ')') {
      args.push(this.argument());
      for (;;) {
        const save = this.i;
        this.skipS();
        if (this.eat(',')) { this.skipS(); args.push(this.argument()); } else { this.i = save; break; }
      }
    }
    this.skipS();
    this.need(')', 'expected , or ) in a function expression');
    return { kind: 'fn', name, args };
  }

  // function-argument = literal / filter-query / logical-expr / function-expr
  argument() {
    const save = this.i;
    const c = this.c;
    if (c === "'" || c === '"' || c === '-' || isDigit(c) || this.ahead('true') || this.ahead('false') || this.ahead('null')) {
      try {
        const lit = this.operand();
        const after = this.i;
        this.skipS();
        const next = this.c;
        this.i = after;
        if (lit.kind === 'lit' && (next === ',' || next === ')')) return lit;
      } catch (e) { if (!(e instanceof InvalidQuery)) throw e; }
      this.i = save;
    }
    const e = this.logicalOr();
    if (e.kind === 'test') return e.operand; // a query, or a function expression, standing alone
    return { kind: 'logical', expr: e };
  }
}

// ---------- validity beyond the grammar: singular queries and well-typedness (section 2.4.3)
function checkQuery(q) {
  for (const seg of q.segments) for (const sel of seg.selectors) if (sel.kind === 'filter') checkLogical(sel.expr);
}

function checkLogical(e) {
  switch (e.kind) {
    case 'or': case 'and': e.items.forEach(checkLogical); return;
    case 'not': case 'paren': checkLogical(e.expr); return;
    case 'test':
      if (e.operand.kind === 'query') { checkQuery(e.operand); return; }
      if (checkFn(e.operand) === VALUE) fail(`${e.operand.name}() returns a value, which is not a test`);
      return;
    case 'cmp': checkComparable(e.left); checkComparable(e.right); return;
    default: fail('not a logical expression');
  }
}

function checkComparable(x) {
  if (x.kind === 'lit') return;
  if (x.kind === 'query') {
    if (!x.singular) fail('a comparison needs a singular query');
    checkQuery(x);
    return;
  }
  if (x.kind === 'fn') { if (checkFn(x) !== VALUE) fail(`${x.name}() does not return a value to compare`); return; }
  fail('not comparable');
}

// The function's declared result type, once its name, arity and arguments are checked.
function checkFn(f) {
  if (!FUNCTIONS.has(f.name)) fail(`there is no function ${f.name}()`);
  const { params, result } = FUNCTIONS.get(f.name);
  if (f.args.length !== params.length) fail(`${f.name}() takes ${params.length} argument${params.length === 1 ? '' : 's'}`);
  f.args.forEach((a, k) => checkArg(a, params[k], f.name));
  return result;
}

function checkArg(a, type, name) {
  const bad = () => fail(`an argument of ${name}() that is not of type ${type}`);
  if (a.kind === 'lit') { if (type !== VALUE) bad(); return; }
  if (a.kind === 'query') {
    if (type === VALUE && !a.singular) bad();
    checkQuery(a);
    return;
  }
  if (a.kind === 'fn') {
    const r = checkFn(a);
    if (!(r === type || (type === LOGICAL && r === NODES))) bad();
    return;
  }
  if (a.kind === 'logical') { if (type !== LOGICAL) bad(); checkLogical(a.expr); return; }
  bad();
}

const compiled = new Map();
export function compile(text) {
  if (compiled.has(text)) return compiled.get(text);
  const p = new Parser(text);
  if (!p.eat('$')) fail('a query begins with $');
  const q = { kind: 'query', root: '$', segments: p.segments() };
  if (p.c !== undefined) fail(`unexpected ${JSON.stringify(p.c)}`);
  checkQuery(q);
  if (compiled.size > 10000) compiled.clear();
  compiled.set(text, q);
  return q;
}

// ---------- evaluation
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The children of a node: array elements in order, object member values in name order (D-001).
function children(n) {
  const v = n.value;
  if (Array.isArray(v)) return v.map((x, k) => ({ value: x, path: [...n.path, k] }));
  if (isObject(v)) return Object.keys(v).sort(cmpCodePoints).map((k) => ({ value: v[k], path: [...n.path, k] }));
  return [];
}

// A node and its descendants, each before its own descendants.
function visit(n) {
  const out = [], stack = [n];
  while (stack.length) {
    const x = stack.pop();
    out.push(x);
    const kids = children(x);
    for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
  }
  return out;
}

export function sliceIndices(len, start, end, step) {
  const st = step ?? 1;
  if (st === 0) return [];
  const norm = (i) => (i >= 0 ? i : len + i);
  const out = [];
  if (st > 0) {
    const lower = Math.min(Math.max(norm(start ?? 0), 0), len);
    const upper = Math.min(Math.max(norm(end ?? len), 0), len);
    for (let i = lower; i < upper; i += st) out.push(i);
  } else {
    const upper = Math.min(Math.max(norm(start ?? len - 1), -1), len - 1);
    const lower = Math.min(Math.max(norm(end ?? -len - 1), -1), len - 1);
    for (let i = upper; lower < i; i += st) out.push(i);
  }
  return out;
}

function select(n, sel, root, out) {
  const v = n.value;
  switch (sel.kind) {
    case 'name':
      if (isObject(v) && Object.hasOwn(v, sel.name)) out.push({ value: v[sel.name], path: [...n.path, sel.name] });
      return;
    case 'wild': out.push(...children(n)); return;
    case 'index':
      if (Array.isArray(v)) {
        const i = sel.index >= 0 ? sel.index : v.length + sel.index;
        if (i >= 0 && i < v.length) out.push({ value: v[i], path: [...n.path, i] });
      }
      return;
    case 'slice':
      if (Array.isArray(v)) for (const i of sliceIndices(v.length, sel.start, sel.end, sel.step)) out.push({ value: v[i], path: [...n.path, i] });
      return;
    case 'filter':
      for (const c of children(n)) if (truth(sel.expr, root, c)) out.push(c);
      return;
  }
}

function run(q, root, cur) {
  let nodes = [q.root === '$' ? { value: root, path: [] } : cur];
  for (const seg of q.segments) {
    const out = [];
    for (const n of nodes) {
      for (const d of seg.desc ? visit(n) : [n]) for (const sel of seg.selectors) select(d, sel, root, out);
    }
    nodes = out;
  }
  return nodes;
}

function truth(e, root, cur) {
  switch (e.kind) {
    case 'or': return e.items.some((x) => truth(x, root, cur));
    case 'and': return e.items.every((x) => truth(x, root, cur));
    case 'not': return !truth(e.expr, root, cur);
    case 'paren': return truth(e.expr, root, cur);
    case 'test': {
      if (e.operand.kind === 'query') return run(e.operand, root, cur).length > 0;
      const r = call(e.operand, root, cur);
      return Array.isArray(r) ? r.length > 0 : r === true;
    }
    case 'cmp': return compare(valueOf(e.left, root, cur), e.op, valueOf(e.right, root, cur));
  }
  throw new Error(`no such expression ${e.kind}`);
}

// A comparable's value, or NOTHING (an empty nodelist, or a function's Nothing).
function valueOf(x, root, cur) {
  if (x.kind === 'lit') return x.value;
  if (x.kind === 'query') { const ns = run(x, root, cur); return ns.length === 1 ? ns[0].value : NOTHING; }
  return call(x, root, cur);
}

function argument(a, type, root, cur) {
  if (type === NODES) return a.kind === 'query' ? run(a, root, cur) : call(a, root, cur);
  if (type === VALUE) return valueOf(a, root, cur);
  if (a.kind === 'logical') return truth(a.expr, root, cur);
  if (a.kind === 'query') return run(a, root, cur).length > 0;
  const r = call(a, root, cur);
  return Array.isArray(r) ? r.length > 0 : r;
}

function call(f, root, cur) {
  const { params } = FUNCTIONS.get(f.name);
  const argv = f.args.map((a, k) => argument(a, params[k], root, cur));
  switch (f.name) {
    case 'length': {
      const v = argv[0];
      if (typeof v === 'string') return [...v].length;
      if (Array.isArray(v)) return v.length;
      if (isObject(v)) return Object.keys(v).length;
      return NOTHING;
    }
    case 'count': return argv[0].length;
    case 'value': return argv[0].length === 1 ? argv[0][0].value : NOTHING;
    case 'match':
    case 'search': {
      const [s, re] = argv;
      if (typeof s !== 'string' || typeof re !== 'string') return false;
      const rx = iregexp(re, f.name === 'match');
      return rx ? rx.test(s) : false;
    }
  }
  throw new Error(`no such function ${f.name}`);
}

export function equal(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, k) => equal(x, b[k]));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]));
  }
  return a === b;
}

function compare(a, op, b) {
  const eq = () => (a === NOTHING || b === NOTHING ? a === NOTHING && b === NOTHING : equal(a, b));
  const lt = (x, y) => {
    if (x === NOTHING || y === NOTHING) return false;
    if (typeof x === 'number' && typeof y === 'number') return x < y;
    if (typeof x === 'string' && typeof y === 'string') return cmpCodePoints(x, y) < 0;
    return false;
  };
  switch (op) {
    case '==': return eq();
    case '!=': return !eq();
    case '<': return lt(a, b);
    case '<=': return lt(a, b) || eq();
    case '>': return lt(b, a);
    case '>=': return lt(b, a) || eq();
  }
  throw new Error(`no such operator ${op}`);
}

// ---------- Normalized Paths (section 2.7)
function normalName(name) {
  let out = "'";
  for (const ch of name) {
    const n = cp(ch);
    if (ch === "'") out += "\\'";
    else if (ch === '\\') out += '\\\\';
    else if (n === 0x08) out += '\\b';
    else if (n === 0x09) out += '\\t';
    else if (n === 0x0a) out += '\\n';
    else if (n === 0x0c) out += '\\f';
    else if (n === 0x0d) out += '\\r';
    else if (n < 0x20) out += `\\u00${n.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return `${out}'`;
}
export const normalizedPath = (path) => '$' + path.map((k) => (typeof k === 'number' ? `[${k}]` : `[${normalName(k)}]`)).join('');

// ---------- I-Regexp (RFC 9485), translated to an ECMAScript pattern with the u flag; null when
// the text is not an I-Regexp. Every literal character is written as \u{...}, so nothing in the
// translation means more than the I-Regexp did.
const CATEGORIES = new Set(['L', 'Ll', 'Lm', 'Lo', 'Lt', 'Lu', 'M', 'Mc', 'Me', 'Mn', 'N', 'Nd', 'Nl', 'No', 'P', 'Pc', 'Pd', 'Pe', 'Pf', 'Pi', 'Po', 'Ps', 'Z', 'Zl', 'Zp', 'Zs', 'S', 'Sc', 'Sk', 'Sm', 'So', 'C', 'Cc', 'Cf', 'Cn', 'Co']);
const SINGLE_ESC = new Set(['(', ')', '*', '+', '-', '.', '?', '[', '\\', ']', '^', '{', '|', '}']);
const isNormalChar = (n) => (n <= 0x27) || n === 0x2c || n === 0x2d || (n >= 0x2f && n <= 0x3e) || (n >= 0x40 && n <= 0x5a) || (n >= 0x5e && n <= 0x7a) || (n >= 0x7e && isScalar(n));
const isCCchar = (n) => (n <= 0x2c) || (n >= 0x2e && n <= 0x5a) || (n >= 0x5e && isScalar(n));

class NotIRegexp extends Error {}
export function translateIRegexp(text) {
  const s = [...text];
  let i = 0;
  const no = () => { throw new NotIRegexp(); };
  const lit = (ch) => `\\u{${cp(ch).toString(16)}}`;
  const peek = () => s[i];
  const property = () => { // after "\p" or "\P": "{" charProp "}"
    const kind = s[i - 1];
    if (peek() !== '{') no();
    i++;
    let name = '';
    while (peek() !== undefined && peek() !== '}') name += s[i++];
    if (peek() !== '}' || !CATEGORIES.has(name)) no();
    i++;
    return `\\${kind}{${name}}`;
  };
  const ccChar = () => { // a CCchar, as the character it stands for
    const c = peek();
    if (c === undefined) no();
    i++;
    if (c === '\\') {
      const e = peek();
      if (e === undefined) no();
      i++;
      if (e === 'n') return '\n';
      if (e === 'r') return '\r';
      if (e === 't') return '\t';
      if (SINGLE_ESC.has(e)) return e;
      no();
    }
    if (!isCCchar(cp(c))) no();
    return c;
  };
  const cce1 = () => {
    if (peek() === '\\' && (s[i + 1] === 'p' || s[i + 1] === 'P')) { i += 2; return property(); }
    const a = ccChar();
    if (peek() === '-' && s[i + 1] !== undefined && s[i + 1] !== ']') {
      i++;
      if (peek() === '\\' && (s[i + 1] === 'p' || s[i + 1] === 'P')) no();
      const b = ccChar();
      return `${lit(a)}-${lit(b)}`;
    }
    return lit(a);
  };
  const charClassExpr = () => { // after "["
    let neg = '';
    if (peek() === '^') { neg = '^'; i++; }
    const items = [];
    if (peek() === '-') { i++; items.push(lit('-')); } else items.push(cce1());
    while (peek() !== ']' && !(peek() === '-' && s[i + 1] === ']')) {
      if (peek() === undefined) no();
      items.push(cce1());
    }
    if (peek() === '-') { i++; items.push(lit('-')); }
    if (peek() !== ']') no();
    i++;
    return `[${neg}${items.join('')}]`;
  };
  const atom = () => {
    const c = peek();
    if (c === undefined) no();
    i++;
    if (c === '(') { const r = alternation(); if (peek() !== ')') no(); i++; return `(?:${r})`; }
    if (c === '.') return '[^\\n\\r]';
    if (c === '[') return charClassExpr();
    if (c === '\\') {
      const e = peek();
      if (e === undefined) no();
      i++;
      if (e === 'p' || e === 'P') return property();
      if (e === 'n') return '\\n';
      if (e === 'r') return '\\r';
      if (e === 't') return '\\t';
      if (SINGLE_ESC.has(e)) return lit(e);
      no();
    }
    if (!isNormalChar(cp(c))) no();
    return lit(c);
  };
  const digits = () => { let d = ''; while (isDigit(peek())) d += s[i++]; return d; };
  const quantifier = () => {
    const c = peek();
    if (c === '*' || c === '+' || c === '?') { i++; return c; }
    if (c !== '{') return '';
    i++;
    const n = digits();
    if (n === '') no();
    let q = `{${BigInt(n)}`;
    if (peek() === ',') { i++; q += ','; const m = digits(); if (m !== '') q += BigInt(m); }
    if (peek() !== '}') no();
    i++;
    return `${q}}`;
  };
  const branch = () => {
    let out = '';
    while (peek() !== undefined && peek() !== '|' && peek() !== ')') { const a = atom(); out += `(?:${a})${quantifier()}`; }
    return out;
  };
  const alternation = () => { const bs = [branch()]; while (peek() === '|') { i++; bs.push(branch()); } return bs.join('|'); };
  try {
    const out = alternation();
    if (i !== s.length) return null;
    return out;
  } catch (e) {
    if (e instanceof NotIRegexp) return null;
    throw e;
  }
}

const regexps = new Map();
function iregexp(text, whole) {
  const key = `${whole ? 'm' : 's'}${text}`;
  if (regexps.has(key)) return regexps.get(key);
  const src = translateIRegexp(text);
  let rx = null;
  if (src !== null) {
    try { rx = new RegExp(whole ? `^(?:${src})$` : `(?:${src})`, 'u'); } catch { rx = null; }
  }
  if (regexps.size > 10000) regexps.clear();
  regexps.set(key, rx);
  return rx;
}

// ---------- the operation
export function query(text, document) {
  const q = compile(text);
  const nodes = run(q, document, { value: document, path: [] });
  return { values: nodes.map((n) => n.value), paths: nodes.map((n) => normalizedPath(n.path)) };
}
