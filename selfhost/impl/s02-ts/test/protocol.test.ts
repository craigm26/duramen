import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { handleLine } from '../src/protocol.ts';
import { check, rec } from './helpers.ts';

const OK = { 'a.duramen': 'duramen 0.1\nspec a 1\n' };

function err(line: string): unknown {
  return JSON.parse(handleLine(line)!);
}

// REQ-RQ-002
test('REQ-RQ-002: requests that cannot be handled', () => {
  const bad = (o: unknown) => ({ id: 'x', op: 'check', input: o });
  const cases: [string, unknown][] = [
    ['{not json', { id: null, error: 'bad_request' }],
    ['[1, 2]', { id: null, error: 'bad_request' }],
    [JSON.stringify({ op: 'check', input: { files: OK } }), { id: null, error: 'bad_request' }],
    [JSON.stringify({ id: 7, op: 'check', input: { files: OK } }), { id: null, error: 'bad_request' }],
    [JSON.stringify({ id: 'x', op: 'lint', input: { files: { 'a.duramen': 'x' } } }), { id: 'x', error: 'unknown_op' }],
    [JSON.stringify({ id: 'x', op: 'lint' }), { id: 'x', error: 'unknown_op' }],
    [JSON.stringify({ id: 'x', op: 'check' }), { id: 'x', error: 'bad_request' }],
    [JSON.stringify(bad({})), { id: 'x', error: 'bad_request' }],
    [JSON.stringify(bad({ files: {} })), { id: 'x', error: 'bad_request' }],
    [JSON.stringify(bad({ files: ['a.duramen'] })), { id: 'x', error: 'bad_request' }],
    [JSON.stringify(bad({ files: { 'a.duramen': 1 } })), { id: 'x', error: 'bad_request' }],
    [JSON.stringify(bad({ files: { '../a.duramen': 'x' } })), { id: 'x', error: 'bad_request' }],
    [JSON.stringify(bad({ files: { '/a.duramen': 'x' } })), { id: 'x', error: 'bad_request' }],
    [JSON.stringify(bad({ files: { 'x/./a.duramen': 'x' } })), { id: 'x', error: 'bad_request' }],
    [JSON.stringify(bad({ files: { 'x//a.duramen': 'x' } })), { id: 'x', error: 'bad_request' }],
    [JSON.stringify(bad({ files: { 'c:a.duramen': 'x' } })), { id: 'x', error: 'bad_request' }],
    [JSON.stringify({ id: 'x', op: 'cases', input: { files: { 'a\\b.duramen': 'x' } } }), { id: 'x', error: 'bad_request' }],
    [JSON.stringify({ id: 'x', op: 'cases', input: { files: { a: 'x', 'a/b.duramen': 'x' } } }), { id: 'x', error: 'bad_request' }],
    [JSON.stringify(bad({ files: OK, entry: '../a.duramen' })), { id: 'x', error: 'bad_request' }],
    [JSON.stringify(bad({ files: OK, entry: 1 })), { id: 'x', error: 'bad_request' }],
    [JSON.stringify(bad({ files: OK, entry: '' })), { id: 'x', error: 'bad_request' }],
    [JSON.stringify(bad({ files: { 'a\0b': 'x' } })), { id: 'x', error: 'bad_request' }],
  ];
  for (const [line, want] of cases) assert.deepEqual(err(line), want, line);
});

