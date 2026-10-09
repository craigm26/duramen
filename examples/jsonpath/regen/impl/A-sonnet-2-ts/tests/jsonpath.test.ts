import { test } from 'node:test';
import assert from 'node:assert';
import { handleLine } from '../src/protocol.ts';

function run(query: string, document: unknown): { values: unknown[]; paths: string[] } {
  const line = JSON.stringify({ id: 'x', op: 'query', input: { query, document } });
  const r = JSON.parse(handleLine(line));
  assert.ok(r.result, `query ${query} gave ${JSON.stringify(r)}`);
  return r.result;
}
const vals = (q: string, d: unknown) => run(q, d).values;
const paths = (q: string, d: unknown) => run(q, d).paths;
function invalid(query: string) {
  const r = JSON.parse(handleLine(JSON.stringify({ id: 'x', op: 'query', input: { query, document: null } })));
  assert.deepStrictEqual(r, { id: 'x', error: 'invalid_query' }, `expected invalid: ${query}`);
}

const store = {
  store: {
    book: [
      { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95 },
      { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
      { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', isbn: '0-553-21311-3', price: 8.99 },
      { category: 'fiction', author: 'J. R. R. Tolkien', title: 'The Lord of the Rings', isbn: '0-395-19395-8', price: 22.99 },
    ],
    bicycle: { color: 'red', price: 399 },
  },
};

test('root, names, wildcard, index, slice (RFC 2.2-2.3.4)', () => {
  assert.deepStrictEqual(run('$', { k: 'v' }), { values: [{ k: 'v' }], paths: ['$'] });
  const o = { o: { 'j j': { 'k.k': 3 } }, "'": { '@': 2 } };
  assert.deepStrictEqual(run("$.o['j j']['k.k']", o), { values: [3], paths: ["$['o']['j j']['k.k']"] });
  assert.deepStrictEqual(run('$.o["j j"]["k.k"]', o).paths, ["$['o']['j j']['k.k']"]);
  assert.deepStrictEqual(run('$["\'"]["@"]', o).paths, ["$['\\'']['@']"]);
  assert.deepStrictEqual(vals('$.o[*]', { o: { j: 1, k: 2 }, a: [5, 3] }), [1, 2]);
  assert.deepStrictEqual(paths('$.a[*]', { a: [5, 3] }), ["$['a'][0]", "$['a'][1]"]);
  assert.deepStrictEqual(vals('$[1]', ['a', 'b']), ['b']);
  assert.deepStrictEqual(run('$[-2]', ['a', 'b']), { values: ['a'], paths: ['$[0]'] });
  assert.deepStrictEqual(vals('$[5]', ['a']), []);
  assert.deepStrictEqual(vals('$[0]', { a: 1 }), []);
  assert.deepStrictEqual(vals('$.a', [1]), []);
  const s = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.deepStrictEqual(vals('$[1:3]', s), ['b', 'c']);
  assert.deepStrictEqual(vals('$[5:]', s), ['f', 'g']);
  assert.deepStrictEqual(vals('$[1:5:2]', s), ['b', 'd']);
  assert.deepStrictEqual(vals('$[5:1:-2]', s), ['f', 'd']);
  assert.deepStrictEqual(vals('$[::-1]', s), ['g', 'f', 'e', 'd', 'c', 'b', 'a']);
  assert.deepStrictEqual(vals('$[::0]', s), []);
  assert.deepStrictEqual(vals('$[-100:100]', ['a', 'b']), ['a', 'b']);
  assert.deepStrictEqual(vals('$[ 1 : 3 : 1 ]', s), ['b', 'c']);
  assert.deepStrictEqual(vals('$[:2]', s), ['a', 'b']);
});

test('segments: multiple selectors, descendants (RFC 2.5)', () => {
  const s = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.deepStrictEqual(vals('$[0, 3]', s), ['a', 'd']);
  assert.deepStrictEqual(vals('$[0:2, 5]', s), ['a', 'b', 'f']);
  assert.deepStrictEqual(vals('$[0, 0]', s), ['a', 'a']);
  const d = { o: { j: 1, k: 2 }, a: [5, 3, [{ j: 4 }, { k: 6 }]] };
  assert.deepStrictEqual(run('$..j', d), { values: [1, 4], paths: ["$['o']['j']", "$['a'][2][0]['j']"] });
  assert.deepStrictEqual(vals('$..[0]', d), [5, { j: 4 }]);
  assert.strictEqual(vals('$..*', d).length, 11);
  assert.deepStrictEqual(vals('$..o', d), [{ j: 1, k: 2 }]);
  assert.deepStrictEqual(vals('$.a..[0, 1]', d), [5, 3, { j: 4 }, { k: 6 }]);
  // nodes visited before their descendants
  assert.deepStrictEqual(paths('$..*', { a: [{ b: 1 }] }), ["$['a']", "$['a'][0]", "$['a'][0]['b']"]);
  assert.deepStrictEqual(vals('$.a[*].b', { a: [{ b: 0 }, { b: 1 }, { c: 2 }] }), [0, 1]);
});

test('RFC 1.5 bookstore examples', () => {
  assert.strictEqual(vals('$.store.book[*].author', store).length, 4);
  assert.strictEqual(vals('$..author', store).length, 4);
  assert.strictEqual(vals('$.store.*', store).length, 2);
  assert.strictEqual(vals('$.store..price', store).length, 5);
  assert.deepStrictEqual(paths('$..book[2]', store), ["$['store']['book'][2]"]);
  assert.deepStrictEqual(vals('$..book[2].publisher', store), []);
  assert.deepStrictEqual(paths('$..book[-1]', store), ["$['store']['book'][3]"]);
  assert.strictEqual(vals('$..book[0,1]', store).length, 2);
  assert.strictEqual(vals('$..book[?@.isbn]', store).length, 2);
  assert.strictEqual(vals('$..book[?@.price<10]', store).length, 2);
});

test('null semantics (RFC 2.6)', () => {
  const d = { a: null, b: [null], c: [{}], null: 1 };
  assert.deepStrictEqual(vals('$.a', d), [null]);
  assert.deepStrictEqual(vals('$.a[0]', d), []);
  assert.deepStrictEqual(vals('$.a.d', d), []);
  assert.deepStrictEqual(vals('$.b[?@]', d), [null]);
  assert.deepStrictEqual(vals('$.b[?@==null]', d), [null]);
  assert.deepStrictEqual(vals('$.c[?@.d==null]', d), []);
  assert.deepStrictEqual(vals('$.null', d), [1]);
});

const fd = {
  a: [3, 5, 1, 2, 4, 6, { b: 'j' }, { b: 'k' }, { b: {} }, { b: 'kilo' }],
  o: { p: 1, q: 2, r: 3, s: 5, t: { u: 6 } },
  e: 'f',
};

test('filter selector examples (RFC Table 12)', () => {
  assert.deepStrictEqual(paths("$.a[?@.b == 'kilo']", fd), ["$['a'][9]"]);
  assert.deepStrictEqual(paths("$.a[?(@.b == 'kilo')]", fd), ["$['a'][9]"]);
  assert.deepStrictEqual(vals('$.a[?@>3.5]', fd), [5, 4, 6]);
  assert.deepStrictEqual(paths('$.a[?@.b]', fd), ["$['a'][6]", "$['a'][7]", "$['a'][8]", "$['a'][9]"]);
  assert.deepStrictEqual(paths('$[?@.*]', fd), ["$['a']", "$['o']"]);
  assert.deepStrictEqual(paths('$[?@[?@.b]]', fd), ["$['a']"]);
  assert.deepStrictEqual(vals('$.o[?@<3, ?@<3]', fd), [1, 2, 1, 2]);
  assert.deepStrictEqual(vals('$.a[?@<2 || @.b == "k"]', fd), [1, { b: 'k' }]);
  assert.deepStrictEqual(paths('$.a[?match(@.b, "[jk]")]', fd), ["$['a'][6]", "$['a'][7]"]);
  assert.deepStrictEqual(paths('$.a[?search(@.b, "[jk]")]', fd), ["$['a'][6]", "$['a'][7]", "$['a'][9]"]);
  assert.deepStrictEqual(vals('$.o[?@>1 && @<4]', fd), [2, 3]);
  assert.deepStrictEqual(vals('$.o[?@.u || @.x]', fd), [{ u: 6 }]);
  assert.strictEqual(vals('$.a[?@.b == $.x]', fd).length, 6);
  assert.strictEqual(vals('$.a[?@ == @]', fd).length, 10);
  assert.deepStrictEqual(vals('$.a[?!@.b]', fd).length, 6);
  assert.deepStrictEqual(vals('$.a[?!(@.b)]', fd).length, 6);
  assert.deepStrictEqual(vals('$[?@.e]', fd), []);
  assert.deepStrictEqual(vals('$[?$.e]', { e: 1, f: 2 }).length, 2);
  assert.deepStrictEqual(vals('$.a[?@ == 3 && (@ == 4 || @ == 3)]', fd), [3]);
  assert.deepStrictEqual(vals('$.a[?\n@\t==\r3 ]', fd), [3]);
});

test('comparison semantics (RFC Table 11)', () => {
  const d = { obj: { x: 'y' }, arr: [2, 3] };
  const t = (c: string) => vals(`$[?${c}]`, [0]).length === 1;
  const cases: [string, boolean][] = [
    ['$.absent1 == $.absent2', true], ['$.absent1 <= $.absent2', true], ["$.absent == 'g'", false],
    ['$.absent1 != $.absent2', false], ["$.absent != 'g'", true], ['1 <= 2', true], ['1 > 2', false],
    ["13 == '13'", false], ["'a' <= 'b'", true], ["'a' > 'b'", false], ['$.obj == $.arr', false],
    ['$.obj != $.arr', true], ['$.obj == $.obj', true], ['$.obj != $.obj', false], ['$.arr == $.arr', true],
    ['$.arr != $.arr', false], ['$.obj == 17', false], ['$.obj != 17', true], ['$.obj <= $.arr', false],
    ['$.obj < $.arr', false], ['$.obj <= $.obj', true], ['$.arr <= $.arr', true], ['1 <= $.arr', false],
    ['1 >= $.arr', false], ['1 > $.arr', false], ['1 < $.arr', false], ['true <= true', true],
    ['true > true', false], ['1.0 == 1', true], ['null == null', true], ['null < null', false],
    ["'' < 'a'", true], ["'ab' < 'b'", true],
  ];
  for (const [c, want] of cases) {
    // $.x in the RFC table names members of d; evaluate them as @.x against d as the current node
    const r = vals(`$[?${c.replaceAll('$.', '@.')}]`, [d]).length === 1;
    assert.strictEqual(r, want, c);
  }
  assert.strictEqual(t('1 <= 2'), true);
  assert.deepStrictEqual(vals('$[?@.a == @.b]', [{ a: { x: [1, { y: 2 }] }, b: { x: [1, { y: 2 }] } }]).length, 1);
  assert.deepStrictEqual(vals('$[?@.a == @.b]', [{ a: { x: 1 }, b: { x: 1, z: 1 } }]).length, 0);
  // code point ordering of strings, beyond the BMP
  assert.deepStrictEqual(vals("$[?@ < '\\uFF5E']", ['\u{1F600}', 'a']), ['a']);
});

test('function extensions (RFC 2.4)', () => {
  const d = [{ s: 'abc', a: [1, 2, 3], o: { x: 1 }, n: 5 }];
  assert.strictEqual(vals('$[?length(@.s) == 3]', d).length, 1);
  assert.strictEqual(vals('$[?length(@.a) == 3]', d).length, 1);
  assert.strictEqual(vals('$[?length(@.o) == 1]', d).length, 1);
  assert.strictEqual(vals('$[?length(@.n) == 1]', d).length, 0);
  assert.strictEqual(vals('$[?length(@.n) == length(@.zz)]', d).length, 1); // Nothing == Nothing
  assert.strictEqual(vals('$[?length(@.s) >= 3 && length(@) == 4]', d).length, 1);
  assert.strictEqual(vals("$[?length('\u{1F600}x') == 2]", d).length, 1);
  assert.strictEqual(vals('$[?count(@.*) == 4]', d).length, 1);
  assert.strictEqual(vals('$[?count(@..*) == 8]', d).length, 1);
  assert.strictEqual(vals('$[?count(@) == 1]', d).length, 1);
  assert.strictEqual(vals('$[?count(@.zz) == 0]', d).length, 1);
  assert.strictEqual(vals('$[?value(@.a[1]) == 2]', d).length, 1);
  assert.strictEqual(vals('$[?value(@.a[*]) == 2]', d).length, 0);
  assert.strictEqual(vals('$[?value(@.zz) == value(@.yy)]', d).length, 1);
  assert.strictEqual(vals('$[?length(value(@.a)) == 3]', d).length, 1);
  assert.strictEqual(vals('$[?match(@.s, "a.c")]', d).length, 1);
  assert.strictEqual(vals('$[?match(@.s, "a")]', d).length, 0);
  assert.strictEqual(vals('$[?search(@.s, "b")]', d).length, 1);
  assert.strictEqual(vals('$[?match(@.n, "5")]', d).length, 0); // not a string
  assert.strictEqual(vals('$[?match(@.s, @.n)]', d).length, 0); // pattern not a string
  assert.strictEqual(vals('$[?match(@.s, "(")]', d).length, 0); // invalid pattern: false
  assert.strictEqual(vals('$[?!match(@.s, "(")]', d).length, 1);
  assert.strictEqual(vals('$[?match(@.zz, "a")]', d).length, 0);
  assert.strictEqual(vals('$[?match("1974-05-01", "1974-05-..")]', d).length, 1);
  assert.strictEqual(vals('$[?match("a\\nb", "a.b")]', d).length, 0);
  assert.strictEqual(vals('$[?match("a\\nb", "a\\\\nb")]', d).length, 1);
});

test('well-typedness and syntax errors raise invalid_query (RFC 2.1, 2.4.3)', () => {
  for (const q of [
    '$[?length(@.*) < 3]', '$[?count(1) == 1]', "$[?match(@.t, 'a') == true]", '$[?value(@..color)]',
    '$[?length(@)]', '$[?count(@.*)]', '$[?match(@.a)]', '$[?foo(@.a)]', '$[?length(@.a, @.b) == 1]',
    '$[?length(1 == 1) == 1]', '$[?1]', "$['a'", '$[?@.a ==]', '$[?==1]', '$[?(@.a]',
    '$[?!@.a == 1]', '$[?@.a = 1]', '$[?count(@.*) == @.*]', '$[?@.* == 1]', '$[?@..a == 1]', '$[?@[0,1] == 1]',
    '$[?@[1:2] == 1]', '$[?match(@.a, "b") && 1]', '$[?LENGTH(@) == 1]', '$[?length (@) == 1]',
  ]) invalid(q);
});

test('syntax: root, segments, whitespace (RFC 2.1.1, 2.2.1, 2.5)', () => {
  for (const q of [
    '', 'a', '@', '.a', '$.', '$..', '$...a', '$.a.', '$.[a]', '$[]', '$[,]', '$[1,]', '$[,1]', '$. a', '$.1a',
    '$.a b', ' $', '$ ', '$.a ', '$..[', '$.*.', '$.-a', '$ .', '$..*a', '$.a..', '$[1 2]', '$["a" "b"]', '$.a$',
  ]) invalid(q);
  assert.deepStrictEqual(vals('$ .a', { a: 1 }), [1]);
  assert.deepStrictEqual(vals('$ [ "a" ] .b', { a: { b: 2 } }), [2]);
  assert.deepStrictEqual(vals('$\t\n\r.a', { a: 1 }), [1]);
  assert.deepStrictEqual(vals('$ ..a', { a: 1 }), [1]);
  assert.deepStrictEqual(vals('$.a_1.é.日本', { a_1: { é: { 日本: 7 } } }), [7]);
  assert.deepStrictEqual(vals('$._x', { _x: 1 }), [1]);
  assert.deepStrictEqual(vals('$.\u{1F600}', { '\u{1F600}': 1 }), [1]);
  assert.deepStrictEqual(vals('$..*', 5), []);
  assert.deepStrictEqual(vals('$.*', 5), []);
  assert.deepStrictEqual(vals('$[?@]', 5), []);
  assert.deepStrictEqual(vals('$[*]', []), []);
});

test('syntax: name selector strings and escapes (RFC 2.3.1)', () => {
  const d: any = { 'a\nb': 1, 'a"b': 2, "a'b": 3, '\u{1F041}': 4, '/': 5, '\\': 6, '\b\f\r\t': 7, 'A': 8, '\u000b': 9 };
  assert.deepStrictEqual(vals("$['a\\nb']", d), [1]);
  assert.deepStrictEqual(vals('$["a\\"b"]', d), [2]);
  assert.deepStrictEqual(vals("$['a\"b']", d), [2]);
  assert.deepStrictEqual(vals('$["a\'b"]', d), [3]);
  assert.deepStrictEqual(vals("$['a\\'b']", d), [3]);
  assert.deepStrictEqual(vals('$["\\uD83C\\uDC41"]', d), [4]);
  assert.deepStrictEqual(vals('$["\\ud83c\\udc41"]', d), [4]);
  assert.deepStrictEqual(vals('$["\\/"]', d), [5]);
  assert.deepStrictEqual(vals('$["\\\\"]', d), [6]);
  assert.deepStrictEqual(vals('$["\\b\\f\\r\\t"]', d), [7]);
  assert.deepStrictEqual(vals('$["\\u0041"]', d), [8]);
  assert.deepStrictEqual(vals('$["\u{1F041}"]', d), [4]);
  assert.deepStrictEqual(paths('$["\\u000B"]', d), ["$['\\u000b']"]);
  assert.deepStrictEqual(vals('$["\\u0061"]', { a: 1 }), [1]);
  for (const q of [
    '$["a\\\'b"]', "$['a\\\"b']", '$["\\uD800"]', '$["\\uDC00"]', '$["\\uD800\\u0041"]', '$["\\u00G0"]', '$["\\u00"]',
    '$["\\x"]', '$["\\U0041"]', '$["a\nb"]', '$["a\tb"]', "$['a\"]", '$["a', '$[\'a"]', '$["\\"]', '$[a]',
  ]) invalid(q);
  // no normalization on names
  assert.deepStrictEqual(vals('$["é"]', { 'é': 1, 'é': 2 }), [2]);
});

test('normalized paths (RFC 2.7)', () => {
  assert.deepStrictEqual(paths('$.a', { a: 1 }), ["$['a']"]);
  assert.deepStrictEqual(paths('$[-3]', [1, 2, 3, 4, 5]), ['$[2]']);
  assert.deepStrictEqual(paths('$.a.b[1:2]', { a: { b: [1, 2, 3] } }), ["$['a']['b'][1]"]);
  const odd = { "a'b\\c\nd\u0001\u007fé\u0000": 1 };
  assert.deepStrictEqual(paths('$.*', odd), ["$['a\\'b\\\\c\\nd\\u0001\u007fé\\u0000']"]);
  assert.deepStrictEqual(paths('$.*', { '\b\f\r\t': 1 }), ["$['\\b\\f\\r\\t']"]);
  assert.deepStrictEqual(paths('$.*', { '\u000e\u001f': 1 }), ["$['\\u000e\\u001f']"]);
  assert.deepStrictEqual(paths('$.*', { '"': 1 }), ['$[\'"\']']);
});

test('integers: syntax and I-JSON range (RFC 2.1, 2.3.3, 2.3.4)', () => {
  for (const q of [
    '$[01]', '$[-01]', '$[-0]', '$[+1]', '$[1.0]', '$[1e2]', '$[9007199254740992]', '$[-9007199254740992]',
    '$[0:9007199254740992]', '$[::9007199254740992]', '$[0:1:-9007199254740992]', '$[-]', '$[0x1]', '$[00]',
    '$[1:2:3:4]', '$[::-0]', '$[:01]',
  ]) invalid(q);
  assert.deepStrictEqual(vals('$[9007199254740991]', [1]), []);
  assert.deepStrictEqual(vals('$[-9007199254740991]', [1]), []);
  assert.deepStrictEqual(vals('$[0:9007199254740991]', [1]), [1]);
  assert.deepStrictEqual(vals('$[::-9007199254740991]', [1, 2]), [2]);
  assert.deepStrictEqual(vals('$[0]', [1]), [1]);
  assert.deepStrictEqual(vals('$[::9007199254740991]', [1, 2]), [1]);
});

test('filter literals (RFC 2.3.5.1)', () => {
  const d = [1, 1.5, -2, 0, 'x', true, false, null, 100, 0.001];
  assert.deepStrictEqual(vals('$[?@ == 1.5]', d), [1.5]);
  assert.deepStrictEqual(vals('$[?@ == -2]', d), [-2]);
  assert.deepStrictEqual(vals('$[?@ == -0]', d), [0]);
  assert.deepStrictEqual(vals('$[?@ == 1e2]', d), [100]);
  assert.deepStrictEqual(vals('$[?@ == 1E2]', d), [100]);
  assert.deepStrictEqual(vals('$[?@ == 1e+2]', d), [100]);
  assert.deepStrictEqual(vals('$[?@ == 1E-3]', d), [0.001]);
  assert.deepStrictEqual(vals('$[?@ == 0.1e1]', d), [1]);
  assert.deepStrictEqual(vals('$[?@ == true]', d), [true]);
  assert.deepStrictEqual(vals('$[?@ == false]', d), [false]);
  assert.deepStrictEqual(vals('$[?@ == null]', d), [null]);
  assert.deepStrictEqual(vals("$[?@ == 'x']", d), ['x']);
  assert.deepStrictEqual(vals('$[?@ == "x"]', d), ['x']);
  for (const q of ['$[?@ == 01]', '$[?@ == 1.]', '$[?@ == .5]', '$[?@ == +1]', '$[?@ == 1e]', '$[?@ == TRUE]',
    '$[?@ == True]', '$[?@ == Null]', '$[?@ == nil]', '$[?@ == -]', "$[?@ == 'x]", '$[?@ == 1ee1]', '$[?@ == -01]'])
    invalid(q);
});

test('operators, precedence and parentheses (RFC Table 10)', () => {
  const d = [{ a: 1, b: 2 }, { a: 1, b: 3 }, { a: 2, b: 2 }, {}];
  assert.strictEqual(vals('$[?@.a == 1 || @.a == 2 && @.b == 3]', d).length, 2);
  assert.strictEqual(vals('$[?(@.a == 1 || @.a == 2) && @.b == 3]', d).length, 1);
  assert.strictEqual(vals('$[?@.a == 1 && @.b == 2 || @.a == 2]', d).length, 2);
  assert.strictEqual(vals('$[?!(@.a == 1 || @.a == 2)]', d).length, 1);
  invalid('$[?!!@.a]'); // the grammar allows a single "!"
  assert.strictEqual(vals('$[?! @.a]', d).length, 1);
  assert.strictEqual(vals('$[?!(@.a)]', d).length, 1);
  assert.strictEqual(vals('$[?((@.a))]', d).length, 3);
  assert.strictEqual(vals('$[?@.a!=1]', d).length, 2);
  assert.strictEqual(vals('$[?@.a>=2]', d).length, 1);
  assert.strictEqual(vals('$[?@.a<=1]', d).length, 2);
  assert.strictEqual(vals('$[?@.a<2&&@.b>2]', d).length, 1);
  assert.strictEqual(vals('$[?@.a||@.b]', d).length, 3);
  assert.strictEqual(vals('$[?(@.a)||(@.b)]', d).length, 3);
  assert.strictEqual(vals('$[?@.a == 1,?@.b == 3]', d).length, 3);
  assert.strictEqual(vals('$[?  @.a == 1  ]', d).length, 2);
  assert.strictEqual(vals('$[?@ .a == 1]', d).length, 2); // blank space between segments
  assert.strictEqual(vals('$[?match(@.s,"a")||length(@)==0]', [{ s: 'a' }, {}, { s: 'b' }]).length, 2);
});

test('numbers: exactness and equality (RFC 2.3.5.2.2)', () => {
  const line = '{"id":"n","op":"query","input":{"query":"$[?@ == 12345678901234567890]","document":[12345678901234567890,12345678901234567891,1e999,0.1,1.0]}}';
  const r = JSON.parse(handleLine(line));
  assert.strictEqual(handleLine(line).includes('12345678901234567890'), true);
  assert.strictEqual(r.result.values.length, 1);
  const l2 = '{"id":"n","op":"query","input":{"query":"$[0,1]","document":[12345678901234567891,1.5]}}';
  assert.ok(handleLine(l2).includes('12345678901234567891'));
  assert.deepStrictEqual(vals('$[?@ == 1]', [1.0, 1, 1e0]).length, 3);
  assert.deepStrictEqual(vals('$[?@ < 2 && @ > 0.5]', [1, 3, 0]), [1]);
});

test('duplicate nodes are kept, ordering is by input node then selector (RFC 2.1.2)', () => {
  assert.deepStrictEqual(paths('$[*][0,0]', [[1], [2]]), ['$[0][0]', '$[0][0]', '$[1][0]', '$[1][0]']);
  assert.deepStrictEqual(paths('$..[0]', [[1]]), ['$[0]', '$[0][0]']);
  assert.deepStrictEqual(paths('$.a[*]', { a: [] }), []);
  assert.deepStrictEqual(paths('$.x.y.z', {}), []);
});

test('document edge cases', () => {
  assert.deepStrictEqual(run('$', null), { values: [null], paths: ['$'] });
  assert.deepStrictEqual(run('$', 'str'), { values: ['str'], paths: ['$'] });
  assert.deepStrictEqual(run('$.*', { __proto__: 1 }).values.length, 0);
  const l = handleLine('{"id":"p","op":"query","input":{"query":"$.__proto__","document":{"__proto__":{"x":1},"constructor":2}}}');
  assert.deepStrictEqual(JSON.parse(l).result.values, [{ x: 1 }]);
  assert.deepStrictEqual(JSON.parse(handleLine('{"id":"p","op":"query","input":{"query":"$.toString","document":{}}}')).result.values, []);
  assert.deepStrictEqual(JSON.parse(handleLine('{"id":"p","op":"query","input":{"query":"$.a","document":{"a":1,"a":2}}}')).result.values, [2]);
  // deep documents do not overflow the stack for descendant traversal
  let deep: any = 1;
  for (let i = 0; i < 2000; i++) deep = [deep];
  assert.strictEqual(vals('$..*', deep).length, 2000);
});
