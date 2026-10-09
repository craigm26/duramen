import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, QueryError } from './jsonpath.ts';
import type { Json } from './jsonpath.ts';

const ERR = Symbol('invalid_query');

function vals(q: string, doc: Json): Json[] | typeof ERR {
  try {
    return JSON.parse(JSON.stringify(query(q, doc).values));
  } catch (e) {
    if (e instanceof QueryError) return ERR;
    throw e;
  }
}

type Row = [string, Json, Json[] | typeof ERR];

function table(name: string, rows: Row[]) {
  test(name, () => {
    for (const [q, doc, want] of rows) {
      assert.deepEqual(vals(q, doc), want, `${q} on ${JSON.stringify(doc)}`);
    }
  });
}

const paths = (q: string, doc: Json) => query(q, doc).paths;

table('REQ-SY-001 root identifier and blank space', [
  ['$', { a: 1 }, [{ a: 1 }]],
  ['$ .a', { a: 1 }, [1]],
  ['$\t.a', { a: 1 }, [1]],
  ['$\n[\'a\']', { a: 1 }, [1]],
  ['$\r\n.a \r\n.b', { a: { b: 2 } }, [2]],
  ['', 1, ERR], [' $', 1, ERR], ['$ ', 1, ERR], ['$\n', 1, ERR], ['$.a ', { a: 1 }, ERR],
  ['$\u000c.a', { a: 1 }, ERR], ['$ .a', { a: 1 }, ERR], ['$ .a', { a: 1 }, ERR],
  ['@', 1, ERR], ['@.a', { a: 1 }, ERR], ['$$', 1, ERR], ['a', 1, ERR], ['$a', { a: 1 }, ERR],
]);

table('REQ-SY-002 dot notation', [
  ['$.a', { a: 1 }, [1]], ['$._', { _: 1 }, [1]], ['$._a1', { _a1: 1 }, [1]],
  ['$.A', { A: 1, a: 2 }, [1]], ['$.é', { 'é': 1 }, [1]], ['$.\u0080x', { '\u0080x': 1 }, [1]],
  ['$.😀', { '😀': 1 }, [1]], ['$.true', { true: 1 }, [1]], ['$.null', { null: 1 }, [1]],
  ['$..a', { x: { a: 1 } }, [1]], ['$.*', { a: 1 }, [1]], ['$..*', { a: [1] }, [[1], 1]],
  ["$..['a']", { a: 1 }, [1]],
  ['$.', { a: 1 }, ERR], ['$..', { a: 1 }, ERR], ['$...', { a: 1 }, ERR], ['$...a', { a: 1 }, ERR],
  ['$.1', { 1: 1 }, ERR], ['$.$', { $: 1 }, ERR], ['$.-a', { '-a': 1 }, ERR], ['$.a-b', { 'a-b': 1 }, ERR],
  ['$. a', { a: 1 }, ERR], ['$.. a', { a: 1 }, ERR], ['$.\ta', { a: 1 }, ERR], ["$.'a'", { a: 1 }, ERR],
  ['$.[0]', [1], ERR], ['$.\u007f', {}, ERR], ['$.a b', {}, ERR], ['$.@a', {}, ERR],
  ['$.ˋa', {}, ERR], ['$.{a', {}, ERR],
]);

table('REQ-SY-003 string literals', [
  ["$['a']", { a: 1, b: 2 }, [1]], ['$["a"]', { a: 1 }, [1]], ["$['\\'']", { "'": 2 }, [2]],
  ['$["\'"]', { "'": 2 }, [2]], ['$[\'"\']', { '"': 3 }, [3]], ['$["\\""]', { '"': 3 }, [3]],
  ["$['\\\\']", { '\\': 4 }, [4]], ["$['\\/']", { '/': 5 }, [5]], ["$['\\n']", { '\n': 6 }, [6]],
  ["$['\\u000A']", { '\n': 6 }, [6]], ["$['\\u00e9']", { 'é': 7 }, [7]],
  ["$['\\uD83D\\uDE00']", { '😀': 8 }, [8]], ["$['\\ud83d\\ude00']", { '😀': 8 }, [8]],
  ["$['\\uD7FF']", { '퟿': 17 }, [17]], ["$['']", { '': 13 }, [13]],
  ["$['\\b\\f\\r\\t']", { '\b\f\r\t': 14 }, [14]],
  ["$['\\\"']", {}, ERR], ['$["\\\'"]', {}, ERR], ["$['\\q']", {}, ERR], ["$['\\x41']", {}, ERR],
  ["$['\\U0041']", {}, ERR], ["$['\\u004']", {}, ERR], ["$['\\uD83D']", {}, ERR],
  ["$['\\uDE00']", {}, ERR], ["$['\\uD83Dx']", {}, ERR], ["$['\\uD83D\\u0041']", {}, ERR],
  ["$['\\uD800\\uDBFF']", {}, ERR], ["$['\n']", {}, ERR], ["$['\u0000']", {}, ERR], ["$['a", {}, ERR],
  ["$['a\"]", {}, ERR], ["$[a]", {}, ERR], ["$['a'b']", {}, ERR],
  ["$['\u007f']", { '\u007f': 11 }, [11]], ["$[' ']", { ' ': 12 }, [12]],
]);

