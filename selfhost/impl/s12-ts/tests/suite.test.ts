import { test } from 'node:test';
import assert from 'node:assert';
import { ECHO, cases, judge, request, s } from './helpers.ts';

const E = ['duramen 0.1', 'spec s 1', 'oracle node echo.mjs'];
const files = (...rest: string[]) => ({ 's.duramen': s(...E, ...rest), 'echo.mjs': ECHO });

// REQ-SU-001
test('SU-001: no suite from a record with errors', () => {
  assert.deepStrictEqual(cases({ 's.duramen': 'frobnicate\n' }), { cases: [], errors: 3 });
  assert.deepStrictEqual(cases({ 's.duramen': s('duramen 0.1', 'spec s 1', 'req A "a"', '  text', '    Nothing to show.') }),
    { cases: [], errors: 1 });
  const r = cases(files('op f', '  input x? json', 'req A "a"', '  example f {"y": 1}'));
  assert.strictEqual(r.errors, 0);
  assert.strictEqual(r.cases[0].id, 'A#1');
});

// REQ-SU-002
test('SU-002: one case per example and table row', () => {
  const r = cases(files('op f', '  input x? json', 'req A "a"', '  example f {"x": 1}', '    expect result.x = 1', 'req B "b"', '  on posix',
    '  table f', '    | x | result.x |', '    | 2 | 2        |', '    | 3 | ?        |'));
  assert.deepStrictEqual(r, {
    errors: 0,
    cases: [
      { checks: [{ kind: 'eq', path: 'result.x', value: 1 }], full: { members: ['id', 'result'], result: { x: 1 }, tolerances: {} },
        id: 'A#1', kind: 'example', line: '{"id":"A#1","op":"f","input":{"x": 1}}', platform: 'any', reqs: ['REQ-A'] },
      { checks: [{ kind: 'eq', path: 'result.x', value: 2 }], full: { members: ['id', 'result'], result: { x: 2 }, tolerances: {} },
        id: 'B#1', kind: 'example', line: '{"id":"B#1","op":"f","input":{"x":2}}', platform: 'posix', reqs: ['REQ-B'] },
      { checks: [{ from: 'oracle', kind: 'eq', path: 'result.x', value: 3 }], full: { members: ['id', 'result'], result: { x: 3 }, tolerances: {} },
        id: 'B#2', kind: 'example', line: '{"id":"B#2","op":"f","input":{"x":3}}', platform: 'posix', reqs: ['REQ-B'] },
    ],
  });
  const r2 = cases({
    'b.duramen': s('duramen 0.1', 'req B "b"', '  on windows', '  example f {}'),
    'a.duramen': s('duramen 0.1', 'spec s 1', 'oracle node echo.mjs', 'op f', '  input x? json', 'req A "a"', '  example f {}', '  example f {}'),
    'echo.mjs': ECHO,
  });
  assert.deepStrictEqual(r2.cases.map((c: any) => c.id), ['A#1', 'A#2', 'B#1']);
  assert.strictEqual(r2.cases[2].platform, 'windows');
});

// REQ-SU-003
test('SU-003: request members, order, omit, solo', () => {
  const text = s('duramen 0.1', 'spec s 1', '  request {"clock": "c", "trace": true}', 'oracle node echo.mjs', 'op f', '  input x? json', 'op g',
    '  input x? json', '  request {"mode": 2}', 'req A "a"', '  example f {"x" : 2.50e0 }', '  example f', '  example f {"x": 1}',
    '    request {"trace": false, "user": "u"}', '    omit clock', '  example g {"x": 1}', '    omit id, input', '  example f {"x": 1}',
    '    omit op, id', `  example raw '{"id": "A#6",  "op": "f"}'`, '  example f {"x": 1}',
    '    request {"b": {"z": 1, "10": 2, "9": 3}, "2": "two", "a": 1}', '    omit clock', '    omit trace', '  table f', '    | result |', '    | ?      |');
  const r = cases({ 's.duramen': text, 'echo.mjs': ECHO });
  assert.strictEqual(r.errors, 0);
  const c = r.cases;
  assert.deepStrictEqual(c[0], {
    checks: [], full: { members: ['id', 'result'], result: { x: 2.5 }, tolerances: {} }, id: 'A#1', kind: 'example',
    line: '{"id":"A#1","op":"f","clock":"c","trace":true,"input":{"x" : 2.50e0 }}', platform: 'any', reqs: ['REQ-A'],
  });
  assert.strictEqual(c[1].line, '{"id":"A#2","op":"f","clock":"c","trace":true}');
  assert.strictEqual(c[2].line, '{"id":"A#3","op":"f","trace":false,"user":"u","input":{"x": 1}}');
  assert.deepStrictEqual(c[3], {
    checks: [], full: { members: ['id', 'result'], result: {}, tolerances: {} }, id: 'A#4', kind: 'example',
    line: '{"op":"g","mode":2}', platform: 'any', reqs: ['REQ-A'], solo: true,
  });
  assert.strictEqual(c[4].line, '{"clock":"c","trace":true,"input":{"x": 1}}');
  assert.strictEqual(c[4].solo, true);
  assert.strictEqual(c[5].line, '{"id": "A#6",  "op": "f"}');
  assert.strictEqual(c[5].solo, true);
  assert.strictEqual(c[6].line, '{"id":"A#7","op":"f","2":"two","b":{"9":3,"10":2,"z":1},"a":1,"input":{"x": 1}}');
  assert.strictEqual(c[6].solo, undefined);
  assert.strictEqual(c[7].line, '{"id":"A#8","op":"f","clock":"c","trace":true,"input":{}}');
});

