import { test } from 'node:test';
import assert from 'node:assert';
import { call, cases, diags, ECHO, rec, withEcho } from './helpers.ts';

const H = 'duramen 0.1\nspec s 1\n';
const e = (line: number, code: string, level = 'error') => `s.duramen:${line}: ${level} ${code}`;
const w = (line: number, code: string) => e(line, code, 'warning');
const d = (body: string, head?: string) => diags(rec(body, head));
const plain = (body: string) => diags({ 's.duramen': H + body });

test('REQ-CK-001 every requirement has an example', () => {
  assert.deepStrictEqual(plain('req A "a"\n  text\n    It MUST work.\n'), [e(3, 'T001')]);
  assert.deepStrictEqual(plain('req A "a"\n  table f\n    | x |\n    |---|\n'), [e(4, 'P013')]);
});

test('REQ-CK-002 IDs are unique', () => {
  assert.deepStrictEqual(
    d(
      'req A "a"\n  example f {}\nreq A "again"\n  example f {}\nopen A "an open item may share a requirement\'s ID"\n  text\n    Open.\nopen B "b"\n  text\n    Open.\nopen B "b again"\n  text\n    Open.\ndecision D-1 "d"\n  source s\ndecision D-1 "d again"\n  source s\nreq C "c"\n  decision D-1\n  example f {}\n',
      'op f\n  input x? json\n',
    ),
    [e(8, 'T007'), e(16, 'T007'), e(21, 'T007')],
  );
  assert.deepStrictEqual(
    diags(withEcho({ 'a.duramen': 'duramen 0.1\nspec s 1\noracle node echo.mjs\nop f\n  input x? json\nreq A "a"\n  example f {}\n', 'b.duramen': 'duramen 0.1\nreq A "a"\n  example f {}\nop f\n  input y? json\n' })),
    ['b.duramen:2: error T007', 'b.duramen:4: error T007'],
  );
  assert.deepStrictEqual(
    d(
      'req A "a"\n  decision REQ-A, OPEN-B\n  example f {}\ndecision REQ-A "named like a requirement"\n  source s\ndecision OPEN-B "named like an open item"\n  source s\nopen B "b"\n  text\n    Open.\nreq A "a third time"\n  example f {}\nreq A "and a third"\n  example f {}\n',
      'op f\n  input x? json\n',
    ),
    [e(16, 'T007'), e(18, 'T007')],
  );
});

test('REQ-CK-003 cited decisions are declared', () => {
  assert.deepStrictEqual(
    d('decision D-1 "d"\n  source s\nreq A "a"\n  decision D-1 D-2, D-3\n  decision D-2\n  example f {}\n', 'op f\n  input x? json\n'),
    [e(8, 'T008'), e(8, 'T008')],
  );
});

test('REQ-CK-004 examples of declared operations', () => {
  assert.deepStrictEqual(
    d(
      'errors\n  e when never\nreq A "a"\n  example g {"a": 1}\n  example f {"b": 1}\n  example f {"a": 1, "c": 2}\n  example f\n  example g {"answer": {"error": "e"}}\n    expect error = "e"\n  example raw \'{"id": "A#6", "op": "g"}\'\n  table f\n    | b | c |\n    | 1 | 2 |\n  example g {}\n    expect error.code = "e"\n',
      'op f\n  input a number, b? number, answer? json\n',
    ).filter((x) => !x.includes('T02')),
    [e(9, 'T009'), e(10, 'T010'), w(11, 'T011'), e(12, 'T010'), e(18, 'T010'), w(18, 'T011'), e(19, 'T009')],
  );
});

