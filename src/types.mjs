// Types: a small structural type language for inputs, results, evidence and generators.
//
//   number [in <lo> .. <hi>]     a JSON number (binary64), optionally in a closed range
//   integer [in <lo> .. <hi>]    a number with no fractional part
//   string [matching "<re>"]     a string, optionally matching a regular expression (whole string)
//   boolean | null | any
//   "<text>" | <number> | true | false     a literal
//   <a> | <b>                    either
//   <t>[]                        an array of <t>
//   {a: <t>, b?: <t>}            an object with exactly these members (b optional)
//   {a: <t>, ...}                ... and any others
//   <name>                       a type declared with `type <name> = ...`
//   ( <t> )
//
// parseType never throws: it returns { type } or { error, at }. checkType returns null when a
// value has the type, or a short reason with the path where it fails. genType draws a value.

const KEYWORDS = new Set(['number', 'integer', 'string', 'boolean', 'null', 'any', 'true', 'false', 'in', 'matching']);

function lex(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (src.startsWith('...', i)) { toks.push({ t: '...', at: i }); i += 3; continue; }
    if (src.startsWith('..', i)) { toks.push({ t: '..', at: i }); i += 2; continue; }
    if ('|[](){}:,?'.includes(c)) { toks.push({ t: c, at: i }); i++; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      if (j >= src.length) return { error: 'unclosed string', at: i };
      let v;
      try { v = JSON.parse(src.slice(i, j + 1)); } catch { return { error: 'bad string escape', at: i }; }
      toks.push({ t: 'str', v, at: i });
      i = j + 1;
      continue;
    }
    const num = src.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (num && (c === '-' || (c >= '0' && c <= '9'))) { toks.push({ t: 'num', v: Number(num[0]), at: i }); i += num[0].length; continue; }
    const name = src.slice(i).match(/^[A-Za-z_][\w-]*/);
    if (name) { toks.push({ t: 'name', v: name[0], at: i }); i += name[0].length; continue; }
    return { error: `unexpected "${c}"`, at: i };
  }
  toks.push({ t: 'end', at: src.length });
  return { toks };
}

export function parseType(src) {
  const lx = lex(String(src));
  if (lx.error) return lx;
  const toks = lx.toks;
  let p = 0;
  const peek = () => toks[p];
  const fail = (msg) => { throw Object.assign(new Error(msg), { at: toks[p].at }); };
  const eat = (t, v) => { const k = toks[p]; if (k.t !== t || (v !== undefined && k.v !== v)) fail(`expected ${v ?? t}`); p++; return k; };
  const range = () => {
    if (!(peek().t === 'name' && peek().v === 'in')) return null;
    p++;
    const lo = eat('num').v; eat('..'); const hi = eat('num').v;
    if (!(lo <= hi)) fail('a range needs lo <= hi');
    return [lo, hi];
  };
  function primary() {
    const k = peek();
    if (k.t === '(') { p++; const t = union(); eat(')'); return t; }
    if (k.t === 'str') { p++; return { kind: 'lit', value: k.v }; }
    if (k.t === 'num') { p++; return { kind: 'lit', value: k.v }; }
    if (k.t === '[') { p++; const t = union(); eat(']'); return { kind: 'array', of: t }; }
    if (k.t === '{') {
      p++;
      const fields = [];
      let open = false;
      while (peek().t !== '}') {
        if (peek().t === '...') { p++; open = true; break; }
        const nk = peek();
        if (nk.t !== 'name' && nk.t !== 'str') fail('expected a member name');
        p++;
        let optional = false;
        if (peek().t === '?') { p++; optional = true; }
        eat(':');
        fields.push({ name: nk.v, optional, type: union() });
        if (peek().t === ',') p++; else break;
      }
      eat('}');
      const names = fields.map((f) => f.name);
      if (new Set(names).size !== names.length) fail('a member is named twice');
      return { kind: 'object', fields, open };
    }
    if (k.t === 'name') {
      p++;
      switch (k.v) {
        case 'number': return { kind: 'number', range: range() };
        case 'integer': return { kind: 'integer', range: range() };
        case 'string': {
          if (peek().t === 'name' && peek().v === 'matching') {
            p++;
            const re = eat('str').v;
            try { new RegExp(re, 'u'); } catch (e) { fail(`bad pattern: ${e.message}`); }
            return { kind: 'string', pattern: re };
          }
          return { kind: 'string' };
        }
        case 'boolean': return { kind: 'boolean' };
        case 'null': return { kind: 'lit', value: null };
        case 'true': return { kind: 'lit', value: true };
        case 'false': return { kind: 'lit', value: false };
        case 'any': return { kind: 'any' };
        default:
          if (KEYWORDS.has(k.v)) fail(`"${k.v}" is not a type`);
          return { kind: 'ref', name: k.v };
      }
    }
    fail(k.t === 'end' ? 'a type is missing' : `unexpected ${k.t === 'name' ? k.v : k.t}`);
  }
  function postfix() {
    let t = primary();
    while (peek().t === '[' && toks[p + 1]?.t === ']') { p += 2; t = { kind: 'array', of: t }; }
    return t;
  }
  function union() {
    const alts = [postfix()];
    while (peek().t === '|') { p++; alts.push(postfix()); }
    return alts.length === 1 ? alts[0] : { kind: 'union', of: alts };
  }
  try {
    const type = union();
    if (peek().t !== 'end') fail(`unexpected ${peek().t === 'name' ? peek().v : peek().t}`);
    return { type };
  } catch (e) {
    return { error: e.message, at: e.at ?? 0 };
  }
}

