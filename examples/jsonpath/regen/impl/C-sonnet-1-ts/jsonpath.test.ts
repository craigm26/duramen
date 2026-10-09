import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { handleLine } from './src/handle.ts';

function ask(query: string, document: unknown): any {
  const line = JSON.stringify({ id: 'x', op: 'query', input: { query, document } });
  return JSON.parse(handleLine(line)!);
}
const values = (q: string, d: unknown) => {
  const r = ask(q, d);
  assert.equal(r.error, undefined, `${q}: ${r.error}`);
  return r.result.values;
};
const paths = (q: string, d: unknown) => ask(q, d).result.paths;
const bad = (q: string, d: unknown = 1) => assert.equal(ask(q, d).error, 'invalid_query', q);

function vtable(rows: [string, unknown, unknown][]) {
  for (const [q, d, v] of rows) assert.deepEqual(values(q, d), v, q);
}
function btable(rows: string[]) {
  for (const q of rows) bad(q);
}

test('REQ-RQ-001 requests that cannot be handled', () => {
  const e = (line: string) => JSON.parse(handleLine(line)!);
  assert.deepEqual(e('{not json'), { id: null, error: 'bad_request' });
  assert.deepEqual(e('[1]'), { id: null, error: 'bad_request' });
  assert.deepEqual(e('{"op":"query","input":{"query":"$","document":1}}'), { id: null, error: 'bad_request' });
  assert.deepEqual(e('{"id":7,"op":"query","input":{"query":"$","document":1}}'), { id: null, error: 'bad_request' });
  assert.deepEqual(e('{"id":"r","input":{"query":"$","document":1}}'), { id: 'r', error: 'unknown_op' });
  assert.deepEqual(e('{"id":"r","op":"select","input":{"query":"$","document":1}}'), { id: 'r', error: 'unknown_op' });
  assert.deepEqual(e('{"id":"r","op":"query"}'), { id: 'r', error: 'bad_request' });
  assert.deepEqual(e('{"id":"r","op":"query","input":[]}'), { id: 'r', error: 'bad_request' });
  assert.deepEqual(e('{"id":"r","op":"query","input":{"document":1}}'), { id: 'r', error: 'bad_request' });
  assert.deepEqual(e('{"id":"r","op":"query","input":{"query":5,"document":1}}'), { id: 'r', error: 'bad_request' });
  assert.deepEqual(e('{"id":"r","op":"query","input":{"query":"$"}}'), { id: 'r', error: 'bad_request' });
  assert.deepEqual(e('{"id":"r","op":"query","input":{"query":"$[","document":1}}'), { id: 'r', error: 'invalid_query' });
  assert.equal(handleLine(''), null);
  assert.equal(handleLine('  \t '), null);
});

test('REQ-RQ-002/003 result shape, any document, ignored members', () => {
  assert.deepEqual(ask('$', { k: 'v' }).result, { values: [{ k: 'v' }], paths: ['$'] });
  assert.deepEqual(ask('$.x', { k: 'v' }).result, { values: [], paths: [] });
  assert.deepEqual(ask('$[0,0]', ['a']).result, { values: ['a', 'a'], paths: ['$[0]', '$[0]'] });
  const r = JSON.parse(handleLine('{"id":"r1","op":"query","trace":true,"input":{"query":"$.a","document":{"a":1},"flags":"x"}}')!);
  assert.deepEqual(r, { id: 'r1', result: { values: [1], paths: ["$['a']"] } });
  for (const d of [null, false, 'abc', 1.5, []]) assert.deepEqual(values('$', d), [d]);
  assert.deepEqual(values('$.*', 1), []);
  assert.deepEqual(values('$[0]', 'abc'), []);
});

test('REQ-RQ-004 invalid regardless of document', () => {
  bad('$[', null);
  bad('$[?length(@.*) < 3]', []);
  bad('$.a[?length(@.*) < 3]', { b: 1 });
  assert.deepEqual(values('$.a.b.c[5][\'x\']', { a: 1 }), []);
  assert.deepEqual(values("$[?@.a < 'b']", [1, [2], { a: null }]), []);
  assert.deepEqual(values('$..[?@[-1] == 1]', 'text'), []);
});

test('REQ-SY-001 root and blank space', () => {
  vtable([
    ['$', { a: 1 }, [{ a: 1 }]],
    ['$ .a', { a: 1 }, [1]],
    ['$\t.a', { a: 1 }, [1]],
    ["$\n['a']", { a: 1 }, [1]],
    ['$\r\n.a \r\n.b', { a: { b: 2 } }, [2]],
  ]);
  btable(['', ' $', '$ ', '$\n', '$.a ', '$\u000c.a', '$\u00a0.a', '$\u2028.a', '@', '@.a', '$$', 'a', '$a']);
});

test('REQ-SY-002 dot notation', () => {
  vtable([
    ['$.a', { a: 1 }, [1]],
    ['$._', { _: 1 }, [1]],
    ['$._a1', { _a1: 1 }, [1]],
    ['$.A', { A: 1, a: 2 }, [1]],
    ['$.é', { é: 1 }, [1]],
    ['$.\u0080x', { '\u0080x': 1 }, [1]],
    ['$.😀', { '😀': 1 }, [1]],
    ['$.true', { true: 1 }, [1]],
    ['$.null', { null: 1 }, [1]],
    ['$..a', { x: { a: 1 } }, [1]],
    ['$..*', { a: [1] }, [[1], 1]],
    ["$..['a']", { a: 1 }, [1]],
    ['$.*', { a: 1 }, [1]],
  ]);
  btable([
    '$.', '$..', '$...', '$...a', '$.1', '$.1a', '$.$', '$.-a', '$.a-b', '$. a', '$.. a', '$.\ta',
    "$.'a'", '$.[0]', '$.\u007f', '$.a b', '$.@a', '$.\u02cba', '$.{a',
  ]);
});

