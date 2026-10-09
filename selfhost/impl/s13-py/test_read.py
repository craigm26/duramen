"""Tests for REQ-RC-*, REQ-SY-*: reading a record."""
import unittest

from helpers import S, check, ask, ECHO

H = ('duramen 0.1', 'spec s 1')


def d(*items):
    return ['s.duramen:%d: error %s' % i for i in items]


class Table(unittest.TestCase):
    def run_cases(self, rows):
        for row in rows:
            name, files, want = row[0], row[1], row[2]
            kw = row[3] if len(row) > 3 else {}
            with self.subTest(name):
                self.assertEqual(check(files, **kw), want)


class RecordFiles(Table):
    """REQ-RC-001 .. REQ-RC-006"""

    def test_rc001_files_of_a_record(self):
        ok = S(*H)
        self.run_cases([
            ('ex1', {'a.duramen': ok, 'notes.md': 'frobnicate\n', 'build/x.duramen': 'frobnicate\n',
                     'sub/build/x.duramen': 'frobnicate\n', 'node_modules/x.duramen': 'frobnicate\n',
                     '.hidden.duramen': 'frobnicate\n', 'sub/.hidden/x.duramen': 'frobnicate\n',
                     'sub/b.duramen': 'duramen 0.1\n'}, []),
            ('ex2 file whatever its name', {'notes.md': ok, 'a.duramen': 'frobnicate\n'}, [],
             {'entry': 'notes.md'}),
            ('ex3 folder', {'sub/a.duramen': ok, 'sub/deeper/b.duramen': 'duramen 0.1\n',
                            'c.duramen': 'frobnicate\n'}, [], {'entry': 'sub'}),
            ('ex4 file alone', {'sub/a.duramen': ok, 'sub/b.duramen': 'frobnicate\n'}, [],
             {'entry': 'sub/a.duramen'}),
            ('ex5 build as entry', {'build/a.duramen': ok, 'build/build/b.duramen': 'frobnicate\n'},
             [], {'entry': 'build'}),
            ('ex6 missing file', {'a.duramen': ok}, ['missing.duramen:1: error P046'],
             {'entry': 'missing.duramen'}),
            ('ex7 missing folder', {'a.duramen': ok}, ['sub:1: error P046'], {'entry': 'sub'}),
            ('ex8 no files', {'notes.md': ok}, ['.:1: error P046']),
        ])

    def test_rc002_order_of_files(self):
        self.run_cases([
            ('ex1', {'b.duramen': S('duramen 0.1', 'spec b 1'), 'a.duramen': S('duramen 0.1', 'spec a 1')},
             ['b.duramen:2: error P044']),
            ('ex2', {'a.duramen': S('duramen 0.1', 'spec a 1'), 'B.duramen': S('duramen 0.1', 'spec b 1')},
             ['a.duramen:2: error P044']),
            ('ex3', {'a/z.duramen': S('duramen 0.1', 'spec z 1'), 'a.duramen': S('duramen 0.1', 'spec a 1')},
             ['a/z.duramen:2: error P044']),
            ('ex4 utf-16 order', {'｡.duramen': S('duramen 0.1', 'spec x 1'),
                                  '\U0001f600.duramen': S('duramen 0.1', 'spec y 1')},
             ['｡.duramen:2: error P044']),
        ])

    def test_rc003_versions(self):
        self.run_cases([
            ('ex1', S('spec s 1'), d((1, 'P020'))),
            ('ex3', S('duramen 0.3', 'spec s 1'), d((1, 'P023'))),
            ('ex4', S('duramen 0.1', 'spec s 1', 'duramen 0.1', 'duramen 9'), d((3, 'P023'), (4, 'P023'))),
            ('ex5', S('duramen', 'spec s 1'), d((1, 'P023'))),
            ('ex6', {'a.duramen': S('duramen 0.1', 'spec s 1'), 'b.duramen': S('duramen 0.2')},
             ['.:1: error P047']),
            ('ex7', {'r/a.duramen': S('duramen 0.2', 'spec s 1'), 'r/b.duramen': S('duramen 0.1')},
             ['r:1: error P047'], {'entry': 'r'}),
            ('ex8', {'a.duramen': S('duramen 0.2', 'spec s 1'), 'b.duramen': S('duramen 0.2')}, []),
            ('ex9', {'a.duramen': S('duramen 0.2', 'spec s 1'), 'b.duramen': S('duramen 2')},
             ['b.duramen:1: error P023']),
            ('ex10', {'a.duramen': S('duramen 0.1 extra', 'spec s 1'), 'b.duramen': S('duramen 0.2')},
             ['a.duramen:1: error P023']),
            ('ex11', {'a.duramen': S('duramen 0.3', 'duramen 0.2', 'spec s 1'),
                      'b.duramen': S('duramen 0.1')},
             ['a.duramen:1: error P023', 'a.duramen:2: error P023']),
            ('empty', {'s.duramen': ''}, ['.:1: error P021', 's.duramen:1: error P020']),
        ])

    def test_rc004_one_spec(self):
        self.run_cases([
            ('ex1', S('duramen 0.1'), ['.:1: error P021']),
            ('ex2', {'s.duramen': S('duramen 0.1')}, ['s.duramen:1: error P021'], {'entry': 's.duramen'}),
            ('ex3', {'r/s.duramen': S('duramen 0.1')}, ['r:1: error P021'], {'entry': 'r'}),
            ('ex4', S('duramen 0.1', 'spec a 1', '', 'spec b 1'), d((4, 'P044'))),
            ('ex5', {'a.duramen': S('duramen 0.1', 'spec s 1', 'oracle node a.mjs'),
                     'b.duramen': S('duramen 0.1', 'oracle node b.mjs')}, ['b.duramen:2: error P044']),
            ('ex6', S('duramen 0.1', 'spec s 1', 'errors', '  e1 when x', 'errors', '  e2 when y'),
             d((5, 'P032'))),
            ('ex7', {'a.duramen': S('duramen 0.1', 'spec s 1', 'errors', '  e1 when x'),
                     'b.duramen': S('duramen 0.1', '', 'errors', '  e2 when y')},
             ['b.duramen:3: error P032']),
            ('ex8', S('duramen 0.1', 'spec s 1', 'errors', 'errors'), d((4, 'P032'))),
            ('ex9', S('duramen 0.1', 'spec s 1', 'duramen 0.1', '  title "t"', 'spec s', 'oracle',
                      '  source o.mjs', '    more', 'errors x', '  e if'),
             d((3, 'P023'), (4, 'P015'), (5, 'P021'), (5, 'P044'), (6, 'P028'), (8, 'P006'),
               (9, 'P050'), (10, 'P019'))),
            ('ex10', {'a.duramen': S('duramen 0.1', 'spec s 1', 'oracle', 'oracle node a.mjs'),
                      'b.duramen': S('duramen 0.1', 'oracle node b.mjs')},
             ['a.duramen:3: error P028', 'a.duramen:4: error P044', 'b.duramen:2: error P044']),
        ])

    def test_rc005_read_errors_stop_the_check(self):
        self.run_cases([
            ('ex1', S('duramen 0.1', 'spec s 1', 'frobnicate', 'req A "a"', '  example nope {}'),
             d((3, 'P002'))),
        ])

    def test_rc006_order_of_diagnostics(self):
        r = ask('check', {'files': {'b.duramen': S('frobnicate', 'duramen 0.1'),
                                    'a.duramen': S('duramen 0.1', 'spec s 1', '', '', 'frobnicate',
                                                   'frobnicate')}})
        self.assertEqual(r['result'], {'diagnostics': ['a.duramen:5: error P002',
                                                       'a.duramen:6: error P002',
                                                       'b.duramen:1: error P002'],
                                       'errors': 3, 'warnings': 0})
        self.run_cases([
            ('ex2', S('duramen 0.1', 'spec s 1', '', 'decision D-1 "one"', '  text',
                      '    No source, and cited by nothing.', '', 'req A "a"', '  decision D-2'),
             ['s.duramen:4: warning T012', 's.duramen:4: warning T013', 's.duramen:8: error T001',
              's.duramen:8: error T008']),
            ('ex3', S('duramen 0.1', 'spec s 1', '', 'decision D-1 "proposed"', '  source here',
                      '  status proposed', '', 'decision D-2 "contested"', '  source there',
                      '  status contested', '', 'req A "a"', '  decision D-1, D-2'),
             ['s.duramen:12: error T001', 's.duramen:12: error T028', 's.duramen:12: warning T028']),
        ])


