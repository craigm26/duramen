import { test } from 'node:test';
import assert from 'node:assert';
import { diags, ECHO, withEcho } from './helpers.ts';

const H = 'duramen 0.1\nspec s 1\n';
// one file record: expected diagnostics (all in s.duramen unless given as full strings)
function t(text: string, expected: string[], extra: Record<string, string> = {}): void {
  const got = diags({ 's.duramen': text, ...extra });
  assert.deepStrictEqual(got, expected.map((e) => (e.includes(':') ? e : `s.duramen:${e}`)), JSON.stringify(text));
}
const e = (line: number, code: string) => `s.duramen:${line}: error ${code}`;

test('REQ-SY-001 lines', () => {
  t('\ufeffduramen 0.1\r\nspec s 1\rnote  \n  text\t\n    Some text.  \r\n', []);
  t(H + '\tnote\n', [e(3, 'P001')]);
  t(H + 'note\n  \ttext\n', [e(4, 'P001')]);
  t(H + '\u00a0note\n', [e(3, 'P001')]);
  t('  \t \nduramen 0.1\n\t\nspec s 1\n   \n', []);
  t('duramen 0.1\u3000\nspec s 1\u2028\nnote\n\u205f text\n', [e(4, 'P001')]);
  t(
    'duramen 0.1\nspec s 1\n  title "a b"\noracle node echo.mjs\nop f\n  input x? {a: b}, y? json\nerrors\n  e when x y\nreq A "A title"\n  example f {"x": "p q"}\n    expect result.x = "p q"\n    expect result.x = "p q"\n  example f {}\n    input y."k l"\n      text\n    expect result.y = {"k l": "text\\n"}\n  example raw \'{"id":"r","op":"f","input":{"x":" "}}\'\n  example f {"x": 1}\n    expect result.x ≈ 1 ± 0\n',
    [],
    { 'echo.mjs': ECHO },
  );
});

test('REQ-SY-002 statements and comments', () => {
  t('# A comment.\nduramen 0.1\n#A comment too.\nspec s 1\nfrobnicate this\n  title "ignored"\n    ignored too\nNote\n', [e(5, 'P002'), e(8, 'P002')]);
  t('  indented\n # indented too\nduramen 0.1\nspec s 1\n', [e(1, 'P003'), e(2, 'P003')]);
});

test('REQ-SY-003 clauses', () => {
  t(H + 'note\n  # A comment.\n  text\n    Text.\n    # Text, not a comment.\n', []);
  t(H + 'note\n text\n', [e(4, 'P007')]);
  t(H + 'note\n    Text without a clause.\n  text\n    Text.\n', [e(4, 'P006')]);
  t(H + 'op f\n  audit\n  audit text\n', [e(5, 'P052')]);
  t(H + '  colour blue\n    more\nnote\n  example f {}\n    expect result = 1\n', [e(3, 'P015'), e(6, 'P015')]);
  t(H + 'note\n # not a comment here\n    # nor here\n  text\n    Text.\n', [e(4, 'P007'), e(5, 'P006')]);
  t(
    H + '  title "one"\n  title "two"\n    more\nnote\n  text\n    One.\n  text Two.\ndecision D "d"\n  source a\n  source b\n  status accepted\n  status rejected\n',
    [e(4, 'P052'), e(9, 'P052'), e(12, 'P052'), e(14, 'P052')],
  );
  t(H + '  title x\n  title "two"\nop f\n  request [1]\n  request {}\n', [e(3, 'P004'), e(4, 'P052'), e(6, 'P009'), e(7, 'P052')]);
  t(H + '  title "A title"\n    that goes on\n  # A comment.\n    # Another.\n', [e(4, 'P006')]);
});

test('REQ-SY-004 the duramen, spec and oracle statements', () => {
  t('duramen 0.1\n  title "x"\nspec s 1\n', [e(2, 'P015')]);
  t('duramen 0.1\nspec s\n', [e(2, 'P021')]);
  t('duramen 0.1\nspec s 1 2\n', [e(2, 'P021')]);
  t(H.replace('s 1', 's 1.0.0-beta') + '  title "The s program"\n  contract s-out-2\n  request {"clock": "2026-01-01T00:00:00Z", "n": 1}\n  text\n    What s is.\n', []);
  t(H + '  request {"clock":\n', [e(3, 'P009')]);
  t(H + '  request ["clock"]\n', [e(3, 'P009')]);
  t(H + '  request {"op": "x"}\n', [e(3, 'P051')]);
  t(H + 'oracle\n', [e(3, 'P028')]);
  t(H + 'oracle node model.mjs --quiet\n  source model.mjs, lib/a.mjs lib/b.mjs\n  timeout 5\n', [e(5, 'P015')]);
});