test('REQ-CK-005 expected errors are declared', () => {
  const head = 'op f\n  input answer? json\nerrors\n  e when never\n';
  assert.deepStrictEqual(
    d(
      'req A "a"\n  example f {"answer": {"error": "e"}}\n    expect error = "e"\n  example f {"answer": {"error": "nope"}}\n    expect error = "nope"\n  example raw \'{"id": "r", "op": "f", "input": {"answer": {"error": "other"}}}\'\n    expect error = "other"\n  example f {"answer": {"error": "e"}}\n    expect error = ?\n',
      head,
    ),
    [e(12, 'T023'), e(14, 'T023')],
  );
  assert.deepStrictEqual(
    d('req A "a"\n  example f {"answer": {"error": 1}}\n    expect error ≈ 1 ± 0\n  table f\n    | answer           | error ± 1 |\n    | {"error": 2}     | 2         |\n    | {"error": "e"}   | ?         |\n', head),
    [e(10, 'T023'), e(13, 'T023')],
  );
});

test('REQ-CK-006 obligations live in requirements', () => {
  assert.deepStrictEqual(
    diags({
      's.duramen':
        'duramen 0.1\nspec s 1\n  text\n    The program MUST work.\nop f\n  result what it MUST return\nerrors\n  e when it SHALL fail\nsection S "It MUST be titled"\n  text\n    REQUIRED reading.\nnote\n  text\n    This note says `MUST`, "SHALL" and “REQUIRED”, MUSTARD and must.\ndecision D-1 "d"\n  source s\n  text\n    Fine.\n  rejected "Another MUST."\nopen O "o"\n  text\n    It MUST NOT be.\n',
    }),
    [e(2, 'T004'), e(5, 'T004'), e(8, 'T004'), e(9, 'T004'), e(15, 'T004'), w(15, 'T012'), w(20, 'T014')],
  );
  assert.deepStrictEqual(plain('decision D-1 "d"\n  source s\n  text\n    It MUST.\n  rejected "It SHALL."\n  rejected "It is REQUIRED."\n'), [e(3, 'T004'), e(3, 'T004'), e(3, 'T004'), w(3, 'T012')]);
  assert.deepStrictEqual(plain('errors\n  e when the "MUST\n    hold" rule fails\n  f when the "MUST hold" rule fails\nnote\n  text\n    A MUST-have.\nsection S "s"\n  text\n    MUSTé\n'), [e(4, 'T004'), e(7, 'T004'), e(10, 'T004')]);
  assert.deepStrictEqual(plain('section T "t"\n  text\n    It ``MUST`` be, and it `MUST` not.\n'), [e(3, 'T004')]);
  assert.deepStrictEqual(
    plain('note\n  text\n    x`a`MUST\nnote\n  text\n    MU`a`ST, and "MU"ST\nnote\n  text\n    A"q"SHALL\ndecision D-1 "d"\n  source s\n  text\n    Fine.\n  rejected "\\"It\\nMUST\\" be"\n'),
    [e(3, 'T004'), e(9, 'T004'), e(12, 'T004'), w(12, 'T012')],
  );
  assert.deepStrictEqual(plain('decision D-1 "d"\n  source s\n  text\n    Fine.\n  rejected "\\"It\\rMUST\\" be"\n'), [e(3, 'T004'), w(3, 'T012')]);
});

test('REQ-CK-007 open items are not tested', () => {
  assert.deepStrictEqual(plain('open O "o"\n  example f {}\n  table f\n    | x |\n    | 1 |\n  example f {not json\n    expect nothing at all\n  table g h\n    | {bad |\n'), [e(4, 'T003'), e(5, 'T003'), e(8, 'T003'), e(10, 'T003')]);
});

test('REQ-CK-008 the order of errors is stated once', () => {
  const head = 'op f\n  input x? json\nerrors\n  too_big when x > 9\n  too_small when x < 0\n';
  assert.deepStrictEqual(
    d(
      'req A "a"\n  text\n    A request that is too_big gets too_big, and one too_small gets too_small.\n  example f {}\nreq B "b"\n  text\n    too_big is checked Before too_small.\n  example f {}\nreq C "c"\n  text\n    too_big is checked first.\n    After that, nothing.\n  example f {}\nreq D "d"\n  text\n    too_big and too_small are checked in this\n    order.\n  example f {}\n',
      head,
    ),
    [e(14, 'T005'), e(23, 'T005')],
  );
  assert.deepStrictEqual(d('req A "a"\n  text\n    A request may be refused before it is read: see the errors list.\n  example f {}\n', 'op f\n  input x? json\nerrors\n  e when x\n  f when y\n'), []);
  assert.deepStrictEqual(d('req A "a"\n  text\n    too_bigé, then too_small: decided before-hand.\n  example f {}\nreq B "b"\n  text\n    xtoo_big and too_small2 come after.\n  example f {}\n', head), [e(10, 'T005')]);
});

