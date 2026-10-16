import { test } from 'node:test';
import { ECHO, expectDiags, t, withEcho } from './helpers.ts';

const one = (s: string, expected: string[], extra: Record<string, string> = {}) =>
  expectDiags({ 's.duramen': s, ...extra }, expected);
const H = ['duramen 0.1', 'spec s 1'];
const hs = (...lines: string[]) => t(...H, ...lines);
const echo = { 'echo.mjs': ECHO };

test('REQ-SY-001: lines', async () => {
  await one(
    '﻿duramen 0.1\r\nspec s 1\rnote  \n  text\t\n    Some text.  \r\n', []);
  await one('duramen 0.1\nspec s 1\n\tnote\n', ['s.duramen:3: error P001']);
  await one('duramen 0.1\nspec s 1\nnote\n  \ttext\n', ['s.duramen:4: error P001']);
  await one('duramen 0.1\nspec s 1\n note\n', ['s.duramen:3: error P001']);
  await one('  \t \nduramen 0.1\n\t\nspec s 1\n   \n', []);
  await one('duramen 0.1　\nspec s 1 \nnote\n  text\n', ['s.duramen:4: error P001']);
  await expectDiags(
    withEcho(
      'duramen 0.1\nspec s 1\n  title "a b"\noracle node echo.mjs\nop f\n  input x? {a: b}, y? json\nerrors\n  e when x y\n' +
        'req A "A title"\n  example f {"x": "p q"}\n    expect result.x = "p q"\n    expect result.x = "p q"\n  example f {}\n' +
        '    input y."k l"\n      text\n    expect result.y = {"k l": "text\\n"}\n' +
        '  example raw \'{"id":"r","op":"f","input":{"x":" "}}\'\n  example f {"x": 1}\n    expect result.x ≈ 1 ± 0\n',
    ),
    [],
  );
  // U+2028 stays inside a line
  await one('duramen 0.1\nspec s 1\nsection S "a b"\n', []);
});

test('REQ-SY-002: statements and comments', async () => {
  await one(
    t('# A comment.', 'duramen 0.1', '#A comment too.', 'spec s 1', 'frobnicate this', '  title "ignored"', '    ignored too', 'Note'),
    ['s.duramen:5: error P002', 's.duramen:8: error P002']);
  await one(t('  indented', ' # indented too', 'duramen 0.1', 'spec s 1'), ['s.duramen:1: error P003', 's.duramen:2: error P003']);
});

test('REQ-SY-003: clauses', async () => {
  await one(hs('note', '  # A comment.', '  text', '    Text.', '    # Text, not a comment.'), []);
  await one(hs('note', ' text'), ['s.duramen:4: error P007']);
  await one(hs('note', '    Text without a clause.', '  text', '    Text.'), ['s.duramen:4: error P006']);
  await one(hs('op f', '  audit', '  audit text'), ['s.duramen:5: error P052']);
  await one(hs('  colour blue', '    more', 'note', '  example f {}', '    expect result = 1'),
    ['s.duramen:3: error P015', 's.duramen:6: error P015']);
  await one(hs('note', ' # not a comment here', '    # nor here', '  text', '    Text.'),
    ['s.duramen:4: error P007', 's.duramen:5: error P006']);
  await one(
    hs('  title "one"', '  title "two"', '    more', 'note', '  text', '    One.', '  text Two.', 'decision D "d"',
      '  source a', '  source b', '  status accepted', '  status rejected'),
    ['s.duramen:4: error P052', 's.duramen:9: error P052', 's.duramen:12: error P052', 's.duramen:14: error P052']);
  await one(hs('  title x', '  title "two"', 'op f', '  request [1]', '  request {}'),
    ['s.duramen:3: error P004', 's.duramen:4: error P052', 's.duramen:6: error P009', 's.duramen:7: error P052']);
  await one(hs('  title "A title"', '    that goes on', '  # A comment.', '    # Another.'), ['s.duramen:4: error P006']);
});