table('REQ-SY-004 indexes', [
  ['$[1]', ['a', 'b'], ['b']], ['$[-1]', ['a', 'b'], ['b']], ['$[ 1 ]', ['a', 'b'], ['b']],
  ['$[9007199254740991]', ['a'], []], ['$[-9007199254740991]', ['a'], []],
  ['$[01]', ['a'], ERR], ['$[-0]', ['a'], ERR], ['$[+1]', ['a'], ERR], ['$[1.0]', ['a'], ERR],
  ['$[1e1]', ['a'], ERR], ['$[0x1]', ['a'], ERR], ['$[9007199254740992]', ['a'], ERR],
  ['$[-9007199254740992]', ['a'], ERR], ['$[99999999999999999999]', ['a'], ERR],
  ['$[1 1]', ['a'], ERR], ['$[-]', ['a'], ERR], ['$[- 1]', ['a'], ERR], ['$[]', ['a'], ERR],
]);

table('REQ-SY-005 slice syntax', [
  ['$[:]', ['a', 'b', 'c'], ['a', 'b', 'c']], ['$[::]', ['a', 'b', 'c'], ['a', 'b', 'c']],
  ['$[ 1 : 2 : 1 ]', ['a', 'b', 'c'], ['b']], ['$[1: :1]', ['a', 'b', 'c'], ['b', 'c']],
  ['$[::-1]', ['a', 'b', 'c'], ['c', 'b', 'a']],
  ['$[:9007199254740991]', ['a', 'b', 'c'], ['a', 'b', 'c']],
  ['$[1:2:3:4]', [], ERR], ['$[-0:]', [], ERR], ['$[:-0]', [], ERR], ['$[::-0]', [], ERR],
  ['$[01:]', [], ERR], ['$[:9007199254740992]', [], ERR], ['$[::9007199254740992]', [], ERR],
  ['$[1.0:]', [], ERR], ['$[1 2:]', [], ERR],
]);

table('REQ-SY-006 bracketed selections', [
  ["$['a','b']", { a: 1, b: 2 }, [1, 2]], ["$[ 'a' , 'b' ]", { a: 1, b: 2 }, [1, 2]],
  ["$[\n'b',\t'a'\r]", { a: 1, b: 2 }, [2, 1]], ["$[*,'a']", { a: 1, b: 2 }, [1, 2, 1]],
  ["$[?@ == 2, 'a']", { a: 1, b: 2 }, [2, 1]],
  ['$[ ]', {}, ERR], ["$[,'a']", {}, ERR], ["$['a',]", {}, ERR], ["$['a',,'b']", {}, ERR],
  ["$['a''b']", {}, ERR], ["$['a' 'b']", {}, ERR], ["$[['a']]", {}, ERR], ["$['a']]", {}, ERR],
  ['$[**]', {}, ERR], ['$[*a]', {}, ERR],
]);

const D1: Json = [1, 2, { a: 1 }];
table('REQ-SY-007 filter expressions', [
  ['$[?@]', D1, [1, 2, { a: 1 }]], ['$[? @]', D1, [1, 2, { a: 1 }]], ['$[?@ ]', D1, [1, 2, { a: 1 }]],
  ['$[?(@)]', D1, [1, 2, { a: 1 }]], ['$[?( @ )]', D1, [1, 2, { a: 1 }]],
  ['$[?!@.a]', D1, [1, 2]], ['$[?! @.a]', D1, [1, 2]], ['$[?!(@.a)]', D1, [1, 2]],
  ['$[?! ( @.a )]', D1, [1, 2]], ['$[?!(!@.a)]', D1, [{ a: 1 }]], ['$[?@==1]', D1, [1]],
  ['$[?1 == @]', D1, [1]], ['$[?@ > 1 && @ < 3]', D1, [2]], ['$[?@ == 1 || @.a]', D1, [1, { a: 1 }]],
  ['$[?1 == 1]', D1, [1, 2, { a: 1 }]],
  ...['$[?]', '$[? ]', '$[?()]', '$[?true]', '$[?false]', '$[?null]', '$[?1]', "$[?'a']", '$[?!@.a == 1]',
    '$[?!!@.a]', '$[?!1]', '$[?1 < 2 < 3]', '$[?@ & @]', '$[?@ | @]', '$[?@ and @]', '$[?@ or @]',
    '$[?@ = 1]', '$[?@ === 1]', '$[?@ <> 1]', '$[?@ =< 1]', '$[?@ => 1]', '$[?@ !== 1]', '$[?(@]',
    '$[?@)]', '$[?@ == ]', '$[?== 1]'].map((q): Row => [q, [1], ERR]),
]);

