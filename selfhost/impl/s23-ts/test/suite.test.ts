import { test } from 'node:test';
import assert from 'node:assert';
import { call, cases, ECHO, rec, withEcho } from './helpers.ts';

const H = 'duramen 0.1\nspec s 1\n';

test('REQ-SU-001 no suite from a record with errors', () => {
  assert.deepStrictEqual(call('cases', { files: { 's.duramen': 'frobnicate\n' } }).result, { cases: [], errors: 3 });
  assert.deepStrictEqual(call('cases', { files: { 's.duramen': H + 'req A "a"\n  text\n    Nothing to show.\n' } }).result, { cases: [], errors: 1 });
  const r = cases(rec('req A "a"\n  example f {"y": 1}\n', 'op f\n  input x? json\n'));
  assert.strictEqual(r.errors, 0);
  assert.strictEqual(r.cases[0].id, 'A#1');
});

test('REQ-SU-002 one case per example', () => {
  const r = cases(rec('req A "a"\n  example f {"x": 1}\n    expect result.x = 1\nreq B "b"\n  on posix\n  table f\n    | x | result.x |\n    | 2 | 2        |\n    | 3 | ?        |\n', 'op f\n  input x? json\n'));
  assert.deepStrictEqual(r, {
    errors: 0,
    cases: [
      { checks: [{ kind: 'eq', path: 'result.x', value: 1 }], full: { members: ['id', 'result'], result: { x: 1 }, tolerances: {} }, id: 'A#1', kind: 'example', line: '{"id":"A#1","op":"f","input":{"x": 1}}', platform: 'any', reqs: ['REQ-A'] },
      { checks: [{ kind: 'eq', path: 'result.x', value: 2 }], full: { members: ['id', 'result'], result: { x: 2 }, tolerances: {} }, id: 'B#1', kind: 'example', line: '{"id":"B#1","op":"f","input":{"x":2}}', platform: 'posix', reqs: ['REQ-B'] },
      { checks: [{ from: 'oracle', kind: 'eq', path: 'result.x', value: 3 }], full: { members: ['id', 'result'], result: { x: 3 }, tolerances: {} }, id: 'B#2', kind: 'example', line: '{"id":"B#2","op":"f","input":{"x":3}}', platform: 'posix', reqs: ['REQ-B'] },
    ],
  });
  const r2 = cases(
    withEcho({
      'b.duramen': 'duramen 0.1\nreq B "b"\n  on windows\n  example f {}\n',
      'a.duramen': H + 'oracle node echo.mjs\nop f\n  input x? json\nreq A "a"\n  example f {}\n  example f {}\n',
    }),
  );
  assert.deepStrictEqual(r2.cases.map((c: any) => c.id), ['A#1', 'A#2', 'B#1']);
  assert.strictEqual(r2.cases[2].platform, 'windows');
});

