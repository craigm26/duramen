// Scenarios for SPEC R29-R32: normalized paths, order of results, JSON values, and the BOOKSTORE
// end-to-end examples.

import { test } from 'node:test';
import { assertInvalid, assertResult, r } from './helpers.ts';

test('R29 normalized paths', () => {
  assertResult('$.a', '{"a":1}', '[1]', r`["$['a']"]`);
  assertResult('$[1]', '[0,1]', '[1]', '["$[1]"]');
  assertResult('$[-3]', '[0,1,2,3,4]', '[2]', '["$[2]"]');
  assertResult('$.a.b[1:2]', '{"a":{"b":[0,1,2]}}', '[1]', r`["$['a']['b'][1]"]`);
  assertResult(r`$["\u000B"]`, '{"\\u000b":1}', '[1]', r`["$['\\u000b']"]`);
  assertResult(r`$["\u0061"]`, '{"a":1}', '[1]', r`["$['a']"]`);
  assertResult('$[12]', '[0,1,2,3,4,5,6,7,8,9,10,11,12]', '[12]', '["$[12]"]');
  assertResult('$.*',
    r`{"\b":1,"\f":2,"\n":3,"\r":4,"\t":5,"'":6,"\\":7,"\u0000":8,"\u001f":9,"\"":10,"/":11,"\u007f":12,"é":13,"\u000b":14,"\u000e":15}`,
    '[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]',
    r`["$['\\b']","$['\\f']","$['\\n']","$['\\r']","$['\\t']","$['\\'']","$['\\\\']","$['\\u0000']","$['\\u001f']","$['\"']","$['/']","$['\u007f']","$['é']","$['\\u000b']","$['\\u000e']"]`);
  assertResult('$..*', '{"a b":[{"c":1}]}', '[[{"c":1}],{"c":1},1]', r`["$['a b']","$['a b'][0]","$['a b'][0]['c']"]`);
});

test('R29.1 an array index path is never negative', () => {
  assertResult('$[-1]', '[1,2]', '[2]', '["$[1]"]');
});

test('R29-R31 member names that are also JavaScript object properties are ordinary names', () => {
  assertResult('$.constructor', '{"constructor":1}', '[1]', r`["$['constructor']"]`);
  assertResult('$.__proto__', '{"__proto__":2}', '[2]', r`["$['__proto__']"]`);
  assertResult('$.toString', '{}', '[]', '[]');
  assertInvalid('$[?constructor(@)]');
});

test('R30 order of results follows the document text', () => {
  assertResult('$.*', '{"b":1,"a":2,"1":3}', '[1,2,3]', r`["$['b']","$['a']","$['1']"]`);
  assertResult('$[?@ > 0]', '{"z":1,"10":2,"2":3}', '[1,2,3]', r`["$['z']","$['10']","$['2']"]`);
  assertResult('$..*', '{"y":{"q":1},"x":2}', '[{"q":1},2,1]', r`["$['y']","$['x']","$['y']['q']"]`);
});

const D31 = '{"a":null,"b":[null],"c":[{}],"null":1}';

test('R31 JSON values, null, numbers and duplicate names', () => {
  assertResult('$.a', D31, '[null]', r`["$['a']"]`);
  assertResult('$.a[0]', D31, '[]', '[]');
  assertResult('$.a.d', D31, '[]', '[]');
  assertResult('$.b[0]', D31, '[null]', r`["$['b'][0]"]`);
  assertResult('$.b[*]', D31, '[null]', r`["$['b'][0]"]`);
  assertResult('$.b[?@]', D31, '[null]', r`["$['b'][0]"]`);
  assertResult('$.b[?@==null]', D31, '[null]', r`["$['b'][0]"]`);
  assertResult('$.c[?@.d==null]', D31, '[]', '[]');
  assertResult('$.null', D31, '[1]', r`["$['null']"]`);
  assertResult('$[0]', '[12345678901234567890]', '[12345678901234567890]', '["$[0]"]');
  assertResult('$[0]', '[1.5e3]', '[1500]', '["$[0]"]');
  assertResult('$[0]', '[0.1]', '[0.1]', '["$[0]"]');
  assertResult('$.*', '{"a":1,"b":2,"a":3}', '[3,2]', r`["$['a']","$['b']"]`);
  assertResult('$.a', '{"a":1,"a":3}', '[3]', r`["$['a']"]`);
  assertResult('$', '{"x":[1,{"y":[true,false,null,"s",-2.5]}]}', '[{"x":[1,{"y":[true,false,null,"s",-2.5]}]}]', '["$"]');
});

const BOOKS = `[
  {"category":"reference","author":"Nigel Rees","title":"Sayings of the Century","price":8.95},
  {"category":"fiction","author":"Evelyn Waugh","title":"Sword of Honour","price":12.99},
  {"category":"fiction","author":"Herman Melville","title":"Moby Dick","isbn":"0-553-21311-3","price":8.99},
  {"category":"fiction","author":"J. R. R. Tolkien","title":"The Lord of the Rings","isbn":"0-395-19395-8","price":22.99}
]`;
const B0 = '{"category":"reference","author":"Nigel Rees","title":"Sayings of the Century","price":8.95}';
const B1 = '{"category":"fiction","author":"Evelyn Waugh","title":"Sword of Honour","price":12.99}';
const B2 = '{"category":"fiction","author":"Herman Melville","title":"Moby Dick","isbn":"0-553-21311-3","price":8.99}';
const B3 = '{"category":"fiction","author":"J. R. R. Tolkien","title":"The Lord of the Rings","isbn":"0-395-19395-8","price":22.99}';
const BIKE = '{"color":"red","price":399}';
const STORE = `{"book":${BOOKS},"bicycle":${BIKE}}`;
const BOOKSTORE = `{"store":${STORE}}`;

