import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, check, diags, one, t } from './helper.ts';

const A = t`
duramen 0.1
spec a 1
`;
const FROB = 'frobnicate\n';

test('REQ-RQ-001 entry file reads that file alone', () => {
  assert.deepEqual(check({ 'a.duramen': A, 'b.duramen': FROB }, 'a.duramen').result, {
    diagnostics: [],
    errors: 0,
    warnings: 0,
  });
});

test('REQ-RQ-001 default entry reads the folder holding all files', () => {
  assert.deepEqual(check({ 'a.duramen': A, 'b.duramen': FROB }).result, {
    diagnostics: ['b.duramen:1: error P002', 'b.duramen:1: error P020'],
    errors: 2,
    warnings: 0,
  });
});

test('REQ-RQ-002 requests that cannot be handled', () => {
  const line = (s: string) => JSON.parse(callLine(s));
  assert.deepEqual(line('{not json'), { id: null, error: 'bad_request' });
  assert.deepEqual(line('[1, 2]'), { id: null, error: 'bad_request' });
  assert.deepEqual(line('{"op":"check","input":{}}'), { id: null, error: 'bad_request' });
  assert.deepEqual(line('{"id": 7, "op": "check", "input": {}}'), { id: null, error: 'bad_request' });
  assert.deepEqual(line('{"id":"1","op":"lint","input":{"files":{"a.duramen":"x"}}}'), { id: '1', error: 'unknown_op' });
  assert.deepEqual(line('{"id":"1","op":"lint"}'), { id: '1', error: 'unknown_op' });
  assert.deepEqual(line('{"id":"1","op":"check"}'), { id: '1', error: 'bad_request' });
});

import { handleLine } from '../src/handle.ts';
function callLine(s: string): string {
  return handleLine(s) as string;
}

test('REQ-RQ-002 bad inputs', () => {
  const bad = (files: unknown, extra: Record<string, unknown> = {}) =>
    assert.equal(call('check', { files, ...extra }).error, 'bad_request', JSON.stringify(files) + JSON.stringify(extra));
  bad(undefined);
  bad({});
  bad(['a.duramen']);
  bad({ 'a.duramen': 1 });
  bad({ '../a.duramen': A });
  bad({ '/a.duramen': A });
  bad({ 'x/./a.duramen': A });
  bad({ 'x//a.duramen': A });
  bad({ 'c:a.duramen': A });
  bad({ 'a\\b.duramen': A });
  bad({ 'a\u0000b': A });
  bad({ a: 'x', 'a/b.duramen': A });
  bad({ 'a.duramen': A }, { entry: '../a.duramen' });
  bad({ 'a.duramen': A }, { entry: 1 });
  bad({ 'a.duramen': A }, { entry: '' });
  assert.equal(call('cases', { files: { 'a\\b.duramen': A } }).error, 'bad_request');
  assert.equal(call('check', { files: { 'a.duramen': A }, entry: '.' }).error, undefined);
});

test('REQ-RC-001 files of a record', () => {
  assert.deepEqual(
    diags({
      'a.duramen': A,
      'notes.md': FROB,
      'build/x.duramen': FROB,
      'sub/build/x.duramen': FROB,
      'node_modules/x.duramen': FROB,
      '.hidden.duramen': FROB,
      'sub/.hidden/x.duramen': FROB,
      'sub/b.duramen': 'duramen 0.1\n',
    }),
    [],
  );
  assert.deepEqual(diags({ 'notes.md': A, 'a.duramen': FROB }, 'notes.md'), []);
  assert.deepEqual(
    diags({ 'sub/a.duramen': A, 'sub/deeper/b.duramen': 'duramen 0.1\n', 'c.duramen': FROB }, 'sub'),
    [],
  );
  assert.deepEqual(diags({ 'sub/a.duramen': A, 'sub/b.duramen': FROB }, 'sub/a.duramen'), []);
  assert.deepEqual(diags({ 'build/a.duramen': A, 'build/build/b.duramen': FROB }, 'build'), []);
  assert.deepEqual(diags({ 'a.duramen': A }, 'missing.duramen'), ['missing.duramen:1: error P046']);
  assert.deepEqual(diags({ 'a.duramen': A }, 'sub'), ['sub:1: error P046']);
  assert.deepEqual(check({ 'notes.md': A }).result, { diagnostics: ['.:1: error P046'], errors: 1, warnings: 0 });
});

test('REQ-RC-002 order of files', () => {
  assert.deepEqual(diags({ 'b.duramen': 'duramen 0.1\nspec b 1\n', 'a.duramen': A }), ['b.duramen:2: error P044']);
  assert.deepEqual(diags({ 'a.duramen': A, 'B.duramen': 'duramen 0.1\nspec b 1\n' }), ['a.duramen:2: error P044']);
  assert.deepEqual(diags({ 'a/z.duramen': 'duramen 0.1\nspec z 1\n', 'a.duramen': A }), ['a/z.duramen:2: error P044']);
  assert.deepEqual(
    diags({ '｡.duramen': 'duramen 0.1\nspec x 1\n', '😀.duramen': 'duramen 0.1\nspec y 1\n' }),
    ['｡.duramen:2: error P044'],
  );
});

