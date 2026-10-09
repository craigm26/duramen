import { test } from 'node:test';
import assert from 'node:assert';
import { ECHO, check, diags, one, s, withEcho } from './helpers.ts';

const H = ['duramen 0.1', 'spec s 1'];
const E = ['duramen 0.1', 'spec s 1', 'oracle node echo.mjs'];
const e = (...rest: string[]) => s(...E, ...rest);
const f = (n: number, code: string, level = 'error') => `s.duramen:${n}: ${level} ${code}`;

// REQ-CK-001
test('CK-001: every requirement has an example', () => {
  assert.deepStrictEqual(one(s(...H, 'req A "a"', '  text', '    It MUST work.')), [f(3, 'T001')]);
  assert.deepStrictEqual(one(s(...H, 'req A "a"', '  table f', '    | x |', '    |---|')), [f(4, 'P013')]);
});

// REQ-CK-002
test('CK-002: IDs are unique', () => {
  assert.deepStrictEqual(withEcho(e('op f', '  input x? json', 'req A "a"', '  example f {}', 'req A "again"', '  example f {}',
    'open A "an open item may share a requirement\'s ID"', '  text', '    Open.', 'open B "b"', '  text', '    Open.', 'open B "b again"',
    '  text', '    Open.', 'decision D-1 "d"', '  source s', 'decision D-1 "d again"', '  source s', 'req C "c"', '  decision D-1',
    '  example f {}')), [f(8, 'T007'), f(16, 'T007'), f(21, 'T007')]);
  assert.deepStrictEqual(diags({
    'a.duramen': s(...E, 'op f', '  input x? json', 'req A "a"', '  example f {}'),
    'b.duramen': s('duramen 0.1', 'req A "a"', '  example f {}', 'op f', '  input y? json'), 'echo.mjs': ECHO,
  }), ['b.duramen:2: error T007', 'b.duramen:4: error T007']);
  assert.deepStrictEqual(withEcho(e('op f', '  input x? json', 'req A "a"', '  decision REQ-A, OPEN-B', '  example f {}',
    'decision REQ-A "named like a requirement"', '  source s', 'decision OPEN-B "named like an open item"', '  source s', 'open B "b"',
    '  text', '    Open.', 'req A "a third time"', '  example f {}', 'req A "and a third"', '  example f {}')), [f(16, 'T007'), f(18, 'T007')]);
});

// REQ-CK-003
test('CK-003: cited decisions are declared', () => {
  assert.deepStrictEqual(withEcho(e('op f', '  input x? json', 'decision D-1 "d"', '  source s', 'req A "a"', '  decision D-1 D-2, D-3',
    '  decision D-2', '  example f {}')), [f(8, 'T008'), f(8, 'T008')]);
});

// REQ-CK-004
test('CK-004: examples of declared operations', () => {
  assert.deepStrictEqual(withEcho(e('op f', '  input a number, b? number', 'errors', '  e when never', 'req A "a"', '  example g {"a": 1}',
    '  example f {"b": 1}', '  example f {"a": 1, "c": 2}', '  example f', '  example g {"answer": {"error": "e"}}', '    expect error = "e"',
    `  example raw '{"id": "A#6", "op": "g"}'`, '  table f', '    | b | c |', '    | 1 | 2 |', '  example g {}', '    expect error.code = "e"')),
  [f(9, 'T009'), f(10, 'T010'), f(11, 'T011', 'warning'), f(12, 'T010'), f(18, 'T010'), f(18, 'T011', 'warning'), f(19, 'T009')]);
});

// REQ-CK-005
test('CK-005: expected errors are declared', () => {
  assert.deepStrictEqual(withEcho(e('op f', '  input answer? json', 'errors', '  e when never', 'req A "a"',
    '  example f {"answer": {"error": "e"}}', '    expect error = "e"', '  example f {"answer": {"error": "nope"}}', '    expect error = "nope"',
    `  example raw '{"id": "r", "op": "f", "input": {"answer": {"error": "other"}}}'`, '    expect error = "other"',
    '  example f {"answer": {"error": "e"}}', '    expect error = ?')), [f(12, 'T023'), f(14, 'T023')]);
  assert.deepStrictEqual(withEcho(e('op f', '  input answer? json', 'errors', '  e when never', 'req A "a"',
    '  example f {"answer": {"error": 1}}', '    expect error ≈ 1 ± 0', '  table f', '    | answer           | error ± 1 |',
    '    | {"error": 2}     | 2         |', '    | {"error": "e"}   | ?         |')), [f(10, 'T023'), f(13, 'T023')]);
});

