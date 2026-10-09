import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { handleLine } from '../src/handle.ts';

const driver = new URL('../driver.ts', import.meta.url).pathname;
const ok = { files: { 'a.duramen': 'duramen 0.1\nspec a 1\n' } };

test('REQ-RQ-002 driver: one response per non-blank line, in order, LF only', () => {
  const lines = [
    JSON.stringify({ id: 'one', op: 'check', input: ok }),
    '',
    '  \t ',
    JSON.stringify({ id: 'two', op: 'lint' }) + '\r',
    '[1]',
    JSON.stringify({ id: 'three', op: 'cases', input: ok }),
  ];
  const r = spawnSync('node', [driver], { input: lines.join('\n'), encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.ok(!r.stdout.includes('\r'));
  assert.ok(r.stdout.endsWith('\n'));
  const out = r.stdout.trimEnd().split('\n').map((l) => JSON.parse(l));
  assert.deepStrictEqual(out.map((o) => o.id), ['one', 'two', null, 'three']);
  assert.deepStrictEqual(out[0].result, { diagnostics: [], errors: 0, warnings: 0 });
  assert.strictEqual(out[1].error, 'unknown_op');
  assert.strictEqual(out[2].error, 'bad_request');
  assert.deepStrictEqual(out[3].result, { errors: 0, cases: [] });
});

test('REQ-RQ-002 the first error that applies decides', () => {
  assert.deepStrictEqual(handleLine('{"id":"x","op":"nope","input":5}'), { id: 'x', error: 'unknown_op' });
  assert.deepStrictEqual(handleLine('{"id":"x","op":"check","input":null}'), { id: 'x', error: 'bad_request' });
  assert.deepStrictEqual(handleLine('{"id":"x","op":"check","input":{"files":{"a":"x","a/b":"y"}}}'), { id: 'x', error: 'bad_request' });
  assert.deepStrictEqual(handleLine('{"id":"x","op":"check","input":{"files":{"a.duramen":"x"},"entry":null}}'), { id: 'x', error: 'bad_request' });
  assert.deepStrictEqual(handleLine('{"id":"x","op":"check","input":{"files":{"a.duramen":"x"},"entry":"."}}').id, 'x');
});

test('REQ-RC-006 diagnostics are ordered by file, line, code, level', () => {
  const r = handleLine(JSON.stringify({ id: 'x', op: 'check', input: { files: { 'z.duramen': 'frobnicate\n', 'B.duramen': 'duramen 0.1\nspec s 1\nfrob\n' } } })) as any;
  assert.deepStrictEqual(r.result.diagnostics, ['B.duramen:3: error P002', 'z.duramen:1: error P002', 'z.duramen:1: error P020']);
});

test('REQ-OR-004 an oracle that never ends is stopped and reported', { timeout: 60000 }, () => {
  const spin = 'while (true) {}\n';
  const files = {
    's.duramen': 'duramen 0.1\nspec s 1\noracle node spin.mjs\nop f\n  input x? json\nreq A "a"\n  example f {}\n',
    'spin.mjs': spin,
  };
  const r = handleLine(JSON.stringify({ id: 'x', op: 'check', input: { files } })) as any;
  assert.deepStrictEqual(r.result.diagnostics, ['s.duramen:3: error T020', 's.duramen:7: error T021']);
});

test('REQ-SU-001 cases of a record with only warnings are listed', () => {
  const files = {
    's.duramen': 'duramen 0.1\nspec s 1\ndecision D "d"\n',
  };
  const r = handleLine(JSON.stringify({ id: 'x', op: 'cases', input: { files } })) as any;
  assert.deepStrictEqual(r.result, { errors: 0, cases: [] });
});
