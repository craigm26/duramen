// Requests for claim 7's agreement measure (CONFIDENCE-2.md): JSONPath queries over JSON
// documents, generated from a seed. This file was committed with the claim, before any build,
// so the requests cannot depend on what the builds do.
//
//   node examples/jsonpath/generate.mjs <seed> <n>
//
// prints n lines, each {"query": <string>, "document": <JSON>}. Queries are built from RFC 9535's
// grammar: segments, selectors, filters with comparisons and the five functions, with blank
// space where the grammar allows it and, now and then, where it does not. A quarter of them are
// then changed by one random edit, so many of those are not valid queries. Documents are small
// nested values whose member names and strings come from a vocabulary chosen to reach escaping,
// Unicode and comparison corners, so queries and documents share names often.

export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['a', 'b', 'c', 'ab', 'x', 'é', '_a', 'A', '', 'a b', "'", '"', '\\', '1', '$', '@', '*', 'b c', '\n', '\u0001', ' ', '😀'];
const SHORTHAND = ['a', 'b', 'c', 'ab', 'x', 'é', '_a', 'A', '😀'];
const NOT_SHORTHAND = ['1', 'a b', '$', '-a', "'a'", ''];
const STRINGS = ['a', 'b', 'ab', 'ba', '', 'A', 'é', 'a\nb', 'x', 'abc', '1', 'aa', 'b$', '^a', 'éa', 'a.b', '😀'];
const NUMBERS = [0, 1, 2, -1, 3, 10, 1.5, -0.5, 100, 0.1, -3];
const NUMBER_TEXT = ['0', '1', '2', '-1', '1.5', '1e2', '1E+1', '-0', '0.1', '10', '-3', '01', '1.', '.5', '-0.0'];
const INDEX_TEXT = ['0', '1', '2', '3', '-1', '-2', '-4', '5', '01', '-0', '9007199254740991', '9007199254740992', ' 1'];
const REGEX = ['a', 'a.*', '[ab]', '^a', 'a$', '\\\\d', 'a{2}', '(a|b)', '[^a]', '.', 'é', '\\\\p{Lu}', 'a+', 'b?', '[a-c]+', '.*', 'a\\\\.b', '(', '[a'];
const OPS = ['==', '!=', '<', '<=', '>', '>='];
const INSERT = ['[', ']', '(', ')', '.', '$', '@', '*', "'", '"', '?', ':', ',', '=', '!', '<', ' ', '\t', '0', '-', 'a', '&', '|'];

