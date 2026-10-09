import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { check } from '../checker.ts';

const ECHO = readFileSync(new URL('../fixtures/echo.mjs', import.meta.url), 'utf8');
const H = 'duramen 0.1\nspec s 1\n';
const OP = 'oracle node echo.mjs\nop f\n  input x? json\n';

function t(name: string, files: Record<string, string>, expected: string[], entry?: string) {
  test(name, () => {
    const all = { ...files };
    if (Object.values(files).some((v) => v.includes('echo.mjs')) && !('echo.mjs' in all)) all['echo.mjs'] = ECHO;
    assert.deepStrictEqual(check(all, entry).diagnostics, expected);
  });
}
const S = (body: string) => ({ 's.duramen': body });

// REQ-RQ-001 / REQ-RC-001 / REQ-RC-002
t('RQ-001 entry file only', { 'a.duramen': H, 'b.duramen': 'frobnicate\n' }, [], 'a.duramen');
t('RQ-001 folder', { 'a.duramen': H, 'b.duramen': 'frobnicate\n' }, ['b.duramen:1: error P002', 'b.duramen:1: error P020']);
t('RC-001 exclusions', {
  'a.duramen': H, 'notes.md': 'frobnicate', 'build/x.duramen': 'frobnicate', 'sub/build/x.duramen': 'frobnicate',
  'node_modules/x.duramen': 'frobnicate', '.hidden.duramen': 'frobnicate', 'sub/.hidden/x.duramen': 'frobnicate',
  'sub/b.duramen': 'duramen 0.1\n',
}, []);
t('RC-001 file whatever name', { 'notes.md': H, 'a.duramen': 'frobnicate' }, [], 'notes.md');
t('RC-001 folder entry', { 'sub/a.duramen': H, 'sub/deeper/b.duramen': 'duramen 0.1\n', 'c.duramen': 'frobnicate' }, [], 'sub');
t('RC-001 build entry', { 'build/a.duramen': H, 'build/build/b.duramen': 'frobnicate' }, [], 'build');
t('RC-001 missing file', { 'a.duramen': H }, ['missing.duramen:1: error P046'], 'missing.duramen');
t('RC-001 missing folder', { 'a.duramen': H }, ['sub:1: error P046'], 'sub');
t('RC-001 no files', { 'notes.md': H }, ['.:1: error P046']);
t('RC-002 order', { 'b.duramen': 'duramen 0.1\nspec b 1\n', 'a.duramen': H }, ['b.duramen:2: error P044']);
t('RC-002 case', { 'a.duramen': H, 'B.duramen': 'duramen 0.1\nspec b 1\n' }, ['a.duramen:2: error P044']);
t('RC-002 slash', { 'a/z.duramen': 'duramen 0.1\nspec z 1\n', 'a.duramen': H }, ['a/z.duramen:2: error P044']);
t('RC-002 utf16', { '｡.duramen': 'duramen 0.1\nspec x 1\n', '😀.duramen': 'duramen 0.1\nspec y 1\n' }, ['｡.duramen:2: error P044']);