test('REQ-SY-003 string literals', () => {
  vtable([
    ["$['a']", { a: 1, b: 2 }, [1]],
    ['$["a"]', { a: 1, b: 2 }, [1]],
    ["$['\\'']", { "'": 2 }, [2]],
    ['$["\'"]', { "'": 2 }, [2]],
    ['$[\'"\']', { '"': 3 }, [3]],
    ['$["\\""]', { '"': 3 }, [3]],
    ["$['\\\\']", { '\\': 4 }, [4]],
    ["$['\\/']", { '/': 5 }, [5]],
    ["$['\\n']", { '\n': 6 }, [6]],
    ["$['\\u000A']", { '\n': 6 }, [6]],
    ["$['\\u000a']", { '\n': 6 }, [6]],
    ["$['\\u00E9']", { é: 7 }, [7]],
    ["$['\\uD83D\\uDE00']", { '😀': 8 }, [8]],
    ["$['\\ud83d\\ude00']", { '😀': 8 }, [8]],
    ["$['😀']", { '😀': 8 }, [8]],
    ["$['\u007f']", { '\u007f': 11 }, [11]],
    ["$['\u2028']", { '\u2028': 12 }, [12]],
    ["$['']", { '': 13 }, [13]],
    ["$['\\b\\f\\r\\t']", { '\b\f\r\t': 14 }, [14]],
    ["$['\\uDBFF\\uDFFF']", { '\u{10ffff}': 16 }, [16]],
    ["$['\\uD7FF']", { '\ud7ff': 17 }, [17]],
    ["$['\\uE000']", { '\ue000': 18 }, [18]],
  ]);
  btable([
    "$['\\\"']", '$["\\\'"]', "$['\\q']", "$['\\x41']", "$['\\U0041']", "$['\\u004']", "$['\\uD83D']",
    "$['\\uDE00']", "$['\\uD83Dx']", "$['\\uD83D\\u0041']", "$['\\uDBFF']", "$['\\uDC00']", "$['\\uD800\\uDBFF']",
    "$['\n']", "$['\t']", "$['\u0000']", "$['\u001f']", "$['a", '$[\'a"]', "$['a'", '$[a]', "$['a'b']",
  ]);
});

test('REQ-SY-004 index selectors and integers', () => {
  vtable([
    ['$[1]', ['a', 'b'], ['b']],
    ['$[-1]', ['a', 'b'], ['b']],
    ['$[ 1 ]', ['a', 'b'], ['b']],
    ['$[9007199254740991]', ['a'], []],
    ['$[-9007199254740991]', ['a'], []],
  ]);
  btable([
    '$[01]', '$[-0]', '$[+1]', '$[1.0]', '$[1e1]', '$[0x1]', '$[9007199254740992]', '$[-9007199254740992]',
    '$[99999999999999999999]', '$[1 1]', '$[-]', '$[- 1]', '$[]',
  ]);
});

test('REQ-SY-005 slice syntax', () => {
  const d = ['a', 'b', 'c'];
  vtable([
    ['$[:]', d, d],
    ['$[::]', d, d],
    ['$[1:]', d, ['b', 'c']],
    ['$[:2]', d, ['a', 'b']],
    ['$[::2]', d, ['a', 'c']],
    ['$[ 1 : 2 : 1 ]', d, ['b']],
    ['$[1: :1]', d, ['b', 'c']],
    ['$[::-1]', d, ['c', 'b', 'a']],
    ['$[:9007199254740991]', d, d],
    ['$[-9007199254740991:]', d, d],
  ]);
  btable(['$[1:2:3:4]', '$[-0:]', '$[:-0]', '$[::-0]', '$[01:]', '$[:9007199254740992]', '$[::9007199254740992]', '$[1.0:]', '$[1 2:]']);
});

test('REQ-SY-006 bracketed selections', () => {
  const o = { a: 1, b: 2 };
  vtable([
    ["$['a','b']", o, [1, 2]],
    ["$[ 'a' , 'b' ]", o, [1, 2]],
    ["$[\n'b',\t'a'\r]", o, [2, 1]],
    ["$[*,'a']", o, [1, 2, 1]],
    ["$[?@ == 2, 'a']", o, [2, 1]],
  ]);
  btable(['$[ ]', "$[,'a']", "$['a',]", "$['a',,'b']", "$['a''b']", "$['a' 'b']", "$[['a']]", "$['a']]", '$[**]', '$[*a]']);
});

test('REQ-SY-007 filter expressions', () => {
  const d = [1, 2, { a: 1 }];
  vtable([
    ['$[?@]', d, d],
    ['$[? @]', d, d],
    ['$[?@ ]', d, d],
    ['$[?(@)]', d, d],
    ['$[?( @ )]', d, d],
    ['$[?!@.a]', d, [1, 2]],
    ['$[?! @.a]', d, [1, 2]],
    ['$[?!(@.a)]', d, [1, 2]],
    ['$[?! ( @.a )]', d, [1, 2]],
    ['$[?!(!@.a)]', d, [{ a: 1 }]],
    ['$[?@==1]', d, [1]],
    ['$[?1 == @]', d, [1]],
    ['$[?@ > 1 && @ < 3]', d, [2]],
    ['$[?@ == 1 || @.a]', d, [1, { a: 1 }]],
    ['$[?1 == 1]', d, d],
  ]);
  btable([
    '$[?]', '$[? ]', '$[?()]', '$[?true]', '$[?false]', '$[?null]', '$[?1]', "$[?'a']", '$[?!@.a == 1]', '$[?!!@.a]',
    '$[?!1]', '$[?1 < 2 < 3]', '$[?@ & @]', '$[?@ | @]', '$[?@ and @]', '$[?@ or @]', '$[?@ = 1]', '$[?@ === 1]',
    '$[?@ <> 1]', '$[?@ =< 1]', '$[?@ => 1]', '$[?@ !== 1]', '$[?(@]', '$[?@)]', '$[?@ == ]', '$[?== 1]',
  ]);
});

