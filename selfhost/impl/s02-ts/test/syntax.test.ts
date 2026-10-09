import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, ECHO } from './helpers.ts';

const H = 'duramen 0.1\nspec s 1\n';
const d = (text: string, extra: Record<string, string> = {}) => check({ 's.duramen': text, ...extra });
const table = (rows: [string, string, string[]][]) => {
  for (const [name, text, want] of rows) assert.deepEqual(d(text), want, name);
};

test('REQ-SY-001: lines', () => {
  table([
    ['bom, CR, CRLF, trailing white space', '﻿duramen 0.1\r\nspec s 1\rnote  \n  text\t\n    Some text.  \r\n', []],
    ['tab indent', H + '\tnote\n', ['s.duramen:3: error P001']],
    ['tab after spaces', H + 'note\n  \ttext\n', ['s.duramen:4: error P001']],
    ['nbsp indent', H + ' note\n', ['s.duramen:3: error P001']],
    ['blank lines of white space', '  \t \nduramen 0.1\n\t\nspec s 1\n   \n', []],
  ]);
});

test('REQ-SY-002: statements and comments', () => {
  table([
    ['unknown statements', '# A comment.\nduramen 0.1\n#A comment too.\nspec s 1\nfrobnicate this\n  title "ignored"\n    ignored too\nNote\n',
      ['s.duramen:5: error P002', 's.duramen:8: error P002']],
    ['indented before first statement', '  indented\n # indented too\nduramen 0.1\nspec s 1\n', ['s.duramen:1: error P003', 's.duramen:2: error P003']],
  ]);
});

test('REQ-SY-003: clauses', () => {
  table([
    ['comments and text', H + 'note\n  # A comment.\n  text\n    Text.\n    # Text, not a comment.\n', []],
    ['one space', H + 'note\n text\n', ['s.duramen:4: error P007']],
    ['no clause yet', H + 'note\n    Text without a clause.\n  text\n    Text.\n', ['s.duramen:4: error P006']],
    ['unknown clauses', H + '  colour blue\n    more\nnote\n  example f {}\n    expect result = 1\n', ['s.duramen:3: error P015', 's.duramen:6: error P015']],
    ['hash at odd indents', H + 'note\n # not a comment here\n    # nor here\n  text\n    Text.\n', ['s.duramen:4: error P007', 's.duramen:5: error P006']],
    ['second clause', H + '  title "one"\n  title "two"\n    more\nnote\n  text\n    One.\n  text Two.\ndecision D "d"\n  source a\n  source b\n  status accepted\n  status rejected\n',
      ['s.duramen:4: error P052', 's.duramen:9: error P052', 's.duramen:12: error P052', 's.duramen:14: error P052']],
    ['lines under a title', H + '  title "A title"\n    that goes on\n  # A comment.\n    # Another.\n', ['s.duramen:4: error P006']],
  ]);
});

test('REQ-SY-004: duramen, spec, oracle', () => {
  table([
    ['duramen takes no clauses', 'duramen 0.1\n  title "x"\nspec s 1\n', ['s.duramen:2: error P015']],
    ['spec without version', 'duramen 0.1\nspec s\n', ['s.duramen:2: error P021']],
    ['spec with three words', 'duramen 0.1\nspec s 1 2\n', ['s.duramen:2: error P021']],
    ['spec with all clauses', 'duramen 0.1\nspec s 1.0.0-beta\n  title "The s program"\n  contract s-out-2\n  request {"clock": "2026-01-01T00:00:00Z", "n": 1}\n  text\n    What s is.\n', []],
    ['request not JSON', H + '  request {"clock":\n', ['s.duramen:3: error P009']],
    ['request not an object', H + '  request ["clock"]\n', ['s.duramen:3: error P009']],
    ['request sets op', H + '  request {"op": "x"}\n', ['s.duramen:3: error P051']],
    ['oracle without command', H + 'oracle\n', ['s.duramen:3: error P028']],
    ['oracle clauses', H + 'oracle node model.mjs --quiet\n  source model.mjs, lib/a.mjs lib/b.mjs\n  timeout 5\n', ['s.duramen:5: error P015']],
  ]);
});

test('REQ-SY-005: text', () => {
  table([
    ['text with a word after it', H + 'note\n  text Here.\n', ['s.duramen:4: error P008']],
    ['text indented three', H + 'note\n  text\n    One.\n   Two.\n', ['s.duramen:6: error P008']],
    ['hash line is text', H + 'note\n  text\n    # It MUST be text.\n', ['s.duramen:3: error T004']],
  ]);
});

