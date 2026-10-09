import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECHO, cases, check, diags, req, t } from './helper.ts';
import { handleLine } from '../src/handle.ts';

const OK = t('duramen 0.1', 'spec a 1');
const SS = (...rest: string[]): Record<string, string> => ({ 's.duramen': t('duramen 0.1', 'spec s 1', ...rest) });

// ---- REQ-RQ-001, REQ-RQ-002
test('REQ-RQ-001: entry file alone, folder, and name in diagnostics', () => {
  assert.deepEqual(check({ 'a.duramen': OK, 'b.duramen': 'frobnicate\n' }, 'a.duramen'), { diagnostics: [], errors: 0, warnings: 0 });
  assert.deepEqual(check({ 'a.duramen': OK, 'b.duramen': 'frobnicate\n' }), {
    diagnostics: ['b.duramen:1: error P002', 'b.duramen:1: error P020'],
    errors: 2,
    warnings: 0,
  });
});

test('REQ-RQ-002: requests that cannot be handled', () => {
  const ok = { files: { 'a.duramen': OK } };
  const line = (s: string) => handleLine(s);
  assert.deepEqual(line('{not json'), { id: null, error: 'bad_request' });
  assert.deepEqual(line('[1, 2]'), { id: null, error: 'bad_request' });
  assert.deepEqual(line(JSON.stringify({ op: 'check', input: ok })), { id: null, error: 'bad_request' });
  assert.deepEqual(line(JSON.stringify({ id: 7, op: 'check', input: ok })), { id: null, error: 'bad_request' });
  assert.deepEqual(line(JSON.stringify({ id: 'a', op: 'lint', input: ok })), { id: 'a', error: 'unknown_op' });
  assert.deepEqual(line(JSON.stringify({ id: 'a', op: 'lint' })), { id: 'a', error: 'unknown_op' });
  assert.deepEqual(line(JSON.stringify({ id: 'a', op: 'check' })), { id: 'a', error: 'bad_request' });
  const bad: unknown[] = [
    {},
    { files: {} },
    { files: ['a.duramen'] },
    { files: { 'a.duramen': 1 } },
    { files: { '../a.duramen': OK } },
    { files: { '/a.duramen': OK } },
    { files: { 'x/./a.duramen': OK } },
    { files: { 'x//a.duramen': OK } },
    { files: { 'c:a.duramen': OK } },
    { files: { 'a\\b.duramen': OK } },
    { files: { a: 'x', 'a/b.duramen': OK } },
    { ...ok, entry: '../a.duramen' },
    { ...ok, entry: 1 },
    { ...ok, entry: '' },
  ];
  for (const input of bad) {
    assert.deepEqual(handleLine(JSON.stringify({ id: 'a', op: 'check', input })), { id: 'a', error: 'bad_request' }, JSON.stringify(input));
    assert.deepEqual(handleLine(JSON.stringify({ id: 'a', op: 'cases', input })), { id: 'a', error: 'bad_request' });
  }
});

// ---- REQ-RC-001
test('REQ-RC-001: files of a record', () => {
  const frob = 'frobnicate\n';
  assert.deepEqual(
    diags({
      'a.duramen': OK,
      'notes.md': frob,
      'build/x.duramen': frob,
      'sub/build/x.duramen': frob,
      'node_modules/x.duramen': frob,
      '.hidden.duramen': frob,
      'sub/.hidden/x.duramen': frob,
      'sub/b.duramen': t('duramen 0.1'),
    }),
    [],
  );
  assert.deepEqual(diags({ 'notes.md': t('duramen 0.1', 'spec n 1'), 'a.duramen': frob }, 'notes.md'), []);
  assert.deepEqual(
    diags({ 'sub/a.duramen': OK, 'sub/deeper/b.duramen': t('duramen 0.1'), 'c.duramen': frob }, 'sub'),
    [],
  );
  assert.deepEqual(diags({ 'sub/a.duramen': OK, 'sub/b.duramen': frob }, 'sub/a.duramen'), []);
  assert.deepEqual(diags({ 'a.duramen': OK }, 'missing.duramen'), ['missing.duramen:1: error P046']);
  assert.deepEqual(diags({ 'a.duramen': OK }, 'sub'), ['sub:1: error P046']);
  assert.deepEqual(check({ 'notes.md': OK }), { diagnostics: ['.:1: error P046'], errors: 1, warnings: 0 });
});

