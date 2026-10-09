import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleLine } from '../src/service.ts';

const here = dirname(fileURLToPath(import.meta.url));
const OK = 'duramen 0.1\nspec a 1\n';

// REQ-RQ-002
test('requests that cannot be handled get exactly {id, error}', () => {
  const cases: [string, any, string][] = [
    ['{not json', null, 'bad_request'],
    ['[1, 2]', null, 'bad_request'],
    ['null', null, 'bad_request'],
    [JSON.stringify({ op: 'check', input: { files: { 'a.duramen': OK } } }), null, 'bad_request'],
    [JSON.stringify({ id: 7, op: 'check', input: { files: { 'a.duramen': OK } } }), null, 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'lint', input: { files: { 'a.duramen': 'x' } } }), 'x', 'unknown_op'],
    [JSON.stringify({ id: 'x', op: 'lint' }), 'x', 'unknown_op'],
    [JSON.stringify({ id: 'x', op: 'check' }), 'x', 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'check', input: {} }), 'x', 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'check', input: { files: {} } }), 'x', 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'check', input: { files: ['a.duramen'] } }), 'x', 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'check', input: { files: { 'a.duramen': 1 } } }), 'x', 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'check', input: { files: { '../a.duramen': OK } } }), 'x', 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'check', input: { files: { '/a.duramen': OK } } }), 'x', 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'check', input: { files: { 'x/./a.duramen': OK } } }), 'x', 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'check', input: { files: { 'x//a.duramen': OK } } }), 'x', 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'check', input: { files: { 'c:a.duramen': OK } } }), 'x', 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'check', input: { files: { 'a\u0000b': OK } } }), 'x', 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'cases', input: { files: { 'a\\b.duramen': OK } } }), 'x', 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'cases', input: { files: { a: 'x', 'a/b.duramen': OK } } }), 'x', 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'check', input: { files: { 'a.duramen': OK }, entry: '../a.duramen' } }), 'x', 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'check', input: { files: { 'a.duramen': OK }, entry: 1 } }), 'x', 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'check', input: { files: { 'a.duramen': OK }, entry: '' } }), 'x', 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'judge' }), 'x', 'bad_request'],
    [JSON.stringify({ id: 'x', op: 'judge', input: { case: { checks: [], full: null } } }), 'x', 'bad_request'],
  ];
  for (const [line, id, error] of cases) {
    assert.deepStrictEqual(handleLine(line), { id, error }, line);
  }
});

test('entry "." and a relative entry are accepted', () => {
  const r = handleLine(JSON.stringify({ id: 'x', op: 'check', input: { files: { 'a.duramen': OK }, entry: '.' } }));
  assert.deepStrictEqual(r.result, { diagnostics: [], errors: 0, warnings: 0 });
});

function run(input: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [join(here, '..', 'src', 'driver.ts')], { input, encoding: 'utf8' });
  return { status: r.status, out: r.stdout };
}

// Driver protocol
test('driver answers each non-blank line, in order, one JSON object per line', () => {
  const l1 = JSON.stringify({ id: 'a', op: 'check', input: { files: { 'a.duramen': OK } } });
  const l2 = '{oops';
  const input = [l1, '', '   \t ', l2, JSON.stringify({ id: 'c', op: 'zzz' })].join('\n') + '\n';
  const { status, out } = run(input);
  assert.strictEqual(status, 0);
  assert.ok(out.endsWith('\n'));
  assert.ok(!out.includes('\r'));
  const lines = out.slice(0, -1).split('\n').map((l) => JSON.parse(l));
  assert.deepStrictEqual(lines, [
    { id: 'a', result: { diagnostics: [], errors: 0, warnings: 0 } },
    { id: null, error: 'bad_request' },
    { id: 'c', error: 'unknown_op' },
  ]);
});

test('driver answers a last line without LF and exits 0 on empty input', () => {
  const { status, out } = run(JSON.stringify({ id: 'z', op: 'nope' }));
  assert.strictEqual(status, 0);
  assert.strictEqual(out, '{"id":"z","error":"unknown_op"}\n');
  assert.deepStrictEqual(run(''), { status: 0, out: '' });
});
