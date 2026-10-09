import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECHO, check, diags, one } from './helper.ts';

const H = 'duramen 0.1\nspec s 1\n';
const HE = H + 'oracle node echo.mjs\n';
const X = { 'echo.mjs': ECHO };

function table(rows: [string, string[]][]): void {
  rows.forEach(([text, expected], i) => {
    assert.deepEqual(one(text, X), expected, `row ${i}: ${JSON.stringify(text)}`);
  });
}

test('REQ-CK-001 every requirement has an example', () => {
  table([
    [H + 'req A "a"\n  text\n    It MUST work.\n', ['s.duramen:3: error T001']],
    [H + 'req A "a"\n  table f\n    | x |\n    |---|\n', ['s.duramen:4: error P013']],
  ]);
});

test('REQ-CK-002 IDs are unique', () => {
  table([
    [
      HE + 'op f\n  input x? json\nreq A "a"\n  example f {}\nreq A "again"\n  example f {}\nopen A "an open item may share a requirement\'s ID"\n  text\n    Open.\nopen B "b"\n  text\n    Open.\nopen B "b again"\n  text\n    Open.\ndecision D-1 "d"\n  source s\ndecision D-1 "d again"\n  source s\nreq C "c"\n  decision D-1\n  example f {}\n',
      ['s.duramen:8: error T007', 's.duramen:16: error T007', 's.duramen:21: error T007'],
    ],
    [
      HE + 'op f\n  input x? json\nreq A "a"\n  decision REQ-A, OPEN-B\n  example f {}\ndecision REQ-A "named like a requirement"\n  source s\ndecision OPEN-B "named like an open item"\n  source s\nopen B "b"\n  text\n    Open.\nreq A "a third time"\n  example f {}\nreq A "and a third"\n  example f {}\n',
      ['s.duramen:16: error T007', 's.duramen:18: error T007'],
    ],
  ]);
  assert.deepEqual(
    diags({
      'a.duramen': HE + 'op f\n  input x? json\nreq A "a"\n  example f {}\n',
      'b.duramen': 'duramen 0.1\nreq A "a"\n  example f {}\nop f\n  input y? json\n',
      'echo.mjs': ECHO,
    }),
    ['b.duramen:2: error T007', 'b.duramen:4: error T007'],
  );
});

test('REQ-CK-003 cited decisions are declared', () => {
  table([
    [
      HE + 'op f\n  input x? json\ndecision D-1 "d"\n  source s\nreq A "a"\n  decision D-1 D-2, D-3\n  decision D-2\n  example f {}\n',
      ['s.duramen:8: error T008', 's.duramen:8: error T008'],
    ],
  ]);
});

test('REQ-CK-004 examples of declared operations', () => {
  table([
    [
      HE +
        'op f\n  input a number, b? number\nerrors\n  e when never\nreq A "a"\n  example g {"a": 1}\n  example f {"b": 1}\n  example f {"a": 1, "c": 2}\n  example f\n  example g {"answer": {"error": "e"}}\n    expect error = "e"\n  example raw \'{"id": "A#6", "op": "g"}\'\n  table f\n    | b | c |\n    | 1 | 2 |\n  example g {}\n    expect error.code = "e"\n',
      [
        's.duramen:9: error T009', 's.duramen:10: error T010', 's.duramen:11: warning T011', 's.duramen:12: error T010',
        's.duramen:18: error T010', 's.duramen:18: warning T011', 's.duramen:19: error T009',
      ],
    ],
  ]);
});

test('REQ-CK-005 expected errors are declared', () => {
  table([
    [
      HE +
        'op f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n  example f {"answer": {"error": "e"}}\n    expect error = "e"\n  example f {"answer": {"error": "nope"}}\n    expect error = "nope"\n  example raw \'{"id": "r", "op": "f", "input": {"answer": {"error": "other"}}}\'\n    expect error = "other"\n  example f {"answer": {"error": "e"}}\n    expect error = ?\n',
      ['s.duramen:12: error T023', 's.duramen:14: error T023'],
    ],
    [
      HE +
        'op f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n  example f {"answer": {"error": 1}}\n    expect error ≈ 1 ± 0\n  table f\n    | answer           | error ± 1 |\n    | {"error": 2}     | 2         |\n    | {"error": "e"}   | ?         |\n',
      ['s.duramen:10: error T023', 's.duramen:13: error T023'],
    ],
  ]);
});

