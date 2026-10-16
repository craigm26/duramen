import { test } from 'node:test';
import { ECHO, expectDiags, t } from './helpers.ts';

const H = ['duramen 0.1', 'spec s 1'];
const HE = [...H, 'oracle node echo.mjs', 'op f', '  input x? json'];
const hs = (...lines: string[]) => t(...H, ...lines);
const he = (...lines: string[]) => t(...HE, ...lines);
const one = (s: string, expected: string[]) => expectDiags({ 's.duramen': s, 'echo.mjs': ECHO }, expected);

test('REQ-CK-001: every requirement has an example', async () => {
  await one(hs('req A "a"', '  text', '    It MUST work.'), ['s.duramen:3: error T001']);
  await one(hs('req A "a"', '  table f', '    | x |', '    |---|'), ['s.duramen:4: error P013']);
});

test('REQ-CK-002: IDs are unique', async () => {
  await one(
    he('req A "a"', '  example f {}', 'req A "again"', '  example f {}', 'open A "an open item may share a requirement\'s ID"',
      '  text', '    Open.', 'open B "b"', '  text', '    Open.', 'open B "b again"', '  text', '    Open.', 'decision D-1 "d"',
      '  source s', 'decision D-1 "d again"', '  source s', 'req C "c"', '  decision D-1', '  example f {}'),
    ['s.duramen:8: error T007', 's.duramen:16: error T007', 's.duramen:21: error T007']);
  await expectDiags(
    {
      'a.duramen': he('req A "a"', '  example f {}'),
      'b.duramen': t('duramen 0.1', 'req A "a"', '  example f {}', 'op f', '  input y? json'),
      'echo.mjs': ECHO,
    },
    ['b.duramen:2: error T007', 'b.duramen:4: error T007']);
  await one(
    he('req A "a"', '  decision REQ-A, OPEN-B', '  example f {}', 'decision REQ-A "named like a requirement"', '  source s',
      'decision OPEN-B "named like an open item"', '  source s', 'open B "b"', '  text', '    Open.', 'req A "a third time"',
      '  example f {}', 'req A "and a third"', '  example f {}'),
    ['s.duramen:16: error T007', 's.duramen:18: error T007']);
});

test('REQ-CK-003: cited decisions are declared', async () => {
  await one(
    he('decision D-1 "d"', '  source s', 'req A "a"', '  decision D-1 D-2, D-3', '  decision D-2', '  example f {}'),
    ['s.duramen:8: error T008', 's.duramen:8: error T008']);
});

test('REQ-CK-004: examples of declared operations', async () => {
  await one(
    t('duramen 0.1', 'spec s 1', 'oracle node echo.mjs', 'op f', '  input a number, b? number', 'errors', '  e when never', 'req A "a"',
      '  example g {"a": 1}', '  example f {"b": 1}', '  example f {"a": 1, "c": 2}', '  example f',
      '  example g {"answer": {"error": "e"}}', '    expect error = "e"', '  example raw \'{"id": "A#6", "op": "g"}\'',
      '  table f', '    | b | c |', '    | 1 | 2 |', '  example g {}', '    expect error.code = "e"'),
    ['s.duramen:9: error T009', 's.duramen:10: error T010', 's.duramen:11: warning T011', 's.duramen:12: error T010',
      's.duramen:18: error T010', 's.duramen:18: warning T011', 's.duramen:19: error T009']);
});

test('REQ-CK-005: expected errors are declared', async () => {
  await one(
    he('errors', '  e when never', 'req A "a"', '  example f {"answer": {"error": "e"}}', '    expect error = "e"',
      '  example f {"answer": {"error": "nope"}}', '    expect error = "nope"',
      '  example raw \'{"id": "r", "op": "f", "input": {"answer": {"error": "other"}}}\'', '    expect error = "other"',
      '  example f {"answer": {"error": "e"}}', '    expect error = ?').replace('input x? json', 'input answer? json'),
    ['s.duramen:12: error T023', 's.duramen:14: error T023']);
  await one(
    he('errors', '  e when never', 'req A "a"', '  example f {"answer": {"error": 1}}', '    expect error ≈ 1 ± 0', '  table f',
      '    | answer           | error ± 1 |', '    | {"error": 2}     | 2         |', '    | {"error": "e"}   | ?         |')
      .replace('input x? json', 'input answer? json'),
    ['s.duramen:10: error T023', 's.duramen:13: error T023']);
});