test('REQ-SY-004: duramen, spec and oracle', async () => {
  await one(t('duramen 0.1', '  title "x"', 'spec s 1'), ['s.duramen:2: error P015']);
  await one(t('duramen 0.1', 'spec s'), ['s.duramen:2: error P021']);
  await one(t('duramen 0.1', 'spec s 1 2'), ['s.duramen:2: error P021']);
  await one(
    t('duramen 0.1', 'spec s 1.0.0-beta', '  title "The s program"', '  contract s-out-2',
      '  request {"clock": "2026-01-01T00:00:00Z", "n": 1}', '  text', '    What s is.'), []);
  await one(hs('  request {"clock":'), ['s.duramen:3: error P009']);
  await one(hs('  request ["clock"]'), ['s.duramen:3: error P009']);
  await one(hs('  request {"op": "x"}'), ['s.duramen:3: error P051']);
  await one(hs('oracle'), ['s.duramen:3: error P028']);
  await one(hs('oracle node model.mjs --quiet', '  source model.mjs, lib/a.mjs lib/b.mjs', '  timeout 5'), ['s.duramen:5: error P015']);
});

test('REQ-SY-005: text', async () => {
  await one(hs('note', '  text Here.'), ['s.duramen:4: error P008']);
  await one(hs('note', '  text', '    One.', '   Two.'), ['s.duramen:6: error P008']);
  await one(hs('note', '  text', '    # It MUST be text.'), ['s.duramen:3: error T004']);
});

test('REQ-SY-006: quoted strings, IDs and titles', async () => {
  await one(hs('section S A title'), ['s.duramen:3: error P005']);
  await one(hs('section S "A title" and more'), ['s.duramen:3: error P005']);
  await one(hs('section S'), ['s.duramen:3: error P005']);
  await one(hs('section S "unclosed', 'section T "A" "B"', 'section U "'),
    ['s.duramen:3: error P005', 's.duramen:4: error P004', 's.duramen:5: error P005']);
  await one(hs('section S "A \\q title"'), ['s.duramen:3: error P004']);
  await one(hs('section S "A "quoted" title"'), ['s.duramen:3: error P004']);
  await one(hs('  title A title'), ['s.duramen:3: error P004']);
  await one(hs('section S-1.x "A \\"quoted\\" title, é and all"'), []);
});

test('REQ-SY-007: operations', async () => {
  await one(hs('op f g'), ['s.duramen:3: error P031']);
  await one(hs('op'), ['s.duramen:3: error P031']);
  await one(
    hs('op f', '  input a number, b? {x: number, y: string}, c "one, two" | [1, 2], d-e (f, g)', '  result the sum',
      '  tolerance result.sum 0.005', '  tolerance result.count 0', '  audit text', '  request {}'), []);
  await one(
    hs('op f', '  input a', '  input a.b number', '  input b?number', '  input', '  input c number, , d number,',
      "  input e 'x, y'", '  input c number', '  input é number', 'op g', '  audit json', 'op', '  input x', '  tolerance result.y'),
    ['s.duramen:4: error P017', 's.duramen:5: error P017', 's.duramen:6: error P017', 's.duramen:7: error P017',
      's.duramen:8: error P017', 's.duramen:8: error P017', 's.duramen:9: error P017', 's.duramen:10: error P052',
      's.duramen:11: error P017', 's.duramen:13: error P050', 's.duramen:14: error P031', 's.duramen:15: error P017',
      's.duramen:16: error P018']);
  await one(
    hs('op f', '  tolerance result.x', '  tolerance result.x -1', '  tolerance result.x 0x10', '  tolerance result.x 1 2', '  tolerance result.x 1e-3'),
    ['s.duramen:4: error P018', 's.duramen:5: error P018', 's.duramen:6: error P018', 's.duramen:7: error P018']);
  await one(hs('op f', '  tolerance foo 0.1', '  tolerance result.x -0', '  tolerance result.y 1e400'), ['s.duramen:6: error P018']);
  await one(
    hs('op f', '  request 5', 'op g', '  request {"input": 5}', 'op h', '  tolerance result.x 1', '  tolerance result.y 1', '  tolerance result.x 2'),
    ['s.duramen:4: error P009', 's.duramen:6: error P051', 's.duramen:10: error P052']);
  await one(
    hs('op f', '  input a x], b y', '  input b z', '  input c "a\\", b" x, d y', 'op h', '  tolerance result.x 1', '  tolerance result.x result', '  tolerance result.x 2'),
    ['s.duramen:5: error P052', 's.duramen:9: error P018', 's.duramen:10: error P052']);
  await one(
    hs('oracle node echo.mjs', 'op f', '  input a (x}, b json', 'req A "a"', '  example f {"b": 1}', '    expect result.b = 1'),
    ['s.duramen:7: error T010'], echo);
});

