import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, handleLine } from './driver.ts';
import { commandWords } from './checker.ts';
import { absent, equal, json, readPath } from './values.ts';

const model = `import fs from 'node:fs';
const requests = fs.readFileSync(0, 'utf8').split('\\n').filter(Boolean).map(JSON.parse);
for (const request of requests) {
  const input = request.input ?? {};
  if (input.silent) continue;
  console.log(JSON.stringify({id: request.id, ...(input.answer ?? {result: input})}));
}
`;
function run(source: string, op = 'check', extra: Record<string, string> = {}, entry?: string): any {
  const response = handle({ id: 'own', op, input: { files: { 'main.duramen': source, 'model.mjs': model, ...extra }, ...(entry === undefined ? {} : { entry }) } });
  assert.ok(response.result, JSON.stringify(response)); return response.result;
}
const header = 'duramen 0.1\nspec own 1\n';
const runnable = header + 'oracle node model.mjs\nop f\n  input answer? json, x? json, silent? boolean\n';
function invokeDriver(input: string): { status: number | null; output: Buffer; stderr: string } {
  const folder = fs.mkdtempSync(path.join(process.cwd(), '.driver-test-'));
  try {
    fs.writeFileSync(path.join(folder, 'in'), input);
    const fds = [fs.openSync(path.join(folder, 'in'), 'r'), fs.openSync(path.join(folder, 'out'), 'w'), fs.openSync(path.join(folder, 'err'), 'w')];
    let result;
    try { result = spawnSync(process.execPath, ['driver.ts'], { cwd: process.cwd(), stdio: fds }); }
    finally { for (const fd of fds) fs.closeSync(fd); }
    assert.equal(result.error, undefined);
    return { status: result.status, output: fs.readFileSync(path.join(folder, 'out')), stderr: fs.readFileSync(path.join(folder, 'err'), 'utf8') };
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
}

test('driver protocol / REQ-RQ-002: recovery, order, UTF-8, exact envelopes, and EOF', () => {
  const requests = [' \t', '{broken', JSON.stringify({ id: 4 }), JSON.stringify({ id: 'unknown', op: 'missing' }),
    JSON.stringify({ id: 'é\r\n\u2028😀', op: 'check', input: { files: { 's.duramen': header } } })];
  const result = invokeDriver(requests.join('\n'));
  assert.equal(result.status, 0); assert.equal(result.stderr, '');
  assert.equal(result.output.includes(13), false); assert.equal(result.output.at(-1), 10);
  assert.deepEqual(result.output.toString('utf8').trimEnd().split('\n').map(JSON.parse), [
    { id: null, error: 'bad_request' }, { id: null, error: 'bad_request' },
    { id: 'unknown', error: 'unknown_op' }, { id: 'é\r\n\u2028😀', result: { diagnostics: [], errors: 0, warnings: 0 } },
  ]);
});
test('REQ-RQ-001/002: request path validation and first applicable error', () => {
  for (const name of ['', '/x', 'x/', './x', 'a/../b', 'a//b', 'a\\b', 'a\0b', 'C:x']) {
    assert.deepEqual(handle({ id: name, op: 'cases', input: { files: { [name]: '' } } }), { id: name, error: 'bad_request' });
  }
  assert.deepEqual(handle({ id: 'x', op: 'check', input: { files: { a: '', 'a/b': '' } } }), { id: 'x', error: 'bad_request' });
  assert.deepEqual(handle({ id: 'x', op: 'what', input: null }), { id: 'x', error: 'unknown_op' });
  assert.deepEqual(handle({ id: [], op: 'what' }), { id: null, error: 'bad_request' });
  assert.equal(handleLine('\t  '), undefined);
});
test('REQ-RC-001/002: explicit roots and UTF-16 file ordering', () => {
  const files = { 'root/.hidden/a.duramen': header, 'root/build/b.duramen': 'bad', 'root/😀.duramen': header, 'root/\uff61.duramen': 'duramen 0.1\nspec later 1' };
  assert.deepEqual(handle({ id: 'r', op: 'check', input: { entry: 'root', files } }).result.diagnostics, ['root/\uff61.duramen:2: error P044']);
  assert.deepEqual(handle({ id: 'r', op: 'check', input: { entry: 'root/.hidden', files } }).result.diagnostics, []);
  assert.deepEqual(handle({ id: 'r', op: 'check', input: { entry: 'root/build/b.duramen', files } }).result.diagnostics, ['root/build/b.duramen:1: error P002', 'root/build/b.duramen:1: error P020', 'root/build/b.duramen:1: error P021']);
});
test('REQ-RC-003/004/005/006: independent parse problems accumulate, sort, and stop semantics', () => {
  const result = run('duramen 0.1\nduramen bad\nspec only\nspec twice 1\nreq X "empty"\n');
  assert.deepEqual(result, { diagnostics: ['main.duramen:2: error P023', 'main.duramen:3: error P021', 'main.duramen:4: error P044'], errors: 3, warnings: 0 });
  const mixed = run(header, 'check', { 'z.duramen': 'duramen 0.2\n' });
  assert.deepEqual(mixed.diagnostics, ['.:1: error P047']);
});
test('REQ-SY-001/002/003: physical lines, ignored unknown bodies, and indentation ownership', () => {
  assert.deepEqual(run('\ufeffduramen 0.1\r\nspec x 1\rnote\r  text\r    Café\u2028text\u3000').diagnostics, []);
  assert.deepEqual(run(header + 'alien\n  anything\n    more\nnote\n # comment\n    # orphan\n  bad\n    ignored\n').diagnostics,
    ['main.duramen:3: error P002', 'main.duramen:7: error P007', 'main.duramen:8: error P006', 'main.duramen:9: error P015']);
});
test('REQ-SY-003/004/005/006: once-only malformed clauses still claim their slots', () => {
  assert.deepEqual(run(header + '  title nope\n  title "later"\n    ignored\n  text inline\n   short\n  text\n    ignored\n').diagnostics,
    ['main.duramen:3: error P004', 'main.duramen:4: error P052', 'main.duramen:6: error P008', 'main.duramen:7: error P008', 'main.duramen:8: error P052']);
  assert.deepEqual(run(header + 'section X "\\q"\nsection Y "\n').diagnostics,
    ['main.duramen:3: error P004', 'main.duramen:4: error P005']);
  assert.deepEqual(run(header + '  request {"id":1e400}\n').diagnostics, ['main.duramen:3: error P009']);
});
test('REQ-SY-007/013: nested field delimiters and malformed entries claim no names', () => {
  assert.deepEqual(run(header + 'op f\n  input a? {x:[1,2)}, b? "x,\\\"y", c? x], d? json\n  input a\n  tolerance result 1\n  tolerance result 1e400\n').diagnostics,
    ['main.duramen:5: error P017', 'main.duramen:7: error P018']);
  assert.deepEqual(run(header + 'op f\n  input x\n  input x number\n  input x? json\n  audit text\n  audit\n').diagnostics,
    ['main.duramen:4: error P017', 'main.duramen:6: error P052', 'main.duramen:8: error P052']);
});
test('REQ-SY-008 and REQ-CK-005/006: conditions continue literally and repeated codes are declared', () => {
  const source = runnable + 'errors\n  e when first\n    # MUST continue\n  e when next\nreq R "r"\n  example undeclared {}\n    expect error = "e"\n';
  assert.deepEqual(run(source).diagnostics, ['main.duramen:7: error T004', 'main.duramen:12: error T002']);
});
test('REQ-SY-009 and REQ-CK-001/002/003/007/009: kinds, citations, lifecycle and open clauses', () => {
  const source = header + 'decision A "one"\n  source here\n  status inferred\nreq A "same ID in another kind"\n  decision A A Missing Missing\nopen A "a deliberate gap"\n  example raw no quote\n    not parsed\nreq A "duplicate req"\n';
  assert.deepEqual(run(source).diagnostics, ['main.duramen:6: error T001', 'main.duramen:6: error T008', 'main.duramen:6: warning T028', 'main.duramen:9: error T003', 'main.duramen:11: error T001', 'main.duramen:11: error T007']);
});
test('REQ-SY-010: rejected example first lines still have their bodies read', () => {
  const source = header + 'req A "a"\n  example f []\n    input x\n      text\n    input x.y from "missing"\n    request {"x":1}\n    request invalid\n  example raw "x\\ny"\n    omit id\n';
  assert.deepEqual(run(source).diagnostics, ['main.duramen:4: error P012', 'main.duramen:7: error P048', 'main.duramen:9: error P052', 'main.duramen:10: error P026', 'main.duramen:11: error P022']);
});
test('REQ-SY-011: input path objects have ordinary __proto__ and constructor members', () => {
  const source = runnable + 'req A "a"\n  example f {}\n    input x.__proto__.constructor\n      kept\n    expect result.x.__proto__.constructor = "kept\\n"\n';
  const result = run(source, 'cases');
  assert.equal(result.errors, 0);
  assert.equal(result.cases[0].line, '{"id":"A#1","op":"f","input":{"x":{"__proto__":{"constructor":"kept\\n"}}}}');
});
test('REQ-SY-011: from resolution skips empty components and judges only the final location', () => {
  const source = runnable + 'req A "a"\n  example f {}\n    input x from "/../sub//./text.txt"\n    expect result.x = "\\ufeffwhole\\r\\ntext"\n';
  const result = handle({ id: 'r', op: 'check', input: { entry: 'sub', files: { 'sub/main.duramen': source, 'sub/model.mjs': model, 'sub/text.txt': '\ufeffwhole\r\ntext' } } });
  assert.deepEqual(result.result.diagnostics, []);
  assert.deepEqual(run(runnable + 'req A "a"\n  example f {}\n    input x from "../text.txt"\n', 'check', { 'text.txt': 'outside' }).diagnostics, ['main.duramen:8: error P048']);
});
test('REQ-SY-012 and REQ-SU-003/004: escaped table cells preserve spelling and expected values', () => {
  const source = runnable + 'req T "table"\n  table f\n    | x | result.x |\n    | "a\\|b" | "a\\|b" |\n    | 2.0e1 | 20 |\n';
  const result = run(source, 'cases'); assert.equal(result.errors, 0);
  assert.equal(result.cases[0].line, '{"id":"T#1","op":"f","input":{"x":"a|b"}}');
  assert.equal(result.cases[1].line, '{"id":"T#2","op":"f","input":{"x":2.0e1}}');
  assert.deepEqual(result.cases[1].checks, [{ path: 'result.x', kind: 'eq', value: 20 }]);
});
test('REQ-CK-004 and REQ-OR-001/002: unknown ops skip execution, other static errors do not', () => {
  assert.deepEqual(run(header + 'req A "a"\n  example missing {}\n').diagnostics, ['main.duramen:2: error T019', 'main.duramen:4: error T009']);
  assert.deepEqual(run(runnable + 'req A "a"\n  example missing {}\n').diagnostics, ['main.duramen:7: error T009']);
  const source = header + 'oracle node model.mjs\nop f\n  input needed json\nreq A "a"\n  example f {"extra":1}\n    expect result.extra = 2\n';
  assert.deepEqual(run(source).diagnostics, ['main.duramen:7: error T010', 'main.duramen:7: warning T011', 'main.duramen:8: error T002']);
});
test('REQ-CK-006: quotations leave word boundaries and never span physical lines', () => {
  const source = header + 'note\n  text\n    x`q`MUST\n    MU`q`ST\nnote\n  text\n    "MUST" “SHALL” `REQUIRED`\nnote\n  text\n    "MUST\n    quoted on another line"\nopen G "gap"\n  text\n    SHALLé\n';
  assert.deepEqual(run(source).diagnostics, ['main.duramen:3: error T004', 'main.duramen:10: error T004', 'main.duramen:14: warning T014']);
});
test('REQ-CK-008: the order heuristic spans whitespace but uses exact error-code boundaries', () => {
  const source = header + 'errors\n  a when x\n  b when y\nreq A "a"\n  text\n    aé takes\n    precedence over b.\nreq B "b"\n  text\n    a-extra before b.\n';
  assert.deepEqual(run(source).diagnostics, ['main.duramen:6: error T001', 'main.duramen:7: error T005', 'main.duramen:10: error T001']);
});
test('REQ-OR-002: quote parsing does not invoke a shell or reinterpret general backslashes', () => {
  assert.deepEqual(commandWords('node pre"two words"post \'single space\' "" "a\\qb\\\"c"'), ['node', 'pretwo wordspost', 'single space', '', 'a\\qb"c']);
  assert.equal(commandWords('node "unclosed'), undefined);
  const script = `import fs from 'node:fs'; const r=JSON.parse(fs.readFileSync(0,'utf8')); console.log(JSON.stringify({id:r.id,result:process.argv.slice(2)}));`;
  const source = header + 'oracle node "space file.mjs" "" \'a b\' $literal\nop f\nreq A "a"\n  example f {}\n    expect result = ["","a b","$literal"]\n';
  assert.deepEqual(run(source, 'check', { 'space file.mjs': script }).diagnostics, []);
});
test('REQ-OR-002/003/005: response IDs match in any order, first response wins, invalid lines match nothing', () => {
  const script = `import fs from 'node:fs'; const r=fs.readFileSync(0,'utf8').trim().split('\\n').map(JSON.parse); console.log('not JSON'); console.log('{"id":"A#1","result":1e400}'); for(const q of r.reverse()){console.log(JSON.stringify({id:q.id,result:q.input.x}));console.log(JSON.stringify({id:q.id,result:"duplicate"}));}`;
  const source = runnable + 'req A "a"\n  example f {"x":1}\n    expect result = 1\n  example f {"x":2}\n    expect result = 2\n';
  assert.deepEqual(run(source, 'check', { 'model.mjs': script }).diagnostics, []);
});
test('REQ-OR-002: raw and omitted-id requests each get their own oracle run', () => {
  const script = `import fs from 'node:fs';const lines=fs.readFileSync(0,'utf8').trim().split('\\n');console.log(JSON.stringify({result:lines.length}));`;
  const source = runnable + 'req A "a"\n  example f {}\n    omit id\n    expect result = 1\n  example raw \'not even JSON\'\n    expect result = 1\n';
  const result = run(source, 'cases', { 'model.mjs': script });
  assert.equal(result.errors, 0); assert.deepEqual(result.cases.map((c: any) => c.solo), [true, true]);
  assert.deepEqual(result.cases.map((c: any) => c.full.members), [['result'], ['result']]);
});
test('REQ-OR-004: nonzero and signaled exits preserve received responses', () => {
  const source = runnable + 'req A "a"\n  example f {}\n    expect result = 1\n';
  for (const ending of ['process.exitCode=9;', 'process.kill(process.pid,"SIGTERM");']) {
    const script = `import fs from 'node:fs';const r=JSON.parse(fs.readFileSync(0,'utf8'));fs.writeSync(1,JSON.stringify({id:r.id,result:1})+'\\n');${ending}`;
    assert.deepEqual(run(source, 'check', { 'model.mjs': script }).diagnostics, ['main.duramen:3: error T020']);
  }
});
test('REQ-OR-004: timeout reports failure and still uses the complete response', () => {
  const script = `import fs from 'node:fs';const r=JSON.parse(fs.readFileSync(0,'utf8'));fs.writeSync(1,JSON.stringify({id:r.id,result:1})+'\\n');setInterval(()=>{},1000);`;
  assert.deepEqual(run(runnable + 'req A "a"\n  example f {}\n    expect result = 1\n', 'check', { 'model.mjs': script }).diagnostics, ['main.duramen:3: error T020']);
});
test('REQ-OR-005/006/007/008: no answer, oracle_error suppression, warnings and missing captured values', () => {
  const source = runnable + 'req A "a"\n  example f {"silent":true}\n  example f {"answer":{"oracle_error":null,"error":"e"}}\n    expect result = ?\n  example f {"answer":{"error":null}}\n  example f {}\n    expect missing = ?\n';
  assert.deepEqual(run(source).diagnostics, ['main.duramen:7: error T021', 'main.duramen:8: error T022', 'main.duramen:10: warning T024', 'main.duramen:12: error T025']);
});
test('REQ-SU-001/002/003/004/005 and REQ-JU-001/004: generated suites can judge changed answers', () => {
  const source = header + '  request {"clock":1,"2":"two"}\noracle node model.mjs\nop f\n  input answer? json\n  tolerance result.n 0.25\n  audit text\nreq A "a"\n  on windows\n  example f { "answer": {"result":{"n":2},"audit":"ok"} }\n    request {"clock":2}\n    expect result.n ≈ 2 ± 0.25\n    expect audit = ?\n';
  const result = run(source, 'cases'); assert.equal(result.errors, 0);
  const c = result.cases[0];
  assert.deepEqual({ id: c.id, reqs: c.reqs, platform: c.platform }, { id: 'A#1', reqs: ['REQ-A'], platform: 'windows' });
  assert.equal(c.line, '{"id":"A#1","op":"f","2":"two","clock":2,"input":{ "answer": {"result":{"n":2},"audit":"ok"} }}');
  const good = { id: 'anything', result: { n: 2.25 }, audit: 'ok' };
  assert.deepEqual(handle({ id: 'j', op: 'judge', input: { case: c, answer: good } }).result, { pass: true });
  good.result.n = 2.5;
  assert.deepEqual(handle({ id: 'j', op: 'judge', input: { case: c, answer: good } }).result, { pass: false, failed: ['checks.0', 'result'] });
  assert.deepEqual(run(source.replace('± 0.25', '± 0'), 'cases').cases.length, 1);
  assert.deepEqual(run(source.replace('≈ 2 ± 0.25', '= 3'), 'cases'), { errors: 1, cases: [] });
});
test('REQ-JU-002/003: missing paths, array indexes, binary64 values and audit JSON', () => {
  const response = JSON.parse('{"result":{"a":[1],"":{"":null},"__proto__":2},"audit":"{\\"x\\":[3]}"}');
  assert.equal(readPath(response, 'result.a.0'), 1);
  for (const path of ['result.a.01', 'result.a.-1', 'result.a.length', 'result.toString']) assert.equal(readPath(response, path), absent);
  assert.equal(readPath(response, 'result..'), null); assert.equal(readPath(response, 'result.__proto__'), 2);
  assert.equal(readPath(response, 'audit.x.0'), 3);
  assert.equal(readPath({ audit: '{"x":1e400}' }, 'audit.x'), absent);
  assert.equal(equal(-0, 0), true); assert.equal(equal(true, 1), false); assert.equal(equal({}, []), false);
  assert.equal(json('{"nested":[1e400]}'), absent);
  const c = { checks: [{ path: 'result', kind: 'approx', value: 0.3, tol: 0 }], full: null };
  assert.deepEqual(handle({ id: 'j', op: 'judge', input: { case: c, answer: { result: 0.1 + 0.2 } } }).result, { pass: false, failed: ['checks.0'] });
});
test('REQ-JU-004: full shape, structured error equality and ordered failures', () => {
  const c = { checks: [{ path: 'absent', kind: 'eq', value: null }], full: { members: ['audit', 'id', 'result'], tolerances: {}, result: [1, 2], audit: 'a\r\nb' } };
  assert.deepEqual(handle({ id: 'j', op: 'judge', input: { case: c, answer: { result: [2, 1], audit: 'a\nb' } } }).result,
    { pass: false, failed: ['checks.0', 'members', 'result', 'audit'] });
  const errorCase = { checks: [], full: { members: ['error', 'result'], error: { x: [1, null] }, result: 'ignored', audit: 'ignored', tolerances: {} } };
  assert.deepEqual(handle({ id: 'j', op: 'judge', input: { case: errorCase, answer: { result: 99, error: { x: [1, null] } } } }).result, { pass: true });
});
test('REQ-RQ-001: consecutive requests cannot see one another’s record files', () => {
  const source = runnable + 'req A "a"\n  example f {}\n';
  assert.equal(run(source).errors, 0);
  assert.deepEqual(handle({ id: 'r', op: 'check', input: { files: { 'main.duramen': source } } }).result.diagnostics,
    ['main.duramen:3: error T020', 'main.duramen:7: error T021']);
  assert.deepEqual(fs.readdirSync('.').filter(n => n.startsWith('.duramen-')), []);
});