// REQ-RC-003 .. 006
t('RC-003 none', S('spec s 1\n'), ['s.duramen:1: error P020']);
t('RC-003 bad version', S('duramen 0.3\nspec s 1\n'), ['s.duramen:1: error P023']);
t('RC-003 second', S('duramen 0.1\nspec s 1\nduramen 0.1\nduramen 9\n'), ['s.duramen:3: error P023', 's.duramen:4: error P023']);
t('RC-003 no version', S('duramen\nspec s 1\n'), ['s.duramen:1: error P023']);
t('RC-003 mixed', { 'a.duramen': H, 'b.duramen': 'duramen 0.2\n' }, ['.:1: error P047']);
t('RC-003 mixed entry', { 'r/a.duramen': 'duramen 0.2\nspec s 1\n', 'r/b.duramen': 'duramen 0.1\n' }, ['r:1: error P047'], 'r');
t('RC-003 same', { 'a.duramen': 'duramen 0.2\nspec s 1\n', 'b.duramen': 'duramen 0.2\n' }, []);
t('RC-003 b invalid', { 'a.duramen': 'duramen 0.2\nspec s 1\n', 'b.duramen': 'duramen 2\n' }, ['b.duramen:1: error P023']);
t('RC-003 empty', S(''), ['.:1: error P021', 's.duramen:1: error P020']);
t('RC-004 no spec', S('duramen 0.1\n'), ['.:1: error P021']);
t('RC-004 no spec file', S('duramen 0.1\n'), ['s.duramen:1: error P021'], 's.duramen');
t('RC-004 no spec folder', { 'r/s.duramen': 'duramen 0.1\n' }, ['r:1: error P021'], 'r');
t('RC-004 second spec', S('duramen 0.1\nspec a 1\n\nspec b 1\n'), ['s.duramen:4: error P044']);
t('RC-004 second oracle', { 'a.duramen': 'duramen 0.1\nspec s 1\noracle node a.mjs\n', 'b.duramen': 'duramen 0.1\noracle node b.mjs\n' }, ['b.duramen:2: error P044']);
t('RC-004 second errors', S(H + 'errors\n  e1 when x\nerrors\n  e2 when y\n'), ['s.duramen:5: error P032']);
t('RC-004 errors across files', { 'a.duramen': H + 'errors\n  e1 when x\n', 'b.duramen': 'duramen 0.1\n\nerrors\n  e2 when y\n' }, ['b.duramen:3: error P032']);
t('RC-004 empty errors', S(H + 'errors\nerrors\n'), ['s.duramen:4: error P032']);
t('RC-004 mess', S('duramen 0.1\nspec s 1\nduramen 0.1\n  title "t"\nspec s\noracle\n  source o.mjs\n    more\nerrors x\n  e if\n'),
  ['s.duramen:3: error P023', 's.duramen:4: error P015', 's.duramen:5: error P021', 's.duramen:5: error P044', 's.duramen:6: error P028',
    's.duramen:8: error P006', 's.duramen:9: error P050', 's.duramen:10: error P019']);
t('RC-005 stops', S(H + 'frobnicate\nreq A "a"\n  example nope {}\n'), ['s.duramen:3: error P002']);
t('RC-006 order', { 'b.duramen': 'frobnicate\nduramen 0.1\n', 'a.duramen': H + '\n\nfrobnicate\nfrobnicate\n' },
  ['a.duramen:5: error P002', 'a.duramen:6: error P002', 'b.duramen:1: error P002']);
t('RC-006 T order', S(H + '\ndecision D-1 "one"\n  text\n    No source, and cited by nothing.\n\nreq A "a"\n  decision D-2\n'),
  ['s.duramen:4: warning T012', 's.duramen:4: warning T013', 's.duramen:8: error T001', 's.duramen:8: error T008']);
t('RC-006 weak', S(H + '\ndecision D-1 "proposed"\n  source here\n  status proposed\n\ndecision D-2 "contested"\n  source there\n  status contested\n\nreq A "a"\n  decision D-1, D-2\n'),
  ['s.duramen:12: error T001', 's.duramen:12: error T028', 's.duramen:12: warning T028']);

// REQ-SY-001 .. 003
t('SY-001 lines', S('﻿duramen 0.1\r\nspec s 1\rnote  \n  text\t\n    Some text.  \r\n'), []);
t('SY-001 tab', S(H + '\tnote\n'), ['s.duramen:3: error P001']);
t('SY-001 tab in indent', S(H + 'note\n  \ttext\n'), ['s.duramen:4: error P001']);
t('SY-001 nbsp', S(H + ' note\n'), ['s.duramen:3: error P001']);
t('SY-001 blank', S('  \t \nduramen 0.1\n\t\nspec s 1\n   \n'), []);
t('SY-001 unicode ws', S('duramen 0.1　\nspec s 1 \nnote\n  text\n'), ['s.duramen:4: error P001']);
t('SY-002 statements', S('# A comment.\nduramen 0.1\n#A comment too.\nspec s 1\nfrobnicate this\n  title "ignored"\n    ignored too\nNote\n'),
  ['s.duramen:5: error P002', 's.duramen:8: error P002']);
