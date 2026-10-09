// REQ-SY-001 to REQ-SY-011 and REQ-RQ-004: which queries are well formed and valid.
// Rows are taken from the tables in SPEC.md.

import assert from "node:assert";
import { test } from "node:test";
import { ask, errorOf, valuesOf } from "./support.ts";

type Row = [string, unknown, unknown[]];
type Bad = [string, unknown];

function checkValid(rows: Row[]): void {
  for (const [query, doc, expected] of rows) {
    assert.deepStrictEqual(valuesOf(query, doc), expected, query);
  }
}

function checkInvalid(rows: Bad[]): void {
  for (const [query, doc] of rows) {
    assert.strictEqual(errorOf(query, doc), "invalid_query", query);
  }
}

test("REQ-SY-001: the query begins with $, and blank space only before a segment", () => {
  checkValid([
    ["$", { a: 1 }, [{ a: 1 }]],
    ["$ .a", { a: 1 }, [1]],
    ["$\t.a", { a: 1 }, [1]],
    ["$\n['a']", { a: 1 }, [1]],
    ["$\r\n.a \r\n.b", { a: { b: 2 } }, [2]],
  ]);
  checkInvalid([
    ["", 1],
    [" $", 1],
    ["$ ", 1],
    ["$\n", 1],
    ["$.a ", { a: 1 }],
    ["$\u000c.a", { a: 1 }],
    ["$\u00a0.a", { a: 1 }],
    ["$\u2028.a", { a: 1 }],
    ["@", 1],
    ["@.a", { a: 1 }],
    ["$$", 1],
    ["a", 1],
    ["$a", { a: 1 }],
  ]);
});

test("REQ-SY-002: dot notation names, wildcards and descendants", () => {
  checkValid([
    ["$.a", { a: 1 }, [1]],
    ["$._", { _: 1 }, [1]],
    ["$._a1", { _a1: 1 }, [1]],
    ["$.A", { A: 1, a: 2 }, [1]],
    ["$.\u00e9", { "\u00e9": 1 }, [1]],
    ["$.\u0080x", { "\u0080x": 1 }, [1]],
    ["$.\u{1F600}", { "\u{1F600}": 1 }, [1]],
    ["$.a1b2", { a1b2: 1 }, [1]],
    ["$.true", { true: 1 }, [1]],
    ["$.null", { null: 1 }, [1]],
    ["$.a.b", { a: { b: 1 } }, [1]],
    ["$..a", { x: { a: 1 } }, [1]],
    ["$.*", { a: 1 }, [1]],
    ["$..*", { a: [1] }, [[1], 1]],
    ["$..['a']", { a: 1 }, [1]],
    // The table row for U+02CB gives an error, but the name rule and RFC 9535 allow it; see C-2.
    ["$.\u02cba", { "\u02cba": 1 }, [1]],
  ]);
  checkInvalid([
    ["$.", { a: 1 }],
    ["$..", { a: 1 }],
    ["$...", { a: 1 }],
    ["$...a", { a: 1 }],
    ["$.1", { 1: 1 }],
    ["$.1a", { "1a": 1 }],
    ["$.$", { $: 1 }],
    ["$.-a", { "-a": 1 }],
    ["$.a-b", { "a-b": 1 }],
    ["$. a", { a: 1 }],
    ["$.. a", { a: 1 }],
    ["$.\ta", { a: 1 }],
    ["$.'a'", { a: 1 }],
    ["$.[0]", [1]],
    ["$.\u007f", { "\u007f": 1 }],
    ["$.a b", { "a b": 1 }],
    ["$.@a", { "@a": 1 }],
    ["$.{a", { "{a": 1 }],
  ]);
});

