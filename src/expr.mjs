// Expressions for properties: a small, pure language over JSON values.
//
//   literals     1.5  -2e3  "text"  true  false  null  [a, b]  {"k": a, k2: b}
//   names        generator variables and call results (a.result.wetBulbC, a["x"], xs[0])
//   arithmetic   + - * / %   (binary64; + also joins two strings)
//   comparison   == != < <= > >=   (== is equality of JSON values; numbers compare exactly)
//   logic        and  or  not   and  c ? x : y
//   functions    abs min max floor ceil round sqrt exp ln pow    len keys has
//                parse text isnum isint isstr approx(a, b, tol) num(x) contains(s, part)
//
// Evaluation never throws: a type error or a missing member makes the expression's value an
// Undefined with a reason, and an expectation that is not exactly `true` fails with that reason.

export class Undef {
  constructor(why) { this.why = why; }
}
const undef = (why) => new Undef(why);
const isU = (v) => v instanceof Undef;

function lex(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>='].includes(two)) { toks.push({ t: 'op', v: two, at: i }); i += 2; continue; }
    if ('+-*/%<>?:()[]{},.'.includes(c)) { toks.push({ t: c === '+' || c === '-' || c === '*' || c === '/' || c === '%' || c === '<' || c === '>' ? 'op' : c, v: c, at: i }); i++; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      if (j >= src.length) return { error: 'unclosed string', at: i };
      try { toks.push({ t: 'lit', v: JSON.parse(src.slice(i, j + 1)), at: i }); } catch { return { error: 'bad string escape', at: i }; }
      i = j + 1;
      continue;
    }
    const num = src.slice(i).match(/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (num) { toks.push({ t: 'lit', v: Number(num[0]), at: i }); i += num[0].length; continue; }
    const name = src.slice(i).match(/^[A-Za-z_]\w*/);
    if (name) {
      const w = name[0];
      if (w === 'true' || w === 'false') toks.push({ t: 'lit', v: w === 'true', at: i });
      else if (w === 'null') toks.push({ t: 'lit', v: null, at: i });
      else if (w === 'and' || w === 'or' || w === 'not') toks.push({ t: w, v: w, at: i });
      else toks.push({ t: 'name', v: w, at: i });
      i += w.length;
      continue;
    }
    return { error: `unexpected "${c}"`, at: i };
  }
  toks.push({ t: 'end', at: src.length });
  return { toks };
}

// Parse an expression. Returns { ast } or { error, at }.
export function parseExpr(src) {
  const lx = lex(String(src));
  if (lx.error) return lx;
  const toks = lx.toks;
  let p = 0;
  const peek = () => toks[p];
  const fail = (msg) => { throw Object.assign(new Error(msg), { at: toks[p].at }); };
  const eat = (t) => { if (toks[p].t !== t) fail(`expected "${t}"`); return toks[p++]; };
  const isOp = (...vs) => peek().t === 'op' && vs.includes(peek().v);
  function primary() {
    const k = peek();
    if (k.t === 'lit') { p++; return { k: 'lit', v: k.v }; }
    if (k.t === 'name') { p++; return { k: 'name', v: k.v }; }
    if (k.t === '(') { p++; const e = expr(); eat(')'); return e; }
    if (k.t === '[') {
      p++;
      const items = [];
      while (peek().t !== ']') { items.push(expr()); if (peek().t === ',') p++; else break; }
      eat(']');
      return { k: 'arr', items };
    }
    if (k.t === '{') {
      p++;
      const members = [];
      while (peek().t !== '}') {
        const nk = peek();
        let key;
        if (nk.t === 'lit' && typeof nk.v === 'string') key = nk.v;
        else if (nk.t === 'name') key = nk.v;
        else fail('expected a member name');
        p++;
        eat(':');
        members.push([key, expr()]);
        if (peek().t === ',') p++; else break;
      }
      eat('}');
      return { k: 'obj', members };
    }
    fail(k.t === 'end' ? 'the expression ends too early' : `unexpected ${k.v ?? k.t}`);
  }
  function postfix() {
    let e = primary();
    for (;;) {
      if (peek().t === '.') { p++; const n = eat('name'); e = { k: 'get', of: e, key: { k: 'lit', v: n.v } }; continue; }
      if (peek().t === '[') { p++; const key = expr(); eat(']'); e = { k: 'get', of: e, key }; continue; }
      if (peek().t === '(' && e.k === 'name') {
        p++;
        const args = [];
        while (peek().t !== ')') { args.push(expr()); if (peek().t === ',') p++; else break; }
        eat(')');
        e = { k: 'call', fn: e.v, args };
        continue;
      }
      return e;
    }
  }
  function unary() { if (isOp('-')) { p++; return { k: 'neg', of: unary() }; } return postfix(); }
  function binary(next, ops) {
    return () => {
      let e = next();
      while (isOp(...ops)) { const op = toks[p++].v; e = { k: 'bin', op, a: e, b: next() }; }
      return e;
    };
  }
  const mul = binary(unary, ['*', '/', '%']);
  const add = binary(mul, ['+', '-']);
  function cmp() {
    const e = add();
    if (isOp('==', '!=', '<', '<=', '>', '>=')) { const op = toks[p++].v; return { k: 'bin', op, a: e, b: add() }; }
    return e;
  }
  function not() { if (peek().t === 'not') { p++; return { k: 'not', of: not() }; } return cmp(); }
  function and() { let e = not(); while (peek().t === 'and') { p++; e = { k: 'and', a: e, b: not() }; } return e; }
  function or() { let e = and(); while (peek().t === 'or') { p++; e = { k: 'or', a: e, b: and() }; } return e; }
  function expr() {
    const c = or();
    if (peek().t === '?') { p++; const a = expr(); eat(':'); const b = expr(); return { k: 'if', c, a, b }; }
    return c;
  }
  try {
    const ast = expr();
    if (peek().t !== 'end') fail(`unexpected ${peek().v ?? peek().t}`);
    return { ast };
  } catch (e) {
    return { error: e.message, at: e.at ?? 0 };
  }
}

