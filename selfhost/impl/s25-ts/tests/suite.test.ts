import assert from 'node:assert';
import { test } from 'node:test';
import { call, cases, ECHO, t } from './helpers.ts';

const H = ['duramen 0.1', 'spec s 1'];
const hs = (...lines: string[]) => t(...H, ...lines);
const rec = (s: string, extra: Record<string, string> = {}) => ({ 's.duramen': s, 'echo.mjs': ECHO, ...extra });
const O = ['oracle node echo.mjs'];

test('REQ-SU-001: no suite from a record with errors', async () => {
  assert.deepStrictEqual(await cases({ 's.duramen': 'frobnicate\n' }), { cases: [], errors: 3 });
  assert.deepStrictEqual(await cases({ 's.duramen': hs('req A "a"', '  text', '    Nothing to show.') }), { cases: [], errors: 1 });
  const r = await cases(rec(hs(...O, 'op f', '  input x? json', 'req A "a"', '  example f {"y": 1}')));
  assert.strictEqual(r.errors, 0);
  assert.strictEqual(r.cases[0].id, 'A#1');
});

test('REQ-SU-002: one case per example', async () => {
  const r = await cases(
    rec(hs(...O, 'op f', '  input x? json', 'req A "a"', '  example f {"x": 1}', '    expect result.x = 1', 'req B "b"', '  on posix',
      '  table f', '    | x | result.x |', '    | 2 | 2        |', '    | 3 | ?        |')),
  );
  assert.deepStrictEqual(r, {
    cases: [
      { checks: [{ kind: 'eq', path: 'result.x', value: 1 }], full: { members: ['id', 'result'], result: { x: 1 }, tolerances: {} },
        id: 'A#1', kind: 'example', line: '{"id":"A#1","op":"f","input":{"x": 1}}', platform: 'any', reqs: ['REQ-A'] },
      { checks: [{ kind: 'eq', path: 'result.x', value: 2 }], full: { members: ['id', 'result'], result: { x: 2 }, tolerances: {} },
        id: 'B#1', kind: 'example', line: '{"id":"B#1","op":"f","input":{"x":2}}', platform: 'posix', reqs: ['REQ-B'] },
      { checks: [{ from: 'oracle', kind: 'eq', path: 'result.x', value: 3 }], full: { members: ['id', 'result'], result: { x: 3 }, tolerances: {} },
        id: 'B#2', kind: 'example', line: '{"id":"B#2","op":"f","input":{"x":3}}', platform: 'posix', reqs: ['REQ-B'] },
    ],
    errors: 0,
  });
  const r2 = await cases({
    'b.duramen': t('duramen 0.1', 'req B "b"', '  on windows', '  example f {}'),
    'a.duramen': t('duramen 0.1', 'spec s 1', ...O, 'op f', '  input x? json', 'req A "a"', '  example f {}', '  example f {}'),
    'echo.mjs': ECHO,
  });
  assert.deepStrictEqual(r2.cases.map((c: any) => c.id), ['A#1', 'A#2', 'B#1']);
  assert.strictEqual(r2.cases[2].platform, 'windows');
});

test('REQ-SU-003: request lines', async () => {
  const r = await cases(
    rec(hs('  request {"clock": "c", "trace": true}', ...O, 'op f', '  input x? json', 'op g', '  input x? json', '  request {"mode": 2}',
      'req A "a"', '  example f {"x" : 2.50e0 }', '  example f', '  example f {"x": 1}', '    request {"trace": false, "user": "u"}',
      '    omit clock', '  example g {"x": 1}', '    omit id, input', '  example f {"x": 1}', '    omit op, id',
      '  example raw \'{"id": "A#6",  "op": "f"}\'', '  example f {"x": 1}',
      '    request {"b": {"z": 1, "10": 2, "9": 3}, "2": "two", "a": 1}', '    omit clock', '    omit trace', '  table f',
      '    | result |', '    | ?      |')),
  );
  assert.deepStrictEqual(r.cases[0], {
    checks: [], full: { members: ['id', 'result'], result: { x: 2.5 }, tolerances: {} }, id: 'A#1', kind: 'example',
    line: '{"id":"A#1","op":"f","clock":"c","trace":true,"input":{"x" : 2.50e0 }}', platform: 'any', reqs: ['REQ-A'],
  });
  assert.strictEqual(r.cases[1].line, '{"id":"A#2","op":"f","clock":"c","trace":true}');
  assert.strictEqual(r.cases[2].line, '{"id":"A#3","op":"f","trace":false,"user":"u","input":{"x": 1}}');
  assert.deepStrictEqual(r.cases[3], {
    checks: [], full: { members: ['id', 'result'], result: {}, tolerances: {} }, id: 'A#4', kind: 'example', line: '{"op":"g","mode":2}',
    platform: 'any', reqs: ['REQ-A'], solo: true,
  });
  assert.strictEqual(r.cases[4].line, '{"clock":"c","trace":true,"input":{"x": 1}}');
  assert.strictEqual(r.cases[4].solo, true);
  assert.strictEqual(r.cases[5].line, '{"id": "A#6",  "op": "f"}');
  assert.strictEqual(r.cases[5].solo, true);
  assert.strictEqual(r.cases[6].line, '{"id":"A#7","op":"f","2":"two","b":{"9":3,"10":2,"z":1},"a":1,"input":{"x": 1}}');
  assert.strictEqual(r.cases[7].line, '{"id":"A#8","op":"f","clock":"c","trace":true,"input":{}}');

  const r2 = await cases(
    rec(hs(...O, 'op f', '  input files? object, n? number', 'req A "a"', '  example f {"n" : 1.50, "files": {"z": "old"}}',
      '    input files."a.duramen"', '      duramen 0.1', '      "quoted" é', '    input files.z', '      new', '  table f',
      '    | n      | files |', '    | 1.50   |       |', '    |        | {}    |')),
  );
  assert.strictEqual(
    r2.cases[0].line,
    '{"id":"A#1","op":"f","input":{"n":1.5,"files":{"z":"new\\n","a.duramen":"duramen 0.1\\n\\"quoted\\" é\\n"}}}');
  assert.strictEqual(r2.cases[1].line, '{"id":"A#2","op":"f","input":{"n":1.50}}');
  assert.strictEqual(r2.cases[2].line, '{"id":"A#3","op":"f","input":{"files":{}}}');
  const r3 = await cases(rec(hs(...O, 'op f', '  input t? string', 'req A "a"', '  example f', '    input t', '      x')));
  assert.strictEqual(r3.cases[0].line, '{"id":"A#1","op":"f","input":{"t":"x\\n"}}');
});