const D2: Json = [0, 1, 100, -1.5, 0.001, true, null, 'x'];
table('REQ-SY-008 literals', [
  ['$[?@ == -0]', D2, [0]], ['$[?@ == 0.0]', D2, [0]], ['$[?@ == -0.0]', D2, [0]],
  ['$[?@ == 1e2]', D2, [100]], ['$[?@ == 1E2]', D2, [100]], ['$[?@ == 1e+2]', D2, [100]],
  ['$[?@ == 100.0e0]', D2, [100]], ['$[?@ == -15e-1]', D2, [-1.5]], ['$[?@ == 1e-3]', D2, [0.001]],
  ['$[?@ == true]', D2, [true]], ['$[?@ == null]', D2, [null]], ['$[?@ == "x"]', D2, ['x']],
  ['$[?@ == 9007199254740993]', ['a'], []], ['$[?@ == 1e400]', ['a'], []],
  ...['01', '1.', '.5', '+1', '1e', '1e+', '0x10', '1_000', 'Infinity', 'NaN', 'True', 'NULL', 'nul', '-',
    '--1', "'x"].map((l): Row => [`$[?@ == ${l}]`, [1], ERR]),
]);

const D3: Json = [{ a: 1, b: [5, 6] }];
table('REQ-SY-009 singular queries', [
  ['$[?@.a == 1]', D3, D3 as Json[]], ["$[?@['a'] == 1]", D3, D3 as Json[]],
  ['$[?@.b[-1] == 6]', D3, D3 as Json[]], ['$[?@ .b [0] == 5]', D3, D3 as Json[]],
  ['$[?$[0].a == 1]', D3, D3 as Json[]], ['$[?@ == $[0]]', D3, D3 as Json[]],
  ...["$[?@[ 'a' ] == 1]", "$[?@['a' ] == 1]", '$[?@[ 0] == 1]', '$[?@.* == 1]', '$[?@[*] == 1]',
    '$[?@[0,1] == 1]', "$[?@['a','b'] == 1]", '$[?@[0:1] == 1]', '$[?@..a == 1]', '$[?@[?@] == 1]',
    '$[?1 == @..a]'].map((q): Row => [q, [[1]], ERR]),
]);

table('REQ-SY-010 function expressions', [
  ['$[?length(@) == 2]', ['ab', [1, 2]], ['ab', [1, 2]]],
  ['$[?length( @ ) == 2]', ['ab', [1, 2]], ['ab', [1, 2]]],
  ['$[?length(\n@\n) == 2]', ['ab', [1, 2]], ['ab', [1, 2]]],
  ["$[?match(@ , 'a.')]", ['ab', [1, 2]], ['ab']], ["$[?search( @,'b' )]", ['ab', [1, 2]], ['ab']],
  ...['$[?length (@) == 2]', '$[?Length(@) == 2]', '$[?len(@) == 2]', '$[?foo(@)]', '$[?constructor(@)]',
    '$[?length() == 2]', '$[?length(@, @) == 2]', '$[?count() == 1]', '$[?match(@)]',
    "$[?match(@, 'a', 'b')]", '$[?value() == 1]', '$[?length(@ == 2]', '$[?length@ == 2]',
    '$[?_length(@) == 2]', '$[?length(@,) == 2]'].map((q): Row => [q, ['ab'], ERR]),
]);

const D4: Json = [{ a: 'x', b: [1, 2] }];
table('REQ-SY-011 well-typed function expressions', [
  ['$[?length(@.a) == 1]', D4, D4 as Json[]], ["$[?length('abc') == 3]", D4, D4 as Json[]],
  ['$[?length(true) == length(1)]', D4, D4 as Json[]],
  ['$[?length(count(@.*)) == length(1)]', D4, D4 as Json[]],
  ['$[?length(value(@.b)) == 2]', D4, D4 as Json[]], ['$[?count(@..*) == 4]', D4, D4 as Json[]],
  ['$[?count($..*) == 5]', D4, D4 as Json[]], ["$[?match('x', @.a)]", D4, D4 as Json[]],
  ["$[?match(length(@.b), '2')]", D4, []], ["$[?value(@..a) == 'x']", D4, D4 as Json[]],
  ["$[?value(@.*) == 'x']", D4, []],
  ...['$[?length(@)]', '$[?count(@.*)]', '$[?value(@.a)]', '$[?!length(@)]', "$[?match(@.a, 'x') == true]",
    "$[?search(@.a, 'x') != false]", '$[?length(@.*) == 2]', '$[?length(@..a) == 1]',
    '$[?length(@[0,1]) == 1]', "$[?length(match(@.a, 'x')) == 1]", "$[?length(@.a == 'x') == 1]",
    '$[?length(!@.a) == 1]', '$[?count(1) == 1]', "$[?count('a') == 1]", '$[?count(length(@)) == 1]',
    '$[?count(value(@.b)) == 1]', "$[?count(@.a == 'x') == 1]", '$[?count((@.a)) == 1]',
    '$[?value(1) == 1]', '$[?value(count(@.*)) == 2]', "$[?match(@.*, 'x')]", '$[?match(@.a, @.*)]',
    "$[?match(@.a == 'x', 'x')]", '$[?length(@.a) == count(1)]'].map((q): Row => [q, D4, ERR]),
]);

