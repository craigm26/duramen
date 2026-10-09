// The driver protocol, through the driver named in REGEN.json.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './spec-examples.ts';

function runDriver(input: string | Buffer): Promise<{ code: number | null; out: Buffer }> {
  const regen = JSON.parse(readFileSync(join(ROOT, 'REGEN.json'), 'utf8'));
  const words = (regen.driver as string).split(' ');
  return new Promise((resolve) => {
    const child = spawn(words[0], words.slice(1), { cwd: ROOT, stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('close', (code) => resolve({ code, out: Buffer.concat(chunks) }));
    child.stdin.end(input);
  });
}

const S = 'duramen 0.1\nspec s 1\n';

describe('driver (Interface)', () => {
  it('answers each non-blank line in order, with its id, and exits 0', async () => {
    const lines = [
      JSON.stringify({ id: 'a', op: 'check', input: { files: { 's.duramen': S } } }),
      '',
      '  \t ',
      '{not json',
      JSON.stringify({ id: 'b', op: 'lint' }),
      JSON.stringify({ id: 'c', op: 'cases', input: { files: { 's.duramen': S + 'frobnicate\n' } } }),
      JSON.stringify({ id: 'd', op: 'judge', input: { case: { checks: [], full: null }, answer: null } }),
    ];
    const { code, out } = await runDriver(lines.join('\n') + '\n');
    assert.equal(code, 0);
    const text = out.toString('utf8');
    assert.ok(!text.includes('\r'));
    assert.ok(text.endsWith('\n'));
    const got = text.trimEnd().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(got, [
      { id: 'a', result: { diagnostics: [], errors: 0, warnings: 0 } },
      { id: null, error: 'bad_request' },
      { id: 'b', error: 'unknown_op' },
      { id: 'c', result: { errors: 1, cases: [] } },
      { id: 'd', result: { pass: false, failed: ['answer'] } },
    ]);
  });

  it('answers a last line with no LF, and CR LF line ends', async () => {
    const a = JSON.stringify({ id: 'a', op: 'check', input: { files: { 's.duramen': S } } });
    const { code, out } = await runDriver(a + '\r\n' + a);
    assert.equal(code, 0);
    assert.equal(out.toString('utf8').trimEnd().split('\n').length, 2);
  });

  it('keeps U+2028 inside a line and writes UTF-8', async () => {
    const files = { 's.duramen': S + 'note\n  text\n    é x\n' };
    const { out } = await runDriver(JSON.stringify({ id: 'é ', op: 'check', input: { files } }) + '\n');
    const lines = out.toString('utf8').split('\n');
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]), { id: 'é ', result: { diagnostics: [], errors: 0, warnings: 0 } });
  });

  it('exits 0 on empty input', async () => {
    const { code, out } = await runDriver('');
    assert.equal(code, 0);
    assert.equal(out.length, 0);
  });
});