class Syntax(Table):
    def test_sy001_lines(self):
        self.run_cases([
            ('bom crlf cr', {'s.duramen': '﻿duramen 0.1\r\nspec s 1\rnote  \n  text\t\n    Some text.  \r\n'}, []),
            ('tab', 'duramen 0.1\nspec s 1\n\tnote\n', d((3, 'P001'))),
            ('tab in clause', 'duramen 0.1\nspec s 1\nnote\n  \ttext\n', d((4, 'P001'))),
            ('nbsp', 'duramen 0.1\nspec s 1\n note\n', d((3, 'P001'))),
            ('blank lines', '  \t \nduramen 0.1\n\t\nspec s 1\n   \n', []),
            ('ideographic space, 2028', 'duramen 0.1　\nspec s 1 \nnote\n  text\n', d((4, 'P001'))),
            ('ex7', {'s.duramen': 'duramen 0.1\nspec s 1\n  title "a b"\noracle node echo.mjs\nop f\n'
                     '  input x? {a: b}, y? json\nerrors\n  e when x y\nreq A "A title"\n'
                     '  example f {"x": "p q"}\n    expect result.x = "p q"\n    expect result.x = "p q"\n'
                     '  example f {}\n    input y."k l"\n      text\n    expect result.y = {"k l": "text\\n"}\n'
                     '  example raw \'{"id":"r","op":"f","input":{"x":" "}}\'\n  example f {"x": 1}\n'
                     '    expect result.x ≈ 1 ± 0\n', 'echo.mjs': ECHO}, []),
            ('2028 in a title', 'duramen 0.1\nspec s 1\nsection S "a b"\n', []),
        ])

    def test_sy002_statements_and_comments(self):
        self.run_cases([
            ('ex1', S('# A comment.', 'duramen 0.1', '#A comment too.', 'spec s 1', 'frobnicate this',
                      '  title "ignored"', '    ignored too', 'Note'), d((5, 'P002'), (8, 'P002'))),
            ('ex2', S('  indented', ' # indented too', 'duramen 0.1', 'spec s 1'),
             d((1, 'P003'), (2, 'P003'))),
        ])

    def test_sy003_clauses(self):
        self.run_cases([
            ('ex1', S(*H, 'note', '  # A comment.', '  text', '    Text.', '    # Text, not a comment.'), []),
            ('ex2', S(*H, 'note', ' text'), d((4, 'P007'))),
            ('ex3', S(*H, 'note', '    Text without a clause.', '  text', '    Text.'), d((4, 'P006'))),
            ('ex4', S(*H, '  colour blue', '    more', 'note', '  example f {}', '    expect result = 1'),
             d((3, 'P015'), (6, 'P015'))),
            ('ex5', S(*H, 'note', ' # not a comment here', '    # nor here', '  text', '    Text.'),
             d((4, 'P007'), (5, 'P006'))),
            ('ex6', S(*H, '  title "one"', '  title "two"', '    more', 'note', '  text', '    One.',
                      '  text Two.', 'decision D "d"', '  source a', '  source b', '  status accepted',
                      '  status rejected'),
             d((4, 'P052'), (9, 'P052'), (12, 'P052'), (14, 'P052'))),
            ('ex7', S(*H, '  title x', '  title "two"', 'op f', '  request [1]', '  request {}'),
             d((3, 'P004'), (4, 'P052'), (6, 'P009'), (7, 'P052'))),
            ('ex8', S(*H, '  title "A title"', '    that goes on', '  # A comment.', '    # Another.'),
             d((4, 'P006'))),
        ])

    def test_sy004_duramen_spec_oracle(self):
        self.run_cases([
            ('ex1', S('duramen 0.1', '  title "x"', 'spec s 1'), d((2, 'P015'))),
            ('ex2', S('duramen 0.1', 'spec s'), d((2, 'P021'))),
            ('ex3', S('duramen 0.1', 'spec s 1 2'), d((2, 'P021'))),
            ('ex4', S('duramen 0.1', 'spec s 1.0.0-beta', '  title "The s program"', '  contract s-out-2',
                      '  request {"clock": "2026-01-01T00:00:00Z", "n": 1}', '  text', '    What s is.'), []),
            ('ex5', S(*H, '  request {"clock":'), d((3, 'P009'))),
            ('ex6', S(*H, '  request ["clock"]'), d((3, 'P009'))),
            ('ex7', S(*H, '  request {"op": "x"}'), d((3, 'P051'))),
            ('ex8', S(*H, 'oracle'), d((3, 'P028'))),
            ('ex9', S(*H, 'oracle node model.mjs --quiet', '  source model.mjs, lib/a.mjs lib/b.mjs',
                      '  timeout 5'), d((5, 'P015'))),
        ])

    def test_sy005_text(self):
        self.run_cases([
            ('ex1', S(*H, 'note', '  text Here.'), d((4, 'P008'))),
            ('ex2', S(*H, 'note', '  text', '    One.', '   Two.'), d((6, 'P008'))),
            ('ex3', S(*H, 'note', '  text', '    # It MUST be text.'), d((3, 'T004'))),
        ])

    def test_sy006_quoted_strings(self):
        self.run_cases([
            ('ex1', S(*H, 'section S A title'), d((3, 'P005'))),
            ('ex2', S(*H, 'section S "A title" and more'), d((3, 'P005'))),
            ('ex3', S(*H, 'section S'), d((3, 'P005'))),
            ('ex4', S(*H, 'section S "unclosed', 'section T "A" "B"', 'section U "'),
             d((3, 'P005'), (4, 'P004'), (5, 'P005'))),
            ('ex5', S(*H, 'section S "A \\q title"'), d((3, 'P004'))),
            ('ex6', S(*H, 'section S "A "quoted" title"'), d((3, 'P004'))),
            ('ex7', S(*H, '  title A title'), d((3, 'P004'))),
            ('ex8', S(*H, 'section S-1.x "A \\"quoted\\" title, é and all"'), []),
        ])

    def test_sy007_operations(self):
        self.run_cases([
            ('ex1', S(*H, 'op f g'), d((3, 'P031'))),
            ('ex2', S(*H, 'op'), d((3, 'P031'))),
            ('ex3', S(*H, 'op f', '  input a number, b? {x: number, y: string}, c "one, two" | [1, 2], d-e (f, g)',
                      '  result the sum', '  tolerance result.sum 0.005', '  tolerance result.count 0',
                      '  audit text', '  request {}'), []),
            ('ex4', S(*H, 'op f', '  input a', '  input a.b number', '  input b?number', '  input',
                      "  input c number, , d number,", "  input e 'x, y'", '  input c number',
                      '  input é number', 'op g', '  audit json', 'op', '  input x',
                      '  tolerance result.y'),
             d((4, 'P017'), (5, 'P017'), (6, 'P017'), (7, 'P017'), (8, 'P017'), (8, 'P017'), (9, 'P017'),
               (10, 'P052'), (11, 'P017'), (13, 'P050'), (14, 'P031'), (15, 'P017'), (16, 'P018'))),
            ('ex5', S(*H, 'op f', '  tolerance result.x', '  tolerance result.x -1',
                      '  tolerance result.x 0x10', '  tolerance result.x 1 2', '  tolerance result.x 1e-3'),
             d((4, 'P018'), (5, 'P018'), (6, 'P018'), (7, 'P018'))),
            ('ex6', S(*H, 'op f', '  tolerance foo 0.1', '  tolerance result.x -0', '  tolerance result.y 1e400'),
             d((6, 'P018'))),
            ('ex7', S(*H, 'op f', '  request 5', 'op g', '  request {"input": 5}', 'op h',
                      '  tolerance result.x 1', '  tolerance result.y 1', '  tolerance result.x 2'),
             d((4, 'P009'), (6, 'P051'), (10, 'P052'))),
            ('ex8', S(*H, 'op f', '  input a x], b y', '  input b z', '  input c "a\\", b" x, d y',
                      'op h', '  tolerance result.x 1', '  tolerance result.x result',
                      '  tolerance result.x 2'), d((5, 'P052'), (9, 'P018'), (10, 'P052'))),
        ])

    def test_sy008_errors_list(self):
        self.run_cases([
            ('ex1', S(*H, 'errors', '  bad_input when the input is not an object, or',
                      '    when it lacks a field', '  not_found when there is no such thing'), []),
            ('ex2', S(*H, 'errors first', '  e when x'), d((3, 'P050'))),
            ('ex3', S(*H, 'errors', '  e if x', '  e when', '    the input is bad', '  when x',
                      '  f when y', '   and z', '  g is', '   wrong'),
             d((4, 'P019'), (5, 'P019'), (7, 'P019'), (9, 'P006'), (10, 'P019'), (11, 'P006'))),
            ('ex4', S(*H, 'errors', '  e when x', '    # It MUST be read.'), d((4, 'T004'))),
            ('ex5', S(*H, 'errors', '  e when x', '  f when y', '  e when z'), []),
        ])

    def test_sy009_other_statements(self):
        self.run_cases([
            ('ex1', S(*H, 'section S "Things"', '  text', '    About things.', 'note', '  text',
                      '    A note.', 'open S-1 "Unsaid"', '  text', '    Left open.',
                      'decision D-1 "Why"', '  source the author', '  status accepted', '  text',
                      '    Because.', '  rejected "Another way, because no."', '  rejected "A third way."'),
             ['s.duramen:12: warning T012']),
            ('ex2', S(*H, 'req A "a"', '  on mac', '  status accepted', '  example f {}', 'note x',
                      'section S "s"', '  example f {}', 'decision D "d"', '  title "x"', 'open O "o"',
                      '  decision D'),
             d((4, 'P033'), (5, 'P015'), (7, 'P050'), (9, 'P015'), (11, 'P015'), (13, 'P015'))),
            ('ex3', S(*H, '  contract', 'req A "a"', '  decision', '  text', '    Words.'), d((4, 'T001'))),
        ])

    def test_sy010_examples(self):
        self.run_cases([
            ('ex1', S(*H, 'req A "a"', '  example', '  example f [1]', '  example f {"x": 1',
                      '  example f 2', '  example raw "{\\"id\\": \\"1\\",\\n\\"op\\": \\"f\\"}"'),
             d((4, 'P012'), (5, 'P012'), (6, 'P009'), (7, 'P012'), (8, 'P026'))),
            ('ex2', S(*H, 'req A "a"', '  example raw', '  example raw {"id": "x"}',
                      '  example raw "unclosed', '  example raw "a" "b"', '  example raw "carriage\\rreturn"',
                      '  example f [1]', '    expect result', '     expect result = 1',
                      '    expect result ≈ 1', '    expect result~1+-0.5', '    expect result="~"',
                      '    expect result =', '    expect = 1', '    request {"a": 1}',
                      '    request {"b": 1}', '    omit', '    omit a, b c', '    omit d'),
             d((4, 'P004'), (5, 'P004'), (6, 'P004'), (7, 'P004'), (8, 'P026'), (9, 'P012'),
               (10, 'P011'), (11, 'P006'), (12, 'P010'), (15, 'P009'), (16, 'P011'), (18, 'P052'),
               (19, 'P011'))),
            ('ex3', S(*H, 'req A "a"', "  example raw '{\"id\": \"x\"}'", '    omit', '    request',
                      '    input', '  example f {}', '    request', '    input', '    omit ,'),
             d((5, 'P022'), (6, 'P022'), (7, 'P022'), (9, 'P009'), (10, 'P049'), (11, 'P011'))),
            ('ex4', S(*H, 'req A "a"', '  example f {}', '    expect result ≈ 1 ± -1',
                      '    expect result ~ 1 +- x', '    expect result ≈ 0x10 ± 1',
                      '    expect result = {nope}', '    expect result', '    result = 1',
                      '     expect result = 1', '      expect result = 1', '    request [1]',
                      '    request {"input": {}}', "  example raw '{\"id\": \"x\"}'", '    omit id',
                      '    request {"a": 1}', '    input files."a"', '      text'),
             d((5, 'P010'), (6, 'P010'), (7, 'P010'), (8, 'P009'), (9, 'P011'), (10, 'P011'),
               (11, 'P006'), (12, 'P006'), (13, 'P009'), (14, 'P051'), (16, 'P022'), (17, 'P022'),
               (18, 'P022'))),
            ('ex5', S(*H, 'op f', 'req A "a"', '  text', '    T.', '  example f {}',
                      '    request {"a": 1}', '    request [2]', '    request {"id": 3}',
                      '    request {"b": 4}'), d((9, 'P052'), (10, 'P052'), (11, 'P052'))),
            ('ex6', S(*H, 'op f', 'req A "a"', '  text', '    T.', "  example raw '{\"id\":\"1\",\"op\":\"f\"}'",
                      '    input files."a" from "nofile"', '    input files."b"', '      hello',
                      '  example raw x', '    input files."c" from "nofile"'),
             d((8, 'P022'), (9, 'P022'), (11, 'P004'), (12, 'P022'))),
            ('ex7', S(*H, 'op f', 'req A "a"', '  text', '    T.', "  example raw '{\"id\":\"1\",\"op\":\"f\"}'",
                      '    input files."a" from "nofile"', '      hello', '  example f [1]', '    input a',
                      '      t', '    input a.b', '      u'),
             d((8, 'P022'), (9, 'P006'), (10, 'P012'), (13, 'P049'))),
        ])

    def test_sy011_texts(self):
        self.run_cases([
            ('ex1', {'s.duramen': S(*H, 'oracle node echo.mjs', 'op f', '  input files object, n? number',
                                    'req A "a"', '  example f {"n": 1}', '    input files."a b"',
                                    '      one', '        two', '', '    input files.x', '      three',
                                    '', '',
                                    '    expect result = {"n": 1, "files": {"a b": "one\\n  two\\n", "x": "three\\n"}}'),
                     'echo.mjs': ECHO}, []),
            ('ex2', S(*H, 'req A "a"', '  example f {"x": 1}', '    input files.', '    input files.."a"',
                      '    input "a', '    input x.y', '      text', '    input z',
                      '    input y from "missing.txt"'),
             d((5, 'P049'), (6, 'P049'), (7, 'P049'), (8, 'P049'), (10, 'P049'), (11, 'P048'))),
            ('ex3', S(*H, 'req A "a"', '  example f {}', '    input a', '     not six',
                      '      six, but after the line that ended the text'),
             d((5, 'P049'), (6, 'P006'), (7, 'P006'))),
            ('ex4', {'r/s.duramen': S(*H, 'req A "a"', '  example f {}', '    input a from "../outside.txt"',
                                      '    input b from "t.txt"', '      not its text',
                                      '    input c from "unclosed', '  example f {',
                                      '    input d from "../outside.txt"'),
                     'r/t.txt': 't\n', 'outside.txt': 'x'},
             ['r/s.duramen:5: error P048', 'r/s.duramen:7: error P006', 'r/s.duramen:8: error P049',
              'r/s.duramen:9: error P009', 'r/s.duramen:10: error P048'], {'entry': 'r'}),
            ('ex5', {'sub/s.duramen': S(*H, 'oracle node echo.mjs', 'op f', '  input t? string',
                                        'req A "a"', '  example f {}', '    input t from "data/t.txt"',
                                        '    expect result = {"t": "hello,\\r\\nworld"}'),
                     'sub/echo.mjs': ECHO, 'sub/data/t.txt': 'hello,\r\nworld'}, []),
            ('ex6', {'s.duramen': S(*H, 'oracle node echo.mjs', 'op f', '  input t? json, u? json, a? json',
                                    'req A "a"', '  example f {}', '    input t', '      one',
                                    '# a comment at indent 0', '  # and one at indent 2', '      two',
                                    '    input u from "./sub/..//b.txt"', '      # a comment indented six',
                                    '    expect result = {"t": "one\\ntwo\\n", "u": "\\ufeffbom"}',
                                    '  example f {"a": 1}', '    input x..y from "missing.txt"',
                                    '    input a.b from "missing.txt"', '    input a.c from "t.txt"',
                                    '    input t from "sub"'),
                     'echo.mjs': ECHO, 'b.txt': '﻿bom', 't.txt': 't'},
             d((17, 'P049'), (18, 'P048'), (19, 'P049'), (20, 'P048'))),
        ])

    def test_sy012_tables(self):
        self.run_cases([
            ('ex1', {'s.duramen': S(*H, 'oracle node echo.mjs', 'op f', '  input x? json, y? json',
                                    'req A "a"', '  table f',
                                    '    | x        | y | result.x | result.y ± 0.5 |',
                                    '    |----------|---|:--------:|----------------|',
                                    '    | "a\\|b"   |   | "a\\|b"   |                |',
                                    '    | 1        | 2 | ?        | 2.4            |'),
                     'echo.mjs': ECHO}, []),
            ('ex2', S(*H, 'req A "a"', '  table f', '  table f g', '    | x |', '    | 1 |', '  table f',
                      '    | x |', '  table f', '    | x | result ± -1 |', '    | 1 | 2           |',
                      '  table f', '    | x | result ± 0.5 |', '    | 1 | "2"          |',
                      '  table f', '    | x | y |', '    | 1 |', '    | {  | 2 |', '    x | 1',
                      '  table f', '    | x | |', '    | 1 | 2 |', '  table f', '    | x ± 1 |',
                      '    | 1     |'),
             d((4, 'P013'), (5, 'P013'), (8, 'P013'), (11, 'P010'), (15, 'P010'), (18, 'P014'),
               (19, 'P009'), (20, 'P006'), (22, 'P013'), (25, 'P010'))),
            ('ex3', S(*H, 'req A "a"', '  table f g', '    | x |', '    | {bad |', '  table f',
                      '   | x |', '    | 1 |', '  table f', '    | a.b | result |', '    | 1   | 2      |',
                      '  table f', '    | x | result ± lots |', '    | 1 | "two"         |',
                      '  table f', '    | x | result ± 1 2 | result.y+-0.5 |',
                      '    | 1 | 2            | 3             |', '  table f', '    | x | x |',
                      '    | 1 | 2 |', '  table f', '    | x | result ± 0.5 |',
                      '    | 1 | 2.25 [       |', '    | { | ?            |'),
             d((4, 'P013'), (7, 'P013'), (8, 'P006'), (11, 'P013'), (14, 'P010'), (17, 'P010'),
               (20, 'P013'), (24, 'P010'), (25, 'P009'))),
            ('ex4', {'s.duramen': S(*H, 'oracle node echo.mjs', 'op f', '  input x? json', 'req A "a"',
                                    '  table f', '    |---|----------|', '    | x | result.x |',
                                    '    |   |', '    | 1 | 1', '    |', '    | 2 | 2        |'),
                     'echo.mjs': ECHO}, []),
            ('ex5', S(*H, 'op f', '  input a int', 'req A "a"', '  text', '    T.', '  table f',
                      '    | a ± 1 | b! | result ± x |', '    | 1 | 2 | 3 |'),
             d((9, 'P010'), (9, 'P013'))),
            ('ex6', {'s.duramen': 'duramen 0.1\nspec s 1\noracle node echo.mjs\nop f\n  input answer? json, id? json\n'
                     'req A "a"\n  table f\n    | answer | result.k=1 | result.k~2 ± 0.5 | id |\n'
                     '    | ---\t|---|:-:|　|\n    | {"result": {"k=1": 1, "k~2": 2.25}} | 1 | 2 | "A#1" |\n'
                     '  table f\n    | answer | result.a b |\n    | 1 | 2 |\n', 'echo.mjs': ECHO},
             d((12, 'P013'))),
        ])

    def test_sy013_big_numbers(self):
        self.run_cases([
            ('ex1', S(*H, '  request {"x": 1e400}', 'op f', '  input a int', 'req A "a"', '  text', '    T.',
                      '  example f {"a": 1e400}', '  example f {"a": 1}',
                      '    expect result.a = [1, -1e400]', '    request {"y": 1e999}', '  table f',
                      '    | a | result |', '    | 1e999 | 1 |',
                      "  example raw '{\"id\":\"r\",\"op\":\"f\",\"input\":{\"a\":1e400}}'"),
             d((3, 'P009'), (9, 'P009'), (11, 'P009'), (12, 'P009'), (15, 'P009'))),
            ('ex2', S(*H, 'op f', '  input a int', '  tolerance result.x 1e400', 'req A "a"', '  text',
                      '    T.', '  example f {"a": 1}', '    expect result ≈ 1e400 ± 1',
                      '    expect result ≈ 1 ± 1e400', '  table f', '    | a | result ± 1e400 |',
                      '    | 1 | 2 |', '  table f', '    | a | result ± 1 |', '    | 1 | 1e400 |'),
             d((5, 'P018'), (10, 'P010'), (11, 'P010'), (13, 'P010'), (17, 'P010'))),
            ('ex3', S(*H, 'op f', '  request {"id": 1e400}', 'req A "a"', '  text', '    T.',
                      '  example f [1e400]', '  example f 1e400'),
             d((4, 'P009'), (8, 'P009'), (9, 'P009'))),
        ])