test('driver protocol: blank lines get no response, one line per response, exit 0', () => {
  const lines = [
    JSON.stringify({ id: '1', op: 'check', input: { files: OK } }),
    '   \t',
    '',
    '{oops',
    JSON.stringify({ id: '2', op: 'check', input: { files: { 'a.duramen': 'é ' } } }),
  ];
  const r = spawnSync('node', ['driver.ts'], { input: lines.join('\n') + '\n', encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = r.stdout.split('\n');
  assert.equal(out.pop(), '');
  assert.equal(out.length, 3);
  assert.equal(r.stdout.includes('\r'), false);
  assert.deepEqual(JSON.parse(out[0]), { id: '1', result: { diagnostics: [], errors: 0, warnings: 0 } });
  assert.deepEqual(JSON.parse(out[1]), { id: null, error: 'bad_request' });
  assert.equal(JSON.parse(out[2]).id, '2');
});

// REQ-RQ-001
test('REQ-RQ-001: names are written as given; entry names the record', () => {
  assert.deepEqual(check({ ...OK, 'b.duramen': 'frobnicate\n' }, 'a.duramen'), []);
  assert.deepEqual(check({ ...OK, 'b.duramen': 'frobnicate\n' }), ['b.duramen:1: error P002', 'b.duramen:1: error P020']);
});

// REQ-RC-001
test('REQ-RC-001: the files of a record', () => {
  const junk = 'frobnicate\n';
  assert.deepEqual(check({
    'a.duramen': 'duramen 0.1\nspec a 1\n', 'notes.md': junk, 'build/x.duramen': junk, 'sub/build/x.duramen': junk,
    'node_modules/x.duramen': junk, '.hidden.duramen': junk, 'sub/.hidden/x.duramen': junk, 'sub/b.duramen': 'duramen 0.1\n',
  }), []);
  assert.deepEqual(check({ 'notes.md': 'duramen 0.1\nspec n 1\n', 'a.duramen': junk }, 'notes.md'), []);
  assert.deepEqual(check({ 'sub/a.duramen': 'duramen 0.1\nspec a 1\n', 'sub/deeper/b.duramen': 'duramen 0.1\n', 'c.duramen': junk }, 'sub'), []);
  assert.deepEqual(check({ 'sub/a.duramen': 'duramen 0.1\nspec a 1\n', 'sub/b.duramen': junk }, 'sub/a.duramen'), []);
  assert.deepEqual(check({ 'build/a.duramen': 'duramen 0.1\nspec a 1\n', 'build/build/b.duramen': junk }, 'build'), []);
  assert.deepEqual(check(OK, 'missing.duramen'), ['missing.duramen:1: error P046']);
  assert.deepEqual(check(OK, 'sub'), ['sub:1: error P046']);
  assert.deepEqual(check({ 'notes.md': 'x' }), ['.:1: error P046']);
});

// REQ-RC-002
test('REQ-RC-002: order of files', () => {
  const f = (n: string) => `duramen 0.1\nspec ${n} 1\n`;
  assert.deepEqual(check({ 'b.duramen': f('b'), 'a.duramen': f('a') }), ['b.duramen:2: error P044']);
  assert.deepEqual(check({ 'a.duramen': f('a'), 'B.duramen': f('b') }), ['a.duramen:2: error P044']);
  assert.deepEqual(check({ 'a/z.duramen': f('z'), 'a.duramen': f('a') }), ['a/z.duramen:2: error P044']);
  assert.deepEqual(check({ '｡.duramen': f('x'), '😀.duramen': f('y') }), ['｡.duramen:2: error P044']);
});

// REQ-RC-003
test('REQ-RC-003: versions', () => {
  assert.deepEqual(check({ 's.duramen': 'spec s 1\n' }), ['s.duramen:1: error P020']);
  assert.deepEqual(check({ 's.duramen': 'duramen 0.3\nspec s 1\n' }), ['s.duramen:1: error P023']);
  assert.deepEqual(check({ 's.duramen': 'duramen 0.1\nspec s 1\nduramen 0.1\n' }), ['s.duramen:3: error P023']);
  assert.deepEqual(check({ 's.duramen': 'duramen\nspec s 1\n' }), ['s.duramen:1: error P023']);
  assert.deepEqual(check({ 'a.duramen': 'duramen 0.1\nspec s 1\n', 'b.duramen': 'duramen 0.2\n' }), ['.:1: error P047']);
  assert.deepEqual(check({ 'r/a.duramen': 'duramen 0.2\nspec s 1\n', 'r/b.duramen': 'duramen 0.1\n' }, 'r'), ['r:1: error P047']);
  assert.deepEqual(check({ 'a.duramen': 'duramen 0.2\nspec s 1\n', 'b.duramen': 'duramen 0.2\n' }), []);
  assert.deepEqual(check({ 'a.duramen': 'duramen 0.2\nspec s 1\n', 'b.duramen': 'duramen 2\n' }), ['b.duramen:1: error P023']);
  assert.deepEqual(check({ 's.duramen': '' }), ['.:1: error P021', 's.duramen:1: error P020']);
});

// REQ-RC-004
test('REQ-RC-004: one spec, one oracle, one errors', () => {
  assert.deepEqual(check({ 's.duramen': 'duramen 0.1\n' }), ['.:1: error P021']);
  assert.deepEqual(check({ 's.duramen': 'duramen 0.1\n' }, 's.duramen'), ['s.duramen:1: error P021']);
  assert.deepEqual(check({ 'r/s.duramen': 'duramen 0.1\n' }, 'r'), ['r:1: error P021']);
  assert.deepEqual(check({ 's.duramen': 'duramen 0.1\nspec a 1\n\nspec b 1\n' }), ['s.duramen:4: error P044']);
  assert.deepEqual(check({
    'a.duramen': 'duramen 0.1\nspec s 1\noracle node a.mjs\n', 'b.duramen': 'duramen 0.1\noracle node b.mjs\n',
  }), ['b.duramen:2: error P044']);
  assert.deepEqual(check({ 's.duramen': 'duramen 0.1\nspec s 1\nerrors\n  e1 when x\nerrors\n  e2 when y\n' }), ['s.duramen:5: error P032']);
  assert.deepEqual(check({
    'a.duramen': 'duramen 0.1\nspec s 1\nerrors\n  e1 when x\n', 'b.duramen': 'duramen 0.1\n\nerrors\n  e2 when y\n',
  }), ['b.duramen:3: error P032']);
  assert.deepEqual(check({ 's.duramen': 'duramen 0.1\nspec s 1\nerrors\nerrors\n' }), ['s.duramen:4: error P032']);
});

// REQ-RC-005, REQ-RC-006
test('REQ-RC-005/006: reading errors stop the check; diagnostics are ordered', () => {
  assert.deepEqual(check({ 's.duramen': 'duramen 0.1\nspec s 1\nfrobnicate\nreq A "a"\n  example nope {}\n' }), ['s.duramen:3: error P002']);
  const r = JSON.parse(handleLine(JSON.stringify({
    id: 'x', op: 'check', input: { files: { 'b.duramen': 'frobnicate\nduramen 0.1\n', 'a.duramen': 'duramen 0.1\nspec s 1\n\n\nfrobnicate\nfrobnicate\n' } },
  }))!);
  assert.deepEqual(r.result, {
    diagnostics: ['a.duramen:5: error P002', 'a.duramen:6: error P002', 'b.duramen:1: error P002'], errors: 3, warnings: 0,
  });
  const r2 = JSON.parse(handleLine(JSON.stringify({
    id: 'x', op: 'check', input: { files: rec('decision D-1 "one"\n  text\n    No source, and cited by nothing.\n\nreq A "a"\n  decision D-2\n') },
  }))!);
  assert.deepEqual(r2.result, {
    diagnostics: ['s.duramen:3: warning T012', 's.duramen:3: warning T013', 's.duramen:7: error T001', 's.duramen:7: error T008'],
    errors: 2, warnings: 2,
  });
  assert.deepEqual(check(rec('decision D-1 "proposed"\n  source here\n  status proposed\n\ndecision D-2 "contested"\n  source there\n  status contested\n\nreq A "a"\n  decision D-1, D-2\n')), [
    's.duramen:11: error T001', 's.duramen:11: error T028', 's.duramen:11: warning T028',
  ]);
});
