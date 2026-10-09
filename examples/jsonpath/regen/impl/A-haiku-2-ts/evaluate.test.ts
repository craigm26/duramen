import { test } from 'node:test';
import assert from 'node:assert';
import { parseJson, stringify } from './json.ts';
import { compileQuery } from './query.ts';
import { evaluate, Overflow } from './evaluate.ts';

const run = (q: string, doc: string) => evaluate(compileQuery(q), parseJson(doc));
// The selected values as plain JavaScript values, in nodelist order.
const values = (q: string, doc: string) => JSON.parse(`[${run(q, doc).values.map(stringify).join(',')}]`);
const paths = (q: string, doc: string) => run(q, doc).paths;
const sorted = (xs: any[]) => [...xs].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));

const BOOKSTORE = `{ "store": {
  "book": [
    { "category": "reference", "author": "Nigel Rees", "title": "Sayings of the Century", "price": 8.95 },
    { "category": "fiction", "author": "Evelyn Waugh", "title": "Sword of Honour", "price": 12.99 },
    { "category": "fiction", "author": "Herman Melville", "title": "Moby Dick", "isbn": "0-553-21311-3", "price": 8.99 },
    { "category": "fiction", "author": "J. R. R. Tolkien", "title": "The Lord of the Rings", "isbn": "0-395-19395-8", "price": 22.99 }
  ],
  "bicycle": { "color": "red", "price": 399 } } }`;

const SELECTORS = `{ "a": [3, 5, 1, 2, 4, 6, {"b": "j"}, {"b": "k"}, {"b": {}}, {"b": "kilo"}],
  "o": {"p": 1, "q": 2, "r": 3, "s": 5, "t": {"u": 6}}, "e": "f" }`;

test('the bookstore examples of Table 2 select the stated nodes', () => {
  assert.deepStrictEqual(values('$.store.book[*].author', BOOKSTORE),
    ['Nigel Rees', 'Evelyn Waugh', 'Herman Melville', 'J. R. R. Tolkien']);
  assert.deepStrictEqual(values('$..author', BOOKSTORE),
    ['Nigel Rees', 'Evelyn Waugh', 'Herman Melville', 'J. R. R. Tolkien']);
  assert.deepStrictEqual(sorted(values('$.store..price', BOOKSTORE)), sorted([8.95, 12.99, 8.99, 22.99, 399]));
  assert.deepStrictEqual(values('$..book[2].author', BOOKSTORE), ['Herman Melville']);
  assert.deepStrictEqual(values('$..book[2].publisher', BOOKSTORE), []);
  assert.deepStrictEqual(values('$..book[-1].title', BOOKSTORE), ['The Lord of the Rings']);
  assert.deepStrictEqual(values('$..book[0,1].title', BOOKSTORE), ['Sayings of the Century', 'Sword of Honour']);
  assert.deepStrictEqual(values('$..book[:2].title', BOOKSTORE), ['Sayings of the Century', 'Sword of Honour']);
  assert.deepStrictEqual(values('$..book[?@.isbn].title', BOOKSTORE), ['Moby Dick', 'The Lord of the Rings']);
  assert.deepStrictEqual(values('$..book[?@.price<10].title', BOOKSTORE), ['Sayings of the Century', 'Moby Dick']);
  assert.deepStrictEqual(paths('$..book[2]', BOOKSTORE), ["$['store']['book'][2]"]);
});

test('the wildcard and the name selector return their nodes (Table 6, Table 5)', () => {
  assert.deepStrictEqual(paths('$.store.*', BOOKSTORE), ["$['store']['book']", "$['store']['bicycle']"]);
  const doc = `{"o": {"j j": {"k.k": 3}}, "'": {"@": 2}}`;
  assert.deepStrictEqual(values("$.o['j j']", doc), [{ 'k.k': 3 }]);
  assert.deepStrictEqual(paths("$.o['j j']", doc), ["$['o']['j j']"]);
  assert.deepStrictEqual(values('$.o["j j"]["k.k"]', doc), [3]);
  assert.deepStrictEqual(paths('$.o["j j"]["k.k"]', doc), ["$['o']['j j']['k.k']"]);
  assert.deepStrictEqual(values(`$["'"]["@"]`, doc), [2]);
  assert.deepStrictEqual(paths(`$["'"]["@"]`, doc), ["$['\\'']['@']"]);
});

