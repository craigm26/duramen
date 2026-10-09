import { test } from 'node:test';
import assert from 'node:assert';
import { ECHO, check, one, s, withEcho } from './helpers.ts';

const H = ['duramen 0.1', 'spec s 1'];
const doc = (...rest: string[]) => s(...H, ...rest);
type Row = [string, string, string[]];

function table(rows: Row[], run: (t: string) => string[] = one) {
  for (const [name, text, expected] of rows) assert.deepStrictEqual(run(text), expected, name);
}
const f = (n: number, code: string) => `s.duramen:${n}: error ${code}`;

// REQ-SY-001
test('SY-001: lines, indent, white space', () => {
  table([
    ['bom, crlf, cr', '﻿duramen 0.1\r\nspec s 1\rnote  \n  text\t\n    Some text.  \r\n', []],
    ['tab indent', 'duramen 0.1\nspec s 1\n\tnote\n', [f(3, 'P001')]],
    ['tab after spaces', 'duramen 0.1\nspec s 1\nnote\n  \ttext\n', [f(4, 'P001')]],
    ['nbsp indent', 'duramen 0.1\nspec s 1\n note\n', [f(3, 'P001')]],
    ['blank lines of white space', '  \t \nduramen 0.1\n\t\nspec s 1\n   \n', []],
    ['u3000 and u2028 trailing', 'duramen 0.1　\nspec s 1 \nnote\n  text\n', [f(4, 'P001')]],
  ]);
});

test('SY-001: a complete record with quoting, input and tables', () => {
  const text = 'duramen 0.1\nspec s 1\n  title "a b"\noracle node echo.mjs\nop f\n  input x? {a: b}, y? json\nerrors\n  e when x y\n' +
    'req A "A title"\n  example f {"x": "p q"}\n    expect result.x = "p q"\n    expect result.x = "p q"\n  example f {}\n' +
    '    input y."k l"\n      text\n    expect result.y = {"k l": "text\\n"}\n' +
    '  example raw \'{"id":"r","op":"f","input":{"x":" "}}\'\n  example f {"x": 1}\n    expect result.x ≈ 1 ± 0\n';
  assert.deepStrictEqual(withEcho(text), []);
});

// REQ-SY-002
test('SY-002: statements and comments', () => {
  table([
    ['unknown statements', s('# A comment.', 'duramen 0.1', '#A comment too.', 'spec s 1', 'frobnicate this', '  title "ignored"',
      '    ignored too', 'Note'), [f(5, 'P002'), f(8, 'P002')]],
    ['indented before first statement', s('  indented', ' # indented too', 'duramen 0.1', 'spec s 1'), [f(1, 'P003'), f(2, 'P003')]],
    ['rest-of-language statements are silent', doc('type x', '  anything', 'edge e', 'property p', 'evidence v', 'edgedef d'), []],
  ]);
});

// REQ-SY-003
test('SY-003: clauses', () => {
  table([
    ['comments and text', doc('note', '  # A comment.', '  text', '    Text.', '    # Text, not a comment.'), []],
    ['one space', doc('note', ' text'), [f(4, 'P007')]],
    ['no clause before', doc('note', '    Text without a clause.', '  text', '    Text.'), [f(4, 'P006')]],
    ['unknown clauses', doc('  colour blue', '    more', 'note', '  example f {}', '    expect result = 1'), [f(3, 'P015'), f(6, 'P015')]],
    ['hash with wrong indent', doc('note', ' # not a comment here', '    # nor here', '  text', '    Text.'), [f(4, 'P007'), f(5, 'P006')]],
    ['at most once', doc('  title "one"', '  title "two"', '    more', 'note', '  text', '    One.', '  text Two.', 'decision D "d"',
      '  source a', '  source b', '  status accepted', '  status rejected'),
    [f(4, 'P052'), f(9, 'P052'), f(12, 'P052'), f(14, 'P052')]],
    ['once with problems', doc('  title x', '  title "two"', 'op f', '  request [1]', '  request {}'),
      [f(3, 'P004'), f(4, 'P052'), f(6, 'P009'), f(7, 'P052')]],
    ['lines under a clause that takes none', doc('  title "A title"', '    that goes on', '  # A comment.', '    # Another.'), [f(4, 'P006')]],
  ]);
});