test("REQ-SY-003: string literals and their escapes", () => {
  checkValid([
    ["$['a']", { a: 1, b: 2 }, [1]],
    ['$["a"]', { a: 1, b: 2 }, [1]],
    ["$['\\'']", { "'": 2 }, [2]],
    ["$[\"'\"]", { "'": 2 }, [2]],
    ["$['\"']", { '"': 3 }, [3]],
    ["$[\"\\\"\"]", { '"': 3 }, [3]],
    ["$['\\\\']", { "\\": 4 }, [4]],
    ["$['\\/']", { "/": 5 }, [5]],
    ["$['\\n']", { "\n": 6 }, [6]],
    ["$['\\u000A']", { "\n": 6 }, [6]],
    ["$['\\u00E9']", { "\u00e9": 7 }, [7]],
    ["$['\\uD83D\\uDE00']", { "\u{1F600}": 8 }, [8]],
    ["$['\u{1F600}']", { "\u{1F600}": 8 }, [8]],
    ["$['\\u000b']", { "\u000b": 9 }, [9]],
    ["$['\u007f']", { "\u007f": 11 }, [11]],
    ["$['\u2028']", { "\u2028": 12 }, [12]],
    ["$['']", { "": 13 }, [13]],
    ["$['\\b\\f\\r\\t']", { "\b\f\r\t": 14 }, [14]],
    ["$['\\uD800\\uDC00']", { "\ud800\udc00": 15 }, [15]],
    ["$['\\uDBFF\\uDFFF']", { "\udbff\udfff": 16 }, [16]],
    ["$['\\uD7FF']", { "\ud7ff": 17 }, [17]],
    ["$['\\uE000']", { "\ue000": 18 }, [18]],
    ["$['\\u002F']", { "/": 19 }, [19]],
  ]);
  checkInvalid([
    ["$['\\\"']", { '"': 3 }],
    ["$[\"\\'\"]", { "'": 2 }],
    ["$['\\q']", { q: 1 }],
    ["$['\\x41']", { A: 1 }],
    ["$['\\U0041']", { A: 1 }],
    ["$['\\u004']", { "\u0004": 1 }],
    ["$['\\uD83D']", { a: 1 }],
    ["$['\\uDE00']", { a: 1 }],
    ["$['\\uD83Dx']", { a: 1 }],
    ["$['\\uD83D\\u0041']", { a: 1 }],
    ["$['\\uDBFF']", { a: 1 }],
    ["$['\\uD800\\uDBFF']", { a: 1 }],
    ["$['\n']", { "\n": 6 }],
    ["$['\t']", { "\t": 1 }],
    ["$['\u0000']", { a: 1 }],
    ["$['\u001f']", { a: 1 }],
    ["$['a", { a: 1 }],
    ["$['a'", { a: 1 }],
    ["$[a]", { a: 1 }],
    ["$['a'b']", { a: 1 }],
  ]);
});

test("REQ-SY-004: index selectors are integers in the I-JSON range", () => {
  checkValid([
    ["$[1]", ["a", "b"], ["b"]],
    ["$[-1]", ["a", "b"], ["b"]],
    ["$[ 1 ]", ["a", "b"], ["b"]],
    ["$[9007199254740991]", ["a"], []],
    ["$[-9007199254740991]", ["a"], []],
  ]);
  checkInvalid([
    ["$[01]", ["a"]],
    ["$[-0]", ["a"]],
    ["$[+1]", ["a"]],
    ["$[1.0]", ["a"]],
    ["$[1e1]", ["a"]],
    ["$[0x1]", ["a"]],
    ["$[9007199254740992]", ["a"]],
    ["$[-9007199254740992]", ["a"]],
    ["$[99999999999999999999]", ["a"]],
    ["$[1 1]", ["a"]],
    ["$[-]", ["a"]],
    ["$[- 1]", ["a"]],
    ["$[]", ["a"]],
  ]);
});

