import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECHO, cases, check, diags, t } from './helper.ts';

// A record with the echo oracle and the given body after `spec s 1`.
function R(...rest: string[]): Record<string, string> {
  return { 's.duramen': t('duramen 0.1', 'spec s 1', ...rest), 'echo.mjs': ECHO };
}
const HEAD = ['oracle node echo.mjs'];
const OPF = ['op f', '  input x? json'];

test('REQ-CK-001: every requirement has an example', () => {
  assert.deepEqual(diags({ 's.duramen': t('duramen 0.1', 'spec s 1', 'req A "a"', '  text', '    It MUST work.') }), ['s.duramen:3: error T001']);
  assert.deepEqual(diags({ 's.duramen': t('duramen 0.1', 'spec s 1', 'req A "a"', '  table f', '    | x |', '    |---|') }), ['s.duramen:4: error P013']);
});

test('REQ-CK-002: IDs are unique', () => {
  assert.deepEqual(
    diags(
      R(
        ...HEAD,
        ...OPF,
        'req A "a"',
        '  example f {}',
        'req A "again"',
        '  example f {}',
        'open A "an open item may share a requirement\'s ID"',
        '  text',
        '    Open.',
        'open B "b"',
        '  text',
        '    Open.',
        'open B "b again"',
        '  text',
        '    Open.',
        'decision D-1 "d"',
        '  source s',
        'decision D-1 "d again"',
        '  source s',
        'req C "c"',
        '  decision D-1',
        '  example f {}',
      ),
    ),
    ['s.duramen:8: error T007', 's.duramen:16: error T007', 's.duramen:21: error T007'],
  );
  assert.deepEqual(
    diags({
      'a.duramen': t('duramen 0.1', 'spec s 1', ...HEAD, ...OPF, 'req A "a"', '  example f {}'),
      'b.duramen': t('duramen 0.1', 'req A "a"', '  example f {}'),
      'echo.mjs': ECHO,
    }),
    ['b.duramen:2: error T007'],
  );
});

test('REQ-CK-003: cited decisions are declared', () => {
  assert.deepEqual(
    diags(R(...HEAD, ...OPF, 'decision D-1 "d"', '  source s', 'req A "a"', '  decision D-1 D-2, D-3', '  example f {}')),
    ['s.duramen:8: error T008', 's.duramen:8: error T008'],
  );
});

test('REQ-CK-004: examples of declared operations', () => {
  assert.deepEqual(
    diags(
      R(
        ...HEAD,
        'op f',
        '  input a number, b? number',
        'errors',
        '  e when never',
        'req A "a"',
        '  example g {"a": 1}',
        '  example f {"b": 1}',
        '  example f {"a": 1, "c": 2}',
        '  example f',
        '  example g {"answer": {"error": "e"}}',
        '    expect error = "e"',
        '  example raw \'{"id": "A#6", "op": "g"}\'',
        '  table f',
        '    | b | c |',
        '    | 1 | 2 |',
      ),
    ),
    ['s.duramen:9: error T009', 's.duramen:10: error T010', 's.duramen:11: warning T011', 's.duramen:12: error T010', 's.duramen:18: error T010', 's.duramen:18: warning T011'],
  );
});

test('REQ-CK-005: expected errors are declared', () => {
  assert.deepEqual(
    diags(
      R(
        ...HEAD,
        'op f',
        '  input answer? json',
        'errors',
        '  e when never',
        'req A "a"',
        '  example f {"answer": {"error": "e"}}',
        '    expect error = "e"',
        '  example f {"answer": {"error": "nope"}}',
        '    expect error = "nope"',
        '  example raw \'{"id": "r", "op": "f", "input": {"answer": {"error": "other"}}}\'',
        '    expect error = "other"',
      ),
    ),
    ['s.duramen:12: error T023', 's.duramen:14: error T023'],
  );
});