test('REQ-SU-004: checks', async () => {
  const r = await cases(
    rec(hs(...O, 'op f', '  input x? json', 'req A "a"', '  example f {"x": {"y": [1, 2]}}', '    expect result.x.y.0 = 1',
      '    expect result.x.y.1 ~ 2.1 +- 0.25', '    expect result.x = ?', '    expect id = "A#1"', '  table f', '    | x | result.x ± 0.5 |',
      '    | 2 | 2.25           |')),
  );
  assert.deepStrictEqual(r.cases[0].checks, [
    { kind: 'eq', path: 'result.x.y.0', value: 1 },
    { kind: 'approx', path: 'result.x.y.1', tol: 0.25, value: 2.1 },
    { from: 'oracle', kind: 'eq', path: 'result.x', value: { y: [1, 2] } },
    { kind: 'eq', path: 'id', value: 'A#1' },
  ]);
  assert.deepStrictEqual(r.cases[1].checks, [{ kind: 'approx', path: 'result.x', tol: 0.5, value: 2.25 }]);
});

test('REQ-SU-005: the oracle’s whole answer', async () => {
  const r = await cases(
    rec(hs(...O, 'op f', '  input answer? json', '  audit', '  tolerance result.t 0.5', '  tolerance result.u 0', 'op g',
      '  input answer? json', 'errors', '  e when never', 'req A "a"', '  example f {"answer": {"result": {"t": 1}, "audit": "A"}}',
      '  example f {"answer": {"error": "e", "extra": 1}}', '    expect error = "e"', '  example g {"answer": {"result": 2, "audit": "B"}}',
      '  example h {"answer": {"error": "e"}}', '    expect error = "e"')),
  );
  const tol = { 'result.t': 0.5, 'result.u': 0 };
  assert.deepStrictEqual(r.cases[0].full, { audit: 'A', members: ['audit', 'id', 'result'], result: { t: 1 }, tolerances: tol });
  assert.deepStrictEqual(r.cases[1].full, { error: 'e', members: ['error', 'extra', 'id'], tolerances: tol });
  assert.deepStrictEqual(r.cases[2].full, { members: ['audit', 'id', 'result'], result: 2, tolerances: {} });
  assert.deepStrictEqual(r.cases[3].full, { error: 'e', members: ['error', 'id'], tolerances: {} });
  const r2 = await cases(
    rec(hs(...O, 'op f', '  input answer? json', '  audit', 'req A "a"', '  example f {"answer": {"result": 1, "audit": 5}}',
      '  example f {"answer": {"result": 1, "audit": null}}')),
  );
  for (const c of r2.cases) assert.deepStrictEqual(c.full, { members: ['audit', 'id', 'result'], result: 1, tolerances: {} });
  const r3 = await cases(
    rec(hs(...O, 'op f', '  input x? json', '  tolerance __proto__ 1', '  tolerance result.constructor 2', 'req A "a"', '  example f {"x": 1}')),
  );
  const raw = await call('cases', { files: rec(hs(...O, 'op f', '  input x? json', '  tolerance __proto__ 1', 'req A "a"', '  example f {"x": 1}')) });
  assert.ok(JSON.stringify(raw).includes('"tolerances":{"__proto__":1}'));
  assert.deepStrictEqual(Object.keys(r3.cases[0].full.tolerances), ['__proto__', 'result.constructor']);
  const r4 = await cases(
    rec(hs(...O, 'op f', '  input answer? json', '  audit', '  tolerance result.t 0.5', 'req A "a"',
      '  example raw \'{"id":"r","op":"f","input":{"answer":{"result":{"t":1},"audit":"A"}}}\'')),
  );
  assert.deepStrictEqual(r4.cases[0].full, { members: ['audit', 'id', 'result'], result: { t: 1 }, tolerances: {} });
});
