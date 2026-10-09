import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { handle } from '../src/handler.ts';

const A = 'duramen 0.1\nspec a 1\n';

function drive(input: string) {
  const r = spawnSync(process.execPath, ['driver.ts'], { cwd: new URL('..', import.meta.url), input, encoding: 'utf8' });
  return r;
}

test('driver protocol: one line per non-blank request, in order, LF only, exit 0', () => {
  const req = (id: string, files: any) => JSON.stringify({ id, op: 'check', input: { files } });
  const r = drive([req('1', { 'a.duramen': A }), '', '  \t ', req('2', { 'a.duramen': 'frobnicate\n' }), '{not json', ''].join('\n'));
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.includes('\r'));
  const out = r.stdout.split('\n');
  assert.equal(out.pop(), '');
  assert.deepEqual(out.map((l) => JSON.parse(l)), [
    { id: '1', result: { diagnostics: [], errors: 0, warnings: 0 } },
    { id: '2', result: { diagnostics: ['.:1: error P021', 'a.duramen:1: error P002', 'a.duramen:1: error P020'], errors: 3, warnings: 0 } },
    { id: null, error: 'bad_request' },
  ]);
});

test('driver keeps U+2028 inside a request line', () => {
  const line = JSON.stringify({ id: 'u', op: 'check', input: { files: { 's.duramen': 'duramen 0.1\nspec s 1\nnote\n  text\n    a b\n' } } });
  const r = drive(line + '\n');
  assert.deepEqual(JSON.parse(r.stdout.trim()), { id: 'u', result: { diagnostics: [], errors: 0, warnings: 0 } });
});

test('a last line without LF is answered', () => {
  const r = drive(JSON.stringify({ id: 'z', op: 'nope', input: {} }));
  assert.deepEqual(JSON.parse(r.stdout.trim()), { id: 'z', error: 'unknown_op' });
});

const files = { 'a.duramen': A };
const errs: [string, any][] = [
  ['{not json', { id: null, error: 'bad_request' }],
  ['[1, 2]', { id: null, error: 'bad_request' }],
  [JSON.stringify({ op: 'check', input: { files } }), { id: null, error: 'bad_request' }],
  ['{"id": 7, "op": "check", "input": {"files": {"a.duramen": "duramen 0.1\\nspec a 1\\n"}}}', { id: null, error: 'bad_request' }],
  [JSON.stringify({ id: 'q', op: 'lint', input: { files: { 'a.duramen': 'x' } } }), { id: 'q', error: 'unknown_op' }],
  [JSON.stringify({ id: 'q', op: 'lint' }), { id: 'q', error: 'unknown_op' }],
  [JSON.stringify({ id: 'q', op: 'check' }), { id: 'q', error: 'bad_request' }],
  [JSON.stringify({ id: 'q', op: 'check', input: 5 }), { id: 'q', error: 'bad_request' }],
  [JSON.stringify({ id: 'q', op: 'check', input: { files, entry: null } }), { id: 'q', error: 'bad_request' }],
  [JSON.stringify({ id: 'q', op: 'check', input: { files: { 'a.duramen': A, 'x\u0000y': A } } }), { id: 'q', error: 'bad_request' }],
  [JSON.stringify({ id: 'q', op: 'judge' }), { id: 'q', error: 'bad_request' }],
  [JSON.stringify({ id: 'q', op: 'judge', input: { case: { checks: [], full: null } } }), { id: 'q', error: 'bad_request' }],
];
for (const [line, want] of errs) {
  test(`REQ-RQ-002: ${line.slice(0, 60)}`, () => {
    assert.deepEqual(handle(line), want);
  });
}
