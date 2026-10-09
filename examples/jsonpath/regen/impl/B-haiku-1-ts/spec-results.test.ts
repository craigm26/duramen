// Scenarios from SPEC.md R27-R28 (I-Regexp), R30-R32 (order, JSON values, end-to-end).

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

test('R27 I-Regexp syntax (accepted and rejected patterns)', () => {
  valid(String.raw`$[?match(@, 'a\\.b')]`, '["a.b","axb"]', '["a.b"]', '["$[0]"]');
  invalid(String.raw`$[?match(@, 'a\.b')]`);
  valid(String.raw`$[?match(@, '\\d')]`, '["1"]', '[]', '[]');
  valid(String.raw`$[?match(@, '\\w')]`, '["a"]', '[]', '[]');
  valid(String.raw`$[?search(@, '\\s')]`, '["a b"]', '[]', '[]');
  valid(String.raw`$[?match(@, '\\u0041')]`, '["A"]', '[]', '[]');
  valid(String.raw`$[?match(@, '\\$')]`, '["$"]', '[]', '[]');
  valid("$[?match(@, 'a$')]", '["a","a$"]', '["a$"]', '["$[1]"]');
  valid("$[?search(@, '^a')]", '["ab","^ab","b^a"]', '["^ab","b^a"]', '["$[1]","$[2]"]');
  valid("$[?match(@, '[]')]", '["[]",""]', '[]', '[]');
  valid("$[?match(@, '[^]')]", '["^","a"]', '[]', '[]');
  valid("$[?match(@, '[a-]')]", '["-","a","b"]', '["-","a"]', '["$[0]","$[1]"]');
  valid("$[?match(@, '[-a]')]", '["-","a","b"]', '["-","a"]', '["$[0]","$[1]"]');
  valid("$[?match(@, '[^^]')]", '["^","x"]', '["x"]', '["$[1]"]');
  valid("$[?match(@, '[a-c-e]')]", '["a","-","e"]', '[]', '[]');
  valid("$[?match(@, '[z-a]')]", '["m"]', '[]', '[]');
  valid(String.raw`$[?match(@, '[\\[\\]]')]`, '["[","]","a"]', '["[","]"]', '["$[0]","$[1]"]');
  valid("$[?match(@, 'a]')]", '["a]"]', '[]', '[]');
  valid(String.raw`$[?match(@, 'a\\]')]`, '["a]"]', '["a]"]', '["$[0]"]');
  valid("$[?match(@, 'a}')]", '["a}"]', '[]', '[]');
  valid("$[?match(@, 'a{')]", '["a{"]', '[]', '[]');
  valid("$[?match(@, 'a**')]", '["aa"]', '[]', '[]');
  valid("$[?match(@, 'a*?')]", '["aa"]', '[]', '[]');
  valid("$[?match(@, '(?:a)')]", '["a"]', '[]', '[]');
  valid("$[?match(@, '*a')]", '["a"]', '[]', '[]');
  valid("$[?match(@, '(a')]", '["a"]', '[]', '[]');
  valid("$[?match(@, 'a)')]", '["a"]', '[]', '[]');
  valid("$[?match(@, 'a{,2}')]", '["a"]', '[]', '[]');
  valid("$[?match(@, 'a{2,1}')]", '["a","aa"]', '[]', '[]');
  valid(String.raw`$[?match(@, '\\p{IsBasicLatin}')]`, '["a"]', '[]', '[]');
  valid(String.raw`$[?match(@, '\\p{Lx}')]`, '["a"]', '[]', '[]');
  valid(String.raw`$[?match(@, '\\p{l}')]`, '["a"]', '[]', '[]');
  valid(String.raw`$[?match(@, 'a\\-b')]`, '["a-b"]', '["a-b"]', '["$[0]"]');
});

