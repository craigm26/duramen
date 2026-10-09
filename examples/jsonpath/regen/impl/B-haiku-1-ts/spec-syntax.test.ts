// Scenarios from SPEC.md R2-R12 (syntax and selectors) and R29 (normalized paths).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleLine } from './protocol.ts';

function run(query: string, doc: string): unknown {
  const line = `{"id":"t","op":"query","input":{"query":${JSON.stringify(query)},"document":${doc}}}`;
  return JSON.parse(handleLine(line));
}

function valid(query: string, doc: string, values: string, paths: string): void {
  assert.deepStrictEqual(
    run(query, doc),
    { id: 't', result: { values: JSON.parse(values), paths: JSON.parse(paths) } },
    `${query} on ${doc}`,
  );
}

function invalid(query: string, doc = '{}'): void {
  assert.deepStrictEqual(run(query, doc), { id: 't', error: 'invalid_query' }, query);
}

const LETTERS = '["a","b","c","d","e","f","g"]';
const ROOT_PATHS = (...ks: number[]): string => JSON.stringify(ks.map((k) => `$[${k}]`));

test('R2 characters and blank space', () => {
  invalid('');
  invalid(' $');
  invalid('$ ');
  valid('$ .a', '{"a":1}', '[1]', '["$[\'a\']"]');
  valid(String.raw`$ ['a'] ['b']`, '{"a":{"b":2}}', '[2]', String.raw`["$['a']['b']"]`);
  valid('$\n.a', '{"a":1}', '[1]', String.raw`["$['a']"]`);
  valid("$\t['a']", '{"a":1}', '[1]', String.raw`["$['a']"]`);
  invalid('$\f.a');
  invalid(String.raw`$['a'` + '\u00a0' + `]`);
  invalid('$. a');
  invalid('$.. a');
  valid('$ ..a', '{"a":1}', '[1]', String.raw`["$['a']"]`);
  valid(String.raw`$[ 'a' , 'b' ]`, '{"a":1,"b":2}', '[1,2]', String.raw`["$['a']","$['b']"]`);
  invalid('$[\'\uD800\']');
  valid(String.raw`$['\ud83d\ude00']`, '{"😀":1}', '[1]', String.raw`["$['😀']"]`);
  valid("$['😀']", '{"😀":1}', '[1]', String.raw`["$['😀']"]`);
  invalid('$[\'a\tb\']');
  invalid('$[\'a\nb\']');
});

test('R3 root identifier and query structure', () => {
  valid('$', '{"k":"v"}', '[{"k":"v"}]', '["$"]');
  valid('$', '42', '[42]', '["$"]');
  invalid('@');
  invalid('@.a');
  invalid('a');
  invalid('$$');
  invalid('$a');
  valid('$.a[*].b', '{"a":[{"b":0},{"b":1},{"c":2}]}', '[0,1]', String.raw`["$['a'][0]['b']","$['a'][1]['b']"]`);
  valid('$[*][*]', '[[1,2],[3],4]', '[1,2,3]', '["$[0][0]","$[0][1]","$[1][0]"]');
  valid('$[0,0][0]', '[[7]]', '[7,7]', '["$[0][0]","$[0][0]"]');
  valid('$.x[0]', '{"y":[1]}', '[]', '[]');
});

test('R4 child segments', () => {
  valid(String.raw`$['a','b']`, '{"a":1,"b":2}', '[1,2]', String.raw`["$['a']","$['b']"]`);
  valid(String.raw`$['b','a','b']`, '{"a":1,"b":2}', '[2,1,2]', String.raw`["$['b']","$['a']","$['b']"]`);
  valid('$[0, 3]', LETTERS, '["a","d"]', '["$[0]","$[3]"]');
  valid('$[0:2, 5]', LETTERS, '["a","b","f"]', '["$[0]","$[1]","$[5]"]');
  valid('$[0, 0]', LETTERS, '["a","a"]', '["$[0]","$[0]"]');
  valid("$[0, 'a', 1:3, *]", '["x","y","z"]', '["x","y","z","x","y","z"]', '["$[0]","$[1]","$[2]","$[0]","$[1]","$[2]"]');
  valid('$[?@ > 1, 0]', '[1,2,3]', '[2,3,1]', '["$[1]","$[2]","$[0]"]');
  valid("$['a', 0]", '{"a":1}', '[1]', String.raw`["$['a']"]`);
  valid('$.*', '{"a":1,"b":[2]}', '[1,[2]]', String.raw`["$['a']","$['b']"]`);
  invalid('$[]');
  invalid("$['a',]");
  invalid("$[,'a']");
  invalid("$['a',,'b']");
  invalid("$['a'");
  invalid("$['a']]");
  invalid('$.');
  invalid("$.['a']");
  invalid('$.**');
  invalid('$[**]');
});