test('REQ-SY-008 literals', () => {
  const d = [0, 1, 100, -1.5, 0.001, true, null, 'x'];
  vtable([
    ['$[?@ == -0]', d, [0]],
    ['$[?@ == 0.0]', d, [0]],
    ['$[?@ == 1e2]', d, [100]],
    ['$[?@ == 1E2]', d, [100]],
    ['$[?@ == 1e+2]', d, [100]],
    ['$[?@ == 100.0e0]', d, [100]],
    ['$[?@ == -15e-1]', d, [-1.5]],
    ['$[?@ == 1e-3]', d, [0.001]],
    ['$[?@ == true]', d, [true]],
    ['$[?@ == null]', d, [null]],
    ["$[?@ == 'x']", d, ['x']],
    ['$[?@ == "x"]', d, ['x']],
    ['$[?@ == 9007199254740993]', ['a'], []],
    ['$[?@ == 1e400]', ['a'], []],
  ]);
  btable([
    '01', '1.', '.5', '+1', '1e', '1e+', '0x10', '1_000', 'Infinity', 'NaN', 'True', 'NULL', 'nul', '-', '--1',
  ].map((l) => `$[?@ == ${l}]`));
  bad("$[?@ == 'x]");
});

test('REQ-SY-009 singular queries', () => {
  const d = [{ a: 1, b: [5, 6] }];
  vtable([
    ['$[?@.a == 1]', d, d],
    ["$[?@['a'] == 1]", d, d],
    ['$[?@["a"] == 1]', d, d],
    ['$[?@.b[1] == 6]', d, d],
    ['$[?@.b[-1] == 6]', d, d],
    ['$[?@ .b [0] == 5]', d, d],
    ['$[?$[0].a == 1]', d, d],
    ['$[?@ == $[0]]', d, d],
  ]);
  btable([
    "$[?@[ 'a'] == 1]", "$[?@['a' ] == 1]", '$[?@[ 0] == 1]', '$[?@.* == 1]', '$[?@[*] == 1]', '$[?@[0,1] == 1]',
    "$[?@['a','b'] == 1]", '$[?@[0:1] == 1]', '$[?@..a == 1]', '$[?@[?@] == 1]', '$[?1 == @..a]',
  ]);
  assert.deepEqual(values("$[?@[ 'a' ]]", [{ a: 1 }]), [{ a: 1 }]);
});

test('REQ-SY-010 function expressions', () => {
  const d = ['ab', [1, 2]];
  vtable([
    ['$[?length(@) == 2]', d, d],
    ['$[?length( @ ) == 2]', d, d],
    ['$[?length(\n@\n) == 2]', d, d],
    ["$[?match(@ , 'a.')]", d, ['ab']],
    ["$[?search( @,'b' )]", d, ['ab']],
  ]);
  btable([
    '$[?length (@) == 2]', '$[?Length(@) == 2]', '$[?LENGTH(@) == 2]', '$[?len(@) == 2]', '$[?foo(@)]',
    '$[?constructor(@)]', '$[?length() == 2]', '$[?length(@, @) == 2]', '$[?count() == 1]', '$[?match(@)]',
    "$[?match(@, 'a', 'b')]", '$[?value() == 1]', '$[?length(@ == 2]', '$[?length@ == 2]', '$[?_length(@) == 2]',
    '$[?length(@,) == 2]',
  ]);
});

test('REQ-SY-011 well-typed function expressions', () => {
  const d = [{ a: 'x', b: [1, 2] }];
  vtable([
    ['$[?length(@.a) == 1]', d, d],
    ["$[?length('abc') == 3]", d, d],
    ['$[?length(true) == length(1)]', d, d],
    ['$[?length(count(@.*)) == length(1)]', d, d],
    ['$[?length(value(@.b)) == 2]', d, d],
    ['$[?count(@.*) == 2]', d, d],
    ['$[?count(@) == 1]', d, d],
    ['$[?count(@..*) == 4]', d, d],
    ['$[?count($..*) == 5]', d, d],
    ["$[?match(@.a, 'x')]", d, d],
    ["$[?match('x', @.a)]", d, d],
    ['$[?search(@.a, @.a)]', d, d],
    ["$[?match(length(@.b), '2')]", d, []],
    ["$[?value(@..a) == 'x']", d, d],
    ["$[?value(@.*) == 'x']", d, []],
  ]);
  btable([
    '$[?length(@)]', '$[?count(@.*)]', '$[?value(@.a)]', '$[?!length(@)]', "$[?match(@.a, 'x') == true]",
    "$[?search(@.a, 'x') != false]", '$[?length(@.*) == 2]', '$[?length(@..a) == 1]', '$[?length(@[0,1]) == 1]',
    "$[?length(match(@.a, 'x')) == 1]", "$[?length(@.a == 'x') == 1]", '$[?length(!@.a) == 1]', '$[?count(1) == 1]',
    "$[?count('a') == 1]", '$[?count(length(@)) == 1]', '$[?count(value(@.b)) == 1]', "$[?count(@.a == 'x') == 1]",
    '$[?count((@.a)) == 1]', '$[?value(1) == 1]', '$[?value(count(@.*)) == 2]', "$[?match(@.*, 'x')]",
    '$[?match(@.a, @.*)]', "$[?match(@.a == 'x', 'x')]", '$[?length(@.a) == count(1)]',
  ]);
});

test('REQ-SE-001/002 root and name selectors', () => {
  assert.deepEqual(ask('$', [1, { a: 2 }]).result, { values: [[1, { a: 2 }]], paths: ['$'] });
  vtable([
    ['$.A', { a: 1 }, []],
    ["$['a']", ['a'], []],
    ["$['0']", ['x'], []],
    ["$['0']", { 0: 'x' }, ['x']],
    ['$.a', 'a', []],
    ["$['é']", { 'e\u0301': 1 }, []],
    ["$['e\u0301']", { 'e\u0301': 1, é: 2 }, [1]],
    ["$['']", { '': 1 }, [1]],
    ['$.constructor', {}, []],
    ['$.toString', { a: 1 }, []],
  ]);
  assert.deepEqual(ask('$.__proto__', JSON.parse('{"__proto__": 1}')).result, { values: [1], paths: ["$['__proto__']"] });
});

