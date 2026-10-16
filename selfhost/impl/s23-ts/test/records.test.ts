import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { call, diags, raw } from './helpers.ts';

const A = 'duramen 0.1\nspec a 1\n';

test('REQ-RQ-001 a record travels inside the request', () => {
  assert.deepStrictEqual(diags({ 'a.duramen': A, 'b.duramen': 'frobnicate\n' }, 'a.duramen'), []);
  assert.deepStrictEqual(diags({ 'a.duramen': A, 'b.duramen': 'frobnicate\n' }), [
    'b.duramen:1: error P002',
    'b.duramen:1: error P020',
  ]);
  assert.deepStrictEqual(call('check', { files: { 'a.duramen': A } }).result, { diagnostics: [], errors: 0, warnings: 0 });
});

test('REQ-RQ-002 requests that cannot be handled', () => {
  const bad = (line: string, id: unknown, error: string) => assert.deepStrictEqual(raw(line), { id, error });
  bad('{not json', null, 'bad_request');
  bad('[1, 2]', null, 'bad_request');
  bad('{"op":"check","input":{"files":{"a.duramen":"x"}}}', null, 'bad_request');
  bad('{"id": 7, "op": "check", "input": {"files": {"a.duramen": "x"}}}', null, 'bad_request');
  bad('{"id":"1","op":"lint","input":{"files":{"a.duramen":"x"}}}', '1', 'unknown_op');
  bad('{"id":"1","op":"lint"}', '1', 'unknown_op');
  bad('{"id":"1","op":"check"}', '1', 'bad_request');
  const files = (f: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ id: '1', op: 'check', input: { files: f, ...extra } });
  bad(files(undefined), '1', 'bad_request');
  bad(files({}), '1', 'bad_request');
  bad(files(['a.duramen']), '1', 'bad_request');
  bad(files({ 'a.duramen': 1 }), '1', 'bad_request');
  for (const n of ['../a.duramen', '/a.duramen', 'x/./a.duramen', 'x//a.duramen', 'c:a.duramen', 'a\\b.duramen', 'a\0b'])
    bad(files({ [n]: A }), '1', 'bad_request');
  bad(files({ a: 'x', 'a/b.duramen': A }), '1', 'bad_request');
  bad(files({ 'a.duramen': A }, { entry: '../a.duramen' }), '1', 'bad_request');
  bad(files({ 'a.duramen': A }, { entry: 1 }), '1', 'bad_request');
  bad(files({ 'a.duramen': A }, { entry: '' }), '1', 'bad_request');
  assert.deepStrictEqual(raw(files({ 'a.duramen': A }, { entry: '.' })).result.errors, 0);
  // blank lines get no response, and the driver goes on
  assert.strictEqual(raw('  \t '), null);
  assert.strictEqual(raw(''), null);
});

