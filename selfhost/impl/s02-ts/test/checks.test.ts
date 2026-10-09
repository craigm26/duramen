import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, cases, rec, ECHO, ORACLE, WITH_ECHO } from './helpers.ts';

const H = 'duramen 0.1\nspec s 1\n';
const OR = 'oracle node echo.mjs\n';
const f = (body: string) => check({ 's.duramen': H + body, ...WITH_ECHO });
const OPF = OR + 'op f\n  input x? json\n';
const d = (code: string, ...lines: number[]) => lines.map((l) => `s.duramen:${l}: ${code}`);

test('REQ-CK-001: every requirement has an example', () => {
  assert.deepEqual(check(rec('req A "a"\n  text\n    It MUST work.\n')), d('error T001', 3));
  assert.deepEqual(check(rec('req A "a"\n  table f\n    | x |\n    |---|\n')), d('error P013', 4));
});

test('REQ-CK-002: IDs are unique', () => {
  assert.deepEqual(f(OPF + 'req A "a"\n  example f {}\nreq A "again"\n  example f {}\nopen A "an open item may share a requirement\'s ID"\n  text\n    Open.\nopen B "b"\n  text\n    Open.\nopen B "b again"\n  text\n    Open.\ndecision D-1 "d"\n  source s\ndecision D-1 "d again"\n  source s\nreq C "c"\n  decision D-1\n  example f {}\n'),
    d('error T007', 8, 16, 21));
  assert.deepEqual(check({
    'a.duramen': H + OPF + 'req A "a"\n  example f {}\n',
    'b.duramen': 'duramen 0.1\nreq A "a"\n  example f {}\nop f\n  input y? json\n', ...WITH_ECHO,
  }), ['b.duramen:2: error T007', 'b.duramen:4: error T007']);
});

test('REQ-CK-003: cited decisions are declared', () => {
  assert.deepEqual(f(OPF + 'decision D-1 "d"\n  source s\nreq A "a"\n  decision D-1 D-2, D-3\n  example f {}\n'), d('error T008', 8, 8));
});

test('REQ-CK-004: examples of declared operations', () => {
  const body = OR + 'op f\n  input a number, b? number\nerrors\n  e when never\nreq A "a"\n  example g {"a": 1}\n  example f {"b": 1}\n  example f {"a": 1, "c": 2}\n  example f\n  example g {"answer": {"error": "e"}}\n    expect error = "e"\n  example raw \'{"id": "A#6", "op": "g"}\'\n  table f\n    | b | c |\n    | 1 | 2 |\n  example g {}\n    expect error.code = "e"\n';
  assert.deepEqual(f(body), [
    's.duramen:9: error T009', 's.duramen:10: error T010', 's.duramen:11: warning T011', 's.duramen:12: error T010',
    's.duramen:18: error T010', 's.duramen:18: warning T011', 's.duramen:19: error T009',
  ]);
});

test('REQ-CK-005: expected errors are declared', () => {
  const body = OR + 'op f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n  example f {"answer": {"error": "e"}}\n    expect error = "e"\n  example f {"answer": {"error": "nope"}}\n    expect error = "nope"\n  example raw \'{"id": "r", "op": "f", "input": {"answer": {"error": "other"}}}\'\n    expect error = "other"\n  example f {"answer": {"error": "e"}}\n    expect error = ?\n';
  assert.deepEqual(f(body), d('error T023', 12, 14));
});

test('REQ-CK-006: obligations live in requirements', () => {
  const a = H + '  text\n    The program MUST work.\nop f\n  result what it MUST return\nerrors\n  e when it SHALL fail\nsection S "It MUST be titled"\n  text\n    REQUIRED reading.\nnote\n  text\n    This note says `MUST`, "SHALL" and “REQUIRED”, MUSTARD and must.\ndecision D-1 "d"\n  source s\n  text\n    Fine.\n  rejected "Another MUST."\nopen O "o"\n  text\n    It MUST NOT be.\n';
  assert.deepEqual(check({ 's.duramen': a }), [
    's.duramen:2: error T004', 's.duramen:5: error T004', 's.duramen:8: error T004', 's.duramen:9: error T004',
    's.duramen:15: error T004', 's.duramen:15: warning T012', 's.duramen:20: warning T014',
  ]);
  assert.deepEqual(check(rec('decision D-1 "d"\n  source s\n  text\n    It MUST.\n  rejected "It SHALL."\n  rejected "It is REQUIRED."\n')),
    [...d('error T004', 3, 3, 3), ...d('warning T012', 3)]);
});

test('REQ-CK-007: open items are not tested', () => {
  assert.deepEqual(check(rec('open O "o"\n  example f {}\n  table f\n    | x |\n    | 1 |\n  example f {not json\n    expect nothing at all\n  table g h\n    | {bad |\n')),
    d('error T003', 4, 5, 8, 10));
});

