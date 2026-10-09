import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECHO, check, diags, one, t } from './helper.ts';

const H = 'duramen 0.1\nspec s 1\n';

function table(rows: [string, string[], Record<string, string>?][]): void {
  rows.forEach(([text, expected, extra], i) => {
    assert.deepEqual(one(text, extra ?? {}), expected, `row ${i}: ${JSON.stringify(text)}`);
  });
}

test('REQ-SY-001 lines', () => {
  table([
    [
      'duramen 0.1\nspec s 1\n  title "a b"\noracle node echo.mjs\nop f\n  input x? {a: b}, y? json\nerrors\n  e when x y\nreq A "A title"\n  example f {"x": "p q"}\n    expect result.x = "p q"\n    expect result.x = "p q"\n  example f {}\n    input y."k l"\n      text\n    expect result.y = {"k l": "text\\n"}\n  example raw \'{"id":"r","op":"f","input":{"x":" "}}\'\n  example f {"x": 1}\n    expect result.x ≈ 1 ± 0\n',
      [],
      { 'echo.mjs': ECHO },
    ],
    ['\ufeffduramen 0.1\r\nspec s 1\rnote  \n  text\t\n    Some text.  \r\n', []],
    ['duramen 0.1\nspec s 1\n\tnote\n', ['s.duramen:3: error P001']],
    ['duramen 0.1\nspec s 1\nnote\n  \ttext\n', ['s.duramen:4: error P001']],
    ['duramen 0.1\nspec s 1\n\u00a0note\n', ['s.duramen:3: error P001']],
    ['  \t \nduramen 0.1\n\t\nspec s 1\n   \n', []],
    ['duramen 0.1\u3000\nspec s 1\u2028\nnote\n\u205f text\n', ['s.duramen:4: error P001']],
  ]);
});

test('REQ-SY-002 statements and comments', () => {
  table([
    [
      '# A comment.\nduramen 0.1\n#A comment too.\nspec s 1\nfrobnicate this\n  title "ignored"\n    ignored too\nNote\n',
      ['s.duramen:5: error P002', 's.duramen:8: error P002'],
    ],
    ['  indented\n # indented too\nduramen 0.1\nspec s 1\n', ['s.duramen:1: error P003', 's.duramen:2: error P003']],
  ]);
});

test('REQ-SY-003 clauses', () => {
  table([
    [H + 'note\n  # A comment.\n  text\n    Text.\n    # Text, not a comment.\n', []],
    [H + 'note\n text\n', ['s.duramen:4: error P007']],
    [H + 'note\n    Text without a clause.\n  text\n    Text.\n', ['s.duramen:4: error P006']],
    [H + '  colour blue\n    more\nnote\n  example f {}\n    expect result = 1\n', ['s.duramen:3: error P015', 's.duramen:6: error P015']],
    [H + 'note\n # not a comment here\n    # nor here\n  text\n    Text.\n', ['s.duramen:4: error P007', 's.duramen:5: error P006']],
    [
      H + '  title "one"\n  title "two"\n    more\nnote\n  text\n    One.\n  text Two.\ndecision D "d"\n  source a\n  source b\n  status accepted\n  status rejected\n',
      ['s.duramen:4: error P052', 's.duramen:9: error P052', 's.duramen:12: error P052', 's.duramen:14: error P052'],
    ],
    [
      H + '  title x\n  title "two"\nop f\n  request [1]\n  request {}\n',
      ['s.duramen:3: error P004', 's.duramen:4: error P052', 's.duramen:6: error P009', 's.duramen:7: error P052'],
    ],
    [H + '  title "A title"\n    that goes on\n  # A comment.\n    # Another.\n', ['s.duramen:4: error P006']],
  ]);
});

test('REQ-SY-004 duramen, spec and oracle statements', () => {
  table([
    ['duramen 0.1\n  title "x"\nspec s 1\n', ['s.duramen:2: error P015']],
    ['duramen 0.1\nspec s\n', ['s.duramen:2: error P021']],
    ['duramen 0.1\nspec s 1 2\n', ['s.duramen:2: error P021']],
    [
      'duramen 0.1\nspec s 1.0.0-beta\n  title "The s program"\n  contract s-out-2\n  request {"clock": "2026-01-01T00:00:00Z", "n": 1}\n  text\n    What s is.\n',
      [],
    ],
    [H + '  request {"clock":\n', ['s.duramen:3: error P009']],
    [H + '  request ["clock"]\n', ['s.duramen:3: error P009']],
    [H + '  request {"op": "x"}\n', ['s.duramen:3: error P051']],
    [H + 'oracle\n', ['s.duramen:3: error P028']],
    [H + 'oracle node model.mjs --quiet\n  source model.mjs, lib/a.mjs lib/b.mjs\n  timeout 5\n', ['s.duramen:5: error P015']],
  ]);
});