test('REQ-CK-006 obligations live in requirements', () => {
  assert.deepEqual(
    one(
      'duramen 0.1\nspec s 1\n  text\n    The program MUST work.\nop f\n  result what it MUST return\nerrors\n  e when it SHALL fail\nsection S "It MUST be titled"\n  text\n    REQUIRED reading.\nnote\n  text\n    This note says `MUST`, "SHALL" and “REQUIRED”, MUSTARD and must.\ndecision D-1 "d"\n  source s\n  text\n    Fine.\n  rejected "Another MUST."\nopen O "o"\n  text\n    It MUST NOT be.\n',
    ),
    [
      's.duramen:2: error T004', 's.duramen:5: error T004', 's.duramen:8: error T004', 's.duramen:9: error T004',
      's.duramen:15: error T004', 's.duramen:15: warning T012', 's.duramen:20: warning T014',
    ],
  );
  assert.deepEqual(
    one(H + 'decision D-1 "d"\n  source s\n  text\n    It MUST.\n  rejected "It SHALL."\n  rejected "It is REQUIRED."\n'),
    ['s.duramen:3: error T004', 's.duramen:3: error T004', 's.duramen:3: error T004', 's.duramen:3: warning T012'],
  );
  assert.deepEqual(
    one(H + 'errors\n  e when the "MUST\n    hold" rule fails\n  f when the "MUST hold" rule fails\nnote\n  text\n    A MUST-have.\nsection S "s"\n  text\n    MUSTé\n'),
    ['s.duramen:4: error T004', 's.duramen:7: error T004', 's.duramen:10: error T004'],
  );
  assert.deepEqual(one(H + 'section T "t"\n  text\n    It ``MUST`` be, and it `MUST` not.\n'), ['s.duramen:3: error T004']);
  assert.deepEqual(
    one(
      H + 'note\n  text\n    x`a`MUST\nnote\n  text\n    MU`a`ST, and "MU"ST\nnote\n  text\n    A"q"SHALL\ndecision D-1 "d"\n  source s\n  text\n    Fine.\n  rejected "\\"It\\nMUST\\" be"\n',
    ),
    ['s.duramen:3: error T004', 's.duramen:9: error T004', 's.duramen:12: error T004', 's.duramen:12: warning T012'],
  );
});

test('REQ-CK-007 open items are not tested', () => {
  assert.deepEqual(
    one(H + 'open O "o"\n  example f {}\n  table f\n    | x |\n    | 1 |\n  example f {not json\n    expect nothing at all\n  table g h\n    | {bad |\n'),
    ['s.duramen:4: error T003', 's.duramen:5: error T003', 's.duramen:8: error T003', 's.duramen:10: error T003'],
  );
});

test('REQ-CK-008 the order of errors is stated once', () => {
  const pre = HE + 'op f\n  input x? json\nerrors\n  too_big when x > 9\n  too_small when x < 0\n';
  table([
    [
      pre +
        'req A "a"\n  text\n    A request that is too_big gets too_big, and one too_small gets too_small.\n  example f {}\nreq B "b"\n  text\n    too_big is checked Before too_small.\n  example f {}\nreq C "c"\n  text\n    too_big is checked first.\n    After that, nothing.\n  example f {}\nreq D "d"\n  text\n    too_big and too_small are checked in this\n    order.\n  example f {}\n',
      ['s.duramen:14: error T005', 's.duramen:23: error T005'],
    ],
    [
      HE + 'op f\n  input x? json\nerrors\n  e when x\n  f when y\nreq A "a"\n  text\n    A request may be refused before it is read: see the errors list.\n  example f {}\n',
      [],
    ],
    [
      pre + 'req A "a"\n  text\n    too_bigé, then too_small: decided before-hand.\n  example f {}\nreq B "b"\n  text\n    xtoo_big and too_small2 come after.\n  example f {}\n',
      ['s.duramen:10: error T005'],
    ],
  ]);
});

