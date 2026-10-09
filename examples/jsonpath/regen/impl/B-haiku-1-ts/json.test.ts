// The JSON reader and writer used for requests and documents (RFC 8259, order kept, number text kept).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JNum, JsonError, parseJson, toJson } from './json.ts';

test('strict JSON: malformed text is rejected', () => {
  for (const bad of ['01', '1.', '+1', '.5', '-', '1e', '"\\x41"', '"a\u0001b"', '[1,]', '{"a":1,}', '{a:1}', 'NaN', 'tru', '1 2', '', '  ', '"\\u12"', '[1 2]']) {
    assert.throws(() => parseJson(bad), JsonError, JSON.stringify(bad));
  }
});

test('strict JSON: valid text, including all white space and escapes', () => {
  assert.equal((parseJson(' \t\r\n 1 \r\n') as JNum).text, '1');
  assert.deepStrictEqual(parseJson('[true,false,null,"s"]'), [true, false, null, 's']);
  assert.equal(parseJson('"\\ud83d\\ude00"'), '😀');
  assert.equal(parseJson('"\\b\\f\\n\\r\\t\\/\\\\\\""'), '\b\f\n\r\t/\\"');
  assert.equal(parseJson('"\\uD800"'), '\uD800');
});

test('numbers keep their text and their binary64 value', () => {
  const n = parseJson('1.50e3') as JNum;
  assert.equal(n.text, '1.50e3');
  assert.equal(n.n, 1500);
  assert.equal(toJson(parseJson('[-0,12345678901234567890,0.1]')), '[-0,12345678901234567890,0.1]');
  assert.ok(Object.is((parseJson('-0') as JNum).n, -0));
});

test('objects keep member order, including integer-like names', () => {
  const m = parseJson('{"b":1,"1":2,"10":3}') as Map<string, unknown>;
  assert.deepStrictEqual([...m.keys()], ['b', '1', '10']);
});

test('duplicate names: the last value at the position of the first occurrence', () => {
  const m = parseJson('{"a":1,"b":2,"a":3}') as Map<string, unknown>;
  assert.deepStrictEqual([...m.entries()].map(([k, v]) => [k, v instanceof JNum ? v.n : v]), [
    ['a', 3],
    ['b', 2],
  ]);
});

test('toJson writes compact JSON that parses back to the same structure', () => {
  const text = '{"x":[1,{"y":[true,false,null,"s\\n",-2.5]}],"z":"é"}';
  assert.equal(toJson(parseJson(text)), text);
});
