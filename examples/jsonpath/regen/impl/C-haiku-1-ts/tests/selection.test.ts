// REQ-SE-001 to REQ-SE-009 and REQ-NP-001, REQ-NP-002: what a query selects, and in what
// order, with the Normalized Path of each node. Rows are taken from the tables in SPEC.md.

import assert from "node:assert";
import { test } from "node:test";
import { ask, pathsOf, valuesOf } from "./support.ts";

// Each row: query, document, the values selected, and the Normalized Paths of those nodes.
type Row = [string, unknown, unknown[], string[]];

function check(rows: Row[]): void {
  for (const [query, doc, values, paths] of rows) {
    const r = ask(query, doc);
    assert.ok(r.result !== undefined, `${query} gave ${r.error}`);
    assert.deepStrictEqual(r.result.values, values, query);
    assert.deepStrictEqual(r.result.paths, paths, query);
  }
}

const OBJ = { o: { j: 1, k: 2 }, a: [5, 3, [{ j: 4 }, { k: 6 }]] };
const LETTERS = ["a", "b", "c", "d", "e", "f", "g"];

test("REQ-SE-001: $ selects the document itself, at the path $", () => {
  check([["$", { k: "v" }, [{ k: "v" }], ["$"]]]);
  assert.deepStrictEqual(pathsOf("$", [1, { a: 2 }]), ["$"]);
});

test("REQ-SE-002: a name selects the one member with that exact name", () => {
  check([
    ["$.a", { a: 1 }, [1], ["$['a']"]],
    ["$.A", { a: 1 }, [], []],
    ["$['a']", ["a"], [], []],
    ["$['0']", ["x"], [], []],
    ["$['0']", { 0: "x" }, ["x"], ["$['0']"]],
    ["$.a", "a", [], []],
    ["$['\u00e9']", { "e\u0301": 1 }, [], []],
    ["$['e\u0301']", { "e\u0301": 1, "\u00e9": 2 }, [1], ["$['e\u0301']"]],
    ["$['\u00e9']", { "e\u0301": 1, "\u00e9": 2 }, [2], ["$['\u00e9']"]],
    ["$['']", { "": 1 }, [1], ["$['']"]],
    ["$.constructor", {}, [], []],
    ["$.toString", { a: 1 }, [], []],
    ["$.__proto__", { ["__proto__"]: 1 }, [1], ["$['__proto__']"]],
  ]);
});

test("REQ-SE-003: a wildcard selects the children, objects by name order", () => {
  check([
    ["$[*]", [3, 1, 2], [3, 1, 2], ["$[0]", "$[1]", "$[2]"]],
    ["$.*", { b: 1, a: 2 }, [2, 1], ["$['a']", "$['b']"]],
    ["$.*", 5, [], []],
    ["$.*", "ab", [], []],
    ["$[*]", [], [], []],
    ["$[*]", {}, [], []],
    ["$.*.*", { x: [1, 2], y: { z: 3 } }, [1, 2, 3], ["$['x'][0]", "$['x'][1]", "$['y']['z']"]],
  ]);
});

test("REQ-SE-004: an index selects an element, counting from the end when negative", () => {
  check([
    ["$[0]", ["a", "b"], ["a"], ["$[0]"]],
    ["$[-1]", ["a", "b"], ["b"], ["$[1]"]],
    ["$[2]", ["a", "b"], [], []],
    ["$[-3]", ["a", "b"], [], []],
    ["$[0]", { 0: "a" }, [], []],
    ["$[0]", "ab", [], []],
    ["$[0][1]", [[1, 2]], [2], ["$[0][1]"]],
  ]);
});

test("REQ-SE-005: slices, with defaults, negative bounds and step rules", () => {
  const cases: Array<[string, unknown[]]> = [
    ["$[1:3]", ["b", "c"]],
    ["$[5:]", ["f", "g"]],
    ["$[:2]", ["a", "b"]],
    ["$[-2:]", ["f", "g"]],
    ["$[:-5]", ["a", "b"]],
    ["$[1:5:2]", ["b", "d"]],
    ["$[5:1:-2]", ["f", "d"]],
    ["$[::-1]", ["g", "f", "e", "d", "c", "b", "a"]],
    ["$[::3]", ["a", "d", "g"]],
    ["$[::-3]", ["g", "d", "a"]],
    ["$[1:1]", []],
    ["$[3:1]", []],
    ["$[3:1:-1]", ["d", "c"]],
    ["$[0:7:0]", []],
    ["$[::0]", []],
    ["$[10:]", []],
    ["$[-10:2]", ["a", "b"]],
    ["$[:100]", LETTERS],
    ["$[-1:-10:-1]", ["g", "f", "e", "d", "c", "b", "a"]],
    ["$[6:-8:-2]", ["g", "e", "c", "a"]],
    ["$[:0]", []],
    ["$[:-7]", []],
    ["$[-10::-1]", []],
    ["$[10::-1]", ["g", "f", "e", "d", "c", "b", "a"]],
    ["$[7:0:-1]", ["g", "f", "e", "d", "c", "b"]],
    ["$[-9007199254740991:9007199254740991:9007199254740991]", ["a"]],
  ];
  for (const [query, expected] of cases) {
    assert.deepStrictEqual(valuesOf(query, LETTERS), expected, query);
  }
  assert.deepStrictEqual(pathsOf("$[5:1:-2]", LETTERS), ["$[5]", "$[3]"]);
  assert.deepStrictEqual(valuesOf("$[0:2]", { 0: 1, 1: 2 }), []);
  assert.deepStrictEqual(valuesOf("$[:]", "abc"), []);
});

