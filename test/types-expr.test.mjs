import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseType, checkType, genType, makeRng, showType, seedOf } from '../src/types.mjs';
import { parseExpr, evaluate, isUndefined } from '../src/expr.mjs';

const T = (s) => { const r = parseType(s); assert.ok(r.type, `${s}: ${r.error}`); return r.type; };

test('types: parse and show', () => {
  for (const s of ['number', 'integer in 0 .. 10', 'string matching "a+"', '"x" | "y"', 'number[]', '{a: number, b?: string}', '{a: number, ...}', 'num | null', '(number | string)[]']) {
    assert.equal(parseType(showType(T(s))).error, undefined, s);
  }
  assert.ok(parseType('number |').error);
  assert.ok(parseType('{a: number, a: string}').error); // a member twice
  assert.ok(parseType('integer in 5 .. 1').error);
  assert.ok(parseType('string matching "("').error);
});

test('types: check values', () => {
  const env = new Map([['num', T('number | "NaN" | "Infinity" | "-Infinity"')]]);
  assert.equal(checkType(T('num'), 5, env), null);
  assert.equal(checkType(T('num'), 'NaN', env), null);
  assert.match(checkType(T('num'), '80', env), /none of/);
  assert.match(checkType(T('number in 0 .. 10'), 11), /outside/);
  assert.match(checkType(T('integer'), 1.5), /integer/);
  assert.equal(checkType(T('{a: number, b?: string}'), { a: 1 }), null);
  assert.match(checkType(T('{a: number}'), { a: 1, c: 2 }), /unexpected member "c"/);
  assert.equal(checkType(T('{a: number, ...}'), { a: 1, c: 2 }), null);
  assert.match(checkType(T('{a: number}'), {}), /"a" is missing/);
  assert.match(checkType(T('number[]'), [1, 'x']), /\[1\]/);
  assert.match(checkType(T('string matching "[a-z]+"'), 'abc1'), /does not match/);
  assert.match(checkType(T('loop'), 1, new Map([['loop', T('loop')]])), /nests too deeply/);
});

test('types: generation is deterministic and has the type', () => {
  const env = new Map();
  for (const s of ['number in -20 .. 50', 'integer in 0 .. 3', '"a" | "b"', '{a: number in 0 .. 1, b?: boolean}', 'number[]', 'any']) {
    const t = T(s);
    const a = makeRng(seedOf(s)), b = makeRng(seedOf(s));
    for (let k = 0; k < 50; k++) {
      const x = genType(t, a, env), y = genType(t, b, env);
      assert.deepEqual(x, y, s);
      if (s !== 'any') assert.equal(checkType(t, x.value, env), null, `${s}: ${JSON.stringify(x.value)}`);
    }
  }
  assert.ok(genType(T('string matching "x"'), makeRng(1)).error);
});

const E = (s) => { const r = parseExpr(s); assert.ok(r.ast, `${s}: ${r.error}`); return r.ast; };
const ev = (s, env = {}) => evaluate(E(s), new Map(Object.entries(env)));

test('expressions: arithmetic, comparison, logic, members, functions', () => {
  assert.equal(ev('1 + 2 * 3'), 7);
  assert.equal(ev('(f - 32) * 5 / 9', { f: 98.6 }), ((98.6 - 32) * 5) / 9);
  assert.equal(ev('a.result.x <= t', { a: { result: { x: 1 } }, t: 2 }), true);
  assert.equal(ev('{"x": [1, {"y": 2}]} == {"x": [1, {"y": 2}]}'), true);
  assert.equal(ev('{"a": 1, "b": 2} == {"b": 2, "a": 1}'), true); // member order means nothing
  assert.equal(ev('x == 1 ? "one" : "other"', { x: 2 }), 'other');
  assert.equal(ev('not (a and b) or c', { a: true, b: false, c: false }), true);
  assert.equal(ev('{"white": 0, "black": 4}[f]', { f: 'black' }), 4);
  assert.equal(ev('xs[1]', { xs: [5, 6] }), 6);
  assert.equal(ev('parse(t).a', { t: '{"a":3}' }), 3);
  assert.equal(ev('text({"b": 1})'), '{"b":1}');
  assert.equal(ev('approx(1.0, 1.05, 0.1) and isnum(2) and not isnum("2")'), true);
  assert.equal(ev('contains("abc", "b") and contains([1, 2], 2) and not contains("abc", "d")'), true);
  assert.equal(ev('has(o, "k") and not has(o, "z")', { o: { k: 1 } }), true);
  assert.equal(ev('num("-Infinity") < 0'), true);
  assert.equal(ev('"ab" + "c"'), 'abc');
});

test('expressions: errors are values, never exceptions', () => {
  for (const [s, env] of [['a.b', { a: 1 }], ['x + 1', { x: 'y' }], ['missing', {}], ['parse("{")', {}], ['xs[5]', { xs: [] }], ['1 < "a"', {}]]) {
    const v = ev(s, env);
    assert.ok(isUndefined(v), `${s} gave ${JSON.stringify(v)}`);
  }
  assert.ok(parseExpr('1 +').error);
  assert.ok(parseExpr('a b').error);
  assert.ok(parseExpr('"unclosed').error);
});