test('REQ-SE-003/008 wildcard and name order', () => {
  assert.deepEqual(ask('$.*', { b: 1, a: 2, B: 3 }).result, { values: [3, 2, 1], paths: ["$['B']", "$['a']", "$['b']"] });
  assert.deepEqual(paths('$.*', { 10: 1, 9: 2, 1: 3 }), ["$['1']", "$['10']", "$['9']"]);
  assert.deepEqual(paths('$.*', { ab: 1, a: 2, '': 3 }), ["$['']", "$['a']", "$['ab']"]);
  assert.deepEqual(values('$.*', { '😀': 1, '\uffff': 2, é: 3, z: 4 }), [4, 3, 2, 1]);
  assert.deepEqual(values('$[?@ > 0]', { b: 1, a: 2 }), [2, 1]);
  assert.deepEqual(values('$..*', { b: { y: 1, x: 2 }, a: [3] }), [[3], { x: 2, y: 1 }, 3, 2, 1]);
  vtable([['$[*]', [3, 1, 2], [3, 1, 2]], ['$.*', 5, []], ['$[*]', {}, []], ['$.*.*', { x: [1, 2], y: { z: 3 } }, [1, 2, 3]]]);
});

test('REQ-SE-004 index selectors', () => {
  vtable([
    ['$[0]', ['a', 'b'], ['a']],
    ['$[-1]', ['a', 'b'], ['b']],
    ['$[2]', ['a', 'b'], []],
    ['$[-3]', ['a', 'b'], []],
    ['$[0]', { 0: 'a' }, []],
    ['$[0]', 'ab', []],
    ['$[0][1]', [[1, 2]], [2]],
  ]);
  assert.deepEqual(paths('$[-1]', ['a', 'b']), ['$[1]']);
});

test('REQ-SE-005 slice selectors', () => {
  const d = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const rows: [string, string[]][] = [
    ['$[1:3]', ['b', 'c']], ['$[5:]', ['f', 'g']], ['$[:2]', ['a', 'b']], ['$[-2:]', ['f', 'g']],
    ['$[:-5]', ['a', 'b']], ['$[1:5:2]', ['b', 'd']], ['$[5:1:-2]', ['f', 'd']],
    ['$[::-1]', [...d].reverse()], ['$[::3]', ['a', 'd', 'g']], ['$[::-3]', ['g', 'd', 'a']],
    ['$[1:1]', []], ['$[3:1]', []], ['$[3:1:-1]', ['d', 'c']], ['$[0:7:0]', []], ['$[::0]', []],
    ['$[10:]', []], ['$[-10:2]', ['a', 'b']], ['$[:100]', d], ['$[-1:-10:-1]', [...d].reverse()],
    ['$[6:-8:-2]', ['g', 'e', 'c', 'a']], ['$[:0]', []], ['$[:-7]', []], ['$[-10::-1]', []],
    ['$[10::-1]', [...d].reverse()], ['$[7:0:-1]', ['g', 'f', 'e', 'd', 'c', 'b']],
    ['$[-9007199254740991:9007199254740991:9007199254740991]', ['a']],
  ];
  for (const [q, v] of rows) assert.deepEqual(values(q, d), v, q);
  assert.deepEqual(paths('$[5:1:-2]', d), ['$[5]', '$[3]']);
  assert.deepEqual(values('$[0:2]', { 0: 1, 1: 2 }), []);
  assert.deepEqual(values('$[:]', 'abc'), []);
});

test('REQ-SE-006 child segments', () => {
  const d = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.deepEqual(values('$[0, 3]', d), ['a', 'd']);
  assert.deepEqual(values('$[3, 0]', d), ['d', 'a']);
  assert.deepEqual(values('$[0:2, 5]', d), ['a', 'b', 'f']);
  assert.deepEqual(paths('$[0, 0]', d), ['$[0]', '$[0]']);
  assert.deepEqual(paths('$[*, 0]', ['a', 'b']), ['$[0]', '$[1]', '$[0]']);
  assert.deepEqual(values("$['b', 'a']", { a: 1, b: 2 }), [2, 1]);
  assert.deepEqual(values("$['a', 0]", { a: 1 }), [1]);
  assert.deepEqual(values("$['a', 0]", [5]), [5]);
  assert.deepEqual(paths('$[*][0]', [[1, 2], [3], [], 4]), ['$[0][0]', '$[1][0]']);
  assert.deepEqual(paths('$[1, 0][0]', [['a'], ['b']]), ['$[1][0]', '$[0][0]']);
});

test('REQ-SE-007 descendant segments', () => {
  const d = { o: { j: 1, k: 2 }, a: [5, 3, [{ j: 4 }, { k: 6 }]] };
  assert.deepEqual(ask('$..j', d).result, { values: [4, 1], paths: ["$['a'][2][0]['j']", "$['o']['j']"] });
  assert.deepEqual(paths('$..[0]', d), ["$['a'][0]", "$['a'][2][0]"]);
  assert.deepEqual(values('$..*', d), [
    [5, 3, [{ j: 4 }, { k: 6 }]], { j: 1, k: 2 }, 5, 3, [{ j: 4 }, { k: 6 }], { j: 4 }, { k: 6 }, 4, 6, 1, 2,
  ]);
  assert.deepEqual(values('$..o', d), [{ j: 1, k: 2 }]);
  assert.deepEqual(values('$.o..[*, *]', d), [1, 2, 1, 2]);
  assert.deepEqual(values('$.a..[0, 1]', d), [5, 3, { j: 4 }, { k: 6 }]);
  assert.deepEqual(paths('$..a', { a: { a: 1 } }), ["$['a']", "$['a']['a']"]);
  assert.deepEqual(values('$..*', 1), []);
  assert.deepEqual(values('$..[*]', [[[1]]]), [[[1]], [1], 1]);
  assert.deepEqual(values("$..['a','b']", { b: { a: 1 }, a: 2 }), [2, { a: 1 }, 1]);
  assert.deepEqual(paths('$..[?@ > 1]', [1, [2, 3]]), ['$[1][0]', '$[1][1]']);
});