t('SY-002 indented first', S('  indented\n # indented too\nduramen 0.1\nspec s 1\n'), ['s.duramen:1: error P003', 's.duramen:2: error P003']);
t('SY-003 comments', S(H + 'note\n  # A comment.\n  text\n    Text.\n    # Text, not a comment.\n'), []);
t('SY-003 one space', S(H + 'note\n text\n'), ['s.duramen:4: error P007']);
t('SY-003 no clause', S(H + 'note\n    Text without a clause.\n  text\n    Text.\n'), ['s.duramen:4: error P006']);
t('SY-003 unknown clause', S(H + '  colour blue\n    more\nnote\n  example f {}\n    expect result = 1\n'), ['s.duramen:3: error P015', 's.duramen:6: error P015']);
t('SY-003 hash odd', S(H + 'note\n # not a comment here\n    # nor here\n  text\n    Text.\n'), ['s.duramen:4: error P007', 's.duramen:5: error P006']);
t('SY-003 once', S(H + '  title "one"\n  title "two"\n    more\nnote\n  text\n    One.\n  text Two.\ndecision D "d"\n  source a\n  source b\n  status accepted\n  status rejected\n'),
  ['s.duramen:4: error P052', 's.duramen:9: error P052', 's.duramen:12: error P052', 's.duramen:14: error P052']);
t('SY-003 continuation', S(H + '  title "A title"\n    that goes on\n  # A comment.\n    # Another.\n'), ['s.duramen:4: error P006']);

// REQ-SY-004
t('SY-004 duramen clauses', S('duramen 0.1\n  title "x"\nspec s 1\n'), ['s.duramen:2: error P015']);
t('SY-004 spec one word', S('duramen 0.1\nspec s\n'), ['s.duramen:2: error P021']);
t('SY-004 spec three', S('duramen 0.1\nspec s 1 2\n'), ['s.duramen:2: error P021']);
t('SY-004 spec ok', S(H.replace('spec s 1', 'spec s 1.0.0-beta') + '  title "The s program"\n  contract s-out-2\n  request {"clock": "2026-01-01T00:00:00Z", "n": 1}\n  text\n    What s is.\n'), []);
t('SY-004 request bad json', S(H + '  request {"clock":\n'), ['s.duramen:3: error P009']);
t('SY-004 request array', S(H + '  request ["clock"]\n'), ['s.duramen:3: error P009']);
t('SY-004 request op', S(H + '  request {"op": "x"}\n'), ['s.duramen:3: error P051']);
t('SY-004 oracle none', S(H + 'oracle\n'), ['s.duramen:3: error P028']);
t('SY-004 oracle clauses', S(H + 'oracle node model.mjs --quiet\n  source model.mjs, lib/a.mjs lib/b.mjs\n  timeout 5\n'), ['s.duramen:5: error P015']);

// REQ-SY-005, 006
t('SY-005 text rest', S(H + 'note\n  text Here.\n'), ['s.duramen:4: error P008']);
t('SY-005 three', S(H + 'note\n  text\n    One.\n   Two.\n'), ['s.duramen:6: error P008']);
t('SY-005 hash text', S(H + 'note\n  text\n    # It MUST be text.\n'), ['s.duramen:3: error T004']);
t('SY-006 no quotes', S(H + 'section S A title\n'), ['s.duramen:3: error P005']);
t('SY-006 trailing', S(H + 'section S "A title" and more\n'), ['s.duramen:3: error P005']);
t('SY-006 no title', S(H + 'section S\n'), ['s.duramen:3: error P005']);
t('SY-006 mixed', S(H + 'section S "unclosed\nsection T "A" "B"\nsection U "\n'), ['s.duramen:3: error P005', 's.duramen:4: error P004', 's.duramen:5: error P005']);
t('SY-006 escape', S(H + 'section S "A \\q title"\n'), ['s.duramen:3: error P004']);
t('SY-006 inner quotes', S(H + 'section S "A "quoted" title"\n'), ['s.duramen:3: error P004']);
t('SY-006 title unquoted', S(H + '  title A title\n'), ['s.duramen:3: error P004']);
t('SY-006 ok', S(H + 'section S-1.x "A \\"quoted\\" title, é and all"\n'), []);

// REQ-SY-007
t('SY-007 op two words', S(H + 'op f g\n'), ['s.duramen:3: error P031']);
t('SY-007 op none', S(H + 'op\n'), ['s.duramen:3: error P031']);
t('SY-007 op ok', S(H + 'op f\n  input a number, b? {x: number, y: string}, c "one, two" | [1, 2], d-e (f, g)\n  result the sum\n  tolerance result.sum 0.005\n  tolerance result.count 0\n  audit text\n  request {}\n'), []);
t('SY-007 inputs', S(H + 'op f\n  input a\n  input a.b number\n  input b?number\n  input\n  input c number, , d number,\n  input e \'x, y\'\n  input c number\n  input é number\nop g\n  audit json\nop\n  input x\n  tolerance result.y\n'),
  ['s.duramen:4: error P017', 's.duramen:5: error P017', 's.duramen:6: error P017', 's.duramen:7: error P017', 's.duramen:8: error P017', 's.duramen:8: error P017',
    's.duramen:9: error P017', 's.duramen:10: error P052', 's.duramen:11: error P017', 's.duramen:13: error P050', 's.duramen:14: error P031', 's.duramen:15: error P017', 's.duramen:16: error P018']);