test('REQ-SY-005 text', () => {
  t(H + 'note\n  text Here.\n', [e(4, 'P008')]);
  t(H + 'note\n  text\n    One.\n   Two.\n', [e(6, 'P008')]);
  t(H + 'note\n  text\n    # It MUST be text.\n', [e(3, 'T004')]);
});

test('REQ-SY-006 quoted strings, IDs and titles', () => {
  t(H + 'section S A title\n', [e(3, 'P005')]);
  t(H + 'section S "A title" and more\n', [e(3, 'P005')]);
  t(H + 'section S\n', [e(3, 'P005')]);
  t(H + 'section S "unclosed\nsection T "A" "B"\nsection U "\n', [e(3, 'P005'), e(4, 'P004'), e(5, 'P005')]);
  t(H + 'section S "A \\q title"\n', [e(3, 'P004')]);
  t(H + 'section S "A "quoted" title"\n', [e(3, 'P004')]);
  t(H + '  title A title\n', [e(3, 'P004')]);
  t(H + 'section S-1.x "A \\"quoted\\" title, é and all"\n', []);
});

test('REQ-SY-007 operations', () => {
  t(H + 'op f g\n', [e(3, 'P031')]);
  t(H + 'op\n', [e(3, 'P031')]);
  t(H + 'op f\n  input a number, b? {x: number, y: string}, c "one, two" | [1, 2], d-e (f, g)\n  result the sum\n  tolerance result.sum 0.005\n  tolerance result.count 0\n  audit text\n  request {}\n', []);
  t(
    H +
      "op f\n  input a\n  input a.b number\n  input b?number\n  input\n  input c number, , d number,\n  input e 'x, y'\n  input c number\n  input é number\nop g\n  audit json\nop\n  input x\n  tolerance result.y\n",
    [e(4, 'P017'), e(5, 'P017'), e(6, 'P017'), e(7, 'P017'), e(8, 'P017'), e(8, 'P017'), e(9, 'P017'), e(10, 'P052'), e(11, 'P017'), e(13, 'P050'), e(14, 'P031'), e(15, 'P017'), e(16, 'P018')],
  );
  t(H + 'op f\n  tolerance result.x\n  tolerance result.x -1\n  tolerance result.x 0x10\n  tolerance result.x 1 2\n  tolerance result.x 1e-3\n', [e(4, 'P018'), e(5, 'P018'), e(6, 'P018'), e(7, 'P018')]);
  t(H + 'op f\n  tolerance foo 0.1\n  tolerance result.x -0\n  tolerance result.y 1e400\n', [e(6, 'P018')]);
  t(H + 'op f\n  request 5\nop g\n  request {"input": 5}\nop h\n  tolerance result.x 1\n  tolerance result.y 1\n  tolerance result.x 2\n', [e(4, 'P009'), e(6, 'P051'), e(10, 'P052')]);
  t(H + 'op f\n  input a x], b y\n  input b z\n  input c "a\\", b" x, d y\nop h\n  tolerance result.x 1\n  tolerance result.x result\n  tolerance result.x 2\n', [e(5, 'P052'), e(9, 'P018'), e(10, 'P052')]);
  t(H + 'oracle node echo.mjs\nop f\n  input a (x}, b json\nreq A "a"\n  example f {"b": 1}\n    expect result.b = 1\n', [e(7, 'T010')], { 'echo.mjs': ECHO });
});

test('REQ-SY-008 the errors list', () => {
  t(H + 'errors\n  bad_input when the input is not an object, or\n    when it lacks a field\n  not_found when there is no such thing\n', []);
  t(H + 'errors first\n  e when x\n', [e(3, 'P050')]);
  t(H + 'errors\n  e if x\n  e when\n    the input is bad\n  when x\n  f when y\n   and z\n  g is\n   wrong\n', [e(4, 'P019'), e(5, 'P019'), e(7, 'P019'), e(9, 'P006'), e(10, 'P019'), e(11, 'P006')]);
  t(H + 'errors\n  e when x\n    # It MUST be read.\n', [e(4, 'T004')]);
  t(H + 'errors\n  e when x\n  f when y\n  e when z\n', []);
});