test('REQ-SY-006: quoted strings, IDs and titles', () => {
  table([
    ['unquoted title', H + 'section S A title\n', ['s.duramen:3: error P005']],
    ['text after title', H + 'section S "A title" and more\n', ['s.duramen:3: error P005']],
    ['no title', H + 'section S\n', ['s.duramen:3: error P005']],
    ['unclosed and doubled', H + 'section S "unclosed\nsection T "A" "B"\n', ['s.duramen:3: error P005', 's.duramen:4: error P004']],
    ['bad escape', H + 'section S "A \\q title"\n', ['s.duramen:3: error P004']],
    ['inner quotes', H + 'section S "A "quoted" title"\n', ['s.duramen:3: error P004']],
    ['unquoted spec title', H + '  title A title\n', ['s.duramen:3: error P004']],
    ['good', H + 'section S-1.x "A \\"quoted\\" title, é and all"\n', []],
  ]);
});

test('REQ-SY-007: operations', () => {
  table([
    ['op with two words', H + 'op f g\n', ['s.duramen:3: error P031']],
    ['op without name', H + 'op\n', ['s.duramen:3: error P031']],
    ['all clauses', H + 'op f\n  input a number, b? {x: number, y: string}, c "one, two" | [1, 2], d-e (f, g)\n  result the sum\n  tolerance result.sum 0.005\n  tolerance result.count 0\n  audit text\n  request {}\n', []],
    ['bad fields', H + 'op f\n  input a\n  input a.b number\n  input b?number\n', ['s.duramen:4: error P017', 's.duramen:5: error P017', 's.duramen:6: error P017']],
    ['bad tolerances', H + 'op f\n  tolerance result.x\n  tolerance result.x -1\n  tolerance result.x 0x10\n  tolerance result.x 1 2\n  tolerance result.x 1e-3\n',
      ['s.duramen:4: error P018', 's.duramen:5: error P018', 's.duramen:6: error P018', 's.duramen:7: error P018']],
    ['requests and duplicate tolerances', H + 'op f\n  request 5\nop g\n  request {"input": 5}\nop h\n  tolerance result.x 1\n  tolerance result.y 1\n  tolerance result.x 2\n',
      ['s.duramen:4: error P009', 's.duramen:6: error P051', 's.duramen:10: error P052']],
  ]);
});

test('REQ-SY-008: the errors list', () => {
  table([
    ['good', H + 'errors\n  bad_input when the input is not an object, or\n    when it lacks a field\n  not_found when there is no such thing\n', []],
    ['words after errors', H + 'errors first\n  e when x\n', ['s.duramen:3: error P050']],
    ['bad clauses', H + 'errors\n  e if x\n  e when\n    the input is bad\n  when x\n  f when y\n   and z\n',
      ['s.duramen:4: error P019', 's.duramen:5: error P019', 's.duramen:7: error P019', 's.duramen:9: error P006']],
    ['hash line is condition', H + 'errors\n  e when x\n    # It MUST be read.\n', ['s.duramen:4: error T004']],
  ]);
});

test('REQ-SY-009: requirements, open items, decisions, sections, notes', () => {
  table([
    ['all statements', H + 'section S "Things"\n  text\n    About things.\nnote\n  text\n    A note.\nopen S-1 "Unsaid"\n  text\n    Left open.\ndecision D-1 "Why"\n  source the author\n  status accepted\n  text\n    Because.\n  rejected "Another way, because no."\n  rejected "A third way."\n',
      ['s.duramen:12: warning T012']],
    ['wrong clauses', H + 'req A "a"\n  on mac\n  status accepted\n  example f {}\nnote x\nsection S "s"\n  example f {}\ndecision D "d"\n  title "x"\nopen O "o"\n  decision D\n',
      ['s.duramen:4: error P033', 's.duramen:5: error P015', 's.duramen:7: error P050', 's.duramen:9: error P015', 's.duramen:11: error P015', 's.duramen:13: error P015']],
  ]);
});

test('REQ-SY-010: examples', () => {
  table([
    ['first lines', H + 'req A "a"\n  example\n  example f [1]\n  example f {"x": 1\n  example f 2\n  example raw "{\\"id\\": \\"1\\",\\n\\"op\\": \\"f\\"}"\n',
      ['s.duramen:4: error P012', 's.duramen:5: error P012', 's.duramen:6: error P009', 's.duramen:7: error P012', 's.duramen:8: error P026']],
    ['raw and expect forms', H + 'req A "a"\n  example raw\n  example raw {"id": "x"}\n  example raw "unclosed\n  example raw "a" "b"\n  example raw "carriage\\rreturn"\n  example f [1]\n    expect result\n     expect result = 1\n    expect result ≈ 1\n    expect result~1+-0.5\n    expect result="~"\n',
      ['s.duramen:4: error P004', 's.duramen:5: error P004', 's.duramen:6: error P004', 's.duramen:7: error P004', 's.duramen:8: error P026', 's.duramen:9: error P012', 's.duramen:10: error P011', 's.duramen:11: error P006', 's.duramen:12: error P010']],
    ['lines under examples', H + 'req A "a"\n  example f {}\n    expect result ≈ 1 ± -1\n    expect result ~ 1 +- x\n    expect result ≈ 0x10 ± 1\n    expect result = {nope}\n    expect result\n    result = 1\n     expect result = 1\n      expect result = 1\n    request [1]\n    request {"input": {}}\n  example raw \'{"id": "x"}\'\n    omit id\n    request {"a": 1}\n    input files."a"\n      text\n',
      ['s.duramen:5: error P010', 's.duramen:6: error P010', 's.duramen:7: error P010', 's.duramen:8: error P009', 's.duramen:9: error P011', 's.duramen:10: error P011', 's.duramen:11: error P006', 's.duramen:12: error P006', 's.duramen:13: error P009', 's.duramen:14: error P051', 's.duramen:16: error P022', 's.duramen:17: error P022', 's.duramen:18: error P022']],
  ]);
});