test('the driver process answers one line per request, in order', () => {
  const r = spawnSync('node', ['driver.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    input: '{bad\n\n{"id":"a","op":"check","input":{"files":{"s.duramen":"duramen 0.1\\nspec s 1\\n"}}}\n{"id":"b","op":"zzz"}',
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0);
  const lines = r.stdout.split('\n');
  assert.strictEqual(lines.pop(), '');
  assert.deepStrictEqual(lines.map((l) => JSON.parse(l)), [
    { id: null, error: 'bad_request' },
    { id: 'a', result: { diagnostics: [], errors: 0, warnings: 0 } },
    { id: 'b', error: 'unknown_op' },
  ]);
  assert.ok(!r.stdout.includes('\r'));
});

test('REQ-RC-001 the files of a record', () => {
  const f = {
    'a.duramen': A,
    'notes.md': 'frobnicate',
    'build/x.duramen': 'frobnicate',
    'sub/build/x.duramen': 'frobnicate',
    'node_modules/x.duramen': 'frobnicate',
    '.hidden.duramen': 'frobnicate',
    'sub/.hidden/x.duramen': 'frobnicate',
    'sub/b.duramen': 'duramen 0.1\n',
  };
  assert.deepStrictEqual(diags(f), []);
  assert.deepStrictEqual(diags({ 'notes.md': 'duramen 0.1\nspec n 1\n', 'a.duramen': 'frobnicate' }, 'notes.md'), []);
  assert.deepStrictEqual(
    diags({ 'sub/a.duramen': A, 'sub/deeper/b.duramen': 'duramen 0.1\n', 'c.duramen': 'frobnicate' }, 'sub'),
    [],
  );
  assert.deepStrictEqual(diags({ 'sub/a.duramen': A, 'sub/b.duramen': 'frobnicate' }, 'sub/a.duramen'), []);
  assert.deepStrictEqual(diags({ 'build/a.duramen': A, 'build/build/b.duramen': 'frobnicate' }, 'build'), []);
  assert.deepStrictEqual(diags({ 'a.duramen': A }, 'missing.duramen'), ['missing.duramen:1: error P046']);
  assert.deepStrictEqual(diags({ 'a.duramen': A }, 'sub'), ['sub:1: error P046']);
  assert.deepStrictEqual(call('check', { files: { 'notes.md': A } }).result, {
    diagnostics: ['.:1: error P046'],
    errors: 1,
    warnings: 0,
  });
});

test('REQ-RC-002 the order of a record\'s files', () => {
  const s = (n: string) => `duramen 0.1\nspec ${n} 1\n`;
  assert.deepStrictEqual(diags({ 'b.duramen': s('b'), 'a.duramen': s('a') }), ['b.duramen:2: error P044']);
  assert.deepStrictEqual(diags({ 'a.duramen': s('a'), 'B.duramen': s('b') }), ['a.duramen:2: error P044']);
  assert.deepStrictEqual(diags({ 'a/z.duramen': s('z'), 'a.duramen': s('a') }), ['a/z.duramen:2: error P044']);
  assert.deepStrictEqual(diags({ '｡.duramen': s('x'), '😀.duramen': s('y') }), ['｡.duramen:2: error P044']);
});

test('REQ-RC-003 versions', () => {
  assert.deepStrictEqual(diags({ 's.duramen': 'spec s 1\n' }), ['s.duramen:1: error P020']);
  assert.deepStrictEqual(diags({ 's.duramen': 'duramen 0.3\nspec s 1\n' }), ['s.duramen:1: error P023']);
  assert.deepStrictEqual(diags({ 's.duramen': 'duramen 0.1\nspec s 1\nduramen 0.1\nduramen 9\n' }), [
    's.duramen:3: error P023',
    's.duramen:4: error P023',
  ]);
  assert.deepStrictEqual(diags({ 's.duramen': 'duramen\nspec s 1\n' }), ['s.duramen:1: error P023']);
  assert.deepStrictEqual(diags({ 'a.duramen': A, 'b.duramen': 'duramen 0.2\n' }), ['.:1: error P047']);
  assert.deepStrictEqual(diags({ 'r/a.duramen': 'duramen 0.2\nspec s 1\n', 'r/b.duramen': 'duramen 0.1\n' }, 'r'), ['r:1: error P047']);
  assert.deepStrictEqual(diags({ 'a.duramen': 'duramen 0.2\nspec s 1\n', 'b.duramen': 'duramen 0.2\n' }), []);
  assert.deepStrictEqual(diags({ 'a.duramen': 'duramen 0.2\nspec s 1\n', 'b.duramen': 'duramen 2\n' }), ['b.duramen:1: error P023']);
  assert.deepStrictEqual(diags({ 'a.duramen': 'duramen 0.1 extra\nspec s 1\n', 'b.duramen': 'duramen 0.2\n' }), ['a.duramen:1: error P023']);
  assert.deepStrictEqual(
    diags({ 'a.duramen': 'duramen 0.3\nduramen 0.2\nspec s 1\n', 'b.duramen': 'duramen 0.1\n' }),
    ['a.duramen:1: error P023', 'a.duramen:2: error P023'],
  );
  assert.deepStrictEqual(diags({ 's.duramen': '' }), ['.:1: error P021', 's.duramen:1: error P020']);
});

test('REQ-RC-004 one spec, one oracle, one list of errors', () => {
  assert.deepStrictEqual(diags({ 's.duramen': 'duramen 0.1\n' }), ['.:1: error P021']);
  assert.deepStrictEqual(diags({ 's.duramen': 'duramen 0.1\n' }, 's.duramen'), ['s.duramen:1: error P021']);
  assert.deepStrictEqual(diags({ 'r/s.duramen': 'duramen 0.1\n' }, 'r'), ['r:1: error P021']);
  assert.deepStrictEqual(diags({ 's.duramen': 'duramen 0.1\nspec a 1\n\nspec b 1\n' }), ['s.duramen:4: error P044']);
  assert.deepStrictEqual(
    diags({ 'a.duramen': 'duramen 0.1\nspec s 1\noracle node a.mjs\n', 'b.duramen': 'duramen 0.1\noracle node b.mjs\n' }),
    ['b.duramen:2: error P044'],
  );
  assert.deepStrictEqual(diags({ 's.duramen': 'duramen 0.1\nspec s 1\nerrors\n  e1 when x\nerrors\n  e2 when y\n' }), ['s.duramen:5: error P032']);
  assert.deepStrictEqual(
    diags({ 'a.duramen': 'duramen 0.1\nspec s 1\nerrors\n  e1 when x\n', 'b.duramen': 'duramen 0.1\n\nerrors\n  e2 when y\n' }),
    ['b.duramen:3: error P032'],
  );
  assert.deepStrictEqual(diags({ 's.duramen': 'duramen 0.1\nspec s 1\nerrors\nerrors\n' }), ['s.duramen:4: error P032']);
  assert.deepStrictEqual(
    diags({ 's.duramen': 'duramen 0.1\nspec s 1\nduramen 0.1\n  title "t"\nspec s\noracle\n  source o.mjs\n    more\nerrors x\n  e if\n' }),
    [
      's.duramen:3: error P023',
      's.duramen:4: error P015',
      's.duramen:5: error P021',
      's.duramen:5: error P044',
      's.duramen:6: error P028',
      's.duramen:8: error P006',
      's.duramen:9: error P050',
      's.duramen:10: error P019',
    ],
  );
  assert.deepStrictEqual(
    diags({ 'a.duramen': 'duramen 0.1\nspec s 1\noracle\noracle node a.mjs\n', 'b.duramen': 'duramen 0.1\noracle node b.mjs\n' }),
    ['a.duramen:3: error P028', 'a.duramen:4: error P044', 'b.duramen:2: error P044'],
  );
});

test('REQ-RC-005 problems found while reading stop the check', () => {
  assert.deepStrictEqual(diags({ 's.duramen': 'duramen 0.1\nspec s 1\nfrobnicate\nreq A "a"\n  example nope {}\n' }), ['s.duramen:3: error P002']);
});

test('REQ-RC-006 the order of diagnostics', () => {
  const r = call('check', {
    files: { 'b.duramen': 'frobnicate\nduramen 0.1\n', 'a.duramen': 'duramen 0.1\nspec s 1\n\n\nfrobnicate\nfrobnicate\n' },
  }).result;
  assert.deepStrictEqual(r, {
    diagnostics: ['a.duramen:5: error P002', 'a.duramen:6: error P002', 'b.duramen:1: error P002'],
    errors: 3,
    warnings: 0,
  });
  const r2 = call('check', {
    files: { 's.duramen': 'duramen 0.1\nspec s 1\n\ndecision D-1 "one"\n  text\n    No source, and cited by nothing.\n\nreq A "a"\n  decision D-2\n' },
  }).result;
  assert.deepStrictEqual(r2, {
    diagnostics: ['s.duramen:4: warning T012', 's.duramen:4: warning T013', 's.duramen:8: error T001', 's.duramen:8: error T008'],
    errors: 2,
    warnings: 2,
  });
  const r3 = call('check', {
    files: {
      's.duramen':
        'duramen 0.1\nspec s 1\n\ndecision D-1 "proposed"\n  source here\n  status proposed\n\ndecision D-2 "contested"\n  source there\n  status contested\n\nreq A "a"\n  decision D-1, D-2\n',
    },
  }).result;
  assert.deepStrictEqual(r3, {
    diagnostics: ['s.duramen:12: error T001', 's.duramen:12: error T028', 's.duramen:12: warning T028'],
    errors: 2,
    warnings: 1,
  });
});