test('SU-003: inputs from input lines and tables', () => {
  const r = cases(files('op f', '  input files? object, n? number', 'req A "a"', '  example f {"n" : 1.50, "files": {"z": "old"}}',
    '    input files."a.duramen"', '      duramen 0.1', '      "quoted" é', '    input files.z', '      new', '  table f',
    '    | n      | files |', '    | 1.50   |       |', '    |        | {}    |'));
  assert.strictEqual(r.errors, 0);
  assert.strictEqual(r.cases[0].line,
    '{"id":"A#1","op":"f","input":{"n":1.5,"files":{"z":"new\\n","a.duramen":"duramen 0.1\\n\\"quoted\\" é\\n"}}}');
  assert.strictEqual(r.cases[1].line, '{"id":"A#2","op":"f","input":{"n":1.50}}');
  assert.strictEqual(r.cases[2].line, '{"id":"A#3","op":"f","input":{"files":{}}}');
  const r2 = cases(files('op f', '  input t? string', 'req A "a"', '  example f', '    input t', '      x'));
  assert.strictEqual(r2.cases[0].line, '{"id":"A#1","op":"f","input":{"t":"x\\n"}}');
});

// REQ-SU-004
test('SU-004: checks', () => {
  const r = cases(files('op f', '  input x? json', 'req A "a"', '  example f {"x": {"y": [1, 2]}}', '    expect result.x.y.0 = 1',
    '    expect result.x.y.1 ~ 2.1 +- 0.25', '    expect result.x = ?', '    expect id = "A#1"', '  table f', '    | x | result.x ± 0.5 |', '    | 2 | 2.25           |'));
  assert.deepStrictEqual(r.cases[0].checks, [
    { kind: 'eq', path: 'result.x.y.0', value: 1 }, { kind: 'approx', path: 'result.x.y.1', tol: 0.25, value: 2.1 },
    { from: 'oracle', kind: 'eq', path: 'result.x', value: { y: [1, 2] } }, { kind: 'eq', path: 'id', value: 'A#1' },
  ]);
  assert.deepStrictEqual(r.cases[1].checks, [{ kind: 'approx', path: 'result.x', tol: 0.5, value: 2.25 }]);
});

// REQ-SU-005
test('SU-005: the oracle\'s whole answer', () => {
  const r = cases(files('op f', '  input answer? json', '  audit', '  tolerance result.t 0.5', '  tolerance result.u 0', 'op g',
    '  input answer? json', 'errors', '  e when never', 'req A "a"', '  example f {"answer": {"result": {"t": 1}, "audit": "A"}}',
    '  example f {"answer": {"error": "e", "extra": 1}}', '    expect error = "e"', '  example g {"answer": {"result": 2, "audit": "B"}}',
    '  example h {"answer": {"error": "e"}}', '    expect error = "e"'));
  assert.strictEqual(r.errors, 0);
  const tol = { 'result.t': 0.5, 'result.u': 0 };
  assert.deepStrictEqual(r.cases[0].full, { audit: 'A', members: ['audit', 'id', 'result'], result: { t: 1 }, tolerances: tol });
  assert.deepStrictEqual(r.cases[1].full, { error: 'e', members: ['error', 'extra', 'id'], tolerances: tol });
  assert.deepStrictEqual(r.cases[2].full, { members: ['audit', 'id', 'result'], result: 2, tolerances: {} });
  assert.deepStrictEqual(r.cases[3].full, { error: 'e', members: ['error', 'id'], tolerances: {} });
  const raw = cases(files('op f', '  input answer? json', '  audit', '  tolerance result.t 0.5', 'req A "a"',
    `  example raw '{"id":"r","op":"f","input":{"answer":{"result":{"t":1},"audit":"A"}}}'`));
  assert.deepStrictEqual(raw.cases[0].full, { members: ['audit', 'id', 'result'], result: { t: 1 }, tolerances: {} });
});