test('R32 the BOOKSTORE examples', () => {
  const authors = '["Nigel Rees","Evelyn Waugh","Herman Melville","J. R. R. Tolkien"]';
  const authorPaths = [0, 1, 2, 3].map((i) => `"$['store']['book'][${i}]['author']"`);
  assertResult('$.store.book[*].author', BOOKSTORE, authors, `[${authorPaths.join(',')}]`);
  assertResult('$..author', BOOKSTORE, authors, `[${authorPaths.join(',')}]`);
  assertResult('$.store.*', BOOKSTORE, `[${BOOKS},${BIKE}]`, r`["$['store']['book']","$['store']['bicycle']"]`);
  assertResult('$.store..price', BOOKSTORE, '[8.95,12.99,8.99,22.99,399]',
    r`["$['store']['book'][0]['price']","$['store']['book'][1]['price']","$['store']['book'][2]['price']","$['store']['book'][3]['price']","$['store']['bicycle']['price']"]`);
  assertResult('$..book[2]', BOOKSTORE, `[${B2}]`, r`["$['store']['book'][2]"]`);
  assertResult('$..book[2].author', BOOKSTORE, '["Herman Melville"]', r`["$['store']['book'][2]['author']"]`);
  assertResult('$..book[2].publisher', BOOKSTORE, '[]', '[]');
  assertResult('$..book[-1]', BOOKSTORE, `[${B3}]`, r`["$['store']['book'][3]"]`);
  assertResult('$..book[0,1]', BOOKSTORE, `[${B0},${B1}]`, r`["$['store']['book'][0]","$['store']['book'][1]"]`);
  assertResult('$..book[:2]', BOOKSTORE, `[${B0},${B1}]`, r`["$['store']['book'][0]","$['store']['book'][1]"]`);
  assertResult('$..book[?@.isbn]', BOOKSTORE, `[${B2},${B3}]`, r`["$['store']['book'][2]","$['store']['book'][3]"]`);
  assertResult('$..book[?@.price<10]', BOOKSTORE, `[${B0},${B2}]`, r`["$['store']['book'][0]","$['store']['book'][2]"]`);
  assertResult('$..book[?@.price<10].title', BOOKSTORE, '["Sayings of the Century","Moby Dick"]',
    r`["$['store']['book'][0]['title']","$['store']['book'][2]['title']"]`);
  assertResult("$.store.book[?@.category == 'fiction' && @.price > 20].title", BOOKSTORE, '["The Lord of the Rings"]',
    r`["$['store']['book'][3]['title']"]`);
  assertResult('$..*', BOOKSTORE, `[${STORE},${BOOKS},${BIKE},${B0},${B1},${B2},${B3},"reference","Nigel Rees","Sayings of the Century",8.95,"fiction","Evelyn Waugh","Sword of Honour",12.99,"fiction","Herman Melville","Moby Dick","0-553-21311-3",8.99,"fiction","J. R. R. Tolkien","The Lord of the Rings","0-395-19395-8",22.99,"red",399]`,
    r`["$['store']","$['store']['book']","$['store']['bicycle']","$['store']['book'][0]","$['store']['book'][1]","$['store']['book'][2]","$['store']['book'][3]","$['store']['book'][0]['category']","$['store']['book'][0]['author']","$['store']['book'][0]['title']","$['store']['book'][0]['price']","$['store']['book'][1]['category']","$['store']['book'][1]['author']","$['store']['book'][1]['title']","$['store']['book'][1]['price']","$['store']['book'][2]['category']","$['store']['book'][2]['author']","$['store']['book'][2]['title']","$['store']['book'][2]['isbn']","$['store']['book'][2]['price']","$['store']['book'][3]['category']","$['store']['book'][3]['author']","$['store']['book'][3]['title']","$['store']['book'][3]['isbn']","$['store']['book'][3]['price']","$['store']['bicycle']['color']","$['store']['bicycle']['price']"]`);
  assertResult('$.store[?length(@) == 2]', BOOKSTORE, `[${BIKE}]`, r`["$['store']['bicycle']"]`);
  assertResult('$.store.book[?count(@.isbn) == 0].author', BOOKSTORE, '["Nigel Rees","Evelyn Waugh"]',
    r`["$['store']['book'][0]['author']","$['store']['book'][1]['author']"]`);
  assertResult('$[?value(@..color) == "red"]', BOOKSTORE, `[${STORE}]`, r`["$['store']"]`);
  assertResult(r`$.store.book[?search(@.author, 'R\\.')].title`, BOOKSTORE, '["The Lord of the Rings"]',
    r`["$['store']['book'][3]['title']"]`);
});