test('R5 member-name shorthand', () => {
  valid('$.a', '{"a":1}', '[1]', String.raw`["$['a']"]`);
  valid('$._foo1', '{"_foo1":"x"}', '["x"]', String.raw`["$['_foo1']"]`);
  valid('$.ü', '{"ü":1}', '[1]', String.raw`["$['ü']"]`);
  valid('$.日本', '{"日本":2}', '[2]', String.raw`["$['日本']"]`);
  valid('$.a😀', '{"a😀":3}', '[3]', String.raw`["$['a😀']"]`);
  valid('$.null', '{"null":1}', '[1]', String.raw`["$['null']"]`);
  valid('$.length', '{"length":5}', '[5]', String.raw`["$['length']"]`);
  valid('$.foo.bar', '{"foo.bar":1,"foo":{"bar":2}}', '[2]', String.raw`["$['foo']['bar']"]`);
  invalid('$.1');
  invalid('$.a-b');
  invalid('$.a b');
  invalid('$.$a');
  invalid("$.'a'");
  invalid(String.raw`$.\u0061`);
});

const D6 = '{"o":{"j":1,"k":2},"a":[5,3,[{"j":4},{"k":6}]]}';

test('R6 descendant segments', () => {
  valid('$..j', D6, '[1,4]', String.raw`["$['o']['j']","$['a'][2][0]['j']"]`);
  valid('$..[0]', D6, '[5,{"j":4}]', String.raw`["$['a'][0]","$['a'][2][0]"]`);
  const star = '[{"j":1,"k":2},[5,3,[{"j":4},{"k":6}]],1,2,5,3,[{"j":4},{"k":6}],{"j":4},{"k":6},4,6]';
  const starPaths = String.raw`["$['o']","$['a']","$['o']['j']","$['o']['k']","$['a'][0]","$['a'][1]","$['a'][2]","$['a'][2][0]","$['a'][2][1]","$['a'][2][0]['j']","$['a'][2][1]['k']"]`;
  valid('$..*', D6, star, starPaths);
  valid('$..[*]', D6, star, starPaths);
  valid('$..o', D6, '[{"j":1,"k":2}]', String.raw`["$['o']"]`);
  valid('$.o..[*, *]', D6, '[1,2,1,2]', String.raw`["$['o']['j']","$['o']['k']","$['o']['j']","$['o']['k']"]`);
  valid('$.a..[0, 1]', D6, '[5,3,{"j":4},{"k":6}]', String.raw`["$['a'][0]","$['a'][1]","$['a'][2][0]","$['a'][2][1]"]`);
  valid("$..['j','k']", D6, '[1,2,4,6]', String.raw`["$['o']['j']","$['o']['k']","$['a'][2][0]['j']","$['a'][2][1]['k']"]`);
  valid('$..a', '{"a":{"a":1}}', '[{"a":1},1]', String.raw`["$['a']","$['a']['a']"]`);
  valid('$..[?@ > 1]', '{"x":[1,2,{"y":3}],"z":5}', '[5,2,3]', String.raw`["$['z']","$['x'][1]","$['x'][2]['y']"]`);
  valid('$..*', '5', '[]', '[]');
  valid('$..*', '[]', '[]', '[]');
  invalid('$..');
  invalid('$...a');
  invalid('$..1');
  valid('$..[1]', '[[0,1],2]', '[2,1]', '["$[1]","$[0][1]"]');
});

