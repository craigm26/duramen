// Scenarios from SPEC.md R13-R26: filter syntax and semantics, existence tests,
// literals, singular queries, comparisons, logical operators and functions.

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

const D13 = '[{"a":1,"b":2},{"a":2},{"b":3}]';

test('R13 filter syntax', () => {
  valid('$[?@.a]', D13, '[{"a":1,"b":2},{"a":2}]', '["$[0]","$[1]"]');
  valid('$[? @.a ]', D13, '[{"a":1,"b":2},{"a":2}]', '["$[0]","$[1]"]');
  valid('$[?(@.a)]', D13, '[{"a":1,"b":2},{"a":2}]', '["$[0]","$[1]"]');
  valid('$[?((@.a))]', D13, '[{"a":1,"b":2},{"a":2}]', '["$[0]","$[1]"]');
  valid('$[?@.a==1]', D13, '[{"a":1,"b":2}]', '["$[0]"]');
  valid('$[?@.a   ==   1]', D13, '[{"a":1,"b":2}]', '["$[0]"]');
  valid('$[?1 == @.a]', D13, '[{"a":1,"b":2}]', '["$[0]"]');
  valid('$[?!@.a]', D13, '[{"b":3}]', '["$[2]"]');
  valid('$[?! @.a]', D13, '[{"b":3}]', '["$[2]"]');
  valid('$[?!(@.a == 1)]', D13, '[{"a":2},{"b":3}]', '["$[1]","$[2]"]');
  valid('$[?!(!@.a)]', D13, '[{"a":1,"b":2},{"a":2}]', '["$[0]","$[1]"]');
  valid('$[?@.a&&@.b]', D13, '[{"a":1,"b":2}]', '["$[0]"]');
  valid('$[?@.a == 2 || @.b == 3]', D13, '[{"a":2},{"b":3}]', '["$[1]","$[2]"]');
  valid('$[?@.a\n==\n1]', D13, '[{"a":1,"b":2}]', '["$[0]"]');
  valid('$[?@.a].b', D13, '[2]', `["$[0]['b']"]`);
  invalid('$[?]');
  invalid('$[@.a]');
  invalid('$[?@.a ==]');
  invalid('$[?== 1]');
  invalid('$[?@.a = 1]');
  invalid('$[?@.a === 1]');
  invalid('$[?@.a <> 1]');
  invalid('$[?@.a =< 1]');
  invalid('$[?@.a = = 1]');
  invalid('$[?@.a == 1 == 1]');
  invalid('$[?!!@.a]');
  invalid('$[?!@.a == 1]');
  invalid('$[?(@.a) == 1]');
  invalid('$[?@.a & @.b]');
  invalid('$[?@.a | @.b]');
  invalid('$[?@.a and @.b]');
  invalid('$[?(@.a]');
  invalid('$[?@.a)]');
  invalid('$[?()]');
  invalid('$[?true]');
  invalid('$[?false]');
  invalid('$[?null]');
  invalid('$[?1]');
  invalid("$[?'a']");
  invalid('$[?@ == [1]]');
  invalid('$[?@ == {}]');
  invalid('$[?@.a + 1 == 2]');
  invalid('$[?@.a == True]');
});

const D14 =
  '{"a":[3,5,1,2,4,6,{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}],"o":{"p":1,"q":2,"r":3,"s":5,"t":{"u":6}},"e":"f"}';
const A14 = '[3,5,1,2,4,6,{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}]';
const O14 = '{"p":1,"q":2,"r":3,"s":5,"t":{"u":6}}';