test('REQ-RQ-004 validity never depends on the document', () => {
  assert.equal(vals('$[?length(@.*) < 3]', []), ERR);
  assert.equal(vals('$[?length(@.*) < 3]', { a: 1 }), ERR);
  assert.deepEqual(vals('$.a.b.c[5][\'x\']', { a: 1 }), []);
  assert.deepEqual(vals("$[?@.a < 'b']", [1, [2], { a: null }]), []);
  assert.deepEqual(vals('$..[?@[-1] == 1]', 'text'), []);
});

test('REQ-RQ-002 result shape, duplicates', () => {
  assert.deepEqual(query('$[0,0]', ['a']), { values: ['a', 'a'], paths: ['$[0]', '$[0]'] });
  assert.deepEqual(query('$.x', { k: 'v' }), { values: [], paths: [] });
});

test('REQ-RQ-003 any JSON value is a document', () => {
  for (const d of [null, false, 'abc', 1.5, []] as Json[]) assert.deepEqual(query('$', d), { values: [d], paths: ['$'] });
  assert.deepEqual(vals('$.*', 1), []);
  assert.deepEqual(vals('$[0]', 'abc'), []);
});

test('REQ-SE-001/002/003/004 root, names, wildcard, index', () => {
  assert.deepEqual(paths('$', [1]), ['$']);
  assert.deepEqual(vals('$.A', { a: 1 }), []);
  assert.deepEqual(vals("$['0']", ['x']), []);
  assert.deepEqual(vals("$['é']", { 'é': 1 }), []);
  assert.deepEqual(vals('$.constructor', {}), []);
  assert.deepEqual(vals('$.toString', { a: 1 }), []);
  assert.deepEqual(vals('$.__proto__', JSON.parse('{"__proto__": 1}')), [1]);
  assert.deepEqual(vals('$.*', { b: 1, a: 2 }), [2, 1]);
  assert.deepEqual(vals('$.*', 'ab'), []);
  assert.deepEqual(vals('$.*.*', { x: [1, 2], y: { z: 3 } }), [1, 2, 3]);
  assert.deepEqual(paths('$[-1]', ['a', 'b']), ['$[1]']);
  assert.deepEqual(vals('$[-3]', ['a', 'b']), []);
  assert.deepEqual(vals('$[0]', { 0: 'a' }), []);
  assert.deepEqual(vals('$[0]', 'ab'), []);
});

const G = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
table('REQ-SE-005 slices', [
  ['$[1:3]', G, ['b', 'c']], ['$[5:]', G, ['f', 'g']], ['$[:-5]', G, ['a', 'b']],
  ['$[1:5:2]', G, ['b', 'd']], ['$[5:1:-2]', G, ['f', 'd']], ['$[::-1]', G, [...G].reverse()],
  ['$[::-3]', G, ['g', 'd', 'a']], ['$[3:1]', G, []], ['$[3:1:-1]', G, ['d', 'c']],
  ['$[0:7:0]', G, []], ['$[10:]', G, []], ['$[-10:2]', G, ['a', 'b']], ['$[:100]', G, G],
  ['$[-1:-10:-1]', G, [...G].reverse()], ['$[6:-8:-2]', G, ['g', 'e', 'c', 'a']],
  ['$[:-7]', G, []], ['$[-10::-1]', G, []], ['$[10::-1]', G, [...G].reverse()],
  ['$[7:0:-1]', G, ['g', 'f', 'e', 'd', 'c', 'b']],
  ['$[-9007199254740991:9007199254740991:9007199254740991]', G, ['a']],
  ['$[0:2]', { 0: 1, 1: 2 }, []], ['$[:]', 'abc', []],
]);

test('REQ-SE-006 child segments', () => {
  assert.deepEqual(paths('$[0:2, 5]', G), ['$[0]', '$[1]', '$[5]']);
  assert.deepEqual(vals('$[*, 0]', ['a', 'b']), ['a', 'b', 'a']);
  assert.deepEqual(vals("$['a', 0]", [5]), [5]);
  assert.deepEqual(vals('$[1, 0][0]', [['a'], ['b']]), ['b', 'a']);
});

test('PROP-SE-P1 two selectors double the results', () => {
  for (const d of [[1, [2, { a: 3 }]], { a: [1], b: { c: 2 } }, 5] as Json[]) {
    assert.equal((query('$..[*, *]', d).values).length, 2 * query('$..[*]', d).values.length);
  }
});

