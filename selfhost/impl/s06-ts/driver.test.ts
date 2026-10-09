import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('the driver named in REGEN.json speaks the protocol', () => {
  const cfg = JSON.parse(readFileSync(new URL('./REGEN.json', import.meta.url), 'utf8'));
  const [cmd, ...args] = (cfg.driver as string).split(' ');
  const exe = cmd === 'node' ? process.execPath : cmd;
  const input =
    JSON.stringify({ id: 'a', op: 'check', input: { files: { 'a.duramen': 'duramen 0.1\nspec a 1\n' } } }) +
    '\n\n   \n{bad\n' +
    JSON.stringify({ id: 'b', op: 'cases', input: { files: { 'a.duramen': 'duramen 0.1\nspec a 1\n' } } }) +
    '\n';
  const r = spawnSync(exe, args, { cwd: new URL('.', import.meta.url), input, encoding: 'utf8' });
  assert.equal(r.status, 0);
  const lines = r.stdout.split('\n');
  assert.equal(lines.pop(), '');
  assert.deepEqual(lines.map((l) => JSON.parse(l)), [
    { id: 'a', result: { diagnostics: [], errors: 0, warnings: 0 } },
    { id: null, error: 'bad_request' },
    { id: 'b', result: { errors: 0, cases: [] } },
  ]);
});