test('R7 string literals', () => {
  valid('$["a"]', '{"a":1}', '[1]', String.raw`["$['a']"]`);
  valid(String.raw`$['\u0061']`, '{"a":1}', '[1]', String.raw`["$['a']"]`);
  valid(String.raw`$["\u00E9"]`, '{"é":1}', '[1]', String.raw`["$['é']"]`);
  valid(String.raw`$["\u00e9"]`, '{"é":1}', '[1]', String.raw`["$['é']"]`);
  valid(String.raw`$["\uD83D\uDE00"]`, '{"😀":1}', '[1]', String.raw`["$['😀']"]`);
  valid(String.raw`$['\ud83d\ude00']`, '{"😀":1}', '[1]', String.raw`["$['😀']"]`);
  valid(String.raw`$['\t']`, String.raw`{"\t":1}`, '[1]', String.raw`["$['\\t']"]`);
  valid(String.raw`$['a\/b']`, '{"a/b":1}', '[1]', String.raw`["$['a/b']"]`);
  valid(String.raw`$['a\\b']`, String.raw`{"a\\b":1}`, '[1]', String.raw`["$['a\\\\b']"]`);
  valid(String.raw`$["a'b"]`, "{\"a'b\":1}", '[1]', String.raw`["$['a\\'b']"]`);
  valid(String.raw`$['a\'b']`, "{\"a'b\":1}", '[1]', String.raw`["$['a\\'b']"]`);
  valid(String.raw`$['a"b']`, String.raw`{"a\"b":1}`, '[1]', String.raw`["$['a\"b']"]`);
  valid(String.raw`$["a\"b"]`, String.raw`{"a\"b":1}`, '[1]', String.raw`["$['a\"b']"]`);
  valid("$['']", '{"":1}', '[1]', String.raw`["$['']"]`);
  invalid(String.raw`$["\'"]`);
  invalid(String.raw`$['\"']`);
  invalid(String.raw`$['\a']`);
  invalid(String.raw`$['\U0061']`);
  invalid(String.raw`$['\u006']`);
  invalid(String.raw`$['\uD800']`);
  invalid(String.raw`$['\uDC00']`);
  invalid(String.raw`$['\uD800\u0041']`);
  invalid(String.raw`$['\uD800x']`);
  invalid("$['a\tb']");
  invalid("$['a\nb']");
  invalid("$['abc");
  invalid("$['a''b']");
  invalid('$[a]');
  invalid("$['\uD800']");
});

test('R8 name selector', () => {
  const D8 = String.raw`{"o":{"j j":{"k.k":3}},"'":{"@":2}}`;
  valid("$.o['j j']", D8, '[{"k.k":3}]', String.raw`["$['o']['j j']"]`);
  valid("$.o['j j']['k.k']", D8, '[3]', String.raw`["$['o']['j j']['k.k']"]`);
  valid('$.o["j j"]["k.k"]', D8, '[3]', String.raw`["$['o']['j j']['k.k']"]`);
  valid(`$["'"]["@"]`, D8, '[2]', String.raw`["$['\\'']['@']"]`);
  valid("$['O']", D8, '[]', '[]');
  valid("$['0']", '["x"]', '[]', '[]');
  valid("$['a']", '"a"', '[]', '[]');
  valid('$[\'é\']', String.raw`{"e\u0301":1}`, '[]', '[]');
});

const D9 = '{"o":{"j":1,"k":2},"a":[5,3]}';

test('R9 wildcard selector', () => {
  valid('$[*]', D9, '[{"j":1,"k":2},[5,3]]', String.raw`["$['o']","$['a']"]`);
  valid('$.o[*]', D9, '[1,2]', String.raw`["$['o']['j']","$['o']['k']"]`);
  valid('$.o[*, *]', D9, '[1,2,1,2]', String.raw`["$['o']['j']","$['o']['k']","$['o']['j']","$['o']['k']"]`);
  valid('$.a[*]', D9, '[5,3]', String.raw`["$['a'][0]","$['a'][1]"]`);
  valid('$.a.*', D9, '[5,3]', String.raw`["$['a'][0]","$['a'][1]"]`);
  valid('$[*]', '"abc"', '[]', '[]');
  valid('$[*]', '{}', '[]', '[]');
  valid('$[*]', '[]', '[]', '[]');
});

const AB = '["a","b"]';

test('R10 index selector', () => {
  valid('$[1]', AB, '["b"]', '["$[1]"]');
  valid('$[0]', AB, '["a"]', '["$[0]"]');
  valid('$[-2]', AB, '["a"]', '["$[0]"]');
  valid('$[-1]', AB, '["b"]', '["$[1]"]');
  valid('$[2]', AB, '[]', '[]');
  valid('$[-3]', AB, '[]', '[]');
  valid('$[ 1 ]', AB, '["b"]', '["$[1]"]');
  valid('$[0]', '{"0":1}', '[]', '[]');
  valid('$[0]', '"abc"', '[]', '[]');
  valid('$[9007199254740991]', AB, '[]', '[]');
  valid('$[-9007199254740991]', AB, '[]', '[]');
  invalid('$[01]');
  invalid('$[-0]');
  invalid('$[+1]');
  invalid('$[1.0]');
  invalid('$[1e2]');
  invalid('$[- 1]');
  invalid('$[0x1]');
  invalid('$.0');
});