test("REQ-SE-006: each selector of a bracket applies to each node, in the order written", () => {
  check([
    ["$[0, 3]", LETTERS, ["a", "d"], ["$[0]", "$[3]"]],
    ["$[3, 0]", LETTERS, ["d", "a"], ["$[3]", "$[0]"]],
    ["$[0:2, 5]", LETTERS, ["a", "b", "f"], ["$[0]", "$[1]", "$[5]"]],
    ["$[0, 0]", LETTERS, ["a", "a"], ["$[0]", "$[0]"]],
    ["$[*, 0]", ["a", "b"], ["a", "b", "a"], ["$[0]", "$[1]", "$[0]"]],
    ["$['b', 'a']", { a: 1, b: 2 }, [2, 1], ["$['b']", "$['a']"]],
    ["$['a', 0]", { a: 1 }, [1], ["$['a']"]],
    ["$['a', 0]", [5], [5], ["$[0]"]],
    ["$[*][0]", [[1, 2], [3], [], 4], [1, 3], ["$[0][0]", "$[1][0]"]],
    ["$[1, 0][0]", [["a"], ["b"]], ["b", "a"], ["$[1][0]", "$[0][0]"]],
  ]);
});

test("REQ-SE-007: a descendant segment visits each node before its descendants", () => {
  check([
    ["$..j", OBJ, [4, 1], ["$['a'][2][0]['j']", "$['o']['j']"]],
    ["$..[0]", OBJ, [5, { j: 4 }], ["$['a'][0]", "$['a'][2][0]"]],
    [
      "$..*",
      OBJ,
      [[5, 3, [{ j: 4 }, { k: 6 }]], { j: 1, k: 2 }, 5, 3, [{ j: 4 }, { k: 6 }], { j: 4 }, { k: 6 }, 4, 6, 1, 2],
      [
        "$['a']",
        "$['o']",
        "$['a'][0]",
        "$['a'][1]",
        "$['a'][2]",
        "$['a'][2][0]",
        "$['a'][2][1]",
        "$['a'][2][0]['j']",
        "$['a'][2][1]['k']",
        "$['o']['j']",
        "$['o']['k']",
      ],
    ],
    ["$..o", OBJ, [{ j: 1, k: 2 }], ["$['o']"]],
    ["$.o..[*, *]", OBJ, [1, 2, 1, 2], ["$['o']['j']", "$['o']['k']", "$['o']['j']", "$['o']['k']"]],
    ["$.a..[0, 1]", OBJ, [5, 3, { j: 4 }, { k: 6 }], ["$['a'][0]", "$['a'][1]", "$['a'][2][0]", "$['a'][2][1]"]],
    ["$..a", { a: { a: 1 } }, [{ a: 1 }, 1], ["$['a']", "$['a']['a']"]],
    ["$..*", 1, [], []],
    ["$..*", [], [], []],
    ["$..[*]", [[[1]]], [[[1]], [1], 1], ["$[0]", "$[0][0]", "$[0][0][0]"]],
    ["$..['a','b']", { b: { a: 1 }, a: 2 }, [2, { a: 1 }, 1], ["$['a']", "$['b']", "$['b']['a']"]],
    ["$..[?@ > 1]", [1, [2, 3]], [2, 3], ["$[1][0]", "$[1][1]"]],
  ]);
});

