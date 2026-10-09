// Scenarios for SPEC R13-R26: filter syntax and semantics, existence tests, literals, singular
// queries, comparisons, logical operators, and the function extensions.

import { test } from 'node:test';
import { assertInvalid, assertResult, r } from './helpers.ts';

const D13 = '[{"a":1,"b":2},{"a":2},{"b":3}]';

test('R13 filter syntax', () => {
  assertResult('$[?@.a]', D13, '[{"a":1,"b":2},{"a":2}]', '["$[0]","$[1]"]');
  assertResult('$[? @.a ]', D13, '[{"a":1,"b":2},{"a":2}]', '["$[0]","$[1]"]');
  assertResult('$[?(@.a)]', D13, '[{"a":1,"b":2},{"a":2}]', '["$[0]","$[1]"]');
  assertResult('$[?((@.a))]', D13, '[{"a":1,"b":2},{"a":2}]', '["$[0]","$[1]"]');
  assertResult('$[?@.a==1]', D13, '[{"a":1,"b":2}]', '["$[0]"]');
  assertResult('$[?@.a   ==   1]', D13, '[{"a":1,"b":2}]', '["$[0]"]');
  assertResult('$[?1 == @.a]', D13, '[{"a":1,"b":2}]', '["$[0]"]');
  assertResult('$[?!@.a]', D13, '[{"b":3}]', '["$[2]"]');
  assertResult('$[?! @.a]', D13, '[{"b":3}]', '["$[2]"]');
  assertResult('$[?!(@.a == 1)]', D13, '[{"a":2},{"b":3}]', '["$[1]","$[2]"]');
  assertResult('$[?!(!@.a)]', D13, '[{"a":1,"b":2},{"a":2}]', '["$[0]","$[1]"]');
  assertResult('$[?@.a&&@.b]', D13, '[{"a":1,"b":2}]', '["$[0]"]');
  assertResult('$[?@.a == 2 || @.b == 3]', D13, '[{"a":2},{"b":3}]', '["$[1]","$[2]"]');
  assertResult('$[?@.a\n==\n1]', D13, '[{"a":1,"b":2}]', '["$[0]"]');
  assertResult('$[?@.a].b', D13, '[2]', `["$[0]['b']"]`);
  for (const q of ['$[?]', '$[@.a]', '$[?@.a ==]', '$[?== 1]', '$[?@.a = 1]', '$[?@.a === 1]', '$[?@.a <> 1]',
    '$[?@.a =< 1]', '$[?@.a = = 1]', '$[?@.a == 1 == 1]', '$[?!!@.a]', '$[?!@.a == 1]', '$[?(@.a) == 1]',
    '$[?@.a & @.b]', '$[?@.a | @.b]', '$[?@.a and @.b]', '$[?(@.a]', '$[?@.a)]', '$[?()]', '$[?true]',
    '$[?false]', '$[?null]', '$[?1]', "$[?'a']", '$[?@ == [1]]', '$[?@ == {}]', '$[?@.a + 1 == 2]',
    '$[?@.a == True]']) {
    assertInvalid(q, D13);
  }
});

const D14 = r`{"a":[3,5,1,2,4,6,{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}],"o":{"p":1,"q":2,"r":3,"s":5,"t":{"u":6}},"e":"f"}`;
const A14 = r`[3,5,1,2,4,6,{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}]`;
const A14_PATHS = Array.from({ length: 10 }, (_, i) => `"$['a'][${i}]"`).join(',');

