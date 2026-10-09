import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { t } from './helper.ts';

test('driver protocol: one line per non-blank request, in order, LF only, exit 0', () => {
  const ok = { files: { 'a.duramen': t('duramen 0.1', 'spec a 1') } };
  const input =
    [
      JSON.stringify({ id: '1', op: 'check', input: ok }),
      '',
      ' \t ',
      '{not json',
      JSON.stringify({ id: '2', op: 'nope' }),
      JSON.stringify({ id: '3', op: 'cases', input: ok }),
    ].join('\n') + '\n' + JSON.stringify({ id: '4', op: 'check', input: ok });
  const r = spawnSync(process.execPath, [new URL('../src/driver.ts', import.meta.url).pathname], { input, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.includes('\r'));
  assert.ok(r.stdout.endsWith('\n'));
  const out = r.stdout.slice(0, -1).split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(out, [
    { id: '1', result: { diagnostics: [], errors: 0, warnings: 0 } },
    { id: null, error: 'bad_request' },
    { id: '2', error: 'unknown_op' },
    { id: '3', result: { errors: 0, cases: [] } },
    { id: '4', result: { diagnostics: [], errors: 0, warnings: 0 } },
  ]);
});