test('REQ-SU-003 request lines', () => {
  const body =
    'req A "a"\n  example f {"x" : 2.50e0 }\n  example f\n  example f {"x": 1}\n    request {"trace": false, "user": "u"}\n    omit clock\n  example g {"x": 1}\n    omit id, input\n  example f {"x": 1}\n    omit op, id\n  example raw \'{"id": "A#6",  "op": "f"}\'\n  example f {"x": 1}\n    request {"b": {"z": 1, "10": 2, "9": 3}, "2": "two", "a": 1}\n    omit clock\n    omit trace\n  table f\n    | result |\n    | ?      |\n';
  const files = withEcho({
    's.duramen': 'duramen 0.1\nspec s 1\n  request {"clock": "c", "trace": true}\noracle node echo.mjs\nop f\n  input x? json\nop g\n  input x? json\n  request {"mode": 2}\n' + body,
  });
  const c = cases(files).cases;
  assert.deepStrictEqual(c[0], {
    checks: [],
    full: { members: ['id', 'result'], result: { x: 2.5 }, tolerances: {} },
    id: 'A#1',
    kind: 'example',
    line: '{"id":"A#1","op":"f","clock":"c","trace":true,"input":{"x" : 2.50e0 }}',
    platform: 'any',
    reqs: ['REQ-A'],
  });
  assert.strictEqual(c[1].line, '{"id":"A#2","op":"f","clock":"c","trace":true}');
  assert.strictEqual(c[2].line, '{"id":"A#3","op":"f","trace":false,"user":"u","input":{"x": 1}}');
  assert.deepStrictEqual(c[3], {
    checks: [],
    full: { members: ['id', 'result'], result: {}, tolerances: {} },
    id: 'A#4',
    kind: 'example',
    line: '{"op":"g","mode":2}',
    platform: 'any',
    reqs: ['REQ-A'],
    solo: true,
  });
  assert.strictEqual(c[4].line, '{"clock":"c","trace":true,"input":{"x": 1}}');
  assert.strictEqual(c[4].solo, true);
  assert.strictEqual(c[5].line, '{"id": "A#6",  "op": "f"}');
  assert.strictEqual(c[5].solo, true);
  assert.strictEqual(c[6].line, '{"id":"A#7","op":"f","2":"two","b":{"9":3,"10":2,"z":1},"a":1,"input":{"x": 1}}');
  assert.strictEqual(c[7].line, '{"id":"A#8","op":"f","clock":"c","trace":true,"input":{}}');

  const c2 = cases(
    rec('req A "a"\n  example f {"n" : 1.50, "files": {"z": "old"}}\n    input files."a.duramen"\n      duramen 0.1\n      "quoted" é\n    input files.z\n      new\n  table f\n    | n      | files |\n    | 1.50   |       |\n    |        | {}    |\n', 'op f\n  input files? object, n? number\n'),
  ).cases;
  assert.strictEqual(c2[0].line, '{"id":"A#1","op":"f","input":{"n":1.5,"files":{"z":"new\\n","a.duramen":"duramen 0.1\\n\\"quoted\\" é\\n"}}}');
  assert.strictEqual(c2[1].line, '{"id":"A#2","op":"f","input":{"n":1.50}}');
  assert.strictEqual(c2[2].line, '{"id":"A#3","op":"f","input":{"files":{}}}');
  const c3 = cases(rec('req A "a"\n  example f\n    input t\n      x\n', 'op f\n  input t? string\n')).cases;
  assert.strictEqual(c3[0].line, '{"id":"A#1","op":"f","input":{"t":"x\\n"}}');
});

test('REQ-SU-004 checks', () => {
  const c = cases(rec('req A "a"\n  example f {"x": {"y": [1, 2]}}\n    expect result.x.y.0 = 1\n    expect result.x.y.1 ~ 2.1 +- 0.25\n    expect result.x = ?\n    expect id = "A#1"\n  table f\n    | x | result.x ± 0.5 |\n    | 2 | 2.25           |\n', 'op f\n  input x? json\n')).cases;
  assert.deepStrictEqual(c[0].checks, [
    { kind: 'eq', path: 'result.x.y.0', value: 1 },
    { kind: 'approx', path: 'result.x.y.1', tol: 0.25, value: 2.1 },
    { from: 'oracle', kind: 'eq', path: 'result.x', value: { y: [1, 2] } },
    { kind: 'eq', path: 'id', value: 'A#1' },
  ]);
  assert.deepStrictEqual(c[1].checks, [{ kind: 'approx', path: 'result.x', tol: 0.5, value: 2.25 }]);
});