t('SY-007 tolerance', S(H + 'op f\n  tolerance result.x\n  tolerance result.x -1\n  tolerance result.x 0x10\n  tolerance result.x 1 2\n  tolerance result.x 1e-3\n'),
  ['s.duramen:4: error P018', 's.duramen:5: error P018', 's.duramen:6: error P018', 's.duramen:7: error P018']);
t('SY-007 request', S(H + 'op f\n  request 5\nop g\n  request {"input": 5}\nop h\n  tolerance result.x 1\n  tolerance result.y 1\n  tolerance result.x 2\n'),
  ['s.duramen:4: error P009', 's.duramen:6: error P051', 's.duramen:10: error P052']);

// REQ-SY-008, 009
t('SY-008 ok', S(H + 'errors\n  bad_input when the input is not an object, or\n    when it lacks a field\n  not_found when there is no such thing\n'), []);
t('SY-008 rest', S(H + 'errors first\n  e when x\n'), ['s.duramen:3: error P050']);
t('SY-008 bad', S(H + 'errors\n  e if x\n  e when\n    the input is bad\n  when x\n  f when y\n   and z\n  g is\n   wrong\n'),
  ['s.duramen:4: error P019', 's.duramen:5: error P019', 's.duramen:7: error P019', 's.duramen:9: error P006', 's.duramen:10: error P019', 's.duramen:11: error P006']);
t('SY-008 hash', S(H + 'errors\n  e when x\n    # It MUST be read.\n'), ['s.duramen:4: error T004']);
t('SY-009 ok', S(H + 'section S "Things"\n  text\n    About things.\nnote\n  text\n    A note.\nopen S-1 "Unsaid"\n  text\n    Left open.\ndecision D-1 "Why"\n  source the author\n  status accepted\n  text\n    Because.\n  rejected "Another way, because no."\n  rejected "A third way."\n'),
  ['s.duramen:12: warning T012']);
t('SY-009 bad', S(H + 'req A "a"\n  on mac\n  status accepted\n  example f {}\nnote x\nsection S "s"\n  example f {}\ndecision D "d"\n  title "x"\nopen O "o"\n  decision D\n'),
  ['s.duramen:4: error P033', 's.duramen:5: error P015', 's.duramen:7: error P050', 's.duramen:9: error P015', 's.duramen:11: error P015', 's.duramen:13: error P015']);

// REQ-SY-010
t('SY-010 basic', S(H + 'req A "a"\n  example\n  example f [1]\n  example f {"x": 1\n  example f 2\n  example raw "{\\"id\\": \\"1\\",\\n\\"op\\": \\"f\\"}"\n'),
  ['s.duramen:4: error P012', 's.duramen:5: error P012', 's.duramen:6: error P009', 's.duramen:7: error P012', 's.duramen:8: error P026']);
t('SY-010 lines', S(H + 'req A "a"\n  example raw\n  example raw {"id": "x"}\n  example raw "unclosed\n  example raw "a" "b"\n  example raw "carriage\\rreturn"\n  example f [1]\n    expect result\n     expect result = 1\n    expect result ≈ 1\n    expect result~1+-0.5\n    expect result="~"\n    expect result =\n    expect = 1\n    request {"a": 1}\n    request {"b": 1}\n    omit\n    omit a, b c\n    omit d\n'),
  ['s.duramen:4: error P004', 's.duramen:5: error P004', 's.duramen:6: error P004', 's.duramen:7: error P004', 's.duramen:8: error P026', 's.duramen:9: error P012',
    's.duramen:10: error P011', 's.duramen:11: error P006', 's.duramen:12: error P010', 's.duramen:15: error P009', 's.duramen:16: error P011', 's.duramen:18: error P052', 's.duramen:19: error P011']);