test('REQ-CK-008: the order of errors is stated once', () => {
  const body = OR + 'op f\n  input x? json\nerrors\n  too_big when x > 9\n  too_small when x < 0\nreq A "a"\n  text\n    A request that is too_big gets too_big, and one too_small gets too_small.\n  example f {}\nreq B "b"\n  text\n    too_big is checked Before too_small.\n  example f {}\nreq C "c"\n  text\n    too_big is checked first.\n    After that, nothing.\n  example f {}\n';
  assert.deepEqual(f(body), d('error T005', 14));
  assert.deepEqual(f(OPF + 'errors\n  e when x\n  f when y\nreq A "a"\n  text\n    A request may be refused before it is read: see the errors list.\n  example f {}\n'), []);
});

test('REQ-CK-009: decisions', () => {
  const body = OPF + 'decision D-1 "uncited, no source"\ndecision D-2 "bad status"\n  source s\n  status Accepted\ndecision D-3 "superseded by nothing"\n  source s\n  status superseded\ndecision D-4 "x"\n  source s\n  status superseded by D-9\ndecision D-5 "x"\n  source s\n  status superseded by D-6\ndecision D-6 "x"\n  source s\n  status accepted on 2026-01-01\ndecision D-7 "observed"\n  source s\n  status observed\nreq A "a"\n  decision D-2, D-3, D-4, D-5, D-6, D-7\n  example f {}\n';
  assert.deepEqual(f(body), [
    's.duramen:6: warning T012', 's.duramen:6: warning T013', 's.duramen:7: error T027', 's.duramen:10: error T027', 's.duramen:13: error T027',
    's.duramen:25: error T028', 's.duramen:25: error T028', 's.duramen:25: error T028', 's.duramen:25: warning T028',
  ]);
});

test('REQ-OR-001: a record with examples has an oracle', () => {
  assert.deepEqual(check(rec('op f\n  input x? json\nreq A "a"\n  example f {}\n    expect result = 1\n')), d('error T019', 2));
  assert.deepEqual(check(rec('op f\n  input x? json\nreq A "a"\n  text\n    No example.\nreq B "b"\n  example f {}\n')), [...d('error T019', 2), ...d('error T001', 5)]);
});

test('REQ-OR-002: how the oracle is run', () => {
  const ex1 = H.replace('spec s 1\n', 'spec s 1\n  request {"clock": 1}\n') + OR + 'op f\n  input line? boolean, x? json\nreq A "a"\n  example f {"line": true,  "x": 2.50}\n    expect result = "{\\"id\\":\\"A#1\\",\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true,  \\"x\\": 2.50}}"\n  example f {"line": true}\n    omit id\n    expect result = "{\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true}}"\n  example raw \'{"id": "x",  "op": "f", "input": {"line": true}}\'\n    expect id = "x"\n    expect result = "{\\"id\\": \\"x\\",  \\"op\\": \\"f\\", \\"input\\": {\\"line\\": true}}"\n';
  assert.deepEqual(check({ 's.duramen': ex1, ...WITH_ECHO }), []);
  assert.deepEqual(check({ 'sub/s.duramen': H + 'oracle node "my echo.mjs"\nop f\n  input x? json\nreq A "a"\n  example f {"x": 1}\n    expect result.x = 1\n', 'sub/my echo.mjs': ECHO }), []);
  assert.deepEqual(f(OPF + 'req A "a"\n  text\n    No example.\nreq B "b"\n  example f {"x": 1}\n    expect result.x = 2\n'), [...d('error T001', 6), ...d('error T002', 11)]);
});

test('REQ-OR-003: examples the oracle disagrees with', () => {
  const body = OR + 'op f\n  input x? json, y? json, answer? json\nreq A "a"\n  example f {"x": 1.0, "y": [5, {"z": null}]}\n    expect result = {"y": [5, {"z": null}], "x": 1}\n    expect result.y.1.z = null\n    expect result.y.0 ≈ 5.5 ± 0.5\n    expect result.x = 2\n    expect result.y.2 = 5\n    expect result.y.0 ≈ 5.5 ± 0.4\n    expect result.y.1 = {}\n  example f {"answer": {"result": 0, "audit": "{\\"a\\": [1, 2]}"}}\n    expect audit.a.1 = 2\n    expect audit = "{\\"a\\": [1, 2]}"\n    expect audit.b = 1\n  table f\n    | x | result.x | result.y |\n    | 1 | 2        | 3        |\n  example f {"x": {"": 1}}\n    expect result.x. = 1\n    expect result..x = 1\n';
  assert.deepEqual(f(body), d('error T002', 11, 12, 13, 14, 18, 21, 21, 24));
  assert.deepEqual(f(OR + 'op f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n  example f {"answer": {"result": 1}}\n    expect error = "e"\n  example g {"answer": {"error": "e"}}\n    expect error = "e"\n'), d('error T002', 10));
});