test('REQ-SY-005 text', () => {
  table([
    [H + 'note\n  text Here.\n', ['s.duramen:4: error P008']],
    [H + 'note\n  text\n    One.\n   Two.\n', ['s.duramen:6: error P008']],
    [H + 'note\n  text\n    # It MUST be text.\n', ['s.duramen:3: error T004']],
  ]);
});

test('REQ-SY-006 quoted strings, IDs and titles', () => {
  table([
    [H + 'section S A title\n', ['s.duramen:3: error P005']],
    [H + 'section S "A title" and more\n', ['s.duramen:3: error P005']],
    [H + 'section S\n', ['s.duramen:3: error P005']],
    [H + 'section S "unclosed\nsection T "A" "B"\nsection U "\n', ['s.duramen:3: error P005', 's.duramen:4: error P004', 's.duramen:5: error P005']],
    [H + 'section S "A \\q title"\n', ['s.duramen:3: error P004']],
    [H + 'section S "A "quoted" title"\n', ['s.duramen:3: error P004']],
    [H + '  title A title\n', ['s.duramen:3: error P004']],
    [H + 'section S-1.x "A \\"quoted\\" title, é and all"\n', []],
  ]);
});

test('REQ-SY-007 operations', () => {
  table([
    [H + 'op f g\n', ['s.duramen:3: error P031']],
    [H + 'op\n', ['s.duramen:3: error P031']],
    [
      H + 'op f\n  input a number, b? {x: number, y: string}, c "one, two" | [1, 2], d-e (f, g)\n  result the sum\n  tolerance result.sum 0.005\n  tolerance result.count 0\n  audit text\n  request {}\n',
      [],
    ],
    [
      H + "op f\n  input a\n  input a.b number\n  input b?number\n  input\n  input c number, , d number,\n  input e 'x, y'\n  input c number\n  input é number\nop g\n  audit json\nop\n  input x\n  tolerance result.y\n",
      [
        's.duramen:4: error P017', 's.duramen:5: error P017', 's.duramen:6: error P017', 's.duramen:7: error P017',
        's.duramen:8: error P017', 's.duramen:8: error P017', 's.duramen:9: error P017', 's.duramen:10: error P052',
        's.duramen:11: error P017', 's.duramen:13: error P050', 's.duramen:14: error P031', 's.duramen:15: error P017',
        's.duramen:16: error P018',
      ],
    ],
    [
      H + 'op f\n  tolerance result.x\n  tolerance result.x -1\n  tolerance result.x 0x10\n  tolerance result.x 1 2\n  tolerance result.x 1e-3\n',
      ['s.duramen:4: error P018', 's.duramen:5: error P018', 's.duramen:6: error P018', 's.duramen:7: error P018'],
    ],
    [H + 'op f\n  tolerance foo 0.1\n  tolerance result.x -0\n  tolerance result.y 1e400\n', ['s.duramen:6: error P018']],
    [
      H + 'op f\n  request 5\nop g\n  request {"input": 5}\nop h\n  tolerance result.x 1\n  tolerance result.y 1\n  tolerance result.x 2\n',
      ['s.duramen:4: error P009', 's.duramen:6: error P051', 's.duramen:10: error P052'],
    ],
    [
      H + 'op f\n  input a x], b y\n  input b z\n  input c "a\\", b" x, d y\nop h\n  tolerance result.x 1\n  tolerance result.x result\n  tolerance result.x 2\n',
      ['s.duramen:5: error P052', 's.duramen:9: error P018', 's.duramen:10: error P052'],
    ],
  ]);
});

test('REQ-SY-008 the errors list', () => {
  table([
    [H + 'errors\n  bad_input when the input is not an object, or\n    when it lacks a field\n  not_found when there is no such thing\n', []],
    [H + 'errors first\n  e when x\n', ['s.duramen:3: error P050']],
    [
      H + 'errors\n  e if x\n  e when\n    the input is bad\n  when x\n  f when y\n   and z\n  g is\n   wrong\n',
      ['s.duramen:4: error P019', 's.duramen:5: error P019', 's.duramen:7: error P019', 's.duramen:9: error P006', 's.duramen:10: error P019', 's.duramen:11: error P006'],
    ],
    [H + 'errors\n  e when x\n    # It MUST be read.\n', ['s.duramen:4: error T004']],
    [H + 'errors\n  e when x\n  f when y\n  e when z\n', []],
  ]);
});