test('REQ-SY-008: the errors list', async () => {
  await one(hs('errors', '  bad_input when the input is not an object, or', '    when it lacks a field', '  not_found when there is no such thing'), []);
  await one(hs('errors first', '  e when x'), ['s.duramen:3: error P050']);
  await one(
    hs('errors', '  e if x', '  e when', '    the input is bad', '  when x', '  f when y', '   and z', '  g is', '   wrong'),
    ['s.duramen:4: error P019', 's.duramen:5: error P019', 's.duramen:7: error P019', 's.duramen:9: error P006',
      's.duramen:10: error P019', 's.duramen:11: error P006']);
  await one(hs('errors', '  e when x', '    # It MUST be read.'), ['s.duramen:4: error T004']);
  await one(hs('errors', '  e when x', '  f when y', '  e when z'), []);
});

test('REQ-SY-009: requirements, open items, decisions, sections and notes', async () => {
  await one(
    hs('section S "Things"', '  text', '    About things.', 'note', '  text', '    A note.', 'open S-1 "Unsaid"', '  text',
      '    Left open.', 'decision D-1 "Why"', '  source the author', '  status accepted', '  text', '    Because.',
      '  rejected "Another way, because no."', '  rejected "A third way."'),
    ['s.duramen:12: warning T012']);
  await one(
    hs('req A "a"', '  on mac', '  status accepted', '  example f {}', 'note x', 'section S "s"', '  example f {}',
      'decision D "d"', '  title "x"', 'open O "o"', '  decision D'),
    ['s.duramen:4: error P033', 's.duramen:5: error P015', 's.duramen:7: error P050', 's.duramen:9: error P015',
      's.duramen:11: error P015', 's.duramen:13: error P015']);
  await one(hs('  contract', 'req A "a"', '  decision', '  text', '    Words.'), ['s.duramen:4: error T001']);
});