t('SY-010 more', S(H + 'req A "a"\n  example f {}\n    expect result ≈ 1 ± -1\n    expect result ~ 1 +- x\n    expect result ≈ 0x10 ± 1\n    expect result = {nope}\n    expect result\n    result = 1\n     expect result = 1\n      expect result = 1\n    request [1]\n    request {"input": {}}\n  example raw \'{"id": "x"}\'\n    omit id\n    request {"a": 1}\n    input files."a"\n      text\n'),
  ['s.duramen:5: error P010', 's.duramen:6: error P010', 's.duramen:7: error P010', 's.duramen:8: error P009', 's.duramen:9: error P011', 's.duramen:10: error P011', 's.duramen:11: error P006',
    's.duramen:12: error P006', 's.duramen:13: error P009', 's.duramen:14: error P051', 's.duramen:16: error P022', 's.duramen:17: error P022', 's.duramen:18: error P022']);

// REQ-SY-011
t('SY-011 texts', S(H + 'oracle node echo.mjs\nop f\n  input files object, n? number\nreq A "a"\n  example f {"n": 1}\n    input files."a b"\n      one\n        two\n\n    input files.x\n      three\n\n\n    expect result = {"n": 1, "files": {"a b": "one\\n  two\\n", "x": "three\\n"}}\n'), []);
t('SY-011 bad', S(H + 'req A "a"\n  example f {"x": 1}\n    input files.\n    input files.."a"\n    input "a\n    input x.y\n      text\n    input z\n    input y from "missing.txt"\n'),
  ['s.duramen:5: error P049', 's.duramen:6: error P049', 's.duramen:7: error P049', 's.duramen:8: error P049', 's.duramen:10: error P049', 's.duramen:11: error P048']);
t('SY-011 six', S(H + 'req A "a"\n  example f {}\n    input a\n     not six\n      six, but after the line that ended the text\n'),
  ['s.duramen:5: error P049', 's.duramen:6: error P006', 's.duramen:7: error P006']);
t('SY-011 outside', { 'r/s.duramen': H + 'req A "a"\n  example f {}\n    input a from "../outside.txt"\n    input b from "t.txt"\n      not its text\n    input c from "unclosed\n', 'r/t.txt': 't\n', 'outside.txt': 'x' },
  ['r/s.duramen:5: error P048', 'r/s.duramen:7: error P006', 'r/s.duramen:8: error P049'], 'r');
t('SY-011 from', { 'sub/s.duramen': H + 'oracle node echo.mjs\nop f\n  input t? string\nreq A "a"\n  example f {}\n    input t from "data/t.txt"\n    expect result = {"t": "hello,\\r\\nworld"}\n', 'sub/data/t.txt': 'hello,\r\nworld', 'sub/echo.mjs': ECHO }, []);

// REQ-SY-012
t('SY-012 table ok', S(H + 'oracle node echo.mjs\nop f\n  input x? json, y? json\nreq A "a"\n  table f\n    | x        | y | result.x | result.y ± 0.5 |\n    |----------|---|:--------:|----------------|\n    | "a\\|b"   |   | "a\\|b"   |                |\n    | 1        | 2 | ?        | 2.4            |\n'), []);
t('SY-012 table bad', S(H + 'req A "a"\n  table f\n  table f g\n    | x |\n    | 1 |\n  table f\n    | x |\n  table f\n    | x | result ± -1 |\n    | 1 | 2           |\n  table f\n    | x | result ± 0.5 |\n    | 1 | "2"          |\n  table f\n    | x | y |\n    | 1 |\n    | {  | 2 |\n    x | 1\n  table f\n    | x | |\n    | 1 | 2 |\n  table f\n    | x ± 1 |\n    | 1     |\n'),
  ['s.duramen:4: error P013', 's.duramen:5: error P013', 's.duramen:8: error P013', 's.duramen:11: error P010', 's.duramen:15: error P010', 's.duramen:18: error P014', 's.duramen:19: error P009', 's.duramen:20: error P006', 's.duramen:22: error P013', 's.duramen:25: error P010']);
t('SY-012 table more', S(H + 'req A "a"\n  table f g\n    | x |\n    | {bad |\n  table f\n   | x |\n    | 1 |\n  table f\n    | a.b | result |\n    | 1   | 2      |\n  table f\n    | x | result ± lots |\n    | 1 | "two"         |\n  table f\n    | x | result ± 1 2 | result.y+-0.5 |\n    | 1 | 2            | 3             |\n'),
  ['s.duramen:4: error P013', 's.duramen:7: error P013', 's.duramen:8: error P006', 's.duramen:11: error P013', 's.duramen:14: error P010', 's.duramen:17: error P010']);