test('REQ-SY-009 requirements, open items, decisions, sections and notes', () => {
  t(H + 'section S "Things"\n  text\n    About things.\nnote\n  text\n    A note.\nopen S-1 "Unsaid"\n  text\n    Left open.\ndecision D-1 "Why"\n  source the author\n  status accepted\n  text\n    Because.\n  rejected "Another way, because no."\n  rejected "A third way."\n', ['s.duramen:12: warning T012']);
  t(H + 'req A "a"\n  on mac\n  status accepted\n  example f {}\nnote x\nsection S "s"\n  example f {}\ndecision D "d"\n  title "x"\nopen O "o"\n  decision D\n', [e(4, 'P033'), e(5, 'P015'), e(7, 'P050'), e(9, 'P015'), e(11, 'P015'), e(13, 'P015')]);
  t(H + '  contract\nreq A "a"\n  decision\n  text\n    Words.\n', [e(4, 'T001')]);
});

test('REQ-SY-010 examples', () => {
  t(H + 'req A "a"\n  example\n  example f [1]\n  example f {"x": 1\n  example f 2\n  example raw "{\\"id\\": \\"1\\",\\n\\"op\\": \\"f\\"}"\n', [e(4, 'P012'), e(5, 'P012'), e(6, 'P009'), e(7, 'P012'), e(8, 'P026')]);
  t(
    H +
      'req A "a"\n  example raw\n  example raw {"id": "x"}\n  example raw "unclosed\n  example raw "a" "b"\n  example raw "carriage\\rreturn"\n  example f [1]\n    expect result\n     expect result = 1\n    expect result ≈ 1\n    expect result~1+-0.5\n    expect result="~"\n    expect result =\n    expect = 1\n    request {"a": 1}\n    request {"b": 1}\n    omit\n    omit a, b c\n    omit d\n',
    [e(4, 'P004'), e(5, 'P004'), e(6, 'P004'), e(7, 'P004'), e(8, 'P026'), e(9, 'P012'), e(10, 'P011'), e(11, 'P006'), e(12, 'P010'), e(15, 'P009'), e(16, 'P011'), e(18, 'P052'), e(19, 'P011')],
  );
  t(H + 'req A "a"\n  example raw \'{"id": "x"}\'\n    omit\n    request\n    input\n  example f {}\n    request\n    input\n    omit ,\n', [e(5, 'P022'), e(6, 'P022'), e(7, 'P022'), e(9, 'P009'), e(10, 'P049'), e(11, 'P011')]);
  t(
    H +
      'req A "a"\n  example f {}\n    expect result ≈ 1 ± -1\n    expect result ~ 1 +- x\n    expect result ≈ 0x10 ± 1\n    expect result = {nope}\n    expect result\n    result = 1\n     expect result = 1\n      expect result = 1\n    request [1]\n    request {"input": {}}\n  example raw \'{"id": "x"}\'\n    omit id\n    request {"a": 1}\n    input files."a"\n      text\n',
    [e(5, 'P010'), e(6, 'P010'), e(7, 'P010'), e(8, 'P009'), e(9, 'P011'), e(10, 'P011'), e(11, 'P006'), e(12, 'P006'), e(13, 'P009'), e(14, 'P051'), e(16, 'P022'), e(17, 'P022'), e(18, 'P022')],
  );
  t(H + 'op f\nreq A "a"\n  text\n    T.\n  example f {}\n    request {"a": 1}\n    request [2]\n    request {"id": 3}\n    request {"b": 4}\n', [e(9, 'P052'), e(10, 'P052'), e(11, 'P052')]);
  t(H + 'op f\nreq A "a"\n  text\n    T.\n  example raw \'{"id":"1","op":"f"}\'\n    input files."a" from "nofile"\n    input files."b"\n      hello\n  example raw x\n    input files."c" from "nofile"\n', [e(8, 'P022'), e(9, 'P022'), e(11, 'P004'), e(12, 'P022')]);
  t(H + 'op f\nreq A "a"\n  text\n    T.\n  example raw \'{"id":"1","op":"f"}\'\n    input files."a" from "nofile"\n      hello\n  example f [1]\n    input a\n      t\n    input a.b\n      u\n', [e(8, 'P022'), e(9, 'P006'), e(10, 'P012'), e(13, 'P049')]);
});