test("REQ-SY-005: slices take three optional integers", () => {
  const abc = ["a", "b", "c"];
  checkValid([
    ["$[:]", abc, ["a", "b", "c"]],
    ["$[::]", abc, ["a", "b", "c"]],
    ["$[1:]", abc, ["b", "c"]],
    ["$[:2]", abc, ["a", "b"]],
    ["$[::2]", abc, ["a", "c"]],
    ["$[ 1 : 2 : 1 ]", abc, ["b"]],
    ["$[1: :1]", abc, ["b", "c"]],
    ["$[::-1]", abc, ["c", "b", "a"]],
    ["$[:9007199254740991]", abc, ["a", "b", "c"]],
    ["$[-9007199254740991:]", abc, ["a", "b", "c"]],
  ]);
  checkInvalid([
    ["$[1:2:3:4]", abc],
    ["$[-0:]", abc],
    ["$[:-0]", abc],
    ["$[::-0]", abc],
    ["$[01:]", abc],
    ["$[:9007199254740992]", abc],
    ["$[::9007199254740992]", abc],
    ["$[1.0:]", abc],
    ["$[1 2:]", abc],
  ]);
});

test("REQ-SY-006: bracketed selections hold one or more selectors separated by commas", () => {
  checkValid([
    ["$['a','b']", { a: 1, b: 2 }, [1, 2]],
    ["$[ 'a' , 'b' ]", { a: 1, b: 2 }, [1, 2]],
    ["$[\n'b',\t'a'\r]", { a: 1, b: 2 }, [2, 1]],
    ["$[*,'a']", { a: 1, b: 2 }, [1, 2, 1]],
    ["$[?@ == 2, 'a']", { a: 1, b: 2 }, [2, 1]],
  ]);
  checkInvalid([
    ["$[ ]", { a: 1 }],
    ["$[,'a']", { a: 1 }],
    ["$['a',]", { a: 1 }],
    ["$['a',,'b']", { a: 1 }],
    ["$['a''b']", { a: 1 }],
    ["$['a' 'b']", { a: 1 }],
    ["$[['a']]", { a: 1 }],
    ["$['a']]", { a: 1 }],
    ["$[**]", { a: 1 }],
    ["$[*a]", { a: 1 }],
  ]);
});

test("REQ-SY-007: filters, their blank space, and what is not a logical expression", () => {
  const nums = [1, 2, { a: 1 }];
  checkValid([
    ["$[?@]", nums, [1, 2, { a: 1 }]],
    ["$[? @]", nums, [1, 2, { a: 1 }]],
    ["$[?(@)]", nums, [1, 2, { a: 1 }]],
    ["$[?( @ )]", nums, [1, 2, { a: 1 }]],
    ["$[?!@.a]", nums, [1, 2]],
    ["$[?! ( @.a )]", nums, [1, 2]],
    ["$[?!(!@.a)]", nums, [{ a: 1 }]],
    ["$[?@ == 1]", nums, [1]],
    ["$[?@==1]", nums, [1]],
    ["$[?1 == @]", nums, [1]],
    ["$[?@ > 1 && @ < 3]", nums, [2]],
    ["$[?@ == 1 || @.a]", nums, [1, { a: 1 }]],
    ["$[?(@ == 1)]", nums, [1]],
    ["$[?1 == 1]", nums, [1, 2, { a: 1 }]],
  ]);
  checkInvalid([
    ["$[?]", [1]],
    ["$[? ]", [1]],
    ["$[?()]", [1]],
    ["$[?true]", [1]],
    ["$[?false]", [1]],
    ["$[?null]", [1]],
    ["$[?1]", [1]],
    ["$[?'a']", [1]],
    ["$[?!@.a == 1]", [1]],
    ["$[?!!@.a]", [1]],
    ["$[?!1]", [1]],
    ["$[?1 < 2 < 3]", [1]],
    ["$[?@ & @]", [1]],
    ["$[?@ | @]", [1]],
    ["$[?@ and @]", [1]],
    ["$[?@ or @]", [1]],
    ["$[?@ = 1]", [1]],
    ["$[?@ === 1]", [1]],
    ["$[?@ <> 1]", [1]],
    ["$[?@ =< 1]", [1]],
    ["$[?@ => 1]", [1]],
    ["$[?@ !== 1]", [1]],
    ["$[?(@]", [1]],
    ["$[?@)]", [1]],
    ["$[?@ == ]", [1]],
    ["$[?== 1]", [1]],
  ]);
});