const DD: Json = { o: { j: 1, k: 2 }, a: [5, 3, [{ j: 4 }, { k: 6 }]] };
test('REQ-SE-007 descendant segments', () => {
  assert.deepEqual(paths('$..j', DD), ["$['a'][2][0]['j']", "$['o']['j']"]);
  assert.deepEqual(vals('$..[0]', DD), [5, { j: 4 }]);
  assert.deepEqual(paths('$..*', DD), ["$['a']", "$['o']", "$['a'][0]", "$['a'][1]", "$['a'][2]",
    "$['a'][2][0]", "$['a'][2][1]", "$['a'][2][0]['j']", "$['a'][2][1]['k']", "$['o']['j']", "$['o']['k']"]);
  assert.deepEqual(vals('$.o..[*, *]', DD), [1, 2, 1, 2]);
  assert.deepEqual(paths('$..a', { a: { a: 1 } }), ["$['a']", "$['a']['a']"]);
  assert.deepEqual(vals('$..*', 1), []);
  assert.deepEqual(vals('$..[?@ > 1]', [1, [2, 3]]), [2, 3]);
});

test('PROP-NP-P1 a normalized path selects its node', () => {
  const docs: Json[] = [DD, [1, [2, 3], { a: [4] }], { "'": { '\\': 1, '\n': 2 }, '😀': [0] }];
  for (const d of docs) {
    for (const q of ['$..*', '$.*', '$..[*]', '$..[0]', '$..[-1]', "$..['a']"]) {
      const r = query(q, d);
      r.paths.forEach((p, i) => {
        const again = query(p, d);
        assert.deepEqual(again.values, [r.values[i]]);
        assert.deepEqual(again.paths, [p]);
      });
    }
  }
});

test('REQ-SE-008 members in code point order', () => {
  assert.deepEqual(vals('$.*', { b: 1, a: 2, B: 3 }), [3, 2, 1]);
  assert.deepEqual(paths('$.*', JSON.parse('{"10": 1, "9": 2, "1": 3}')), ["$['1']", "$['10']", "$['9']"]);
  assert.deepEqual(paths('$.*', { ab: 1, a: 2, '': 3 }), ["$['']", "$['a']", "$['ab']"]);
  assert.deepEqual(vals('$.*', { '😀': 1, '￿': 2, 'é': 3, z: 4 }), [4, 3, 2, 1]);
  assert.deepEqual(vals('$[?@ > 0]', { b: 1, a: 2 }), [2, 1]);
  assert.deepEqual(vals('$..*', { b: { y: 1, x: 2 }, a: [3] }), [[3], { x: 2, y: 1 }, 3, 2, 1]);
});

test('REQ-SE-009 null is a value', () => {
  assert.deepEqual(vals('$.a', { a: null }), [null]);
  assert.deepEqual(paths('$[?@.a == null]', [{ a: null }, {}]), ['$[0]']);
  assert.deepEqual(paths('$[?@.a]', [{ a: null }, {}]), ['$[0]']);
  assert.deepEqual(vals('$[*]', [null, null]), [null, null]);
});

test('REQ-FI-001 filter selectors', () => {
  assert.deepEqual(vals('$[?@ > 1]', [1, 2, 3]), [2, 3]);
  assert.deepEqual(vals('$[?@ > 1]', { a: 1, b: 2, c: 3 }), [2, 3]);
  assert.deepEqual(vals('$[?@ > 1]', 5), []);
  assert.deepEqual(paths('$[?@.x == $.x]', { x: 1, y: { x: 1 }, z: { x: 2 } }), ["$['y']"]);
  assert.deepEqual(vals('$[?@[?@ == 1]]', [[1, 2], [3]]), [[1, 2]]);
  assert.deepEqual(vals('$..[?@.k]', { k: 1, a: [{ k: 2 }] }), [{ k: 2 }]);
});

test('PROP-FI-P1 a filter and its negation partition the children', () => {
  const pairs = [['$[?@.a]', '$[?!@.a]'], ['$[?@ > 1]', '$[?!(@ > 1)]'],
    ["$[?@ == 'a' || @.b]", "$[?!(@ == 'a' || @.b)]"], ['$[?length(@) == 1]', '$[?!(length(@) == 1)]'],
    ["$[?match(@, 'a.*')]", "$[?!match(@, 'a.*')]"], ['$[?@[0]]', '$[?!@[0]]']];
  const docs: Json[] = [[0, 1, 2, 'a', 'ab', '', true, null, [1], [], { a: 1 }, { b: 0 }, {}],
    { a: [0], b: 'a', x: { a: null }, '9': 2 }];
  for (const d of docs) {
    for (const [p, n] of pairs) {
      assert.equal(query(p, d).values.length + query(n, d).values.length, query('$[*]', d).values.length);
    }
  }
});

test('REQ-FI-002 existence tests', () => {
  assert.deepEqual(paths('$[?@.a]', [{ a: null }, { a: false }, { b: 1 }, 1]), ['$[0]', '$[1]']);
  assert.deepEqual(paths('$[?!@.a]', [{ a: null }, { a: false }, { b: 1 }, 1]), ['$[2]', '$[3]']);
  assert.deepEqual(paths('$[?@.*]', [[], [0], {}, { a: 0 }, 'ab']), ['$[1]', '$[3]']);
  assert.deepEqual(paths('$[?@..x]', [{ y: { x: null } }, { y: 1 }]), ['$[0]']);
  assert.deepEqual(vals('$[?$.flag]', { flag: false, a: 1 }), [1, false]);
  assert.deepEqual(vals('$[?@]', [null, false, 0]), [null, false, 0]);
  assert.deepEqual(paths('$[?@.a == false]', [{ a: null }, { a: false }]), ['$[1]']);
});

