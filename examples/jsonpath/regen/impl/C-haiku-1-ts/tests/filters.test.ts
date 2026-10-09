// REQ-FI-001 to REQ-FI-007 and REQ-FN-001 to REQ-FN-005: filter selectors, tests and
// comparisons, logical operators, and the five functions. Rows are taken from SPEC.md.

import assert from "node:assert";
import { test } from "node:test";
import { ask, pathsOf, valuesOf } from "./support.ts";

// The document the specification uses for its comparison examples.
const OA = { obj: { x: "y" }, arr: [2, 3] };
const BOTH = [[2, 3], { x: "y" }];

function checkValues(rows: Array<[string, unknown, unknown[]]>): void {
  for (const [query, doc, expected] of rows) {
    assert.deepStrictEqual(valuesOf(query, doc), expected, query);
  }
}

test("REQ-FI-001: a filter keeps the elements, or members in name order, where it holds", () => {
  assert.deepStrictEqual(valuesOf("$[?@ > 1]", [1, 2, 3]), [2, 3]);
  assert.deepStrictEqual(pathsOf("$[?@ > 1]", [1, 2, 3]), ["$[1]", "$[2]"]);
  assert.deepStrictEqual(valuesOf("$[?@ > 1]", { a: 1, b: 2, c: 3 }), [2, 3]);
  assert.deepStrictEqual(pathsOf("$[?@ > 1]", { a: 1, b: 2, c: 3 }), ["$['b']", "$['c']"]);
  assert.deepStrictEqual(valuesOf("$[?@ > 1]", 5), []);
  assert.deepStrictEqual(valuesOf("$[?@.x == $.x]", { x: 1, y: { x: 1 }, z: { x: 2 } }), [{ x: 1 }]);
  assert.deepStrictEqual(pathsOf("$[?@.x == $.x]", { x: 1, y: { x: 1 }, z: { x: 2 } }), ["$['y']"]);
  // The inner @ is the element of the inner filter, not the outer one.
  assert.deepStrictEqual(valuesOf("$[?@[?@ == 1]]", [[1, 2], [3]]), [[1, 2]]);
  assert.deepStrictEqual(pathsOf("$..[?@.k]", { k: 1, a: [{ k: 2 }] }), ["$['a'][0]"]);
  assert.deepStrictEqual(valuesOf("$..[?@.k]", { k: 1, a: [{ k: 2 }] }), [{ k: 2 }]);
});

test("REQ-FI-002: a query used as a test holds when it selects something", () => {
  checkValues([
    ["$[?@.a]", [{ a: null }, { a: false }, { b: 1 }, 1], [{ a: null }, { a: false }]],
    ["$[?!@.a]", [{ a: null }, { a: false }, { b: 1 }, 1], [{ b: 1 }, 1]],
    ["$[?@.*]", [[], [0], {}, { a: 0 }, "ab"], [[0], { a: 0 }]],
    ["$[?@..x]", [{ y: { x: null } }, { y: 1 }], [{ y: { x: null } }]],
    ["$[?$.flag]", { flag: false, a: 1 }, [1, false]],
    ["$[?@]", [null, false, 0], [null, false, 0]],
    ["$[?@.a == false]", [{ a: null }, { a: false }], [{ a: false }]],
  ]);
});

test("REQ-FI-003: a comparison with nothing to compare", () => {
  checkValues([
    ["$[?$.absent1 == $.absent2]", OA, BOTH],
    ["$[?$.absent1 <= $.absent2]", OA, BOTH],
    ["$[?$.absent == 'g']", OA, []],
    ["$[?$.absent1 != $.absent2]", OA, []],
    ["$[?$.absent != 'g']", OA, BOTH],
    ["$[?$.absent < 'g']", OA, []],
    ["$[?$.absent >= 'g']", OA, []],
    ["$[?$.absent == null]", OA, []],
    ["$[?$.absent == length(1)]", OA, BOTH],
    ["$[?length(1) == length(true)]", OA, BOTH],
    ["$[?length(1) < length(2)]", OA, []],
  ]);
});

