import assert from 'node:assert/strict';
import test from 'node:test';
import { HEAD, ask, diagnostics, drive } from './helpers.ts';

const GOOD = { files: { 'a.duramen': HEAD } };

test('REQ-RQ-002: lines that are no request object get id null', async () => {
  const out = await drive(['{not json', '[1, 2]', '{"op":"check","input":{}}', '{"id":7,"op":"check","input":{}}']);
  assert.deepEqual(
    out.map((l) => JSON.parse(l)),
    Array(4).fill({ id: null, error: 'bad_request' }),
  );
});

test('REQ-RQ-002: unknown_op comes before bad_request', async () => {
  const out = await drive([
    { id: 'a', op: 'lint', input: GOOD },
    { id: 'b', op: 'lint' },
    { id: 'c', op: 'check' },
    { id: 'd', op: 'check', input: 5 },
    { id: 'e', op: 'check', input: [] },
    { id: 'f' },
  ]);
  assert.deepEqual(
    out.map((l) => JSON.parse(l)),
    [
      { id: 'a', error: 'unknown_op' },
      { id: 'b', error: 'unknown_op' },
      { id: 'c', error: 'bad_request' },
      { id: 'd', error: 'bad_request' },
      { id: 'e', error: 'bad_request' },
      { id: 'f', error: 'unknown_op' },
    ],
  );
});

test('REQ-RQ-002: the driver goes on after an error', async () => {
  const out = await drive([{ id: '1', op: 'check', input: {} }, { id: '2', op: 'check', input: GOOD }]);
  assert.equal(out.length, 2);
  assert.deepEqual(JSON.parse(out[0]), { id: '1', error: 'bad_request' });
  assert.deepEqual(JSON.parse(out[1]), { id: '2', result: { diagnostics: [], errors: 0, warnings: 0 } });
});

test('driver protocol: blank lines get no response, responses keep request order, no CR', async () => {
  const text =
    '\n  \t\n' +
    JSON.stringify({ id: 'x', op: 'check', input: GOOD }) +
    '\n\n' +
    JSON.stringify({ id: 'y', op: 'check', input: { files: { 'a.duramen': 'duramen 0.1 \r\n' } } }) +
    '\n';
  const out = await drive([], text);
  assert.equal(out.length, 2);
  assert.equal(JSON.parse(out[0]).id, 'x');
  assert.equal(JSON.parse(out[1]).id, 'y');
  assert.ok(out.every((l) => !l.includes('\r')));
});

test('driver protocol: a last line without LF is still answered; empty input gives no output', async () => {
  const out = await drive([], JSON.stringify({ id: 'z', op: 'check', input: GOOD }));
  assert.equal(out.length, 1);
  assert.deepEqual(await drive([], ''), []);
});

test('REQ-RQ-001: names must be relative paths', async () => {
  for (const name of ['', '.', '..', 'a/', '/a', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'a\0b', 'c:x', 'Z:']) {
    const r = await ask('check', { files: { [name]: 'x' } });
    assert.equal(r.error, 'bad_request', JSON.stringify(name));
  }
  const ok = await ask('check', { files: { 'ab:y': 'duramen 0.1\nspec s 1\n', '1:a': 'duramen 0.1\n' } });
  assert.ok(ok.result, 'only an ASCII letter and a colon make a drive');
});

test('REQ-RQ-001: entry forms', async () => {
  assert.ok((await ask('check', { ...GOOD, entry: '.' })).result);
  assert.equal((await ask('check', { ...GOOD, entry: null })).error, 'bad_request');
  assert.equal((await ask('check', { ...GOOD, entry: 'a//b' })).error, 'bad_request');
  assert.equal((await ask('check', { ...GOOD, entry: '/' })).error, 'bad_request');
});

test('REQ-RC-001: a record folder with no usable files has P046', async () => {
  assert.deepEqual(await diagnostics({ 'sub/.x.duramen': HEAD, 'sub/build/y.duramen': HEAD }, 'sub'), [
    'sub:1: error P046',
  ]);
});

test('REQ-RC-006: the counts follow the levels', async () => {
  const r = (await ask('check', {
    files: { 's.duramen': HEAD + 'decision D "d"\n' },
  })) as { result: { diagnostics: string[]; errors: number; warnings: number } };
  assert.deepEqual(r.result.diagnostics, ['s.duramen:3: warning T012', 's.duramen:3: warning T013']);
  assert.equal(r.result.errors, 0);
  assert.equal(r.result.warnings, 2);
});

test('REQ-SU-001: warnings do not stop the suite', async () => {
  const files = {
    's.duramen': 'duramen 0.1\nspec s 1\ndecision D "d"\n',
  };
  const r = (await ask('cases', { files })) as { result: { errors: number; cases: unknown[] } };
  assert.deepEqual(r.result, { errors: 0, cases: [] });
});

test('REQ-SU-003: a table row sends its input cells as written', async () => {
  const files = {
    's.duramen':
      'duramen 0.1\nspec s 1\n  request {"b": 1}\noracle node o.mjs\nop f\n  input x? json\n  request {"c": 2}\nreq A "a"\n  table f\n    | x | result |\n    | 2.50 | ? |\n    |  | ? |\n',
    'o.mjs':
      'process.stdin.setEncoding("utf8");let s="";for await(const c of process.stdin)s+=c;for(const l of s.split("\\n")){if(!l.trim())continue;const r=JSON.parse(l);console.log(JSON.stringify({id:r.id,result:r.input}))}\n',
  };
  const r = (await ask('cases', { files })) as { result: { errors: number; cases: { line: string }[] } };
  assert.equal(r.result.errors, 0);
  assert.equal(r.result.cases[0].line, '{"id":"A#1","op":"f","c":2,"input":{"x":2.50}}');
  assert.equal(r.result.cases[1].line, '{"id":"A#2","op":"f","c":2,"input":{}}');
});

test('REQ-JU-001: judge needs case and answer', async () => {
  assert.equal((await ask('judge', { answer: null })).error, 'bad_request');
  assert.deepEqual((await ask('judge', { case: { checks: [], full: null }, answer: { id: 'x' } })).result, { pass: true });
});