// REQ-SY-004
test('SY-004: duramen, spec and oracle statements', () => {
  table([
    ['duramen takes no clauses', s('duramen 0.1', '  title "x"', 'spec s 1'), [f(2, 'P015')]],
    ['spec without version', s('duramen 0.1', 'spec s'), [f(2, 'P021')]],
    ['spec with three words', s('duramen 0.1', 'spec s 1 2'), [f(2, 'P021')]],
    ['full spec', doc('  title "The s program"', '  contract s-out-2', '  request {"clock": "2026-01-01T00:00:00Z", "n": 1}', '  text', '    What s is.')
      .replace('spec s 1', 'spec s 1.0.0-beta'), []],
    ['request not JSON', doc('  request {"clock":'), [f(3, 'P009')]],
    ['request not an object', doc('  request ["clock"]'), [f(3, 'P009')]],
    ['request sets op', doc('  request {"op": "x"}'), [f(3, 'P051')]],
    ['oracle without command', doc('oracle'), [f(3, 'P028')]],
    ['oracle clauses', doc('oracle node model.mjs --quiet', '  source model.mjs, lib/a.mjs lib/b.mjs', '  timeout 5'), [f(5, 'P015')]],
  ]);
});

// REQ-SY-005
test('SY-005: text', () => {
  table([
    ['text with words after it', doc('note', '  text Here.'), [f(4, 'P008')]],
    ['text at indent three', doc('note', '  text', '    One.', '   Two.'), [f(6, 'P008')]],
    ['obligation in text', doc('note', '  text', '    # It MUST be text.'), [f(3, 'T004')]],
  ]);
});

// REQ-SY-006
test('SY-006: quoted strings, IDs and titles', () => {
  table([
    ['title not quoted', doc('section S A title'), [f(3, 'P005')]],
    ['title with more after', doc('section S "A title" and more'), [f(3, 'P005')]],
    ['no title', doc('section S'), [f(3, 'P005')]],
    ['several', doc('section S "unclosed', 'section T "A" "B"', 'section U "'), [f(3, 'P005'), f(4, 'P004'), f(5, 'P005')]],
    ['bad escape', doc('section S "A \\q title"'), [f(3, 'P004')]],
    ['inner quotes', doc('section S "A "quoted" title"'), [f(3, 'P004')]],
    ['spec title not quoted', doc('  title A title'), [f(3, 'P004')]],
    ['good', doc('section S-1.x "A \\"quoted\\" title, é and all"'), []],
  ]);
});

// REQ-SY-007
test('SY-007: operations', () => {
  table([
    ['two words', doc('op f g'), [f(3, 'P031')]],
    ['no name', doc('op'), [f(3, 'P031')]],
    ['good op', doc('op f', '  input a number, b? {x: number, y: string}, c "one, two" | [1, 2], d-e (f, g)', '  result the sum',
      '  tolerance result.sum 0.005', '  tolerance result.count 0', '  audit text', '  request {}'), []],
    ['bad fields', doc('op f', '  input a', '  input a.b number', '  input b?number', '  input', '  input c number, , d number,',
      "  input e 'x, y'", '  input c number', '  input é number', 'op g', '  audit json', 'op', '  input x', '  tolerance result.y'),
    [f(4, 'P017'), f(5, 'P017'), f(6, 'P017'), f(7, 'P017'), f(8, 'P017'), f(8, 'P017'), f(9, 'P017'), f(10, 'P052'),
      f(11, 'P017'), f(13, 'P050'), f(14, 'P031'), f(15, 'P017'), f(16, 'P018')]],
    ['bad tolerances', doc('op f', '  tolerance result.x', '  tolerance result.x -1', '  tolerance result.x 0x10',
      '  tolerance result.x 1 2', '  tolerance result.x 1e-3'), [f(4, 'P018'), f(5, 'P018'), f(6, 'P018'), f(7, 'P018')]],
    ['tolerance paths', doc('op f', '  tolerance foo 0.1', '  tolerance result.x -0', '  tolerance result.y 1e400'), [f(6, 'P018')]],
    ['op request', doc('op f', '  request 5', 'op g', '  request {"input": 5}', 'op h', '  tolerance result.x 1',
      '  tolerance result.y 1', '  tolerance result.x 2'), [f(4, 'P009'), f(6, 'P051'), f(10, 'P052')]],
    ['brackets and quotes', doc('op f', '  input a x], b y', '  input b z', '  input c "a\\", b" x, d y', 'op h',
      '  tolerance result.x 1', '  tolerance result.x result', '  tolerance result.x 2'), [f(5, 'P052'), f(9, 'P018'), f(10, 'P052')]],
  ]);
});