// REQ-CK-006
test('CK-006: obligations live in requirements', () => {
  assert.deepStrictEqual(one(s(...H, '  text', '    The program MUST work.', 'op f', '  result what it MUST return', 'errors',
    '  e when it SHALL fail', 'section S "It MUST be titled"', '  text', '    REQUIRED reading.', 'note', '  text',
    '    This note says `MUST`, "SHALL" and “REQUIRED”, MUSTARD and must.', 'decision D-1 "d"', '  source s', '  text', '    Fine.',
    '  rejected "Another MUST."', 'open O "o"', '  text', '    It MUST NOT be.')),
  [f(2, 'T004'), f(5, 'T004'), f(8, 'T004'), f(9, 'T004'), f(15, 'T004'), f(15, 'T012', 'warning'), f(20, 'T014', 'warning')]);
  assert.deepStrictEqual(one(s(...H, 'decision D-1 "d"', '  source s', '  text', '    It MUST.', '  rejected "It SHALL."',
    '  rejected "It is REQUIRED."')), [f(3, 'T004'), f(3, 'T004'), f(3, 'T004'), f(3, 'T012', 'warning')]);
  assert.deepStrictEqual(one(s(...H, 'errors', '  e when the "MUST', '    hold" rule fails', '  f when the "MUST hold" rule fails', 'note',
    '  text', '    A MUST-have.', 'section S "s"', '  text', '    MUSTé')), [f(4, 'T004'), f(7, 'T004'), f(10, 'T004')]);
  assert.deepStrictEqual(one(s(...H, 'section T "t"', '  text', '    It ``MUST`` be, and it `MUST` not.')), [f(3, 'T004')]);
});

// REQ-CK-007
test('CK-007: open items are not tested', () => {
  assert.deepStrictEqual(one(s(...H, 'open O "o"', '  example f {}', '  table f', '    | x |', '    | 1 |', '  example f {not json',
    '    expect nothing at all', '  table g h', '    | {bad |')), [f(4, 'T003'), f(5, 'T003'), f(8, 'T003'), f(10, 'T003')]);
});

// REQ-CK-008
test('CK-008: the order of errors is stated once', () => {
  const head = ['op f', '  input x? json', 'errors', '  too_big when x > 9', '  too_small when x < 0'];
  assert.deepStrictEqual(withEcho(e(...head, 'req A "a"', '  text', '    A request that is too_big gets too_big, and one too_small gets too_small.',
    '  example f {}', 'req B "b"', '  text', '    too_big is checked Before too_small.', '  example f {}', 'req C "c"', '  text',
    '    too_big is checked first.', '    After that, nothing.', '  example f {}', 'req D "d"', '  text',
    '    too_big and too_small are checked in this', '    order.', '  example f {}')), [f(14, 'T005'), f(23, 'T005')]);
  assert.deepStrictEqual(withEcho(e('op f', '  input x? json', 'errors', '  e when x', '  f when y', 'req A "a"', '  text',
    '    A request may be refused before it is read: see the errors list.', '  example f {}')), []);
  assert.deepStrictEqual(withEcho(e(...head, 'req A "a"', '  text', '    too_bigé, then too_small: decided before-hand.', '  example f {}',
    'req B "b"', '  text', '    xtoo_big and too_small2 come after.', '  example f {}')), [f(10, 'T005')]);
});

// REQ-CK-009
test('CK-009: decisions', () => {
  assert.deepStrictEqual(withEcho(e('op f', '  input x? json', 'decision D-1 "uncited, no source"', 'decision D-2 "bad status"', '  source s',
    '  status Accepted', 'decision D-3 "superseded by nothing"', '  source s', '  status superseded', 'decision D-4 "x"', '  source s',
    '  status superseded by D-9', 'decision D-5 "properly"', '  source s', '  status superseded by D-6', 'decision D-6 "more words"',
    '  source s', '  status accepted on 2026-01-01', 'decision D-7 "observed"', '  source s', '  status observed', 'req A "a"',
    '  decision D-2, D-3, D-4, D-5, D-6, D-7', '  example f {}')),
  [f(6, 'T012', 'warning'), f(6, 'T013', 'warning'), f(7, 'T027'), f(10, 'T027'), f(13, 'T027'), f(25, 'T028'), f(25, 'T028'), f(25, 'T028'),
    f(25, 'T028', 'warning')]);
  assert.deepStrictEqual(withEcho(e('op f', '  input x? json', 'decision D-1 "a comma after the word"', '  source s',
    '  status accepted, 2026-01-01', 'decision D-2 "an empty status"', '  source', '  status', 'req A "a"', '  decision D-1, D-2',
    '  example f {}')), [f(6, 'T027'), f(9, 'T013', 'warning'), f(9, 'T027')]);
  assert.deepStrictEqual(one(s(...H, 'req A "a"', '  decision D, E', '  text', '    T.', 'decision D "d"', '  source x',
    '  status superseded  by E', 'decision E "e"', '  source x', '  status Accepted')),
  [f(3, 'T001'), f(3, 'T028'), f(7, 'T027'), f(10, 'T027')]);
  assert.deepStrictEqual(withEcho(e('op f', '  input x? json', 'req A "a"', '  decision D', '  example f {}', 'decision D "d"', '  source x',
    '  status rejected', 'decision D "d again"', '  source x', 'decision E "e"', '  source x', 'decision E "e again"', '  source x')),
  [f(6, 'T028'), f(12, 'T007'), f(14, 'T012', 'warning'), f(16, 'T007'), f(16, 'T012', 'warning')]);
});