const D5: Json = { obj: { x: 'y' }, arr: [2, 3] };
const ALL: Json[] = [[2, 3], { x: 'y' }];
table('REQ-FI-003 nothing to compare', [
  ['$[?$.absent1 == $.absent2]', D5, ALL], ['$[?$.absent1 <= $.absent2]', D5, ALL],
  ["$[?$.absent == 'g']", D5, []], ['$[?$.absent1 != $.absent2]', D5, []],
  ["$[?$.absent != 'g']", D5, ALL], ["$[?$.absent < 'g']", D5, []], ["$[?$.absent >= 'g']", D5, []],
  ['$[?$.absent == null]', D5, []], ['$[?$.absent == length(1)]', D5, ALL],
  ['$[?length(1) == length(true)]', D5, ALL], ['$[?length(1) < length(2)]', D5, []],
]);

table('REQ-FI-004 equality', [
  ["$[?13 == '13']", D5, []], ['$[?$.obj == $.arr]', D5, []], ['$[?$.obj != $.arr]', D5, ALL],
  ['$[?$.obj == $.obj]', D5, ALL], ['$[?$.arr != $.arr]', D5, []], ['$[?$.obj == 17]', D5, []],
  ['$[?@ == 1]', [1, 1.0, 1e0, '1', true, [1], { a: 1 }], [1, 1, 1]],
  ['$[?@ == 0]', [0, -0, false, null, '0', 0.0], [0, 0, 0]],
  ['$[?@ == false]', [false, 0, null, ''], [false]], ['$[?@ == null]', [null, false, 0, ''], [null]],
  ["$[?@ == 'é']", ['é', 'é'], ['é']],
  ['$[?@ == $.x]', { x: [1, { a: 2 }], y: [1, { a: 2 }], z: [{ a: 2 }, 1] }, [[1, { a: 2 }], [1, { a: 2 }]]],
  ['$[?@ == $.x]', { x: { a: 1, b: [true] }, y: { b: [true], a: 1 }, z: { a: 1 } },
    [{ a: 1, b: [true] }, { a: 1, b: [true] }]],
  ['$[?@ == $.x]', { x: {}, y: 0, z: '', w: [] }, [{}]],
  ['$[?@ == $.x]', { x: [], y: 0, z: '', w: {} }, [[]]],
]);

table('REQ-FI-005 less than', [
  ['$[?1 < 2]', D5, ALL], ['$[?2 < 1]', D5, []], ['$[?1.5 < 2]', D5, ALL], ['$[?1e1 < 9]', D5, []],
  ["$[?'a' < 'b']", D5, ALL], ["$[?'' < 'a']", D5, ALL], ["$[?'a' < 'ab']", D5, ALL],
  ["$[?'B' < 'a']", D5, ALL], ["$[?'z' < 'é']", D5, ALL],
  ["$[?'\\uffff' < '😀']", D5, ALL], ["$[?'😀' < '\\uffff']", D5, []],
  ["$[?1 < '2']", D5, []], ['$[?false < true]', D5, []], ['$[?null < 1]', D5, []],
  ['$[?$.arr < $.arr]', D5, []], ['$[?1 < $.arr]', D5, []],
  ["$[?@ < 'b']", ['a', 'B', 'b', 'ba', '', 'é', 1], ['a', 'B', '']],
]);

table('REQ-FI-006 derived comparisons', [
  ['$[?1 <= 2]', D5, ALL], ['$[?1 > 2]', D5, []], ["$[?'a' <= 'b']", D5, ALL],
  ['$[?$.obj <= $.arr]', D5, []], ['$[?$.obj <= $.obj]', D5, ALL], ['$[?1 >= $.arr]', D5, []],
  ['$[?true <= true]', D5, ALL], ['$[?true > true]', D5, []], ['$[?true >= true]', D5, ALL],
  ['$[?null <= null]', D5, ALL], ["$[?1 != '1']", D5, ALL], ['$[?1 >= 1.0]', D5, ALL],
]);

const D6: Json = [1, 2, 3, 4];
table('REQ-FI-007 logical operators', [
  ['$[?@ < 2 || @ > 3]', D6, [1, 4]], ['$[?@ > 1 && @ < 4]', D6, [2, 3]],
  ['$[?@ == 1 || @ == 2 && @ == 3]', D6, [1]], ['$[?(@ == 1 || @ == 2) && @ == 2]', D6, [2]],
  ['$[?!(@ == 1 || @ == 2)]', D6, [3, 4]], ['$[?!(@ == 1) && !(@ == 4)]', D6, [2, 3]],
  ['$[?@ > 0 && @ < 10 && @ != 3]', D6, [1, 2, 4]], ['$[?@==1||@==2]', D6, [1, 2]],
  ['$[?@>1&&@<4]', D6, [2, 3]],
]);

