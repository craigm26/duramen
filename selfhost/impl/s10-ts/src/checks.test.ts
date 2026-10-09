// The checks of a record (REQ-CK-001 to 009) and the oracle's answers (REQ-OR-001 to 008),
// with the examples of the specification.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkOf, diagsOf, withEcho } from "./testkit.ts";

const lines = (...ls: string[]) => ls.join("\n") + "\n";

// A record with the echo oracle and the given lines as s.duramen.
const withOracle = (...ls: string[]) => withEcho({ "s.duramen": lines(...ls) });
const HEAD = ["duramen 0.1", "spec s 1", "oracle node echo.mjs", "op f", "  input x? json"];

test("REQ-CK-001: a requirement with no example and no table row gets T001 at its line", async () => {
  assert.deepEqual(
    await diagsOf({ "s.duramen": lines("duramen 0.1", "spec s 1", 'req A "a"', "  text", "    It MUST work.") }),
    ["s.duramen:3: error T001"],
  );
});

test("REQ-CK-002: IDs of requirements, open items, decisions and operations are unique; a second use is T007", async () => {
  const text = withOracle(
    ...HEAD,
    'req A "a"',
    "  example f {}",
    'req A "again"',
    "  example f {}",
    'open A "an open item may share a requirement\'s ID"',
    "  text",
    "    Open.",
    'open B "b"',
    "  text",
    "    Open.",
    'open B "b again"',
    "  text",
    "    Open.",
    'decision D-1 "d"',
    "  source s",
    'decision D-1 "d again"',
    "  source s",
    'req C "c"',
    "  decision D-1",
    "  example f {}",
  );
  assert.deepEqual(await diagsOf(text), ["s.duramen:8: error T007", "s.duramen:16: error T007", "s.duramen:21: error T007"]);
});

test("REQ-CK-002: a duplicate requirement or operation across files is T007 at the second", async () => {
  const files = withEcho({
    "a.duramen": lines(...HEAD, 'req A "a"', "  example f {}"),
    "b.duramen": lines("duramen 0.1", 'req A "a"', "  example f {}", "op f", "  input y? json"),
  });
  assert.deepEqual(await diagsOf(files), ["b.duramen:2: error T007", "b.duramen:4: error T007"]);
});

test("REQ-CK-003: each undeclared decision a requirement cites is T008 at its line, once", async () => {
  const text = withOracle(
    ...HEAD,
    'decision D-1 "d"',
    "  source s",
    'req A "a"',
    "  decision D-1 D-2, D-3",
    "  decision D-2",
    "  example f {}",
  );
  assert.deepEqual(await diagsOf(text), ["s.duramen:8: error T008", "s.duramen:8: error T008"]);
});

test("REQ-CK-004: an example of an undeclared op is T009; a missing required input is T010; an extra one is T011", async () => {
  const text = withOracle(
    "duramen 0.1",
    "spec s 1",
    "oracle node echo.mjs",
    "op f",
    "  input a number, b? number",
    "errors",
    "  e when never",
    'req A "a"',
    '  example g {"a": 1}',
    '  example f {"b": 1}',
    '  example f {"a": 1, "c": 2}',
    "  example f",
    '  example g {"answer": {"error": "e"}}',
    '    expect error = "e"',
    "  example raw '{\"id\": \"A#6\", \"op\": \"g\"}'",
    "  table f",
    "    | b | c |",
    "    | 1 | 2 |",
    "  example g {}",
    '    expect error.code = "e"',
  );
  assert.deepEqual(await diagsOf(text), [
    "s.duramen:9: error T009",
    "s.duramen:10: error T010",
    "s.duramen:11: warning T011",
    "s.duramen:12: error T010",
    "s.duramen:18: error T010",
    "s.duramen:18: warning T011",
    "s.duramen:19: error T009",
  ]);
});

test("REQ-CK-005: an expected error code that is not declared under errors is T023", async () => {
  const text = withOracle(
    "duramen 0.1",
    "spec s 1",
    "oracle node echo.mjs",
    "op f",
    "  input answer? json",
    "errors",
    "  e when never",
    'req A "a"',
    '  example f {"answer": {"error": "e"}}',
    '    expect error = "e"',
    '  example f {"answer": {"error": "nope"}}',
    '    expect error = "nope"',
    '  example raw \'{"id": "r", "op": "f", "input": {"answer": {"error": "other"}}}\'',
    '    expect error = "other"',
    '  example f {"answer": {"error": "e"}}',
    "    expect error = ?",
  );
  assert.deepEqual(await diagsOf(text), ["s.duramen:12: error T023", "s.duramen:14: error T023"]);
});