// ---- REQ-RC-002
test('REQ-RC-002: order of files', () => {
  const a = t('duramen 0.1', 'spec a 1');
  const b = t('duramen 0.1', 'spec b 1');
  assert.deepEqual(diags({ 'b.duramen': b, 'a.duramen': a }), ['b.duramen:2: error P044']);
  assert.deepEqual(diags({ 'a.duramen': a, 'B.duramen': b }), ['a.duramen:2: error P044']);
  assert.deepEqual(diags({ 'a/z.duramen': t('duramen 0.1', 'spec z 1'), 'a.duramen': a }), ['a/z.duramen:2: error P044']);
  assert.deepEqual(
    diags({ '｡.duramen': t('duramen 0.1', 'spec x 1'), '😀.duramen': t('duramen 0.1', 'spec y 1') }),
    ['｡.duramen:2: error P044'],
  );
});

// ---- REQ-RC-003
test('REQ-RC-003: versions', () => {
  assert.deepEqual(diags({ 's.duramen': 'spec s 1\n' }), ['s.duramen:1: error P020']);
  assert.deepEqual(diags({ 's.duramen': t('duramen 0.3', 'spec s 1') }), ['s.duramen:1: error P023']);
  assert.deepEqual(diags({ 's.duramen': t('duramen 0.1', 'spec s 1', 'duramen 0.1') }), ['s.duramen:3: error P023']);
  assert.deepEqual(diags({ 's.duramen': t('duramen', 'spec s 1') }), ['s.duramen:1: error P023']);
  assert.deepEqual(diags({ 'a.duramen': OK, 'b.duramen': t('duramen 0.2') }), ['.:1: error P047']);
  assert.deepEqual(diags({ 'r/a.duramen': t('duramen 0.2', 'spec s 1'), 'r/b.duramen': t('duramen 0.1') }, 'r'), ['r:1: error P047']);
  assert.deepEqual(diags({ 'a.duramen': t('duramen 0.2', 'spec s 1'), 'b.duramen': t('duramen 0.2') }), []);
  assert.deepEqual(diags({ 's.duramen': '' }), ['.:1: error P021', 's.duramen:1: error P020']);
});

// ---- REQ-RC-004
test('REQ-RC-004: one spec, one oracle, one errors', () => {
  assert.deepEqual(diags({ 's.duramen': t('duramen 0.1') }), ['.:1: error P021']);
  assert.deepEqual(diags({ 's.duramen': t('duramen 0.1') }, 's.duramen'), ['s.duramen:1: error P021']);
  assert.deepEqual(diags({ 'r/s.duramen': t('duramen 0.1') }, 'r'), ['r:1: error P021']);
  assert.deepEqual(diags({ 's.duramen': t('duramen 0.1', 'spec a 1', '', 'spec b 1') }), ['s.duramen:4: error P044']);
  assert.deepEqual(
    diags({
      'a.duramen': t('duramen 0.1', 'spec s 1', 'oracle node a.mjs'),
      'b.duramen': t('duramen 0.1', 'oracle node b.mjs'),
    }),
    ['b.duramen:2: error P044'],
  );
  assert.deepEqual(diags(SS('errors', '  e1 when x', 'errors', '  e2 when y')), ['s.duramen:5: error P032']);
  assert.deepEqual(
    diags({ 'a.duramen': t('duramen 0.1', 'spec s 1', 'errors', '  e1 when x'), 'b.duramen': t('duramen 0.1', '', 'errors', '  e2 when y') }),
    ['b.duramen:3: error P032'],
  );
  assert.deepEqual(diags(SS('errors', 'errors')), ['s.duramen:4: error P032']);
});

// ---- REQ-RC-005, REQ-RC-006
test('REQ-RC-005: read problems stop the check', () => {
  assert.deepEqual(diags(SS('frobnicate', 'req A "a"', '  example nope {}')), ['s.duramen:3: error P002']);
});

test('REQ-RC-006: order of diagnostics', () => {
  assert.deepEqual(
    check({ 'b.duramen': t('frobnicate', 'duramen 0.1'), 'a.duramen': t('duramen 0.1', 'spec s 1', '', '', 'frobnicate', 'frobnicate') }),
    {
      diagnostics: ['a.duramen:5: error P002', 'a.duramen:6: error P002', 'b.duramen:1: error P002'],
      errors: 3,
      warnings: 0,
    },
  );
  assert.deepEqual(
    check(SS('', 'decision D-1 "one"', '  text', '    No source, and cited by nothing.', '', 'req A "a"', '  decision D-2')),
    {
      diagnostics: ['s.duramen:4: warning T012', 's.duramen:4: warning T013', 's.duramen:8: error T001', 's.duramen:8: error T008'],
      errors: 2,
      warnings: 2,
    },
  );
  assert.deepEqual(
    check(
      SS(
        '',
        'decision D-1 "proposed"',
        '  source here',
        '  status proposed',
        '',
        'decision D-2 "contested"',
        '  source there',
        '  status contested',
        '',
        'req A "a"',
        '  decision D-1, D-2',
      ),
    ),
    { diagnostics: ['s.duramen:12: error T001', 's.duramen:12: error T028', 's.duramen:12: warning T028'], errors: 2, warnings: 1 },
  );
});