test('R14 filter semantics', () => {
  assertResult(`$.a[?@.b == 'kilo']`, D14, '[{"b":"kilo"}]', `["$['a'][9]"]`);
  assertResult(`$.a[?(@.b == 'kilo')]`, D14, '[{"b":"kilo"}]', `["$['a'][9]"]`);
  assertResult('$.a[?@>3.5]', D14, '[5,4,6]', `["$['a'][1]","$['a'][4]","$['a'][5]"]`);
  assertResult('$.a[?@.b]', D14, '[{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}]', `["$['a'][6]","$['a'][7]","$['a'][8]","$['a'][9]"]`);
  assertResult('$[?@.*]', D14, `[${A14},${r`{"p":1,"q":2,"r":3,"s":5,"t":{"u":6}}`}]`, `["$['a']","$['o']"]`);
  assertResult('$[?@[?@.b]]', D14, `[${A14}]`, `["$['a']"]`);
  assertResult('$.o[?@<3, ?@<3]', D14, '[1,2,1,2]', `["$['o']['p']","$['o']['q']","$['o']['p']","$['o']['q']"]`);
  assertResult('$.a[?@<2 || @.b == "k"]', D14, '[1,{"b":"k"}]', `["$['a'][2]","$['a'][7]"]`);
  assertResult('$.a[?match(@.b, "[jk]")]', D14, '[{"b":"j"},{"b":"k"}]', `["$['a'][6]","$['a'][7]"]`);
  assertResult('$.a[?search(@.b, "[jk]")]', D14, '[{"b":"j"},{"b":"k"},{"b":"kilo"}]', `["$['a'][6]","$['a'][7]","$['a'][9]"]`);
  assertResult('$.o[?@>1 && @<4]', D14, '[2,3]', `["$['o']['q']","$['o']['r']"]`);
  assertResult('$.o[?@.u || @.x]', D14, '[{"u":6}]', `["$['o']['t']"]`);
  assertResult('$.a[?@.b == $.x]', D14, '[3,5,1,2,4,6]', `[${A14_PATHS.split(',').slice(0, 6).join(',')}]`);
  assertResult('$.a[?@ == @]', D14, A14, `[${A14_PATHS}]`);
  assertResult('$[?@ == 1]', '1', '[]', '[]');
  assertResult('$[?@ > 1]', '{"x":1,"y":2,"z":3}', '[2,3]', r`["$['y']","$['z']"]`);
  assertResult('$.a[?@ == $.n]', '{"a":[1,2,3],"n":2}', '[2]', r`["$['a'][1]"]`);
  assertResult('$[?$.flag]', '{"flag":false,"v":1}', '[false,1]', r`["$['flag']","$['v']"]`);
  assertResult('$[?@[?@ > 2]]', '[[1,2],[3]]', '[[3]]', '["$[1]"]');
  assertResult('$[?@.a < @.b]', '[{"a":"x","b":1},{"a":[1],"b":[2]}]', '[]', '[]');
});

test('R15 existence tests', () => {
  assertResult('$[?@]', '[0,false,null,"",[],{}]', '[0,false,null,"",[],{}]', r`["$[0]","$[1]","$[2]","$[3]","$[4]","$[5]"]`);
  assertResult('$[?@.a]', '[{"a":false},{"a":null},{}]', '[{"a":false},{"a":null}]', r`["$[0]","$[1]"]`);
  assertResult('$[?!@.a]', '[{"a":false},{"a":null},{}]', '[{}]', '["$[2]"]');
  assertResult('$[?@..x]', '[{"y":{"x":1}},{"y":2}]', '[{"y":{"x":1}}]', '["$[0]"]');
  assertResult('$[?@[1:]]', '[[1],[1,2],"ab"]', '[[1,2]]', '["$[1]"]');
});

test('R16 literals', () => {
  assertResult('$[?@ == 1e2]', '[100,100.0,"100",1]', '[100,100.0]', r`["$[0]","$[1]"]`);
  assertResult('$[?@ == 1E+2]', '[100]', '[100]', '["$[0]"]');
  assertResult('$[?@ == 1.5e-1]', '[0.15,1.5]', '[0.15]', '["$[0]"]');
  assertResult('$[?@ < -0.5]', '[-1,-0.5,0]', '[-1]', '["$[0]"]');
  assertResult('$[?@ == -0]', '[0,-0,0.0,1]', '[0,-0,0.0]', r`["$[0]","$[1]","$[2]"]`);
  assertResult('$[?@ == -0.0]', '[0]', '[0]', '["$[0]"]');
  assertResult('$[?@ == "a"]', '["a","b"]', '["a"]', '["$[0]"]');
  assertResult(r`$[?@ == 'it\'s']`, `["it's"]`, `["it's"]`, '["$[0]"]');
  assertResult('$[?@ == true]', '[true,"true",1]', '[true]', '["$[0]"]');
  assertResult('$[?@ == false]', '[false,0,null]', '[false]', '["$[0]"]');
  assertResult('$[?@ == null]', '[null,0,false,""]', '[null]', '["$[0]"]');
  assertResult('$[?@ < 1e400]', '[1]', '[1]', '["$[0]"]');
  for (const q of ['$[?@ == 01]', '$[?@ == +1]', '$[?@ == .5]', '$[?@ == 1.]', '$[?@ == 1e]', '$[?@ == 1.5e+]',
    '$[?@ == - 1]', '$[?@ == NaN]', '$[?@ == Null]', '$[?@ == "abc]']) {
    assertInvalid(q);
  }
});