test("REQ-FI-004: equality of values of the same kind", () => {
  checkValues([
    ["$[?13 == '13']", OA, []],
    ["$[?$.obj == $.arr]", OA, []],
    ["$[?$.obj != $.arr]", OA, BOTH],
    ["$[?$.obj == $.obj]", OA, BOTH],
    ["$[?$.obj != $.obj]", OA, []],
    ["$[?$.arr == $.arr]", OA, BOTH],
    ["$[?$.arr != $.arr]", OA, []],
    ["$[?$.obj == 17]", OA, []],
    ["$[?$.obj != 17]", OA, BOTH],
    ["$[?@ == 1]", [1, 1.0, 1e0, "1", true, [1], { a: 1 }], [1, 1, 1]],
    ["$[?@ == 0]", [0, -0, false, null, "0", 0.0], [0, 0, 0]],
    ["$[?@ == false]", [false, 0, null, ""], [false]],
    ["$[?@ == null]", [null, false, 0, ""], [null]],
    ["$[?@ == 'é']", ["é", "é"], ["é"]],
    ["$[?@ == $.x]", { x: [1, { a: 2 }], y: [1, { a: 2 }], z: [{ a: 2 }, 1] }, [[1, { a: 2 }], [1, { a: 2 }]]],
    [
      "$[?@ == $.x]",
      { x: { a: 1, b: [true] }, y: { b: [true], a: 1 }, z: { a: 1 } },
      [{ a: 1, b: [true] }, { a: 1, b: [true] }],
    ],
    ["$[?@ == $.x]", { x: [], y: {}, z: [] }, [[], []]],
    ["$[?@ == $.x]", { x: {}, y: 0, z: "", w: [] }, [{}]],
    ["$[?@ == $.x]", { x: [], y: 0, z: "", w: {} }, [[]]],
  ]);
  assert.deepStrictEqual(pathsOf("$[?@ == 1]", [1, 1.0, 1e0, "1", true, [1], { a: 1 }]), ["$[0]", "$[1]", "$[2]"]);
  assert.deepStrictEqual(pathsOf("$[?@ == 0]", [0, -0, false, null, "0", 0.0]), ["$[0]", "$[1]", "$[5]"]);
});

test("REQ-FI-005: less than, for numbers and strings by code point only", () => {
  checkValues([
    ["$[?1 < 2]", OA, BOTH],
    ["$[?2 < 1]", OA, []],
    ["$[?-1 < 0]", OA, BOTH],
    ["$[?1.5 < 2]", OA, BOTH],
    ["$[?1e1 < 9]", OA, []],
    ["$[?'a' < 'b']", OA, BOTH],
    ["$[?'' < 'a']", OA, BOTH],
    ["$[?'a' < 'ab']", OA, BOTH],
    ["$[?'ab' < 'b']", OA, BOTH],
    ["$[?'B' < 'a']", OA, BOTH],
    ["$[?'z' < 'é']", OA, BOTH],
    ["$[?'￿' < '\u{1F600}']", OA, BOTH],
    ["$[?'\u{1F600}' < '￿']", OA, []],
    ["$[?1 < '2']", OA, []],
    ["$[?'1' < 2]", OA, []],
    ["$[?false < true]", OA, []],
    ["$[?null < 1]", OA, []],
    ["$[?$.arr < $.arr]", OA, []],
    ["$[?$.obj < $.arr]", OA, []],
    ["$[?1 < $.arr]", OA, []],
    ["$[?@ < 'b']", ["a", "B", "b", "ba", "", "é", 1], ["a", "B", ""]],
  ]);
});

test("REQ-FI-006: !=, <=, > and >= follow from == and <", () => {
  checkValues([
    ["$[?1 <= 2]", OA, BOTH],
    ["$[?1 > 2]", OA, []],
    ["$[?'a' <= 'b']", OA, BOTH],
    ["$[?'a' > 'b']", OA, []],
    ["$[?$.obj <= $.arr]", OA, []],
    ["$[?$.obj <= $.obj]", OA, BOTH],
    ["$[?$.arr <= $.arr]", OA, BOTH],
    ["$[?1 <= $.arr]", OA, []],
    ["$[?1 >= $.arr]", OA, []],
    ["$[?1 > $.arr]", OA, []],
    ["$[?true <= true]", OA, BOTH],
    ["$[?true > true]", OA, []],
    ["$[?true >= true]", OA, BOTH],
    ["$[?null <= null]", OA, BOTH],
    ["$[?1 != '1']", OA, BOTH],
    ["$[?2 >= 1]", OA, BOTH],
    ["$[?1 >= 1.0]", OA, BOTH],
    ["$[?'b' > 'a']", OA, BOTH],
  ]);
});