// Give `o` its own member `k`, defined rather than assigned, as JSON.parse makes members: a
// member named __proto__ is then a member, not the object's prototype. Names in records and
// requests are written this way.
export function setOwn(o, k, v) {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  return o;
}

// The member `k` of `o` when `o` is an object holding it as its own; else undefined.
export const ownMember = (o, k) => (o !== null && typeof o === 'object' && Object.hasOwn(o, k) ? o[k] : undefined);

// Names a type refers to (for "unknown type" and cycle checks).
export function refsOf(t, out = new Set()) {
  if (!t) return out;
  if (t.kind === 'ref') out.add(t.name);
  if (t.kind === 'union') t.of.forEach((x) => refsOf(x, out));
  if (t.kind === 'array') refsOf(t.of, out);
  if (t.kind === 'object') t.fields.forEach((f) => refsOf(f.type, out));
  return out;
}

export function showType(t) {
  switch (t?.kind) {
    case 'number': case 'integer': return t.kind + (t.range ? ` in ${t.range[0]} .. ${t.range[1]}` : '');
    case 'string': return t.pattern ? `string matching ${JSON.stringify(t.pattern)}` : 'string';
    case 'boolean': case 'any': return t.kind;
    case 'lit': return JSON.stringify(t.value);
    case 'ref': return t.name;
    case 'array': return `${t.of.kind === 'union' ? `(${showType(t.of)})` : showType(t.of)}[]`;
    case 'union': return t.of.map(showType).join(' | ');
    case 'object': return `{${[...t.fields.map((f) => `${/^[A-Za-z_][\w-]*$/.test(f.name) ? f.name : JSON.stringify(f.name)}${f.optional ? '?' : ''}: ${showType(f.type)}`), ...(t.open ? ['...'] : [])].join(', ')}}`;
    default: return '?';
  }
}

const jsonType = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

// null when `value` has type `t`; otherwise a reason such as `at .tempC: expected a number, got "80"`.
export function checkType(t, value, env = new Map(), path = '', depth = 0) {
  if (depth > 64) return `at ${path || 'the top'}: the type nests too deeply (a cycle?)`;
  const where = path || 'the top';
  const got = () => (value === undefined ? 'nothing' : JSON.stringify(value)?.slice(0, 60) ?? String(value));
  switch (t.kind) {
    case 'any': return value === undefined ? `at ${where}: expected a value, got nothing` : null;
    case 'number': case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `at ${where}: expected ${t.kind === 'integer' ? 'an integer' : 'a number'}, got ${got()}`;
      if (t.kind === 'integer' && !Number.isInteger(value)) return `at ${where}: expected an integer, got ${got()}`;
      if (t.range && (value < t.range[0] || value > t.range[1])) return `at ${where}: ${value} is outside ${t.range[0]} .. ${t.range[1]}`;
      return null;
    }
    case 'string':
      if (typeof value !== 'string') return `at ${where}: expected a string, got ${got()}`;
      if (t.pattern && !new RegExp(`^(?:${t.pattern})$`, 'u').test(value)) return `at ${where}: ${got()} does not match ${JSON.stringify(t.pattern)}`;
      return null;
    case 'boolean': return typeof value === 'boolean' ? null : `at ${where}: expected true or false, got ${got()}`;
    case 'lit': return Object.is(value, t.value) || (typeof value === 'number' && value === t.value) ? null : `at ${where}: expected ${JSON.stringify(t.value)}, got ${got()}`;
    case 'ref': {
      const d = env.get(t.name);
      if (!d) return `at ${where}: unknown type ${t.name}`;
      return checkType(d, value, env, path, depth + 1);
    }
    case 'union': {
      const reasons = t.of.map((x) => checkType(x, value, env, path, depth + 1));
      return reasons.some((r) => r === null) ? null : `at ${where}: ${got()} is none of ${showType(t)}`;
    }
    case 'array': {
      if (!Array.isArray(value)) return `at ${where}: expected an array, got ${got()}`;
      for (let i = 0; i < value.length; i++) { const r = checkType(t.of, value[i], env, `${path}[${i}]`, depth + 1); if (r) return r; }
      return null;
    }
    case 'object': {
      if (jsonType(value) !== 'object') return `at ${where}: expected an object, got ${got()}`;
      for (const f of t.fields) {
        if (!Object.hasOwn(value, f.name)) { if (!f.optional) return `at ${where}: member ${JSON.stringify(f.name)} is missing`; continue; }
        const r = checkType(f.type, value[f.name], env, `${path}.${f.name}`, depth + 1);
        if (r) return r;
      }
      if (!t.open) for (const k of Object.keys(value)) if (!t.fields.some((f) => f.name === k)) return `at ${where}: unexpected member ${JSON.stringify(k)}`;
      return null;
    }
    default: return `at ${where}: unknown type`;
  }
}