// REQ-JU-001
const FULL = { members: ['id', 'result'], result: { x: 1 }, tolerances: {} };
test('JU-001: verdicts', () => {
  const eq = (path: string, value: any) => ({ path, kind: 'eq', value });
  assert.deepStrictEqual(judge({ checks: [eq('result.x', 1)], full: FULL }, { id: 'A#1', result: { x: 1 } }).result, { pass: true });
  assert.deepStrictEqual(judge({ checks: [eq('result.x', 1)], full: FULL }, null).result, { pass: false, failed: ['answer'] });
  assert.deepStrictEqual(judge({
    checks: [eq('result.x', 1), eq('result.y', 2), eq('id', 'A#1')], full: { members: ['id', 'result'], result: { x: 1, y: 2 }, tolerances: {} },
  }, { id: 'A#1', result: { x: 5 }, note: 1 }).result, { pass: false, failed: ['checks.0', 'checks.1', 'members', 'result'] });
  assert.deepStrictEqual(judge({ id: 'A#1', kind: 'example', line: '{}', checks: [], full: null, more: 1 }, { id: 'anything', x: 1 }).result, { pass: true });
  assert.deepStrictEqual(request('judge', { case: { checks: [], full: null } }), { id: 'q', error: 'bad_request' });
  const bad: any[] = [
    [[], null], [{ checks: {}, full: null }, null], [{ checks: [{ path: 'result', kind: 'eq' }], full: null }, null],
    [{ checks: [{ path: 1, kind: 'eq', value: 1 }], full: null }, null],
    [{ checks: [{ path: 'result', kind: 'approx', value: '1', tol: 0 }], full: null }, null],
    [{ checks: [{ path: 'result', kind: 'approx', value: 1, tol: -1 }], full: null }, null],
    [{ checks: [{ path: 'result', kind: 'approx', value: 1 }], full: null }, null], [{ checks: [1], full: null }, null],
    [{ checks: [] }, null], [{ full: null }, null], [{ checks: [], full: [] }, null],
    [{ checks: [], full: { members: 'id', tolerances: {} } }, null], [{ checks: [], full: { members: [1], tolerances: {} } }, null],
    [{ checks: [], full: { members: ['id'] } }, null], [{ checks: [], full: { members: ['id'], tolerances: { result: '1' } } }, null],
    [{ checks: [], full: { members: ['id'], tolerances: { result: -1 } } }, null],
    [{ checks: [], full: { members: ['id', 'audit'], tolerances: {}, audit: 1 } }, null],
    [{ checks: [], full: null }, []], [{ checks: [], full: null }, 'x'],
  ];
  for (const [c, a] of bad) assert.deepStrictEqual(judge(c, a), { id: 'q', error: 'bad_request' }, JSON.stringify([c, a]));
});

// REQ-JU-002
test('JU-002: paths in an answer', () => {
  const eq = (path: string, value: any) => ({ path, kind: 'eq', value });
  const r = judge({
    checks: [eq('result.a.0', 5), eq('result.a.01', 6), eq('result.a.length', 2), eq('result.b.', 3), eq('result.c.0', 7), eq('result.d.length', 3),
      eq('audit.k.1', 2), eq('audit', '{"k": [1, 2]}'), eq('result.a.-1', 6)], full: null,
  }, { id: 'A#1', result: { a: [5, 6], b: { '': 3 }, c: { 0: 7 }, d: 'abc' }, audit: '{"k": [1, 2]}' });
  assert.deepStrictEqual(r.result, { failed: ['checks.1', 'checks.2', 'checks.5', 'checks.8'], pass: false });
  assert.deepStrictEqual(judge({ checks: [eq('audit.k', 1), eq('audit', '{"k": 1, "big": 1e400}')], full: null },
    { id: 'A#1', audit: '{"k": 1, "big": 1e400}' }).result, { failed: ['checks.0'], pass: false });
  assert.deepStrictEqual(judge({ checks: [eq('audit.k', 1), eq('result', null)], full: null }, { id: 'A#1', audit: 'k=1' }).result,
    { failed: ['checks.0', 'checks.1'], pass: false });
});

