import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { handle } from '../driver.ts';

const ECHO = readFileSync(new URL('../fixtures/echo.mjs', import.meta.url), 'utf8');
const OK = 'duramen 0.1\nspec a 1\n';
const H = 'duramen 0.1\nspec s 1\n';

function call(op: string, input: unknown) {
  return handle(JSON.stringify({ id: 'q', op, input }));
}

// REQ-RQ-002
test('RQ-002 bad lines get null id', () => {
  assert.deepStrictEqual(handle('{not json'), { id: null, error: 'bad_request' });
  assert.deepStrictEqual(handle('[1, 2]'), { id: null, error: 'bad_request' });
  assert.deepStrictEqual(handle(JSON.stringify({ op: 'check', input: { files: { 'a.duramen': OK } } })), { id: null, error: 'bad_request' });
  assert.deepStrictEqual(handle(JSON.stringify({ id: 7, op: 'check', input: { files: { 'a.duramen': OK } } })), { id: null, error: 'bad_request' });
});
test('RQ-002 unknown_op', () => {
  assert.deepStrictEqual(call('lint', { files: { 'a.duramen': 'x' } }), { id: 'q', error: 'unknown_op' });
  assert.deepStrictEqual(handle('{"id":"q","op":"lint"}'), { id: 'q', error: 'unknown_op' });
});
test('RQ-002 bad_request', () => {
  const bad = (input: unknown) => assert.deepStrictEqual(call('check', input), { id: 'q', error: 'bad_request' }, JSON.stringify(input));
  assert.deepStrictEqual(handle('{"id":"q","op":"check"}'), { id: 'q', error: 'bad_request' });
  bad({});
  bad({ files: {} });
  bad({ files: ['a.duramen'] });
  bad({ files: { 'a.duramen': 1 } });
  for (const n of ['../a.duramen', '/a.duramen', 'x/./a.duramen', 'x//a.duramen', 'c:a.duramen', 'a\\b.duramen', 'a\0b'])
    bad({ files: { [n]: OK } });
  bad({ files: { a: 'x', 'a/b.duramen': OK } });
  bad({ files: { 'a.duramen': OK }, entry: '../a.duramen' });
  bad({ files: { 'a.duramen': OK }, entry: 1 });
  bad({ files: { 'a.duramen': OK }, entry: '' });
  assert.deepStrictEqual(call('cases', { files: { 'a\\b.duramen': OK } }), { id: 'q', error: 'bad_request' });
  assert.deepStrictEqual(handle('{"id":"q","op":"check","input":5}'), { id: 'q', error: 'bad_request' });
});
test('RQ-002 entry "." is fine', () => {
  assert.deepStrictEqual(call('check', { files: { 'a.duramen': OK }, entry: '.' }),
    { id: 'q', result: { diagnostics: [], errors: 0, warnings: 0 } });
});