test('REQ-SY-009 statements', () => {
  table([
    [
      H + 'section S "Things"\n  text\n    About things.\nnote\n  text\n    A note.\nopen S-1 "Unsaid"\n  text\n    Left open.\ndecision D-1 "Why"\n  source the author\n  status accepted\n  text\n    Because.\n  rejected "Another way, because no."\n  rejected "A third way."\n',
      ['s.duramen:12: warning T012'],
    ],
    [
      H + 'req A "a"\n  on mac\n  status accepted\n  example f {}\nnote x\nsection S "s"\n  example f {}\ndecision D "d"\n  title "x"\nopen O "o"\n  decision D\n',
      ['s.duramen:4: error P033', 's.duramen:5: error P015', 's.duramen:7: error P050', 's.duramen:9: error P015', 's.duramen:11: error P015', 's.duramen:13: error P015'],
    ],
    [H + '  contract\nreq A "a"\n  decision\n  text\n    Words.\n', ['s.duramen:4: error T001']],
  ]);
});

test('REQ-SY-010 examples', () => {
  table([
    [
      H + 'req A "a"\n  example\n  example f [1]\n  example f {"x": 1\n  example f 2\n  example raw "{\\"id\\": \\"1\\",\\n\\"op\\": \\"f\\"}"\n',
      ['s.duramen:4: error P012', 's.duramen:5: error P012', 's.duramen:6: error P009', 's.duramen:7: error P012', 's.duramen:8: error P026'],
    ],
    [
      H + 'req A "a"\n  example raw\n  example raw {"id": "x"}\n  example raw "unclosed\n  example raw "a" "b"\n  example raw "carriage\\rreturn"\n  example f [1]\n    expect result\n     expect result = 1\n    expect result ≈ 1\n    expect result~1+-0.5\n    expect result="~"\n    expect result =\n    expect = 1\n    request {"a": 1}\n    request {"b": 1}\n    omit\n    omit a, b c\n    omit d\n',
      [
        's.duramen:4: error P004', 's.duramen:5: error P004', 's.duramen:6: error P004', 's.duramen:7: error P004',
        's.duramen:8: error P026', 's.duramen:9: error P012', 's.duramen:10: error P011', 's.duramen:11: error P006',
        's.duramen:12: error P010', 's.duramen:15: error P009', 's.duramen:16: error P011', 's.duramen:18: error P052',
        's.duramen:19: error P011',
      ],
    ],
    [
      H + 'req A "a"\n  example raw \'{"id": "x"}\'\n    omit\n    request\n    input\n  example f {}\n    request\n    input\n    omit ,\n',
      ['s.duramen:5: error P022', 's.duramen:6: error P022', 's.duramen:7: error P022', 's.duramen:9: error P009', 's.duramen:10: error P049', 's.duramen:11: error P011'],
    ],
    [
      H + 'req A "a"\n  example f {}\n    expect result ≈ 1 ± -1\n    expect result ~ 1 +- x\n    expect result ≈ 0x10 ± 1\n    expect result = {nope}\n    expect result\n    result = 1\n     expect result = 1\n      expect result = 1\n    request [1]\n    request {"input": {}}\n  example raw \'{"id": "x"}\'\n    omit id\n    request {"a": 1}\n    input files."a"\n      text\n',
      [
        's.duramen:5: error P010', 's.duramen:6: error P010', 's.duramen:7: error P010', 's.duramen:8: error P009',
        's.duramen:9: error P011', 's.duramen:10: error P011', 's.duramen:11: error P006', 's.duramen:12: error P006',
        's.duramen:13: error P009', 's.duramen:14: error P051', 's.duramen:16: error P022', 's.duramen:17: error P022',
        's.duramen:18: error P022',
      ],
    ],
    [
      H + 'op f\nreq A "a"\n  text\n    T.\n  example f {}\n    request {"a": 1}\n    request [2]\n    request {"id": 3}\n    request {"b": 4}\n',
      ['s.duramen:9: error P052', 's.duramen:10: error P052', 's.duramen:11: error P052'],
    ],
    [
      H + 'op f\nreq A "a"\n  text\n    T.\n  example raw \'{"id":"1","op":"f"}\'\n    input files."a" from "nofile"\n    input files."b"\n      hello\n  example raw x\n    input files."c" from "nofile"\n',
      ['s.duramen:8: error P022', 's.duramen:9: error P022', 's.duramen:11: error P004', 's.duramen:12: error P022'],
    ],
    [
      H + 'op f\nreq A "a"\n  text\n    T.\n  example raw \'{"id":"1","op":"f"}\'\n    input files."a" from "nofile"\n      hello\n  example f [1]\n    input a\n      t\n    input a.b\n      u\n',
      ['s.duramen:8: error P022', 's.duramen:9: error P006', 's.duramen:10: error P012', 's.duramen:13: error P049'],
    ],
  ]);
});