test('R28 I-Regexp semantics', () => {
  valid(String.raw`$[?match(@, 'a.c')]`, '["abc","a\\nc","a\\rc","abcd","a😀c"]', '["abc","a😀c"]', '["$[0]","$[4]"]');
  valid("$[?match(@, '.')]", '["😀","ab",""]', '["😀"]', '["$[0]"]');
  valid("$[?match(@, '[a-c]+')]", '["abc","abd","","cab"]', '["abc","cab"]', '["$[0]","$[3]"]');
  valid("$[?match(@, '[^a-c]')]", '["a","d","\\n","dd"]', '["d","\\n"]', '["$[1]","$[2]"]');
  valid(String.raw`$[?match(@, 'a\\nb')]`, '["a\\nb","anb"]', '["a\\nb"]', '["$[0]"]');
  valid("$[?match(@, 'a\\nb')]", '["a\\nb","anb"]', '["a\\nb"]', '["$[0]"]');
  valid(String.raw`$[?match(@, 'a\\tb')]`, '["a\\tb","atb"]', '["a\\tb"]', '["$[0]"]');
  valid("$[?match(@, 'A')]", '["a","A"]', '["A"]', '["$[1]"]');
  valid(String.raw`$[?match(@, '\\p{Lu}+')]`, '["ABC","AbC","ÀÉ",""]', '["ABC","ÀÉ"]', '["$[0]","$[2]"]');
  valid(String.raw`$[?match(@, '\\P{L}+')]`, '["a1","12"," !"]', '["12"," !"]', '["$[1]","$[2]"]');
  valid(String.raw`$[?match(@, '\\p{Nd}')]`, '["3","٣","x","Ⅻ"]', '["3","٣"]', '["$[0]","$[1]"]');
  valid(String.raw`$[?match(@, '\\p{N}')]`, '["3","٣","x","Ⅻ"]', '["3","٣","Ⅻ"]', '["$[0]","$[1]","$[3]"]');
  valid(String.raw`$[?match(@, '[\\p{Lu}0-9]+')]`, '["A1","a1","Z9Z"]', '["A1","Z9Z"]', '["$[0]","$[2]"]');
  valid(String.raw`$[?match(@, '[^\\p{L}]')]`, '["a","1"]', '["1"]', '["$[1]"]');
  valid("$[?match(@, 'a{2}')]", '["a","aa","aaa"]', '["aa"]', '["$[1]"]');
  valid("$[?match(@, 'a{2,}')]", '["a","aa","aaa"]', '["aa","aaa"]', '["$[1]","$[2]"]');
  valid("$[?match(@, 'a{1,2}')]", '["a","aa","aaa"]', '["a","aa"]', '["$[0]","$[1]"]');
  valid("$[?match(@, 'a{0}')]", '["","a"]', '[""]', '["$[0]"]');
  valid("$[?match(@, 'ab?c')]", '["ac","abc","abbc"]', '["ac","abc"]', '["$[0]","$[1]"]');
  valid("$[?match(@, '(ab)+')]", '["abab","aba",""]', '["abab"]', '["$[0]"]');
  valid("$[?match(@, '()')]", '["","a"]', '[""]', '["$[0]"]');
  valid("$[?match(@, 'a|')]", '["","a","b"]', '["","a"]', '["$[0]","$[1]"]');
  valid("$[?match(@, 'x(a|b)*y')]", '["xy","xabbay","xacy"]', '["xy","xabbay"]', '["$[0]","$[1]"]');
});

test('R30 order of results', () => {
  valid('$.*', '{"b":1,"a":2,"1":3}', '[1,2,3]', `["$['b']","$['a']","$['1']"]`);
  valid('$[?@ > 0]', '{"z":1,"10":2,"2":3}', '[1,2,3]', `["$['z']","$['10']","$['2']"]`);
  valid('$..*', '{"y":{"q":1},"x":2}', '[{"q":1},2,1]', `["$['y']","$['x']","$['y']['q']"]`);
});

test('R31 JSON values', () => {
  const D31 = '{"a":null,"b":[null],"c":[{}],"null":1}';
  valid('$.a', D31, '[null]', `["$['a']"]`);
  valid('$.a[0]', D31, '[]', '[]');
  valid('$.a.d', D31, '[]', '[]');
  valid('$.b[0]', D31, '[null]', `["$['b'][0]"]`);
  valid('$.b[*]', D31, '[null]', `["$['b'][0]"]`);
  valid('$.b[?@]', D31, '[null]', `["$['b'][0]"]`);
  valid('$.b[?@==null]', D31, '[null]', `["$['b'][0]"]`);
  valid('$.c[?@.d==null]', D31, '[]', '[]');
  valid('$.null', D31, '[1]', `["$['null']"]`);
  valid('$[0]', '[12345678901234567890]', '[12345678901234567890]', '["$[0]"]');
  valid('$[0]', '[1.5e3]', '[1500]', '["$[0]"]');
  valid('$[0]', '[0.1]', '[0.1]', '["$[0]"]');
  valid('$.*', '{"a":1,"b":2,"a":3}', '[3,2]', `["$['a']","$['b']"]`);
  valid('$.a', '{"a":1,"a":3}', '[3]', `["$['a']"]`);
  valid('$', '{"x":[1,{"y":[true,false,null,"s",-2.5]}]}', '[{"x":[1,{"y":[true,false,null,"s",-2.5]}]}]', '["$"]');
});