test('R17 singular queries and comparables', () => {
  assertResult('$[?@ == 2]', '[1,2]', '[2]', '["$[1]"]');
  assertResult('$[?@[0] == 2]', '[[2],[3],2]', '[[2]]', '["$[0]"]');
  assertResult('$[?@[-1] == 3]', '[[2,3],[3,2]]', '[[2,3]]', '["$[0]"]');
  assertResult("$[?@['a'] == 1]", '[{"a":1},{"a":2}]', '[{"a":1}]', '["$[0]"]');
  assertResult('$[?@.a.b == 1]', '[{"a":{"b":1}},{"a":1}]', '[{"a":{"b":1}}]', '["$[0]"]');
  assertResult('$[?@.a [0] == 1]', '[{"a":[1]}]', '[{"a":[1]}]', '["$[0]"]');
  assertResult('$[?@ == $]', '[1]', '[]', '[]');
  assertResult('$[?$.k == @]', '{"k":1,"m":1,"n":2}', '[1,1]', r`["$['k']","$['m']"]`);
  for (const q of ['$[?@.* == 1]', '$[?@..a == 1]', '$[?@[*] == 1]', '$[?@[0:1] == 1]', "$[?@['a','b'] == 1]",
    '$[?@[0,1] == 1]', '$[?@[?@ > 1] == 1]', '$[?$..a == 1]', "$[?@[ 'a' ] == 1]", '$[?@[ 0 ] == 1]']) {
    assertInvalid(q);
  }
  assertResult("$[?@[ 'a' ]]", '[{"a":1},{}]', '[{"a":1}]', '["$[0]"]');
});

const D18 = '{"obj":{"x":"y"},"arr":[2,3]}';
const ALL = ['[{"x":"y"},[2,3]]', `["$['obj']","$['arr']"]`];
const NONE = ['[]', '[]'];
const COMPARISONS: [string, boolean][] = [
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
  ['null >= null', true],
  ['null < null', false],
  ['false < true', false],
  ["'ab' < 'abc'", true],
  ["'' < 'a'", true],
  ["'b' < 'abc'", false],
  ["'B' < 'a'", true],
  ['$.arr[0] == 2', true],
  ['$.arr[0] == 2.0', true],
];

test('R18 comparison semantics', () => {
  for (const [expression, holds] of COMPARISONS) {
    const [values, paths] = holds ? ALL : NONE;
    assertResult(`$[?${expression}]`, D18, values, paths);
  }
  assertResult('$[?@ < \'b\']', '["a","b","c","",1,"B"]', '["a","","B"]', r`["$[0]","$[3]","$[5]"]`);
  assertResult("$[?@ > '\x5cuE000']", '["😀","a","\\uE000"]', '["😀"]', '["$[0]"]');
  assertResult('$[?@ >= 2]', '[1,2,3,"3",[3]]', '[2,3]', r`["$[1]","$[2]"]`);
  assertResult('$[?@ <= true]', '[false,true]', '[true]', '["$[1]"]');
  assertResult("$[?@ == '13']", '[13,"13"]', '["13"]', '["$[1]"]');
  assertResult('$[?@.x == @.y]',
    '[{"x":[1,{"a":2}],"y":[1,{"a":2}]},{"x":{"a":1,"b":2},"y":{"b":2,"a":1}},{"x":[1,2],"y":[2,1]},{"x":{"a":1},"y":{"a":1,"b":2}},{"x":1,"y":1.0},{"x":"1","y":1}]',
    '[{"x":[1,{"a":2}],"y":[1,{"a":2}]},{"x":{"a":1,"b":2},"y":{"b":2,"a":1}},{"x":1,"y":1.0}]',
    r`["$[0]","$[1]","$[4]"]`);
  assertResult('$[?@.x == @.y]', '[{}]', '[{}]', '["$[0]"]');
  assertResult('$[?@.x != @.y]', '[{}]', '[]', '[]');
  assertResult('$[?@.x < @.y]', '[{}]', '[]', '[]');
  assertResult('$[?@.x != 1]', '[{},{"x":1},{"x":2}]', '[{},{"x":2}]', '["$[0]","$[2]"]');
  assertResult('$[?@.x == null]', '[{},{"x":null}]', '[{"x":null}]', '["$[1]"]');
  assertResult('$[?@.x >= @.x]', '[{"x":{}},{"x":[]},{},{"x":null}]', '[{"x":{}},{"x":[]},{},{"x":null}]',
    r`["$[0]","$[1]","$[2]","$[3]"]`);
});

