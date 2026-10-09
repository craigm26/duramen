// Scenarios for SPEC R2-R12: blank space, root and segments, shorthand names, string literals,
// name, wildcard, index, slice and integer range.

import { test } from 'node:test';
import { assertInvalid, assertResult, r } from './helpers.ts';

test('R2.1 a lone surrogate in the query is invalid_query', () => {
  assertInvalid("$['\uD800']", '{"\\ud800":1}');
});

test('R2.1 a paired surrogate is one character', () => {
  assertResult("$['\x5cuD83D\x5cuDE00']", '{"\u{1F600}":1}', '[1]', r`["$['😀']"]`);
});

test('R2.2-3 blank space is accepted only where the grammar allows it', () => {
  assertInvalid('');
  assertInvalid(' $');
  assertInvalid('$ ');
  assertInvalid('$\f.a');
  assertInvalid("$['a' ]");
  assertInvalid('$. a');
  assertInvalid('$.. a');
  assertInvalid('$ ..b x');
  assertResult('$ .a', '{"a":1}', '[1]', r`["$['a']"]`);
  assertResult("$ ['a'] ['b']", '{"a":{"b":2}}', '[2]', r`["$['a']['b']"]`);
  assertResult('$\n.a', '{"a":1}', '[1]', r`["$['a']"]`);
  assertResult("$\t['a']", '{"a":1}', '[1]', r`["$['a']"]`);
  assertResult('$ ..a', '{"a":1}', '[1]', r`["$['a']"]`);
  assertResult("$[ 'a' , 'b' ]", '{"a":1,"b":2}', '[1,2]', r`["$['a']","$['b']"]`);
});

test('R3 the root identifier and query structure', () => {
  assertResult('$', '{"k":"v"}', r`[{"k":"v"}]`, r`["$"]`);
  assertResult('$', '42', '[42]', r`["$"]`);
  for (const q of ['@', '@.a', 'a', '$$', '$a']) assertInvalid(q);
  assertResult('$.a[*].b', '{"a":[{"b":0},{"b":1},{"c":2}]}', '[0,1]', r`["$['a'][0]['b']","$['a'][1]['b']"]`);
  assertResult('$[*][*]', '[[1,2],[3],4]', '[1,2,3]', r`["$[0][0]","$[0][1]","$[1][0]"]`);
  assertResult('$[0,0][0]', '[[7]]', '[7,7]', r`["$[0][0]","$[0][0]"]`);
  assertResult('$.x[0]', '{"y":[1]}', '[]', '[]');
  assertResult('$.a.b.c', '[1,2]', '[]', '[]');
});

test('R4 child segments and bracketed selections', () => {
  const letters = '["a","b","c","d","e","f","g"]';
  assertResult("$['a','b']", '{"a":1,"b":2}', '[1,2]', r`["$['a']","$['b']"]`);
  assertResult("$['b','a','b']", '{"a":1,"b":2}', '[2,1,2]', r`["$['b']","$['a']","$['b']"]`);
  assertResult('$[0, 3]', letters, '["a","d"]', r`["$[0]","$[3]"]`);
  assertResult('$[0:2, 5]', letters, '["a","b","f"]', r`["$[0]","$[1]","$[5]"]`);
  assertResult('$[0, 0]', letters, '["a","a"]', r`["$[0]","$[0]"]`);
  assertResult("$[0, 'a', 1:3, *]", '["x","y","z"]', '["x","y","z","x","y","z"]', r`["$[0]","$[1]","$[2]","$[0]","$[1]","$[2]"]`);
  assertResult('$[?@ > 1, 0]', '[1,2,3]', '[2,3,1]', r`["$[1]","$[2]","$[0]"]`);
  assertResult("$['a', 0]", '{"a":1}', '[1]', r`["$['a']"]`);
  assertResult('$.*', '{"a":1,"b":[2]}', '[1,[2]]', r`["$['a']","$['b']"]`);
  for (const q of ['$[]', "$['a',]", "$[,'a']", "$['a',,'b']", "$['a'", "$['a']]", '$.', '$.[\'a\']', '$.**', '$[**]']) {
    assertInvalid(q);
  }
});