// The names an expression reads (to check that every name is bound).
export function namesOf(ast, out = new Set()) {
  if (!ast) return out;
  switch (ast.k) {
    case 'name': out.add(ast.v); break;
    case 'arr': ast.items.forEach((x) => namesOf(x, out)); break;
    case 'obj': ast.members.forEach(([, x]) => namesOf(x, out)); break;
    case 'get': namesOf(ast.of, out); namesOf(ast.key, out); break;
    case 'call': ast.args.forEach((x) => namesOf(x, out)); break;
    case 'neg': case 'not': namesOf(ast.of, out); break;
    case 'bin': case 'and': case 'or': namesOf(ast.a, out); namesOf(ast.b, out); break;
    case 'if': namesOf(ast.c, out); namesOf(ast.a, out); namesOf(ast.b, out); break;
  }
  return out;
}

export const FUNCTIONS = new Set(['abs', 'min', 'max', 'floor', 'ceil', 'round', 'sqrt', 'exp', 'ln', 'pow', 'len', 'keys', 'has', 'parse', 'text', 'isnum', 'isint', 'isstr', 'approx', 'num', 'contains']);
export function unknownFunctions(ast, out = []) {
  if (!ast) return out;
  switch (ast.k) {
    case 'call': if (!FUNCTIONS.has(ast.fn)) out.push(ast.fn); ast.args.forEach((x) => unknownFunctions(x, out)); break;
    case 'arr': ast.items.forEach((x) => unknownFunctions(x, out)); break;
    case 'obj': ast.members.forEach(([, x]) => unknownFunctions(x, out)); break;
    case 'get': unknownFunctions(ast.of, out); unknownFunctions(ast.key, out); break;
    case 'neg': case 'not': unknownFunctions(ast.of, out); break;
    case 'bin': case 'and': case 'or': unknownFunctions(ast.a, out); unknownFunctions(ast.b, out); break;
    case 'if': unknownFunctions(ast.c, out); unknownFunctions(ast.a, out); unknownFunctions(ast.b, out); break;
  }
  return out;
}

export function jsonEqual(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]));
}

const show = (v) => (isU(v) ? `undefined (${v.why})` : JSON.stringify(v)?.slice(0, 80) ?? String(v));
const num = (v) => typeof v === 'number';

function call(fn, args) {
  const bad = args.find(isU);
  if (bad && fn !== 'has') return bad;
  const needNums = (n) => (args.length === n && args.every(num) ? null : undef(`${fn} needs ${n} number${n > 1 ? 's' : ''}, got ${args.map(show).join(', ')}`));
  switch (fn) {
    case 'abs': return needNums(1) ?? Math.abs(args[0]);
    case 'floor': return needNums(1) ?? Math.floor(args[0]);
    case 'ceil': return needNums(1) ?? Math.ceil(args[0]);
    case 'sqrt': return needNums(1) ?? Math.sqrt(args[0]);
    case 'exp': return needNums(1) ?? Math.exp(args[0]);
    case 'ln': return needNums(1) ?? Math.log(args[0]);
    case 'pow': return needNums(2) ?? args[0] ** args[1];
    case 'round': {
      if (args.length === 1) return needNums(1) ?? Math.round(args[0]);
      const e = needNums(2); if (e) return e;
      const f = 10 ** args[1];
      return Math.round(args[0] * f) / f;
    }
    case 'min': case 'max': return args.length && args.every(num) ? Math[fn](...args) : undef(`${fn} needs numbers`);
    case 'len': return typeof args[0] === 'string' || Array.isArray(args[0]) ? args[0].length : args[0] && typeof args[0] === 'object' ? Object.keys(args[0]).length : undef(`len needs a string, array or object, got ${show(args[0])}`);
    case 'keys': return args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) ? Object.keys(args[0]) : undef(`keys needs an object, got ${show(args[0])}`);
    case 'has': return !isU(args[0]) && args[0] !== null && typeof args[0] === 'object' && typeof args[1] === 'string' && Object.hasOwn(args[0], args[1]);
    case 'parse': { if (typeof args[0] !== 'string') return undef(`parse needs a string, got ${show(args[0])}`); try { return JSON.parse(args[0]); } catch (e) { return undef(`parse: ${e.message}`); } }
    case 'text': { const s = JSON.stringify(args[0]); return s === undefined ? undef('text: no JSON text') : s; }
    case 'isnum': return num(args[0]) && Number.isFinite(args[0]);
    case 'isint': return Number.isInteger(args[0]);
    case 'isstr': return typeof args[0] === 'string';
    case 'contains': // a string holds a substring, or an array holds a value
      if (typeof args[0] === 'string' && typeof args[1] === 'string') return args[0].includes(args[1]);
      if (Array.isArray(args[0])) return args[0].some((x) => jsonEqual(x, args[1]));
      return undef(`contains needs a string and a string, or an array and a value; got ${show(args[0])}, ${show(args[1])}`);
    case 'approx': return args.length === 3 && args.every(num) ? Math.abs(args[0] - args[1]) <= args[2] : undef('approx needs (a, b, tolerance), all numbers');
    case 'num': // a number, or "NaN" / "Infinity" / "-Infinity" as the matching non-finite value
      if (num(args[0])) return args[0];
      if (args[0] === 'NaN') return NaN;
      if (args[0] === 'Infinity') return Infinity;
      if (args[0] === '-Infinity') return -Infinity;
      return undef(`num needs a number or "NaN"/"Infinity"/"-Infinity", got ${show(args[0])}`);
    default: return undef(`unknown function ${fn}`);
  }
}

