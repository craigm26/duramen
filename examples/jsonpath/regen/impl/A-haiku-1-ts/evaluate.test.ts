import test from 'node:test';
import assert from 'node:assert';
import { parseJson, serialize } from './json.ts';
import { parseQuery } from './query.ts';
import { evaluate } from './evaluate.ts';

function run(query: string, doc: string): { values: unknown[]; paths: string[] } {
  const r = evaluate(parseQuery(query), parseJson(doc));
  return { values: r.values.map((v) => JSON.parse(serialize(v))), paths: r.paths };
}

// Values in nodelist order, and optionally their normalized paths.
function expect(query: string, doc: string, values: unknown[], paths?: string[]): void {
  const r = run(query, doc);
  assert.deepStrictEqual(r.values, values, `values of ${query}`);
  if (paths !== undefined) assert.deepStrictEqual(r.paths, paths, `paths of ${query}`);
}

// Same, for results whose order the RFC leaves open (children of objects).
function expectSet(query: string, doc: string, values: unknown[], paths?: string[]): void {
  const r = run(query, doc);
  const key = (x: unknown): string => JSON.stringify(x);
  assert.deepStrictEqual(r.values.map(key).sort(), values.map(key).sort(), `values of ${query}`);
  if (paths !== undefined) {
    assert.deepStrictEqual([...r.paths].sort(), [...paths].sort(), `paths of ${query}`);
  }
}

// Number of nodes a filter over the root keeps: 3 when the test is true, 0 when false.
function holds(condition: string): boolean {
  const doc = '{"obj": {"x": "y"}, "arr": [2, 3], "t": 0}';
  return run(`$[?${condition}]`, doc).values.length === 3;
}

// The bookstore of RFC 9535 section 1.5, Figure 1.
const STORE = `{"store":{"book":[
  {"category":"reference","author":"Nigel Rees","title":"Sayings of the Century","price":8.95},
  {"category":"fiction","author":"Evelyn Waugh","title":"Sword of Honour","price":12.99},
  {"category":"fiction","author":"Herman Melville","title":"Moby Dick","isbn":"0-553-21311-3","price":8.99},
  {"category":"fiction","author":"J. R. R. Tolkien","title":"The Lord of the Rings","isbn":"0-395-19395-8","price":22.99}
 ],"bicycle":{"color":"red","price":399}}}`;

const AUTHORS = ['Nigel Rees', 'Evelyn Waugh', 'Herman Melville', 'J. R. R. Tolkien'];
const BOOK = (i: number): string => `$['store']['book'][${i}]`;