const MIX: Json = ['a', '😀', 'é', 'é', '', [1, [2, 3]], { a: 1, b: 2 }, 1, true, null];
table('REQ-FN-001 length', [
  ['$[?length(@) == 1]', MIX, ['a', '😀', 'é']],
  ['$[?length(@) == 2]', MIX, ['e\u0301', [1, [2, 3]], { a: 1, b: 2 }]],
  ['$[?length(@) == 0]', MIX, ['']], ['$[?length(@) == length(@.x)]', MIX, [1, true, null]],
  ["$[?length('😀😀') == 2]", [7], [7]],
]);

const CN: Json = [[1, 2], [3], [], { a: 1, b: 2 }, 5];
table('REQ-FN-002 count', [
  ['$[?count(@.*) == 2]', CN, [[1, 2], { a: 1, b: 2 }]], ['$[?count(@.*) == 0]', CN, [[], 5]],
  ['$[?count(@[0, 0]) == 2]', CN, [[1, 2], [3]]], ['$[?count(@..*) == 2]', CN, [[1, 2], { a: 1, b: 2 }]],
  ['$[?count($[*]) == 5]', CN, CN as Json[]],
]);

const VL: Json = [{ c: 'red' }, { a: { c: 'red' } }, { c: 'red', d: { c: 'blue' } }, {}];
table('REQ-FN-003 value', [
  ["$[?value(@..c) == 'red']", VL, [{ c: 'red' }, { a: { c: 'red' } }]],
  ["$[?value(@.*) == 'red']", VL, [{ c: 'red' }]],
  ['$[?value(@.x) == value(@.y)]', VL, VL as Json[]],
  ["$[?value(@..c) != 'red']", VL, [{ c: 'red', d: { c: 'blue' } }, {}]],
]);

const MS: Json = ['abc', 'abcd', 'xabc', 'ab\nc', 1, null];
table('REQ-FN-004 match', [
  ["$[?match(@, 'a.c')]", MS, ['abc']], ["$[?match(@, 'a.*')]", MS, ['abc', 'abcd']],
  ["$[?match(@, '[')]", MS, []], ["$[?!match(@, '[')]", MS, MS as Json[]], ['$[?match(@, 1)]', MS, []],
  ["$[?match(1, '1')]", MS, []], ["$[?match(@.x, '.*')]", MS, []],
  ["$[?match(@, 'abc|xabc')]", MS, ['abc', 'xabc']],
]);

const SS: Json = ['abc', 'xyz', '', 'a\nb', 'x^ay', 1];
table('REQ-FN-005 search', [
  ["$[?search(@, 'b')]", SS, ['abc', 'a\nb']], ["$[?search(@, '^a')]", SS, ['x^ay']],
  ["$[?search(@, '')]", SS, ['abc', 'xyz', '', 'a\nb', 'x^ay']], ["$[?search(@, 'a.b')]", SS, []],
  ["$[?search(@, 'b|z')]", SS, ['abc', 'xyz', 'a\nb']], ["$[?search(@, '[')]", SS, []],
]);

function m(pattern: string, s: string): boolean {
  const lit = pattern.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return query("$[?match(@, '" + lit + "')]", [s]).values.length === 1;
}

test('REQ-RX-001 what an I-Regexp is', () => {
  assert.ok(m('a', 'a')); assert.ok(m('', '')); assert.ok(m('a|', '')); assert.ok(m('()', ''));
  assert.ok(m('(a|b)c', 'bc')); assert.ok(m(',-/>@Z^z~', ',-/>@Z^z~')); assert.ok(m('a\\]', 'a]'));
  for (const bad of ['\\d', '\\w', '\\s', 'a*?', '(?:a)', 'a]', 'a{', 'a}', '[]', '[^]', '*a', 'a**', '(a', 'a)', '\\', '\\1']) {
    assert.ok(!m(bad, 'a') && !m(bad, ''), bad);
  }
  assert.ok(!m('a]', 'a]')); assert.ok(!m('a{', 'a{')); assert.ok(!m('*a', '*a'));
});

test('REQ-RX-002 matching', () => {
  const dot = query("$[?match(@, '.')]", ['\n', '\r', ' ', '\u0085', '😀', 'ab', '']).values;
  assert.deepEqual(dot, [' ', '\u0085', '😀']);
  assert.ok(m('^a', '^a')); assert.ok(!m('^a', 'a')); assert.ok(m('a$', 'a$'));
  assert.ok(!m('a', 'A')); assert.ok(m('a|bc', 'bc')); assert.ok(!m('a|bc', 'abc'));
  assert.deepEqual(vals("$[?search(@, 'a|bc')]", ['xa', 'xbcx', 'b']), ['xa', 'xbcx']);
});