t('SY-012 separators', S(H + 'oracle node echo.mjs\nop f\n  input x? json\nreq A "a"\n  table f\n    |---|----------|\n    | x | result.x |\n    |   |\n    | 1 | 1\n    |\n    | 2 | 2        |\n'), []);

// REQ-CK
t('CK-001 no example', S(H + 'req A "a"\n  text\n    It MUST work.\n'), ['s.duramen:3: error T001']);
t('CK-001 empty table', S(H + 'req A "a"\n  table f\n    | x |\n    |---|\n'), ['s.duramen:4: error P013']);
t('CK-002 dup ids', S(H + OP + 'req A "a"\n  example f {}\nreq A "again"\n  example f {}\nopen A "an open item may share a requirement\'s ID"\n  text\n    Open.\nopen B "b"\n  text\n    Open.\nopen B "b again"\n  text\n    Open.\ndecision D-1 "d"\n  source s\ndecision D-1 "d again"\n  source s\nreq C "c"\n  decision D-1\n  example f {}\n'),
  ['s.duramen:8: error T007', 's.duramen:16: error T007', 's.duramen:21: error T007']);
t('CK-002 across files', { 'a.duramen': H + OP + 'req A "a"\n  example f {}\n', 'b.duramen': 'duramen 0.1\nreq A "a"\n  example f {}\nop f\n  input y? json\n' },
  ['b.duramen:2: error T007', 'b.duramen:4: error T007']);
t('CK-003 undeclared', S(H + OP + 'decision D-1 "d"\n  source s\nreq A "a"\n  decision D-1 D-2, D-3\n  decision D-2\n  example f {}\n'), ['s.duramen:8: error T008', 's.duramen:8: error T008']);
t('CK-004 examples', S(H + 'oracle node echo.mjs\nop f\n  input a number, b? number\nerrors\n  e when never\nreq A "a"\n  example g {"a": 1}\n  example f {"b": 1}\n  example f {"a": 1, "c": 2}\n  example f\n  example g {"answer": {"error": "e"}}\n    expect error = "e"\n  example raw \'{"id": "A#6", "op": "g"}\'\n  table f\n    | b | c |\n    | 1 | 2 |\n  example g {}\n    expect error.code = "e"\n'),
  ['s.duramen:9: error T009', 's.duramen:10: error T010', 's.duramen:11: warning T011', 's.duramen:12: error T010', 's.duramen:18: error T010', 's.duramen:18: warning T011', 's.duramen:19: error T009']);
t('CK-005 expected errors', S(H + 'oracle node echo.mjs\nop f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n  example f {"answer": {"error": "e"}}\n    expect error = "e"\n  example f {"answer": {"error": "nope"}}\n    expect error = "nope"\n  example raw \'{"id": "r", "op": "f", "input": {"answer": {"error": "other"}}}\'\n    expect error = "other"\n  example f {"answer": {"error": "e"}}\n    expect error = ?\n'),
  ['s.duramen:12: error T023', 's.duramen:14: error T023']);
t('CK-006 obligations', S(H + '  text\n    The program MUST work.\nop f\n  result what it MUST return\nerrors\n  e when it SHALL fail\nsection S "It MUST be titled"\n  text\n    REQUIRED reading.\nnote\n  text\n    This note says `MUST`, "SHALL" and “REQUIRED”, MUSTARD and must.\ndecision D-1 "d"\n  source s\n  text\n    Fine.\n  rejected "Another MUST."\nopen O "o"\n  text\n    It MUST NOT be.\n'),
  ['s.duramen:2: error T004', 's.duramen:5: error T004', 's.duramen:8: error T004', 's.duramen:9: error T004', 's.duramen:15: error T004', 's.duramen:15: warning T012', 's.duramen:20: warning T014']);
t('CK-006 decision thrice', S(H + 'decision D-1 "d"\n  source s\n  text\n    It MUST.\n  rejected "It SHALL."\n  rejected "It is REQUIRED."\n'),
  ['s.duramen:3: error T004', 's.duramen:3: error T004', 's.duramen:3: error T004', 's.duramen:3: warning T012']);
