import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ECHO, call, cases } from './helper.ts';

const HE = 'duramen 0.1\nspec s 1\noracle node echo.mjs\n';
const rec = (text: string) => cases({ 's.duramen': text, 'echo.mjs': ECHO });

test('REQ-SU-001 no suite from a record with errors', () => {
  assert.deepEqual(cases({ 's.duramen': 'frobnicate\n' }), { cases: [], errors: 3 });
  assert.deepEqual(cases({ 's.duramen': 'duramen 0.1\nspec s 1\nreq A "a"\n  text\n    Nothing to show.\n' }), { cases: [], errors: 1 });
  const r = rec(HE + 'op f\n  input x? json\nreq A "a"\n  example f {"y": 1}\n');
  assert.equal(r.errors, 0);
  assert.equal(r.cases[0].id, 'A#1');
});

test('REQ-SU-002 one case per example', () => {
  const r = rec(
    HE + 'op f\n  input x? json\nreq A "a"\n  example f {"x": 1}\n    expect result.x = 1\nreq B "b"\n  on posix\n  table f\n    | x | result.x |\n    | 2 | 2        |\n    | 3 | ?        |\n',
  );
  assert.deepEqual(r, {
    cases: [
      { checks: [{ kind: 'eq', path: 'result.x', value: 1 }], full: { members: ['id', 'result'], result: { x: 1 }, tolerances: {} }, id: 'A#1', kind: 'example', line: '{"id":"A#1","op":"f","input":{"x": 1}}', platform: 'any', reqs: ['REQ-A'] },
      { checks: [{ kind: 'eq', path: 'result.x', value: 2 }], full: { members: ['id', 'result'], result: { x: 2 }, tolerances: {} }, id: 'B#1', kind: 'example', line: '{"id":"B#1","op":"f","input":{"x":2}}', platform: 'posix', reqs: ['REQ-B'] },
      { checks: [{ from: 'oracle', kind: 'eq', path: 'result.x', value: 3 }], full: { members: ['id', 'result'], result: { x: 3 }, tolerances: {} }, id: 'B#2', kind: 'example', line: '{"id":"B#2","op":"f","input":{"x":3}}', platform: 'posix', reqs: ['REQ-B'] },
    ],
    errors: 0,
  });
  const r2 = cases({
    'b.duramen': 'duramen 0.1\nreq B "b"\n  on windows\n  example f {}\n',
    'a.duramen': HE + 'op f\n  input x? json\nreq A "a"\n  example f {}\n  example f {}\n',
    'echo.mjs': ECHO,
  });
  assert.deepEqual(r2.cases.map((c: any) => c.id), ['A#1', 'A#2', 'B#1']);
  assert.equal(r2.cases[2].platform, 'windows');
});

test('REQ-SU-003 request lines', () => {
  const r = rec(
    'duramen 0.1\nspec s 1\n  request {"clock": "c", "trace": true}\noracle node echo.mjs\nop f\n  input x? json\nop g\n  input x? json\n  request {"mode": 2}\nreq A "a"\n  example f {"x" : 2.50e0 }\n  example f\n  example f {"x": 1}\n    request {"trace": false, "user": "u"}\n    omit clock\n  example g {"x": 1}\n    omit id, input\n  example f {"x": 1}\n    omit op, id\n  example raw \'{"id": "A#6",  "op": "f"}\'\n  example f {"x": 1}\n    request {"b": {"z": 1, "10": 2, "9": 3}, "2": "two", "a": 1}\n    omit clock\n    omit trace\n  table f\n    | result |\n    | ?      |\n',
  );
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
  assert.deepEqual(r.cases[3], {
    checks: [],
    full: { members: ['id', 'result'], result: {}, tolerances: {} },
    id: 'A#4',
    kind: 'example',
    line: '{"op":"g","mode":2}',
    platform: 'any',
    reqs: ['REQ-A'],
    solo: true,
  });
  assert.equal(r.cases[4].line, '{"clock":"c","trace":true,"input":{"x": 1}}');
  assert.equal(r.cases[4].solo, true);
  assert.equal(r.cases[5].line, '{"id": "A#6",  "op": "f"}');
  assert.equal(r.cases[5].solo, true);
  assert.equal(r.cases[6].line, '{"id":"A#7","op":"f","2":"two","b":{"9":3,"10":2,"z":1},"a":1,"input":{"x": 1}}');
  assert.equal(r.cases[7].line, '{"id":"A#8","op":"f","clock":"c","trace":true,"input":{}}');

  const r2 = rec(
    HE + 'op f\n  input files? object, n? number\nreq A "a"\n  example f {"n" : 1.50, "files": {"z": "old"}}\n    input files."a.duramen"\n      duramen 0.1\n      "quoted" é\n    input files.z\n      new\n  table f\n    | n      | files |\n    | 1.50   |       |\n    |        | {}    |\n',
  );
  assert.equal(r2.cases[0].line, '{"id":"A#1","op":"f","input":{"n":1.5,"files":{"z":"new\\n","a.duramen":"duramen 0.1\\n\\"quoted\\" é\\n"}}}');
  assert.equal(r2.cases[1].line, '{"id":"A#2","op":"f","input":{"n":1.50}}');
  assert.equal(r2.cases[2].line, '{"id":"A#3","op":"f","input":{"files":{}}}');
  const r3 = rec(HE + 'op f\n  input t? string\nreq A "a"\n  example f\n    input t\n      x\n');
  assert.equal(r3.cases[0].line, '{"id":"A#1","op":"f","input":{"t":"x\\n"}}');
});