test('normalized paths escape as Section 2.7 requires', () => {
  assert.deepStrictEqual(paths('$["\\u0061"]', '{"a": 1}'), ["$['a']"]);
  assert.deepStrictEqual(paths('$["\\u000B"]', '{"\\u000b": 1}'), ["$['\\u000b']"]);
  assert.deepStrictEqual(paths('$["x"]', '{"x": 1}'), ["$['x']"]);
  assert.deepStrictEqual(paths('$["\\\\"]', '{"\\\\": 1}'), ["$['\\\\']"]);
  assert.deepStrictEqual(paths('$["\\n\\t"]', '{"\\n\\t": 1}'), ["$['\\n\\t']"]);
});

test('an index is normalized, so the path names the element by position (Table 18)', () => {
  assert.deepStrictEqual(paths('$[-3]', '[1, 2, 3, 4, 5]'), ['$[2]']);
  assert.deepStrictEqual(paths('$.a.b[1:2]', '{"a":{"b":[0,1,2]}}'), ["$['a']['b'][1]"]);
  assert.deepStrictEqual(values('$[-2]', '["a","b"]'), ['a']);
  assert.deepStrictEqual(paths('$[-2]', '["a","b"]'), ['$[0]']);
});

test('slices select as Section 2.3.4.2.2 defines (Table 9)', () => {
  const doc = '["a", "b", "c", "d", "e", "f", "g"]';
  assert.deepStrictEqual(values('$[1:3]', doc), ['b', 'c']);
  assert.deepStrictEqual(values('$[5:]', doc), ['f', 'g']);
  assert.deepStrictEqual(values('$[1:5:2]', doc), ['b', 'd']);
  assert.deepStrictEqual(values('$[5:1:-2]', doc), ['f', 'd']);
  assert.deepStrictEqual(values('$[::-1]', doc), ['g', 'f', 'e', 'd', 'c', 'b', 'a']);
  assert.deepStrictEqual(paths('$[5:1:-2]', doc), ['$[5]', '$[3]']);
  assert.deepStrictEqual(values('$[0:100]', doc).length, 7);
  assert.deepStrictEqual(values('$[1:3:0]', doc), []);
});

test('the descendant segment visits nodes before their descendants (Table 16)', () => {
  const doc = '{"o": {"j": 1, "k": 2}, "a": [5, 3, [{"j": 4}, {"k": 6}]]}';
  assert.deepStrictEqual(sorted(values('$..j', doc)), sorted([1, 4]));
  assert.deepStrictEqual(paths('$..[0]', doc), ["$['a'][0]", "$['a'][2][0]"]);
  assert.deepStrictEqual(values('$..[0]', doc), [5, { j: 4 }]);
  assert.deepStrictEqual(values('$.a..[0, 1]', doc), [5, 3, { j: 4 }, { k: 6 }]);
  assert.deepStrictEqual(values('$.o..[*, *]', doc).length, 4);
  assert.deepStrictEqual(paths('$..o', doc), ["$['o']"]);
  assert.deepStrictEqual(values('$..[*]', doc).length, 11);
});

test('a deeply nested value does not exhaust the stack (Section 4.1)', () => {
  const depth = 2000;
  const doc = '['.repeat(depth) + ']'.repeat(depth);
  assert.strictEqual(run('$..[0]', doc).values.length, depth - 1);
});