// REQ-SY-008
test('SY-008: the errors list', () => {
  table([
    ['good', doc('errors', '  bad_input when the input is not an object, or', '    when it lacks a field', '  not_found when there is no such thing'), []],
    ['words after errors', doc('errors first', '  e when x'), [f(3, 'P050')]],
    ['bad clauses', doc('errors', '  e if x', '  e when', '    the input is bad', '  when x', '  f when y', '   and z', '  g is', '   wrong'),
      [f(4, 'P019'), f(5, 'P019'), f(7, 'P019'), f(9, 'P006'), f(10, 'P019'), f(11, 'P006')]],
    ['comment in condition is text', doc('errors', '  e when x', '    # It MUST be read.'), [f(4, 'T004')]],
    ['a code may be listed twice', doc('errors', '  e when x', '  f when y', '  e when z'), []],
  ]);
});

// REQ-SY-009
test('SY-009: requirements, open items, decisions, sections and notes', () => {
  table([
    ['all statements', doc('section S "Things"', '  text', '    About things.', 'note', '  text', '    A note.', 'open S-1 "Unsaid"', '  text',
      '    Left open.', 'decision D-1 "Why"', '  source the author', '  status accepted', '  text', '    Because.',
      '  rejected "Another way, because no."', '  rejected "A third way."'), [`s.duramen:12: warning T012`]],
    ['wrong clauses', doc('req A "a"', '  on mac', '  status accepted', '  example f {}', 'note x', 'section S "s"', '  example f {}',
      'decision D "d"', '  title "x"', 'open O "o"', '  decision D'), [f(4, 'P033'), f(5, 'P015'), f(7, 'P050'), f(9, 'P015'), f(11, 'P015'), f(13, 'P015')]],
    ['empty contract and decision', doc('  contract', 'req A "a"', '  decision', '  text', '    Words.'), [f(4, 'T001')]],
  ]);
});

// REQ-SY-010
test('SY-010: examples', () => {
  table([
    ['first lines', doc('req A "a"', '  example', '  example f [1]', '  example f {"x": 1', '  example f 2',
      '  example raw "{\\"id\\": \\"1\\",\\n\\"op\\": \\"f\\"}"'), [f(4, 'P012'), f(5, 'P012'), f(6, 'P009'), f(7, 'P012'), f(8, 'P026')]],
    ['raw forms and lines', doc('req A "a"', '  example raw', '  example raw {"id": "x"}', '  example raw "unclosed', '  example raw "a" "b"',
      '  example raw "carriage\\rreturn"', '  example f [1]', '    expect result', '     expect result = 1', '    expect result ≈ 1',
      '    expect result~1+-0.5', '    expect result="~"', '    expect result =', '    expect = 1', '    request {"a": 1}',
      '    request {"b": 1}', '    omit', '    omit a, b c', '    omit d'),
    [f(4, 'P004'), f(5, 'P004'), f(6, 'P004'), f(7, 'P004'), f(8, 'P026'), f(9, 'P012'), f(10, 'P011'), f(11, 'P006'), f(12, 'P010'),
      f(15, 'P009'), f(16, 'P011'), f(18, 'P052'), f(19, 'P011')]],
    ['raw takes no request, omit, input', doc('req A "a"', "  example raw '{\"id\": \"x\"}'", '    omit', '    request', '    input',
      '  example f {}', '    request', '    input', '    omit ,'), [f(5, 'P022'), f(6, 'P022'), f(7, 'P022'), f(9, 'P009'), f(10, 'P049'), f(11, 'P011')]],
    ['expectation forms', doc('req A "a"', '  example f {}', '    expect result ≈ 1 ± -1', '    expect result ~ 1 +- x', '    expect result ≈ 0x10 ± 1',
      '    expect result = {nope}', '    expect result', '    result = 1', '     expect result = 1', '      expect result = 1',
      '    request [1]', '    request {"input": {}}', "  example raw '{\"id\": \"x\"}'", '    omit id', '    request {"a": 1}',
      '    input files."a"', '      text'),
    [f(5, 'P010'), f(6, 'P010'), f(7, 'P010'), f(8, 'P009'), f(9, 'P011'), f(10, 'P011'), f(11, 'P006'), f(12, 'P006'), f(13, 'P009'),
      f(14, 'P051'), f(16, 'P022'), f(17, 'P022'), f(18, 'P022')]],
    ['request twice', doc('op f', 'req A "a"', '  text', '    T.', '  example f {}', '    request {"a": 1}', '    request [2]',
      '    request {"id": 3}', '    request {"b": 4}'), [f(9, 'P052'), f(10, 'P052'), f(11, 'P052')]],
    ['raw with input lines', doc('op f', 'req A "a"', '  text', '    T.', `  example raw '{"id":"1","op":"f"}'`, '    input files."a" from "nofile"',
      '    input files."b"', '      hello', '  example raw x', '    input files."c" from "nofile"'), [f(8, 'P022'), f(9, 'P022'), f(11, 'P004'), f(12, 'P022')]],
    ['from takes no text', doc('op f', 'req A "a"', '  text', '    T.', `  example raw '{"id":"1","op":"f"}'`,
      '    input files."a" from "nofile"', '      hello', '  example f [1]', '    input a', '      t', '    input a.b', '      u'),
    [f(8, 'P022'), f(9, 'P006'), f(10, 'P012'), f(13, 'P049')]],
  ]);
});