test('REQ-SU-004 checks', () => {
  const r = rec(
    HE + 'op f\n  input x? json\nreq A "a"\n  example f {"x": {"y": [1, 2]}}\n    expect result.x.y.0 = 1\n    expect result.x.y.1 ~ 2.1 +- 0.25\n    expect result.x = ?\n    expect id = "A#1"\n  table f\n    | x | result.x ± 0.5 |\n    | 2 | 2.25           |\n',
  );
  assert.deepEqual(r.cases[0].checks, [
    { kind: 'eq', path: 'result.x.y.0', value: 1 },
    { kind: 'approx', path: 'result.x.y.1', tol: 0.25, value: 2.1 },
    { from: 'oracle', kind: 'eq', path: 'result.x', value: { y: [1, 2] } },
    { kind: 'eq', path: 'id', value: 'A#1' },
  ]);
  assert.deepEqual(r.cases[1].checks, [{ kind: 'approx', path: 'result.x', tol: 0.5, value: 2.25 }]);
});

test('REQ-SU-005 the whole answer', () => {
  const r = rec(
    HE +
      'op f\n  input answer? json\n  audit\n  tolerance result.t 0.5\n  tolerance result.u 0\nop g\n  input answer? json\nerrors\n  e when never\nreq A "a"\n  example f {"answer": {"result": {"t": 1}, "audit": "A"}}\n  example f {"answer": {"error": "e", "extra": 1}}\n    expect error = "e"\n  example g {"answer": {"result": 2, "audit": "B"}}\n  example h {"answer": {"error": "e"}}\n    expect error = "e"\n',
  );
  const tol = { 'result.t': 0.5, 'result.u': 0 };
  assert.deepEqual(r.cases[0].full, { audit: 'A', members: ['audit', 'id', 'result'], result: { t: 1 }, tolerances: tol });
  assert.deepEqual(r.cases[1].full, { error: 'e', members: ['error', 'extra', 'id'], tolerances: tol });
  assert.deepEqual(r.cases[2].full, { members: ['audit', 'id', 'result'], result: 2, tolerances: {} });
  assert.deepEqual(r.cases[3].full, { error: 'e', members: ['error', 'id'], tolerances: {} });
  const r2 = rec(HE + 'op f\n  input answer? json\n  audit\nreq A "a"\n  example f {"answer": {"result": 1, "audit": 5}}\n  example f {"answer": {"result": 1, "audit": null}}\n');
  assert.deepEqual(r2.cases[0].full, { members: ['audit', 'id', 'result'], result: 1, tolerances: {} });
  assert.deepEqual(r2.cases[1].full, { members: ['audit', 'id', 'result'], result: 1, tolerances: {} });
  const r3 = rec(
    HE + 'op f\n  input answer? json\n  audit\n  tolerance result.t 0.5\nreq A "a"\n  example raw \'{"id":"r","op":"f","input":{"answer":{"result":{"t":1},"audit":"A"}}}\'\n',
  );
  assert.deepEqual(r3.cases[0].full, { members: ['audit', 'id', 'result'], result: { t: 1 }, tolerances: {} });
});

test('REQ-OR-002 a lone surrogate is sent as U+FFFD', () => {
  const r = rec(HE + 'op f\n  input x? json\nreq A "a"\n  example raw "{\\"id\\":\\"r\\",\\"op\\":\\"f\\",\\"input\\":{\\"x\\":\\"\\ud800\\"}}"\n    expect result = ?\n');
  assert.deepEqual(r.cases[0].checks[0].value, { x: '�' });
});

