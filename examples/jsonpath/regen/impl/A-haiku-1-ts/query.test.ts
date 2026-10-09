import test from 'node:test';
import assert from 'node:assert';
import { parseQuery, QueryError } from './query.ts';

// RFC 9535 section 2.1: a query that is well-formed and valid is accepted.
const VALID = [
  '$',
  '$.a',
  '$.a.b[0]',
  '$..a',
  '$..*',
  '$.*',
  '$[*]',
  '$[0]',
  '$[-1]',
  "$['a']",
  '$["a"]',
  "$[ 'a' , 0 , * ]",
  '$[1:]',
  '$[::-1]',
  '$[1:5:2]',
  '$[1 : 2 : 3]',
  '$[1:2:]',
  '$[::]',
  "$['\\u0041\\uD83D\\uDE00\\b\\f\\n\\r\\t\\/\\\\']",
  "$['a\\'b']",
  '$["a\\"b"]',
  "$['\"']",
  '$[?@.a]',
  '$[?@.a == 1]',
  "$[?@.a == 'x']",
  '$[?@.a > -1.5e3]',
  '$[?@.a == 1E+2]',
  '$[?!@.a]',
  '$[?!(@.a)]',
  '$[?(@.a == 1) && !@.b]',
  '$[?@.a || @.b && @.c]',
  '$[?@.a==true]',
  '$[?@.a == null]',
  '$[?@.a < @.b]',
  '$[?$.x == @.a]',
  '$[?@[?@.b]]',
  '$[?@.*]',
  '$[?@..a]',
  '$[?length(@) < 3]',
  '$[?length(@.a) >= 5]',
  '$[?count(@.*) == 1]',
  '$[?match(@.a, "[jk]")]',
  '$[?match(@.a, 1)]',
  '$[?search(@.a, "x")]',
  '$[?value(@..color) == "red"]',
  '$[?length(@.a) == length(@.b)]',
  '$.a[?@ == @]',
  '$[?@.a == $]',
  '$ [ "a" ] .b',
  '$..[?@.a]',
];

// Each entry is not well-formed or not valid, whatever the document.
const INVALID = [
  '',
  '@.a',
  ' $',
  '$ ',
  '$.',
  '$..',
  '$.a-b',
  '$.*x',
  '$[',
  '$[1',
  '$[]',
  '$[a]',
  '$[1,]',
  '$[,1]',
  '$[01]',
  '$[-0]',
  '$[+1]',
  '$[1.0]',
  "$['a\\x']",
  '$["\\\'"]',
  "$['\\U0041']",
  "$['\\uD83D']",
  "$['\\uDE00']",
  "$['a\u0001']",
  '$[?]',
  '$[?@.a ==]',
  '$[?@.a = 1]',
  '$[?@.a == 1 == 2]',
  '$[?@.*==1]',
  '$[?@..a == 1]',
  '$[?@.a[*] == 1]',
  '$[?1]',
  '$[?true]',
  "$[?'a']",
  '$[?@.a & @.b]',
  '$[?@.a | @.b]',
  '$[?(@.a]',
  '$[?@.a)]',
  '$[?length(@.*) < 3]',
  '$[?length(@) ]',
  '$[?count(1) == 1]',
  '$[?count(@.*)]',
  '$[?value(@..color)]',
  '$[?match(@.timezone, "Europe/.*") == true]',
  '$[?match(@.a)]',
  '$[?match(@.a, @.b, @.c)]',
  '$[?bar(@.a)]',
  '$[?blt(1)]',
  '$[?Length(@)]',
  '$[?length (@)]',
  '$[?bal(1) == 1]',
  '$[?!1]',
  '$[?(1)]',
  '$[?@.a == @.*]',
  '$[?@.a == match(@.b, "x")]',
  '$[?match(@.a, "x") == (1 == 1)]',
  '$[?1 == 1 || ]',
  '$[?@ == 1 "x"]',
  '$[1:2:3:4]',
  '$[1:2 3]',
  '$[1 2]',
  '$[1:a]',
  '$[?length(@)]',
  '$.a$',
];

test('well-formed and valid queries are accepted', () => {
  for (const q of VALID) {
    assert.doesNotThrow(() => parseQuery(q), `should accept ${q}`);
  }
});

test('queries that are not well-formed or not valid are rejected', () => {
  for (const q of INVALID) {
    assert.throws(() => parseQuery(q), QueryError, `should reject ${JSON.stringify(q)}`);
  }
});

test('index and slice integers must be in the I-JSON range [-(2^53)+1, (2^53)-1]', () => {
  assert.doesNotThrow(() => parseQuery('$[9007199254740991]'));
  assert.doesNotThrow(() => parseQuery('$[-9007199254740991]'));
  assert.doesNotThrow(() => parseQuery('$[0:9007199254740991:9007199254740991]'));
  assert.throws(() => parseQuery('$[9007199254740992]'), QueryError);
  assert.throws(() => parseQuery('$[-9007199254740992]'), QueryError);
  assert.throws(() => parseQuery('$[99999999999999999999999]'), QueryError);
  assert.throws(() => parseQuery('$[0:9007199254740992]'), QueryError);
  assert.throws(() => parseQuery('$[::9007199254740992]'), QueryError);
});

test('a lone surrogate in the query is not well-formed', () => {
  assert.throws(() => parseQuery('$.a\uD800'), QueryError);
  assert.doesNotThrow(() => parseQuery('$.a😀'));
});

test('comparisons take only singular queries', () => {
  assert.doesNotThrow(() => parseQuery('$[?@.a[0].b == 1]'));
  assert.throws(() => parseQuery('$[?@.a[0:1] == 1]'), QueryError);
});

test('a query is singular when it uses only name and index selectors without blank space', () => {
  assert.doesNotThrow(() => parseQuery('$[?@["a"][0] == 1]'));
  assert.throws(() => parseQuery('$[?@[ "a" ] == 1]'), QueryError);
  assert.throws(() => parseQuery('$[?@..a == 1]'), QueryError);
});