test('R14 filter semantics', () => {
  valid("$.a[?@.b == 'kilo']", D14, '[{"b":"kilo"}]', `["$['a'][9]"]`);
  valid("$.a[?(@.b == 'kilo')]", D14, '[{"b":"kilo"}]', `["$['a'][9]"]`);
  valid('$.a[?@>3.5]', D14, '[5,4,6]', `["$['a'][1]","$['a'][4]","$['a'][5]"]`);
  valid('$.a[?@.b]', D14, '[{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}]', `["$['a'][6]","$['a'][7]","$['a'][8]","$['a'][9]"]`);
  valid('$[?@.*]', D14, `[${A14},${O14}]`, `["$['a']","$['o']"]`);
  valid('$[?@[?@.b]]', D14, `[${A14}]`, `["$['a']"]`);
  valid('$.o[?@<3, ?@<3]', D14, '[1,2,1,2]', `["$['o']['p']","$['o']['q']","$['o']['p']","$['o']['q']"]`);
  valid('$.a[?@<2 || @.b == "k"]', D14, '[1,{"b":"k"}]', `["$['a'][2]","$['a'][7]"]`);
  valid('$.a[?match(@.b, "[jk]")]', D14, '[{"b":"j"},{"b":"k"}]', `["$['a'][6]","$['a'][7]"]`);
  valid('$.a[?search(@.b, "[jk]")]', D14, '[{"b":"j"},{"b":"k"},{"b":"kilo"}]', `["$['a'][6]","$['a'][7]","$['a'][9]"]`);
  valid('$.o[?@>1 && @<4]', D14, '[2,3]', `["$['o']['q']","$['o']['r']"]`);
  valid('$.o[?@.u || @.x]', D14, '[{"u":6}]', `["$['o']['t']"]`);
  valid('$.a[?@.b == $.x]', D14, '[3,5,1,2,4,6]', `["$['a'][0]","$['a'][1]","$['a'][2]","$['a'][3]","$['a'][4]","$['a'][5]"]`);
  valid('$.a[?@ == @]', D14, A14, `["$['a'][0]","$['a'][1]","$['a'][2]","$['a'][3]","$['a'][4]","$['a'][5]","$['a'][6]","$['a'][7]","$['a'][8]","$['a'][9]"]`);
  valid('$[?@ == 1]', '1', '[]', '[]');
  valid('$[?@ > 1]', '{"x":1,"y":2,"z":3}', '[2,3]', `["$['y']","$['z']"]`);
  valid('$.a[?@ == $.n]', '{"a":[1,2,3],"n":2}', '[2]', `["$['a'][1]"]`);
  valid('$[?$.flag]', '{"flag":false,"v":1}', '[false,1]', `["$['flag']","$['v']"]`);
  valid('$[?@[?@ > 2]]', '[[1,2],[3]]', '[[3]]', '["$[1]"]');
  valid('$[?@.a < @.b]', '[{"a":"x","b":1},{"a":[1],"b":[2]}]', '[]', '[]');
});

test('R15 existence tests', () => {
  valid('$[?@]', '[0,false,null,"",[],{}]', '[0,false,null,"",[],{}]', '["$[0]","$[1]","$[2]","$[3]","$[4]","$[5]"]');
  valid('$[?@.a]', '[{"a":false},{"a":null},{}]', '[{"a":false},{"a":null}]', '["$[0]","$[1]"]');
  valid('$[?!@.a]', '[{"a":false},{"a":null},{}]', '[{}]', '["$[2]"]');
  valid('$[?@..x]', '[{"y":{"x":1}},{"y":2}]', '[{"y":{"x":1}}]', '["$[0]"]');
  valid('$[?@[1:]]', '[[1],[1,2],"ab"]', '[[1,2]]', '["$[1]"]');
});