test('R19 logical operators', () => {
  const doc = '[{"a":1},{"b":1},{"b":1,"c":1}]';
  assertResult('$[?@.a || @.b && @.c]', doc, '[{"a":1},{"b":1,"c":1}]', '["$[0]","$[2]"]');
  assertResult('$[?(@.a || @.b) && @.c]', doc, '[{"b":1,"c":1}]', '["$[2]"]');
  assertResult('$[?@.c && @.b || @.a]', doc, '[{"a":1},{"b":1,"c":1}]', '["$[0]","$[2]"]');
  assertResult('$[?!(@.a || @.c)]', doc, '[{"b":1}]', '["$[1]"]');
  assertResult('$[?!@.a && !@.c]', doc, '[{"b":1}]', '["$[1]"]');
});

test('R20 function expression syntax and names', () => {
  assertResult('$[?length(@) == 1]', '["a","ab"]', '["a"]', '["$[0]"]');
  assertResult('$[?length( @ ) == 1]', '["a","ab"]', '["a"]', '["$[0]"]');
  for (const q of ['$[?length (@) == 1]', '$[?Length(@) == 1]', '$[?foo(@)]', '$[?bar(@.a) == 1]', '$[?_x(@)]',
    '$[?length() == 1]', '$[?length(@, @) == 1]', '$[?count() == 0]', '$[?match(@)]', "$[?search(@, 'a', 'b')]",
    '$[?value(@, @) == 1]', '$[?length(@ == 1]', '$.length(@)']) {
    assertInvalid(q);
  }
});

test('R21 type system and well-typedness', () => {
  assertResult('$[?length(@) < 3]', '["ab","abc",[1,2],{"a":1},5,null]', '["ab",[1,2],{"a":1}]', r`["$[0]","$[2]","$[3]"]`);
  assertResult('$[?count(@.*) == 1]', '[[1],[1,2],{"a":1},3]', '[[1],{"a":1}]', r`["$[0]","$[2]"]`);
  assertResult("$[?match(@.timezone, 'Europe/.*')]", '[{"timezone":"Europe/Paris"},{"timezone":"America/New_York"}]',
    '[{"timezone":"Europe/Paris"}]', '["$[0]"]');
  assertResult('$[?value(@..color) == "red"]', '[{"color":"red"}]', '[{"color":"red"}]', '["$[0]"]');
  assertResult("$[?!match(@, 'a')]", '["a","b",1]', '["b",1]', r`["$[1]","$[2]"]`);
  assertResult("$[?match(@, 'a') && length(@) == 1]", '["a","aa",1]', '["a"]', '["$[0]"]');
  assertResult('$[?length(value(@.*)) == 2]', '[["ab"],["ab","c"],[[1,2]]]', '[["ab"],[[1,2]]]', r`["$[0]","$[2]"]`);
  assertResult("$[?match(length(@), '1')]", '["a"]', '[]', '[]');
  assertResult("$[?length('ab') == 2]", '[7,8]', '[7,8]', r`["$[0]","$[1]"]`);
  assertResult('$[?count(@) == count($)]', '[1]', '[1]', '["$[0]"]');
  assertResult("$[?match('abc', 'a.c')]", '[1,2]', '[1,2]', r`["$[0]","$[1]"]`);
  for (const q of ['$[?length(@.*) < 3]', '$[?count(1) == 1]', "$[?count('a') == 1]", '$[?count(length(@)) == 1]',
    '$[?count(@.a == 1) == 1]', "$[?match(@.timezone, 'Europe/.*') == true]", '$[?value(@..color)]', '$[?length(@)]',
    '$[?count(@)]', '$[?!length(@)]', "$[?length(match(@, 'a')) == 1]", '$[?length(@.a == 1) == 1]',
    '$[?length((@.a)) == 1]', '$[?match(@.*, \'a\')]', '$[?match(@, @.*)]', '$[?count(value(@)) == 1]']) {
    assertInvalid(q);
  }
});

test('R22 length()', () => {
  assertResult('$[?length(@) == 3]', '["abc",[1,2,3],{"a":1,"b":2,"c":3},3,"ab",null]',
    '["abc",[1,2,3],{"a":1,"b":2,"c":3}]', r`["$[0]","$[1]","$[2]"]`);
  assertResult('$[?length(@) == 1]', '["😀","e\\u0301"]', '["😀"]', '["$[0]"]');
  assertResult('$[?length(@) == 0]', '["",[],{},0,null]', '["",[],{}]', r`["$[0]","$[1]","$[2]"]`);
  assertResult('$[?length(@) == length(@)]', '[1,"ab",[1]]', '[1,"ab",[1]]', r`["$[0]","$[1]","$[2]"]`);
  assertResult('$[?length(@.a) >= 2]', '[{"a":"xy"},{"a":"x"},{"b":"xyz"},{"a":[1,2,3]}]',
    '[{"a":"xy"},{"a":[1,2,3]}]', r`["$[0]","$[3]"]`);
  assertResult('$[?length(@) != 2]', '[true,"ab"]', '[true]', '["$[0]"]');
  assertResult('$[?length(1) == 1]', '[1]', '[]', '[]');
});