test('REQ-SY-011 texts in an example input', () => {
  table([
    [
      H + 'oracle node echo.mjs\nop f\n  input files object, n? number\nreq A "a"\n  example f {"n": 1}\n    input files."a b"\n      one\n        two\n\n    input files.x\n      three\n\n\n    expect result = {"n": 1, "files": {"a b": "one\\n  two\\n", "x": "three\\n"}}\n',
      [],
      { 'echo.mjs': ECHO },
    ],
    [
      H + 'req A "a"\n  example f {"x": 1}\n    input files.\n    input files.."a"\n    input "a\n    input x.y\n      text\n    input z\n    input y from "missing.txt"\n',
      ['s.duramen:5: error P049', 's.duramen:6: error P049', 's.duramen:7: error P049', 's.duramen:8: error P049', 's.duramen:10: error P049', 's.duramen:11: error P048'],
    ],
    [
      H + 'req A "a"\n  example f {}\n    input a\n     not six\n      six, but after the line that ended the text\n',
      ['s.duramen:5: error P049', 's.duramen:6: error P006', 's.duramen:7: error P006'],
    ],
  ]);
  assert.deepEqual(
    diags(
      {
        'r/s.duramen': H + 'req A "a"\n  example f {}\n    input a from "../outside.txt"\n    input b from "t.txt"\n      not its text\n    input c from "unclosed\n  example f {\n    input d from "../outside.txt"\n',
        'r/t.txt': 't\n',
        'outside.txt': 'x',
      },
      'r',
    ),
    ['r/s.duramen:5: error P048', 'r/s.duramen:7: error P006', 'r/s.duramen:8: error P049', 'r/s.duramen:9: error P009', 'r/s.duramen:10: error P048'],
  );
  assert.deepEqual(
    diags({
      'sub/s.duramen': 'duramen 0.1\nspec s 1\noracle node echo.mjs\nop f\n  input t? string\nreq A "a"\n  example f {}\n    input t from "data/t.txt"\n    expect result = {"t": "hello,\\r\\nworld"}\n',
      'sub/echo.mjs': ECHO,
      'sub/data/t.txt': 'hello,\r\nworld',
    }),
    [],
  );
  assert.deepEqual(
    diags({
      's.duramen':
        H +
        'oracle node echo.mjs\nop f\n  input t? json, u? json, a? json\nreq A "a"\n  example f {}\n    input t\n      one\n# a comment at indent 0\n  # and one at indent 2\n      two\n    input u from "./sub/..//b.txt"\n      # a comment indented six\n    expect result = {"t": "one\\ntwo\\n", "u": "\\ufeffbom"}\n  example f {"a": 1}\n    input x..y from "missing.txt"\n    input a.b from "missing.txt"\n    input a.c from "t.txt"\n    input t from "sub"\n',
      'echo.mjs': ECHO,
      'b.txt': '\ufeffbom',
      't.txt': 't',
    }),
    ['s.duramen:17: error P049', 's.duramen:18: error P048', 's.duramen:19: error P049', 's.duramen:20: error P048'],
  );
});