test('REQ-SY-010: examples', async () => {
  await one(
    hs('req A "a"', '  example', '  example f [1]', '  example f {"x": 1', '  example f 2', '  example raw "{\\"id\\": \\"1\\",\\n\\"op\\": \\"f\\"}"'),
    ['s.duramen:4: error P012', 's.duramen:5: error P012', 's.duramen:6: error P009', 's.duramen:7: error P012', 's.duramen:8: error P026']);
  await one(
    hs('req A "a"', '  example raw', '  example raw {"id": "x"}', '  example raw "unclosed', '  example raw "a" "b"',
      '  example raw "carriage\\rreturn"', '  example f [1]', '    expect result', '     expect result = 1', '    expect result ≈ 1',
      '    expect result~1+-0.5', '    expect result="~"', '    expect result =', '    expect = 1', '    request {"a": 1}',
      '    request {"b": 1}', '    omit', '    omit a, b c', '    omit d'),
    ['s.duramen:4: error P004', 's.duramen:5: error P004', 's.duramen:6: error P004', 's.duramen:7: error P004',
      's.duramen:8: error P026', 's.duramen:9: error P012', 's.duramen:10: error P011', 's.duramen:11: error P006',
      's.duramen:12: error P010', 's.duramen:15: error P009', 's.duramen:16: error P011', 's.duramen:18: error P052',
      's.duramen:19: error P011']);
  await one(
    hs('req A "a"', '  example raw \'{"id": "x"}\'', '    omit', '    request', '    input', '  example f {}', '    request', '    input', '    omit ,'),
    ['s.duramen:5: error P022', 's.duramen:6: error P022', 's.duramen:7: error P022', 's.duramen:9: error P009',
      's.duramen:10: error P049', 's.duramen:11: error P011']);
  await one(
    hs('req A "a"', '  example f {}', '    expect result ≈ 1 ± -1', '    expect result ~ 1 +- x', '    expect result ≈ 0x10 ± 1',
      '    expect result = {nope}', '    expect result', '    result = 1', '     expect result = 1', '      expect result = 1',
      '    request [1]', '    request {"input": {}}', '  example raw \'{"id": "x"}\'', '    omit id', '    request {"a": 1}',
      '    input files."a"', '      text'),
    ['s.duramen:5: error P010', 's.duramen:6: error P010', 's.duramen:7: error P010', 's.duramen:8: error P009',
      's.duramen:9: error P011', 's.duramen:10: error P011', 's.duramen:11: error P006', 's.duramen:12: error P006',
      's.duramen:13: error P009', 's.duramen:14: error P051', 's.duramen:16: error P022', 's.duramen:17: error P022',
      's.duramen:18: error P022']);
  await one(
    hs('op f', 'req A "a"', '  text', '    T.', '  example f {}', '    request {"a": 1}', '    request [2]', '    request {"id": 3}', '    request {"b": 4}'),
    ['s.duramen:9: error P052', 's.duramen:10: error P052', 's.duramen:11: error P052']);
  await one(
    hs('op f', 'req A "a"', '  text', '    T.', '  example raw \'{"id":"1","op":"f"}\'', '    input files."a" from "nofile"',
      '    input files."b"', '      hello', '  example raw x', '    input files."c" from "nofile"'),
    ['s.duramen:8: error P022', 's.duramen:9: error P022', 's.duramen:11: error P004', 's.duramen:12: error P022']);
  await one(
    hs('op f', 'req A "a"', '  text', '    T.', '  example raw \'{"id":"1","op":"f"}\'', '    input files."a" from "nofile"', '      hello',
      '  example f [1]', '    input a', '      t', '    input a.b', '      u'),
    ['s.duramen:8: error P022', 's.duramen:9: error P006', 's.duramen:10: error P012', 's.duramen:13: error P049']);
});

