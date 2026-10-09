// The suite: no cases from a record with errors, one case per example, request lines, checks
// and the oracle's whole answer (REQ-SU-001 to REQ-SU-005).

import { test } from "node:test";
import assert from "node:assert/strict";
import { casesOf, withEcho } from "./testkit.ts";

const lines = (...ls: string[]) => ls.join("\n") + "\n";
type Case = Record<string, unknown>;

test("REQ-SU-001: a record with errors gets no cases, and the number of errors", async () => {
  assert.deepEqual(await casesOf({ "s.duramen": "frobnicate\n" }), { cases: [], errors: 3 });
  assert.deepEqual(
    await casesOf({ "s.duramen": lines("duramen 0.1", "spec s 1", 'req A "a"', "  text", "    Nothing to show.") }),
    { cases: [], errors: 1 },
  );
});

test("REQ-SU-001: a record without errors gets its cases; warnings do not stop the suite", async () => {
  const r = await casesOf(
    withEcho({ "s.duramen": lines("duramen 0.1", "spec s 1", "oracle node echo.mjs", "op f", "  input x? json", 'req A "a"', '  example f {"y": 1}') }),
  );
  assert.equal(r.errors, 0);
  assert.equal(r.cases[0].id, "A#1");
});

test("REQ-SU-002: one case per example and table row, in record order, with its requirement, platform and checks", async () => {
  const r = await casesOf(
    withEcho({
      "s.duramen": lines(
        "duramen 0.1",
        "spec s 1",
        "oracle node echo.mjs",
        "op f",
        "  input x? json",
        'req A "a"',
        '  example f {"x": 1}',
        "    expect result.x = 1",
        'req B "b"',
        "  on posix",
        "  table f",
        "    | x | result.x |",
        "    | 2 | 2        |",
        "    | 3 | ?        |",
      ),
    }),
  );
  assert.equal(r.errors, 0);
  assert.deepEqual(r.cases, [
    {
      checks: [{ kind: "eq", path: "result.x", value: 1 }],
      full: { members: ["id", "result"], result: { x: 1 }, tolerances: {} },
      id: "A#1",
      kind: "example",
      line: '{"id":"A#1","op":"f","input":{"x": 1}}',
      platform: "any",
      reqs: ["REQ-A"],
    },
    {
      checks: [{ kind: "eq", path: "result.x", value: 2 }],
      full: { members: ["id", "result"], result: { x: 2 }, tolerances: {} },
      id: "B#1",
      kind: "example",
      line: '{"id":"B#1","op":"f","input":{"x":2}}',
      platform: "posix",
      reqs: ["REQ-B"],
    },
    {
      checks: [{ from: "oracle", kind: "eq", path: "result.x", value: 3 }],
      full: { members: ["id", "result"], result: { x: 3 }, tolerances: {} },
      id: "B#2",
      kind: "example",
      line: '{"id":"B#2","op":"f","input":{"x":3}}',
      platform: "posix",
      reqs: ["REQ-B"],
    },
  ]);
});

test("REQ-SU-002: a table row's case is numbered after the requirement's earlier examples; the platform is the requirement's", async () => {
  const r = await casesOf(
    withEcho({
      "b.duramen": lines("duramen 0.1", 'req B "b"', "  on windows", "  example f {}"),
      "a.duramen": lines(
        "duramen 0.1",
        "spec s 1",
        "oracle node echo.mjs",
        "op f",
        "  input x? json",
        'req A "a"',
        "  example f {}",
        "  example f {}",
      ),
    }),
  );
  assert.equal(r.errors, 0);
  assert.deepEqual(r.cases.map((c) => c.id), ["A#1", "A#2", "B#1"]);
  assert.equal(r.cases[2].platform, "windows");
});

test("REQ-SU-003: request lines: id and op first, then members (spec, op, example, omits), then input as written", async () => {
  const r = await casesOf(
    withEcho({
      "s.duramen": lines(
        "duramen 0.1",
        "spec s 1",
        '  request {"clock": "c", "trace": true}',
        "oracle node echo.mjs",
        "op f",
        "  input x? json",
        "op g",
        "  input x? json",
        '  request {"mode": 2}',
        'req A "a"',
        '  example f {"x" : 2.50e0 }',
        "  example f",
        '  example f {"x": 1}',
        '    request {"trace": false, "user": "u"}',
        "    omit clock",
        '  example g {"x": 1}',
        "    omit id, input",
        '  example f {"x": 1}',
        "    omit op, id",
        "  example raw '{\"id\": \"A#6\",  \"op\": \"f\"}'",
        '  example f {"x": 1}',
        '    request {"b": {"z": 1, "10": 2, "9": 3}, "2": "two", "a": 1}',
        "    omit clock",
        "    omit trace",
        "  table f",
        "    | result |",
        "    | ?      |",
      ),
    }),
  );
  assert.equal(r.errors, 0);
  const line = (i: number) => (r.cases[i] as Case).line;
  assert.equal(line(0), '{"id":"A#1","op":"f","clock":"c","trace":true,"input":{"x" : 2.50e0 }}');
  assert.equal(line(1), '{"id":"A#2","op":"f","clock":"c","trace":true}');
  assert.equal(line(2), '{"id":"A#3","op":"f","trace":false,"user":"u","input":{"x": 1}}');
  assert.equal(line(3), '{"op":"g","mode":2}');
  assert.equal(line(4), '{"clock":"c","trace":true,"input":{"x": 1}}');
  assert.equal(line(5), '{"id": "A#6",  "op": "f"}');
  assert.equal(line(6), '{"id":"A#7","op":"f","2":"two","b":{"9":3,"10":2,"z":1},"a":1,"input":{"x": 1}}');
  assert.equal(line(7), '{"id":"A#8","op":"f","clock":"c","trace":true,"input":{}}');
  assert.equal((r.cases[3] as Case).solo, true);
  assert.equal((r.cases[4] as Case).solo, true);
  assert.equal((r.cases[5] as Case).solo, true);
  assert.equal((r.cases[0] as Case).solo, undefined);
});