// ---- REQ-SY-001 .. 003
test('REQ-SY-001: lines', () => {
  assert.deepEqual(diags({ 's.duramen': '﻿duramen 0.1\r\nspec s 1\rnote  \n  text\t\n    Some text.  \r\n' }), []);
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.1\nspec s 1\n\tnote\n' }), ['s.duramen:3: error P001']);
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.1\nspec s 1\nnote\n  \ttext\n' }), ['s.duramen:4: error P001']);
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.1\nspec s 1\n note\n' }), ['s.duramen:3: error P001']);
  assert.deepEqual(diags({ 's.duramen': '  \t \nduramen 0.1\n\t\nspec s 1\n   \n' }), []);
});

test('REQ-SY-002: statements and comments', () => {
  assert.deepEqual(
    diags({ 's.duramen': t('# A comment.', 'duramen 0.1', '#A comment too.', 'spec s 1', 'frobnicate this', '  title "ignored"', '    ignored too', 'Note') }),
    ['s.duramen:5: error P002', 's.duramen:8: error P002'],
  );
  assert.deepEqual(diags({ 's.duramen': t('  indented', ' # indented too', 'duramen 0.1', 'spec s 1') }), [
    's.duramen:1: error P003',
    's.duramen:2: error P003',
  ]);
});

test('REQ-SY-003: clauses', () => {
  assert.deepEqual(diags(SS('note', '  # A comment.', '  text', '    Text.', '    # Text, not a comment.')), []);
  assert.deepEqual(diags(SS('note', ' text')), ['s.duramen:4: error P007']);
  assert.deepEqual(diags(SS('note', '    Text without a clause.', '  text', '    Text.')), ['s.duramen:4: error P006']);
  assert.deepEqual(diags(SS('  colour blue', '    more')), ['s.duramen:3: error P015', 's.duramen:4: error P006']);
  assert.deepEqual(diags(SS('  title "A title"', '    that goes on', '  # A comment.', '    # Another.')), ['s.duramen:4: error P006']);
});

// ---- REQ-SY-004
test('REQ-SY-004: duramen, spec, oracle', () => {
  assert.deepEqual(diags({ 's.duramen': t('duramen 0.1', '  title "x"', 'spec s 1') }), ['s.duramen:2: error P015']);
  assert.deepEqual(diags({ 's.duramen': t('duramen 0.1', 'spec s') }), ['s.duramen:2: error P021']);
  assert.deepEqual(diags({ 's.duramen': t('duramen 0.1', 'spec s 1 2') }), ['s.duramen:2: error P021']);
  assert.deepEqual(
    diags(
      SS('  title "The s program"', '  contract s-out-2', '  request {"clock": "2026-01-01T00:00:00Z", "n": 1}', '  text', '    What s is.').valueOf(),
    ),
    [],
  );
  assert.deepEqual(diags({ 's.duramen': t('duramen 0.1', 'spec s 1.0.0-beta', '  title "The s program"', '  contract s-out-2', '  request {"clock": "x", "n": 1}', '  text', '    What s is.') }), []);
  assert.deepEqual(diags(SS('  request {"clock":')), ['s.duramen:3: error P009']);
  assert.deepEqual(diags(SS('  request ["clock"]')), ['s.duramen:3: error P009']);
  assert.deepEqual(diags(SS('  request {"op": "x"}')), ['s.duramen:3: error P051']);
  assert.deepEqual(diags(SS('oracle')), ['s.duramen:3: error P028']);
  assert.deepEqual(diags(SS('oracle node model.mjs --quiet', '  source model.mjs, lib/a.mjs lib/b.mjs', '  timeout 5')), ['s.duramen:5: error P015']);
});