test('REQ-SY-011 texts in an example\'s input', () => {
  t(
    H + 'oracle node echo.mjs\nop f\n  input files object, n? number\nreq A "a"\n  example f {"n": 1}\n    input files."a b"\n      one\n        two\n\n    input files.x\n      three\n\n\n    expect result = {"n": 1, "files": {"a b": "one\\n  two\\n", "x": "three\\n"}}\n',
    [],
    { 'echo.mjs': ECHO },
  );
  t(H + 'req A "a"\n  example f {"x": 1}\n    input files.\n    input files.."a"\n    input "a\n    input x.y\n      text\n    input z\n    input y from "missing.txt"\n', [e(5, 'P049'), e(6, 'P049'), e(7, 'P049'), e(8, 'P049'), e(10, 'P049'), e(11, 'P048')]);
  t(H + 'req A "a"\n  example f {}\n    input a\n     not six\n      six, but after the line that ended the text\n', [e(5, 'P049'), e(6, 'P006'), e(7, 'P006')]);
  const d = diags(
    { 'r/s.duramen': H + 'req A "a"\n  example f {}\n    input a from "../outside.txt"\n    input b from "t.txt"\n      not its text\n    input c from "unclosed\n  example f {\n    input d from "../outside.txt"\n', 'r/t.txt': 't', 'outside.txt': 'x' },
    'r',
  );
  assert.deepStrictEqual(d, ['r/s.duramen:5: error P048', 'r/s.duramen:7: error P006', 'r/s.duramen:8: error P049', 'r/s.duramen:9: error P009', 'r/s.duramen:10: error P048']);
  assert.deepStrictEqual(
    diags(withEcho({ 'sub/s.duramen': H + 'oracle node echo.mjs\nop f\n  input t? string\nreq A "a"\n  example f {}\n    input t from "data/t.txt"\n    expect result = {"t": "hello,\\r\\nworld"}\n', 'sub/data/t.txt': 'hello,\r\nworld', 'sub/echo.mjs': ECHO }), undefined),
    [],
  );
  assert.deepStrictEqual(
    diags({
      's.duramen': H + 'oracle node echo.mjs\nop f\n  input t? json, u? json, a? json\nreq A "a"\n  example f {}\n    input t\n      one\n# a comment at indent 0\n  # and one at indent 2\n      two\n    input u from "./sub/..//b.txt"\n      # a comment indented six\n    expect result = {"t": "one\\ntwo\\n", "u": "\\ufeffbom"}\n  example f {"a": 1}\n    input x..y from "missing.txt"\n    input a.b from "missing.txt"\n    input a.c from "t.txt"\n    input t from "sub"\n',
      'b.txt': '\ufeffbom',
      't.txt': 't',
      'echo.mjs': ECHO,
    }),
    [e(17, 'P049'), e(18, 'P048'), e(19, 'P049'), e(20, 'P048')],
  );
  assert.deepStrictEqual(
    diags({ 's.duramen': H + 'oracle node echo.mjs\nop f\n  input b? json\nreq A "a"\n  example f {}\n    input b  from "t.txt"\n    expect result.b = "t\\n"\n', 't.txt': 't\n', 'echo.mjs': ECHO }),
    [],
  );
});