test('REQ-CK-009 decisions', () => {
  table([
    [
      HE +
        'op f\n  input x? json\ndecision D-1 "uncited, no source"\ndecision D-2 "bad status"\n  source s\n  status Accepted\ndecision D-3 "superseded by nothing"\n  source s\n  status superseded\ndecision D-4 "superseded by an undeclared one"\n  source s\n  status superseded by D-9\ndecision D-5 "superseded properly"\n  source s\n  status superseded by D-6\ndecision D-6 "accepted, with more words"\n  source s\n  status accepted on 2026-01-01\ndecision D-7 "observed"\n  source s\n  status observed\nreq A "a"\n  decision D-2, D-3, D-4, D-5, D-6, D-7\n  example f {}\n',
      [
        's.duramen:6: warning T012', 's.duramen:6: warning T013', 's.duramen:7: error T027', 's.duramen:10: error T027',
        's.duramen:13: error T027', 's.duramen:25: error T028', 's.duramen:25: error T028', 's.duramen:25: error T028',
        's.duramen:25: warning T028',
      ],
    ],
    [
      HE + 'op f\n  input x? json\ndecision D-1 "a comma after the word"\n  source s\n  status accepted, 2026-01-01\ndecision D-2 "an empty status"\n  source\n  status\nreq A "a"\n  decision D-1, D-2\n  example f {}\n',
      ['s.duramen:6: error T027', 's.duramen:9: warning T013', 's.duramen:9: error T027'],
    ],
    [
      H + 'req A "a"\n  decision D, E\n  text\n    T.\ndecision D "d"\n  source x\n  status superseded  by E\ndecision E "e"\n  source x\n  status Accepted\n',
      ['s.duramen:3: error T001', 's.duramen:3: error T028', 's.duramen:7: error T027', 's.duramen:10: error T027'],
    ],
    [
      HE + 'op f\n  input x? json\nreq A "a"\n  decision D\n  example f {}\ndecision D "d"\n  source x\n  status rejected\ndecision D "d again"\n  source x\ndecision E "e"\n  source x\ndecision E "e again"\n  source x\n',
      ['s.duramen:6: error T028', 's.duramen:12: error T007', 's.duramen:14: warning T012', 's.duramen:16: error T007', 's.duramen:16: warning T012'],
    ],
  ]);
});

test('REQ-OR-001 a record with examples has an oracle', () => {
  assert.deepEqual(one(H + 'op f\n  input x? json\nreq A "a"\n  example f {}\n    expect result = 1\n'), ['s.duramen:2: error T019']);
  assert.deepEqual(one(H + 'op f\n  input x? json\nreq A "a"\n  text\n    No example.\nreq B "b"\n  example f {}\n'), [
    's.duramen:2: error T019',
    's.duramen:5: error T001',
  ]);
});