// ---- REQ-SY-005, 006
test('REQ-SY-005: text', () => {
  assert.deepEqual(diags(SS('note', '  text Here.')), ['s.duramen:4: error P008']);
  assert.deepEqual(diags(SS('note', '  text', '    One.', '   Two.')), ['s.duramen:6: error P008']);
  assert.deepEqual(diags(SS('note', '  text', '    # It MUST be text.')), ['s.duramen:3: error T004']);
});

test('REQ-SY-006: quoted strings, IDs and titles', () => {
  assert.deepEqual(diags(SS('section S A title')), ['s.duramen:3: error P005']);
  assert.deepEqual(diags(SS('section S "A title" and more')), ['s.duramen:3: error P005']);
  assert.deepEqual(diags(SS('section S')), ['s.duramen:3: error P005']);
  assert.deepEqual(diags(SS('section S "A \\q title"')), ['s.duramen:3: error P004']);
  assert.deepEqual(diags(SS('section S "A "quoted" title"')), ['s.duramen:3: error P004']);
  assert.deepEqual(diags(SS('  title A title')), ['s.duramen:3: error P004']);
  assert.deepEqual(diags(SS('section S-1.x "A \\"quoted\\" title, é and all"')), []);
});

// ---- REQ-SY-007
test('REQ-SY-007: operations', () => {
  assert.deepEqual(diags(SS('op f g')), ['s.duramen:3: error P031']);
  assert.deepEqual(diags(SS('op')), ['s.duramen:3: error P031']);
  assert.deepEqual(
    diags(
      SS(
        'op f',
        '  input a number, b? {x: number, y: string}, c "one, two" | [1, 2], d-e (f, g)',
        '  result the sum',
        '  tolerance result.sum 0.005',
        '  tolerance result.count 0',
        '  audit text',
        '  request {}',
      ),
    ),
    [],
  );
  assert.deepEqual(diags(SS('op f', '  input a', '  input a.b number', '  input b?number')), [
    's.duramen:4: error P017',
    's.duramen:5: error P017',
    's.duramen:6: error P017',
  ]);
  assert.deepEqual(
    diags(SS('op f', '  tolerance result.x', '  tolerance result.x -1', '  tolerance result.x 0x10', '  tolerance result.x 1 2', '  tolerance result.x 1e-3')),
    ['s.duramen:4: error P018', 's.duramen:5: error P018', 's.duramen:6: error P018', 's.duramen:7: error P018'],
  );
  assert.deepEqual(diags(SS('op f', '  request 5', '  request {"input": 5}')), ['s.duramen:4: error P009', 's.duramen:5: error P051']);
});

// ---- REQ-SY-008, 009
test('REQ-SY-008: the errors list', () => {
  assert.deepEqual(
    diags(SS('errors', '  bad_input when the input is not an object, or', '    when it lacks a field', '  not_found when there is no such thing')),
    [],
  );
  assert.deepEqual(diags(SS('errors first', '  e when x')), ['s.duramen:3: error P050']);
  assert.deepEqual(diags(SS('errors', '  e if x', '  e when', '  when x')), [
    's.duramen:4: error P019',
    's.duramen:5: error P019',
    's.duramen:6: error P019',
  ]);
});

test('REQ-SY-009: requirements, open items, decisions, sections, notes', () => {
  assert.deepEqual(
    diags(
      SS(
        'section S "Things"',
        '  text',
        '    About things.',
        'note',
        '  text',
        '    A note.',
        'open S-1 "Unsaid"',
        '  text',
        '    Left open.',
        'decision D-1 "Why"',
        '  source the author',
        '  status accepted',
        '  text',
        '    Because.',
        '  rejected "Another way, because no."',
        '  rejected "A third way."',
      ),
    ),
    ['s.duramen:12: warning T012'],
  );
  assert.deepEqual(
    diags(
      SS(
        'req A "a"',
        '  on mac',
        '  status accepted',
        '  example f {}',
        'note x',
        'section S "s"',
        '  example f {}',
        'decision D "d"',
        '  title "x"',
        'open O "o"',
        '  decision D',
      ),
    ),
    ['s.duramen:4: error P033', 's.duramen:5: error P015', 's.duramen:7: error P050', 's.duramen:9: error P015', 's.duramen:11: error P015', 's.duramen:13: error P015'],
  );
});