test('REQ-CK-006: obligations live in requirements', () => {
  assert.deepEqual(
    diags({
      's.duramen': t(
        'duramen 0.1',
        'spec s 1',
        '  text',
        '    The program MUST work.',
        'op f',
        '  result what it MUST return',
        'errors',
        '  e when it SHALL fail',
        'section S "It MUST be titled"',
        '  text',
        '    REQUIRED reading.',
        'note',
        '  text',
        '    This note says `MUST`, "SHALL" and “REQUIRED”, MUSTARD and must.',
        'decision D-1 "d"',
        '  source s',
        '  text',
        '    Fine.',
        '  rejected "Another MUST."',
        'open O "o"',
        '  text',
        '    It MUST NOT be.',
      ),
    }),
    ['s.duramen:2: error T004', 's.duramen:5: error T004', 's.duramen:8: error T004', 's.duramen:9: error T004', 's.duramen:15: error T004', 's.duramen:15: warning T012', 's.duramen:20: warning T014'],
  );
  assert.deepEqual(
    diags({ 's.duramen': t('duramen 0.1', 'spec s 1', 'decision D-1 "d"', '  source s', '  text', '    It MUST.', '  rejected "It SHALL."', '  rejected "It is REQUIRED."') }),
    ['s.duramen:3: error T004', 's.duramen:3: error T004', 's.duramen:3: error T004', 's.duramen:3: warning T012'],
  );
});

test('REQ-CK-007: open items are not tested', () => {
  assert.deepEqual(
    diags({ 's.duramen': t('duramen 0.1', 'spec s 1', 'open O "o"', '  example f {}', '  table f', '    | x |', '    | 1 |') }),
    ['s.duramen:4: error T003', 's.duramen:5: error T003'],
  );
});

test('REQ-CK-008: the order of errors is stated once', () => {
  assert.deepEqual(
    diags(
      R(
        ...HEAD,
        ...OPF,
        'errors',
        '  too_big when x > 9',
        '  too_small when x < 0',
        'req A "a"',
        '  text',
        '    A request that is too_big gets too_big, and one too_small gets too_small.',
        '  example f {}',
        'req B "b"',
        '  text',
        '    too_big is checked Before too_small.',
        '  example f {}',
        'req C "c"',
        '  text',
        '    too_big is checked first.',
        '    After that, nothing.',
        '  example f {}',
      ),
    ),
    ['s.duramen:14: error T005'],
  );
});

test('REQ-CK-009: decisions', () => {
  assert.deepEqual(
    diags(
      R(
        ...HEAD,
        ...OPF,
        'decision D-1 "uncited, no source"',
        'decision D-2 "bad status"',
        '  source s',
        '  status Accepted',
        'decision D-3 "superseded by nothing"',
        '  source s',
        '  status superseded',
        'decision D-4 "superseded by an undeclared one"',
        '  source s',
        '  status superseded by D-9',
        'decision D-5 "superseded properly"',
        '  source s',
        '  status superseded by D-6',
        'decision D-6 "accepted, with more words"',
        '  source s',
        '  status accepted on 2026-01-01',
        'decision D-7 "observed"',
        '  source s',
        '  status observed',
        'req A "a"',
        '  decision D-2, D-3, D-4, D-5, D-6, D-7',
        '  example f {}',
      ),
    ),
    ['s.duramen:6: warning T012', 's.duramen:6: warning T013', 's.duramen:7: error T027', 's.duramen:10: error T027', 's.duramen:13: error T027', 's.duramen:25: error T028', 's.duramen:25: error T028', 's.duramen:25: error T028', 's.duramen:25: warning T028'],
  );
});

// ---- oracle
test('REQ-OR-001: a record with examples has an oracle', () => {
  assert.deepEqual(diags({ 's.duramen': t('duramen 0.1', 'spec s 1', ...OPF, 'req A "a"', '  example f {}', '    expect result = 1') }), ['s.duramen:2: error T019']);
  assert.deepEqual(diags({ 's.duramen': t('duramen 0.1', 'spec s 1', ...OPF, 'req A "a"', '  text', '    No example.', 'req B "b"', '  example f {}') }), [
    's.duramen:2: error T019',
    's.duramen:5: error T001',
  ]);
});

