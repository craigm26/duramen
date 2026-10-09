// The driver protocol (Interface: Driver protocol, REQ-RQ-002).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runDriver } from './helpers.ts';

const ok = { files: { 'a.duramen': 'duramen 0.1\nspec a 1\n' } };
const line = (id: string, op = 'check', input: unknown = ok) => JSON.stringify({ id, op, input });

test('one response per non-blank line, in request order, then exit status 0', async () => {
  const input = [line('1'), '', '   ', '\t \t', line('2', 'judge', { case: { checks: [], full: null }, answer: null }), line('3', 'nope')].join('\n') + '\n';
  const run = await runDriver(input);
  assert.equal(run.status, 0);
  assert.ok(run.stdout.endsWith('\n'));
  const out = run.stdout.split('\n').slice(0, -1).map((l) => JSON.parse(l));
  assert.deepEqual(out, [
    { id: '1', result: { diagnostics: [], errors: 0, warnings: 0 } },
    { id: '2', result: { pass: false, failed: ['answer'] } },
    { id: '3', error: 'unknown_op' },
  ]);
});

test('a bad line does not stop the driver', async () => {
  const run = await runDriver(['{not json', '[1, 2]', '"x"', 'null', line('ok')].join('\n') + '\n');
  const out = run.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(out.slice(0, 4), Array(4).fill({ id: null, error: 'bad_request' }));
  assert.equal(out[4].id, 'ok');
  assert.equal(run.status, 0);
});

test('no input at all: no output, exit status 0', async () => {
  const run = await runDriver('');
  assert.equal(run.stdout, '');
  assert.equal(run.status, 0);
});

test('a last line without LF is answered', async () => {
  const run = await runDriver(line('last'));
  assert.equal(JSON.parse(run.stdout).id, 'last');
  assert.ok(run.stdout.endsWith('\n'));
});

test('CR LF line ends are read, and the output holds no CR', async () => {
  const files = { 'a\rb.duramen': 'duramen 0.1\r\n' };
  const run = await runDriver(line('crlf', 'check', { files }) + '\r\n' + line('x') + '\r\n');
  assert.ok(!run.stdout.includes('\r'));
  const out = run.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(out[0].result.diagnostics, ['.:1: error P021']);
  assert.equal(out[1].id, 'x');
});

test('U+2028 and U+2029 in a request line do not end it', async () => {
  const files = { 's.duramen': 'duramen 0.1\nspec s 1 \nnote\n  text\n    a b\n' };
  const run = await runDriver(line('ls', 'check', { files }) + '\n');
  const out = run.stdout.trim().split('\n');
  assert.equal(out.length, 1);
  assert.deepEqual(JSON.parse(out[0]).result.diagnostics, []);
});

test('a response holds id and result, or id and error, and nothing else', async () => {
  const run = await runDriver([line('a'), line('b', 'cases'), line('c', 'check', {})].join('\n') + '\n');
  for (const l of run.stdout.trim().split('\n')) {
    const keys = Object.keys(JSON.parse(l)).sort();
    assert.ok(JSON.stringify(keys) === '["id","result"]' || JSON.stringify(keys) === '["error","id"]', l);
  }
});

test('output is UTF-8', async () => {
  const files = { 'é😀.duramen': 'duramen 0.1\n' };
  const run = await runDriver(line('u', 'check', { files }) + '\n');
  assert.deepEqual(JSON.parse(run.stdout).result.diagnostics, ['.:1: error P021']);
  const files2 = { 'é😀.duramen': 'nope\n' };
  const run2 = await runDriver(line('u', 'check', { files: files2 }) + '\n');
  assert.ok(JSON.parse(run2.stdout).result.diagnostics.includes('é😀.duramen:1: error P002'));
});