test('null is an ordinary value (Section 2.6.1, Table 17)', () => {
  const doc = '{"a": null, "b": [null], "c": [{}], "null": 1}';
  assert.deepStrictEqual(values('$.a', doc), [null]);
  assert.deepStrictEqual(values('$.a[0]', doc), []);
  assert.deepStrictEqual(values('$.a.d', doc), []);
  assert.deepStrictEqual(paths('$.b[0]', doc), ["$['b'][0]"]);
  assert.deepStrictEqual(values('$.b[?@==null]', doc), [null]);
  assert.deepStrictEqual(values('$.c[?@.d==null]', doc), []);
  assert.deepStrictEqual(values('$.null', doc), [1]);
});

test('the comparison rules of Section 2.3.5.2.2 (Table 11)', () => {
  // $[?...] over this root selects both members if the comparison is true, neither if false.
  const doc = '{"obj": {"x": "y"}, "arr": [2, 3]}';
  const rows: [string, boolean][] = [
    ['$.absent1 == $.absent2', true], ['$.absent1 <= $.absent2', true], ["$.absent == 'g'", false],
    ['$.absent1 != $.absent2', false], ["$.absent != 'g'", true], ['1 <= 2', true], ['1 > 2', false],
    ["13 == '13'", false], ["'a' <= 'b'", true], ["'a' > 'b'", false], ['$.obj == $.arr', false],
    ['$.obj != $.arr', true], ['$.obj == $.obj', true], ['$.obj != $.obj', false], ['$.arr == $.arr', true],
    ['$.arr != $.arr', false], ['$.obj == 17', false], ['$.obj != 17', true], ['$.obj <= $.arr', false],
    ['$.obj < $.arr', false], ['$.obj <= $.obj', true], ['$.arr <= $.arr', true], ['1 <= $.arr', false],
    ['1 >= $.arr', false], ['1 > $.arr', false], ['1 < $.arr', false], ['true <= true', true], ['true > true', false],
  ];
  for (const [expr, expected] of rows) {
    assert.strictEqual(run(`$[?${expr}]`, doc).values.length === 2, expected, expr);
  }
});

test('the filter examples of Table 12 select the stated nodes', () => {
  assert.deepStrictEqual(values("$.a[?@.b == 'kilo']", SELECTORS), [{ b: 'kilo' }]);
  assert.deepStrictEqual(paths("$.a[?(@.b == 'kilo')]", SELECTORS), ["$['a'][9]"]);
  assert.deepStrictEqual(paths('$.a[?@>3.5]', SELECTORS), ["$['a'][1]", "$['a'][4]", "$['a'][5]"]);
  assert.deepStrictEqual(paths('$.a[?@.b]', SELECTORS), ["$['a'][6]", "$['a'][7]", "$['a'][8]", "$['a'][9]"]);
  assert.deepStrictEqual(paths('$[?@.*]', SELECTORS), ["$['a']", "$['o']"]);
  assert.deepStrictEqual(paths('$[?@[?@.b]]', SELECTORS), ["$['a']"]);
  assert.deepStrictEqual(values('$.o[?@<3, ?@<3]', SELECTORS).length, 4);
  assert.deepStrictEqual(paths('$.a[?@<2 || @.b == "k"]', SELECTORS), ["$['a'][2]", "$['a'][7]"]);
  assert.deepStrictEqual(paths('$.a[?match(@.b, "[jk]")]', SELECTORS), ["$['a'][6]", "$['a'][7]"]);
  assert.deepStrictEqual(paths('$.a[?search(@.b, "[jk]")]', SELECTORS), ["$['a'][6]", "$['a'][7]", "$['a'][9]"]);
  assert.deepStrictEqual(paths('$.o[?@>1 && @<4]', SELECTORS), ["$['o']['q']", "$['o']['r']"]);
  assert.deepStrictEqual(paths('$.o[?@.u || @.x]', SELECTORS), ["$['o']['t']"]);
  assert.strictEqual(run('$.a[?@.b == $.x]', SELECTORS).values.length, 6);
  assert.strictEqual(run('$.a[?@ == @]', SELECTORS).values.length, 10);
});