class Requests(unittest.TestCase):
    def test_rq002_bad_requests(self):
        import driver
        ok = 'duramen 0.1\nspec a 1\n'
        lines = [
            ('{not json', None, 'bad_request'), ('[1, 2]', None, 'bad_request'),
            ('{"op": "check", "input": {"files": {"a.duramen": "x"}}}', None, 'bad_request'),
            ('{"id": 7, "op": "check", "input": {}}', None, 'bad_request'),
            ('{"id": "x", "op": "lint", "input": {"files": {"a.duramen": "x"}}}', 'x', 'unknown_op'),
            ('{"id": "x", "op": "lint"}', 'x', 'unknown_op'),
            ('{"id": "x", "op": "check"}', 'x', 'bad_request'),
            ('{"id": "x", "op": "check", "input": {}}', 'x', 'bad_request'),
            ('{"id": "x", "op": "check", "input": {"files": {}}}', 'x', 'bad_request'),
            ('{"id": "x", "op": "check", "input": {"files": ["a.duramen"]}}', 'x', 'bad_request'),
        ]
        import json
        for name in ['../a.duramen', '/a.duramen', 'x/./a.duramen', 'x//a.duramen', 'c:a.duramen',
                     'a\\b.duramen', 'a\x00b']:
            lines.append((json.dumps({'id': 'x', 'op': 'cases', 'input': {'files': {name: ok}}}), 'x',
                          'bad_request'))
        lines.append((json.dumps({'id': 'x', 'op': 'check', 'input': {'files': {'a.duramen': 1}}}), 'x',
                      'bad_request'))
        lines.append((json.dumps({'id': 'x', 'op': 'cases', 'input': {'files': {'a': 'x', 'a/b.duramen': ok}}}),
                      'x', 'bad_request'))
        for entry in ['../a.duramen', 1, '', None, '/x']:
            lines.append((json.dumps({'id': 'x', 'op': 'check',
                                      'input': {'files': {'a.duramen': ok}, 'entry': entry}}), 'x',
                          'bad_request'))
        for line, id_, err in lines:
            with self.subTest(line):
                self.assertEqual(driver.handle(line), {'id': id_, 'error': err})

    def test_rq001_files_and_entry(self):
        ok = 'duramen 0.1\nspec a 1\n'
        self.assertEqual(check({'a.duramen': ok, 'b.duramen': 'frobnicate\n'}, entry='a.duramen'), [])
        self.assertEqual(check({'a.duramen': ok, 'b.duramen': 'frobnicate\n'}),
                         ['b.duramen:1: error P002', 'b.duramen:1: error P020'])
        self.assertEqual(check({'a.duramen': ok}, entry='.'), [])


if __name__ == '__main__':
    unittest.main()