t('CK-006 quotes lines', S(H + 'errors\n  e when the "MUST\n    hold" rule fails\n  f when the "MUST hold" rule fails\nnote\n  text\n    A MUST-have.\n'), ['s.duramen:4: error T004', 's.duramen:7: error T004']);
t('CK-007 open examples', S(H + 'open O "o"\n  example f {}\n  table f\n    | x |\n    | 1 |\n  example f {not json\n    expect nothing at all\n  table g h\n    | {bad |\n'),
  ['s.duramen:4: error T003', 's.duramen:5: error T003', 's.duramen:8: error T003', 's.duramen:10: error T003']);
t('CK-008 order', S(H + 'oracle node echo.mjs\nop f\n  input x? json\nerrors\n  too_big when x > 9\n  too_small when x < 0\nreq A "a"\n  text\n    A request that is too_big gets too_big, and one too_small gets too_small.\n  example f {}\nreq B "b"\n  text\n    too_big is checked Before too_small.\n  example f {}\nreq C "c"\n  text\n    too_big is checked first.\n    After that, nothing.\n  example f {}\n'), ['s.duramen:14: error T005']);
t('CK-008 one code', S(H + 'oracle node echo.mjs\nop f\n  input x? json\nerrors\n  e when x\n  f when y\nreq A "a"\n  text\n    A request may be refused before it is read: see the errors list.\n  example f {}\n'), []);
t('CK-009 decisions', S(H + 'oracle node echo.mjs\nop f\n  input x? json\ndecision D-1 "uncited, no source"\ndecision D-2 "bad status"\n  source s\n  status Accepted\ndecision D-3 "superseded by nothing"\n  source s\n  status superseded\ndecision D-4 "superseded by an undeclared one"\n  source s\n  status superseded by D-9\ndecision D-5 "superseded properly"\n  source s\n  status superseded by D-6\ndecision D-6 "accepted, with more words"\n  source s\n  status accepted on 2026-01-01\ndecision D-7 "observed"\n  source s\n  status observed\nreq A "a"\n  decision D-2, D-3, D-4, D-5, D-6, D-7\n  example f {}\n'),
  ['s.duramen:6: warning T012', 's.duramen:6: warning T013', 's.duramen:7: error T027', 's.duramen:10: error T027', 's.duramen:13: error T027', 's.duramen:25: error T028', 's.duramen:25: error T028', 's.duramen:25: error T028', 's.duramen:25: warning T028']);
t('CK-009 comma, empty', S(H + 'oracle node echo.mjs\nop f\n  input x? json\ndecision D-1 "a comma after the word"\n  source s\n  status accepted, 2026-01-01\ndecision D-2 "an empty status"\n  source\n  status\nreq A "a"\n  decision D-1, D-2\n  example f {}\n'),
  ['s.duramen:6: error T027', 's.duramen:9: warning T013', 's.duramen:9: error T027']);