// ---- REQ-SY-010 .. 012
test('REQ-SY-010: examples', () => {
  assert.deepEqual(
    diags(SS('req A "a"', '  example', '  example f [1]', '  example f {"x": 1', '  example f 2', '  example raw "{\\"id\\": \\"1\\",\\n\\"op\\": \\"f\\"}"')),
    ['s.duramen:4: error P012', 's.duramen:5: error P012', 's.duramen:6: error P009', 's.duramen:7: error P012', 's.duramen:8: error P026'],
  );
  assert.deepEqual(
    diags(
      SS(
        'req A "a"',
        '  example f {}',
        '    expect result ≈ 1 ± -1',
        '    expect result ~ 1 +- x',
        '    expect result ≈ 0x10 ± 1',
        '    expect result = {nope}',
        '    expect result',
        '    result = 1',
        '     expect result = 1',
        '      expect result = 1',
        '    request [1]',
        '    request {"input": {}}',
        "  example raw '{\"id\": \"x\"}'",
        '    omit id',
        '    request {"a": 1}',
        '    input files."a"',
        '      text',
      ),
    ),
    [5, 6, 7].map((n) => `s.duramen:${n}: error P010`).concat(['s.duramen:8: error P009', 's.duramen:9: error P011', 's.duramen:10: error P011', 's.duramen:11: error P006', 's.duramen:12: error P006', 's.duramen:13: error P009', 's.duramen:14: error P051', 's.duramen:16: error P022', 's.duramen:17: error P022', 's.duramen:18: error P022']),
  );
});

test('REQ-SY-011: texts in an example input', () => {
  const s = t(
    'duramen 0.1',
    'spec s 1',
    'oracle node echo.mjs',
    'op f',
    '  input files object, n? number',
    'req A "a"',
    '  example f {"n": 1}',
    '    input files."a b"',
    '      one',
    '        two',
    '',
    '    input files.x',
    '      three',
    '',
    '    expect result = {"n": 1, "files": {"a b": "one\\n  two\\n", "x": "three\\n"}}',
  );
  assert.deepEqual(diags({ 's.duramen': s, 'echo.mjs': ECHO }), []);
  assert.deepEqual(
    diags(SS('req A "a"', '  example f {"x": 1}', '    input files.', '    input files.."a"', '    input "a', '    input x.y', '      text', '    input z', '    input y from "missing.txt"')),
    [5, 6, 7, 8, 10].map((n) => `s.duramen:${n}: error P049`).concat(['s.duramen:11: error P048']),
  );
  const s3 = t('duramen 0.1', 'spec s 1', 'oracle node echo.mjs', 'op f', '  input t? string', 'req A "a"', '  example f {}', '    input t from "data/t.txt"', '    expect result = {"t": "hello,\\r\\nworld"}');
  assert.deepEqual(diags({ 'sub/s.duramen': s3, 'sub/echo.mjs': ECHO, 'sub/data/t.txt': 'hello,\r\nworld' }, 'sub'), []);
});

test('REQ-SY-012: tables', () => {
  const s = t(
    'duramen 0.1',
    'spec s 1',
    'oracle node echo.mjs',
    'op f',
    '  input x? json, y? json',
    'req A "a"',
    '  table f',
    '    | x        | y | result.x | result.y ± 0.5 |',
    '    |----------|---|:--------:|----------------|',
    '    | "a\\|b"   |   | "a\\|b"   |                |',
    '    | 1        | 2 | ?        | 2.4            |',
  );
  assert.deepEqual(diags({ 's.duramen': s, 'echo.mjs': ECHO }), []);
  assert.deepEqual(
    diags(
      SS(
        'req A "a"',
        '  table f',
        '  table f g',
        '    | x |',
        '    | 1 |',
        '  table f',
        '    | x |',
        '  table f',
        '    | x | result ± -1 |',
        '    | 1 | 2           |',
        '  table f',
        '    | x | result ± 0.5 |',
        '    | 1 | "2"          |',
        '  table f',
        '    | x | y |',
        '    | 1 |',
        '    | {  | 2 |',
        '    x | 1',
        '  table f',
        '    | x | |',
        '    | 1 | 2 |',
        '  table f',
        '    | x ± 1 |',
        '    | 1     |',
      ),
    ),
    ['s.duramen:4: error P013', 's.duramen:5: error P013', 's.duramen:8: error P013', 's.duramen:11: error P010', 's.duramen:15: error P010', 's.duramen:18: error P014', 's.duramen:19: error P009', 's.duramen:20: error P006', 's.duramen:22: error P013', 's.duramen:25: error P010'],
  );
});

// ---- misc driver behaviour
test('driver: blank lines get no response; responses keep order', () => {
  const r = req('cases', { files: { 's.duramen': 'frobnicate\n' } });
  assert.deepEqual(r.result, { cases: [], errors: 3 });
});