// REQ-OR-001
test('OR-001: a record with examples has an oracle', () => {
  assert.deepStrictEqual(one(s(...H, 'op f', '  input x? json', 'req A "a"', '  example f {}', '    expect result = 1')), [f(2, 'T019')]);
  assert.deepStrictEqual(one(s(...H, 'op f', '  input x? json', 'req A "a"', '  text', '    No example.', 'req B "b"', '  example f {}')),
    [f(2, 'T019'), f(5, 'T001')]);
});

// REQ-OR-002
test('OR-002: how the oracle is run', () => {
  assert.deepStrictEqual(withEcho(s('duramen 0.1', 'spec s 1', '  request {"clock": 1}', 'oracle node echo.mjs', 'op f',
    '  input line? boolean, x? json', 'req A "a"', '  example f {"line": true,  "x": 2.50}',
    '    expect result = "{\\"id\\":\\"A#1\\",\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true,  \\"x\\": 2.50}}"',
    '  example f {"line": true}', '    omit id', '    expect result = "{\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true}}"',
    `  example raw '{"id": "x",  "op": "f", "input": {"line": true}}'`, '    expect id = "x"',
    '    expect result = "{\\"id\\": \\"x\\",  \\"op\\": \\"f\\", \\"input\\": {\\"line\\": true}}"')), []);
  assert.deepStrictEqual(diags({
    'sub/s.duramen': s('duramen 0.1', 'spec s 1', 'oracle node "my echo.mjs"', 'op f', '  input x? json', 'req A "a"',
      '  example f {"x": 1}', '    expect result.x = 1'), 'sub/my echo.mjs': ECHO,
  }), []);
  assert.deepStrictEqual(withEcho(e('op f', '  input x? json', 'req A "a"', '  text', '    No example.', 'req B "b"',
    '  example f {"x": 1}', '    expect result.x = 2')), [f(6, 'T001'), f(11, 'T002')]);
  assert.deepStrictEqual(withEcho(e('op f', '  input say? string', 'req A "a"',
    `  example raw '{"id": "r1", "op": "f", "input": {"say": " \\u00a0\\n{\\"id\\": \\"elsewhere\\", \\"result\\": 1}\\n\\t"}}'`,
    '    expect result = 1', `  example raw '{"id": "r2", "op": "f", "input": {"say": "{\\"id\\": \\"r2\\", \\"result\\": 1}\\r\\n"}}'`,
    '    expect result = 1', `  example raw '{"id": "r3", "op": "f", "input": {"say": "{\\"result\\": 1}\\r{\\"result\\": 2}"}}'`,
    '    expect result = ?', `  example raw '{"id": "r4", "op": "f", "input": {"say": "{\\"result\\": 1}\\n[2]"}}'`, '    expect result = ?')),
  [f(11, 'T021'), f(13, 'T021')]);
});

// REQ-OR-003
test('OR-003: examples the oracle disagrees with', () => {
  assert.deepStrictEqual(withEcho(e('op f', '  input x? json, y? json, answer? json', 'req A "a"',
    '  example f {"x": 1.0, "y": [5, {"z": null}]}', '    expect result = {"y": [5, {"z": null}], "x": 1}', '    expect result.y.1.z = null',
    '    expect result.y.0 ≈ 5.5 ± 0.5', '    expect result.x = 2', '    expect result.y.2 = 5', '    expect result.y.0 ≈ 5.5 ± 0.4',
    '    expect result.y.1 = {}', '  example f {"answer": {"result": 0, "audit": "{\\"a\\": [1, 2]}"}}', '    expect audit.a.1 = 2',
    '    expect audit = "{\\"a\\": [1, 2]}"', '    expect audit.b = 1', '  table f', '    | x | result.x | result.y |', '    | 1 | 2        | 3        |',
    '  example f {"x": {"": 1}}', '    expect result.x. = 1', '    expect result..x = 1', '  example f {"y": [7, 8]}', '    expect result.y.1 = 8',
    '    expect result.y.length = 2', '    expect result.y.01 = 8')),
  [f(11, 'T002'), f(12, 'T002'), f(13, 'T002'), f(14, 'T002'), f(18, 'T002'), f(21, 'T002'), f(21, 'T002'), f(24, 'T002'), f(27, 'T002'),
    f(28, 'T002')]);
  assert.deepStrictEqual(withEcho(e('op f', '  input answer? json', 'errors', '  e when never', 'req A "a"',
    '  example f {"answer": {"result": 1}}', '    expect error = "e"', '  example g {"answer": {"error": "e"}}', '    expect error = "e"')),
  [f(10, 'T002')]);
  assert.deepStrictEqual(withEcho(e('op f', '  input answer? json, x? json', 'req A "a"',
    '  example f {"answer": {"result": 1, "audit": "{\\"a\\": 1e400, \\"b\\": 1}"}}', '    expect audit.b = 1', '    expect audit.a = ?',
    '  example f {"x": 2}', '    expect result.x ≈ 1.9 ± 0.1', '    expect result.x ≈ 1.9 ± 0.10000000000000009', '  example f {"x": 1}',
    '    expect result.x ≈ -8.673617379884035e-19 ± 1')), [f(8, 'T002'), f(9, 'T025'), f(11, 'T002')]);
});