test('RFC 9535 Table 2: bookstore queries', () => {
  expect(
    '$.store.book[*].author',
    STORE,
    AUTHORS,
    [0, 1, 2, 3].map((i) => `${BOOK(i)}['author']`),
  );
  expect('$..author', STORE, AUTHORS);
  expect('$.store..price', STORE, [8.95, 12.99, 8.99, 22.99, 399]);
  expect(
    '$..book[2]',
    STORE,
    [{ category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', isbn: '0-553-21311-3', price: 8.99 }],
    [BOOK(2)],
  );
  expect('$..book[2].publisher', STORE, []);
  expect('$..book[-1].title', STORE, ['The Lord of the Rings'], [`${BOOK(3)}['title']`]);
  expect('$..book[0,1].title', STORE, ['Sayings of the Century', 'Sword of Honour']);
  expect('$..book[:2].title', STORE, ['Sayings of the Century', 'Sword of Honour']);
  expect('$..book[?@.isbn].title', STORE, ['Moby Dick', 'The Lord of the Rings']);
  expect('$..book[?@.price<10].title', STORE, ['Sayings of the Century', 'Moby Dick']);
  // Every member value and array element below the root: 27 nodes in this document.
  assert.strictEqual(run('$..*', STORE).values.length, 27);
});

test('RFC 9535 Table 2: $.store.* selects the book array and the bicycle', () => {
  const r = run('$.store.*', STORE);
  assert.strictEqual(r.values.length, 2);
  assert.deepStrictEqual(r.values[1], { color: 'red', price: 399 });
  assert.deepStrictEqual(r.paths, ["$['store']['book']", "$['store']['bicycle']"]);
});

test('RFC 9535 Table 6: wildcard selector', () => {
  const doc = '{"o": {"j": 1, "k": 2}, "a": [5, 3]}';
  expect('$[*]', doc, [{ j: 1, k: 2 }, [5, 3]], ["$['o']", "$['a']"]);
  expectSet('$.o[*]', doc, [1, 2], ["$['o']['j']", "$['o']['k']"]);
  expect('$.a[*]', doc, [5, 3], ["$['a'][0]", "$['a'][1]"]);
});

test('RFC 9535 Table 7: index selector', () => {
  expect('$[1]', '["a","b"]', ['b'], ['$[1]']);
  expect('$[-2]', '["a","b"]', ['a'], ['$[0]']);
  expect('$[2]', '["a","b"]', []);
  expect('$[-3]', '["a","b"]', []);
  expect('$.a', '[1]', []);
});

test('RFC 9535 Table 9: array slice selector', () => {
  const doc = '["a", "b", "c", "d", "e", "f", "g"]';
  expect('$[1:3]', doc, ['b', 'c'], ['$[1]', '$[2]']);
  expect('$[5:]', doc, ['f', 'g'], ['$[5]', '$[6]']);
  expect('$[1:5:2]', doc, ['b', 'd'], ['$[1]', '$[3]']);
  expect('$[5:1:-2]', doc, ['f', 'd'], ['$[5]', '$[3]']);
  expect('$[::-1]', doc, ['g', 'f', 'e', 'd', 'c', 'b', 'a']);
  expect('$[::0]', doc, []);
  expect('$[-2:]', doc, ['f', 'g']);
  expect('$[:-5]', doc, ['a', 'b']);
  expect('$[10:20]', doc, []);
  expect('$[-100:2]', doc, ['a', 'b']);
  expect('$[::3]', doc, ['a', 'd', 'g']);
});

test('RFC 9535 Table 15: child segments with several selectors', () => {
  const doc = '["a", "b", "c", "d", "e", "f", "g"]';
  expect('$[0,3]', doc, ['a', 'd'], ['$[0]', '$[3]']);
  expect('$[0:2,5]', doc, ['a', 'b', 'f'], ['$[0]', '$[1]', '$[5]']);
  expect('$[0,0]', doc, ['a', 'a'], ['$[0]', '$[0]']);
});

test('RFC 9535 Table 16: descendant segments', () => {
  const doc = '{"o": {"j": 1, "k": 2}, "a": [5, 3, [{"j": 4}, {"k": 6}]]}';
  expect('$..j', doc, [1, 4], ["$['o']['j']", "$['a'][2][0]['j']"]);
  expect('$..[0]', doc, [5, { j: 4 }], ["$['a'][0]", "$['a'][2][0]"]);
  expect('$..o', doc, [{ j: 1, k: 2 }], ["$['o']"]);
  expect(
    '$.a..[0, 1]',
    doc,
    [5, 3, { j: 4 }, { k: 6 }],
    ["$['a'][0]", "$['a'][1]", "$['a'][2][0]", "$['a'][2][1]"],
  );
  // The root's descendants: o, a, its two values, a's three elements and their members.
  assert.strictEqual(run('$..[*]', doc).values.length, 11);
  assert.strictEqual(run('$..*', doc).values.length, 11);
  expect('$..[?@.k]', doc, [{ j: 1, k: 2 }, { k: 6 }]);
});

test('RFC 9535 Table 5: name selectors and unusual member names', () => {
  const doc = '{"o": {"j j": {"k.k": 3}}, "\'": {"@": 2}}';
  expect("$.o['j j']", doc, [{ 'k.k': 3 }], ["$['o']['j j']"]);
  expect("$.o['j j']['k.k']", doc, [3], ["$['o']['j j']['k.k']"]);
  expect('$.o["j j"]["k.k"]', doc, [3], ["$['o']['j j']['k.k']"]);
  expect('$["\'"]["@"]', doc, [2], ["$['\\'']['@']"]);
});

test('RFC 9535 Table 17: null is an ordinary value', () => {
  const doc = '{"a": null, "b": [null], "c": [{}], "null": 1}';
  expect('$.a', doc, [null], ["$['a']"]);
  expect('$.a[0]', doc, []);
  expect('$.a.d', doc, []);
  expect('$.b[0]', doc, [null], ["$['b'][0]"]);
  expect('$.b[?@==null]', doc, [null], ["$['b'][0]"]);
  expect('$.c[?@.d==null]', doc, []);
  expect('$.null', doc, [1], ["$['null']"]);
});

test('RFC 9535 Table 12: filter selectors', () => {
  const doc = `{"a": [3, 5, 1, 2, 4, 6, {"b": "j"}, {"b": "k"}, {"b": {}}, {"b": "kilo"}],
    "o": {"p": 1, "q": 2, "r": 3, "s": 5, "t": {"u": 6}}, "e": "f"}`;
  expect("$.a[?@.b == 'kilo']", doc, [{ b: 'kilo' }], ["$['a'][9]"]);
  expect("$.a[?(@.b == 'kilo')]", doc, [{ b: 'kilo' }], ["$['a'][9]"]);
  expect('$.a[?@>3.5]', doc, [5, 4, 6], ["$['a'][1]", "$['a'][4]", "$['a'][5]"]);
  expect('$.a[?@.b]', doc, [{ b: 'j' }, { b: 'k' }, { b: {} }, { b: 'kilo' }], [
    "$['a'][6]",
    "$['a'][7]",
    "$['a'][8]",
    "$['a'][9]",
  ]);
  // A string has no children, so "e" is not selected.
  assert.deepStrictEqual(run('$[?@.*]', doc).paths, ["$['a']", "$['o']"]);
  assert.deepStrictEqual(run('$[?@[?@.b]]', doc).paths, ["$['a']"]);
  expectSet('$.o[?@<3, ?@<3]', doc, [1, 2, 1, 2], ["$['o']['p']", "$['o']['q']", "$['o']['p']", "$['o']['q']"]);
  expect('$.a[?@<2 || @.b == "k"]', doc, [1, { b: 'k' }], ["$['a'][2]", "$['a'][7]"]);
  expect('$.a[?match(@.b, "[jk]")]', doc, [{ b: 'j' }, { b: 'k' }], ["$['a'][6]", "$['a'][7]"]);
  expect('$.a[?search(@.b, "[jk]")]', doc, [{ b: 'j' }, { b: 'k' }, { b: 'kilo' }], [
    "$['a'][6]",
    "$['a'][7]",
    "$['a'][9]",
  ]);
  expect('$.o[?@>1 && @<4]', doc, [2, 3], ["$['o']['q']", "$['o']['r']"]);
  expect('$.o[?@.u || @.x]', doc, [{ u: 6 }], ["$['o']['t']"]);
  expect('$.a[?@.b == $.x]', doc, [3, 5, 1, 2, 4, 6], [0, 1, 2, 3, 4, 5].map((i) => `$['a'][${i}]`));
  assert.strictEqual(run('$.a[?@ == @]', doc).values.length, 10);
});

test('RFC 9535 Table 11: comparisons', () => {
  const truths: [string, boolean][] = [
    ['$.absent1 == $.absent2', true],
    ['$.absent1 <= $.absent2', true],
    ["$.absent == 'g'", false],
    ['$.absent1 != $.absent2', false],
    ["$.absent != 'g'", true],
    ['1 <= 2', true],
    ['1 > 2', false],
    ["13 == '13'", false],
    ["'a' <= 'b'", true],
    ["'a' > 'b'", false],
    ['$.obj == $.arr', false],
    ['$.obj != $.arr', true],
    ['$.obj == $.obj', true],
    ['$.obj != $.obj', false],
    ['$.arr == $.arr', true],
    ['$.arr != $.arr', false],
    ['$.obj == 17', false],
    ['$.obj != 17', true],
    ['$.obj <= $.arr', false],
    ['$.obj < $.arr', false],
    ['$.obj <= $.obj', true],
    ['$.arr <= $.arr', true],
    ['1 <= $.arr', false],
    ['1 >= $.arr', false],
    ['1 > $.arr', false],
    ['1 < $.arr', false],
    ['true <= true', true],
    ['true > true', false],
  ];
  for (const [condition, expected] of truths) {
    assert.strictEqual(holds(condition), expected, condition);
  }
});

test('RFC 9535 Table 14 and 2.4.4 to 2.4.8: function extensions', () => {
  expect('$[?length(@) < 3]', '["ab","abcd",[1,2],{"a":1,"b":2,"c":3},5]', ['ab', [1, 2]]);
  expect('$[?length(@) == 2]', '["\\ud83d\\ude00x"]', ['😀x']);
  expect('$[?count(@.*) == 1]', '[[1],[1,2],{"a":1},5]', [[1], { a: 1 }]);
  expect('$[?value(@..color) == "red"]', '[{"color":"red"},{"color":"blue"},{"x":{"color":"red"}}]', [
    { color: 'red' },
    { x: { color: 'red' } },
  ]);
  expect('$[?match(@.date, "1974-05-..")]', '[{"date":"1974-05-11"},{"date":"1974-06-11"},{"date":5}]', [
    { date: '1974-05-11' },
  ]);
  expect('$[?search(@.author, "[BR]ob")]', '[{"author":"Bob"},{"author":"Rob"},{"author":"Alice"}]', [
    { author: 'Bob' },
    { author: 'Rob' },
  ]);
  expect('$[?match(@.a, "[a-z")]', '[{"a":"x"}]', []);
  expect('$[?match(@.a, 1)]', '[{"a":"x"}]', []);
});

test('Nothing compares equal only to Nothing', () => {
  expect('$[?@.a == @.b]', '[{}, {"a":1,"b":1}]', [{}, { a: 1, b: 1 }]);
  expect('$[?@.a != @.b]', '[{}, {"a":1,"b":1}]', []);
  expect('$[?@.a == 1]', '[{}, {"a":1}]', [{ a: 1 }]);
});

test('numbers compare exactly and keep the text they were written with', () => {
  expect('$[?@ == 1.0]', '[1, 1.0, 1e0, 2, 10e-1]', [1, 1, 1, 1]);
  const doc = '[12345678901234567890, 12345678901234567891]';
  const big = evaluate(parseQuery('$[?@ == 12345678901234567891]'), parseJson(doc));
  assert.strictEqual(big.paths.length, 1);
  assert.strictEqual(serialize(big.values[0]), '12345678901234567891');
  assert.deepStrictEqual(run('$[?@ < 12345678901234567891]', doc).paths, ['$[0]'].map((p) => p));
});

test('RFC 9535 2.7: normalized paths', () => {
  expect('$.a.b[1:2]', '{"a":{"b":[0,1,2]}}', [1], ["$['a']['b'][1]"]);
  expect('$[-3]', '[0,1,2,3,4]', [2], ['$[2]']);
  expect('$["\\u0061"]', '{"a":1}', [1], ["$['a']"]);
  expect('$["\\u000B"]', '{"\\u000b":1}', [1], ["$['\\u000b']"]);
  expect("$['a\\'b\\\\c\\nd']", '{"a\'b\\\\c\\nd":1}', [1], ["$['a\\'b\\\\c\\nd']"]);
});