test('REQ-SY-011: texts in an example input', () => {
  const echoRec = H + 'oracle node echo.mjs\nop f\n  input files object, n? number\nreq A "a"\n  example f {"n": 1}\n    input files."a b"\n      one\n        two\n\n    input files.x\n      three\n\n\n    expect result = {"n": 1, "files": {"a b": "one\\n  two\\n", "x": "three\\n"}}\n';
  assert.deepEqual(d(echoRec, { 'echo.mjs': ECHO }), []);
  table([
    ['bad paths', H + 'req A "a"\n  example f {"x": 1}\n    input files.\n    input files.."a"\n    input "a\n    input x.y\n      text\n    input z\n    input y from "missing.txt"\n',
      ['s.duramen:5: error P049', 's.duramen:6: error P049', 's.duramen:7: error P049', 's.duramen:8: error P049', 's.duramen:10: error P049', 's.duramen:11: error P048']],
  ]);
  assert.deepEqual(check({
    'r/s.duramen': H + 'req A "a"\n  example f {}\n    input a from "../outside.txt"\n    input b from "t.txt"\n      not its text\n    input c from "unclosed\n',
    'r/t.txt': 't\n', 'outside.txt': 'x',
  }, 'r'), ['r/s.duramen:5: error P048', 'r/s.duramen:7: error P006', 'r/s.duramen:8: error P049']);
  assert.deepEqual(check({
    'sub/s.duramen': H + 'oracle node echo.mjs\nop f\n  input t? string\nreq A "a"\n  example f {}\n    input t from "data/t.txt"\n    expect result = {"t": "hello,\\r\\nworld"}\n',
    'sub/data/t.txt': 'hello,\r\nworld', 'sub/echo.mjs': ECHO,
  }), []);
});

test('REQ-SY-012: tables', () => {
  const tbl = H + 'oracle node echo.mjs\nop f\n  input x? json, y? json\nreq A "a"\n  table f\n    | x        | y | result.x | result.y ± 0.5 |\n    |----------|---|:--------:|----------------|\n    | "a\\|b"   |   | "a\\|b"   |                |\n    | 1        | 2 | ?        | 2.4            |\n';
  assert.deepEqual(d(tbl, { 'echo.mjs': ECHO }), []);
  table([
    ['table errors', H + 'req A "a"\n  table f\n  table f g\n    | x |\n    | 1 |\n  table f\n    | x |\n  table f\n    | x | result ± -1 |\n    | 1 | 2           |\n  table f\n    | x | result ± 0.5 |\n    | 1 | "2"          |\n  table f\n    | x | y |\n    | 1 |\n    | {  | 2 |\n    x | 1\n  table f\n    | x | |\n    | 1 | 2 |\n  table f\n    | x ± 1 |\n    | 1     |\n',
      ['s.duramen:4: error P013', 's.duramen:5: error P013', 's.duramen:8: error P013', 's.duramen:11: error P010', 's.duramen:15: error P010', 's.duramen:18: error P014', 's.duramen:19: error P009', 's.duramen:20: error P006', 's.duramen:22: error P013', 's.duramen:25: error P010']],
    ['more table errors', H + 'req A "a"\n  table f g\n    | x |\n    | {bad |\n  table f\n   | x |\n    | 1 |\n  table f\n    | a.b | result |\n    | 1   | 2      |\n  table f\n    | x | result ± lots |\n    | 1 | "two"         |\n',
      ['s.duramen:4: error P013', 's.duramen:7: error P013', 's.duramen:8: error P006', 's.duramen:11: error P013', 's.duramen:14: error P010']],
  ]);
  const odd = H + 'oracle node echo.mjs\nop f\n  input x? json\nreq A "a"\n  table f\n    |---|----------|\n    | x | result.x |\n    |   |\n    | 1 | 1\n    |\n    | 2 | 2        |\n';
  assert.deepEqual(d(odd, { 'echo.mjs': ECHO }), []);
});