test('R5 member-name shorthand', () => {
  assertResult('$.a', '{"a":1}', '[1]', r`["$['a']"]`);
  assertResult('$._foo1', '{"_foo1":"x"}', '["x"]', r`["$['_foo1']"]`);
  assertResult('$.ü', '{"ü":1}', '[1]', r`["$['ü']"]`);
  assertResult('$.日本', '{"日本":2}', '[2]', r`["$['日本']"]`);
  assertResult('$.a😀', '{"a😀":3}', '[3]', r`["$['a😀']"]`);
  assertResult('$.null', '{"null":1}', '[1]', r`["$['null']"]`);
  assertResult('$.length', '{"length":5}', '[5]', r`["$['length']"]`);
  assertResult('$.foo.bar', '{"foo.bar":1,"foo":{"bar":2}}', '[2]', r`["$['foo']['bar']"]`);
  for (const q of ['$.1', '$.a-b', '$.a b', '$.$a', "$.'a'", '$.\x5cu0061']) assertInvalid(q);
});

test('R6 descendant segments', () => {
  const doc = r`{"o":{"j":1,"k":2},"a":[5,3,[{"j":4},{"k":6}]]}`;
  assertResult('$..j', doc, '[1,4]', r`["$['o']['j']","$['a'][2][0]['j']"]`);
  assertResult('$..[0]', doc, '[5,{"j":4}]', r`["$['a'][0]","$['a'][2][0]"]`);
  assertResult('$..*', doc, r`[{"j":1,"k":2},[5,3,[{"j":4},{"k":6}]],1,2,5,3,[{"j":4},{"k":6}],{"j":4},{"k":6},4,6]`,
    r`["$['o']","$['a']","$['o']['j']","$['o']['k']","$['a'][0]","$['a'][1]","$['a'][2]","$['a'][2][0]","$['a'][2][1]","$['a'][2][0]['j']","$['a'][2][1]['k']"]`);
  assertResult('$..[*]', doc, r`[{"j":1,"k":2},[5,3,[{"j":4},{"k":6}]],1,2,5,3,[{"j":4},{"k":6}],{"j":4},{"k":6},4,6]`,
    r`["$['o']","$['a']","$['o']['j']","$['o']['k']","$['a'][0]","$['a'][1]","$['a'][2]","$['a'][2][0]","$['a'][2][1]","$['a'][2][0]['j']","$['a'][2][1]['k']"]`);
  assertResult('$..o', doc, '[{"j":1,"k":2}]', r`["$['o']"]`);
  assertResult('$.o..[*, *]', doc, '[1,2,1,2]', r`["$['o']['j']","$['o']['k']","$['o']['j']","$['o']['k']"]`);
  assertResult('$.a..[0, 1]', doc, '[5,3,{"j":4},{"k":6}]', r`["$['a'][0]","$['a'][1]","$['a'][2][0]","$['a'][2][1]"]`);
  assertResult("$..['j','k']", doc, '[1,2,4,6]', r`["$['o']['j']","$['o']['k']","$['a'][2][0]['j']","$['a'][2][1]['k']"]`);
  assertResult('$..a', '{"a":{"a":1}}', '[{"a":1},1]', r`["$['a']","$['a']['a']"]`);
  assertResult('$..[?@ > 1]', '{"x":[1,2,{"y":3}],"z":5}', '[5,2,3]', r`["$['z']","$['x'][1]","$['x'][2]['y']"]`);
  assertResult('$..*', '5', '[]', '[]');
  assertResult('$..*', '[]', '[]', '[]');
  assertResult('$..[1]', '[[0,1],2]', '[2,1]', r`["$[1]","$[0][1]"]`);
  for (const q of ['$..', '$...a', '$..1']) assertInvalid(q);
});

