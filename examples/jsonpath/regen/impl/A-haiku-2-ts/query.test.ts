import { test } from 'node:test';
import assert from 'node:assert';
import { compileQuery, InvalidQuery } from './query.ts';

const accepts = (q: string) => assert.doesNotThrow(() => compileQuery(q), q);
const rejects = (q: string) => assert.throws(() => compileQuery(q), InvalidQuery, q);

test('the root identifier begins every query (Section 2.2.1)', () => {
  rejects('a');
  rejects('');
  rejects(' $');
  accepts('$');
});

test('well-formed queries of the selectors are accepted (Sections 2.3 and 2.5)', () => {
  for (const q of ['$.a', '$.a.b', "$['a']", '$["a"]', '$.*', '$[*]', '$..*', '$..a', '$..[0]', '$[0]', '$[-1]',
    '$[1:3]', '$[::-1]', '$[::]', '$[1:5:2]', '$[ 1 , 2 ]', '$ .a', '$[ : ]', "$['a\\u0062']", '$["\\uD834\\uDD1E"]',
    "$['\\/\\\\']", '$[0,1]', '$..[0, 1]', '$.a[?@.b]', '$[?(@.a)]', '$[?!@.a]', "$[?@.a == 'x' && @.b != 2 || @.c]",
    "$[?@.a[0] == 'x']", '$[?length(@.a) >= 2]', '$[?count(@.*) == 1]', "$[?match(@.a, '[jk]')]",
    "$[?search(@.a, 'x')]", "$[?value(@..c) == 'red']", '$[?@ == @]', '$[?$.x == null]', '$[?@.a == -0.5e-3]',
    '$[?@.a < 1E+2]', '$[?length(@) < 3]', '$[?@.a == true]', '$[?1 < 2]', "$[?'a' <= 'b']", "$[?match(@.t, 'Europe/.*')]",
    '$[?@.a == -0]', '$[?@.a == 0]', '$[9007199254740991]', '$[-9007199254740991]', '$[?@.*]', '$[?@[?@.b]]',
    '$[?@<2 || @.b == "k"]', '$[?@.u || @.x]', '$[? @ ]']) accepts(q);
});

test('a segment may not be followed by white space at the end (Appendix A, segments)', () => {
  rejects('$.a ');
  rejects('$[0] ');
  rejects('$.a\t');
});

test('malformed names, indexes and slices are rejected (Sections 2.3.1 to 2.3.4)', () => {
  for (const q of ['$.', '$..', '$...a', '$[]', '$[,]', '$[1,]', '$[01]', '$[-0]', '$[+1]', '$[1 2]', '$[1:2:3:4]',
    "$['a]", '$["\\\'"]', "$['\\x']", '$["\\u12"]', "$['\\uD834']", "$['\\uDD1E']", "$['\\uD834\\u0041']",
    '$[9007199254740992]', '$[-9007199254740992]', '$[1:9007199254740992]', '$[*', '$..[', '$[a]', "$[\"\\'\"]",
    "$['\\u0022a']x", '$.a-b', '$[\n1\n]\n', "$[?@.a == 'x]"]) rejects(q);
});

test('a query is a sequence of Unicode scalar values (Section 2.1)', () => {
  rejects('$[\uD800]');
  rejects("$['\uDC00']");
});

test('a filter is a logical expression of the stated syntax (Sections 2.3.5.1 and 2.4)', () => {
  for (const q of ['$[?@.a ==]', '$[?@.a = 1]', '$[?@.a & 1]', '$[?@.* == 1]', "$[?@[ 'a' ] == 1]",
    '$[?!@.a == 1]', '$[?(@.a) == 1]', '$[?1]', "$[?'a']", '$[?@.a &&]', '$[?@.a == 0x1]', '$[?@.a == 01]',
    '$[?@.a == .5]', '$[?@.a == 1.]', '$[?@.a == true1]', '$[?@.a == NULL]', '$[?@.a == 1x]', '$[?@ < 1 < 2]',
    '$[?(@.a == 1)==true]', "$[?@.b == 'x]", '$[?@.a[*] == 1]', '$[?@.a ==1 ==2]', '$[?@.a || ]',
    '$[?1 || 2]', '$[?@ == 1 || ]']) rejects(q);
});

test('a singular query has plain name and index segments only (Section 2.3.5.1)', () => {
  accepts("$[?@['a'][0] == 'x']");
  rejects("$[?@[ 'a' ] == 1]");
  rejects('$[?@[0,1] == 1]');
  rejects('$[?@[0:1] == 1]');
  rejects('$[?@..a == 1]');
  rejects('$[?@.a[*] == 1]');
});

test('function expressions must be well-typed (Section 2.4.3, Table 14)', () => {
  accepts('$[?length(@) < 3]');
  accepts('$[?count(@.*) == 1]');
  accepts("$[?match(@.timezone, 'Europe/.*')]");
  accepts('$[?value(@..color) == "red"]');
  rejects('$[?length(@.*) < 3]');
  rejects('$[?count(1) == 1]');
  rejects('$[?match(@.timezone, "Europe/.*") == true]');
  rejects('$[?value(@..color)]');
  rejects('$[?bar(@.a)]');
  rejects('$[?blt(1)]');
  rejects('$[?bal(1)]');
  rejects('$[?length(@.a)]');
  rejects('$[?count(@.a)]');
  rejects('$[?match(@.a)]');
  rejects('$[?match(@.a, "x", "y")]');
  rejects('$[?length()]');
  rejects('$[?match(match(@.a, "x"), "y")]');
  rejects('$[?@.a == match(@.a, "x")]');
  rejects('$[?length(1 == 1) > 1]');
  rejects('$[?length(@.a == 1)]');
  rejects('$[?length(!@.a)]');
  rejects('$[?count(@.a == 1) == 1]');
  rejects('$[?foo(@.a)]');
});

test('a function argument may be a literal alone, but not a logical expression', () => {
  accepts("$[?match('abc', 'a.c')]");
  accepts("$[?match(@.a, 'x')]");
  rejects('$[?length(1 == 1) == 1]');
  rejects("$[?match(1 || 2, 'x')]");
});