const J = (c: unknown, a: unknown) => call('judge', { case: c, answer: a });

test('REQ-JU-001 verdicts', () => {
  const full = { members: ['id', 'result'], result: { x: 1 }, tolerances: {} };
  const chk = [{ path: 'result.x', kind: 'eq', value: 1 }];
  assert.deepEqual(J({ checks: chk, full }, { id: 'A#1', result: { x: 1 } }).result, { pass: true });
  assert.deepEqual(J({ checks: chk, full }, null).result, { pass: false, failed: ['answer'] });
  assert.deepEqual(
    J(
      { checks: [...chk, { path: 'result.y', kind: 'eq', value: 2 }, { path: 'id', kind: 'eq', value: 'A#1' }], full: { ...full, result: { x: 1, y: 2 } } },
      { id: 'A#1', result: { x: 5 }, note: 1 },
    ).result,
    { failed: ['checks.0', 'checks.1', 'members', 'result'], pass: false },
  );
  assert.deepEqual(J({ id: 'A#1', kind: 'example', line: '{}', checks: [], full: null, more: 1 }, { id: 'anything', x: 1 }).result, { pass: true });
  assert.equal(call('judge', { case: { checks: [], full: null } }).error, 'bad_request');
  assert.equal(call('judge').error, 'bad_request');
  const bad: [unknown, unknown][] = [
    [[], null],
    [{ checks: {}, full: null }, null],
    [{ checks: [{ path: 'result', kind: 'eq' }], full: null }, null],
    [{ checks: [{ path: 1, kind: 'eq', value: 1 }], full: null }, null],
    [{ checks: [{ path: 'result', kind: 'approx', value: '1', tol: 0 }], full: null }, null],
    [{ checks: [{ path: 'result', kind: 'approx', value: 1, tol: -1 }], full: null }, null],
    [{ checks: [{ path: 'result', kind: 'approx', value: 1 }], full: null }, null],
    [{ checks: [1], full: null }, null],
    [{ checks: [] }, null],
    [{ full: null }, null],
    [{ checks: [], full: [] }, null],
    [{ checks: [], full: { members: 'id', tolerances: {} } }, null],
    [{ checks: [], full: { members: [1], tolerances: {} } }, null],
    [{ checks: [], full: { members: ['id'] } }, null],
    [{ checks: [], full: { members: ['id'], tolerances: { result: '1' } } }, null],
    [{ checks: [], full: { members: ['id'], tolerances: { result: -1 } } }, null],
    [{ checks: [], full: { members: ['id', 'audit'], tolerances: {}, audit: 1 } }, null],
    [{ checks: [], full: null }, []],
    [{ checks: [], full: null }, 'x'],
  ];
  for (const [c, a] of bad) assert.equal(J(c, a).error, 'bad_request', JSON.stringify([c, a]));
});

test('REQ-JU-002 paths in an answer', () => {
  const ck = (path: string, value: unknown) => ({ path, kind: 'eq', value });
  const checks = [
    ck('result.a.0', 5), ck('result.a.01', 6), ck('result.a.length', 2), ck('result.b.', 3), ck('result.c.0', 7),
    ck('result.d.length', 3), ck('audit.k.1', 2), ck('audit', '{"k": [1, 2]}'), ck('result.a.-1', 6),
  ];
  assert.deepEqual(
    J({ checks, full: null }, { id: 'A#1', result: { a: [5, 6], b: { '': 3 }, c: { 0: 7 }, d: 'abc' }, audit: '{"k": [1, 2]}' }).result,
    { failed: ['checks.1', 'checks.2', 'checks.5', 'checks.8'], pass: false },
  );
  assert.deepEqual(
    J({ checks: [ck('audit.k', 1), ck('audit', '{"k": 1, "big": 1e400}')], full: null }, { id: 'A#1', audit: '{"k": 1, "big": 1e400}' }).result,
    { failed: ['checks.0'], pass: false },
  );
  assert.deepEqual(J({ checks: [ck('audit.k', 1), ck('result', null)], full: null }, { id: 'A#1', audit: 'k=1' }).result, {
    failed: ['checks.0', 'checks.1'],
    pass: false,
  });
});

