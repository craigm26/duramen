import test from 'node:test';
import assert from 'node:assert';
import { compareNum, JsonError, numberFrom, parseJson, serialize } from './json.ts';
import type { Json, Num } from './json.ts';

function num(text: string): Num {
  return numberFrom(text) as Num;
}

test('parseJson accepts RFC 8259 texts and keeps member order', () => {
  const v = parseJson(' {"b": [1, -0, 1e5, "x\\u0041\\n"], "a": null, "c": true} ') as Map<string, unknown>;
  assert.deepStrictEqual([...v.keys()], ['b', 'a', 'c']);
  assert.strictEqual(serialize(v as Json), '{"b":[1,-0,1e5,"xA\\n"],"a":null,"c":true}');
});

test('parseJson rejects malformed JSON text', () => {
  for (const bad of ['', ' ', '01', '1.', '-', '[1,]', '{"a":1,}', '{a:1}', '"\\x"', '"\u0001"', '1 2', 'tru', '"abc']) {
    assert.throws(() => parseJson(bad), JsonError, `should reject ${JSON.stringify(bad)}`);
  }
});

test('a repeated member name keeps its first position and the last value', () => {
  const v = parseJson('{"a":1,"b":2,"a":3}') as Map<string, unknown>;
  assert.deepStrictEqual([...v.keys()], ['a', 'b']);
  assert.strictEqual(serialize(v as Json), '{"a":3,"b":2}');
});

test('numbers are output as written and compare by exact value', () => {
  assert.strictEqual(serialize(parseJson('1.50') as Num), '1.50');
  assert.strictEqual(serialize(parseJson('12345678901234567890') as Num), '12345678901234567890');
  assert.strictEqual(compareNum(num('12345678901234567890'), num('12345678901234567891')), -1);
  assert.strictEqual(compareNum(num('1.0'), num('1')), 0);
  assert.strictEqual(compareNum(num('1e0'), num('10e-1')), 0);
  assert.strictEqual(compareNum(num('-0'), num('0')), 0);
  assert.strictEqual(compareNum(num('-2'), num('1')), -1);
  assert.strictEqual(compareNum(num('-2'), num('-1')), -1);
  assert.strictEqual(compareNum(num('0.1'), num('0.10000000000000001')), -1);
  assert.strictEqual(compareNum(num('1e400'), num('1e401')), -1);
});

test('numberFrom reads only JSON number lexemes', () => {
  assert.ok(numberFrom('-0') !== null);
  assert.ok(numberFrom('2.5E+3') !== null);
  assert.strictEqual(numberFrom('01'), null);
  assert.strictEqual(numberFrom('.5'), null);
  assert.strictEqual(numberFrom('1e'), null);
});