test('R16 literals', () => {
  valid('$[?@ == 1e2]', '[100,100.0,"100",1]', '[100,100.0]', '["$[0]","$[1]"]');
  valid('$[?@ == 1E+2]', '[100]', '[100]', '["$[0]"]');
  valid('$[?@ == 1.5e-1]', '[0.15,1.5]', '[0.15]', '["$[0]"]');
  valid('$[?@ < -0.5]', '[-1,-0.5,0]', '[-1]', '["$[0]"]');
  valid('$[?@ == -0]', '[0,-0,0.0,1]', '[0,-0,0.0]', '["$[0]","$[1]","$[2]"]');
  valid('$[?@ == -0.0]', '[0]', '[0]', '["$[0]"]');
  valid('$[?@ == "a"]', '["a","b"]', '["a"]', '["$[0]"]');
  valid("$[?@ == 'it\\'s']", '["it\'s"]', '["it\'s"]', '["$[0]"]');
  valid('$[?@ == true]', '[true,"true",1]', '[true]', '["$[0]"]');
  valid('$[?@ == false]', '[false,0,null]', '[false]', '["$[0]"]');
  valid('$[?@ == null]', '[null,0,false,""]', '[null]', '["$[0]"]');
  valid('$[?@ < 1e400]', '[1]', '[1]', '["$[0]"]');
  invalid('$[?@ == 01]');
  invalid('$[?@ == +1]');
  invalid('$[?@ == .5]');
  invalid('$[?@ == 1.]');
  invalid('$[?@ == 1e]');
  invalid('$[?@ == 1.5e+]');
  invalid('$[?@ == - 1]');
  invalid('$[?@ == NaN]');
  invalid('$[?@ == Null]');
  invalid('$[?@ == "abc]');
});

test('R17 singular queries and comparables', () => {
  valid('$[?@ == 2]', '[1,2]', '[2]', '["$[1]"]');
  valid('$[?@[0] == 2]', '[[2],[3],2]', '[[2]]', '["$[0]"]');
  valid('$[?@[-1] == 3]', '[[2,3],[3,2]]', '[[2,3]]', '["$[0]"]');
  valid("$[?@['a'] == 1]", '[{"a":1},{"a":2}]', '[{"a":1}]', '["$[0]"]');
  valid('$[?@.a.b == 1]', '[{"a":{"b":1}},{"a":1}]', '[{"a":{"b":1}}]', '["$[0]"]');
  valid('$[?@.a [0] == 1]', '[{"a":[1]}]', '[{"a":[1]}]', '["$[0]"]');
  valid('$[?@ == $]', '[1]', '[]', '[]');
  valid('$[?$.k == @]', '{"k":1,"m":1,"n":2}', '[1,1]', `["$['k']","$['m']"]`);
  invalid('$[?@.* == 1]');
  invalid('$[?@..a == 1]');
  invalid('$[?@[*] == 1]');
  invalid('$[?@[0:1] == 1]');
  invalid("$[?@['a','b'] == 1]");
  invalid('$[?@[0,1] == 1]');
  invalid('$[?@[?@ > 1] == 1]');
  invalid('$[?$..a == 1]');
  invalid("$[?@[ 'a' ] == 1]");
  invalid('$[?@[ 0 ] == 1]');
  valid("$[?@[ 'a' ]]", '[{"a":1},{}]', '[{"a":1}]', '["$[0]"]');
});

const CMP_DOC = '{"obj":{"x":"y"},"arr":[2,3]}';
const CMP_ALL_V = '[{"x":"y"},[2,3]]';
const CMP_ALL_P = `["$['obj']","$['arr']"]`;

// Each C is evaluated as $[?C] on CMP_DOC: ALL when every child is selected, NONE otherwise.
const CMP_TABLE: Array<[string, 'ALL' | 'NONE']> = [
  ['$.absent1 == $.absent2', 'ALL'],
  ['$.absent1 <= $.absent2', 'ALL'],
  ["$.absent == 'g'", 'NONE'],
  ['$.absent1 != $.absent2', 'NONE'],
  ["$.absent != 'g'", 'ALL'],
  ['1 <= 2', 'ALL'],
  ['1 > 2', 'NONE'],
  ["13 == '13'", 'NONE'],
  ["'a' <= 'b'", 'ALL'],
  ["'a' > 'b'", 'NONE'],
  ['$.obj == $.arr', 'NONE'],
  ['$.obj != $.arr', 'ALL'],
  ['$.obj == $.obj', 'ALL'],
  ['$.obj != $.obj', 'NONE'],
  ['$.arr == $.arr', 'ALL'],
  ['$.arr != $.arr', 'NONE'],
  ['$.obj == 17', 'NONE'],
  ['$.obj != 17', 'ALL'],
  ['$.obj <= $.arr', 'NONE'],
  ['$.obj < $.arr', 'NONE'],
  ['$.obj <= $.obj', 'ALL'],
  ['$.arr <= $.arr', 'ALL'],
  ['1 <= $.arr', 'NONE'],
  ['1 >= $.arr', 'NONE'],
  ['1 > $.arr', 'NONE'],
  ['1 < $.arr', 'NONE'],
  ['true <= true', 'ALL'],
  ['true > true', 'NONE'],
  ['null >= null', 'ALL'],
  ['null < null', 'NONE'],
  ['false < true', 'NONE'],
  ["'ab' < 'abc'", 'ALL'],
  ["'' < 'a'", 'ALL'],
  ["'b' < 'abc'", 'NONE'],
  ["'B' < 'a'", 'ALL'],
  ['$.arr[0] == 2', 'ALL'],
  ['$.arr[0] == 2.0', 'ALL'],
];