// REQ-OR
t('OR-001 no oracle', S(H + 'op f\n  input x? json\nreq A "a"\n  example f {}\n    expect result = 1\n'), ['s.duramen:2: error T019']);
t('OR-001 and T001', S(H + 'op f\n  input x? json\nreq A "a"\n  text\n    No example.\nreq B "b"\n  example f {}\n'), ['s.duramen:2: error T019', 's.duramen:5: error T001']);
t('OR-002 request lines', S('duramen 0.1\nspec s 1\n  request {"clock": 1}\noracle node echo.mjs\nop f\n  input line? boolean, x? json\nreq A "a"\n  example f {"line": true,  "x": 2.50}\n    expect result = "{\\"id\\":\\"A#1\\",\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true,  \\"x\\": 2.50}}"\n  example f {"line": true}\n    omit id\n    expect result = "{\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true}}"\n  example raw \'{"id": "x",  "op": "f", "input": {"line": true}}\'\n    expect id = "x"\n    expect result = "{\\"id\\": \\"x\\",  \\"op\\": \\"f\\", \\"input\\": {\\"line\\": true}}"\n'), []);
t('OR-002 quoted command', { 'sub/s.duramen': H + 'oracle node "my echo.mjs"\nop f\n  input x? json\nreq A "a"\n  example f {"x": 1}\n    expect result.x = 1\n', 'sub/my echo.mjs': ECHO }, []);
t('OR-002 mismatch', S(H + OP + 'req A "a"\n  text\n    No example.\nreq B "b"\n  example f {"x": 1}\n    expect result.x = 2\n'), ['s.duramen:6: error T001', 's.duramen:11: error T002']);
t('OR-003 paths', S(H + 'oracle node echo.mjs\nop f\n  input x? json, y? json, answer? json\nreq A "a"\n  example f {"x": 1.0, "y": [5, {"z": null}]}\n    expect result = {"y": [5, {"z": null}], "x": 1}\n    expect result.y.1.z = null\n    expect result.y.0 ≈ 5.5 ± 0.5\n    expect result.x = 2\n    expect result.y.2 = 5\n    expect result.y.0 ≈ 5.5 ± 0.4\n    expect result.y.1 = {}\n  example f {"answer": {"result": 0, "audit": "{\\"a\\": [1, 2]}"}}\n    expect audit.a.1 = 2\n    expect audit = "{\\"a\\": [1, 2]}"\n    expect audit.b = 1\n  table f\n    | x | result.x | result.y |\n    | 1 | 2        | 3        |\n  example f {"x": {"": 1}}\n    expect result.x. = 1\n    expect result..x = 1\n  example f {"y": [7, 8]}\n    expect result.y.1 = 8\n    expect result.y.length = 2\n    expect result.y.01 = 8\n'),
  ['s.duramen:11: error T002', 's.duramen:12: error T002', 's.duramen:13: error T002', 's.duramen:14: error T002', 's.duramen:18: error T002', 's.duramen:21: error T002', 's.duramen:21: error T002', 's.duramen:24: error T002', 's.duramen:27: error T002', 's.duramen:28: error T002']);
t('OR-003 error path', S(H + 'oracle node echo.mjs\nop f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n  example f {"answer": {"result": 1}}\n    expect error = "e"\n  example g {"answer": {"error": "e"}}\n    expect error = "e"\n'), ['s.duramen:10: error T002']);
t('OR-004 no program', S(H + 'oracle no-such-program-for-duramen\nop f\n  input x? json\nreq A "a"\n  example f {}\n'), ['s.duramen:3: error T020', 's.duramen:7: error T021']);
t('OR-004 exit status', S(H + 'oracle node echo.mjs\nop f\n  input x? json, exit? integer\nreq A "a"\n  example f {"x": 1}\n    expect result.x = 2\n  example f {"exit": 3}\n    expect result.exit = 3\n'), ['s.duramen:3: error T020', 's.duramen:8: error T002']);
t('OR-004 solo', S(H + 'oracle node echo.mjs\nop f\n  input exit? integer\nreq A "a"\n  example f {}\n  example raw \'{"id": "r", "op": "f", "input": {"exit": 4}}\'\n'), ['s.duramen:8: error T020']);
t('OR-004 solo no program', S(H + 'oracle no-such-program-for-duramen\nop f\n  input x? json\nreq A "a"\n  example raw \'{"id": "r", "op": "f"}\'\n'), ['s.duramen:7: error T020', 's.duramen:7: error T021']);
t('OR-004 unclosed quote', S(H + 'oracle node "echo.mjs\nop f\n  input x? json\nreq A "a"\n  example f {}\n'), ['s.duramen:3: error T020', 's.duramen:7: error T021']);
t('OR-005 silent', S(H + 'oracle node echo.mjs\nop f\n  input silent? boolean\nreq A "a"\n  example f {"silent": true}\n  example f {}\n  example raw \'{"id": "r", "op": "f", "input": {"silent": true}}\'\n'), ['s.duramen:7: error T021', 's.duramen:9: error T021']);
t('OR-006 oracle_error', S(H + 'oracle node echo.mjs\nop f\n  input answer? json\nreq A "a"\n  example f {"answer": {"oracle_error": "left open"}}\n    expect result = 1\n    expect result = ?\n'), ['s.duramen:7: error T022']);
t('OR-007 unexpected error', S(H + 'oracle node echo.mjs\nop f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n  example f {"answer": {"error": "e"}}\n  example f {"answer": {"error": "e"}}\n    expect error = "e"\n'), ['s.duramen:9: warning T024']);
t('OR-008 oracle value', S(H + OP + 'req A "a"\n  example f {"x": 1}\n    expect result.x = ?\n    expect result.y = ?\n'), ['s.duramen:9: error T025']);