test('REQ-CK-009 decisions', () => {
  assert.deepStrictEqual(
    d(
      'decision D-1 "uncited, no source"\ndecision D-2 "bad status"\n  source s\n  status Accepted\ndecision D-3 "superseded by nothing"\n  source s\n  status superseded\ndecision D-4 "superseded by an undeclared one"\n  source s\n  status superseded by D-9\ndecision D-5 "superseded properly"\n  source s\n  status superseded by D-6\ndecision D-6 "accepted, with more words"\n  source s\n  status accepted on 2026-01-01\ndecision D-7 "observed"\n  source s\n  status observed\nreq A "a"\n  decision D-2, D-3, D-4, D-5, D-6, D-7\n  example f {}\n',
      'op f\n  input x? json\n',
    ),
    [w(6, 'T012'), w(6, 'T013'), e(7, 'T027'), e(10, 'T027'), e(13, 'T027'), e(25, 'T028'), e(25, 'T028'), e(25, 'T028'), w(25, 'T028')],
  );
  assert.deepStrictEqual(
    d('decision D-1 "a comma after the word"\n  source s\n  status accepted, 2026-01-01\ndecision D-2 "an empty status"\n  source\n  status\nreq A "a"\n  decision D-1, D-2\n  example f {}\n', 'op f\n  input x? json\n'),
    [e(6, 'T027'), w(9, 'T013'), e(9, 'T027')],
  );
  assert.deepStrictEqual(
    plain('req A "a"\n  decision D, E\n  text\n    T.\ndecision D "d"\n  source x\n  status superseded  by E\ndecision E "e"\n  source x\n  status Accepted\n'),
    [e(3, 'T001'), e(3, 'T028'), e(7, 'T027'), e(10, 'T027')],
  );
  assert.deepStrictEqual(
    d('req A "a"\n  decision D\n  example f {}\ndecision D "d"\n  source x\n  status rejected\ndecision D "d again"\n  source x\ndecision E "e"\n  source x\ndecision E "e again"\n  source x\n', 'op f\n  input x? json\n'),
    [e(6, 'T028'), e(12, 'T007'), w(14, 'T012'), e(16, 'T007'), w(16, 'T012')],
  );
});

test('REQ-OR-001 a record with examples has an oracle', () => {
  assert.deepStrictEqual(plain('op f\n  input x? json\nreq A "a"\n  example f {}\n    expect result = 1\n'), [e(2, 'T019')]);
  assert.deepStrictEqual(plain('op f\n  input x? json\nreq A "a"\n  text\n    No example.\nreq B "b"\n  example f {}\n'), [e(2, 'T019'), e(5, 'T001')]);
});