test('R18 comparison semantics', () => {
  for (const [c, expect] of CMP_TABLE) {
    const q = `$[?${c}]`;
    if (expect === 'ALL') valid(q, CMP_DOC, CMP_ALL_V, CMP_ALL_P);
    else valid(q, CMP_DOC, '[]', '[]');
  }
  valid('$[?@ < \'b\']', '["a","b","c","",1,"B"]', '["a","","B"]', '["$[0]","$[3]","$[5]"]');
  valid("$[?@ > '\\uE000']", '["😀","a","\\uE000"]', '["😀"]', '["$[0]"]');
  valid('$[?@ >= 2]', '[1,2,3,"3",[3]]', '[2,3]', '["$[1]","$[2]"]');
  valid('$[?@ <= true]', '[false,true]', '[true]', '["$[1]"]');
  valid("$[?@ == '13']", '[13,"13"]', '["13"]', '["$[1]"]');
  valid(
    '$[?@.x == @.y]',
    '[{"x":[1,{"a":2}],"y":[1,{"a":2}]},{"x":{"a":1,"b":2},"y":{"b":2,"a":1}},{"x":[1,2],"y":[2,1]},{"x":{"a":1},"y":{"a":1,"b":2}},{"x":1,"y":1.0},{"x":"1","y":1}]',
    '[{"x":[1,{"a":2}],"y":[1,{"a":2}]},{"x":{"a":1,"b":2},"y":{"b":2,"a":1}},{"x":1,"y":1.0}]',
    '["$[0]","$[1]","$[4]"]',
  );
  valid('$[?@.x == @.y]', '[{}]', '[{}]', '["$[0]"]');
  valid('$[?@.x != @.y]', '[{}]', '[]', '[]');
  valid('$[?@.x < @.y]', '[{}]', '[]', '[]');
  valid('$[?@.x != 1]', '[{},{"x":1},{"x":2}]', '[{},{"x":2}]', '["$[0]","$[2]"]');
  valid('$[?@.x == null]', '[{},{"x":null}]', '[{"x":null}]', '["$[1]"]');
  valid('$[?@.x >= @.x]', '[{"x":{}},{"x":[]},{},{"x":null}]', '[{"x":{}},{"x":[]},{},{"x":null}]', '["$[0]","$[1]","$[2]","$[3]"]');
});

test('R19 logical operators', () => {
  const D19 = '[{"a":1},{"b":1},{"b":1,"c":1}]';
  valid('$[?@.a || @.b && @.c]', D19, '[{"a":1},{"b":1,"c":1}]', '["$[0]","$[2]"]');
  valid('$[?(@.a || @.b) && @.c]', D19, '[{"b":1,"c":1}]', '["$[2]"]');
  valid('$[?@.c && @.b || @.a]', D19, '[{"a":1},{"b":1,"c":1}]', '["$[0]","$[2]"]');
  valid('$[?!(@.a || @.c)]', D19, '[{"b":1}]', '["$[1]"]');
  valid('$[?!@.a && !@.c]', D19, '[{"b":1}]', '["$[1]"]');
});

