// REQ-RQ-001 to REQ-RQ-003, and the driver's line handling (SPEC.md, Driver protocol).
// These send raw request lines, so the checks run in the order SPEC.md gives.

import assert from "node:assert";
import { test } from "node:test";
import { answerLine } from "../protocol.ts";

// The response to one raw request line, parsed; fails the test for a blank line.
function reply(line: string): Record<string, unknown> {
  const out = answerLine(line);
  assert.notStrictEqual(out, null, `no response for ${JSON.stringify(line)}`);
  return JSON.parse(out as string) as Record<string, unknown>;
}

test("REQ-RQ-001: a request line that cannot be handled gets exactly id and error", () => {
  const cases: Array<[string, unknown, string]> = [
    ["{not json", null, "bad_request"],
    ["[1]", null, "bad_request"],
    ['{"op":"query","input":{"query":"$","document":1}}', null, "bad_request"],
    ['{"id":7,"op":"query","input":{"query":"$","document":1}}', null, "bad_request"],
    ['{"id":"r1","input":{"query":"$","document":1}}', "r1", "unknown_op"],
    ['{"id":"r1","op":"select","input":{"query":"$","document":1}}', "r1", "unknown_op"],
    ['{"id":"r1","op":"query"}', "r1", "bad_request"],
    ['{"id":"r1","op":"query","input":[]}', "r1", "bad_request"],
    ['{"id":"r1","op":"query","input":{"document":1}}', "r1", "bad_request"],
    ['{"id":"r1","op":"query","input":{"query":5,"document":1}}', "r1", "bad_request"],
    ['{"id":"r1","op":"query","input":{"query":"$"}}', "r1", "bad_request"],
    ['{"id":"r1","op":"query","input":{"query":"$[","document":1}}', "r1", "invalid_query"],
  ];
  for (const [line, id, error] of cases) {
    assert.deepStrictEqual(reply(line), { id, error }, line);
  }
});

test("REQ-RQ-001: the checks run in the order SPEC.md gives", () => {
  // Bad id beats everything; then op; then input; then the query text.
  assert.deepStrictEqual(reply('{"id":3,"op":"select","input":[]}'), { id: null, error: "bad_request" });
  assert.deepStrictEqual(reply('{"id":"r","op":"select","input":[]}'), { id: "r", error: "unknown_op" });
  assert.deepStrictEqual(reply('{"id":"r","op":"query","input":{"query":"$["}}'), { id: "r", error: "bad_request" });
});

test("REQ-RQ-001: a blank line gets no response, and the next line still does", () => {
  assert.strictEqual(answerLine(""), null);
  assert.strictEqual(answerLine(" \t "), null);
  assert.strictEqual(answerLine("\r"), null);
  assert.strictEqual(answerLine("\t\r"), null);
  assert.deepStrictEqual(reply('{"id":"a","op":"query","input":{"query":"$","document":1}}'), {
    id: "a",
    result: { values: [1], paths: ["$"] },
  });
});

test("REQ-RQ-002: the result holds values and paths of equal length, duplicates included", () => {
  const ok = (query: string, document: unknown) =>
    reply(JSON.stringify({ id: "r", op: "query", input: { query, document } })).result;
  assert.deepStrictEqual(ok("$", { k: "v" }), { paths: ["$"], values: [{ k: "v" }] });
  assert.deepStrictEqual(ok("$.x", { k: "v" }), { paths: [], values: [] });
  assert.deepStrictEqual(ok("$[0,0]", ["a"]), { paths: ["$[0]", "$[0]"], values: ["a", "a"] });
});

test("REQ-RQ-003: any JSON value is a document, and unnamed members are ignored", () => {
  const cases: Array<[string, unknown, unknown[], string[]]> = [
    ["$", null, [null], ["$"]],
    ["$", false, [false], ["$"]],
    ["$", "abc", ["abc"], ["$"]],
    ["$", 1.5, [1.5], ["$"]],
    ["$", [], [[]], ["$"]],
    ["$.*", 1, [], []],
    ["$[0]", "abc", [], []],
  ];
  for (const [query, document, values, paths] of cases) {
    const r = reply(JSON.stringify({ id: "r", op: "query", input: { query, document } }));
    assert.deepStrictEqual(r.result, { values, paths }, query);
  }
  const extra = reply('{"id":"r1","op":"query","trace":true,"input":{"query":"$.a","document":{"a":1},"flags":"x"}}');
  assert.deepStrictEqual(extra.result, { values: [1], paths: ["$['a']"] });
});

test("REQ-RQ-001: a line with a trailing CR is read as CRLF, and the response has no CR", () => {
  const out = answerLine('{"id":"a","op":"query","input":{"query":"$","document":1}}\r');
  assert.ok(out !== null && !out.includes("\r") && !out.includes("\n"));
});

test("Output keeps U+0085, U+2028 and U+2029 as escapes, so a line stays one line", () => {
  // Built from code points, so that this file holds no raw line separators.
  const nel = String.fromCharCode(0x85);
  const ls = String.fromCharCode(0x2028);
  const ps = String.fromCharCode(0x2029);
  const id = `a${ls}b${nel}c${ps}`;
  const out = answerLine(JSON.stringify({ id, op: "query", input: { query: "$", document: `x${ls}` } }));
  assert.ok(out !== null);
  assert.ok(![nel, ls, ps].some((c) => out.includes(c)));
  assert.deepStrictEqual(JSON.parse(out), { id, result: { values: [`x${ls}`], paths: ["$"] } });
});