test('driver process: order, blank lines, LF only', () => {
  const lines = [
    JSON.stringify({ id: '1', op: 'check', input: { files: { 'a.duramen': OK } } }),
    '  \t ',
    '{bad',
    '',
    JSON.stringify({ id: '2', op: 'lint', input: {} }),
  ].join('\n') + '\n';
  const r = spawnSync(process.execPath, ['driver.ts'], { cwd: new URL('..', import.meta.url), input: lines, encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout,
    '{"id":"1","result":{"diagnostics":[],"errors":0,"warnings":0}}\n{"id":null,"error":"bad_request"}\n{"id":"2","error":"unknown_op"}\n');
});
test('driver process: last line without LF', () => {
  const r = spawnSync(process.execPath, ['driver.ts'], {
    cwd: new URL('..', import.meta.url), input: '{"id":"z","op":"nope"}', encoding: 'utf8' });
  assert.strictEqual(r.stdout, '{"id":"z","error":"unknown_op"}\n');
});

// REQ-SU
const echoFiles = (body: string, extra: Record<string, string> = {}) => ({ 's.duramen': body, 'echo.mjs': ECHO, ...extra });
type R = { errors: number; cases: Record<string, unknown>[] };
const cases = (files: Record<string, string>, entry?: string) =>
  (call('cases', entry ? { files, entry } : { files }) as { result: R }).result;

test('SU-001 no suite from errors', () => {
  assert.deepStrictEqual(cases({ 's.duramen': 'frobnicate\n' }), { cases: [], errors: 3 });
  assert.deepStrictEqual(cases({ 's.duramen': H + 'req A "a"\n  text\n    Nothing to show.\n' }), { cases: [], errors: 1 });
  const r = cases(echoFiles(H + 'oracle node echo.mjs\nop f\n  input x? json\nreq A "a"\n  example f {"y": 1}\n'));
  assert.strictEqual(r.errors, 0);
  assert.strictEqual(r.cases[0].id, 'A#1');
});
test('SU-002 one case per example', () => {
  const r = cases(echoFiles(H + 'oracle node echo.mjs\nop f\n  input x? json\nreq A "a"\n  example f {"x": 1}\n    expect result.x = 1\nreq B "b"\n  on posix\n  table f\n    | x | result.x |\n    | 2 | 2        |\n    | 3 | ?        |\n'));
  assert.deepStrictEqual(r, {
    cases: [
      { checks: [{ kind: 'eq', path: 'result.x', value: 1 }], full: { members: ['id', 'result'], result: { x: 1 }, tolerances: {} }, id: 'A#1', kind: 'example', line: '{"id":"A#1","op":"f","input":{"x": 1}}', platform: 'any', reqs: ['REQ-A'] },
      { checks: [{ kind: 'eq', path: 'result.x', value: 2 }], full: { members: ['id', 'result'], result: { x: 2 }, tolerances: {} }, id: 'B#1', kind: 'example', line: '{"id":"B#1","op":"f","input":{"x":2}}', platform: 'posix', reqs: ['REQ-B'] },
      { checks: [{ from: 'oracle', kind: 'eq', path: 'result.x', value: 3 }], full: { members: ['id', 'result'], result: { x: 3 }, tolerances: {} }, id: 'B#2', kind: 'example', line: '{"id":"B#2","op":"f","input":{"x":3}}', platform: 'posix', reqs: ['REQ-B'] },
    ],
    errors: 0,
  });
});
test('SU-002 file order and platform', () => {
  const r = cases({ 'b.duramen': 'duramen 0.1\nreq B "b"\n  on windows\n  example f {}\n', 'a.duramen': H + 'oracle node echo.mjs\nop f\n  input x? json\nreq A "a"\n  example f {}\n  example f {}\n', 'echo.mjs': ECHO });
  assert.deepStrictEqual(r.cases.map((c) => c.id), ['A#1', 'A#2', 'B#1']);
  assert.strictEqual(r.cases[2].platform, 'windows');
});
test('SU-003 request lines', () => {
  const r = cases(echoFiles('duramen 0.1\nspec s 1\n  request {"clock": "c", "trace": true}\noracle node echo.mjs\nop f\n  input x? json\nop g\n  input x? json\n  request {"mode": 2}\nreq A "a"\n  example f {"x" : 2.50e0 }\n  example f\n  example f {"x": 1}\n    request {"trace": false, "user": "u"}\n    omit clock\n  example g {"x": 1}\n    omit id, input\n  example f {"x": 1}\n    omit op, id\n  example raw \'{"id": "A#6",  "op": "f"}\'\n  example f {"x": 1}\n    request {"b": {"z": 1, "10": 2, "9": 3}, "2": "two", "a": 1}\n    omit clock\n    omit trace\n  table f\n    | result |\n    | ?      |\n'));
  assert.deepStrictEqual(r.cases[0], { checks: [], full: { members: ['id', 'result'], result: { x: 2.5 }, tolerances: {} }, id: 'A#1', kind: 'example', line: '{"id":"A#1","op":"f","clock":"c","trace":true,"input":{"x" : 2.50e0 }}', platform: 'any', reqs: ['REQ-A'] });
  assert.strictEqual(r.cases[1].line, '{"id":"A#2","op":"f","clock":"c","trace":true}');
  assert.strictEqual(r.cases[2].line, '{"id":"A#3","op":"f","trace":false,"user":"u","input":{"x": 1}}');
  assert.deepStrictEqual(r.cases[3], { checks: [], full: { members: ['id', 'result'], result: {}, tolerances: {} }, id: 'A#4', kind: 'example', line: '{"op":"g","mode":2}', platform: 'any', reqs: ['REQ-A'], solo: true });
  assert.strictEqual(r.cases[4].line, '{"clock":"c","trace":true,"input":{"x": 1}}');
  assert.strictEqual(r.cases[4].solo, true);
  assert.strictEqual(r.cases[5].line, '{"id": "A#6",  "op": "f"}');
  assert.strictEqual(r.cases[5].solo, true);
  assert.strictEqual(r.cases[6].line, '{"id":"A#7","op":"f","2":"two","b":{"9":3,"10":2,"z":1},"a":1,"input":{"x": 1}}');
  assert.strictEqual(r.cases[7].line, '{"id":"A#8","op":"f","clock":"c","trace":true,"input":{}}');
});
test('SU-003 input lines', () => {
  const r = cases(echoFiles(H + 'oracle node echo.mjs\nop f\n  input files? object, n? number\nreq A "a"\n  example f {"n" : 1.50, "files": {"z": "old"}}\n    input files."a.duramen"\n      duramen 0.1\n      "quoted" é\n    input files.z\n      new\n  table f\n    | n      | files |\n    | 1.50   |       |\n    |        | {}    |\n'));
  assert.strictEqual(r.cases[0].line, '{"id":"A#1","op":"f","input":{"n":1.5,"files":{"z":"new\\n","a.duramen":"duramen 0.1\\n\\"quoted\\" é\\n"}}}');
  assert.strictEqual(r.cases[1].line, '{"id":"A#2","op":"f","input":{"n":1.50}}');
  assert.strictEqual(r.cases[2].line, '{"id":"A#3","op":"f","input":{"files":{}}}');
});
test('SU-004 checks', () => {
  const r = cases(echoFiles(H + 'oracle node echo.mjs\nop f\n  input x? json\nreq A "a"\n  example f {"x": {"y": [1, 2]}}\n    expect result.x.y.0 = 1\n    expect result.x.y.1 ~ 2.1 +- 0.25\n    expect result.x = ?\n    expect id = "A#1"\n  table f\n    | x | result.x ± 0.5 |\n    | 2 | 2.25           |\n'));
  assert.deepStrictEqual(r.cases[0].checks, [{ kind: 'eq', path: 'result.x.y.0', value: 1 }, { kind: 'approx', path: 'result.x.y.1', tol: 0.25, value: 2.1 },
    { from: 'oracle', kind: 'eq', path: 'result.x', value: { y: [1, 2] } }, { kind: 'eq', path: 'id', value: 'A#1' }]);
  assert.deepStrictEqual(r.cases[1].checks, [{ kind: 'approx', path: 'result.x', tol: 0.5, value: 2.25 }]);
});
test('SU-005 full answers', () => {
  const r = cases(echoFiles(H + 'oracle node echo.mjs\nop f\n  input answer? json\n  audit\n  tolerance result.t 0.5\n  tolerance result.u 0\nop g\n  input answer? json\nerrors\n  e when never\nreq A "a"\n  example f {"answer": {"result": {"t": 1}, "audit": "A"}}\n  example f {"answer": {"error": "e", "extra": 1}}\n    expect error = "e"\n  example g {"answer": {"result": 2, "audit": "B"}}\n  example h {"answer": {"error": "e"}}\n    expect error = "e"\n'));
  const tol = { 'result.t': 0.5, 'result.u': 0 };
  assert.deepStrictEqual(r.cases[0].full, { audit: 'A', members: ['audit', 'id', 'result'], result: { t: 1 }, tolerances: tol });
  assert.deepStrictEqual(r.cases[1].full, { error: 'e', members: ['error', 'extra', 'id'], tolerances: tol });
  assert.deepStrictEqual(r.cases[2].full, { members: ['audit', 'id', 'result'], result: 2, tolerances: {} });
  assert.deepStrictEqual(r.cases[3].full, { error: 'e', members: ['error', 'id'], tolerances: {} });
});
test('check result counts errors and warnings', () => {
  const r = call('check', { files: { 's.duramen': H + 'decision D-1 "one"\n  text\n    x\nreq A "a"\n  decision D-2\n' } }) as { result: { errors: number; warnings: number } };
  assert.strictEqual(r.result.errors, 2);
  assert.strictEqual(r.result.warnings, 2);
});