test('REQ-OR-002: how the oracle is run', () => {
  assert.deepEqual(
    diags({
      's.duramen': t(
        'duramen 0.1',
        'spec s 1',
        '  request {"clock": 1}',
        ...HEAD,
        'op f',
        '  input line? boolean, x? json',
        'req A "a"',
        '  example f {"line": true,  "x": 2.50}',
        '    expect result = "{\\"id\\":\\"A#1\\",\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true,  \\"x\\": 2.50}}"',
        '  example f {"line": true}',
        '    omit id',
        '    expect result = "{\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true}}"',
        '  example raw \'{"id": "x",  "op": "f", "input": {"line": true}}\'',
        '    expect id = "x"',
        '    expect result = "{\\"id\\": \\"x\\",  \\"op\\": \\"f\\", \\"input\\": {\\"line\\": true}}"',
      ),
      'echo.mjs': ECHO,
    }),
    [],
  );
  assert.deepEqual(
    diags({
      'sub/s.duramen': t('duramen 0.1', 'spec s 1', 'oracle node "my echo.mjs"', ...OPF, 'req A "a"', '  example f {"x": 1}', '    expect result.x = 1'),
      'sub/my echo.mjs': ECHO,
    }),
    [],
  );
  assert.deepEqual(
    diags(R(...HEAD, ...OPF, 'req A "a"', '  text', '    No example.', 'req B "b"', '  example f {"x": 1}', '    expect result.x = 2')),
    ['s.duramen:6: error T001', 's.duramen:11: error T002'],
  );
});

test('REQ-OR-003: examples the oracle disagrees with', () => {
  assert.deepEqual(
    diags(
      R(
        ...HEAD,
        'op f',
        '  input x? json, y? json, answer? json',
        'req A "a"',
        '  example f {"x": 1.0, "y": [5, {"z": null}]}',
        '    expect result = {"y": [5, {"z": null}], "x": 1}',
        '    expect result.y.1.z = null',
        '    expect result.y.0 ≈ 5.5 ± 0.5',
        '    expect result.x = 2',
        '    expect result.y.2 = 5',
        '    expect result.y.0 ≈ 5.5 ± 0.4',
        '    expect result.y.1 = {}',
        '  example f {"answer": {"result": 0, "audit": "{\\"a\\": [1, 2]}"}}',
        '    expect audit.a.1 = 2',
        '    expect audit = "{\\"a\\": [1, 2]}"',
        '    expect audit.b = 1',
        '  table f',
        '    | x | result.x | result.y |',
        '    | 1 | 2        | 3        |',
      ),
    ),
    [11, 12, 13, 14, 18, 21, 21].map((n) => `s.duramen:${n}: error T002`),
  );
  assert.deepEqual(
    diags(R(...HEAD, 'op f', '  input answer? json', 'errors', '  e when never', 'req A "a"', '  example f {"answer": {"result": 1}}', '    expect error = "e"', '  example g {"answer": {"error": "e"}}', '    expect error = "e"')),
    ['s.duramen:10: error T002'],
  );
});

test('REQ-OR-004: an oracle that fails', () => {
  assert.deepEqual(
    diags({ 's.duramen': t('duramen 0.1', 'spec s 1', 'oracle no-such-program-for-duramen', ...OPF, 'req A "a"', '  example f {}') }),
    ['s.duramen:3: error T020', 's.duramen:7: error T021'],
  );
  assert.deepEqual(
    diags(R(...HEAD, 'op f', '  input x? json, exit? integer', 'req A "a"', '  example f {"x": 1}', '    expect result.x = 2', '  example f {"exit": 3}', '    expect result.exit = 3')),
    ['s.duramen:3: error T020', 's.duramen:8: error T002'],
  );
  assert.deepEqual(
    diags(R(...HEAD, 'op f', '  input exit? integer', 'req A "a"', '  example f {}', '  example raw \'{"id": "r", "op": "f", "input": {"exit": 4}}\'')),
    ['s.duramen:8: error T020'],
  );
  assert.deepEqual(
    diags({ 's.duramen': t('duramen 0.1', 'spec s 1', 'oracle no-such-program-for-duramen', ...OPF, 'req A "a"', "  example raw '{\"id\": \"r\", \"op\": \"f\"}'") }),
    ['s.duramen:7: error T020', 's.duramen:7: error T021'],
  );
});

test('REQ-OR-005: examples with no answer', () => {
  assert.deepEqual(
    diags(R(...HEAD, 'op f', '  input silent? boolean', 'req A "a"', '  example f {"silent": true}', '  example f {}', '  example raw \'{"id": "r", "op": "f", "input": {"silent": true}}\'')),
    ['s.duramen:7: error T021', 's.duramen:9: error T021'],
  );
});

test('REQ-OR-006: examples the oracle cannot compute', () => {
  assert.deepEqual(
    diags(R(...HEAD, 'op f', '  input answer? json', 'req A "a"', '  example f {"answer": {"oracle_error": "left open"}}', '    expect result = 1', '    expect result = ?')),
    ['s.duramen:7: error T022'],
  );
});