test("REQ-CK-006: obligation words outside requirements are T004; quotations and titles are not checked", async () => {
  const text = [
    "duramen 0.1",
    "spec s 1",
    "  text",
    "    The program MUST work.",
    "op f",
    "  result what it MUST return",
    "errors",
    "  e when it SHALL fail",
    'section S "It MUST be titled"',
    "  text",
    "    REQUIRED reading.",
    "note",
    "  text",
    "    This note says `MUST`, \"SHALL\" and “REQUIRED”, MUSTARD and must.",
    'decision D-1 "d"',
    "  source s",
    "  text",
    "    Fine.",
    '  rejected "Another MUST."',
    'open O "o"',
    "  text",
    "    It MUST NOT be.",
    "",
  ].join("\n");
  assert.deepEqual(await diagsOf({ "s.duramen": text }), [
    "s.duramen:2: error T004",
    "s.duramen:5: error T004",
    "s.duramen:8: error T004",
    "s.duramen:9: error T004",
    "s.duramen:15: error T004",
    "s.duramen:15: warning T012",
    "s.duramen:20: warning T014",
  ]);
});

test("REQ-CK-006: a MUST inside a quotation on one line is not an obligation; across lines it is", async () => {
  assert.deepEqual(
    await diagsOf({
      "s.duramen": 'duramen 0.1\nspec s 1\nerrors\n  e when the "MUST\n    hold" rule fails\n  f when the "MUST hold" rule fails\nnote\n  text\n    A MUST-have.\nsection S "s"\n  text\n    MUSTé\n',
    }),
    ["s.duramen:4: error T004", "s.duramen:7: error T004", "s.duramen:10: error T004"],
  );
});

test("REQ-CK-007: an example or table clause of an open item is T003, and its lines are not read", async () => {
  assert.deepEqual(
    await diagsOf({
      "s.duramen": lines(
        "duramen 0.1",
        "spec s 1",
        'open O "o"',
        "  example f {}",
        "  table f",
        "    | x |",
        "    | 1 |",
        "  example f {not json",
        "    expect nothing at all",
        "  table g h",
        "    | {bad |",
      ),
    }),
    ["s.duramen:4: error T003", "s.duramen:5: error T003", "s.duramen:8: error T003", "s.duramen:10: error T003"],
  );
});

test("REQ-CK-008: a requirement that orders two declared errors with a phrase like 'before' is T005 at its text line", async () => {
  const text = withOracle(
    ...HEAD,
    "errors",
    "  too_big when x > 9",
    "  too_small when x < 0",
    'req A "a"',
    "  text",
    "    A request that is too_big gets too_big, and one too_small gets too_small.",
    "  example f {}",
    'req B "b"',
    "  text",
    "    too_big is checked Before too_small.",
    "  example f {}",
    'req C "c"',
    "  text",
    "    too_big is checked first.",
    "    After that, nothing.",
    "  example f {}",
    'req D "d"',
    "  text",
    "    too_big and too_small are checked in this",
    "    order.",
    "  example f {}",
  );
  assert.deepEqual(await diagsOf(text), ["s.duramen:14: error T005", "s.duramen:23: error T005"]);
});

test("REQ-CK-008: a requirement that names only one code, or names codes that are not declared, is not T005", async () => {
  const text = withOracle(
    ...HEAD,
    "errors",
    "  e when x",
    "  f when y",
    'req A "a"',
    "  text",
    "    A request may be refused before it is read: see the errors list.",
    "  example f {}",
  );
  assert.deepEqual(await diagsOf(text), []);
});

test("REQ-CK-009: decisions with no citation or no source are warnings; a bad status is T027", async () => {
  const text = withOracle(
    ...HEAD,
    'decision D-1 "uncited, no source"',
    'decision D-2 "bad status"',
    "  source s",
    "  status Accepted",
    'decision D-3 "superseded by nothing"',
    "  source s",
    "  status superseded",
    'decision D-4 "superseded by an undeclared one"',
    "  source s",
    "  status superseded by D-9",
    'decision D-5 "superseded properly"',
    "  source s",
    "  status superseded by D-6",
    'decision D-6 "accepted, with more words"',
    "  source s",
    "  status accepted on 2026-01-01",
    'decision D-7 "observed"',
    "  source s",
    "  status observed",
    'req A "a"',
    "  decision D-2, D-3, D-4, D-5, D-6, D-7",
    "  example f {}",
  );
  assert.deepEqual(await diagsOf(text), [
    "s.duramen:6: warning T012",
    "s.duramen:6: warning T013",
    "s.duramen:7: error T027",
    "s.duramen:10: error T027",
    "s.duramen:13: error T027",
    "s.duramen:25: error T028",
    "s.duramen:25: error T028",
    "s.duramen:25: error T028",
    "s.duramen:25: warning T028",
  ]);
});

