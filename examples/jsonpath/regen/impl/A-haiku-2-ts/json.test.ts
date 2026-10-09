import { test } from 'node:test';
import assert from 'node:assert';
import { isObject, Num, parseJson, stringify } from './json.ts';

test('parses the JSON value types', () => {
  const v = parseJson(' {"a": [1, "b\\n\\u0041", true, false, null], "c": {}} ');
  assert.ok(isObject(v));
  assert.strictEqual(v.a[1], 'b\nA');
  assert.strictEqual(v.a[2], true);
  assert.strictEqual(v.a[4], null);
  assert.ok(isObject(v.c));
});

test('keeps each number as its source text', () => {
  const v = parseJson('[1.0, 12345678901234567890, -0, 1E2]');
  assert.ok(v[0] instanceof Num);
  assert.strictEqual(v[1].text, '12345678901234567890');
  assert.strictEqual(stringify(v), '[1.0,12345678901234567890,-0,1E2]');
});

test('member names are own properties, even __proto__', () => {
  const v = parseJson('{"__proto__": 1}');
  assert.ok(Object.hasOwn(v, '__proto__'));
  assert.deepStrictEqual(Object.keys(v), ['__proto__']);
});

test('rejects text that RFC 8259 does not allow', () => {
  for (const text of ['[1,]', '{"a":1,}', '01', '1.', '-', '"\\x"', '"a\u0001"', '"\\u12G4"', 'tru', '[1] 2', '', '{a:1}']) {
    assert.throws(() => parseJson(text), SyntaxError, text);
  }
});

test('an object is not an array, a number or a primitive', () => {
  assert.strictEqual(isObject([]), false);
  assert.strictEqual(isObject(new Num('1', 1)), false);
  assert.strictEqual(isObject(null), false);
  assert.strictEqual(isObject(parseJson('{}')), true);
});

test('stringify writes primitives and plain objects', () => {
  assert.strictEqual(stringify({ id: 'x', error: 'bad_request' }), '{"id":"x","error":"bad_request"}');
  assert.strictEqual(stringify({ id: null, error: 'bad_request' }), '{"id":null,"error":"bad_request"}');
  assert.strictEqual(stringify('a\rb'), '"a\\rb"');
});