test('REQ-OR-007: errors nobody expected', () => {
  assert.deepEqual(
    check(
      R(...HEAD, 'op f', '  input answer? json', 'errors', '  e when never', 'req A "a"', '  example f {"answer": {"error": "e"}}', '  example f {"answer": {"error": "e"}}', '    expect error = "e"'),
    ),
    { diagnostics: ['s.duramen:9: warning T024'], errors: 0, warnings: 1 },
  );
});

test('REQ-OR-008: values taken from the oracle', () => {
  assert.deepEqual(diags(R(...HEAD, ...OPF, 'req A "a"', '  example f {"x": 1}', '    expect result.x = ?', '    expect result.y = ?')), ['s.duramen:9: error T025']);
});

// ---- suite
test('REQ-SU-001: no suite from a record with errors', () => {
  assert.deepEqual(cases({ 's.duramen': 'frobnicate\n' }), { cases: [], errors: 3 });
  assert.deepEqual(cases({ 's.duramen': t('duramen 0.1', 'spec s 1', 'req A "a"', '  text', '    Nothing to show.') }), { cases: [], errors: 1 });
  const r = cases(R(...HEAD, ...OPF, 'req A "a"', '  example f {"y": 1}'));
  assert.equal(r.errors, 0);
  assert.equal(r.cases[0].id, 'A#1');
});

test('REQ-SU-002: one case per example', () => {
  const r = cases(R(...HEAD, ...OPF, 'req A "a"', '  example f {"x": 1}', '    expect result.x = 1', 'req B "b"', '  on posix', '  table f', '    | x | result.x |', '    | 2 | 2        |', '    | 3 | ?        |'));
  assert.deepEqual(r, {
    errors: 0,
    cases: [
      { checks: [{ kind: 'eq', path: 'result.x', value: 1 }], full: { members: ['id', 'result'], result: { x: 1 }, tolerances: {} }, id: 'A#1', kind: 'example', line: '{"id":"A#1","op":"f","input":{"x": 1}}', platform: 'any', reqs: ['REQ-A'] },
      { checks: [{ kind: 'eq', path: 'result.x', value: 2 }], full: { members: ['id', 'result'], result: { x: 2 }, tolerances: {} }, id: 'B#1', kind: 'example', line: '{"id":"B#1","op":"f","input":{"x":2}}', platform: 'posix', reqs: ['REQ-B'] },
      { checks: [{ from: 'oracle', kind: 'eq', path: 'result.x', value: 3 }], full: { members: ['id', 'result'], result: { x: 3 }, tolerances: {} }, id: 'B#2', kind: 'example', line: '{"id":"B#2","op":"f","input":{"x":3}}', platform: 'posix', reqs: ['REQ-B'] },
    ],
  });
  const r2 = cases({
    'b.duramen': t('duramen 0.1', 'req B "b"', '  on windows', '  example f {}'),
    'a.duramen': t('duramen 0.1', 'spec s 1', ...HEAD, ...OPF, 'req A "a"', '  example f {}', '  example f {}'),
    'echo.mjs': ECHO,
  });
  assert.deepEqual(r2.cases.map((c: any) => c.id), ['A#1', 'A#2', 'B#1']);
  assert.equal(r2.cases[2].platform, 'windows');
});