// ---------- generation (deterministic: every draw comes from the rng passed in)

// -0 is left out: a generated request is written with JSON.stringify, which writes -0 as 0.
export const SPECIAL_NUMBERS = [0, 1, -1, 0.1, 0.5, 1.5, 100, 1e20, 1e21, 1e-6, 1e-7, 5e-324, 1.7976931348623157e308, 9007199254740993, 0.30000000000000004, 123e-20, -1e21];
const SPECIAL_STRINGS = ['', 'a', 'A', 'b', 'é', '😀', '｡', '\u0000', '\u001f', '"', '\\', '/', '\u2028', '\u007f', '10', '9', ' '];

export function genNumber(rng, range) {
  if (range) {
    const [lo, hi] = range;
    const r = rng.next();
    if (r < 0.06) return lo;
    if (r < 0.12) return hi;
    const v = lo + (hi - lo) * rng.next();
    return v > hi ? hi : v < lo ? lo : v;
  }
  if (rng.next() < 0.3) return rng.pick(SPECIAL_NUMBERS);
  // a random finite binary64: random sign, exponent and mantissa bits
  const buf = new DataView(new ArrayBuffer(8));
  buf.setUint32(0, rng.u32()); buf.setUint32(4, rng.u32());
  const v = buf.getFloat64(0);
  return Number.isFinite(v) ? v : rng.pick(SPECIAL_NUMBERS);
}

export function genJSON(rng, depth = 0) {
  const r = rng.next();
  if (depth >= 3 || r < 0.45) {
    const s = rng.next();
    if (s < 0.4) return genNumber(rng, null);
    if (s < 0.75) return rng.pick(SPECIAL_STRINGS) + (rng.next() < 0.3 ? rng.pick(SPECIAL_STRINGS) : '');
    if (s < 0.85) return rng.next() < 0.5;
    return null;
  }
  if (r < 0.7) return Array.from({ length: rng.int(0, 3) }, () => genJSON(rng, depth + 1));
  const o = {};
  for (let i = rng.int(0, 3); i > 0; i--) o[rng.pick(SPECIAL_STRINGS)] = genJSON(rng, depth + 1);
  return o;
}

// Draw a value of type t. Returns { value } or { error } (a string pattern cannot be drawn from).
export function genType(t, rng, env = new Map(), depth = 0) {
  if (depth > 16) return { error: 'the type nests too deeply to draw from' };
  switch (t.kind) {
    case 'any': return { value: genJSON(rng) };
    case 'number': return { value: genNumber(rng, t.range) };
    case 'integer': {
      const [lo, hi] = t.range ?? [-1e6, 1e6];
      const a = Math.ceil(lo), b = Math.floor(hi);
      if (a > b) return { error: `no integer in ${lo} .. ${hi}` };
      const r = rng.next();
      return { value: r < 0.1 ? a : r < 0.2 ? b : a + Math.floor(rng.next() * (b - a + 1)) };
    }
    case 'string':
      if (t.pattern) return { error: `cannot draw a string matching ${JSON.stringify(t.pattern)}; use literals ("a" | "b")` };
      return { value: rng.pick(SPECIAL_STRINGS) };
    case 'boolean': return { value: rng.next() < 0.5 };
    case 'lit': return { value: t.value };
    case 'ref': { const d = env.get(t.name); return d ? genType(d, rng, env, depth + 1) : { error: `unknown type ${t.name}` }; }
    case 'union': return genType(t.of[Math.floor(rng.next() * t.of.length)], rng, env, depth + 1);
    case 'array': {
      const out = [];
      for (let i = rng.int(0, 3); i > 0; i--) { const g = genType(t.of, rng, env, depth + 1); if (g.error) return g; out.push(g.value); }
      return { value: out };
    }
    case 'object': {
      const o = {};
      for (const f of t.fields) {
        if (f.optional && rng.next() < 0.5) continue;
        const g = genType(f.type, rng, env, depth + 1);
        if (g.error) return g;
        setOwn(o, f.name, g.value);
      }
      return { value: o };
    }
    default: return { error: 'unknown type' };
  }
}

// A small, fast, deterministic generator (mulberry32 on a 32-bit seed).
export function makeRng(seed) {
  let s = seed >>> 0;
  const u32 = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  const next = () => (u32() * 2 ** 21 + (u32() >>> 11)) / 2 ** 53; // 53 random bits in [0, 1)
  return {
    u32,
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
  };
}

// A stable 32-bit seed from a string (FNV-1a), so a property's default seed is its ID.
export function seedOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