test('REQ-RC-003 versions', () => {
  assert.deepEqual(one('spec s 1\n'), ['s.duramen:1: error P020']);
  assert.deepEqual(one('duramen 0.3\nspec s 1\n'), ['s.duramen:1: error P023']);
  assert.deepEqual(one('duramen 0.1\nspec s 1\nduramen 0.1\nduramen 9\n'), [
    's.duramen:3: error P023',
    's.duramen:4: error P023',
  ]);
  assert.deepEqual(one('duramen\nspec s 1\n'), ['s.duramen:1: error P023']);
  assert.deepEqual(diags({ 'a.duramen': 'duramen 0.1\nspec s 1\n', 'b.duramen': 'duramen 0.2\n' }), ['.:1: error P047']);
  assert.deepEqual(diags({ 'r/a.duramen': 'duramen 0.2\nspec s 1\n', 'r/b.duramen': 'duramen 0.1\n' }, 'r'), ['r:1: error P047']);
  assert.deepEqual(diags({ 'a.duramen': 'duramen 0.2\nspec s 1\n', 'b.duramen': 'duramen 0.2\n' }), []);
  assert.deepEqual(diags({ 'a.duramen': 'duramen 0.2\nspec s 1\n', 'b.duramen': 'duramen 2\n' }), ['b.duramen:1: error P023']);
  assert.deepEqual(diags({ 'a.duramen': 'duramen 0.1 extra\nspec s 1\n', 'b.duramen': 'duramen 0.2\n' }), [
    'a.duramen:1: error P023',
  ]);
  assert.deepEqual(
    diags({ 'a.duramen': 'duramen 0.3\nduramen 0.2\nspec s 1\n', 'b.duramen': 'duramen 0.1\n' }),
    ['a.duramen:1: error P023', 'a.duramen:2: error P023'],
  );
  assert.deepEqual(diags({ 's.duramen': '' }), ['.:1: error P021', 's.duramen:1: error P020']);
});

test('REQ-RC-004 one spec, one oracle, one errors', () => {
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.1\n' }), ['.:1: error P021']);
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.1\n' }, 's.duramen'), ['s.duramen:1: error P021']);
  assert.deepEqual(diags({ 'r/s.duramen': 'duramen 0.1\n' }, 'r'), ['r:1: error P021']);
  assert.deepEqual(one('duramen 0.1\nspec a 1\n\nspec b 1\n'), ['s.duramen:4: error P044']);
  assert.deepEqual(
    diags({
      'a.duramen': 'duramen 0.1\nspec s 1\noracle node a.mjs\n',
      'b.duramen': 'duramen 0.1\noracle node b.mjs\n',
    }),
    ['b.duramen:2: error P044'],
  );
  assert.deepEqual(one('duramen 0.1\nspec s 1\nerrors\n  e1 when x\nerrors\n  e2 when y\n'), ['s.duramen:5: error P032']);
  assert.deepEqual(
    diags({
      'a.duramen': 'duramen 0.1\nspec s 1\nerrors\n  e1 when x\n',
      'b.duramen': 'duramen 0.1\n\nerrors\n  e2 when y\n',
    }),
    ['b.duramen:3: error P032'],
  );
  assert.deepEqual(one('duramen 0.1\nspec s 1\nerrors\nerrors\n'), ['s.duramen:4: error P032']);
  assert.deepEqual(
    one(t`
duramen 0.1
spec s 1
duramen 0.1
  title "t"
spec s
oracle
  source o.mjs
    more
errors x
  e if
`),
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
  assert.deepEqual(
    diags({
      'a.duramen': 'duramen 0.1\nspec s 1\noracle\noracle node a.mjs\n',
      'b.duramen': 'duramen 0.1\noracle node b.mjs\n',
    }),
    ['a.duramen:3: error P028', 'a.duramen:4: error P044', 'b.duramen:2: error P044'],
  );
});

test('REQ-RC-005 problems found while reading stop the check', () => {
  assert.deepEqual(one('duramen 0.1\nspec s 1\nfrobnicate\nreq A "a"\n  example nope {}\n'), ['s.duramen:3: error P002']);
});

test('REQ-RC-006 order of diagnostics', () => {
  assert.deepEqual(
    check({
      'b.duramen': 'frobnicate\nduramen 0.1\n',
      'a.duramen': 'duramen 0.1\nspec s 1\n\n\nfrobnicate\nfrobnicate\n',
    }).result,
    {
      diagnostics: ['a.duramen:5: error P002', 'a.duramen:6: error P002', 'b.duramen:1: error P002'],
      errors: 3,
      warnings: 0,
    },
  );
  assert.deepEqual(
    check({
      's.duramen': t`
duramen 0.1
spec s 1

decision D-1 "one"
  text
    No source, and cited by nothing.

req A "a"
  decision D-2
`,
    }).result,
    {
      diagnostics: ['s.duramen:4: warning T012', 's.duramen:4: warning T013', 's.duramen:8: error T001', 's.duramen:8: error T008'],
      errors: 2,
      warnings: 2,
    },
  );
  assert.deepEqual(
    check({
      's.duramen': t`
duramen 0.1
spec s 1

decision D-1 "proposed"
  source here
  status proposed

decision D-2 "contested"
  source there
  status contested

req A "a"
  decision D-1, D-2
`,
    }).result,
    {
      diagnostics: ['s.duramen:12: error T001', 's.duramen:12: error T028', 's.duramen:12: warning T028'],
      errors: 2,
      warnings: 1,
    },
  );
});
