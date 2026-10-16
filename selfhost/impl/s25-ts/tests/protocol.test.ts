import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { call, diags, expectDiags, t } from './helpers.ts';
import { handleLine } from '../src/handle.ts';

const AB = t('duramen 0.1', 'spec a 1');

// REQ-RQ-001
test('REQ-RQ-001: a record is read from the files of the request', async () => {
  await expectDiags({ 'a.duramen': AB, 'b.duramen': 'frobnicate\n' }, [], 'a.duramen');
  const r = await call('check', { files: { 'a.duramen': AB, 'b.duramen': 'frobnicate\n' } });
  assert.deepStrictEqual(r.result, {
    diagnostics: ['b.duramen:1: error P002', 'b.duramen:1: error P020'],
    errors: 2,
    warnings: 0,
  });
  // the entry "." names the folder that holds all the files
  await expectDiags({ 'a.duramen': AB }, [], '.');
});

// REQ-RQ-002
test('REQ-RQ-002: requests that cannot be handled', async () => {
  const bad = async (line: string, id: unknown, error: string) =>
    assert.deepStrictEqual(await handleLine(line), { id, error }, line);
  await bad('{not json', null, 'bad_request');
  await bad('[1, 2]', null, 'bad_request');
  await bad('{"op": "check", "input": {}}', null, 'bad_request');
  await bad('{"id": 7, "op": "check", "input": {}}', null, 'bad_request');
  await bad('{"id": "1", "op": "lint", "input": {"files": {"a.duramen": "x"}}}', '1', 'unknown_op');
  await bad('{"id": "1", "op": "lint"}', '1', 'unknown_op');
  await bad('{"id": "1", "op": "check"}', '1', 'bad_request');
  const files = (f: unknown, extra: object = {}) => ({ id: '1', op: 'check', input: { files: f, ...extra } });
  const cases = [
    {},
    { files: {} },
    { files: ['a.duramen'] },
    { files: { 'a.duramen': 1 } },
    { files: { '../a.duramen': AB } },
    { files: { '/a.duramen': AB } },
    { files: { 'x/./a.duramen': AB } },
    { files: { 'x//a.duramen': AB } },
    { files: { 'c:a.duramen': AB } },
    { files: { 'a\\b.duramen': AB } },
    { files: { a: 'x', 'a/b.duramen': AB } },
    { files: { 'a.duramen': AB }, entry: '../a.duramen' },
    { files: { 'a.duramen': AB }, entry: 1 },
    { files: { 'a.duramen': AB }, entry: '' },
  ];
  for (const input of cases) await bad(JSON.stringify({ id: '1', op: 'check', input }), '1', 'bad_request');
  assert.ok(files({}));
  // the first condition decides: unknown_op before bad_request
  await bad('{"id": "9", "op": "x", "input": 5}', '9', 'unknown_op');
});

test('driver: one response per non-blank line, in order, then exit 0', async () => {
  const child = spawn(process.execPath, ['src/driver.ts'], { cwd: new URL('..', import.meta.url).pathname });
  let out = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (s) => (out += s));
  const done = new Promise<number | null>((r) => child.on('close', r));
  child.stdin.write('\n  \t \n{"id":"a","op":"check","input":{"files":{"a.duramen":"duramen 0.1\\nspec a 1\\n"}}}\n');
  child.stdin.write('nonsense\n');
  child.stdin.end('{"id":"c","op":"lint","input":{}}');
  assert.strictEqual(await done, 0);
  const lines = out.split('\n');
  assert.strictEqual(lines.pop(), '');
  assert.deepStrictEqual(lines.map((l) => JSON.parse(l)), [
    { id: 'a', result: { diagnostics: [], errors: 0, warnings: 0 } },
    { id: null, error: 'bad_request' },
    { id: 'c', error: 'unknown_op' },
  ]);
  assert.ok(!out.includes('\r'));
});

test('diags helper sanity', async () => {
  assert.deepStrictEqual(await diags({ 'a.duramen': AB }), []);
});