test('REQ-SY-012 tables', () => {
  table([
    [
      H + 'oracle node echo.mjs\nop f\n  input x? json, y? json\nreq A "a"\n  table f\n    | x        | y | result.x | result.y ± 0.5 |\n    |----------|---|:--------:|----------------|\n    | "a\\|b"   |   | "a\\|b"   |                |\n    | 1        | 2 | ?        | 2.4            |\n',
      [],
      { 'echo.mjs': ECHO },
    ],
    [
      H + 'req A "a"\n  table f\n  table f g\n    | x |\n    | 1 |\n  table f\n    | x |\n  table f\n    | x | result ± -1 |\n    | 1 | 2           |\n  table f\n    | x | result ± 0.5 |\n    | 1 | "2"          |\n  table f\n    | x | y |\n    | 1 |\n    | {  | 2 |\n    x | 1\n  table f\n    | x | |\n    | 1 | 2 |\n  table f\n    | x ± 1 |\n    | 1     |\n',
      [
        's.duramen:4: error P013', 's.duramen:5: error P013', 's.duramen:8: error P013', 's.duramen:11: error P010',
        's.duramen:15: error P010', 's.duramen:18: error P014', 's.duramen:19: error P009', 's.duramen:20: error P006',
        's.duramen:22: error P013', 's.duramen:25: error P010',
      ],
    ],
    [
      H + 'req A "a"\n  table f g\n    | x |\n    | {bad |\n  table f\n   | x |\n    | 1 |\n  table f\n    | a.b | result |\n    | 1   | 2      |\n  table f\n    | x | result ± lots |\n    | 1 | "two"         |\n  table f\n    | x | result ± 1 2 | result.y+-0.5 |\n    | 1 | 2            | 3             |\n  table f\n    | x | x |\n    | 1 | 2 |\n  table f\n    | x | result ± 0.5 |\n    | 1 | 2.25 [       |\n    | { | ?            |\n',
      [
        's.duramen:4: error P013', 's.duramen:7: error P013', 's.duramen:8: error P006', 's.duramen:11: error P013',
        's.duramen:14: error P010', 's.duramen:17: error P010', 's.duramen:20: error P013', 's.duramen:24: error P010',
        's.duramen:25: error P009',
      ],
    ],
    [
      H + 'oracle node echo.mjs\nop f\n  input x? json\nreq A "a"\n  table f\n    |---|----------|\n    | x | result.x |\n    |   |\n    | 1 | 1\n    |\n    | 2 | 2        |\n',
      [],
      { 'echo.mjs': ECHO },
    ],
    [
      H + 'op f\n  input a int\nreq A "a"\n  text\n    T.\n  table f\n    | a ± 1 | b! | result ± x |\n    | 1 | 2 | 3 |\n',
      ['s.duramen:9: error P010', 's.duramen:9: error P013'],
    ],
  ]);
  assert.deepEqual(
    diags({
      's.duramen':
        'duramen 0.1\nspec s 1\noracle node echo.mjs\nop f\n  input answer? json, id? json\nreq A "a"\n  table f\n    | answer | result.k=1 | result.k~2 ± 0.5 | id |\n    | ---\t|---|:-:|\u3000|\n    | {"result": {"k=1": 1, "k~2": 2.25}} | 1 | 2 | "A#1" |\n  table f\n    | answer | result.a b |\n    | 1 | 2 |\n',
      'echo.mjs': ECHO,
    }),
    ['s.duramen:12: error P013'],
  );
});

test('REQ-SY-013 numbers too large for binary64', () => {
  table([
    [
      'duramen 0.1\nspec s 1\n  request {"x": 1e400}\nop f\n  input a int\nreq A "a"\n  text\n    T.\n  example f {"a": 1e400}\n  example f {"a": 1}\n    expect result.a = [1, -1e400]\n    request {"y": 1e999}\n  table f\n    | a | result |\n    | 1e999 | 1 |\n  example raw \'{"id":"r","op":"f","input":{"a":1e400}}\'\n',
      ['s.duramen:3: error P009', 's.duramen:9: error P009', 's.duramen:11: error P009', 's.duramen:12: error P009', 's.duramen:15: error P009'],
    ],
    [
      H + 'op f\n  input a int\n  tolerance result.x 1e400\nreq A "a"\n  text\n    T.\n  example f {"a": 1}\n    expect result ≈ 1e400 ± 1\n    expect result ≈ 1 ± 1e400\n  table f\n    | a | result ± 1e400 |\n    | 1 | 2 |\n  table f\n    | a | result ± 1 |\n    | 1 | 1e400 |\n',
      ['s.duramen:5: error P018', 's.duramen:10: error P010', 's.duramen:11: error P010', 's.duramen:13: error P010', 's.duramen:17: error P010'],
    ],
    [
      H + 'op f\n  request {"id": 1e400}\nreq A "a"\n  text\n    T.\n  example f [1e400]\n  example f 1e400\n',
      ['s.duramen:4: error P009', 's.duramen:8: error P009', 's.duramen:9: error P009'],
    ],
  ]);
  assert.equal(check({ 's.duramen': H }).result.errors, 0);
});