test('REQ-RX-003 character classes', () => {
  assert.ok(m('[a-c]+', 'abc')); assert.ok(!m('[a-c]+', 'abd')); assert.ok(m('[^a]', '\n'));
  assert.ok(m('[-a]', '-')); assert.ok(m('[a-]', '-')); assert.ok(!m('[^-]', '-')); assert.ok(m('[a^]', '^'));
  assert.ok(m('[.]', '.')); assert.ok(!m('[.]', 'a')); assert.ok(m('[$]', '$'));
  assert.ok(m('[\\]]', ']')); assert.ok(m('[\\\\]', '\\')); assert.ok(m('[\\-a]', '-'));
  assert.ok(!m('[a-c-e]', 'a')); assert.ok(m('[\\n]', '\n')); assert.ok(m('[😀-😂]', '😁'));
  assert.ok(!m('[a', 'a')); assert.ok(m('[\\P{L}]', '1')); assert.ok(!m('[\\P{L}]', 'a'));
  assert.ok(m('[,.Z^]+', ',.Z^'));
});

test('REQ-RX-004 categories', () => {
  assert.ok(m('\\p{Lu}', 'É')); assert.ok(!m('\\p{Lu}', 'a')); assert.ok(m('\\p{Lt}', 'ǅ'));
  assert.ok(m('\\p{L}+', '日本')); assert.ok(m('\\p{Nd}+', '١٢٣')); assert.ok(m('\\p{N}', '½'));
  assert.ok(m('\\P{L}', '😀')); assert.ok(m('\\p{So}', '😀')); assert.ok(m('\\p{Zs}', ' '));
  assert.ok(m('\\p{Cc}', '\u0085')); assert.ok(m('[\\p{Lu}0-9]+', 'A1')); assert.ok(m('[^\\p{L}]', '1'));
  assert.ok(m('\\p{Cn}', '͸'));
  for (const bad of ['\\p{IsBasicLatin}', '\\p{Greek}', '\\p{lu}', '\\p{Cs}', '\\p{Lu', '\\pL']) {
    assert.ok(!m(bad, 'A') && !m(bad, 'a') && !m(bad, 'α'), bad);
  }
});

test('REQ-RX-005 escapes', () => {
  assert.ok(m('a\\.b', 'a.b')); assert.ok(!m('a\\.b', 'axb')); assert.ok(m('\\-', '-')); assert.ok(m('\\^', '^'));
  assert.ok(m('\\{', '{')); assert.ok(m('\\t', '\t')); assert.ok(m('\\n', '\n')); assert.ok(m('\\\\', '\\'));
  for (const bad of ['\\$', '\\/', '\\u0041', '\\b', '\\x41']) assert.ok(!m(bad, '$') && !m(bad, '/') && !m(bad, 'A') && !m(bad, 'b'), bad);
});

test('REQ-RX-006 quantifiers', () => {
  assert.deepEqual(['a', 'aa', 'aaa'].filter((s) => m('a{2}', s)), ['aa']);
  assert.deepEqual(['a', 'aa', 'aaa'].filter((s) => m('a{2,}', s)), ['aa', 'aaa']);
  assert.deepEqual(['', 'a', 'aa', 'aaa'].filter((s) => m('a{1,2}', s)), ['a', 'aa']);
  assert.deepEqual(['', 'a'].filter((s) => m('a{0}', s)), ['']);
  assert.ok(m('a{02}', 'aa')); assert.deepEqual(['', 'ab', 'abab', 'aba'].filter((s) => m('(ab)*', s)), ['', 'ab', 'abab']);
  assert.deepEqual(['b', 'ab', 'aab'].filter((s) => m('a?b', s)), ['b', 'ab']);
  for (const bad of ['a{,2}', 'a{2}{3}', 'a+?', '{2}', 'a{x}', 'a{2']) assert.ok(!m(bad, 'a') && !m(bad, 'aa') && !m(bad, '') && !m(bad, 'aaaaaa'), bad);
});

test('REQ-NP-001 and REQ-NP-002 normalized paths', () => {
  assert.deepEqual(paths('$.a.b[1:2]', { a: { b: [0, 1, 2] } }), ["$['a']['b'][1]"]);
  assert.deepEqual(paths('$["\\u000B"]', { '\u000b': 1 }), ["$['\\u000b']"]);
  assert.deepEqual(paths('$["\\u0061"]', { a: 1 }), ["$['a']"]);
  assert.deepEqual(paths('$[-3]', [0, 1, 2, 3, 4]), ['$[2]']);
  const cases: [string, string][] = [["'", "\\'"], ['\\', '\\\\'], ['"', '"'], ['/', '/'], ['\b', '\\b'], ['\t', '\\t'],
    ['\n', '\\n'], ['\f', '\\f'], ['\r', '\\r'], ['\u0000', '\\u0000'], ['\u000b', '\\u000b'],
    ['\u001f', '\\u001f'], ['\u007f', '\u007f'], ['\u0085', '\u0085'], [' ', ' '], ['😀', '😀'],
    ["a'b\\c", "a\\'b\\\\c"]];
  for (const [name, esc] of cases) assert.deepEqual(paths('$.*', { [name]: 1 }), ["$['" + esc + "']"]);
});