// REQ-SY-011
test('SY-011: texts in an example input', () => {
  assert.deepStrictEqual(withEcho(doc('oracle node echo.mjs', 'op f', '  input files object, n? number', 'req A "a"', '  example f {"n": 1}',
    '    input files."a b"', '      one', '        two', '', '    input files.x', '      three', '', '',
    '    expect result = {"n": 1, "files": {"a b": "one\\n  two\\n", "x": "three\\n"}}')), []);
  table([
    ['paths', doc('req A "a"', '  example f {"x": 1}', '    input files.', '    input files.."a"', '    input "a', '    input x.y', '      text',
      '    input z', '    input y from "missing.txt"'), [f(5, 'P049'), f(6, 'P049'), f(7, 'P049'), f(8, 'P049'), f(10, 'P049'), f(11, 'P048')]],
    ['text ends', doc('req A "a"', '  example f {}', '    input a', '     not six', '      six, but after the line that ended the text'),
      [f(5, 'P049'), f(6, 'P006'), f(7, 'P006')]],
  ]);
  assert.deepStrictEqual(check({
    'r/s.duramen': doc('req A "a"', '  example f {}', '    input a from "../outside.txt"', '    input b from "t.txt"', '      not its text',
      '    input c from "unclosed', '  example f {', '    input d from "../outside.txt"'), 'r/t.txt': 't', 'outside.txt': 'x',
  }, 'r').diagnostics, ['r/s.duramen:5: error P048', 'r/s.duramen:7: error P006', 'r/s.duramen:8: error P049',
    'r/s.duramen:9: error P009', 'r/s.duramen:10: error P048']);
  assert.deepStrictEqual(check({
    'sub/s.duramen': doc('oracle node echo.mjs', 'op f', '  input t? string', 'req A "a"', '  example f {}', '    input t from "data/t.txt"',
      '    expect result = {"t": "hello,\\r\\nworld"}'),
    'sub/echo.mjs': ECHO, 'sub/data/t.txt': 'hello,\r\nworld',
  }).diagnostics, []);
  assert.deepStrictEqual(check({
    's.duramen': doc('oracle node echo.mjs', 'op f', '  input t? json, u? json, a? json', 'req A "a"', '  example f {}', '    input t', '      one',
      '# a comment at indent 0', '  # and one at indent 2', '      two', '    input u from "./sub/..//b.txt"', '      # a comment indented six',
      '    expect result = {"t": "one\\ntwo\\n", "u": "\\ufeffbom"}', '  example f {"a": 1}', '    input x..y from "missing.txt"',
      '    input a.b from "missing.txt"', '    input a.c from "t.txt"', '    input t from "sub"'),
    'echo.mjs': ECHO, 'b.txt': '﻿bom', 't.txt': 't',
  }).diagnostics, [f(17, 'P049'), f(18, 'P048'), f(19, 'P049'), f(20, 'P048')]);
});