test('primitive values have no children for a filter or a wildcard', () => {
  assert.deepStrictEqual(values('$.e[*]', SELECTORS), []);
  assert.deepStrictEqual(values('$.e[?@]', SELECTORS), []);
});

test('the function extensions compute their results (Section 2.4)', () => {
  assert.deepStrictEqual(paths('$[?length(@.a) == 3]',
    '[{"a":"abc"},{"a":[1,2,3]},{"a":{"x":1,"y":2,"z":3}},{"a":5}]'), ['$[0]', '$[1]', '$[2]']);
  assert.deepStrictEqual(paths('$[?count(@.*) == 2]', '[[1,2],[1],{"a":1,"b":2}]'), ['$[0]', '$[2]']);
  assert.deepStrictEqual(paths('$[?value(@..color) == "red"]',
    '[{"color":"red"},{"color":"blue"},{"x":{"color":"red"},"color":"red"}]'), ['$[0]']);
  assert.deepStrictEqual(paths('$[?match(@, "a")]', '["a", 1, "ab"]'), ['$[0]']);
  assert.deepStrictEqual(paths('$[?search(@, "a")]', '["a", 1, "bab"]'), ['$[0]', '$[2]']);
  assert.deepStrictEqual(paths('$[?match(@.a, "[jk]")]', '[{"a": 1}]'), []);
});

test('a pattern that is not an I-Regexp makes match() and search() false (Sections 2.4.6, 2.4.7)', () => {
  assert.deepStrictEqual(paths('$[?match(@, "a{3,2}")]', '["a", "aaa"]'), []);
  assert.deepStrictEqual(paths('$[?search(@, "\\\\d")]', '["1"]'), []);
  assert.deepStrictEqual(paths('$[?search(@, 5)]', '["5"]'), []);
  assert.deepStrictEqual(paths('$[?search(@, "5")]', '["5"]'), ['$[0]']);
});

test('a query with a segment that selects nothing is still valid (Section 2.1.2)', () => {
  assert.deepStrictEqual(values('$[9007199254740991]', '[1]'), []);
  assert.deepStrictEqual(values('$[-9007199254740991]', '[1]'), []);
  assert.deepStrictEqual(values('$.a', '1'), []);
  assert.deepStrictEqual(values('$[*]', '"str"'), []);
});

test('string names compare by code point, without normalization (Section 2.3.1.2)', () => {
  assert.deepStrictEqual(values("$['\\u00e9']", JSON.stringify({ 'é': 1 })), []);
  assert.deepStrictEqual(values('$[?@ < "\u{1F600}"]', JSON.stringify(['�', '\u{1F600}'])), ['�']);
});

test('a number is output as it was read, and compared as its exact value (Section 1.3)', () => {
  const r = run('$[*]', '[1.0, 12345678901234567890, -0, 1E2]');
  assert.deepStrictEqual(r.values.map(stringify), ['1.0', '12345678901234567890', '-0', '1E2']);
  assert.deepStrictEqual(values('$[?@ == 1]', '[1.0, 2]'), [1.0]);
});

test('a comparison that needs a number beyond the exact range is an overflow (Section 2.1)', () => {
  assert.throws(() => run('$[?@ == 1]', '[9007199254740993]'), Overflow);
  assert.throws(() => run('$[?@ == 1]', '[1e400]'), Overflow);
  assert.throws(() => run('$[?@ < 9007199254740993]', '[1]'), Overflow);
  // Only a comparison processes a number, so an unused one does not overflow.
  assert.deepStrictEqual(run('$[0]', '[9007199254740993]').values.map(stringify), ['9007199254740993']);
});

test('the normalized path of a result is unique and matches its node (Section 2.7)', () => {
  const r = run('$..*', '{"a": [1, {"b": 2}]}');
  assert.deepStrictEqual(r.paths, ["$['a']", "$['a'][0]", "$['a'][1]", "$['a'][1]['b']"]);
});
