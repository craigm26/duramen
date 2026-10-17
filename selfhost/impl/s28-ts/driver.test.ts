import assert from 'node:assert/strict';
import test from 'node:test';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function runDriver(input: string): { status: number | null; stdout: Buffer; stderr: string } {
  const dir = mkdtempSync(join(process.cwd(), '.driver-test-'));
  try {
    const inputFile = join(dir, 'input');
    writeFileSync(inputFile, input, 'utf8');
    const outputFile = join(dir, 'output'), errorFile = join(dir, 'error');
    const fds = [openSync(inputFile, 'r'), openSync(outputFile, 'w'), openSync(errorFile, 'w')];
    const regen = JSON.parse(readFileSync('REGEN.json', 'utf8'));
    const [command, ...args] = (typeof regen.driver === 'string' ? regen.driver : regen.driver[process.platform] ?? regen.driver.default).split(' ');
    let result;
    try { result = spawnSync(command, args, { cwd: process.cwd(), stdio: fds, timeout: 15000 }); }
    finally { fds.forEach(fd => closeSync(fd)); }
    assert.equal(result.error, undefined);
    return { status: result.status, stdout: readFileSync(outputFile), stderr: readFileSync(errorFile, 'utf8') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('Driver protocol and REQ-RQ-002: one ordered UTF-8 JSON response per nonblank line, recover after failures, LF only, exit zero', () => {
  const request = { id: 'é😀\r\n', op: 'check', input: { files: { 'strange\rname.duramen': 'duramen 0.1\nspec p 1' } } };
  const judge = { id: 'j', op: 'judge', input: { case: { checks: [], full: null }, answer: {} } };
  const result = runDriver(' \t\n\n{bad json\n' + JSON.stringify(request) + '\r\nnull\n' + JSON.stringify({ id: 'u', op: 'other' }) + '\n' + JSON.stringify(judge));
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes(13), false);
  assert.equal(result.stdout.at(-1), 10);
  const lines = result.stdout.toString('utf8').split('\n');
  assert.equal(lines.pop(), '');
  assert.deepEqual(lines.map(line => JSON.parse(line)), [
    { id: null, error: 'bad_request' }, { id: 'é😀\r\n', result: { diagnostics: [], errors: 0, warnings: 0 } },
    { id: null, error: 'bad_request' }, { id: 'u', error: 'unknown_op' }, { id: 'j', result: { pass: true } },
  ]);
});

test('Driver protocol: input chunk boundaries and final unterminated request preserve Unicode', () => {
  const id = 'x'.repeat(70000) + '😀é';
  const result = runDriver(JSON.stringify({ id, op: 'judge', input: { case: { checks: [], full: null }, answer: {} } }));
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout.toString()), { id, result: { pass: true } });
  const empty = runDriver('\n\t \n');
  assert.equal(empty.status, 0);
  assert.equal(empty.stdout.length, 0);
});