test('REQ-OR-004: an oracle that fails', () => {
  assert.deepEqual(check(rec('oracle no-such-program-for-duramen\nop f\n  input x? json\nreq A "a"\n  example f {}\n')), [...d('error T020', 3), ...d('error T021', 7)]);
  assert.deepEqual(f(OR + 'op f\n  input x? json, exit? integer\nreq A "a"\n  example f {"x": 1}\n    expect result.x = 2\n  example f {"exit": 3}\n    expect result.exit = 3\n'), [...d('error T020', 3), ...d('error T002', 8)]);
  assert.deepEqual(f(OR + 'op f\n  input exit? integer\nreq A "a"\n  example f {}\n  example raw \'{"id": "r", "op": "f", "input": {"exit": 4}}\'\n'), d('error T020', 8));
  assert.deepEqual(check(rec('oracle no-such-program-for-duramen\nop f\n  input x? json\nreq A "a"\n  example raw \'{"id": "r", "op": "f"}\'\n')), [...d('error T020', 7), ...d('error T021', 7)]);
});

test('REQ-OR-005/006/007/008', () => {
  assert.deepEqual(f(OR + 'op f\n  input silent? boolean\nreq A "a"\n  example f {"silent": true}\n  example f {}\n  example raw \'{"id": "r", "op": "f", "input": {"silent": true}}\'\n'), d('error T021', 7, 9));
  assert.deepEqual(f(OR + 'op f\n  input answer? json\nreq A "a"\n  example f {"answer": {"oracle_error": "left open"}}\n    expect result = 1\n    expect result = ?\n'), d('error T022', 7));
  assert.deepEqual(f(OR + 'op f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n  example f {"answer": {"error": "e"}}\n  example f {"answer": {"error": "e"}}\n    expect error = "e"\n'), d('warning T024', 9));
  assert.deepEqual(f(OPF + 'req A "a"\n  example f {"x": 1}\n    expect result.x = ?\n    expect result.y = ?\n'), d('error T025', 9));
});

test('REQ-SU-001: no suite from a record with errors', () => {
  assert.deepEqual(cases({ 's.duramen': 'frobnicate\n' }), { cases: [], errors: 3 });
  assert.deepEqual(cases(rec('req A "a"\n  text\n    Nothing to show.\n')), { cases: [], errors: 1 });
  const r = cases({ 's.duramen': H + OPF + 'req A "a"\n  example f {"y": 1}\n', ...WITH_ECHO });
  assert.equal(r.errors, 0);
  assert.equal(r.cases[0].id, 'A#1');
});

test('REQ-SU-002: one case per example', () => {
  const r = cases({ 's.duramen': H + OPF + 'req A "a"\n  example f {"x": 1}\n    expect result.x = 1\nreq B "b"\n  on posix\n  table f\n    | x | result.x |\n    | 2 | 2        |\n    | 3 | ?        |\n', ...WITH_ECHO });
  assert.deepEqual(r, {
    errors: 0,
    cases: [
      { checks: [{ kind: 'eq', path: 'result.x', value: 1 }], full: { members: ['id', 'result'], result: { x: 1 }, tolerances: {} }, id: 'A#1', kind: 'example', line: '{"id":"A#1","op":"f","input":{"x": 1}}', platform: 'any', reqs: ['REQ-A'] },
      { checks: [{ kind: 'eq', path: 'result.x', value: 2 }], full: { members: ['id', 'result'], result: { x: 2 }, tolerances: {} }, id: 'B#1', kind: 'example', line: '{"id":"B#1","op":"f","input":{"x":2}}', platform: 'posix', reqs: ['REQ-B'] },
      { checks: [{ from: 'oracle', kind: 'eq', path: 'result.x', value: 3 }], full: { members: ['id', 'result'], result: { x: 3 }, tolerances: {} }, id: 'B#2', kind: 'example', line: '{"id":"B#2","op":"f","input":{"x":3}}', platform: 'posix', reqs: ['REQ-B'] },
    ],
  });
  const r2 = cases({ 'b.duramen': 'duramen 0.1\nreq B "b"\n  on windows\n  example f {}\n', 'a.duramen': H + OPF + 'req A "a"\n  example f {}\n  example f {}\n', ...WITH_ECHO });
  assert.deepEqual(r2.cases.map((c: any) => c.id), ['A#1', 'A#2', 'B#1']);
  assert.equal(r2.cases[2].platform, 'windows');
});