test('REQ-SE-009 null is a value', () => {
  assert.deepEqual(ask('$.a', { a: null }).result, { values: [null], paths: ["$['a']"] });
  assert.deepEqual(values('$[?@.a == null]', [{ a: null }, {}]), [{ a: null }]);
  assert.deepEqual(values('$[?@.a]', [{ a: null }, {}]), [{ a: null }]);
  assert.deepEqual(values('$[*]', [null, null]), [null, null]);
});

test('EV-EV-RFC examples', () => {
  const d1 = { "'": { '@': 2 }, o: { 'j j': { 'k.k': 3 } } };
  assert.deepEqual(ask("$.o['j j']", d1).result, { values: [{ 'k.k': 3 }], paths: ["$['o']['j j']"] });
  assert.deepEqual(ask('$.o["j j"]["k.k"]', d1).result, { values: [3], paths: ["$['o']['j j']['k.k']"] });
  assert.deepEqual(ask('$["\'"]["@"]', d1).result, { values: [2], paths: ["$['\\'']['@']"] });
  assert.deepEqual(ask('$.o[*]', { a: [5, 3], o: { j: 1, k: 2 } }).result.values, [1, 2]);
  assert.deepEqual(ask('$[1]', ['a', 'b']).result, { values: ['b'], paths: ['$[1]'] });
});

test('PROP-SE-P1 / PROP-NP-P1 / PROP-FI-P1 on sample documents', () => {
  const docs: unknown[] = [
    [1, 'a', [0, 'b'], { a: 1, b: [2] }],
    { a: [1, { a: 'x' }], b: { '😀': null }, "'": 'a', x: [] },
    [[], {}, null, true, 1.5],
  ];
  for (const d of docs) {
    assert.equal(values('$..[*, *]', d).length, 2 * values('$..[*]', d).length);
    for (const q of ['$..*', '$.*', '$..[*]', '$..[0]', '$..[-1]', "$..['a']"]) {
      const r = ask(q, d).result;
      for (const i of [0, r.paths.length - 1]) {
        if (r.paths.length === 0) continue;
        const b = ask(r.paths[i], d).result;
        assert.deepEqual(b.paths, [r.paths[i]]);
      }
    }
    const pairs = [
      ['$[?@.a]', '$[?!@.a]'], ['$[?@ > 1]', '$[?!(@ > 1)]'], ["$[?@ == 'a' || @.b]", "$[?!(@ == 'a' || @.b)]"],
      ['$[?length(@) == 1]', '$[?!(length(@) == 1)]'], ["$[?match(@, 'a.*')]", "$[?!match(@, 'a.*')]"], ['$[?@[0]]', '$[?!@[0]]'],
    ];
    for (const [p, n] of pairs) {
      assert.equal(values(p, d).length + values(n, d).length, values('$[*]', d).length);
    }
  }
});

test('REQ-FI-001 filter selectors', () => {
  vtable([
    ['$[?@ > 1]', [1, 2, 3], [2, 3]],
    ['$[?@ > 1]', { a: 1, b: 2, c: 3 }, [2, 3]],
    ['$[?@ > 1]', 5, []],
    ['$[?@.x == $.x]', { x: 1, y: { x: 1 }, z: { x: 2 } }, [{ x: 1 }]],
    ['$[?@[?@ == 1]]', [[1, 2], [3]], [[1, 2]]],
    ['$..[?@.k]', { k: 1, a: [{ k: 2 }] }, [{ k: 2 }]],
  ]);
  assert.deepEqual(paths('$[?@ > 1]', { a: 1, b: 2, c: 3 }), ["$['b']", "$['c']"]);
});

test('REQ-FI-002 existence tests', () => {
  const d = [{ a: null }, { a: false }, { b: 1 }, 1];
  assert.deepEqual(paths('$[?@.a]', d), ['$[0]', '$[1]']);
  assert.deepEqual(paths('$[?!@.a]', d), ['$[2]', '$[3]']);
  assert.deepEqual(paths('$[?@.*]', [[], [0], {}, { a: 0 }, 'ab']), ['$[1]', '$[3]']);
  assert.deepEqual(paths('$[?@..x]', [{ y: { x: null } }, { y: 1 }]), ['$[0]']);
  assert.deepEqual(paths('$[?$.flag]', { flag: false, a: 1 }), ["$['a']", "$['flag']"]);
  assert.deepEqual(paths('$[?@]', [null, false, 0]), ['$[0]', '$[1]', '$[2]']);
  assert.deepEqual(paths('$[?@.a == false]', [{ a: null }, { a: false }]), ['$[1]']);
});

const OD = { obj: { x: 'y' }, arr: [2, 3] };
const BOTH = [[2, 3], { x: 'y' }];

test('REQ-FI-003 comparisons with nothing', () => {
  const rows: [string, unknown][] = [
    ['$[?$.absent1 == $.absent2]', BOTH], ['$[?$.absent1 <= $.absent2]', BOTH], ["$[?$.absent == 'g']", []],
    ['$[?$.absent1 != $.absent2]', []], ["$[?$.absent != 'g']", BOTH], ["$[?$.absent < 'g']", []],
    ["$[?$.absent >= 'g']", []], ['$[?$.absent == null]', []], ['$[?$.absent == length(1)]', BOTH],
    ['$[?length(1) == length(true)]', BOTH], ['$[?length(1) < length(2)]', []],
  ];
  for (const [q, v] of rows) assert.deepEqual(values(q, OD), v, q);
});