test('R7 string literals', () => {
  assertResult('$["a"]', '{"a":1}', '[1]', r`["$['a']"]`);
  assertResult("$['\x5cu0061']", '{"a":1}', '[1]', r`["$['a']"]`);
  assertResult('$["\x5cu00E9"]', '{"é":1}', '[1]', r`["$['é']"]`);
  assertResult('$["\x5cuD83D\x5cuDE00"]', '{"😀":1}', '[1]', r`["$['😀']"]`);
  assertResult(r`$['\t']`, '{"\\t":1}', '[1]', r`["$['\\t']"]`);
  assertResult(r`$['a\/b']`, '{"a/b":1}', '[1]', r`["$['a/b']"]`);
  assertResult(r`$['a\\b']`, '{"a\\\\b":1}', '[1]', r`["$['a\\\\b']"]`);
  assertResult(r`$["a'b"]`, "{\"a'b\":1}", '[1]', r`["$['a\\'b']"]`);
  assertResult(r`$['a\'b']`, "{\"a'b\":1}", '[1]', r`["$['a\\'b']"]`);
  assertResult(r`$['a"b']`, '{"a\\"b":1}', '[1]', r`["$['a\"b']"]`);
  assertResult(r`$["a\"b"]`, '{"a\\"b":1}', '[1]', r`["$['a\"b']"]`);
  assertResult("$['']", '{"":1}', '[1]', r`["$['']"]`);
  for (const q of [r`$["\'"]`, r`$['\"']`, r`$['\a']`, r`$['\U0061']`, r`$['\u006']`, r`$['\uD800']`,
    r`$['\uDC00']`, "$['\x5cuD800\x5cu0041']", r`$['\uD800x']`, "$['a\tb']", "$['a\nb']", "$['abc", "$['a''b']", '$[a]']) {
    assertInvalid(q);
  }
});

test('R8 name selector', () => {
  const doc = r`{"o":{"j j":{"k.k":3}},"'":{"@":2}}`;
  assertResult('$.o[\'j j\']', doc, '[{"k.k":3}]', r`["$['o']['j j']"]`);
  assertResult("$.o['j j']['k.k']", doc, '[3]', r`["$['o']['j j']['k.k']"]`);
  assertResult('$.o["j j"]["k.k"]', doc, '[3]', r`["$['o']['j j']['k.k']"]`);
  assertResult(r`$["'"]["@"]`, doc, '[2]', r`["$['\\'']['@']"]`);
  assertResult("$['O']", doc, '[]', '[]');
  assertResult("$['0']", '["x"]', '[]', '[]');
  assertResult("$['a']", '"a"', '[]', '[]');
  assertResult("$['é']", '{"e\\u0301":1}', '[]', '[]');
});

test('R9 wildcard selector', () => {
  const doc = '{"o":{"j":1,"k":2},"a":[5,3]}';
  assertResult('$[*]', doc, '[{"j":1,"k":2},[5,3]]', r`["$['o']","$['a']"]`);
  assertResult('$.o[*]', doc, '[1,2]', r`["$['o']['j']","$['o']['k']"]`);
  assertResult('$.o[*, *]', doc, '[1,2,1,2]', r`["$['o']['j']","$['o']['k']","$['o']['j']","$['o']['k']"]`);
  assertResult('$.a[*]', doc, '[5,3]', r`["$['a'][0]","$['a'][1]"]`);
  assertResult('$.a.*', doc, '[5,3]', r`["$['a'][0]","$['a'][1]"]`);
  assertResult('$[*]', '"abc"', '[]', '[]');
  assertResult('$[*]', '{}', '[]', '[]');
  assertResult('$[*]', '[]', '[]', '[]');
});

test('R10 index selector', () => {
  const doc = '["a","b"]';
  assertResult('$[1]', doc, '["b"]', r`["$[1]"]`);
  assertResult('$[0]', doc, '["a"]', r`["$[0]"]`);
  assertResult('$[-2]', doc, '["a"]', r`["$[0]"]`);
  assertResult('$[-1]', doc, '["b"]', r`["$[1]"]`);
  assertResult('$[2]', doc, '[]', '[]');
  assertResult('$[-3]', doc, '[]', '[]');
  assertResult('$[ 1 ]', doc, '["b"]', r`["$[1]"]`);
  assertResult('$[0]', '{"0":1}', '[]', '[]');
  assertResult('$[0]', '"abc"', '[]', '[]');
  assertResult('$[9007199254740991]', doc, '[]', '[]');
  assertResult('$[-9007199254740991]', doc, '[]', '[]');
  for (const q of ['$[01]', '$[-0]', '$[+1]', '$[1.0]', '$[1e2]', '$[- 1]', '$[0x1]', '$.0']) assertInvalid(q);
});