test("REQ-SY-008: literals are numbers, strings, true, false and null", () => {
  const doc = [0, 1, 100, -1.5, 0.001, true, null, "x"];
  checkValid([
    ["$[?@ == -0]", doc, [0]],
    ["$[?@ == 0.0]", doc, [0]],
    ["$[?@ == 1e2]", doc, [100]],
    ["$[?@ == 1E2]", doc, [100]],
    ["$[?@ == 1e+2]", doc, [100]],
    ["$[?@ == -15e-1]", doc, [-1.5]],
    ["$[?@ == 1e-3]", doc, [0.001]],
    ["$[?@ == true]", doc, [true]],
    ["$[?@ == null]", doc, [null]],
    ["$[?@ == 'x']", doc, ["x"]],
    ["$[?@ == \"x\"]", doc, ["x"]],
    ["$[?@ == 9007199254740993]", ["a"], []],
    ["$[?@ == 1e400]", ["a"], []],
  ]);
  checkInvalid([
    ["$[?@ == 01]", [1]],
    ["$[?@ == 1.]", [1]],
    ["$[?@ == .5]", [1]],
    ["$[?@ == +1]", [1]],
    ["$[?@ == 1e]", [1]],
    ["$[?@ == 1e+]", [1]],
    ["$[?@ == 0x10]", [1]],
    ["$[?@ == 1_000]", [1]],
    ["$[?@ == Infinity]", [1]],
    ["$[?@ == NaN]", [1]],
    ["$[?@ == True]", [1]],
    ["$[?@ == NULL]", [1]],
    ["$[?@ == nul]", [1]],
    ["$[?@ == -]", [1]],
    ["$[?@ == --1]", [1]],
    ["$[?@ == 'x]", [1]],
  ]);
});

test("REQ-SY-009: comparables are singular queries", () => {
  const doc = [{ a: 1, b: [5, 6] }];
  checkValid([
    ["$[?@.a == 1]", doc, doc],
    ["$[?@['a'] == 1]", doc, doc],
    ["$[?@[\"a\"] == 1]", doc, doc],
    ["$[?@.b[1] == 6]", doc, doc],
    ["$[?@.b[-1] == 6]", doc, doc],
    ["$[?@ .b [0] == 5]", doc, doc],
    ["$[?$[0].a == 1]", doc, doc],
    ["$[?@ == $[0]]", doc, doc],
  ]);
  checkInvalid([
    ["$[?@[ 'a' ] == 1]", [{ a: 1 }]],
    ["$[?@['a' ] == 1]", [{ a: 1 }]],
    ["$[?@[ 0] == 1]", [[1]]],
    ["$[?@.* == 1]", [{ a: 1 }]],
    ["$[?@[*] == 1]", [[1]]],
    ["$[?@[0,1] == 1]", [[1]]],
    ["$[?@['a','b'] == 1]", [{ a: 1 }]],
    ["$[?@[0:1] == 1]", [[1]]],
    ["$[?@..a == 1]", [{ a: 1 }]],
    ["$[?@[?@] == 1]", [[1]]],
    ["$[?1 == @..a]", [{ a: 1 }]],
  ]);
});

test("REQ-SY-010: function names, arity and the five known functions", () => {
  const doc = ["ab", [1, 2]];
  checkValid([
    ["$[?length(@) == 2]", doc, doc],
    ["$[?length( @ ) == 2]", doc, doc],
    ["$[?length(\n@\n) == 2]", doc, doc],
    ["$[?match(@ , 'a.')]", doc, ["ab"]],
    ["$[?search( @,'b' )]", doc, ["ab"]],
  ]);
  checkInvalid([
    ["$[?length (@) == 2]", ["ab"]],
    ["$[?Length(@) == 2]", ["ab"]],
    ["$[?LENGTH(@) == 2]", ["ab"]],
    ["$[?len(@) == 2]", ["ab"]],
    ["$[?foo(@)]", ["ab"]],
    ["$[?constructor(@)]", ["ab"]],
    ["$[?length() == 2]", ["ab"]],
    ["$[?length(@, @) == 2]", ["ab"]],
    ["$[?count() == 1]", ["ab"]],
    ["$[?match(@)]", ["ab"]],
    ["$[?match(@, 'a', 'b')]", ["ab"]],
    ["$[?value() == 1]", ["ab"]],
    ["$[?length(@ == 2]", ["ab"]],
    ["$[?length@ == 2]", ["ab"]],
    ["$[?_length(@) == 2]", ["ab"]],
    ["$[?length(@,) == 2]", ["ab"]],
  ]);
});