test('REQ-FI-004 equality', () => {
  const rows: [string, unknown][] = [
    ["$[?13 == '13']", []], ['$[?$.obj == $.arr]', []], ['$[?$.obj != $.arr]', BOTH], ['$[?$.obj == $.obj]', BOTH],
    ['$[?$.obj != $.obj]', []], ['$[?$.arr == $.arr]', BOTH], ['$[?$.arr != $.arr]', []], ['$[?$.obj == 17]', []],
    ['$[?$.obj != 17]', BOTH],
  ];
  for (const [q, v] of rows) assert.deepEqual(values(q, OD), v, q);
  assert.deepEqual(paths('$[?@ == 1]', JSON.parse('[1, 1.0, 1e0, "1", true, [1], {"a": 1}]')), ['$[0]', '$[1]', '$[2]']);
  assert.deepEqual(paths('$[?@ == 0]', JSON.parse('[0, -0, false, null, "0", 0.0]')), ['$[0]', '$[1]', '$[5]']);
  assert.deepEqual(paths('$[?@ == false]', [false, 0, null, '']), ['$[0]']);
  assert.deepEqual(paths('$[?@ == null]', [null, false, 0, '']), ['$[0]']);
  assert.deepEqual(paths("$[?@ == 'é']", ['é', 'e\u0301']), ['$[0]']);
  assert.deepEqual(paths('$[?@ == $.x]', { x: [1, { a: 2 }], y: [1, { a: 2 }], z: [{ a: 2 }, 1] }), ["$['x']", "$['y']"]);
  assert.deepEqual(paths('$[?@ == $.x]', { x: { a: 1, b: [true] }, y: { b: [true], a: 1 }, z: { a: 1 } }), ["$['x']", "$['y']"]);
  assert.deepEqual(paths('$[?@ == $.x]', { x: [], y: {}, z: [] }), ["$['x']", "$['z']"]);
  assert.deepEqual(paths('$[?@ == $.x]', { x: {}, y: 0, z: '', w: [] }), ["$['x']"]);
});

test('REQ-FI-005 less than', () => {
  const rows: [string, unknown][] = [
    ['$[?1 < 2]', BOTH], ['$[?2 < 1]', []], ['$[?-1 < 0]', BOTH], ['$[?1.5 < 2]', BOTH], ['$[?1e1 < 9]', []],
    ["$[?'a' < 'b']", BOTH], ["$[?'' < 'a']", BOTH], ["$[?'a' < 'ab']", BOTH], ["$[?'ab' < 'b']", BOTH],
    ["$[?'B' < 'a']", BOTH], ["$[?'z' < 'é']", BOTH], ["$[?'\\uffff' < '😀']", BOTH], ["$[?'😀' < '\\uffff']", []],
    ["$[?1 < '2']", []], ["$[?'1' < 2]", []], ['$[?false < true]', []], ['$[?null < 1]', []],
    ['$[?$.arr < $.arr]', []], ['$[?$.obj < $.arr]', []], ['$[?1 < $.arr]', []],
  ];
  for (const [q, v] of rows) assert.deepEqual(values(q, OD), v, q);
  assert.deepEqual(paths("$[?@ < 'b']", ['a', 'B', 'b', 'ba', '', 'é', 1]), ['$[0]', '$[1]', '$[4]']);
});

test('REQ-FI-006 derived comparison operators', () => {
  const rows: [string, unknown][] = [
    ['$[?1 <= 2]', BOTH], ['$[?1 > 2]', []], ["$[?'a' <= 'b']", BOTH], ["$[?'a' > 'b']", []],
    ['$[?$.obj <= $.arr]', []], ['$[?$.obj <= $.obj]', BOTH], ['$[?$.arr <= $.arr]', BOTH], ['$[?1 <= $.arr]', []],
    ['$[?1 >= $.arr]', []], ['$[?1 > $.arr]', []], ['$[?true <= true]', BOTH], ['$[?true > true]', []],
    ['$[?true >= true]', BOTH], ['$[?null <= null]', BOTH], ["$[?1 != '1']", BOTH], ['$[?2 >= 1]', BOTH],
    ['$[?1 >= 1.0]', BOTH], ["$[?'b' > 'a']", BOTH],
  ];
  for (const [q, v] of rows) assert.deepEqual(values(q, OD), v, q);
});

test('REQ-FI-007 logical operators', () => {
  const d = [1, 2, 3, 4];
  vtable([
    ['$[?@ < 2 || @ > 3]', d, [1, 4]],
    ['$[?@ > 1 && @ < 4]', d, [2, 3]],
    ['$[?@ == 1 || @ == 2 && @ == 3]', d, [1]],
    ['$[?(@ == 1 || @ == 2) && @ == 2]', d, [2]],
    ['$[?!(@ == 1 || @ == 2)]', d, [3, 4]],
    ['$[?!(@ == 1) && !(@ == 4)]', d, [2, 3]],
    ['$[?@ > 0 && @ < 10 && @ != 3]', d, [1, 2, 4]],
    ['$[?@ == 4 || @ == 3 || @ == 9]', d, [3, 4]],
    ['$[?@==1||@==2]', d, [1, 2]],
    ['$[?@>1&&@<4]', d, [2, 3]],
  ]);
});

const FD = ['a', '😀', 'é', 'e\u0301', '', [1, [2, 3]], { a: 1, b: 2 }, 1, true, null];

test('REQ-FN-001..003 length, count, value', () => {
  vtable([
    ['$[?length(@) == 1]', FD, ['a', '😀', 'é']],
    ['$[?length(@) == 2]', FD, ['é', [1, [2, 3]], { a: 1, b: 2 }]],
    ['$[?length(@) == 0]', FD, ['']],
    ['$[?length(@) == length(@.x)]', FD, [1, true, null]],
    ['$[?length(@.x) == 0]', FD, []],
    ["$[?length('😀😀') == 2]", [7], [7]],
  ]);
  const cd = [[1, 2], [3], [], { a: 1, b: 2 }, 5];
  vtable([
    ['$[?count(@.*) == 2]', cd, [[1, 2], { a: 1, b: 2 }]],
    ['$[?count(@.*) == 0]', cd, [[], 5]],
    ['$[?count(@) == 1]', cd, cd],
    ['$[?count(@[0, 0]) == 2]', cd, [[1, 2], [3]]],
    ['$[?count(@..*) == 2]', cd, [[1, 2], { a: 1, b: 2 }]],
    ['$[?count($[*]) == 5]', cd, cd],
  ]);
  const vd = [{ c: 'red' }, { a: { c: 'red' } }, { c: 'red', d: { c: 'blue' } }, {}];
  vtable([
    ["$[?value(@..c) == 'red']", vd, [vd[0], vd[1]]],
    ["$[?value(@.*) == 'red']", vd, [vd[0]]],
    ['$[?value(@.x) == value(@.y)]', vd, vd],
    ["$[?value(@..c) != 'red']", vd, [vd[2], vd[3]]],
  ]);
});