test('R32 end-to-end example (BOOKSTORE)', () => {
  const doc = String.raw`{ "store": {
    "book": [
      { "category": "reference", "author": "Nigel Rees",
        "title": "Sayings of the Century", "price": 8.95 },
      { "category": "fiction", "author": "Evelyn Waugh",
        "title": "Sword of Honour", "price": 12.99 },
      { "category": "fiction", "author": "Herman Melville",
        "title": "Moby Dick", "isbn": "0-553-21311-3", "price": 8.99 },
      { "category": "fiction", "author": "J. R. R. Tolkien",
        "title": "The Lord of the Rings", "isbn": "0-395-19395-8", "price": 22.99 }
    ],
    "bicycle": { "color": "red", "price": 399 }
  }
}`;
  const store = (JSON.parse(doc) as { store: { book: unknown[]; bicycle: unknown } }).store;
  const books = store.book;
  const bike = store.bicycle;
  const b = books as Array<Record<string, unknown>>;
  const check = (query: string, values: unknown[], paths: string[]): void => {
    assert.deepStrictEqual(run(query, doc), { id: 't', result: { values, paths } }, query);
  };
  const authors = [
    "$['store']['book'][0]['author']",
    "$['store']['book'][1]['author']",
    "$['store']['book'][2]['author']",
    "$['store']['book'][3]['author']",
  ];
  check('$.store.book[*].author', ['Nigel Rees', 'Evelyn Waugh', 'Herman Melville', 'J. R. R. Tolkien'], authors);
  check('$..author', ['Nigel Rees', 'Evelyn Waugh', 'Herman Melville', 'J. R. R. Tolkien'], authors);
  check('$.store.*', [books, bike], ["$['store']['book']", "$['store']['bicycle']"]);
  check(
    '$.store..price',
    [8.95, 12.99, 8.99, 22.99, 399],
    [0, 1, 2, 3].map((k) => `$['store']['book'][${k}]['price']`).concat(["$['store']['bicycle']['price']"]),
  );
  check('$..book[2]', [books[2]], ["$['store']['book'][2]"]);
  check('$..book[2].author', ['Herman Melville'], ["$['store']['book'][2]['author']"]);
  check('$..book[2].publisher', [], []);
  check('$..book[-1]', [books[3]], ["$['store']['book'][3]"]);
  check('$..book[0,1]', [books[0], books[1]], ["$['store']['book'][0]", "$['store']['book'][1]"]);
  check('$..book[:2]', [books[0], books[1]], ["$['store']['book'][0]", "$['store']['book'][1]"]);
  check('$..book[?@.isbn]', [books[2], books[3]], ["$['store']['book'][2]", "$['store']['book'][3]"]);
  check('$..book[?@.price<10]', [books[0], books[2]], ["$['store']['book'][0]", "$['store']['book'][2]"]);
  check(
    '$..book[?@.price<10].title',
    ['Sayings of the Century', 'Moby Dick'],
    ["$['store']['book'][0]['title']", "$['store']['book'][2]['title']"],
  );
  check(
    "$.store.book[?@.category == 'fiction' && @.price > 20].title",
    ['The Lord of the Rings'],
    ["$['store']['book'][3]['title']"],
  );
  // Every node in document order (27 nodes).
  const all = [
    store, books, bike, b[0], b[1], b[2], b[3],
    'reference', 'Nigel Rees', 'Sayings of the Century', 8.95,
    'fiction', 'Evelyn Waugh', 'Sword of Honour', 12.99,
    'fiction', 'Herman Melville', 'Moby Dick', '0-553-21311-3', 8.99,
    'fiction', 'J. R. R. Tolkien', 'The Lord of the Rings', '0-395-19395-8', 22.99,
    'red', 399,
  ];
  const allPaths = [
    "$['store']", "$['store']['book']", "$['store']['bicycle']",
    "$['store']['book'][0]", "$['store']['book'][1]", "$['store']['book'][2]", "$['store']['book'][3]",
    "$['store']['book'][0]['category']", "$['store']['book'][0]['author']", "$['store']['book'][0]['title']", "$['store']['book'][0]['price']",
    "$['store']['book'][1]['category']", "$['store']['book'][1]['author']", "$['store']['book'][1]['title']", "$['store']['book'][1]['price']",
    "$['store']['book'][2]['category']", "$['store']['book'][2]['author']", "$['store']['book'][2]['title']", "$['store']['book'][2]['isbn']", "$['store']['book'][2]['price']",
    "$['store']['book'][3]['category']", "$['store']['book'][3]['author']", "$['store']['book'][3]['title']", "$['store']['book'][3]['isbn']", "$['store']['book'][3]['price']",
    "$['store']['bicycle']['color']", "$['store']['bicycle']['price']",
  ];
  check('$..*', all, allPaths);
  check('$.store[?length(@) == 2]', [bike], ["$['store']['bicycle']"]);
  check('$.store.book[?count(@.isbn) == 0].author', ['Nigel Rees', 'Evelyn Waugh'], [authors[0], authors[1]]);
  check('$[?value(@..color) == "red"]', [store], ["$['store']"]);
  check('$.store.book[?search(@.author, \'R\\\\.\')].title', ['The Lord of the Rings'], ["$['store']['book'][3]['title']"]);
});