// REQ-JU-003
test('JU-003: checks', () => {
  const eq = (path: string, value: any) => ({ path, kind: 'eq', value });
  const ap = (path: string, value: number, tol: number) => ({ path, kind: 'approx', value, tol });
  const r = judge({
    checks: [eq('result.o', { a: 1, b: [1, 2] }), eq('result.z', 0), eq('result.t', 1), eq('result.n', true), eq('result.s', 1),
      eq('result.missing', null), eq('result.e', []), eq('result.l', {}), eq('result.p', [1, 2]), eq('result.w', { a: 1 }),
      ap('result.h', 2, 0.5), ap('result.i', 2, 0.5), ap('result.j', 2, 0.5), ap('result.k', 2, 0.5), ap('result.m', 1.9, 0.1), eq('result.u', null)],
    full: null,
  }, JSON.parse('{"id":"A#1","result":{"o":{"b":[1,2.0],"a":1.0},"z":-0,"t":true,"n":1,"s":"1","e":{},"l":[],"p":[2,1],"w":{"a":1,"b":2},' +
    '"h":2.5,"i":2.5000001,"j":"2","k":1.5,"m":2,"u":null}}'));
  assert.deepStrictEqual(r.result, {
    failed: ['checks.2', 'checks.3', 'checks.4', 'checks.5', 'checks.6', 'checks.7', 'checks.8', 'checks.9', 'checks.11', 'checks.12', 'checks.14'], pass: false,
  });
});

// REQ-JU-004
test('JU-004: the whole answer', () => {
  const j = (full: any, answer: any) => judge({ checks: [], full }, answer).result;
  assert.deepStrictEqual(j({ members: ['id', 'result'], result: 1, tolerances: {} }, { result: 1, id: 'A#1' }), { pass: true });
  assert.deepStrictEqual(j({ members: ['error', 'id'], error: 'e', tolerances: {} }, { id: 'x', error: 'f', result: 1 }),
    { failed: ['members', 'error'], pass: false });
  assert.deepStrictEqual(j({ members: ['error', 'id'], error: { code: 1, at: [1] }, tolerances: {} }, { id: 'x', error: { at: [1.0], code: 1 } }), { pass: true });
  assert.deepStrictEqual(j({ members: ['error', 'id'], error: null, tolerances: {} }, { id: 'x' }), { failed: ['members', 'error'], pass: false });
  assert.deepStrictEqual(j({ members: ['id', 'result'], result: 10, tolerances: { result: 1 } }, { id: 'A#1', result: 10.5 }), { pass: true });
  assert.deepStrictEqual(j({ members: ['audit', 'id', 'result'], result: 1, audit: 'A', tolerances: {} }, { id: 'A#1', result: 1, audit: 'A ' }),
    { failed: ['audit'], pass: false });
  assert.deepStrictEqual(j({ members: ['audit', 'id', 'result'], result: 1, audit: 'A', tolerances: {} }, { id: 'A#1', result: 1 }),
    { failed: ['members', 'audit'], pass: false });
  assert.deepStrictEqual(j({ members: ['id'], tolerances: {} }, { id: 'x', result: 1 }), { failed: ['members'], pass: false });
  const full = { members: ['id', 'result'], result: { t: 1, u: [1, 2] }, tolerances: { 'result.t': 0.5, 'result.u.1': 0.1 } };
  const rows: [any, any][] = [
    [{ id: 'A#1', result: { u: [1, 2.05], t: 1.5 } }, { pass: true }],
    [{ id: 'A#1', result: { u: [1.01, 2], t: 1 } }, { failed: ['result'], pass: false }],
    [{ id: 'A#1', result: { u: [1, 2], t: '1' } }, { failed: ['result'], pass: false }],
    [{ id: 'A#1', result: { u: [1, 2], t: 1, v: 0 } }, { failed: ['result'], pass: false }],
    [{ id: 'A#1', result: { u: [1, 2, 3], t: 1 } }, { failed: ['result'], pass: false }],
    [{ id: 'A#1' }, { failed: ['members', 'result'], pass: false }],
    [{ id: 'A#1', result: { u: [1, 2], t: 0.4 } }, { failed: ['result'], pass: false }],
  ];
  for (const [a, want] of rows) assert.deepStrictEqual(j(full, a), want, JSON.stringify(a));
});
