// The driver protocol, end to end: the program REGEN.json names, started as the judge starts it.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('..', import.meta.url));
const regen = JSON.parse(readFileSync(`${dir}/REGEN.json`, 'utf8'));
const echo = readFileSync(`${dir}/fixtures/echo.mjs`, 'utf8');

function command(): string[] {
  const d = regen.driver;
  const cmd = typeof d === 'string' ? d : (d[process.platform] ?? d.default);
  return cmd.split(' ');
}

function drive(stdin: string | Buffer): Promise<{ out: Buffer; status: number | null }> {
  return new Promise((resolve, reject) => {
    const [prog, ...args] = command();
    const child = spawn(prog, args, { cwd: dir, stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => chunks.push(b));
    child.on('error', reject);
    child.on('close', (status) => resolve({ out: Buffer.concat(chunks), status }));
    child.stdin.end(stdin);
  });
}

const parseLines = (out: Buffer) =>
  out
    .toString('utf8')
    .split('\n')
    .slice(0, -1)
    .map((l) => JSON.parse(l));

test('REGEN.json names a driver command', () => {
  assert.equal(typeof regen.driver, 'string');
});

test('one response per non-blank line, in order, each ending with LF, then exit 0', async () => {
  const record = { 's.duramen': 'duramen 0.1\nspec s 1\nreq A "a"\n  text\n    It MUST work.\n' };
  const input = [
    JSON.stringify({ id: 'a', op: 'check', input: { files: record } }),
    '',
    '  \t ',
    '{not json',
    JSON.stringify({ id: 'b', op: 'lint', input: {} }),
    JSON.stringify({ id: 'c', op: 'cases', input: { files: record } }),
  ].join('\n');
  const { out, status } = await drive(input + '\n');
  assert.equal(status, 0);
  assert.ok(!out.includes(0x0d), 'no CR on standard output');
  assert.equal(out[out.length - 1], 0x0a);
  assert.deepEqual(parseLines(out), [
    { id: 'a', result: { diagnostics: ['s.duramen:3: error T001'], errors: 1, warnings: 0 } },
    { id: null, error: 'bad_request' },
    { id: 'b', error: 'unknown_op' },
    { id: 'c', result: { errors: 1, cases: [] } },
  ]);
});

test('a last line without LF is answered, and CR LF input is read', async () => {
  const req = { id: 'x', op: 'judge', input: { case: { checks: [], full: null }, answer: null } };
  const { out, status } = await drive(`${JSON.stringify(req)}\r\n${JSON.stringify({ ...req, id: 'y' })}`);
  assert.equal(status, 0);
  assert.deepEqual(parseLines(out), [
    { id: 'x', result: { pass: false, failed: ['answer'] } },
    { id: 'y', result: { pass: false, failed: ['answer'] } },
  ]);
});

test('no input at all: no output, exit 0', async () => {
  const { out, status } = await drive('');
  assert.equal(status, 0);
  assert.equal(out.length, 0);
});

test('a record run through its oracle, with text holding U+2028 and CR in a string', async () => {
  const files = {
    's.duramen':
      'duramen 0.1\nspec s 1\noracle node echo.mjs\nop f\n  input x? json\nreq A "a"\n' +
      '  example f {"x": "a b\\rc"}\n    expect result.x = "a b\\rc"\n',
    'echo.mjs': echo,
  };
  const { out, status } = await drive(JSON.stringify({ id: 'k', op: 'cases', input: { files } }) + '\n');
  assert.equal(status, 0);
  assert.ok(!out.includes(0x0d));
  const [res] = parseLines(out);
  assert.equal(res.result.errors, 0);
  assert.deepEqual(res.result.cases[0].full.result, { x: 'a b\rc' });
});
