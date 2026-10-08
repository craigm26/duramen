// `duramen serve`, and duramen checked against its own specification (spec/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { handle, serve } from '../src/serve.mjs';
import { checkPath, ROOT } from './helpers.mjs';

const rec = { 'a.duramen': 'duramen 0.1\nspec a 1\n' };

test('serve: requests that cannot be handled', async () => {
  assert.deepEqual(await handle(null), { id: null, error: 'bad_request' });
  assert.deepEqual(await handle({ id: 1, op: 'check' }), { id: null, error: 'bad_request' });
  assert.deepEqual(await handle({ id: 'x', op: 'lint' }), { id: 'x', error: 'unknown_op' });
  const bad = [undefined, [], {}, { files: {} }, { files: [] }, { files: { 'a.duramen': 1 } }, { files: { '../a': 'x' } }, { files: { '/a': 'x' } },
    { files: { 'a//b': 'x' } }, { files: { 'c:a': 'x' } }, { files: { 'a\\b': 'x' } }, { files: { a: 'x', 'a/b.duramen': 'y' } }, { files: rec, entry: 1 }, { files: rec, entry: '..' }, { files: rec, entry: '' }];
  for (const input of bad) assert.deepEqual(await handle({ id: 'x', op: 'check', input }), { id: 'x', error: 'bad_request' }, JSON.stringify(input));
});

test('serve: check and cases on a record carried in the request', async () => {
  const r = await handle({ id: '1', op: 'check', input: { files: { ...rec, 'b.duramen': 'frobnicate\n' } } });
  assert.deepEqual(r, { id: '1', result: { diagnostics: ['b.duramen:1: error P002', 'b.duramen:1: error P020'], errors: 2, warnings: 0 } });
  assert.deepEqual(await handle({ id: '2', op: 'check', input: { files: { ...rec, 'b.duramen': 'frobnicate\n' }, entry: 'a.duramen' } }), { id: '2', result: { diagnostics: [], errors: 0, warnings: 0 } });
  assert.deepEqual(await handle({ id: '3', op: 'cases', input: { files: rec } }), { id: '3', result: { errors: 0, cases: [] } });
  assert.deepEqual(await handle({ id: '4', op: 'check', input: { files: { 'notes.md': 'x' } } }), { id: '4', result: { diagnostics: ['.:1: error P046'], errors: 1, warnings: 0 } });
});

test('serve: one response per non-blank line, in order', async () => {
  const lines = ['', '{not json', '  \t', JSON.stringify({ id: 'a', op: 'check', input: { files: rec } }), '[1]'];
  let out = '';
  await serve(Readable.from([lines.join('\n') + '\n']), (s) => { out += s; });
  assert.deepEqual(out.trimEnd().split('\n').map((l) => JSON.parse(l)), [
    { id: null, error: 'bad_request' },
    { id: 'a', result: { diagnostics: [], errors: 0, warnings: 0 } },
    { id: null, error: 'bad_request' },
  ]);
});

test('self-hosting: duramen agrees with every example in its own specification', async () => {
  const { ds, ast } = await checkPath(join(ROOT, 'spec'));
  assert.deepEqual(ds.filter((d) => d.level !== 'info').map((d) => `${d.file}:${d.line} ${d.code} ${d.message}`), []);
  const reqs = ast.items.filter((i) => i.type === 'req');
  assert.ok(reqs.length >= 40 && reqs.reduce((n, r) => n + r.examples.length, 0) >= 130);
});