test('REQ-SY-011: texts in an example’s input', async () => {
  await expectDiags(
    withEcho(
      hs('oracle node echo.mjs', 'op f', '  input files object, n? number', 'req A "a"', '  example f {"n": 1}', '    input files."a b"',
        '      one', '        two', '', '    input files.x', '      three', '', '',
        '    expect result = {"n": 1, "files": {"a b": "one\\n  two\\n", "x": "three\\n"}}'),
    ),
    []);
  await one(
    hs('req A "a"', '  example f {"x": 1}', '    input files.', '    input files.."a"', '    input "a', '    input x.y', '      text', '    input z', '    input y from "missing.txt"'),
    ['s.duramen:5: error P049', 's.duramen:6: error P049', 's.duramen:7: error P049', 's.duramen:8: error P049',
      's.duramen:10: error P049', 's.duramen:11: error P048']);
  await one(
    hs('req A "a"', '  example f {}', '    input a', '     not six', '      six, but after the line that ended the text'),
    ['s.duramen:5: error P049', 's.duramen:6: error P006', 's.duramen:7: error P006']);
  await expectDiags(
    {
      'outside.txt': 'x',
      'r/s.duramen': hs('req A "a"', '  example f {}', '    input a from "../outside.txt"', '    input b from "t.txt"',
        '      not its text', '    input c from "unclosed', '  example f {', '    input d from "../outside.txt"'),
      'r/t.txt': 't\n',
    },
    ['r/s.duramen:5: error P048', 'r/s.duramen:7: error P006', 'r/s.duramen:8: error P049', 'r/s.duramen:9: error P009', 'r/s.duramen:10: error P048'],
    'r',
  );
  await expectDiags(
    {
      'sub/s.duramen': hs('oracle node echo.mjs', 'op f', '  input t? string', 'req A "a"', '  example f {}', '    input t from "data/t.txt"',
        '    expect result = {"t": "hello,\\r\\nworld"}'),
      'sub/echo.mjs': ECHO,
      'sub/data/t.txt': 'hello,\r\nworld',
    },
    [],
  );
  await expectDiags(
    {
      's.duramen': hs('oracle node echo.mjs', 'op f', '  input t? json, u? json, a? json', 'req A "a"', '  example f {}', '    input t',
        '      one', '# a comment at indent 0', '  # and one at indent 2', '      two', '    input u from "./sub/..//b.txt"',
        '      # a comment indented six', '    expect result = {"t": "one\\ntwo\\n", "u": "\\ufeffbom"}', '  example f {"a": 1}',
        '    input x..y from "missing.txt"', '    input a.b from "missing.txt"', '    input a.c from "t.txt"', '    input t from "sub"'),
      'echo.mjs': ECHO,
      'b.txt': '﻿bom',
      't.txt': 't',
    },
    ['s.duramen:17: error P049', 's.duramen:18: error P048', 's.duramen:19: error P049', 's.duramen:20: error P048'],
  );
  const fromFiles = (lines: string[], extra: Record<string, string>, entry?: string) =>
    expectDiags({ 's.duramen': hs(...lines), ...extra }, [], entry);
  await fromFiles(
    ['oracle node echo.mjs', 'op f', '  input b? json', 'req A "a"', '  example f {}', '    input b  from "t.txt"', '    expect result.b = "t\\n"'],
    { 'echo.mjs': ECHO, 't.txt': 't\n' });
  await one(
    hs('req A "a"', '  example f {}', '    input a from"t.txt"', '    input b from "\\q"', '      its text', '    input from "t.txt"'),
    ['s.duramen:5: error P049', 's.duramen:6: error P049', 's.duramen:8: error P049'], { 't.txt': 't\n' });
  await expectDiags(
    {
      'sub/s.duramen': hs('oracle node echo.mjs', 'op f', '  input t? json, u? json', 'req A "a"', '  example f {}',
        '    input t from "../sub/t.txt"', '    input u\tfrom\t"t.txt"', '    expect result = {"t": "t\\n", "u": "t\\n"}'),
      'sub/echo.mjs': ECHO,
      'sub/t.txt': 't\n',
    },
    [],
    'sub',
  );
});