test('REQ-OR-002 how the oracle is run', () => {
  table([
    [
      H +
        '  request {"clock": 1}\noracle node echo.mjs\nop f\n  input line? boolean, x? json\nreq A "a"\n  example f {"line": true,  "x": 2.50}\n    expect result = "{\\"id\\":\\"A#1\\",\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true,  \\"x\\": 2.50}}"\n  example f {"line": true}\n    omit id\n    expect result = "{\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true}}"\n  example raw \'{"id": "x",  "op": "f", "input": {"line": true}}\'\n    expect id = "x"\n    expect result = "{\\"id\\": \\"x\\",  \\"op\\": \\"f\\", \\"input\\": {\\"line\\": true}}"\n',
      [],
    ],
    [
      HE + 'op f\n  input say? string\nreq A "a"\n  example raw \'{"id": "r1", "op": "f", "input": {"say": " \\u00a0\\n{\\"id\\": \\"elsewhere\\", \\"result\\": 1}\\n\\t"}}\'\n    expect result = 1\n  example raw \'{"id": "r2", "op": "f", "input": {"say": "{\\"id\\": \\"r2\\", \\"result\\": 1}\\r\\n"}}\'\n    expect result = 1\n  example raw \'{"id": "r3", "op": "f", "input": {"say": "{\\"result\\": 1}\\r{\\"result\\": 2}"}}\'\n    expect result = ?\n  example raw \'{"id": "r4", "op": "f", "input": {"say": "{\\"result\\": 1}\\n[2]"}}\'\n    expect result = ?\n',
      ['s.duramen:11: error T021', 's.duramen:13: error T021'],
    ],
  ]);
  assert.deepEqual(
    diags({
      'sub/s.duramen': 'duramen 0.1\nspec s 1\noracle node "my echo.mjs"\nop f\n  input x? json\nreq A "a"\n  example f {"x": 1}\n    expect result.x = 1\n',
      'sub/my echo.mjs': ECHO,
    }),
    [],
  );
  assert.deepEqual(
    one(HE + 'op f\n  input x? json\nreq A "a"\n  text\n    No example.\nreq B "b"\n  example f {"x": 1}\n    expect result.x = 2\n', X),
    ['s.duramen:6: error T001', 's.duramen:11: error T002'],
  );
});

test('REQ-OR-003 examples the oracle disagrees with', () => {
  table([
    [
      HE +
        'op f\n  input x? json, y? json, answer? json\nreq A "a"\n  example f {"x": 1.0, "y": [5, {"z": null}]}\n    expect result = {"y": [5, {"z": null}], "x": 1}\n    expect result.y.1.z = null\n    expect result.y.0 ≈ 5.5 ± 0.5\n    expect result.x = 2\n    expect result.y.2 = 5\n    expect result.y.0 ≈ 5.5 ± 0.4\n    expect result.y.1 = {}\n  example f {"answer": {"result": 0, "audit": "{\\"a\\": [1, 2]}"}}\n    expect audit.a.1 = 2\n    expect audit = "{\\"a\\": [1, 2]}"\n    expect audit.b = 1\n  table f\n    | x | result.x | result.y |\n    | 1 | 2        | 3        |\n  example f {"x": {"": 1}}\n    expect result.x. = 1\n    expect result..x = 1\n  example f {"y": [7, 8]}\n    expect result.y.1 = 8\n    expect result.y.length = 2\n    expect result.y.01 = 8\n',
      [
        's.duramen:11: error T002', 's.duramen:12: error T002', 's.duramen:13: error T002', 's.duramen:14: error T002',
        's.duramen:18: error T002', 's.duramen:21: error T002', 's.duramen:21: error T002', 's.duramen:24: error T002',
        's.duramen:27: error T002', 's.duramen:28: error T002',
      ],
    ],
    [
      HE + 'op f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n  example f {"answer": {"result": 1}}\n    expect error = "e"\n  example g {"answer": {"error": "e"}}\n    expect error = "e"\n',
      ['s.duramen:10: error T002'],
    ],
    [
      HE + 'op f\n  input answer? json, x? json\nreq A "a"\n  example f {"answer": {"result": 1, "audit": "{\\"a\\": 1e400, \\"b\\": 1}"}}\n    expect audit.b = 1\n    expect audit.a = ?\n  example f {"x": 2}\n    expect result.x ≈ 1.9 ± 0.1\n    expect result.x ≈ 1.9 ± 0.10000000000000009\n  example f {"x": 1}\n    expect result.x ≈ -8.673617379884035e-19 ± 1\n',
      ['s.duramen:8: error T002', 's.duramen:9: error T025', 's.duramen:11: error T002'],
    ],
  ]);
});