test("REQ-SY-011: function expressions are well typed", () => {
  const doc = [{ a: "x", b: [1, 2] }];
  checkValid([
    ["$[?length(@.a) == 1]", doc, doc],
    ["$[?length('abc') == 3]", doc, doc],
    ["$[?length(true) == length(1)]", doc, doc],
    ["$[?length(count(@.*)) == length(1)]", doc, doc],
    ["$[?length(value(@.b)) == 2]", doc, doc],
    ["$[?count(@.*) == 2]", doc, doc],
    ["$[?count(@) == 1]", doc, doc],
    ["$[?count(@..*) == 4]", doc, doc],
    ["$[?count($..*) == 5]", doc, doc],
    ["$[?match(@.a, 'x')]", doc, doc],
    ["$[?match('x', @.a)]", doc, doc],
    ["$[?search(@.a, @.a)]", doc, doc],
    ["$[?value(@..a) == 'x']", doc, doc],
  ]);
  checkInvalid([
    ["$[?length(@)]", [{ a: "x" }]],
    ["$[?count(@.*)]", [{ a: "x" }]],
    ["$[?value(@.a)]", [{ a: "x" }]],
    ["$[?!length(@)]", [{ a: "x" }]],
    ["$[?match(@.a, 'x') == true]", [{ a: "x" }]],
    ["$[?search(@.a, 'x') != false]", [{ a: "x" }]],
    ["$[?length(@.*) == 2]", [{ a: "x" }]],
    ["$[?length(@..a) == 1]", [{ a: "x" }]],
    ["$[?length(@[0,1]) == 1]", [{ a: "x" }]],
    ["$[?length(match(@.a, 'x')) == 1]", [{ a: "x" }]],
    ["$[?length(@.a == 'x') == 1]", [{ a: "x" }]],
    ["$[?length(!@.a) == 1]", [{ a: "x" }]],
    ["$[?count(1) == 1]", [{ a: "x" }]],
    ["$[?count('a') == 1]", [{ a: "x" }]],
    ["$[?count(length(@)) == 1]", [{ a: "x" }]],
    ["$[?count(value(@.b)) == 1]", [{ a: "x" }]],
    ["$[?count(@.a == 'x') == 1]", [{ a: "x" }]],
    ["$[?count((@.a)) == 1]", [{ a: "x" }]],
    ["$[?value(1) == 1]", [{ a: "x" }]],
    ["$[?value(count(@.*)) == 2]", [{ a: "x" }]],
    ["$[?match(@.*, 'x')]", [{ a: "x" }]],
    ["$[?match(@.a, @.*)]", [{ a: "x" }]],
    ["$[?match(@.a == 'x', 'x')]", [{ a: "x" }]],
    ["$[?length(@.a) == count(1)]", [{ a: "x" }]],
  ]);
});

test("REQ-RQ-004: an invalid query is an error whatever the document", () => {
  assert.strictEqual(ask("$[", null).error, "invalid_query");
  assert.strictEqual(ask("$[?length(@.*) < 3]", []).error, "invalid_query");
  assert.strictEqual(ask("$.a[?length(@.*) < 3]", { b: 1 }).error, "invalid_query");
  assert.deepStrictEqual(valuesOf("$.a.b.c[5]['x']", { a: 1 }), []);
  assert.deepStrictEqual(valuesOf("$[?@.a < 'b']", [1, [2], { a: null }]), []);
  assert.deepStrictEqual(valuesOf("$..[?@[-1] == 1]", "text"), []);
});