// REQ-SY-012
test('SY-012: tables', () => {
  assert.deepStrictEqual(withEcho(doc('oracle node echo.mjs', 'op f', '  input x? json, y? json', 'req A "a"', '  table f',
    '    | x        | y | result.x | result.y ± 0.5 |', '    |----------|---|:--------:|----------------|',
    '    | "a\\|b"   |   | "a\\|b"   |                |', '    | 1        | 2 | ?        | 2.4            |')), []);
  assert.deepStrictEqual(withEcho(doc('oracle node echo.mjs', 'op f', '  input x? json', 'req A "a"', '  table f', '    |---|----------|',
    '    | x | result.x |', '    |   |', '    | 1 | 1', '    |', '    | 2 | 2        |')), []);
  table([
    ['table errors', doc('req A "a"', '  table f', '  table f g', '    | x |', '    | 1 |', '  table f', '    | x |', '  table f',
      '    | x | result ± -1 |', '    | 1 | 2           |', '  table f', '    | x | result ± 0.5 |', '    | 1 | "2"          |',
      '  table f', '    | x | y |', '    | 1 |', '    | {  | 2 |', '    x | 1', '  table f', '    | x | |', '    | 1 | 2 |',
      '  table f', '    | x ± 1 |', '    | 1     |'),
    [f(4, 'P013'), f(5, 'P013'), f(8, 'P013'), f(11, 'P010'), f(15, 'P010'), f(18, 'P014'), f(19, 'P009'), f(20, 'P006'), f(22, 'P013'),
      f(25, 'P010')]],
    ['more table errors', doc('req A "a"', '  table f g', '    | x |', '    | {bad |', '  table f', '   | x |', '    | 1 |', '  table f',
      '    | a.b | result |', '    | 1   | 2      |', '  table f', '    | x | result ± lots |', '    | 1 | "two"         |',
      '  table f', '    | x | result ± 1 2 | result.y+-0.5 |', '    | 1 | 2            | 3             |', '  table f', '    | x | x |',
      '    | 1 | 2 |', '  table f', '    | x | result ± 0.5 |', '    | 1 | 2.25 [       |', '    | { | ?            |'),
    [f(4, 'P013'), f(7, 'P013'), f(8, 'P006'), f(11, 'P013'), f(14, 'P010'), f(17, 'P010'), f(20, 'P013'), f(24, 'P010'), f(25, 'P009')]],
    ['tolerance after input, bad header cell', doc('op f', '  input a int', 'req A "a"', '  text', '    T.', '  table f',
      '    | a ± 1 | b! | result ± x |', '    | 1 | 2 | 3 |'), [f(9, 'P010'), f(9, 'P013')]],
  ]);
  assert.deepStrictEqual(check({
    's.duramen': 'duramen 0.1\nspec s 1\noracle node echo.mjs\nop f\n  input answer? json, id? json\nreq A "a"\n  table f\n' +
      '    | answer | result.k=1 | result.k~2 ± 0.5 | id |\n    | ---\t|---|:-:|　|\n' +
      '    | {"result": {"k=1": 1, "k~2": 2.25}} | 1 | 2 | "A#1" |\n  table f\n    | answer | result.a b |\n    | 1 | 2 |\n',
    'echo.mjs': ECHO,
  }).diagnostics, [f(12, 'P013')]);
});

// REQ-SY-013
test('SY-013: numbers too large for binary64', () => {
  table([
    ['P009 everywhere JSON is', doc('  request {"x": 1e400}', 'op f', '  input a int', 'req A "a"', '  text', '    T.', '  example f {"a": 1e400}',
      '  example f {"a": 1}', '    expect result.a = [1, -1e400]', '    request {"y": 1e999}', '  table f', '    | a | result |', '    | 1e999 | 1 |',
      `  example raw '{"id":"r","op":"f","input":{"a":1e400}}'`), [f(3, 'P009'), f(9, 'P009'), f(11, 'P009'), f(12, 'P009'), f(15, 'P009')]],
    ['P010 and P018', doc('op f', '  input a int', '  tolerance result.x 1e400', 'req A "a"', '  text', '    T.', '  example f {"a": 1}',
      '    expect result ≈ 1e400 ± 1', '    expect result ≈ 1 ± 1e400', '  table f', '    | a | result ± 1e400 |', '    | 1 | 2 |',
      '  table f', '    | a | result ± 1 |', '    | 1 | 1e400 |'), [f(5, 'P018'), f(10, 'P010'), f(11, 'P010'), f(13, 'P010'), f(17, 'P010')]],
    ['P009 alone', doc('op f', '  request {"id": 1e400}', 'req A "a"', '  text', '    T.', '  example f [1e400]', '  example f 1e400'),
      [f(4, 'P009'), f(8, 'P009'), f(9, 'P009')]],
  ]);
});