test('REQ-SU-003: request lines', () => {
  const r = cases({
    's.duramen': t(
      'duramen 0.1',
      'spec s 1',
      '  request {"clock": "c", "trace": true}',
      ...HEAD,
      'op f',
      '  input x? json',
      'op g',
      '  input x? json',
      '  request {"mode": 2}',
      'req A "a"',
      '  example f {"x" : 2.50e0 }',
      '  example f',
      '  example f {"x": 1}',
      '    request {"trace": false, "user": "u"}',
      '    omit clock',
      '  example g {"x": 1}',
      '    omit id, input',
      '  example f {"x": 1}',
      '    omit op, id',
      '  example raw \'{"id": "A#6",  "op": "f"}\'',
    ),
    'echo.mjs': ECHO,
  });
  assert.deepEqual(r.cases[0], {
    checks: [],
    full: { members: ['id', 'result'], result: { x: 2.5 }, tolerances: {} },
    id: 'A#1',
    kind: 'example',
    line: '{"id":"A#1","op":"f","clock":"c","trace":true,"input":{"x" : 2.50e0 }}',
    platform: 'any',
    reqs: ['REQ-A'],
  });
  assert.equal(r.cases[1].line, '{"id":"A#2","op":"f","clock":"c","trace":true}');
  assert.equal(r.cases[2].line, '{"id":"A#3","op":"f","trace":false,"user":"u","input":{"x": 1}}');
  assert.deepEqual(r.cases[3], { checks: [], full: { members: ['id', 'result'], result: {}, tolerances: {} }, id: 'A#4', kind: 'example', line: '{"op":"g","mode":2}', platform: 'any', reqs: ['REQ-A'], solo: true });
  assert.equal(r.cases[4].line, '{"clock":"c","trace":true,"input":{"x": 1}}');
  assert.equal(r.cases[4].solo, true);
  assert.equal(r.cases[5].line, '{"id": "A#6",  "op": "f"}');
  assert.equal(r.cases[5].solo, true);

  const r2 = cases(
    R(
      ...HEAD,
      'op f',
      '  input files? object, n? number',
      'req A "a"',
      '  example f {"n" : 1.50, "files": {"z": "old"}}',
      '    input files."a.duramen"',
      '      duramen 0.1',
      '      "quoted" é',
      '    input files.z',
      '      new',
      '  table f',
      '    | n      | files |',
      '    | 1.50   |       |',
      '    |        | {}    |',
    ),
  );
  assert.equal(r2.cases[0].line, '{"id":"A#1","op":"f","input":{"n":1.5,"files":{"z":"new\\n","a.duramen":"duramen 0.1\\n\\"quoted\\" é\\n"}}}');
  assert.equal(r2.cases[1].line, '{"id":"A#2","op":"f","input":{"n":1.50}}');
  assert.equal(r2.cases[2].line, '{"id":"A#3","op":"f","input":{"files":{}}}');
});

test('REQ-SU-004: checks', () => {
  const r = cases(
    R(
      ...HEAD,
      ...OPF,
      'req A "a"',
      '  example f {"x": {"y": [1, 2]}}',
      '    expect result.x.y.0 = 1',
      '    expect result.x.y.1 ~ 2.1 +- 0.25',
      '    expect result.x = ?',
      '    expect id = "A#1"',
      '  table f',
      '    | x | result.x ± 0.5 |',
      '    | 2 | 2.25           |',
    ),
  );
  assert.deepEqual(r.cases[0].checks, [
    { kind: 'eq', path: 'result.x.y.0', value: 1 },
    { kind: 'approx', path: 'result.x.y.1', tol: 0.25, value: 2.1 },
    { from: 'oracle', kind: 'eq', path: 'result.x', value: { y: [1, 2] } },
    { kind: 'eq', path: 'id', value: 'A#1' },
  ]);
  assert.deepEqual(r.cases[1].checks, [{ kind: 'approx', path: 'result.x', tol: 0.5, value: 2.25 }]);
});

test('REQ-SU-005: the oracle whole answer', () => {
  const r = cases(
    R(
      ...HEAD,
      'op f',
      '  input answer? json',
      '  audit',
      '  tolerance result.t 0.5',
      '  tolerance result.u 0',
      'op g',
      '  input answer? json',
      'errors',
      '  e when never',
      'req A "a"',
      '  example f {"answer": {"result": {"t": 1}, "audit": "A"}}',
      '  example f {"answer": {"error": "e", "extra": 1}}',
      '    expect error = "e"',
      '  example g {"answer": {"result": 2, "audit": "B"}}',
      '  example h {"answer": {"error": "e"}}',
      '    expect error = "e"',
    ),
  );
  const tol = { 'result.t': 0.5, 'result.u': 0 };
  assert.deepEqual(r.cases[0].full, { audit: 'A', members: ['audit', 'id', 'result'], result: { t: 1 }, tolerances: tol });
  assert.deepEqual(r.cases[1].full, { error: 'e', members: ['error', 'extra', 'id'], tolerances: tol });
  assert.deepEqual(r.cases[2].full, { members: ['audit', 'id', 'result'], result: 2, tolerances: {} });
  assert.deepEqual(r.cases[3].full, { error: 'e', members: ['error', 'id'], tolerances: {} });
});