test('R11 array slice selector', () => {
  const doc = '["a","b","c","d","e","f","g"]';
  assertResult('$[1:3]', doc, '["b","c"]', r`["$[1]","$[2]"]`);
  assertResult('$[5:]', doc, '["f","g"]', r`["$[5]","$[6]"]`);
  assertResult('$[1:5:2]', doc, '["b","d"]', r`["$[1]","$[3]"]`);
  assertResult('$[5:1:-2]', doc, '["f","d"]', r`["$[5]","$[3]"]`);
  assertResult('$[::-1]', doc, '["g","f","e","d","c","b","a"]', r`["$[6]","$[5]","$[4]","$[3]","$[2]","$[1]","$[0]"]`);
  assertResult('$[:]', doc, doc, r`["$[0]","$[1]","$[2]","$[3]","$[4]","$[5]","$[6]"]`);
  assertResult('$[::]', doc, doc, r`["$[0]","$[1]","$[2]","$[3]","$[4]","$[5]","$[6]"]`);
  assertResult('$[1:2:]', doc, '["b"]', r`["$[1]"]`);
  assertResult('$[::2]', doc, '["a","c","e","g"]', r`["$[0]","$[2]","$[4]","$[6]"]`);
  assertResult('$[-2:]', doc, '["f","g"]', r`["$[5]","$[6]"]`);
  assertResult('$[:-2]', doc, '["a","b","c","d","e"]', r`["$[0]","$[1]","$[2]","$[3]","$[4]"]`);
  assertResult('$[-1:-3:-1]', doc, '["g","f"]', r`["$[6]","$[5]"]`);
  assertResult('$[3::-1]', doc, '["d","c","b","a"]', r`["$[3]","$[2]","$[1]","$[0]"]`);
  assertResult('$[:2:-1]', doc, '["g","f","e","d"]', r`["$[6]","$[5]","$[4]","$[3]"]`);
  assertResult('$[2:-10:-1]', doc, '["c","b","a"]', r`["$[2]","$[1]","$[0]"]`);
  assertResult('$[-10:2]', doc, '["a","b"]', r`["$[0]","$[1]"]`);
  assertResult('$[0:0]', doc, '[]', '[]');
  assertResult('$[3:1]', doc, '[]', '[]');
  assertResult('$[::0]', doc, '[]', '[]');
  assertResult('$[10:20]', doc, '[]', '[]');
  assertResult('$[1 : 2 : 1]', doc, '["b"]', r`["$[1]"]`);
  assertResult('$[::9007199254740991]', doc, '["a"]', r`["$[0]"]`);
  assertResult('$[::-9007199254740991]', doc, '["g"]', r`["$[6]"]`);
  assertResult('$[-9007199254740991:9007199254740991]', doc, doc, r`["$[0]","$[1]","$[2]","$[3]","$[4]","$[5]","$[6]"]`);
  assertResult('$[1:3]', '{"a":1}', '[]', '[]');
  assertResult('$[1:3]', '"abcdef"', '[]', '[]');
  for (const q of ['$[1:2:3:4]', '$[:-0]', '$[01:2]', '$[1:2:0.5]']) assertInvalid(q);
});

test('R12 integer range', () => {
  for (const q of ['$[9007199254740992]', '$[-9007199254740992]', '$[0:9007199254740992]', '$[-9007199254740992:]',
    '$[::-9007199254740992]', '$[99999999999999999999999]', '$[?@[9007199254740992]]']) {
    assertInvalid(q);
  }
  assertResult('$[?@ == 9007199254740992]', '[1]', '[]', '[]');
});

test('R10.2 and R29: an index that selects a node reports a non-negative path', () => {
  assertResult('$[-3]', '[0,1,2,3,4]', '[2]', r`["$[2]"]`);
  assertResult('$[12]', '[0,1,2,3,4,5,6,7,8,9,10,11,12]', '[12]', r`["$[12]"]`);
});