test('REQ-SU-005 the oracle\'s whole answer', () => {
  const head = 'op f\n  input answer? json\n  audit\n  tolerance result.t 0.5\n  tolerance result.u 0\nop g\n  input answer? json\nerrors\n  e when never\n';
  const c = cases(rec('req A "a"\n  example f {"answer": {"result": {"t": 1}, "audit": "A"}}\n  example f {"answer": {"error": "e", "extra": 1}}\n    expect error = "e"\n  example g {"answer": {"result": 2, "audit": "B"}}\n  example h {"answer": {"error": "e"}}\n    expect error = "e"\n', head)).cases;
  const tol = { 'result.t': 0.5, 'result.u': 0 };
  assert.deepStrictEqual(c[0].full, { audit: 'A', members: ['audit', 'id', 'result'], result: { t: 1 }, tolerances: tol });
  assert.deepStrictEqual(c[1].full, { error: 'e', members: ['error', 'extra', 'id'], tolerances: tol });
  assert.deepStrictEqual(c[2].full, { members: ['audit', 'id', 'result'], result: 2, tolerances: {} });
  assert.deepStrictEqual(c[3].full, { error: 'e', members: ['error', 'id'], tolerances: {} });
  const c2 = cases(rec('req A "a"\n  example f {"answer": {"result": 1, "audit": 5}}\n  example f {"answer": {"result": 1, "audit": null}}\n', 'op f\n  input answer? json\n  audit\n')).cases;
  assert.deepStrictEqual(c2[0].full, { members: ['audit', 'id', 'result'], result: 1, tolerances: {} });
  assert.deepStrictEqual(c2[1].full, { members: ['audit', 'id', 'result'], result: 1, tolerances: {} });
  const c3 = cases(rec('req A "a"\n  example f {"x": 1}\n', 'op f\n  input x? json\n  tolerance __proto__ 1\n  tolerance result.constructor 2\n')).cases;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c3[0].full.tolerances)), JSON.parse('{"__proto__":1,"result.constructor":2}'));
  assert.ok(JSON.stringify(c3[0].full.tolerances).includes('"__proto__":1'));
  const c4 = cases(rec('req A "a"\n  example raw \'{"id":"r","op":"f","input":{"answer":{"result":{"t":1},"audit":"A"}}}\'\n', 'op f\n  input answer? json\n  audit\n  tolerance result.t 0.5\n')).cases;
  assert.deepStrictEqual(c4[0].full, { members: ['audit', 'id', 'result'], result: { t: 1 }, tolerances: {} });
  void ECHO;
});

// ------------------------------------------------------------------- judge

const J = (c: unknown, answer: unknown) => call('judge', { case: c, answer });
const eqChk = (path: string, value: unknown) => ({ path, kind: 'eq', value });

test('REQ-JU-001 verdicts', () => {
  const full = { members: ['id', 'result'], result: { x: 1 }, tolerances: {} };
  assert.deepStrictEqual(J({ checks: [eqChk('result.x', 1)], full }, { id: 'A#1', result: { x: 1 } }).result, { pass: true });
  assert.deepStrictEqual(J({ checks: [eqChk('result.x', 1)], full }, null).result, { pass: false, failed: ['answer'] });
  assert.deepStrictEqual(
    J({ checks: [eqChk('result.x', 1), eqChk('result.y', 2), eqChk('id', 'A#1')], full: { ...full, result: { x: 1, y: 2 } } }, { id: 'A#1', result: { x: 5 }, note: 1 }).result,
    { pass: false, failed: ['checks.0', 'checks.1', 'members', 'result'] },
  );
  assert.deepStrictEqual(J({ id: 'A#1', kind: 'example', line: '{}', checks: [], full: null, more: 1 }, { id: 'anything', x: 1 }).result, { pass: true });
  assert.strictEqual(call('judge', { case: { checks: [], full: null } }).error, 'bad_request');
  assert.strictEqual(call('judge').error, 'bad_request');
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
  for (const [c, a] of bad) assert.strictEqual(J(c, a).error, 'bad_request', JSON.stringify([c, a]));
});

test('REQ-JU-002 paths in an answer', () => {
  const answer = { id: 'A#1', result: { a: [5, 6], b: { '': 3 }, c: { 0: 7 }, d: 'abc' }, audit: '{"k": [1, 2]}' };
  const checks = [
    eqChk('result.a.0', 5),
    eqChk('result.a.01', 6),
    eqChk('result.a.length', 2),
    eqChk('result.b.', 3),
    eqChk('result.c.0', 7),
    eqChk('result.d.length', 3),
    eqChk('audit.k.1', 2),
    eqChk('audit', '{"k": [1, 2]}'),
    eqChk('result.a.-1', 6),
  ];
  assert.deepStrictEqual(J({ checks, full: null }, answer).result, { failed: ['checks.1', 'checks.2', 'checks.5', 'checks.8'], pass: false });
  assert.deepStrictEqual(
    J({ checks: [eqChk('audit.k', 1), eqChk('audit', '{"k": 1, "big": 1e400}')], full: null }, { id: 'A#1', audit: '{"k": 1, "big": 1e400}' }).result,
    { failed: ['checks.0'], pass: false },
  );
  assert.deepStrictEqual(J({ checks: [eqChk('audit.k', 1), eqChk('result', null)], full: null }, { id: 'A#1', audit: 'k=1' }).result, {
    failed: ['checks.0', 'checks.1'],
    pass: false,
  });
});