test('R11 array slice selector', () => {
  valid('$[1:3]', LETTERS, '["b","c"]', '["$[1]","$[2]"]');
  valid('$[5:]', LETTERS, '["f","g"]', '["$[5]","$[6]"]');
  valid('$[1:5:2]', LETTERS, '["b","d"]', '["$[1]","$[3]"]');
  valid('$[5:1:-2]', LETTERS, '["f","d"]', '["$[5]","$[3]"]');
  valid('$[::-1]', LETTERS, '["g","f","e","d","c","b","a"]', ROOT_PATHS(6, 5, 4, 3, 2, 1, 0));
  valid('$[:]', LETTERS, LETTERS, ROOT_PATHS(0, 1, 2, 3, 4, 5, 6));
  valid('$[::]', LETTERS, LETTERS, ROOT_PATHS(0, 1, 2, 3, 4, 5, 6));
  valid('$[1:2:]', LETTERS, '["b"]', '["$[1]"]');
  valid('$[::2]', LETTERS, '["a","c","e","g"]', ROOT_PATHS(0, 2, 4, 6));
  valid('$[-2:]', LETTERS, '["f","g"]', '["$[5]","$[6]"]');
  valid('$[:-2]', LETTERS, '["a","b","c","d","e"]', ROOT_PATHS(0, 1, 2, 3, 4));
  valid('$[-1:-3:-1]', LETTERS, '["g","f"]', '["$[6]","$[5]"]');
  valid('$[3::-1]', LETTERS, '["d","c","b","a"]', ROOT_PATHS(3, 2, 1, 0));
  valid('$[:2:-1]', LETTERS, '["g","f","e","d"]', ROOT_PATHS(6, 5, 4, 3));
  valid('$[2:-10:-1]', LETTERS, '["c","b","a"]', ROOT_PATHS(2, 1, 0));
  valid('$[-10:2]', LETTERS, '["a","b"]', ROOT_PATHS(0, 1));
  valid('$[0:0]', LETTERS, '[]', '[]');
  valid('$[3:1]', LETTERS, '[]', '[]');
  valid('$[::0]', LETTERS, '[]', '[]');
  valid('$[10:20]', LETTERS, '[]', '[]');
  valid('$[1 : 2 : 1]', LETTERS, '["b"]', '["$[1]"]');
  valid('$[::9007199254740991]', LETTERS, '["a"]', '["$[0]"]');
  valid('$[::-9007199254740991]', LETTERS, '["g"]', '["$[6]"]');
  valid('$[-9007199254740991:9007199254740991]', LETTERS, LETTERS, ROOT_PATHS(0, 1, 2, 3, 4, 5, 6));
  valid('$[1:3]', '{"a":1}', '[]', '[]');
  valid('$[1:3]', '"abcdef"', '[]', '[]');
  invalid('$[1:2:3:4]');
  invalid('$[:-0]');
  invalid('$[01:2]');
  invalid('$[1:2:0.5]');
});

test('R12 integer range', () => {
  invalid('$[9007199254740992]');
  invalid('$[-9007199254740992]');
  invalid('$[0:9007199254740992]');
  invalid('$[-9007199254740992:]');
  invalid('$[::-9007199254740992]');
  invalid('$[99999999999999999999999]');
  invalid('$[?@[9007199254740992]]');
  valid('$[?@ == 9007199254740992]', '[1]', '[]', '[]');
});

test('R29 normalized paths and R31 values in results', () => {
  valid('$[1]', '[0,1]', '[1]', '["$[1]"]');
  valid('$[-3]', '[0,1,2,3,4]', '[2]', '["$[2]"]');
  valid('$.a.b[1:2]', '{"a":{"b":[0,1,2]}}', '[1]', String.raw`["$['a']['b'][1]"]`);
  valid(String.raw`$["\u000B"]`, String.raw`{"\u000b":1}`, '[1]', String.raw`["$['\\u000b']"]`);
  valid(String.raw`$["\u0061"]`, '{"a":1}', '[1]', String.raw`["$['a']"]`);
  const twelve = JSON.stringify(Array.from({ length: 13 }, (_, k) => k));
  valid('$[12]', twelve, '[12]', '["$[12]"]');
  valid(
    '$.*',
    String.raw`{"\b":1,"\f":2,"\n":3,"\r":4,"\t":5,"'":6,"\\":7,"\u0000":8,"\u001f":9,"\"":10,"/":11,"\u007f":12,"é":13,"\u000b":14,"\u000e":15}`,
    '[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]',
    String.raw`["$['\\b']","$['\\f']","$['\\n']","$['\\r']","$['\\t']","$['\\'']","$['\\\\']","$['\\u0000']","$['\\u001f']","$['\"']","$['/']","$['\u007f']","$['é']","$['\\u000b']","$['\\u000e']"]`,
  );
  valid('$..*', '{"a b":[{"c":1}]}', '[[{"c":1}],{"c":1},1]', String.raw`["$['a b']","$['a b'][0]","$['a b'][0]['c']"]`);
});