test('REQ-FN-004/005 match and search', () => {
  const md = ['abc', 'abcd', 'xabc', 'ab\nc', 1, null];
  vtable([
    ["$[?match(@, 'a.c')]", md, ['abc']],
    ["$[?match(@, 'a.*')]", md, ['abc', 'abcd']],
    ["$[?match(@, '[')]", md, []],
    ["$[?!match(@, '[')]", md, md],
    ['$[?match(@, 1)]', md, []],
    ["$[?match(1, '1')]", md, []],
    ["$[?match(@.x, '.*')]", md, []],
    ["$[?match(@, 'abc|xabc')]", md, ['abc', 'xabc']],
  ]);
  const sd = ['abc', 'xyz', '', 'a\nb', 'x^ay', 1];
  vtable([
    ["$[?search(@, 'b')]", sd, ['abc', 'a\nb']],
    ["$[?search(@, '^a')]", sd, ['x^ay']],
    ["$[?search(@, '')]", sd, ['abc', 'xyz', '', 'a\nb', 'x^ay']],
    ["$[?search(@, 'a.b')]", sd, []],
    ["$[?search(@, 'b|z')]", sd, ['abc', 'xyz', 'a\nb']],
    ["$[?search(@, '[')]", sd, []],
  ]);
});

// pattern (as I-Regexp text), document, expected matches
function rx(pattern: string, doc: unknown[], expected: unknown[]) {
  const q = `$[?match(@, '${pattern.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')]`;
  assert.deepEqual(values(q, doc), expected, pattern);
}

test('REQ-RX-001 what an I-Regexp is', () => {
  rx('a', ['a', 'b'], ['a']);
  rx('', ['', 'a'], ['']);
  rx('a|', ['a', '', 'b'], ['a', '']);
  rx('()', ['', 'a'], ['']);
  rx('(a|b)c', ['ac', 'bc', 'c'], ['ac', 'bc']);
  rx(',-/>@Z^z~', [',-/>@Z^z~', 'x'], [',-/>@Z^z~']);
  rx('\\d', ['1', 'd'], []);
  rx('\\w', ['a'], []);
  rx('\\s', [' '], []);
  rx('a*?', ['a', ''], []);
  rx('(?:a)', ['a'], []);
  rx('a]', ['a]'], []);
  rx('a\\]', ['a]'], ['a]']);
  rx('a{', ['a{'], []);
  rx('a}', ['a}'], []);
  rx('[]', [']', ''], []);
  rx('[^]', ['^', 'a'], []);
  rx('*a', ['a', '*a'], []);
  rx('a**', ['aa'], []);
  rx('(a', ['a', '(a'], []);
  rx('a)', ['a', 'a)'], []);
  rx('\\', ['\\'], []);
  rx('\\1', ['1'], []);
  assert.deepEqual(values(`$[?match(@, "'")]`, ["'", 'a']), ["'"]);
});

test('REQ-RX-002 matching', () => {
  rx('.', ['\n', '\r', '\u2028', '\u0085', '😀', 'ab', ''], ['\u2028', '\u0085', '😀']);
  rx('..', ['😀', 'ab'], ['ab']);
  rx('^a', ['^a', 'a'], ['^a']);
  rx('a$', ['a$', 'a'], ['a$']);
  rx('a', ['A', 'a'], ['a']);
  rx('a|bc', ['a', 'bc', 'abc'], ['a', 'bc']);
  assert.deepEqual(values("$[?search(@, 'b')]", ['abc', 'B']), ['abc']);
  assert.deepEqual(values("$[?search(@, 'a|bc')]", ['xa', 'xbcx', 'b']), ['xa', 'xbcx']);
});

test('REQ-RX-003 character classes', () => {
  rx('[a-c]+', ['abc', 'abd', ''], ['abc']);
  rx('[^a]', ['a', 'b', '😀', '\n'], ['b', '😀', '\n']);
  rx('[-a]', ['-', 'a', 'b'], ['-', 'a']);
  rx('[a-]', ['-', 'a', 'b'], ['-', 'a']);
  rx('[^-]', ['-', 'a'], ['a']);
  rx('[a^]', ['^', 'a', 'b'], ['^', 'a']);
  rx('[.]', ['.', 'a'], ['.']);
  rx('[$]', ['$', 'a'], ['$']);
  rx('[\\]]', [']', '\\'], [']']);
  rx('[\\\\]', ['\\', 'a'], ['\\']);
  rx('[\\-a]', ['-', 'a', 'b'], ['-', 'a']);
  rx('[a-c-e]', ['a', '-'], []);
  rx('[\\n]', ['\n', 'n'], ['\n']);
  rx('[😀-😂]', ['😁', 'a'], ['😁']);
  rx('[a', ['a'], []);
  rx('[\\P{L}]', ['a', '1'], ['1']);
  rx('[,.Z^]+', [',.Z^', 'a'], [',.Z^']);
});