test('REQ-JU-003 checks', () => {
  const ap = (path: string, value: number, tol: number) => ({ path, kind: 'approx', value, tol });
  const checks = [
    eqChk('result.o', { a: 1, b: [1, 2] }),
    eqChk('result.z', 0),
    eqChk('result.t', 1),
    eqChk('result.n', true),
    eqChk('result.s', 1),
    eqChk('result.missing', null),
    eqChk('result.e', []),
    eqChk('result.l', {}),
    eqChk('result.p', [1, 2]),
    eqChk('result.w', { a: 1 }),
    ap('result.h', 2, 0.5),
    ap('result.i', 2, 0.5),
    ap('result.j', 2, 0.5),
    ap('result.k', 2, 0.5),
    ap('result.m', 1.9, 0.1),
    eqChk('result.u', null),
  ];
  const line = JSON.stringify({ case: { checks, full: null }, answer: null }).replace('"answer":null', '"answer":{"id":"A#1","result":{"o":{"b":[1,2.0],"a":1.0},"z":-0,"t":true,"n":1,"s":"1","e":{},"l":[],"p":[2,1],"w":{"a":1,"b":2},"h":2.5,"i":2.5000001,"j":"2","k":1.5,"m":2,"u":null}}');
  const r = JSON.parse(JSON.stringify(call('judge', JSON.parse(line))));
  assert.deepStrictEqual(r.result, { failed: ['checks.2', 'checks.3', 'checks.4', 'checks.5', 'checks.6', 'checks.7', 'checks.8', 'checks.9', 'checks.11', 'checks.12', 'checks.14'], pass: false });
});

test('REQ-JU-004 the whole answer', () => {
  const f = (o: object) => ({ checks: [], full: { tolerances: {}, ...o } });
  assert.deepStrictEqual(J(f({ members: ['id', 'result'], result: 1 }), { result: 1, id: 'A#1' }).result, { pass: true });
  assert.deepStrictEqual(J(f({ members: ['error', 'id'], error: 'e' }), { id: 'x', error: 'f', result: 1 }).result, { failed: ['members', 'error'], pass: false });
  assert.deepStrictEqual(J(f({ members: ['error', 'id'], error: { code: 1, at: [1] } }), { id: 'x', error: { at: [1.0], code: 1 } }).result, { pass: true });
  assert.deepStrictEqual(J(f({ members: ['error', 'id'], error: null }), { id: 'x' }).result, { failed: ['members', 'error'], pass: false });
  assert.deepStrictEqual(J(f({ members: ['id', 'result'], result: 10, tolerances: { result: 1 } }), { id: 'A#1', result: 10.5 }).result, { pass: true });
  const au = f({ members: ['audit', 'id', 'result'], result: 1, audit: 'A' });
  assert.deepStrictEqual(J(au, { id: 'A#1', result: 1, audit: 'A ' }).result, { failed: ['audit'], pass: false });
  assert.deepStrictEqual(J(au, { id: 'A#1', result: 1 }).result, { failed: ['members', 'audit'], pass: false });
  assert.deepStrictEqual(J(f({ members: ['id'] }), { id: 'x', result: 1 }).result, { failed: ['members'], pass: false });
  const t = f({ members: ['id', 'result'], result: { t: 1, u: [1, 2] }, tolerances: { 'result.t': 0.5, 'result.u.1': 0.1 } });
  const rows: [unknown, unknown][] = [
    [{ id: 'A#1', result: { u: [1, 2.05], t: 1.5 } }, { pass: true }],
    [{ id: 'A#1', result: { u: [1.01, 2], t: 1 } }, { pass: false, failed: ['result'] }],
    [{ id: 'A#1', result: { u: [1, 2], t: '1' } }, { pass: false, failed: ['result'] }],
    [{ id: 'A#1', result: { u: [1, 2], t: 1, v: 0 } }, { pass: false, failed: ['result'] }],
    [{ id: 'A#1', result: { u: [1, 2, 3], t: 1 } }, { pass: false, failed: ['result'] }],
    [{ id: 'A#1' }, { pass: false, failed: ['members', 'result'] }],
    [{ id: 'A#1', result: { u: [1, 2], t: 0.4 } }, { pass: false, failed: ['result'] }],
  ];
  for (const [a, want] of rows) assert.deepStrictEqual(J(t, a).result, want, JSON.stringify(a));
});