test("REQ-CK-009: a status with a comma after its word, or an empty source, does not count", async () => {
  const text = withOracle(
    ...HEAD,
    'decision D-1 "a comma after the word"',
    "  source s",
    "  status accepted, 2026-01-01",
    'decision D-2 "an empty status"',
    "  source",
    "  status",
    'req A "a"',
    "  decision D-1, D-2",
    "  example f {}",
  );
  assert.deepEqual(await diagsOf(text), ["s.duramen:6: error T027", "s.duramen:9: warning T013", "s.duramen:9: error T027"]);
});

test("REQ-CK-009: a requirement resting on a superseded decision is T028; a superseded status with two spaces is T027", async () => {
  assert.deepEqual(
    await diagsOf({
      "s.duramen": lines(
        "duramen 0.1",
        "spec s 1",
        "req A \"a\"",
        "  decision D, E",
        "  text",
        "    T.",
        'decision D "d"',
        "  source x",
        "  status superseded  by E",
        'decision E "e"',
        "  source x",
        "  status Accepted",
      ),
    }),
    ["s.duramen:3: error T001", "s.duramen:3: error T028", "s.duramen:7: error T027", "s.duramen:10: error T027"],
  );
});

test("REQ-OR-001: a record with examples and no oracle gets T019 at its spec line; none of its examples runs", async () => {
  assert.deepEqual(
    await diagsOf({ "s.duramen": lines("duramen 0.1", "spec s 1", "op f", "  input x? json", 'req A "a"', "  example f {}", "    expect result = 1") }),
    ["s.duramen:2: error T019"],
  );
  assert.deepEqual(
    await diagsOf({
      "s.duramen": lines("duramen 0.1", "spec s 1", "op f", "  input x? json", 'req A "a"', "  text", "    No example.", 'req B "b"', "  example f {}"),
    }),
    ["s.duramen:2: error T019", "s.duramen:5: error T001"],
  );
});

test("REQ-OR-002: the oracle gets the request line, with the spec's request members and the example's input as written", async () => {
  const text = withOracle(
    "duramen 0.1",
    "spec s 1",
    '  request {"clock": 1}',
    "oracle node echo.mjs",
    "op f",
    '  input line? boolean, x? json',
    'req A "a"',
    '  example f {"line": true,  "x": 2.50}',
    '    expect result = "{\\"id\\":\\"A#1\\",\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true,  \\"x\\": 2.50}}"',
    '  example f {"line": true}',
    "    omit id",
    '    expect result = "{\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true}}"',
    '  example raw \'{"id": "x",  "op": "f", "input": {"line": true}}\'',
    '    expect id = "x"',
    '    expect result = "{\\"id\\": \\"x\\",  \\"op\\": \\"f\\", \\"input\\": {\\"line\\": true}}"',
  );
  assert.deepEqual(await diagsOf(text), []);
});

test("REQ-OR-002: an oracle command with a quoted word holds a space; the folder is the one of the file", async () => {
  assert.deepEqual(
    await diagsOf({
      "sub/s.duramen": lines("duramen 0.1", "spec s 1", 'oracle node "my echo.mjs"', "op f", "  input x? json", 'req A "a"', '  example f {"x": 1}', "    expect result.x = 1"),
      "sub/my echo.mjs": withEcho({})["echo.mjs"],
    }),
    [],
  );
});

test("REQ-OR-003: each expectation the response does not hold is T002, once per failing expectation", async () => {
  const text = withOracle(
    ...HEAD.slice(0, 4),
    "  input x? json, y? json, answer? json",
    'req A "a"',
    '  example f {"x": 1.0, "y": [5, {"z": null}]}',
    '    expect result = {"y": [5, {"z": null}], "x": 1}',
    "    expect result.y.1.z = null",
    "    expect result.y.0 ≈ 5.5 ± 0.5",
    "    expect result.x = 2",
    "    expect result.y.2 = 5",
    "    expect result.y.0 ≈ 5.5 ± 0.4",
    "    expect result.y.1 = {}",
    '  example f {"answer": {"result": 0, "audit": "{\\"a\\": [1, 2]}"}}',
    "    expect audit.a.1 = 2",
    '    expect audit = "{\\"a\\": [1, 2]}"',
    "    expect audit.b = 1",
    "  table f",
    "    | x | result.x | result.y |",
    "    | 1 | 2        | 3        |",
    '  example f {"x": {"": 1}}',
    "    expect result.x. = 1",
    "    expect result..x = 1",
    '  example f {"y": [7, 8]}',
    "    expect result.y.1 = 8",
    "    expect result.y.length = 2",
    "    expect result.y.01 = 8",
  );
  assert.deepEqual(await diagsOf(text), [
    "s.duramen:11: error T002",
    "s.duramen:12: error T002",
    "s.duramen:13: error T002",
    "s.duramen:14: error T002",
    "s.duramen:18: error T002",
    "s.duramen:21: error T002",
    "s.duramen:21: error T002",
    "s.duramen:24: error T002",
    "s.duramen:27: error T002",
    "s.duramen:28: error T002",
  ]);
});