test("REQ-FI-007: && binds tighter than ||, parentheses group, ! negates", () => {
  const four = [1, 2, 3, 4];
  checkValues([
    ["$[?@ < 2 || @ > 3]", four, [1, 4]],
    ["$[?@ > 1 && @ < 4]", four, [2, 3]],
    ["$[?@ == 1 || @ == 2 && @ == 3]", four, [1]],
    ["$[?(@ == 1 || @ == 2) && @ == 2]", four, [2]],
    ["$[?!(@ == 1 || @ == 2)]", four, [3, 4]],
    ["$[?!(@ == 1) && !(@ == 4)]", four, [2, 3]],
    ["$[?@ > 0 && @ < 10 && @ != 3]", four, [1, 2, 4]],
    ["$[?@ == 4 || @ == 3 || @ == 9]", four, [3, 4]],
    ["$[?@==1||@==2]", four, [1, 2]],
    ["$[?@>1&&@<4]", four, [2, 3]],
  ]);
});

test("REQ-FN-001: length counts code points, elements or members; otherwise Nothing", () => {
  const doc = ["a", "\u{1F600}", "é", "é", "", [1, [2, 3]], { a: 1, b: 2 }, 1, true, null];
  checkValues([
    ["$[?length(@) == 1]", doc, ["a", "\u{1F600}", "é"]],
    ["$[?length(@) == 2]", doc, ["é", [1, [2, 3]], { a: 1, b: 2 }]],
    ["$[?length(@) == 0]", doc, [""]],
    ["$[?length(@) == length(@.x)]", doc, [1, true, null]],
    ["$[?length(@.x) == 0]", doc, []],
    ["$[?length('\u{1F600}\u{1F600}') == 2]", [7], [7]],
  ]);
});

test("REQ-FN-002: count is the number of nodes, a node selected twice counted twice", () => {
  const doc = [[1, 2], [3], [], { a: 1, b: 2 }, 5];
  checkValues([
    ["$[?count(@.*) == 2]", doc, [[1, 2], { a: 1, b: 2 }]],
    ["$[?count(@.*) == 0]", doc, [[], 5]],
    ["$[?count(@) == 1]", doc, doc],
    ["$[?count(@[0, 0]) == 2]", doc, [[1, 2], [3]]],
    ["$[?count(@..*) == 2]", doc, [[1, 2], { a: 1, b: 2 }]],
    ["$[?count($[*]) == 5]", doc, doc],
  ]);
});

test("REQ-FN-003: value is the one node's value, and Nothing for none or several", () => {
  const doc = [{ c: "red" }, { a: { c: "red" } }, { c: "red", d: { c: "blue" } }, {}];
  checkValues([
    ["$[?value(@..c) == 'red']", doc, [{ c: "red" }, { a: { c: "red" } }]],
    ["$[?value(@.*) == 'red']", doc, [{ c: "red" }]],
    ["$[?value(@.x) == value(@.y)]", doc, doc],
    ["$[?value(@..c) != 'red']", doc, [{ c: "red", d: { c: "blue" } }, {}]],
  ]);
});

test("REQ-FN-004: match is a whole-string match, false for any bad argument", () => {
  const doc = ["abc", "abcd", "xabc", "ab\nc", 1, null];
  checkValues([
    ["$[?match(@, 'a.c')]", doc, ["abc"]],
    ["$[?match(@, 'a.*')]", doc, ["abc", "abcd"]],
    ["$[?match(@, '[')]", doc, []],
    ["$[?!match(@, '[')]", doc, ["abc", "abcd", "xabc", "ab\nc", 1, null]],
    ["$[?match(@, 1)]", doc, []],
    ["$[?match(1, '1')]", doc, []],
    ["$[?match(@.x, '.*')]", doc, []],
    ["$[?match(@, 'abc|xabc')]", doc, ["abc", "xabc"]],
    ["$[?match(@.date, '1974-05-..')]", [{ date: "1974-05-01" }, { date: "1974-05-1" }, { date: "1974-05-01x" }], [{ date: "1974-05-01" }]],
  ]);
});

test("REQ-FN-005: search is true when some substring matches", () => {
  const doc = ["abc", "xyz", "", "a\nb", "x^ay", 1];
  checkValues([
    ["$[?search(@, 'b')]", doc, ["abc", "a\nb"]],
    ["$[?search(@, '^a')]", doc, ["x^ay"]],
    ["$[?search(@, '')]", doc, ["abc", "xyz", "", "a\nb", "x^ay"]],
    ["$[?search(@, 'a.b')]", doc, []],
    ["$[?search(@, 'b|z')]", doc, ["abc", "xyz", "a\nb"]],
    ["$[?search(@, '[')]", doc, []],
  ]);
  assert.strictEqual(ask("$[?search(@, 'x')]", ["x"]).result?.values.length, 1);
});