test("REQ-SU-003: an example's input built from input lines is compact JSON; table cells are written as they are", async () => {
  const r = await casesOf(
    withEcho({
      "s.duramen": lines(
        "duramen 0.1",
        "spec s 1",
        "oracle node echo.mjs",
        "op f",
        "  input files? object, n? number",
        'req A "a"',
        '  example f {"n" : 1.50, "files": {"z": "old"}}',
        '    input files."a.duramen"',
        "      duramen 0.1",
        '      "quoted" é',
        "    input files.z",
        "      new",
        "  table f",
        "    | n      | files |",
        "    | 1.50   |       |",
        "    |        | {}    |",
      ),
    }),
  );
  assert.equal(r.errors, 0);
  assert.equal(
    (r.cases[0] as Case).line,
    '{"id":"A#1","op":"f","input":{"n":1.5,"files":{"z":"new\\n","a.duramen":"duramen 0.1\\n\\"quoted\\" é\\n"}}}',
  );
  assert.equal((r.cases[1] as Case).line, '{"id":"A#2","op":"f","input":{"n":1.50}}');
  assert.equal((r.cases[2] as Case).line, '{"id":"A#3","op":"f","input":{"files":{}}}');
});

test("REQ-SU-004: checks list the expectations in order: eq, approx, and oracle values", async () => {
  const r = await casesOf(
    withEcho({
      "s.duramen": lines(
        "duramen 0.1",
        "spec s 1",
        "oracle node echo.mjs",
        "op f",
        "  input x? json",
        'req A "a"',
        '  example f {"x": {"y": [1, 2]}}',
        "    expect result.x.y.0 = 1",
        "    expect result.x.y.1 ~ 2.1 +- 0.25",
        "    expect result.x = ?",
        '    expect id = "A#1"',
        "  table f",
        "    | x | result.x ± 0.5 |",
        "    | 2 | 2.25           |",
      ),
    }),
  );
  assert.equal(r.errors, 0);
  assert.deepEqual((r.cases[0] as Case).checks, [
    { kind: "eq", path: "result.x.y.0", value: 1 },
    { kind: "approx", path: "result.x.y.1", tol: 0.25, value: 2.1 },
    { from: "oracle", kind: "eq", path: "result.x", value: { y: [1, 2] } },
    { kind: "eq", path: "id", value: "A#1" },
  ]);
  assert.deepEqual((r.cases[1] as Case).checks, [{ kind: "approx", path: "result.x", tol: 0.5, value: 2.25 }]);
});

test("REQ-SU-005: full is the oracle's whole answer: members sorted, error, result, audit when declared, and tolerances", async () => {
  const r = await casesOf(
    withEcho({
      "s.duramen": lines(
        "duramen 0.1",
        "spec s 1",
        "oracle node echo.mjs",
        "op f",
        "  input answer? json",
        "  audit",
        "  tolerance result.t 0.5",
        "  tolerance result.u 0",
        "op g",
        "  input answer? json",
        "errors",
        "  e when never",
        'req A "a"',
        '  example f {"answer": {"result": {"t": 1}, "audit": "A"}}',
        '  example f {"answer": {"error": "e", "extra": 1}}',
        "    expect error = \"e\"",
        '  example g {"answer": {"result": 2, "audit": "B"}}',
        '  example h {"answer": {"error": "e"}}',
        '    expect error = "e"',
      ),
    }),
  );
  assert.equal(r.errors, 0);
  assert.deepEqual((r.cases[0] as Case).full, {
    audit: "A",
    members: ["audit", "id", "result"],
    result: { t: 1 },
    tolerances: { "result.t": 0.5, "result.u": 0 },
  });
  assert.deepEqual((r.cases[1] as Case).full, {
    error: "e",
    members: ["error", "extra", "id"],
    tolerances: { "result.t": 0.5, "result.u": 0 },
  });
  assert.deepEqual((r.cases[2] as Case).full, { members: ["audit", "id", "result"], result: 2, tolerances: {} });
  assert.deepEqual((r.cases[3] as Case).full, { error: "e", members: ["error", "id"], tolerances: {} });
});
