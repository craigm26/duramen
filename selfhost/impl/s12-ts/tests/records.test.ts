import { test } from 'node:test';
import assert from 'node:assert';
import { check, diags, one, s } from './helpers.ts';

const A = s('duramen 0.1', 'spec a 1');
const FROB = 'frobnicate\n';

// REQ-RQ-001
test('RQ-001: entry names a file; other files are not read; names are reported as given', () => {
  assert.deepStrictEqual(diags({ 'a.duramen': A, 'b.duramen': FROB }, 'a.duramen'), []);
  assert.deepStrictEqual(check({ 'a.duramen': A, 'b.duramen': FROB }), {
    diagnostics: ['b.duramen:1: error P002', 'b.duramen:1: error P020'], errors: 2, warnings: 0,
  });
});

// REQ-RC-001
test('RC-001: which files make up a folder record', () => {
  assert.deepStrictEqual(diags({
    'a.duramen': A, 'notes.md': FROB, 'build/x.duramen': FROB, 'sub/build/x.duramen': FROB,
    'node_modules/x.duramen': FROB, '.hidden.duramen': FROB, 'sub/.hidden/x.duramen': FROB,
    'sub/b.duramen': 'duramen 0.1\n',
  }), []);
  assert.deepStrictEqual(diags({ 'notes.md': s('duramen 0.1', 'spec n 1'), 'a.duramen': FROB }, 'notes.md'), []);
  assert.deepStrictEqual(diags({
    'sub/a.duramen': A, 'sub/deeper/b.duramen': 'duramen 0.1\n', 'c.duramen': FROB,
  }, 'sub'), []);
  assert.deepStrictEqual(diags({ 'sub/a.duramen': A, 'sub/b.duramen': FROB }, 'sub/a.duramen'), []);
  assert.deepStrictEqual(diags({ 'build/a.duramen': A, 'build/build/b.duramen': FROB }, 'build'), []);
});

test('RC-001: a record that is missing gets P046 alone', () => {
  assert.deepStrictEqual(diags({ 'a.duramen': A }, 'missing.duramen'), ['missing.duramen:1: error P046']);
  assert.deepStrictEqual(diags({ 'a.duramen': A }, 'sub'), ['sub:1: error P046']);
  assert.deepStrictEqual(check({ 'notes.md': A }), { diagnostics: ['.:1: error P046'], errors: 1, warnings: 0 });
});

// REQ-RC-002
test('RC-002: files are read in UTF-16 order of their names', () => {
  assert.deepStrictEqual(diags({ 'b.duramen': s('duramen 0.1', 'spec b 1'), 'a.duramen': A }), ['b.duramen:2: error P044']);
  assert.deepStrictEqual(diags({ 'a.duramen': A, 'B.duramen': s('duramen 0.1', 'spec b 1') }), ['a.duramen:2: error P044']);
  assert.deepStrictEqual(diags({ 'a/z.duramen': s('duramen 0.1', 'spec z 1'), 'a.duramen': A }), ['a/z.duramen:2: error P044']);
  assert.deepStrictEqual(diags({
    '｡.duramen': s('duramen 0.1', 'spec x 1'), '\u{1f600}.duramen': s('duramen 0.1', 'spec y 1'),
  }), ['｡.duramen:2: error P044']);
});

// REQ-RC-003
test('RC-003: versions', () => {
  assert.deepStrictEqual(one('spec s 1\n'), ['s.duramen:1: error P020']);
  assert.deepStrictEqual(one(s('duramen 0.3', 'spec s 1')), ['s.duramen:1: error P023']);
  assert.deepStrictEqual(one(s('duramen 0.1', 'spec s 1', 'duramen 0.1', 'duramen 9')),
    ['s.duramen:3: error P023', 's.duramen:4: error P023']);
  assert.deepStrictEqual(one(s('duramen', 'spec s 1')), ['s.duramen:1: error P023']);
  assert.deepStrictEqual(diags({ 'a.duramen': A, 'b.duramen': 'duramen 0.2\n' }), ['.:1: error P047']);
  assert.deepStrictEqual(diags({ 'r/a.duramen': s('duramen 0.2', 'spec s 1'), 'r/b.duramen': 'duramen 0.1\n' }, 'r'),
    ['r:1: error P047']);
  assert.deepStrictEqual(diags({ 'a.duramen': s('duramen 0.2', 'spec s 1'), 'b.duramen': 'duramen 0.2\n' }), []);
  assert.deepStrictEqual(diags({ 'a.duramen': s('duramen 0.2', 'spec s 1'), 'b.duramen': 'duramen 2\n' }),
    ['b.duramen:1: error P023']);
  assert.deepStrictEqual(diags({ 'a.duramen': s('duramen 0.1 extra', 'spec s 1'), 'b.duramen': 'duramen 0.2\n' }),
    ['a.duramen:1: error P023']);
  assert.deepStrictEqual(diags({ 'a.duramen': s('duramen 0.3', 'duramen 0.2', 'spec s 1'), 'b.duramen': 'duramen 0.1\n' }),
    ['a.duramen:1: error P023', 'a.duramen:2: error P023']);
  assert.deepStrictEqual(diags({ 's.duramen': '' }), ['.:1: error P021', 's.duramen:1: error P020']);
});