test('REQ-JU-003 checks', () => {
  const ck = (path: string, value: unknown) => ({ path, kind: 'eq', value });
  const ap = (path: string, value: number, tol: number) => ({ path, kind: 'approx', value, tol });
  const checks = [
    ck('result.o', { a: 1, b: [1, 2] }), ck('result.z', 0), ck('result.t', 1), ck('result.n', true), ck('result.s', 1),
    ck('result.missing', null), ck('result.e', []), ck('result.l', {}), ck('result.p', [1, 2]), ck('result.w', { a: 1 }),
    ap('result.h', 2, 0.5), ap('result.i', 2, 0.5), ap('result.j', 2, 0.5), ap('result.k', 2, 0.5), ap('result.m', 1.9, 0.1),
    ck('result.u', null),
  ];
  const answer = '{"id":"A#1","result":{"o":{"b":[1,2.0],"a":1.0},"z":-0,"t":true,"n":1,"s":"1","e":{},"l":[],"p":[2,1],"w":{"a":1,"b":2},"h":2.5,"i":2.5000001,"j":"2","k":1.5,"m":2,"u":null}}';
  assert.deepEqual(J({ checks, full: null }, JSON.parse(answer)).result, {
    failed: ['checks.2', 'checks.3', 'checks.4', 'checks.5', 'checks.6', 'checks.7', 'checks.8', 'checks.9', 'checks.11', 'checks.12', 'checks.14'],
    pass: false,
  });
});

test('REQ-JU-004 the whole answer', () => {
  const f = (full: object, answer: object) => J({ checks: [], full }, answer).result;
  assert.deepEqual(f({ members: ['id', 'result'], result: 1, tolerances: {} }, { result: 1, id: 'A#1' }), { pass: true });
  assert.deepEqual(f({ members: ['error', 'id'], error: 'e', tolerances: {} }, { id: 'x', error: 'f', result: 1 }), { failed: ['members', 'error'], pass: false });
  assert.deepEqual(f({ members: ['error', 'id'], error: { code: 1, at: [1] }, tolerances: {} }, { id: 'x', error: { at: [1.0], code: 1 } }), { pass: true });
  assert.deepEqual(f({ members: ['error', 'id'], error: null, tolerances: {} }, { id: 'x' }), { failed: ['members', 'error'], pass: false });
  assert.deepEqual(f({ members: ['id', 'result'], result: 10, tolerances: { result: 1 } }, { id: 'A#1', result: 10.5 }), { pass: true });
  const au = { members: ['audit', 'id', 'result'], result: 1, audit: 'A', tolerances: {} };
  assert.deepEqual(f(au, { id: 'A#1', result: 1, audit: 'A ' }), { failed: ['audit'], pass: false });
  assert.deepEqual(f(au, { id: 'A#1', result: 1 }), { failed: ['members', 'audit'], pass: false });
  assert.deepEqual(f({ members: ['id'], tolerances: {} }, { id: 'x', result: 1 }), { failed: ['members'], pass: false });
  const tf = { members: ['id', 'result'], result: { t: 1, u: [1, 2] }, tolerances: { 'result.t': 0.5, 'result.u.1': 0.1 } };
  assert.deepEqual(f(tf, { id: 'A#1', result: { u: [1, 2.05], t: 1.5 } }), { pass: true });
  for (const r of [{ u: [1.01, 2], t: 1 }, { u: [1, 2], t: '1' }, { u: [1, 2], t: 1, v: 0 }, { u: [1, 2, 3], t: 1 }, { u: [1, 2], t: 0.4 }]) {
    assert.deepEqual(f(tf, { id: 'A#1', result: r }), { failed: ['result'], pass: false });
  }
  assert.deepEqual(f(tf, { id: 'A#1' }), { failed: ['members', 'result'], pass: false });
});

test('driver protocol over standard input and output', () => {
  const lines = [
    '{"id":"1","op":"check","input":{"files":{"a.duramen":"duramen 0.1\\nspec a 1\\n"}}}',
    '',
    '   \t',
    '{not json',
    '{"id":"2","op":"lint"}',
    '{"id":"3","op":"cases","input":{"files":{"a.duramen":"duramen 0.1\\nspec a 1\\n"}}}',
  ];
  const r = spawnSync('node', ['driver.ts'], { input: lines.join('\n'), encoding: 'utf8', cwd: new URL('..', import.meta.url) });
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.includes('\r'));
  const out = r.stdout.split('\n');
  assert.equal(out.pop(), '');
  assert.deepEqual(out.map((l) => JSON.parse(l)), [
    { id: '1', result: { diagnostics: [], errors: 0, warnings: 0 } },
    { id: null, error: 'bad_request' },
    { id: '2', error: 'unknown_op' },
    { id: '3', result: { errors: 0, cases: [] } },
  ]);
});