test('REQ-RX-004 categories', () => {
  rx('\\p{Lu}', ['A', 'a', 'É', '1', 'ǅ'], ['A', 'É']);
  rx('\\p{Lt}', ['ǅ', 'A'], ['ǅ']);
  rx('\\p{L}+', ['abc', 'ab1', 'é😀', '日本'], ['abc', '日本']);
  rx('\\p{Nd}+', ['123', '١٢٣', '12a', 'Ⅻ'], ['123', '١٢٣']);
  rx('\\p{N}', ['1', 'Ⅻ', '½', 'a'], ['1', 'Ⅻ', '½']);
  rx('\\P{L}', ['a', '1', ' ', '😀'], ['1', ' ', '😀']);
  rx('\\p{So}', ['😀', 'a'], ['😀']);
  rx('\\p{Zs}', [' ', '\u00a0', '\t'], [' ', '\u00a0']);
  rx('\\p{Cc}', ['\t', '\u0085', 'a'], ['\t', '\u0085']);
  rx('[\\p{Lu}0-9]+', ['A1', 'a1'], ['A1']);
  rx('[^\\p{L}]', ['a', '1'], ['1']);
  for (const n of ['IsBasicLatin', 'Greek', 'lu', 'Cs']) rx(`\\p{${n}}`, ['a', 'α', 'A'], []);
  rx('\\p{Lu', ['A'], []);
  rx('\\pL', ['A'], []);
  for (const n of ['L', 'Lu', 'Ll', 'Lt', 'Lm', 'Lo', 'M', 'Mn', 'Mc', 'Me', 'N', 'Nd', 'Nl', 'No', 'P', 'Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po', 'Z', 'Zs', 'Zl', 'Zp', 'S', 'Sm', 'Sc', 'Sk', 'So', 'C', 'Cc', 'Cf', 'Co', 'Cn']) {
    assert.doesNotThrow(() => values(`$[?match(@, '\\\\p{${n}}')]`, ['a']), n);
  }
  assert.deepEqual(values("$[?match(@, '\\\\p{Cn}')]", ['\u0378', 'a']), ['\u0378']);
});

test('REQ-RX-005 escapes', () => {
  rx('a\\.b', ['a.b', 'axb'], ['a.b']);
  rx('\\-', ['-'], ['-']);
  rx('\\^', ['^'], ['^']);
  rx('\\{', ['{'], ['{']);
  rx('\\t', ['\t', 't'], ['\t']);
  rx('\\n', ['\n', 'n'], ['\n']);
  rx('\\\\', ['\\'], ['\\']);
  for (const e of ['$', '/', 'u0041', 'b', 'x41']) rx('\\' + e, ['$', '/', 'A', 'b'], []);
});

test('REQ-RX-006 quantifiers', () => {
  rx('a{2}', ['a', 'aa', 'aaa'], ['aa']);
  rx('a{2,}', ['a', 'aa', 'aaa'], ['aa', 'aaa']);
  rx('a{1,2}', ['', 'a', 'aa', 'aaa'], ['a', 'aa']);
  rx('a{0}', ['', 'a'], ['']);
  rx('a{02}', ['aa'], ['aa']);
  rx('(ab)*', ['', 'ab', 'abab', 'aba'], ['', 'ab', 'abab']);
  rx('[ab]+', ['abba', 'abc'], ['abba']);
  rx('a?b', ['b', 'ab', 'aab'], ['b', 'ab']);
  rx('a{,2}', ['a'], []);
  rx('a{2}{3}', ['aaaaaa'], []);
  rx('a+?', ['a'], []);
  rx('{2}', [''], []);
  rx('a{x}', ['a'], []);
  rx('a{2', ['aa'], []);
});

test('REQ-NP-001/002 normalized paths', () => {
  assert.deepEqual(paths('$[-3]', [0, 1, 2, 3, 4]), ['$[2]']);
  assert.deepEqual(paths('$.a.b[1:2]', { a: { b: [0, 1, 2] } }), ["$['a']['b'][1]"]);
  assert.deepEqual(paths('$["\\u000B"]', { '\u000b': 1 }), ["$['\\u000b']"]);
  assert.deepEqual(paths('$["\\u0061"]', { a: 1 }), ["$['a']"]);
  assert.deepEqual(paths('$[10]', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), ['$[10]']);
  assert.deepEqual(paths('$..x', { x: { x: 1 } }), ["$['x']", "$['x']['x']"]);
  const names: [string, string][] = [
    ["'", "\\'"], ['\\', '\\\\'], ['"', '"'], ['/', '/'], ['\b', '\\b'], ['\t', '\\t'], ['\n', '\\n'], ['\f', '\\f'],
    ['\r', '\\r'], ['\u0000', '\\u0000'], ['\u000b', '\\u000b'], ['\u001f', '\\u001f'], ['\u007f', '\u007f'],
    ['\u0085', '\u0085'], ['\u2028', '\u2028'], ['😀', '😀'], ["a'b\\c", "a\\'b\\\\c"], ['é', 'é'],
  ];
  for (const [n, e] of names) assert.deepEqual(paths('$.*', { [n]: 1 }), [`$['${e}']`], JSON.stringify(n));
});

test('driver: protocol over stdin/stdout', () => {
  const input =
    '{"id":"a","op":"query","input":{"query":"$.a","document":{"a":1}}}\n\n  \n{bad\n' +
    '{"id":"b","op":"query","input":{"query":"$..*","document":[1]}}';
  const r = spawnSync('node', ['src/driver.ts'], { input, encoding: 'utf8' });
  assert.equal(r.status, 0);
  const lines = r.stdout.split('\n');
  assert.equal(lines.pop(), '');
  assert.deepEqual(lines.map((l) => JSON.parse(l)), [
    { id: 'a', result: { values: [1], paths: ["$['a']"] } },
    { id: null, error: 'bad_request' },
    { id: 'b', result: { values: [1], paths: ['$[0]'] } },
  ]);
  assert.ok(!r.stdout.includes('\r'));
});

test('REQ-BU-001..004 implementation folder', () => {
  const cfg = JSON.parse(readFileSync('REGEN.json', 'utf8'));
  assert.deepEqual(Object.keys(cfg).sort(), ['build', 'driver', 'lang', 'test']);
  assert.equal(cfg.lang, 'ts');
  assert.ok(!/ {2}/.test(cfg.driver));
  const pkg = readFileSync('package.json', 'utf8');
  assert.ok(!/"(dev|peer|optional)?[dD]ependencies"/.test(pkg));
  let lines = 0;
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      if (f === 'node_modules') assert.fail('node_modules present');
      const p = dir + '/' + f;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|mts|mjs|js)$/.test(f) && !/\.test\./.test(f)) {
        lines += readFileSync(p, 'utf8').split('\n').filter((l) => l.trim() !== '').length;
      }
    }
  };
  walk('src');
  assert.ok(lines <= 3000, `source lines: ${lines}`);
});