export function generate(seed, n) {
  const r = rng(seed);
  const chance = (p) => r() < p;
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = (xs) => xs[Math.floor(r() * xs.length)];

  // ---------- documents
  const scalar = () => {
    const k = r();
    if (k < 0.4) return pick(NUMBERS);
    if (k < 0.75) return pick(STRINGS);
    return pick([true, false, null]);
  };
  const container = (depth, minSize) => {
    const size = int(minSize, 4);
    if (chance(0.5)) return Array.from({ length: size }, () => value(depth + 1));
    const names = [...NAMES];
    const o = {};
    for (let i = 0; i < size; i++) {
      // member names favor the ones queries use most
      const name = chance(0.6) ? pick(SHORTHAND) : names[Math.floor(r() * names.length)];
      if (Object.hasOwn(o, name)) continue;
      Object.defineProperty(o, name, { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return o;
  };
  function value(depth) { return depth >= 3 || chance(0.3) ? scalar() : container(depth, 0); }
  const document = () => (chance(0.05) ? scalar() : container(0, 1));

  // ---------- queries
  const ws = (p = 0.15) => (chance(p) ? pick([' ', ' ', '  ', '\t', '\n', '\r']) : '');
  const quote = (name) => {
    const q = chance(0.6) ? "'" : '"';
    let s = '';
    for (const ch of name) {
      if (ch === q || ch === '\\') s += `\\${ch}`;
      else if (ch === '\n') s += pick(['\\n', '\\u000a', '\\u000A']);
      else if (ch < ' ') s += `\\u${ch.codePointAt(0).toString(16).padStart(4, '0')}`;
      else if (ch === '😀' && chance(0.5)) s += '\\uD83D\\uDE00';
      else if (ch === 'a' && chance(0.1)) s += '\\u0061';
      else s += ch;
    }
    if (chance(0.03)) s += pick(['\\q', '\\', "\\'\\\"", '\\uD83D']);
    return q + s + q;
  };
  const name = () => (chance(0.9) ? pick(NAMES) : pick(STRINGS));
  const slice = () => {
    const part = () => (chance(0.65) ? String(int(-4, 5)) : '');
    let s = part() + ws(0.1) + ':' + ws(0.1) + part();
    if (chance(0.5)) s += ':' + ws(0.1) + (chance(0.7) ? String(int(-2, 2)) : '');
    return s;
  };
  const singular = (root) => {
    let q = root;
    const n = int(0, 2);
    for (let i = 0; i < n; i++) {
      const k = r();
      if (k < 0.5) q += `.${pick(SHORTHAND)}`;
      else if (k < 0.8) q += `[${quote(name())}]`;
      else q += `[${pick(INDEX_TEXT)}]`;
    }
    return q;
  };
  const nodesQuery = (root) => root + Array.from({ length: int(1, 2) }, () => segment(1)).join('');
  const regex = () => (chance(0.5) ? `'${pick(REGEX)}'` : `"${pick(REGEX)}"`);
  const fn = () => {
    const k = r();
    const sq = () => singular(pick(['@', '@', '$']));
    if (k < 0.2) return `length(${ws()}${chance(0.8) ? sq() : chance(0.5) ? quote(pick(STRINGS)) : nodesQuery('@')}${ws()})`;
    if (k < 0.35) return `count(${ws()}${chance(0.8) ? nodesQuery('@') : pick(['1', sq()])}${ws()})`;
    if (k < 0.5) return `value(${ws()}${chance(0.7) ? nodesQuery('@') : sq()}${ws()})`;
    if (k < 0.7) return `match(${ws()}${sq()},${ws()}${regex()}${ws()})`;
    if (k < 0.9) return `search(${ws()}${sq()},${ws()}${regex()}${ws()})`;
    return pick(['foo(@)', 'length()', 'count(@, @)', 'match(@.a)', 'Length(@.a)', 'length (@.a)']);
  };
  const comparable = () => {
    const k = r();
    if (k < 0.35) {
      const j = r();
      if (j < 0.45) return pick(NUMBER_TEXT);
      if (j < 0.8) return quote(pick(STRINGS));
      return pick(['true', 'false', 'null', 'True', 'nul']);
    }
    if (k < 0.75) return singular(pick(['@', '@', '$']));
    if (k < 0.85) return pick(['@.*', '@..a', '@[0:1]', '@[*]', '$..b', '@[?@.a]']);
    return fn();
  };
  const test = () => {
    const k = r();
    const neg = chance(0.2) ? '!' : '';
    if (k < 0.55) return neg + nodesQuery(chance(0.8) ? '@' : '$');
    if (k < 0.65) return neg + '@';
    return neg + fn();
  };
  const filter = (depth) => {
    const k = r();
    if (depth < 2 && k < 0.25) return filter(depth + 1) + ws() + pick(['&&', '||', '&&', '||', '&', '|']) + ws() + filter(depth + 1);
    if (depth < 2 && k < 0.33) return `!(${ws()}${filter(depth + 1)}${ws()})`;
    if (depth < 2 && k < 0.4) return `(${ws()}${filter(depth + 1)}${ws()})`;
    if (k < 0.65) return test();
    return comparable() + ws() + pick(OPS) + ws() + comparable();
  };
  const selector = (depth) => {
    const k = r();
    if (k < 0.25) return quote(name());
    if (k < 0.5) return pick(INDEX_TEXT);
    if (k < 0.7) return slice();
    if (k < 0.8) return '*';
    return depth < 1 ? `?${ws()}${filter(0)}` : `?${ws()}${test()}`;
  };
  const bracket = (depth) => {
    const n = chance(0.7) ? 1 : int(2, 3);
    return `[${ws()}${Array.from({ length: n }, () => selector(depth)).join(`${ws()},${ws()}`)}${ws()}]`;
  };
  function segment(depth) {
    const k = r();
    if (k < 0.3) return `.${chance(0.95) ? pick(SHORTHAND) : pick(NOT_SHORTHAND)}`;
    if (k < 0.4) return '.*';
    if (k < 0.5) { const j = r(); return `..${j < 0.4 ? pick(SHORTHAND) : j < 0.6 ? '*' : bracket(depth + 1)}`; }
    if (k < 0.7) return bracket(depth);
    return depth < 1 ? `[?${ws()}${filter(0)}${ws()}]` : bracket(depth);
  }
  const query = () => {
    let q = '$';
    const n = chance(0.05) ? 0 : int(1, 4);
    for (let i = 0; i < n; i++) q += ws(0.08) + segment(0);
    if (chance(0.03)) q = pick([' ', '\t']) + q;
    if (chance(0.03)) q += pick([' ', '\n']);
    return q;
  };
  const mutate = (q) => {
    const chars = [...q];
    const i = Math.floor(r() * chars.length);
    const k = r();
    if (k < 0.3) chars.splice(i, 1);
    else if (k < 0.5) chars.splice(i, 0, chars[i]);
    else if (k < 0.85) chars.splice(i, 0, pick(INSERT));
    else if (i + 1 < chars.length) [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
    return chars.join('');
  };

  const out = [];
  for (let i = 0; i < n; i++) {
    let q = query();
    if (chance(0.25)) q = mutate(q);
    out.push({ query: q, document: document() });
  }
  return out;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const [seed, n] = process.argv.slice(2).map(Number);
  if (!Number.isInteger(seed) || !Number.isInteger(n) || n < 0) {
    process.stderr.write('usage: node examples/jsonpath/generate.mjs <seed> <n>\n');
    process.exitCode = 2;
  } else {
    process.stdout.write(generate(seed, n).map((x) => JSON.stringify(x)).join('\n') + (n ? '\n' : ''));
  }
}