test('REQ-SU-003: request lines', () => {
  const body = H.replace('spec s 1\n', 'spec s 1\n  request {"clock": "c", "trace": true}\n') + OR + 'op f\n  input x? json\nop g\n  input x? json\n  request {"mode": 2}\nreq A "a"\n  example f {"x" : 2.50e0 }\n  example f\n  example f {"x": 1}\n    request {"trace": false, "user": "u"}\n    omit clock\n  example g {"x": 1}\n    omit id, input\n  example f {"x": 1}\n    omit op, id\n  example raw \'{"id": "A#6",  "op": "f"}\'\n';
  const r = cases({ 's.duramen': body, ...WITH_ECHO });
  assert.equal(r.errors, 0);
  assert.deepEqual(r.cases[0], { checks: [], full: { members: ['id', 'result'], result: { x: 2.5 }, tolerances: {} }, id: 'A#1', kind: 'example', line: '{"id":"A#1","op":"f","clock":"c","trace":true,"input":{"x" : 2.50e0 }}', platform: 'any', reqs: ['REQ-A'] });
  assert.equal(r.cases[1].line, '{"id":"A#2","op":"f","clock":"c","trace":true}');
  assert.equal(r.cases[2].line, '{"id":"A#3","op":"f","trace":false,"user":"u","input":{"x": 1}}');
  assert.deepEqual(r.cases[3], { checks: [], full: { members: ['id', 'result'], result: {}, tolerances: {} }, id: 'A#4', kind: 'example', line: '{"op":"g","mode":2}', platform: 'any', reqs: ['REQ-A'], solo: true });
  assert.equal(r.cases[4].line, '{"clock":"c","trace":true,"input":{"x": 1}}');
  assert.equal(r.cases[4].solo, true);
  assert.equal(r.cases[5].line, '{"id": "A#6",  "op": "f"}');
  assert.equal(r.cases[5].solo, true);
  const r2 = cases({ 's.duramen': H + OR + 'op f\n  input files? object, n? number\nreq A "a"\n  example f {"n" : 1.50, "files": {"z": "old"}}\n    input files."a.duramen"\n      duramen 0.1\n      "quoted" é\n    input files.z\n      new\n  table f\n    | n      | files |\n    | 1.50   |       |\n    |        | {}    |\n', ...WITH_ECHO });
  assert.equal(r2.cases[0].line, '{"id":"A#1","op":"f","input":{"n":1.5,"files":{"z":"new\\n","a.duramen":"duramen 0.1\\n\\"quoted\\" é\\n"}}}');
  assert.equal(r2.cases[1].line, '{"id":"A#2","op":"f","input":{"n":1.50}}');
  assert.equal(r2.cases[2].line, '{"id":"A#3","op":"f","input":{"files":{}}}');
});

test('REQ-SU-004: checks', () => {
  const r = cases({ 's.duramen': H + OPF + 'req A "a"\n  example f {"x": {"y": [1, 2]}}\n    expect result.x.y.0 = 1\n    expect result.x.y.1 ~ 2.1 +- 0.25\n    expect result.x = ?\n    expect id = "A#1"\n  table f\n    | x | result.x ± 0.5 |\n    | 2 | 2.25           |\n', ...WITH_ECHO });
  assert.deepEqual(r.cases[0].checks, [
    { kind: 'eq', path: 'result.x.y.0', value: 1 }, { kind: 'approx', path: 'result.x.y.1', tol: 0.25, value: 2.1 },
    { from: 'oracle', kind: 'eq', path: 'result.x', value: { y: [1, 2] } }, { kind: 'eq', path: 'id', value: 'A#1' },
  ]);
  assert.deepEqual(r.cases[1].checks, [{ kind: 'approx', path: 'result.x', tol: 0.5, value: 2.25 }]);
});

test('REQ-SU-005: the whole answer', () => {
  const body = OR + 'op f\n  input answer? json\n  audit\n  tolerance result.t 0.5\n  tolerance result.u 0\nop g\n  input answer? json\nerrors\n  e when never\nreq A "a"\n  example f {"answer": {"result": {"t": 1}, "audit": "A"}}\n  example f {"answer": {"error": "e", "extra": 1}}\n    expect error = "e"\n  example g {"answer": {"result": 2, "audit": "B"}}\n  example h {"answer": {"error": "e"}}\n    expect error = "e"\n';
  const r = cases({ 's.duramen': H + body, ...WITH_ECHO });
  const tol = { 'result.t': 0.5, 'result.u': 0 };
  assert.deepEqual(r.cases[0].full, { audit: 'A', members: ['audit', 'id', 'result'], result: { t: 1 }, tolerances: tol });
  assert.deepEqual(r.cases[1].full, { error: 'e', members: ['error', 'extra', 'id'], tolerances: tol });
  assert.deepEqual(r.cases[2].full, { members: ['audit', 'id', 'result'], result: 2, tolerances: {} });
  assert.deepEqual(r.cases[3].full, { error: 'e', members: ['error', 'id'], tolerances: {} });
});