test('REQ-OR-002 how the oracle is run', () => {
  assert.deepStrictEqual(
    diags({
      's.duramen':
        'duramen 0.1\nspec s 1\n  request {"clock": 1}\noracle node echo.mjs\nop f\n  input line? boolean, x? json\nreq A "a"\n  example f {"line": true,  "x": 2.50}\n    expect result = "{\\"id\\":\\"A#1\\",\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true,  \\"x\\": 2.50}}"\n  example f {"line": true}\n    omit id\n    expect result = "{\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true}}"\n  example raw \'{"id": "x",  "op": "f", "input": {"line": true}}\'\n    expect id = "x"\n    expect result = "{\\"id\\": \\"x\\",  \\"op\\": \\"f\\", \\"input\\": {\\"line\\": true}}"\n',
      'echo.mjs': ECHO,
    }),
    [],
  );
  assert.deepStrictEqual(
    diags({ 'sub/s.duramen': H + 'oracle node "my echo.mjs"\nop f\n  input x? json\nreq A "a"\n  example f {"x": 1}\n    expect result.x = 1\n', 'sub/my echo.mjs': ECHO }),
    [],
  );
  assert.deepStrictEqual(d('req A "a"\n  text\n    No example.\nreq B "b"\n  example f {"x": 1}\n    expect result.x = 2\n'), ['s.duramen:6: error T001', 's.duramen:11: error T002']);
  assert.deepStrictEqual(
    d(
      'req A "a"\n  example raw \'{"id": "r1", "op": "f", "input": {"say": " \\u00a0\\n{\\"id\\": \\"elsewhere\\", \\"result\\": 1}\\n\\t"}}\'\n    expect result = 1\n  example raw \'{"id": "r2", "op": "f", "input": {"say": "{\\"id\\": \\"r2\\", \\"result\\": 1}\\r\\n"}}\'\n    expect result = 1\n  example raw \'{"id": "r3", "op": "f", "input": {"say": "{\\"result\\": 1}\\r{\\"result\\": 2}"}}\'\n    expect result = ?\n  example raw \'{"id": "r4", "op": "f", "input": {"say": "{\\"result\\": 1}\\n[2]"}}\'\n    expect result = ?\n',
      'op f\n  input say? string\n',
    ),
    [e(11, 'T021'), e(13, 'T021')],
  );
  const c = cases(rec('req A "a"\n  example raw "{\\"id\\":\\"r\\",\\"op\\":\\"f\\",\\"input\\":{\\"x\\":\\"\\ud800\\"}}"\n    expect result = ?\n'));
  assert.deepStrictEqual(c.cases[0].checks[0].value, { x: '�' });
});

test('REQ-OR-003 examples the oracle disagrees with', () => {
  assert.deepStrictEqual(
    d(
      'req A "a"\n  example f {"x": 1.0, "y": [5, {"z": null}]}\n    expect result = {"y": [5, {"z": null}], "x": 1}\n    expect result.y.1.z = null\n    expect result.y.0 ≈ 5.5 ± 0.5\n    expect result.x = 2\n    expect result.y.2 = 5\n    expect result.y.0 ≈ 5.5 ± 0.4\n    expect result.y.1 = {}\n  example f {"answer": {"result": 0, "audit": "{\\"a\\": [1, 2]}"}}\n    expect audit.a.1 = 2\n    expect audit = "{\\"a\\": [1, 2]}"\n    expect audit.b = 1\n  table f\n    | x | result.x | result.y |\n    | 1 | 2        | 3        |\n  example f {"x": {"": 1}}\n    expect result.x. = 1\n    expect result..x = 1\n  example f {"y": [7, 8]}\n    expect result.y.1 = 8\n    expect result.y.length = 2\n    expect result.y.01 = 8\n',
    ),
    [e(11, 'T002'), e(12, 'T002'), e(13, 'T002'), e(14, 'T002'), e(18, 'T002'), e(21, 'T002'), e(21, 'T002'), e(24, 'T002'), e(27, 'T002'), e(28, 'T002')],
  );
  assert.deepStrictEqual(
    d('req A "a"\n  example f {"answer": {"result": 1}}\n    expect error = "e"\n  example g {"answer": {"error": "e"}}\n    expect error = "e"\n', 'op f\n  input answer? json\nerrors\n  e when never\n'),
    [e(10, 'T002')],
  );
  assert.deepStrictEqual(
    d('req A "a"\n  example f {"answer": {"result": 1, "audit": "{\\"a\\": 1e400, \\"b\\": 1}"}}\n    expect audit.b = 1\n    expect audit.a = ?\n  example f {"x": 2}\n    expect result.x ≈ 1.9 ± 0.1\n    expect result.x ≈ 1.9 ± 0.10000000000000009\n  example f {"x": 1}\n    expect result.x ≈ -8.673617379884035e-19 ± 1\n'),
    [e(8, 'T002'), e(9, 'T025'), e(11, 'T002')],
  );
});