test('REQ-SY-012: tables', async () => {
  await expectDiags(
    withEcho(
      hs('oracle node echo.mjs', 'op f', '  input x? json, y? json', 'req A "a"', '  table f',
        '    | x        | y | result.x | result.y ± 0.5 |', '    |----------|---|:--------:|----------------|',
        '    | "a\\|b"   |   | "a\\|b"   |                |', '    | 1        | 2 | ?        | 2.4            |'),
    ),
    []);
  await one(
    hs('req A "a"', '  table f', '  table f g', '    | x |', '    | 1 |', '  table f', '    | x |', '  table f',
      '    | x | result ± -1 |', '    | 1 | 2           |', '  table f', '    | x | result ± 0.5 |', '    | 1 | "2"          |',
      '  table f', '    | x | y |', '    | 1 |', '    | {  | 2 |', '    x | 1', '  table f', '    | x | |', '    | 1 | 2 |',
      '  table f', '    | x ± 1 |', '    | 1     |'),
    ['s.duramen:4: error P013', 's.duramen:5: error P013', 's.duramen:8: error P013', 's.duramen:11: error P010',
      's.duramen:15: error P010', 's.duramen:18: error P014', 's.duramen:19: error P009', 's.duramen:20: error P006',
      's.duramen:22: error P013', 's.duramen:25: error P010']);
  await one(
    hs('req A "a"', '  table f g', '    | x |', '    | {bad |', '  table f', '   | x |', '    | 1 |', '  table f',
      '    | a.b | result |', '    | 1   | 2      |', '  table f', '    | x | result ± lots |', '    | 1 | "two"         |',
      '  table f', '    | x | result ± 1 2 | result.y+-0.5 |', '    | 1 | 2            | 3             |', '  table f',
      '    | x | x |', '    | 1 | 2 |', '  table f', '    | x | result ± 0.5 |', '    | 1 | 2.25 [       |', '    | { | ?            |'),
    ['s.duramen:4: error P013', 's.duramen:7: error P013', 's.duramen:8: error P006', 's.duramen:11: error P013',
      's.duramen:14: error P010', 's.duramen:17: error P010', 's.duramen:20: error P013', 's.duramen:24: error P010',
      's.duramen:25: error P009']);
  await expectDiags(
    withEcho(
      hs('oracle node echo.mjs', 'op f', '  input x? json', 'req A "a"', '  table f', '    |---|----------|', '    | x | result.x |',
        '    |   |', '    | 1 | 1', '    |', '    | 2 | 2        |'),
    ),
    []);
  await one(
    hs('op f', '  input a int', 'req A "a"', '  text', '    T.', '  table f', '    | a ± 1 | b! | result ± x |', '    | 1 | 2 | 3 |'),
    ['s.duramen:9: error P010', 's.duramen:9: error P013']);
  await expectDiags(
    withEcho(
      'duramen 0.1\nspec s 1\noracle node echo.mjs\nop f\n  input answer? json, id? json\nreq A "a"\n  table f\n    | answer | result.k=1 | result.k~2 ± 0.5 | id |\n    | ---\t|---|:-:|　|\n    | {"result": {"k=1": 1, "k~2": 2.25}} | 1 | 2 | "A#1" |\n  table f\n    | answer | result.a b |\n    | 1 | 2 |\n',
    ),
    ['s.duramen:12: error P013']);
  await expectDiags(
    withEcho(hs('oracle node echo.mjs', 'op f', '  input result? json', 'req A "a"', '  table f', '    | result |', '    | 1 |')),
    ['s.duramen:9: error T002']);
  await one(hs('req A "a"', '  table f g', '    not a row', '    | x |', '    | 1 |'), ['s.duramen:4: error P013', 's.duramen:5: error P006']);
});

test('REQ-SY-013: numbers too large for binary64', async () => {
  await one(
    hs('  request {"x": 1e400}', 'op f', '  input a int', 'req A "a"', '  text', '    T.', '  example f {"a": 1e400}',
      '  example f {"a": 1}', '    expect result.a = [1, -1e400]', '    request {"y": 1e999}', '  table f', '    | a | result |',
      '    | 1e999 | 1 |', '  example raw \'{"id":"r","op":"f","input":{"a":1e400}}\''),
    ['s.duramen:3: error P009', 's.duramen:9: error P009', 's.duramen:11: error P009', 's.duramen:12: error P009', 's.duramen:15: error P009']);
  await one(
    hs('op f', '  input a int', '  tolerance result.x 1e400', 'req A "a"', '  text', '    T.', '  example f {"a": 1}',
      '    expect result ≈ 1e400 ± 1', '    expect result ≈ 1 ± 1e400', '  table f', '    | a | result ± 1e400 |', '    | 1 | 2 |',
      '  table f', '    | a | result ± 1 |', '    | 1 | 1e400 |'),
    ['s.duramen:5: error P018', 's.duramen:10: error P010', 's.duramen:11: error P010', 's.duramen:13: error P010', 's.duramen:17: error P010']);
  await one(
    hs('op f', '  request {"id": 1e400}', 'req A "a"', '  text', '    T.', '  example f [1e400]', '  example f 1e400'),
    ['s.duramen:4: error P009', 's.duramen:8: error P009', 's.duramen:9: error P009']);
});