test('REQ-OR-004 an oracle that fails', () => {
  assert.deepEqual(
    one(H + 'oracle no-such-program-for-duramen\nop f\n  input x? json\nreq A "a"\n  example f {}\n'),
    ['s.duramen:3: error T020', 's.duramen:7: error T021'],
  );
  table([
    [
      HE + 'op f\n  input x? json, exit? integer\nreq A "a"\n  example f {"x": 1}\n    expect result.x = 2\n  example f {"exit": 3}\n    expect result.exit = 3\n',
      ['s.duramen:3: error T020', 's.duramen:8: error T002'],
    ],
    [
      HE + 'op f\n  input exit? integer\nreq A "a"\n  example f {}\n  example raw \'{"id": "r", "op": "f", "input": {"exit": 4}}\'\n',
      ['s.duramen:8: error T020'],
    ],
  ]);
  assert.deepEqual(
    one(H + 'oracle no-such-program-for-duramen\nop f\n  input x? json\nreq A "a"\n  example raw \'{"id": "r", "op": "f"}\'\n'),
    ['s.duramen:7: error T020', 's.duramen:7: error T021'],
  );
  assert.deepEqual(
    one(H + 'oracle node "echo.mjs\nop f\n  input x? json\nreq A "a"\n  example f {}\n', X),
    ['s.duramen:3: error T020', 's.duramen:7: error T021'],
  );
});

test('REQ-OR-005 examples with no answer', () => {
  table([
    [
      HE + 'op f\n  input silent? boolean\nreq A "a"\n  example f {"silent": true}\n  example f {}\n  example raw \'{"id": "r", "op": "f", "input": {"silent": true}}\'\n',
      ['s.duramen:7: error T021', 's.duramen:9: error T021'],
    ],
    [
      HE + 'op f\n  input say string\nreq A "a"\n  example f {"say": "{\\"id\\":\\"A#1\\",\\"result\\":1e400}"}\n    expect result = ?\n  example f {"say": "{\\"id\\":\\"A#2\\",\\"result\\":1e300}"}\n    expect result = ?\n',
      ['s.duramen:7: error T021'],
    ],
  ]);
});

test('REQ-OR-006 examples the oracle cannot compute', () => {
  table([
    [
      HE + 'op f\n  input answer? json\nreq A "a"\n  example f {"answer": {"oracle_error": "left open"}}\n    expect result = 1\n    expect result = ?\n',
      ['s.duramen:7: error T022'],
    ],
    [HE + 'op f\n  input answer? json\nreq A "a"\n  example f {"answer": {"oracle_error": null, "error": "x"}}\n', ['s.duramen:7: error T022']],
  ]);
});

test('REQ-OR-007 errors nobody expected', () => {
  const r = (t: string) => check({ 's.duramen': t, ...X }).result;
  assert.deepEqual(
    r(HE + 'op f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n  example f {"answer": {"error": "e"}}\n  example f {"answer": {"error": "e"}}\n    expect error = "e"\n'),
    { diagnostics: ['s.duramen:9: warning T024'], errors: 0, warnings: 1 },
  );
  assert.deepEqual(r(HE + 'op f\n  input answer? json\nreq A "a"\n  example f {"answer": {"error": null}}\n'), {
    diagnostics: ['s.duramen:7: warning T024'],
    errors: 0,
    warnings: 1,
  });
  assert.deepEqual(
    r(HE + 'op f\n  input answer? json\nreq A "a"\n  example f {"answer": {"error": "e"}}\n    expect result = 1\n  example f {"answer": {"error": "e"}}\n    expect id = "A#2"\n'),
    { diagnostics: ['s.duramen:8: error T002'], errors: 1, warnings: 0 },
  );
});

test('REQ-OR-008 values taken from the oracle', () => {
  table([
    [
      HE + 'op f\n  input x? json\nreq A "a"\n  example f {"x": 1}\n    expect result.x = ?\n    expect result.y = ?\n',
      ['s.duramen:9: error T025'],
    ],
  ]);
});