test("REQ-OR-003: an error expectation is checked against the response's error", async () => {
  const text = withOracle(
    ...HEAD.slice(0, 4),
    "  input answer? json",
    "errors",
    "  e when never",
    'req A "a"',
    '  example f {"answer": {"result": 1}}',
    '    expect error = "e"',
    '  example g {"answer": {"error": "e"}}',
    '    expect error = "e"',
  );
  assert.deepEqual(await diagsOf(text), ["s.duramen:10: error T002"]);
});

test("REQ-OR-004: an oracle that cannot be started is T020 at its line, and each example without an answer is T021", async () => {
  assert.deepEqual(
    await diagsOf({ "s.duramen": lines("duramen 0.1", "spec s 1", "oracle no-such-program-for-duramen", "op f", "  input x? json", 'req A "a"', "  example f {}") }),
    ["s.duramen:3: error T020", "s.duramen:7: error T021"],
  );
});

test("REQ-OR-004: an oracle that exits with a status other than 0 is T020; the answers that arrived are used", async () => {
  const text = withOracle(
    ...HEAD.slice(0, 4),
    "  input x? json, exit? integer",
    'req A "a"',
    '  example f {"x": 1}',
    "    expect result.x = 2",
    '  example f {"exit": 3}',
    "    expect result.exit = 3",
  );
  assert.deepEqual(await diagsOf(text), ["s.duramen:3: error T020", "s.duramen:8: error T002"]);
});

test("REQ-OR-004: a raw example that is sent alone gets T020 at its own line when the oracle exits badly", async () => {
  const text = withOracle(
    ...HEAD.slice(0, 4),
    "  input exit? integer",
    'req A "a"',
    "  example f {}",
    '  example raw \'{"id": "r", "op": "f", "input": {"exit": 4}}\'',
  );
  assert.deepEqual(await diagsOf(text), ["s.duramen:8: error T020"]);
});

test("REQ-OR-004: an unclosed quote in the oracle command means it cannot be started", async () => {
  assert.deepEqual(
    await diagsOf({ "s.duramen": lines("duramen 0.1", "spec s 1", 'oracle node "echo.mjs', "op f", "  input x? json", 'req A "a"', "  example f {}") }),
    ["s.duramen:3: error T020", "s.duramen:7: error T021"],
  );
});

test("REQ-OR-005: an example with no response is T021 at its line; a response with a number too large is no response", async () => {
  const text = withOracle(
    ...HEAD.slice(0, 4),
    "  input silent? boolean",
    'req A "a"',
    '  example f {"silent": true}',
    "  example f {}",
    '  example raw \'{"id": "r", "op": "f", "input": {"silent": true}}\'',
  );
  assert.deepEqual(await diagsOf(text), ["s.duramen:7: error T021", "s.duramen:9: error T021"]);
  const big = withOracle(
    ...HEAD.slice(0, 4),
    "  input say string",
    'req A "a"',
    '  example f {"say": "{\\"id\\":\\"A#1\\",\\"result\\":1e400}"}',
    "    expect result = ?",
    '  example f {"say": "{\\"id\\":\\"A#2\\",\\"result\\":1e300}"}',
    "    expect result = ?",
  );
  assert.deepEqual(await diagsOf(big), ["s.duramen:7: error T021"]);
});

test("REQ-OR-006: a response holding oracle_error gets T022, and its expectations are not checked", async () => {
  const text = withOracle(
    ...HEAD.slice(0, 4),
    "  input answer? json",
    'req A "a"',
    '  example f {"answer": {"oracle_error": "left open"}}',
    "    expect result = 1",
    "    expect result = ?",
  );
  assert.deepEqual(await diagsOf(text), ["s.duramen:7: error T022"]);
});

test("REQ-OR-007: an answer that is an error for an example with no expectation is the warning T024", async () => {
  const text = withOracle(
    ...HEAD.slice(0, 4),
    "  input answer? json",
    "errors",
    "  e when never",
    'req A "a"',
    '  example f {"answer": {"error": "e"}}',
    '  example f {"answer": {"error": "e"}}',
    '    expect error = "e"',
  );
  assert.deepEqual(await checkOf(text), {
    diagnostics: ["s.duramen:9: warning T024"],
    errors: 0,
    warnings: 1,
  });
});

test("REQ-OR-008: expect <path> = ? takes the oracle's value; a path it does not hold is T025", async () => {
  const text = withOracle(
    ...HEAD,
    'req A "a"',
    '  example f {"x": 1}',
    "    expect result.x = ?",
    "    expect result.y = ?",
  );
  assert.deepEqual(await diagsOf(text), ["s.duramen:9: error T025"]);
});