export function evaluate(ast, env) {
  switch (ast.k) {
    case 'lit': return ast.v;
    case 'name': return env.has(ast.v) ? env.get(ast.v) : undef(`${ast.v} is not bound`);
    case 'arr': { const xs = ast.items.map((x) => evaluate(x, env)); return xs.find(isU) ?? xs; }
    case 'obj': {
      const o = {};
      for (const [k, x] of ast.members) { const v = evaluate(x, env); if (isU(v)) return v; o[k] = v; }
      return o;
    }
    case 'get': {
      const of = evaluate(ast.of, env);
      if (isU(of)) return of;
      const key = evaluate(ast.key, env);
      if (isU(key)) return key;
      if (Array.isArray(of) && Number.isInteger(key)) return key >= 0 && key < of.length ? of[key] : undef(`index ${key} is outside an array of ${of.length}`);
      if (of !== null && typeof of === 'object' && !Array.isArray(of) && typeof key === 'string') return Object.hasOwn(of, key) ? of[key] : undef(`no member ${JSON.stringify(key)} in ${show(of)}`);
      return undef(`cannot read ${show(key)} of ${show(of)}`);
    }
    case 'call': return call(ast.fn, ast.args.map((x) => evaluate(x, env)));
    case 'neg': { const v = evaluate(ast.of, env); return isU(v) ? v : num(v) ? -v : undef(`cannot negate ${show(v)}`); }
    case 'not': { const v = evaluate(ast.of, env); return isU(v) ? v : typeof v === 'boolean' ? !v : undef(`not needs true or false, got ${show(v)}`); }
    case 'and': case 'or': {
      const a = evaluate(ast.a, env);
      if (isU(a)) return a;
      if (typeof a !== 'boolean') return undef(`${ast.k} needs true or false, got ${show(a)}`);
      if (ast.k === 'and' ? !a : a) return a;
      const b = evaluate(ast.b, env);
      return isU(b) || typeof b === 'boolean' ? b : undef(`${ast.k} needs true or false, got ${show(b)}`);
    }
    case 'if': {
      const c = evaluate(ast.c, env);
      if (isU(c)) return c;
      if (typeof c !== 'boolean') return undef(`a condition needs true or false, got ${show(c)}`);
      return evaluate(c ? ast.a : ast.b, env);
    }
    case 'bin': {
      const a = evaluate(ast.a, env);
      const b = evaluate(ast.b, env);
      if (ast.op === '==' || ast.op === '!=') {
        if (isU(a)) return a;
        if (isU(b)) return b;
        const eq = jsonEqual(a, b);
        return ast.op === '==' ? eq : !eq;
      }
      if (isU(a)) return a;
      if (isU(b)) return b;
      if (ast.op === '+' && typeof a === 'string' && typeof b === 'string') return a + b;
      if (['<', '<=', '>', '>='].includes(ast.op)) {
        if (!((num(a) && num(b)) || (typeof a === 'string' && typeof b === 'string'))) return undef(`cannot compare ${show(a)} ${ast.op} ${show(b)}`);
        return ast.op === '<' ? a < b : ast.op === '<=' ? a <= b : ast.op === '>' ? a > b : a >= b;
      }
      if (!num(a) || !num(b)) return undef(`cannot compute ${show(a)} ${ast.op} ${show(b)}`);
      switch (ast.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '%': return a % b;
      }
      return undef(`unknown operator ${ast.op}`);
    }
    default: return undef('bad expression');
  }
}

export { isU as isUndefined, show as showValue };