// REQ-OR-004
test('OR-004: an oracle that fails', () => {
  assert.deepStrictEqual(one(s(...H, 'oracle no-such-program-for-duramen', 'op f', '  input x? json', 'req A "a"', '  example f {}')),
    [f(3, 'T020'), f(7, 'T021')]);
  assert.deepStrictEqual(withEcho(e('op f', '  input x? json, exit? integer', 'req A "a"', '  example f {"x": 1}', '    expect result.x = 2',
    '  example f {"exit": 3}', '    expect result.exit = 3')), [f(3, 'T020'), f(8, 'T002')]);
  assert.deepStrictEqual(withEcho(e('op f', '  input exit? integer', 'req A "a"', '  example f {}',
    `  example raw '{"id": "r", "op": "f", "input": {"exit": 4}}'`)), [f(8, 'T020')]);
  assert.deepStrictEqual(one(s(...H, 'oracle no-such-program-for-duramen', 'op f', '  input x? json', 'req A "a"',
    `  example raw '{"id": "r", "op": "f"}'`)), [f(7, 'T020'), f(7, 'T021')]);
  assert.deepStrictEqual(withEcho(s(...H, 'oracle node "echo.mjs', 'op f', '  input x? json', 'req A "a"', '  example f {}')),
    [f(3, 'T020'), f(7, 'T021')]);
});

// REQ-OR-005
test('OR-005: examples with no answer', () => {
  assert.deepStrictEqual(withEcho(e('op f', '  input silent? boolean', 'req A "a"', '  example f {"silent": true}', '  example f {}',
    `  example raw '{"id": "r", "op": "f", "input": {"silent": true}}'`)), [f(7, 'T021'), f(9, 'T021')]);
  assert.deepStrictEqual(withEcho(e('op f', '  input say string', 'req A "a"', '  example f {"say": "{\\"id\\":\\"A#1\\",\\"result\\":1e400}"}',
    '    expect result = ?', '  example f {"say": "{\\"id\\":\\"A#2\\",\\"result\\":1e300}"}', '    expect result = ?')), [f(7, 'T021')]);
});

// REQ-OR-006
test('OR-006: examples the oracle cannot compute', () => {
  assert.deepStrictEqual(withEcho(e('op f', '  input answer? json', 'req A "a"', '  example f {"answer": {"oracle_error": "left open"}}',
    '    expect result = 1', '    expect result = ?')), [f(7, 'T022')]);
  assert.deepStrictEqual(withEcho(e('op f', '  input answer? json', 'req A "a"', '  example f {"answer": {"oracle_error": null, "error": "x"}}')),
    [f(7, 'T022')]);
});

// REQ-OR-007
test('OR-007: errors nobody expected', () => {
  assert.deepStrictEqual(check({
    's.duramen': e('op f', '  input answer? json', 'errors', '  e when never', 'req A "a"', '  example f {"answer": {"error": "e"}}',
      '  example f {"answer": {"error": "e"}}', '    expect error = "e"'), 'echo.mjs': ECHO,
  }), { diagnostics: [f(9, 'T024', 'warning')], errors: 0, warnings: 1 });
  assert.deepStrictEqual(check({
    's.duramen': e('op f', '  input answer? json', 'req A "a"', '  example f {"answer": {"error": null}}'), 'echo.mjs': ECHO,
  }), { diagnostics: [f(7, 'T024', 'warning')], errors: 0, warnings: 1 });
});

// REQ-OR-008
test('OR-008: values taken from the oracle', () => {
  assert.deepStrictEqual(withEcho(e('op f', '  input x? json', 'req A "a"', '  example f {"x": 1}', '    expect result.x = ?',
    '    expect result.y = ?')), [f(9, 'T025')]);
});
