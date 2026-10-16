import { test } from 'node:test';
import { expectDiags, t } from './helpers.ts';

const A = t('duramen 0.1', 'spec a 1');
const F = 'frobnicate\n';

test('REQ-RC-001: the files of a record', async () => {
  await expectDiags(
    {
      'a.duramen': A, 'notes.md': F, 'build/x.duramen': F, 'sub/build/x.duramen': F,
      'node_modules/x.duramen': F, '.hidden.duramen': F, 'sub/.hidden/x.duramen': F,
      'sub/b.duramen': 'duramen 0.1\n',
    },
    [],
  );
  await expectDiags({ 'notes.md': t('duramen 0.1', 'spec n 1'), 'a.duramen': F }, [], 'notes.md');
  await expectDiags(
    { 'sub/a.duramen': A, 'sub/deeper/b.duramen': 'duramen 0.1\n', 'c.duramen': F }, [], 'sub');
  await expectDiags({ 'sub/a.duramen': A, 'sub/b.duramen': F }, [], 'sub/a.duramen');
  await expectDiags({ 'build/a.duramen': A, 'build/build/b.duramen': F }, [], 'build');
  await expectDiags({ 'a.duramen': A }, ['missing.duramen:1: error P046'], 'missing.duramen');
  await expectDiags({ 'a.duramen': A }, ['sub:1: error P046'], 'sub');
  await expectDiags({ 'notes.md': A }, ['.:1: error P046']);
});

test('REQ-RC-002: the order of a record’s files', async () => {
  await expectDiags({ 'b.duramen': t('duramen 0.1', 'spec b 1'), 'a.duramen': A }, ['b.duramen:2: error P044']);
  await expectDiags(
    { 'a.duramen': A, 'B.duramen': t('duramen 0.1', 'spec b 1') }, ['a.duramen:2: error P044']);
  await expectDiags(
    { 'a/z.duramen': t('duramen 0.1', 'spec z 1'), 'a.duramen': A }, ['a/z.duramen:2: error P044']);
  await expectDiags(
    { '｡.duramen': t('duramen 0.1', 'spec x 1'), '😀.duramen': t('duramen 0.1', 'spec y 1') },
    ['｡.duramen:2: error P044']);
});

test('REQ-RC-003: versions', async () => {
  const one = (s: string, e: string[]) => expectDiags({ 's.duramen': s }, e);
  await one('spec s 1\n', ['s.duramen:1: error P020']);
  await one(t('duramen 0.3', 'spec s 1'), ['s.duramen:1: error P023']);
  await one(t('duramen 0.1', 'spec s 1', 'duramen 0.1', 'duramen 9'), ['s.duramen:3: error P023', 's.duramen:4: error P023']);
  await one(t('duramen', 'spec s 1'), ['s.duramen:1: error P023']);
  await expectDiags({ 'a.duramen': A, 'b.duramen': 'duramen 0.2\n' }, ['.:1: error P047']);
  await expectDiags(
    { 'r/a.duramen': t('duramen 0.2', 'spec s 1'), 'r/b.duramen': 'duramen 0.1\n' }, ['r:1: error P047'], 'r');
  await expectDiags({ 'a.duramen': t('duramen 0.2', 'spec s 1'), 'b.duramen': 'duramen 0.2\n' }, []);
  await expectDiags({ 'a.duramen': t('duramen 0.2', 'spec s 1'), 'b.duramen': 'duramen 2\n' }, ['b.duramen:1: error P023']);
  await expectDiags(
    { 'a.duramen': t('duramen 0.1 extra', 'spec s 1'), 'b.duramen': 'duramen 0.2\n' }, ['a.duramen:1: error P023']);
  await expectDiags(
    { 'a.duramen': t('duramen 0.3', 'duramen 0.2', 'spec s 1'), 'b.duramen': 'duramen 0.1\n' },
    ['a.duramen:1: error P023', 'a.duramen:2: error P023']);
  await one('', ['.:1: error P021', 's.duramen:1: error P020']);
});

test('REQ-RC-004: one spec, one oracle, one list of errors', async () => {
  const one = (s: string, e: string[], entry?: string, name = 's.duramen') => expectDiags({ [name]: s }, e, entry);
  await one('duramen 0.1\n', ['.:1: error P021']);
  await one('duramen 0.1\n', ['s.duramen:1: error P021'], 's.duramen');
  await one('duramen 0.1\n', ['r:1: error P021'], 'r', 'r/s.duramen');
  await one(t('duramen 0.1', 'spec a 1', '', 'spec b 1'), ['s.duramen:4: error P044']);
  await expectDiags(
    { 'a.duramen': t('duramen 0.1', 'spec s 1', 'oracle node a.mjs'), 'b.duramen': t('duramen 0.1', 'oracle node b.mjs') },
    ['b.duramen:2: error P044']);
  await one(t('duramen 0.1', 'spec s 1', 'errors', '  e1 when x', 'errors', '  e2 when y'), ['s.duramen:5: error P032']);
  await expectDiags(
    { 'a.duramen': t('duramen 0.1', 'spec s 1', 'errors', '  e1 when x'), 'b.duramen': t('duramen 0.1', '', 'errors', '  e2 when y') },
    ['b.duramen:3: error P032']);
  await one(t('duramen 0.1', 'spec s 1', 'errors', 'errors'), ['s.duramen:4: error P032']);
  await one(
    t('duramen 0.1', 'spec s 1', 'duramen 0.1', '  title "t"', 'spec s', 'oracle', '  source o.mjs', '    more', 'errors x', '  e if'),
    ['s.duramen:3: error P023', 's.duramen:4: error P015', 's.duramen:5: error P021', 's.duramen:5: error P044',
      's.duramen:6: error P028', 's.duramen:8: error P006', 's.duramen:9: error P050', 's.duramen:10: error P019']);
  await expectDiags(
    { 'a.duramen': t('duramen 0.1', 'spec s 1', 'oracle', 'oracle node a.mjs'), 'b.duramen': t('duramen 0.1', 'oracle node b.mjs') },
    ['a.duramen:3: error P028', 'a.duramen:4: error P044', 'b.duramen:2: error P044']);
});

test('REQ-RC-005: problems found while reading stop the check', async () => {
  await expectDiags(
    { 's.duramen': t('duramen 0.1', 'spec s 1', 'frobnicate', 'req A "a"', '  example nope {}') },
    ['s.duramen:3: error P002']);
});

test('REQ-RC-006: the order of diagnostics', async () => {
  await expectDiags(
    { 'b.duramen': t('frobnicate', 'duramen 0.1'), 'a.duramen': 'duramen 0.1\nspec s 1\n\n\nfrobnicate\nfrobnicate\n' },
    ['a.duramen:5: error P002', 'a.duramen:6: error P002', 'b.duramen:1: error P002']);
  await expectDiags(
    { 's.duramen': t('duramen 0.1', 'spec s 1', '', 'decision D-1 "one"', '  text', '    No source, and cited by nothing.', '', 'req A "a"', '  decision D-2') },
    ['s.duramen:4: warning T012', 's.duramen:4: warning T013', 's.duramen:8: error T001', 's.duramen:8: error T008']);
  await expectDiags(
    {
      's.duramen': t('duramen 0.1', 'spec s 1', '', 'decision D-1 "proposed"', '  source here', '  status proposed', '',
        'decision D-2 "contested"', '  source there', '  status contested', '', 'req A "a"', '  decision D-1, D-2'),
    },
    ['s.duramen:12: error T001', 's.duramen:12: error T028', 's.duramen:12: warning T028']);
});