test('R20 function expression syntax and names', () => {
  valid('$[?length(@) == 1]', '["a","ab"]', '["a"]', '["$[0]"]');
  valid('$[?length( @ ) == 1]', '["a","ab"]', '["a"]', '["$[0]"]');
  invalid('$[?length (@) == 1]');
  invalid('$[?Length(@) == 1]');
  invalid('$[?foo(@)]');
  invalid('$[?bar(@.a) == 1]');
  invalid('$[?_x(@)]');
  invalid('$[?length() == 1]');
  invalid('$[?length(@, @) == 1]');
  invalid('$[?count() == 0]');
  invalid('$[?match(@)]');
  invalid("$[?search(@, 'a', 'b')]");
  invalid('$[?value(@, @) == 1]');
  invalid('$[?length(@ == 1]');
  invalid('$.length(@)');
});

test('R21 type system and well-typedness', () => {
  valid('$[?length(@) < 3]', '["ab","abc",[1,2],{"a":1},5,null]', '["ab",[1,2],{"a":1}]', '["$[0]","$[2]","$[3]"]');
  invalid('$[?length(@.*) < 3]');
  valid('$[?count(@.*) == 1]', '[[1],[1,2],{"a":1},3]', '[[1],{"a":1}]', '["$[0]","$[2]"]');
  invalid('$[?count(1) == 1]');
  invalid("$[?count('a') == 1]");
  invalid('$[?count(length(@)) == 1]');
  invalid('$[?count(@.a == 1) == 1]');
  valid(
    "$[?match(@.timezone, 'Europe/.*')]",
    '[{"timezone":"Europe/Paris"},{"timezone":"America/New_York"}]',
    '[{"timezone":"Europe/Paris"}]',
    '["$[0]"]',
  );
  invalid("$[?match(@.timezone, 'Europe/.*') == true]");
  invalid('$[?value(@..color)]');
  invalid('$[?length(@)]');
  invalid('$[?count(@)]');
  invalid('$[?!length(@)]');
  valid("$[?!match(@, 'a')]", '["a","b",1]', '["b",1]', '["$[1]","$[2]"]');
  invalid("$[?length(match(@, 'a')) == 1]");
  invalid('$[?length(@.a == 1) == 1]');
  invalid('$[?length((@.a)) == 1]');
  invalid("$[?match(@.*, 'a')]");
  invalid("$[?match(@, @.*)]");
  valid("$[?match(@, 'a') && length(@) == 1]", '["a","aa",1]', '["a"]', '["$[0]"]');
  invalid('$[?count(value(@)) == 1]');
  valid('$[?length(value(@.*)) == 2]', '[["ab"],["ab","c"],[[1,2]]]', '[["ab"],[[1,2]]]', '["$[0]","$[2]"]');
  valid("$[?match(length(@), '1')]", '["a"]', '[]', '[]');
  valid("$[?length('ab') == 2]", '[7,8]', '[7,8]', '["$[0]","$[1]"]');
  valid('$[?count(@) == count($)]', '[1]', '[1]', '["$[0]"]');
  valid("$[?match('abc', 'a.c')]", '[1,2]', '[1,2]', '["$[0]","$[1]"]');
});

test('R22 length()', () => {
  valid('$[?length(@) == 3]', '["abc",[1,2,3],{"a":1,"b":2,"c":3},3,"ab",null]', '["abc",[1,2,3],{"a":1,"b":2,"c":3}]', '["$[0]","$[1]","$[2]"]');
  valid('$[?length(@) == 1]', '["😀","e\\u0301"]', '["😀"]', '["$[0]"]');
  valid('$[?length(@) == 0]', '["",[],{},0,null]', '["",[],{}]', '["$[0]","$[1]","$[2]"]');
  valid('$[?length(@) == length(@)]', '[1,"ab",[1]]', '[1,"ab",[1]]', '["$[0]","$[1]","$[2]"]');
  valid('$[?length(@.a) >= 2]', '[{"a":"xy"},{"a":"x"},{"b":"xyz"},{"a":[1,2,3]}]', '[{"a":"xy"},{"a":[1,2,3]}]', '["$[0]","$[3]"]');
  valid('$[?length(@) != 2]', '[true,"ab"]', '[true]', '["$[0]"]');
  valid('$[?length(1) == 1]', '[1]', '[]', '[]');
});