test('REQ-CK-006: obligations live in requirements', async () => {
  await one(
    hs('  text', '    The program MUST work.', 'op f', '  result what it MUST return', 'errors', '  e when it SHALL fail',
      'section S "It MUST be titled"', '  text', '    REQUIRED reading.', 'note', '  text',
      '    This note says `MUST`, "SHALL" and “REQUIRED”, MUSTARD and must.', 'decision D-1 "d"', '  source s', '  text',
      '    Fine.', '  rejected "Another MUST."', 'open O "o"', '  text', '    It MUST NOT be.'),
    ['s.duramen:2: error T004', 's.duramen:5: error T004', 's.duramen:8: error T004', 's.duramen:9: error T004',
      's.duramen:15: error T004', 's.duramen:15: warning T012', 's.duramen:20: warning T014']);
  await one(
    hs('decision D-1 "d"', '  source s', '  text', '    It MUST.', '  rejected "It SHALL."', '  rejected "It is REQUIRED."'),
    ['s.duramen:3: error T004', 's.duramen:3: error T004', 's.duramen:3: error T004', 's.duramen:3: warning T012']);
  await one(
    hs('errors', '  e when the "MUST', '    hold" rule fails', '  f when the "MUST hold" rule fails', 'note', '  text', '    A MUST-have.',
      'section S "s"', '  text', '    MUSTé'),
    ['s.duramen:4: error T004', 's.duramen:7: error T004', 's.duramen:10: error T004']);
  await one(hs('section T "t"', '  text', '    It ``MUST`` be, and it `MUST` not.'), ['s.duramen:3: error T004']);
  await one(
    hs('note', '  text', '    x`a`MUST', 'note', '  text', '    MU`a`ST, and "MU"ST', 'note', '  text', '    A"q"SHALL',
      'decision D-1 "d"', '  source s', '  text', '    Fine.', '  rejected "\\"It\\nMUST\\" be"'),
    ['s.duramen:3: error T004', 's.duramen:9: error T004', 's.duramen:12: error T004', 's.duramen:12: warning T012']);
  await one(
    hs('decision D-1 "d"', '  source s', '  text', '    Fine.', '  rejected "\\"It\\rMUST\\" be"'),
    ['s.duramen:3: error T004', 's.duramen:3: warning T012']);
});

test('REQ-CK-007: open items are not tested', async () => {
  await one(
    hs('open O "o"', '  example f {}', '  table f', '    | x |', '    | 1 |', '  example f {not json', '    expect nothing at all',
      '  table g h', '    | {bad |'),
    ['s.duramen:4: error T003', 's.duramen:5: error T003', 's.duramen:8: error T003', 's.duramen:10: error T003']);
});

test('REQ-CK-008: the order of errors is stated once', async () => {
  await one(
    he('errors', '  too_big when x > 9', '  too_small when x < 0', 'req A "a"', '  text',
      '    A request that is too_big gets too_big, and one too_small gets too_small.', '  example f {}', 'req B "b"', '  text',
      '    too_big is checked Before too_small.', '  example f {}', 'req C "c"', '  text', '    too_big is checked first.',
      '    After that, nothing.', '  example f {}', 'req D "d"', '  text', '    too_big and too_small are checked in this',
      '    order.', '  example f {}'),
    ['s.duramen:14: error T005', 's.duramen:23: error T005']);
  await one(
    he('errors', '  e when x', '  f when y', 'req A "a"', '  text', '    A request may be refused before it is read: see the errors list.', '  example f {}'),
    []);
  await one(
    he('errors', '  too_big when x > 9', '  too_small when x < 0', 'req A "a"', '  text', '    too_bigé, then too_small: decided before-hand.',
      '  example f {}', 'req B "b"', '  text', '    xtoo_big and too_small2 come after.', '  example f {}'),
    ['s.duramen:10: error T005']);
});

test('REQ-CK-009: decisions', async () => {
  await one(
    he('decision D-1 "uncited, no source"', 'decision D-2 "bad status"', '  source s', '  status Accepted',
      'decision D-3 "superseded by nothing"', '  source s', '  status superseded', 'decision D-4 "superseded by an undeclared one"',
      '  source s', '  status superseded by D-9', 'decision D-5 "superseded properly"', '  source s', '  status superseded by D-6',
      'decision D-6 "accepted, with more words"', '  source s', '  status accepted on 2026-01-01', 'decision D-7 "observed"',
      '  source s', '  status observed', 'req A "a"', '  decision D-2, D-3, D-4, D-5, D-6, D-7', '  example f {}'),
    ['s.duramen:6: warning T012', 's.duramen:6: warning T013', 's.duramen:7: error T027', 's.duramen:10: error T027',
      's.duramen:13: error T027', 's.duramen:25: error T028', 's.duramen:25: error T028', 's.duramen:25: error T028',
      's.duramen:25: warning T028']);
  await one(
    he('decision D-1 "a comma after the word"', '  source s', '  status accepted, 2026-01-01', 'decision D-2 "an empty status"',
      '  source', '  status', 'req A "a"', '  decision D-1, D-2', '  example f {}'),
    ['s.duramen:6: error T027', 's.duramen:9: warning T013', 's.duramen:9: error T027']);
  await expectDiags(
    { 's.duramen': hs('req A "a"', '  decision D, E', '  text', '    T.', 'decision D "d"', '  source x', '  status superseded  by E',
      'decision E "e"', '  source x', '  status Accepted') },
    ['s.duramen:3: error T001', 's.duramen:3: error T028', 's.duramen:7: error T027', 's.duramen:10: error T027']);
  await one(
    he('req A "a"', '  decision D', '  example f {}', 'decision D "d"', '  source x', '  status rejected', 'decision D "d again"',
      '  source x', 'decision E "e"', '  source x', 'decision E "e again"', '  source x'),
    ['s.duramen:6: error T028', 's.duramen:12: error T007', 's.duramen:14: warning T012', 's.duramen:16: error T007',
      's.duramen:16: warning T012']);
});