test('R23 count()', () => {
  assertResult('$[?count(@.*) == 2]', '[[1,2],{"a":1,"b":2},[1],"ab"]', '[[1,2],{"a":1,"b":2}]', r`["$[0]","$[1]"]`);
  assertResult('$[?count(@[0,0]) == 2]', '[[5],[]]', '[[5]]', '["$[0]"]');
  assertResult('$[?count(@) == 1]', '[1,null]', '[1,null]', r`["$[0]","$[1]"]`);
  assertResult('$[?count(@..*) > 2]', '[{"a":[1,2]},{"a":1}]', '[{"a":[1,2]}]', '["$[0]"]');
  assertResult('$[?count(@[?@ > 1]) == 2]', '[[1,2,3],[2],[0,5,6,7]]', '[[1,2,3]]', '["$[0]"]');
  assertResult('$[?count(@.a) == 0]', '[{"a":null},{}]', '[{}]', '["$[1]"]');
});

test('R24 match()', () => {
  assertResult("$[?match(@, 'a.c')]", '["abc","abcd","a\\nc","xabc",1]', '["abc"]', '["$[0]"]');
  assertResult("$[?match(@, '1')]", '[1,"1"]', '["1"]', '["$[1]"]');
  assertResult('$[?match(@.s, @.p)]', '[{"s":"aaa","p":"a+"},{"s":"b","p":"a+"},{"s":"a","p":1},{"s":"a","p":"("},{"s":"a"}]',
    '[{"s":"aaa","p":"a+"}]', '["$[0]"]');
  assertResult("$[?match(@, '(')]", '["("]', '[]', '[]');
  assertResult("$[?match(@, '')]", '["","a"]', '[""]', '["$[0]"]');
  assertResult("$[?match(@, 'a|bc')]", '["a","bc","abc","ac"]', '["a","bc"]', r`["$[0]","$[1]"]`);
  assertResult("$[?match(@.date, '1974-05-..')]", '[{"date":"1974-05-13"},{"date":"1974-06-01"},{"date":"1974-05-1"}]',
    '[{"date":"1974-05-13"}]', '["$[0]"]');
});

test('R25 search()', () => {
  assertResult("$[?search(@, 'a.c')]", '["abc","abcd","a\\nc","xabc",1]', '["abc","abcd","xabc"]', r`["$[0]","$[1]","$[3]"]`);
  assertResult("$[?search(@.author, '[BR]ob')]", '[{"author":"Bob"},{"author":"Rob Roy"},{"author":"bob"},{"author":"Mr. Robinson"}]',
    '[{"author":"Bob"},{"author":"Rob Roy"},{"author":"Mr. Robinson"}]', r`["$[0]","$[1]","$[3]"]`);
  assertResult("$[?search(@, 'a|bc')]", '["a","bc","abc","ac","x"]', '["a","bc","abc","ac"]', r`["$[0]","$[1]","$[2]","$[3]"]`);
  assertResult("$[?search(@, '')]", '["","a",1]', '["","a"]', r`["$[0]","$[1]"]`);
  assertResult("$[?search(@, 'x*')]", '["","abc"]', '["","abc"]', r`["$[0]","$[1]"]`);
  assertResult("$[?search(@, '.')]", '["","\\n","a"]', '["a"]', '["$[2]"]');
  assertResult("$[?search(@, '[')]", '["["]', '[]', '[]');
});

test('R26 value()', () => {
  assertResult('$[?value(@..color) == "red"]', '[{"color":"red"},{"x":{"color":"red"}},{"color":"red","y":{"color":"red"}},{"color":"blue"}]',
    '[{"color":"red"},{"x":{"color":"red"}}]', r`["$[0]","$[1]"]`);
  assertResult('$[?value(@.*) == 1]', '[[1],[1,1],{"k":1},[]]', '[[1],{"k":1}]', r`["$[0]","$[2]"]`);
  assertResult('$[?value(@.a) == value(@.b)]', '[{"a":1,"b":1},{"a":1},{}]', '[{"a":1,"b":1},{}]', r`["$[0]","$[2]"]`);
  assertInvalid('$[?value(@..color)]');
});