// REQ-RC-004
test('RC-004: one spec, one oracle, one errors list', () => {
  assert.deepStrictEqual(diags({ 's.duramen': 'duramen 0.1\n' }), ['.:1: error P021']);
  assert.deepStrictEqual(diags({ 's.duramen': 'duramen 0.1\n' }, 's.duramen'), ['s.duramen:1: error P021']);
  assert.deepStrictEqual(diags({ 'r/s.duramen': 'duramen 0.1\n' }, 'r'), ['r:1: error P021']);
  assert.deepStrictEqual(one(s('duramen 0.1', 'spec a 1', '', 'spec b 1')), ['s.duramen:4: error P044']);
  assert.deepStrictEqual(diags({
    'a.duramen': s('duramen 0.1', 'spec s 1', 'oracle node a.mjs'), 'b.duramen': s('duramen 0.1', 'oracle node b.mjs'),
  }), ['b.duramen:2: error P044']);
  assert.deepStrictEqual(one(s('duramen 0.1', 'spec s 1', 'errors', '  e1 when x', 'errors', '  e2 when y')),
    ['s.duramen:5: error P032']);
  assert.deepStrictEqual(diags({
    'a.duramen': s('duramen 0.1', 'spec s 1', 'errors', '  e1 when x'),
    'b.duramen': s('duramen 0.1', '', 'errors', '  e2 when y'),
  }), ['b.duramen:3: error P032']);
  assert.deepStrictEqual(one(s('duramen 0.1', 'spec s 1', 'errors', 'errors')), ['s.duramen:4: error P032']);
  assert.deepStrictEqual(one(s('duramen 0.1', 'spec s 1', 'duramen 0.1', '  title "t"', 'spec s', 'oracle',
    '  source o.mjs', '    more', 'errors x', '  e if')), [
    's.duramen:3: error P023', 's.duramen:4: error P015', 's.duramen:5: error P021', 's.duramen:5: error P044',
    's.duramen:6: error P028', 's.duramen:8: error P006', 's.duramen:9: error P050', 's.duramen:10: error P019']);
  assert.deepStrictEqual(diags({
    'a.duramen': s('duramen 0.1', 'spec s 1', 'oracle', 'oracle node a.mjs'),
    'b.duramen': s('duramen 0.1', 'oracle node b.mjs'),
  }), ['a.duramen:3: error P028', 'a.duramen:4: error P044', 'b.duramen:2: error P044']);
});

// REQ-RC-005
test('RC-005: problems found while reading stop the check', () => {
  assert.deepStrictEqual(one(s('duramen 0.1', 'spec s 1', 'frobnicate', 'req A "a"', '  example nope {}')),
    ['s.duramen:3: error P002']);
});

// REQ-RC-006
test('RC-006: the order of diagnostics', () => {
  assert.deepStrictEqual(check({
    'b.duramen': s('frobnicate', 'duramen 0.1'),
    'a.duramen': 'duramen 0.1\nspec s 1\n\n\nfrobnicate\nfrobnicate\n',
  }), {
    diagnostics: ['a.duramen:5: error P002', 'a.duramen:6: error P002', 'b.duramen:1: error P002'], errors: 3, warnings: 0,
  });
  assert.deepStrictEqual(check({
    's.duramen': s('duramen 0.1', 'spec s 1', '', 'decision D-1 "one"', '  text', '    No source, and cited by nothing.', '',
      'req A "a"', '  decision D-2'),
  }), {
    diagnostics: ['s.duramen:4: warning T012', 's.duramen:4: warning T013', 's.duramen:8: error T001', 's.duramen:8: error T008'],
    errors: 2, warnings: 2,
  });
  assert.deepStrictEqual(check({
    's.duramen': s('duramen 0.1', 'spec s 1', '', 'decision D-1 "proposed"', '  source here', '  status proposed', '',
      'decision D-2 "contested"', '  source there', '  status contested', '', 'req A "a"', '  decision D-1, D-2'),
  }), {
    diagnostics: ['s.duramen:12: error T001', 's.duramen:12: error T028', 's.duramen:12: warning T028'], errors: 2, warnings: 1,
  });
});