test('REQ-OR-004 an oracle that fails', () => {
  const noprog = (body: string) => diags({ 's.duramen': H + 'oracle no-such-program-for-duramen\nop f\n  input x? json\n' + body });
  assert.deepStrictEqual(noprog('req A "a"\n  example f {}\n'), [e(3, 'T020'), e(7, 'T021')]);
  assert.deepStrictEqual(d('req A "a"\n  example f {"x": 1}\n    expect result.x = 2\n  example f {"exit": 3}\n    expect result.exit = 3\n', 'op f\n  input x? json, exit? integer\n'), [e(3, 'T020'), e(8, 'T002')]);
  assert.deepStrictEqual(d('req A "a"\n  example f {}\n  example raw \'{"id": "r", "op": "f", "input": {"exit": 4}}\'\n', 'op f\n  input exit? integer\n'), [e(8, 'T020')]);
  assert.deepStrictEqual(noprog('req A "a"\n  example raw \'{"id": "r", "op": "f"}\'\n'), [e(7, 'T020'), e(7, 'T021')]);
  assert.deepStrictEqual(diags(withEcho({ 's.duramen': H + 'oracle node "echo.mjs\nop f\n  input x? json\nreq A "a"\n  example f {}\n' })), [e(3, 'T020'), e(7, 'T021')]);
});

test('REQ-OR-005 examples with no answer', () => {
  assert.deepStrictEqual(
    d('req A "a"\n  example f {"silent": true}\n  example f {}\n  example raw \'{"id": "r", "op": "f", "input": {"silent": true}}\'\n', 'op f\n  input silent? boolean\n'),
    [e(7, 'T021'), e(9, 'T021')],
  );
  assert.deepStrictEqual(
    d('req A "a"\n  example f {"say": "{\\"id\\":\\"A#1\\",\\"result\\":1e400}"}\n    expect result = ?\n  example f {"say": "{\\"id\\":\\"A#2\\",\\"result\\":1e300}"}\n    expect result = ?\n', 'op f\n  input say string\n'),
    [e(7, 'T021')],
  );
});

test('REQ-OR-006 examples the oracle cannot compute', () => {
  assert.deepStrictEqual(d('req A "a"\n  example f {"answer": {"oracle_error": "left open"}}\n    expect result = 1\n    expect result = ?\n'), [e(7, 'T022')]);
  assert.deepStrictEqual(d('req A "a"\n  example f {"answer": {"oracle_error": null, "error": "x"}}\n'), [e(7, 'T022')]);
});

test('REQ-OR-007 errors nobody expected', () => {
  const head = 'op f\n  input answer? json\nerrors\n  e when never\n';
  assert.deepStrictEqual(call('check', { files: rec('req A "a"\n  example f {"answer": {"error": "e"}}\n  example f {"answer": {"error": "e"}}\n    expect error = "e"\n', head) }).result, {
    diagnostics: [w(9, 'T024')],
    errors: 0,
    warnings: 1,
  });
  assert.deepStrictEqual(d('req A "a"\n  example f {"answer": {"error": null}}\n', 'op f\n  input answer? json\n'), [w(7, 'T024')]);
  assert.deepStrictEqual(d('req A "a"\n  example f {"answer": {"error": "e"}}\n    expect result = 1\n  example f {"answer": {"error": "e"}}\n    expect id = "A#2"\n', 'op f\n  input answer? json\n'), [e(8, 'T002')]);
});

test('REQ-OR-008 values taken from the oracle', () => {
  assert.deepStrictEqual(d('req A "a"\n  example f {"x": 1}\n    expect result.x = ?\n    expect result.y = ?\n'), [e(9, 'T025')]);
});