test('R23 count()', () => {
  valid('$[?count(@.*) == 2]', '[[1,2],{"a":1,"b":2},[1],"ab"]', '[[1,2],{"a":1,"b":2}]', '["$[0]","$[1]"]');
  valid('$[?count(@[0,0]) == 2]', '[[5],[]]', '[[5]]', '["$[0]"]');
  valid('$[?count(@) == 1]', '[1,null]', '[1,null]', '["$[0]","$[1]"]');
  valid('$[?count(@..*) > 2]', '[{"a":[1,2]},{"a":1}]', '[{"a":[1,2]}]', '["$[0]"]');
  valid('$[?count(@[?@ > 1]) == 2]', '[[1,2,3],[2],[0,5,6,7]]', '[[1,2,3]]', '["$[0]"]');
  valid('$[?count(@.a) == 0]', '[{"a":null},{}]', '[{}]', '["$[1]"]');
});

test('R24 match()', () => {
  valid('$[?match(@, \'a.c\')]', '["abc","abcd","a\\nc","xabc",1]', '["abc"]', '["$[0]"]');
  valid("$[?match(@, '1')]", '[1,"1"]', '["1"]', '["$[1]"]');
  valid('$[?match(@.s, @.p)]', '[{"s":"aaa","p":"a+"},{"s":"b","p":"a+"},{"s":"a","p":1},{"s":"a","p":"("},{"s":"a"}]', '[{"s":"aaa","p":"a+"}]', '["$[0]"]');
  valid("$[?match(@, '(')]", '["("]', '[]', '[]');
  valid("$[?match(@, '')]", '["","a"]', '[""]', '["$[0]"]');
  valid("$[?match(@, 'a|bc')]", '["a","bc","abc","ac"]', '["a","bc"]', '["$[0]","$[1]"]');
  valid(
    "$[?match(@.date, '1974-05-..')]",
    '[{"date":"1974-05-13"},{"date":"1974-06-01"},{"date":"1974-05-1"}]',
    '[{"date":"1974-05-13"}]',
    '["$[0]"]',
  );
});

test('R25 search()', () => {
  valid('$[?search(@, \'a.c\')]', '["abc","abcd","a\\nc","xabc",1]', '["abc","abcd","xabc"]', '["$[0]","$[1]","$[3]"]');
  valid(
    "$[?search(@.author, '[BR]ob')]",
    '[{"author":"Bob"},{"author":"Rob Roy"},{"author":"bob"},{"author":"Mr. Robinson"}]',
    '[{"author":"Bob"},{"author":"Rob Roy"},{"author":"Mr. Robinson"}]',
    '["$[0]","$[1]","$[3]"]',
  );
  valid("$[?search(@, 'a|bc')]", '["a","bc","abc","ac","x"]', '["a","bc","abc","ac"]', '["$[0]","$[1]","$[2]","$[3]"]');
  valid("$[?search(@, '')]", '["","a",1]', '["","a"]', '["$[0]","$[1]"]');
  valid("$[?search(@, 'x*')]", '["","abc"]', '["","abc"]', '["$[0]","$[1]"]');
  valid("$[?search(@, '.')]", '["","\\n","a"]', '["a"]', '["$[2]"]');
  valid("$[?search(@, '[')]", '["["]', '[]', '[]');
});

test('R26 value()', () => {
  valid(
    '$[?value(@..color) == "red"]',
    '[{"color":"red"},{"x":{"color":"red"}},{"color":"red","y":{"color":"red"}},{"color":"blue"}]',
    '[{"color":"red"},{"x":{"color":"red"}}]',
    '["$[0]","$[1]"]',
  );
  valid('$[?value(@.*) == 1]', '[[1],[1,1],{"k":1},[]]', '[[1],{"k":1}]', '["$[0]","$[2]"]');
  valid('$[?value(@.a) == value(@.b)]', '[{"a":1,"b":1},{"a":1},{}]', '[{"a":1,"b":1},{}]', '["$[0]","$[2]"]');
});