test('REQ-SY-012 tables', () => {
  t(H + 'oracle node echo.mjs\nop f\n  input x? json, y? json\nreq A "a"\n  table f\n    | x        | y | result.x | result.y ± 0.5 |\n    |----------|---|:--------:|----------------|\n    | "a\\|b"   |   | "a\\|b"   |                |\n    | 1        | 2 | ?        | 2.4            |\n', [], { 'echo.mjs': ECHO });
  t(
    H +
      'req A "a"\n  table f\n  table f g\n    | x |\n    | 1 |\n  table f\n    | x |\n  table f\n    | x | result ± -1 |\n    | 1 | 2           |\n  table f\n    | x | result ± 0.5 |\n    | 1 | "2"          |\n  table f\n    | x | y |\n    | 1 |\n    | {  | 2 |\n    x | 1\n  table f\n    | x | |\n    | 1 | 2 |\n  table f\n    | x ± 1 |\n    | 1     |\n',
    [e(4, 'P013'), e(5, 'P013'), e(8, 'P013'), e(11, 'P010'), e(15, 'P010'), e(18, 'P014'), e(19, 'P009'), e(20, 'P006'), e(22, 'P013'), e(25, 'P010')],
  );
  t(
    H +
      'req A "a"\n  table f g\n    | x |\n    | {bad |\n  table f\n   | x |\n    | 1 |\n  table f\n    | a.b | result |\n    | 1   | 2      |\n  table f\n    | x | result ± lots |\n    | 1 | "two"         |\n  table f\n    | x | result ± 1 2 | result.y+-0.5 |\n    | 1 | 2            | 3             |\n  table f\n    | x | x |\n    | 1 | 2 |\n  table f\n    | x | result ± 0.5 |\n    | 1 | 2.25 [       |\n    | { | ?            |\n',
    [e(4, 'P013'), e(7, 'P013'), e(8, 'P006'), e(11, 'P013'), e(14, 'P010'), e(17, 'P010'), e(20, 'P013'), e(24, 'P010'), e(25, 'P009')],
  );
  t(H + 'oracle node echo.mjs\nop f\n  input x? json\nreq A "a"\n  table f\n    |---|----------|\n    | x | result.x |\n    |   |\n    | 1 | 1\n    |\n    | 2 | 2        |\n', [], { 'echo.mjs': ECHO });
  t(H + 'op f\n  input a int\nreq A "a"\n  text\n    T.\n  table f\n    | a ± 1 | b! | result ± x |\n    | 1 | 2 | 3 |\n', [e(9, 'P010'), e(9, 'P013')]);
  t(
    'duramen 0.1\nspec s 1\noracle node echo.mjs\nop f\n  input answer? json, id? json\nreq A "a"\n  table f\n    | answer | result.k=1 | result.k~2 ± 0.5 | id |\n    | ---\t|---|:-:|　|\n    | {"result": {"k=1": 1, "k~2": 2.25}} | 1 | 2 | "A#1" |\n  table f\n    | answer | result.a b |\n    | 1 | 2 |\n',
    [e(12, 'P013')],
    { 'echo.mjs': ECHO },
  );
  t(H + 'oracle node echo.mjs\nop f\n  input result? json\nreq A "a"\n  table f\n    | result |\n    | 1 |\n', [e(9, 'T002')].map((x) => x.replace('s.duramen:9: error T002', 's.duramen:9: error T002')), { 'echo.mjs': ECHO });
  t(H + 'req A "a"\n  table f g\n    not a row\n    | x |\n    | 1 |\n', [e(4, 'P013'), e(5, 'P006')]);
});

test('REQ-SY-013 numbers too large for binary64', () => {
  t(
    H.replace('spec s 1\n', 'spec s 1\n  request {"x": 1e400}\n') +
      'op f\n  input a int\nreq A "a"\n  text\n    T.\n  example f {"a": 1e400}\n  example f {"a": 1}\n    expect result.a = [1, -1e400]\n    request {"y": 1e999}\n  table f\n    | a | result |\n    | 1e999 | 1 |\n  example raw \'{"id":"r","op":"f","input":{"a":1e400}}\'\n',
    [e(3, 'P009'), e(9, 'P009'), e(11, 'P009'), e(12, 'P009'), e(15, 'P009')],
  );
  t(
    H + 'op f\n  input a int\n  tolerance result.x 1e400\nreq A "a"\n  text\n    T.\n  example f {"a": 1}\n    expect result ≈ 1e400 ± 1\n    expect result ≈ 1 ± 1e400\n  table f\n    | a | result ± 1e400 |\n    | 1 | 2 |\n  table f\n    | a | result ± 1 |\n    | 1 | 1e400 |\n',
    [e(5, 'P018'), e(10, 'P010'), e(11, 'P010'), e(13, 'P010'), e(17, 'P010')],
  );
  t(H + 'op f\n  request {"id": 1e400}\nreq A "a"\n  text\n    T.\n  example f [1e400]\n  example f 1e400\n', [e(4, 'P009'), e(8, 'P009'), e(9, 'P009')]);
});