test("REQ-SE-008: object members are taken in ascending code point order", () => {
  check([
    ["$.*", { b: 1, a: 2, B: 3 }, [3, 2, 1], ["$['B']", "$['a']", "$['b']"]],
    ["$.*", { 10: 1, 9: 2, 1: 3 }, [3, 1, 2], ["$['1']", "$['10']", "$['9']"]],
    ["$.*", { ab: 1, a: 2, "": 3 }, [3, 2, 1], ["$['']", "$['a']", "$['ab']"]],
    [
      "$.*",
      { "\u{1F600}": 1, "\uffff": 2, "\u00e9": 3, z: 4 },
      [4, 3, 2, 1],
      ["$['z']", "$['\u00e9']", "$['\uffff']", "$['\u{1F600}']"],
    ],
    ["$[?@ > 0]", { b: 1, a: 2 }, [2, 1], ["$['a']", "$['b']"]],
    [
      "$..*",
      { b: { y: 1, x: 2 }, a: [3] },
      [[3], { x: 2, y: 1 }, 3, 2, 1],
      ["$['a']", "$['b']", "$['a'][0]", "$['b']['x']", "$['b']['y']"],
    ],
  ]);
});

test("REQ-SE-009: null is a value, selected like any other", () => {
  check([
    ["$.a", { a: null }, [null], ["$['a']"]],
    ["$[?@.a == null]", [{ a: null }, {}], [{ a: null }], ["$[0]"]],
    ["$[?@.a]", [{ a: null }, {}], [{ a: null }], ["$[0]"]],
    ["$[*]", [null, null], [null, null], ["$[0]", "$[1]"]],
  ]);
});

test("REQ-NP-001: a Normalized Path names exactly its node, with indexes never negative", () => {
  check([
    ["$.a", { a: 1 }, [1], ["$['a']"]],
    ["$[1]", [0, 1], [1], ["$[1]"]],
    ["$[-3]", [0, 1, 2, 3, 4], [2], ["$[2]"]],
    ["$.a.b[1:2]", { a: { b: [0, 1, 2] } }, [1], ["$['a']['b'][1]"]],
    ["$[\"\\u000B\"]", { "\u000b": 1 }, [1], ["$['\\u000b']"]],
    ["$[\"\\u0061\"]", { a: 1 }, [1], ["$['a']"]],
    ["$[10]", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [10], ["$[10]"]],
    ["$..x", { x: { x: 1 } }, [{ x: 1 }, 1], ["$['x']", "$['x']['x']"]],
  ]);
});

test("EV-EV-RFC: the first published RFC 9535 examples that SPEC.md gives", () => {
  const doc = { "'": { "@": 2 }, o: { "j j": { "k.k": 3 } } };
  check([
    ["$", { k: "v" }, [{ k: "v" }], ["$"]],
    ["$.o['j j']", doc, [{ "k.k": 3 }], ["$['o']['j j']"]],
    ["$.o['j j']['k.k']", doc, [3], ["$['o']['j j']['k.k']"]],
    ['$.o["j j"]["k.k"]', doc, [3], ["$['o']['j j']['k.k']"]],
    ['$["\'"]["@"]', doc, [2], ["$['\\'']['@']"]],
    ["$.o[*]", { a: [5, 3], o: { j: 1, k: 2 } }, [1, 2], ["$['o']['j']", "$['o']['k']"]],
    ["$.a[*]", { a: [5, 3], o: { j: 1, k: 2 } }, [5, 3], ["$['a'][0]", "$['a'][1]"]],
    ["$[1]", ["a", "b"], ["b"], ["$[1]"]],
  ]);
});

test("REQ-NP-002: names in Normalized Paths escape only the listed code points", () => {
  const paths = (name: string): string[] => pathsOf("$.*", { [name]: 1 });
  assert.deepStrictEqual(paths("'"), ["$['\\'']"]);
  assert.deepStrictEqual(paths("\\"), ["$['\\\\']"]);
  assert.deepStrictEqual(paths('"'), ["$['\"']"]);
  assert.deepStrictEqual(paths("/"), ["$['/']"]);
  assert.deepStrictEqual(paths("\b"), ["$['\\b']"]);
  assert.deepStrictEqual(paths("\t"), ["$['\\t']"]);
  assert.deepStrictEqual(paths("\n"), ["$['\\n']"]);
  assert.deepStrictEqual(paths("\f"), ["$['\\f']"]);
  assert.deepStrictEqual(paths("\r"), ["$['\\r']"]);
  assert.deepStrictEqual(paths("\u0000"), ["$['\\u0000']"]);
  assert.deepStrictEqual(paths("\u000b"), ["$['\\u000b']"]);
  assert.deepStrictEqual(paths("\u001f"), ["$['\\u001f']"]);
  assert.deepStrictEqual(paths("\u007f"), ["$['\u007f']"]);
  assert.deepStrictEqual(paths("\u0085"), ["$['\u0085']"]);
  assert.deepStrictEqual(paths("\u2028"), ["$['\u2028']"]);
  assert.deepStrictEqual(paths("\u{1F600}"), ["$['\u{1F600}']"]);
  assert.deepStrictEqual(paths("a'b\\c"), ["$['a\\'b\\\\c']"]);
  assert.deepStrictEqual(paths("\u00e9"), ["$['\u00e9']"]);
});
