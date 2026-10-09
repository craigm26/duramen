"""Tests for duramen-core: at least one per MUST of SPEC.md, mostly the spec's own examples."""
import json
import os
import shutil
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import driver  # noqa: E402
from jsutil import js_dumps, js_num  # noqa: E402

with open(os.path.join(HERE, 'fixtures', 'echo.py'), encoding='utf-8') as _f:
    ECHO_PY = _f.read()

HEAD = 'duramen 0.1\nspec s 1\n'
ECHO = HEAD + 'oracle node echo.mjs\n'


def localize(files):
    """Swap the spec's `node echo.mjs` oracle for the Python port, placed next to the record."""
    out = {}
    extra = {}
    for name, text in files.items():
        if 'node echo.mjs' in text or 'node "my echo.mjs"' in text:
            folder = name.rpartition('/')[0]
            prefix = folder + '/' if folder else ''
            if 'node echo.mjs' in text:
                text = text.replace('node echo.mjs', '"%s" echo.py' % sys.executable)
                extra[prefix + 'echo.py'] = ECHO_PY
            else:
                text = text.replace('node "my echo.mjs"', '"%s" "my echo.py"' % sys.executable)
                extra[prefix + 'my echo.py'] = ECHO_PY
        out[name] = text
    for k, v in extra.items():
        out.setdefault(k, v)
    return out


def call(op, inp, rid='1'):
    return driver.respond(json.dumps({'id': rid, 'op': op, 'input': inp}).encode('utf-8'))


def check(files, entry=None, raw=False):
    inp = {'files': files if raw else localize(files)}
    if entry is not None:
        inp['entry'] = entry
    return call('check', inp)['result']


def diags(files, entry=None):
    return check(files, entry)['diagnostics']


def cases(files, entry=None):
    inp = {'files': localize(files)}
    if entry is not None:
        inp['entry'] = entry
    return call('cases', inp)['result']


def one(text, name='s.duramen'):
    return diags({name: text})


class Requests(unittest.TestCase):
    def raw_line(self, line):
        out = driver.respond(line.encode('utf-8'))
        return out

    def test_rq001_files_and_entry(self):
        a = HEAD
        self.assertEqual(check({'a.duramen': a, 'b.duramen': 'frobnicate\n'}, 'a.duramen', raw=True),
                         {'diagnostics': [], 'errors': 0, 'warnings': 0})
        self.assertEqual(diags({'a.duramen': a, 'b.duramen': 'frobnicate\n'}),
                         ['b.duramen:1: error P002', 'b.duramen:1: error P020'])

    def test_rq002_errors(self):
        r = self.raw_line
        self.assertEqual(r('{not json'), {'id': None, 'error': 'bad_request'})
        self.assertEqual(r('[1, 2]'), {'id': None, 'error': 'bad_request'})
        self.assertEqual(r('{"op": "check", "input": {}}'), {'id': None, 'error': 'bad_request'})
        self.assertEqual(r('{"id": 7, "op": "check", "input": {}}'), {'id': None, 'error': 'bad_request'})
        self.assertEqual(r('{"id": "1", "op": "lint", "input": {"files": {"a": "x"}}}'),
                         {'id': '1', 'error': 'unknown_op'})
        self.assertEqual(r('{"id": "1", "op": "lint"}'), {'id': '1', 'error': 'unknown_op'})
        self.assertEqual(r('{"id": "1", "op": "check"}'), {'id': '1', 'error': 'bad_request'})
        good = {'a.duramen': HEAD}
        bad_inputs = [{}, {'files': {}}, {'files': ['a.duramen']}, {'files': {'a.duramen': 1}},
                      {'files': {'../a.duramen': HEAD}}, {'files': {'/a.duramen': HEAD}},
                      {'files': {'x/./a.duramen': HEAD}}, {'files': {'x//a.duramen': HEAD}},
                      {'files': {'c:a.duramen': HEAD}}, {'files': {'a\\b.duramen': HEAD}},
                      {'files': {'a': 'x', 'a/b.duramen': HEAD}},
                      {'files': good, 'entry': '../a.duramen'}, {'files': good, 'entry': 1},
                      {'files': good, 'entry': ''}, {'files': {'a\0b': 'x'}}]
        for inp in bad_inputs:
            for op in ('check', 'cases'):
                self.assertEqual(call(op, inp), {'id': '1', 'error': 'bad_request'}, inp)
        # blank lines get no response; the driver goes on
        self.assertIsNone(self.raw_line('  \t '))
        self.assertIsNone(self.raw_line(''))


class Records(unittest.TestCase):
    def test_rc001_files_of_a_record(self):
        files = {'a.duramen': HEAD, 'notes.md': 'frobnicate', 'build/x.duramen': 'frobnicate',
                 'sub/build/x.duramen': 'frobnicate', 'node_modules/x.duramen': 'frobnicate',
                 '.hidden.duramen': 'frobnicate', 'sub/.hidden/x.duramen': 'frobnicate',
                 'sub/b.duramen': 'duramen 0.1\n'}
        self.assertEqual(diags(files), [])
        self.assertEqual(diags({'notes.md': HEAD, 'a.duramen': 'frobnicate'}, 'notes.md'), [])
        self.assertEqual(diags({'sub/a.duramen': HEAD, 'sub/deeper/b.duramen': 'duramen 0.1\n',
                                'c.duramen': 'frobnicate'}, 'sub'), [])
        self.assertEqual(diags({'sub/a.duramen': HEAD, 'sub/b.duramen': 'frobnicate'}, 'sub/a.duramen'), [])
        self.assertEqual(diags({'build/a.duramen': HEAD, 'build/build/b.duramen': 'frobnicate'}, 'build'), [])
        self.assertEqual(diags({'a.duramen': HEAD}, 'missing.duramen'), ['missing.duramen:1: error P046'])
        self.assertEqual(diags({'a.duramen': HEAD}, 'sub'), ['sub:1: error P046'])
        self.assertEqual(check({'notes.md': HEAD}),
                         {'diagnostics': ['.:1: error P046'], 'errors': 1, 'warnings': 0})

    def test_rc002_order_of_files(self):
        self.assertEqual(diags({'b.duramen': 'duramen 0.1\nspec b 1\n', 'a.duramen': HEAD}),
                         ['b.duramen:2: error P044'])
        self.assertEqual(diags({'a.duramen': HEAD, 'B.duramen': 'duramen 0.1\nspec b 1\n'}),
                         ['a.duramen:2: error P044'])
        self.assertEqual(diags({'a/z.duramen': 'duramen 0.1\nspec z 1\n', 'a.duramen': HEAD}),
                         ['a/z.duramen:2: error P044'])
        self.assertEqual(diags({'\uff61.duramen': 'duramen 0.1\nspec x 1\n',
                                '\U0001f600.duramen': 'duramen 0.1\nspec y 1\n'}),
                         ['\uff61.duramen:2: error P044'])

    def test_rc003_versions(self):
        self.assertEqual(one('spec s 1\n'), ['s.duramen:1: error P020'])
        self.assertEqual(one('duramen 0.3\nspec s 1\n'), ['s.duramen:1: error P023'])
        self.assertEqual(one('duramen 0.1\nspec s 1\nduramen 0.1\nduramen 9\n'),
                         ['s.duramen:3: error P023', 's.duramen:4: error P023'])
        self.assertEqual(one('duramen\nspec s 1\n'), ['s.duramen:1: error P023'])
        self.assertEqual(diags({'a.duramen': HEAD, 'b.duramen': 'duramen 0.2\n'}), ['.:1: error P047'])
        self.assertEqual(diags({'r/a.duramen': 'duramen 0.2\nspec s 1\n', 'r/b.duramen': 'duramen 0.1\n'}, 'r'),
                         ['r:1: error P047'])
        self.assertEqual(diags({'a.duramen': 'duramen 0.2\nspec s 1\n', 'b.duramen': 'duramen 0.2\n'}), [])
        self.assertEqual(diags({'a.duramen': 'duramen 0.2\nspec s 1\n', 'b.duramen': 'duramen 2\n'}),
                         ['b.duramen:1: error P023'])
        self.assertEqual(diags({'a.duramen': 'duramen 0.1 extra\nspec s 1\n', 'b.duramen': 'duramen 0.2\n'}),
                         ['a.duramen:1: error P023'])
        self.assertEqual(diags({'a.duramen': 'duramen 0.3\nduramen 0.2\nspec s 1\n',
                                'b.duramen': 'duramen 0.1\n'}),
                         ['a.duramen:1: error P023', 'a.duramen:2: error P023'])
        self.assertEqual(one(''), ['.:1: error P021', 's.duramen:1: error P020'])

    def test_rc004_one_spec(self):
        self.assertEqual(one('duramen 0.1\n'), ['.:1: error P021'])
        self.assertEqual(diags({'s.duramen': 'duramen 0.1\n'}, 's.duramen'), ['s.duramen:1: error P021'])
        self.assertEqual(diags({'r/s.duramen': 'duramen 0.1\n'}, 'r'), ['r:1: error P021'])
        self.assertEqual(one('duramen 0.1\nspec a 1\n\nspec b 1\n'), ['s.duramen:4: error P044'])
        self.assertEqual(diags({'a.duramen': HEAD + 'oracle node a.mjs\n',
                                'b.duramen': 'duramen 0.1\noracle node b.mjs\n'}), ['b.duramen:2: error P044'])
        self.assertEqual(one(HEAD + 'errors\n  e1 when x\nerrors\n  e2 when y\n'), ['s.duramen:5: error P032'])
        self.assertEqual(diags({'a.duramen': HEAD + 'errors\n  e1 when x\n',
                                'b.duramen': 'duramen 0.1\n\nerrors\n  e2 when y\n'}),
                         ['b.duramen:3: error P032'])
        self.assertEqual(one(HEAD + 'errors\nerrors\n'), ['s.duramen:4: error P032'])
        self.assertEqual(one('duramen 0.1\nspec s 1\nduramen 0.1\n  title "t"\nspec s\noracle\n'
                             '  source o.mjs\n    more\nerrors x\n  e if\n'),
                         ['s.duramen:3: error P023', 's.duramen:4: error P015', 's.duramen:5: error P021',
                          's.duramen:5: error P044', 's.duramen:6: error P028', 's.duramen:8: error P006',
                          's.duramen:9: error P050', 's.duramen:10: error P019'])
        self.assertEqual(diags({'a.duramen': HEAD + 'oracle\noracle node a.mjs\n',
                                'b.duramen': 'duramen 0.1\noracle node b.mjs\n'}),
                         ['a.duramen:3: error P028', 'a.duramen:4: error P044', 'b.duramen:2: error P044'])

    def test_rc005_read_errors_stop_the_check(self):
        self.assertEqual(one(HEAD + 'frobnicate\nreq A "a"\n  example nope {}\n'), ['s.duramen:3: error P002'])

    def test_rc006_order_of_diagnostics(self):
        r = check({'b.duramen': 'frobnicate\nduramen 0.1\n',
                   'a.duramen': 'duramen 0.1\nspec s 1\n\n\nfrobnicate\nfrobnicate\n'})
        self.assertEqual(r, {'diagnostics': ['a.duramen:5: error P002', 'a.duramen:6: error P002',
                                             'b.duramen:1: error P002'], 'errors': 3, 'warnings': 0})
        r = check({'s.duramen': HEAD + '\ndecision D-1 "one"\n  text\n    No source, and cited by nothing.\n'
                                 '\nreq A "a"\n  decision D-2\n'})
        self.assertEqual(r, {'diagnostics': ['s.duramen:4: warning T012', 's.duramen:4: warning T013',
                                             's.duramen:8: error T001', 's.duramen:8: error T008'],
                             'errors': 2, 'warnings': 2})
        r = check({'s.duramen': HEAD + '\ndecision D-1 "proposed"\n  source here\n  status proposed\n\n'
                                 'decision D-2 "contested"\n  source there\n  status contested\n\n'
                                 'req A "a"\n  decision D-1, D-2\n'})
        self.assertEqual(r['diagnostics'], ['s.duramen:12: error T001', 's.duramen:12: error T028',
                                            's.duramen:12: warning T028'])
        self.assertEqual((r['errors'], r['warnings']), (2, 1))


class Syntax(unittest.TestCase):
    def test_sy001_lines(self):
        self.assertEqual(one('\ufeffduramen 0.1\r\nspec s 1\rnote  \n  text\t\n    Some text.  \r\n'), [])
        self.assertEqual(one(HEAD + '\tnote\n'), ['s.duramen:3: error P001'])
        self.assertEqual(one(HEAD + 'note\n  \ttext\n'), ['s.duramen:4: error P001'])
        self.assertEqual(one(HEAD + '\u00a0note\n'), ['s.duramen:3: error P001'])
        self.assertEqual(one('  \t \nduramen 0.1\n\t\nspec s 1\n   \n'), [])
        self.assertEqual(one('duramen 0.1\u3000\nspec s 1\u2028\nnote\n\u205f text\n'), ['s.duramen:4: error P001'])
        text = ('duramen 0.1\nspec s 1\n  title "a b"\noracle node echo.mjs\nop f\n  input x? {a: b}, y? json\n'
                'errors\n  e when x y\nreq A "A title"\n  example f {"x": "p q"}\n    expect result.x = "p q"\n'
                '    expect result.x = "p q"\n  example f {}\n    input y."k l"\n      text\n'
                '    expect result.y = {"k l": "text\\n"}\n'
                '  example raw \'{"id":"r","op":"f","input":{"x":" "}}\'\n  example f {"x": 1}\n'
                '    expect result.x \u2248 1 \u00b1 0\n')
        self.assertEqual(one(text), [])

    def test_sy002_statements(self):
        self.assertEqual(one('# A comment.\nduramen 0.1\n#A comment too.\nspec s 1\nfrobnicate this\n'
                             '  title "ignored"\n    ignored too\nNote\n'),
                         ['s.duramen:5: error P002', 's.duramen:8: error P002'])
        self.assertEqual(one('  indented\n # indented too\nduramen 0.1\nspec s 1\n'),
                         ['s.duramen:1: error P003', 's.duramen:2: error P003'])

    def test_sy003_clauses(self):
        self.assertEqual(one(HEAD + 'note\n  # A comment.\n  text\n    Text.\n    # Text, not a comment.\n'), [])
        self.assertEqual(one(HEAD + 'note\n text\n'), ['s.duramen:4: error P007'])
        self.assertEqual(one(HEAD + 'note\n    Text without a clause.\n  text\n    Text.\n'),
                         ['s.duramen:4: error P006'])
        self.assertEqual(one(HEAD + '  colour blue\n    more\nnote\n  example f {}\n    expect result = 1\n'),
                         ['s.duramen:3: error P015', 's.duramen:6: error P015'])
        self.assertEqual(one(HEAD + 'note\n # not a comment here\n    # nor here\n  text\n    Text.\n'),
                         ['s.duramen:4: error P007', 's.duramen:5: error P006'])
        self.assertEqual(one(HEAD + '  title "one"\n  title "two"\n    more\nnote\n  text\n    One.\n  text Two.\n'
                             'decision D "d"\n  source a\n  source b\n  status accepted\n  status rejected\n'),
                         ['s.duramen:4: error P052', 's.duramen:9: error P052', 's.duramen:12: error P052',
                          's.duramen:14: error P052'])
        self.assertEqual(one(HEAD + '  title x\n  title "two"\nop f\n  request [1]\n  request {}\n'),
                         ['s.duramen:3: error P004', 's.duramen:4: error P052', 's.duramen:6: error P009',
                          's.duramen:7: error P052'])
        self.assertEqual(one(HEAD + '  title "A title"\n    that goes on\n  # A comment.\n    # Another.\n'),
                         ['s.duramen:4: error P006'])

    def test_sy004_duramen_spec_oracle(self):
        self.assertEqual(one('duramen 0.1\n  title "x"\nspec s 1\n'), ['s.duramen:2: error P015'])
        self.assertEqual(one('duramen 0.1\nspec s\n'), ['s.duramen:2: error P021'])
        self.assertEqual(one('duramen 0.1\nspec s 1 2\n'), ['s.duramen:2: error P021'])
        self.assertEqual(one('duramen 0.1\nspec s 1.0.0-beta\n  title "The s program"\n  contract s-out-2\n'
                             '  request {"clock": "2026-01-01T00:00:00Z", "n": 1}\n  text\n    What s is.\n'), [])
        self.assertEqual(one(HEAD + '  request {"clock":\n'), ['s.duramen:3: error P009'])
        self.assertEqual(one(HEAD + '  request ["clock"]\n'), ['s.duramen:3: error P009'])
        self.assertEqual(one(HEAD + '  request {"op": "x"}\n'), ['s.duramen:3: error P051'])
        self.assertEqual(one(HEAD + 'oracle\n'), ['s.duramen:3: error P028'])
        self.assertEqual(one(HEAD + 'oracle node model.mjs --quiet\n  source model.mjs, lib/a.mjs lib/b.mjs\n'
                             '  timeout 5\n'), ['s.duramen:5: error P015'])

    def test_sy005_text(self):
        self.assertEqual(one(HEAD + 'note\n  text Here.\n'), ['s.duramen:4: error P008'])
        self.assertEqual(one(HEAD + 'note\n  text\n    One.\n   Two.\n'), ['s.duramen:6: error P008'])
        self.assertEqual(one(HEAD + 'note\n  text\n    # It MUST be text.\n'), ['s.duramen:3: error T004'])

    def test_sy006_quoted(self):
        self.assertEqual(one(HEAD + 'section S A title\n'), ['s.duramen:3: error P005'])
        self.assertEqual(one(HEAD + 'section S "A title" and more\n'), ['s.duramen:3: error P005'])
        self.assertEqual(one(HEAD + 'section S\n'), ['s.duramen:3: error P005'])
        self.assertEqual(one(HEAD + 'section S "unclosed\nsection T "A" "B"\nsection U "\n'),
                         ['s.duramen:3: error P005', 's.duramen:4: error P004', 's.duramen:5: error P005'])
        self.assertEqual(one(HEAD + 'section S "A \\q title"\n'), ['s.duramen:3: error P004'])
        self.assertEqual(one(HEAD + 'section S "A "quoted" title"\n'), ['s.duramen:3: error P004'])
        self.assertEqual(one(HEAD + '  title A title\n'), ['s.duramen:3: error P004'])
        self.assertEqual(one(HEAD + 'section S-1.x "A \\"quoted\\" title, \u00e9 and all"\n'), [])

    def test_sy007_operations(self):
        self.assertEqual(one(HEAD + 'op f g\n'), ['s.duramen:3: error P031'])
        self.assertEqual(one(HEAD + 'op\n'), ['s.duramen:3: error P031'])
        self.assertEqual(one(HEAD + 'op f\n  input a number, b? {x: number, y: string}, c "one, two" | [1, 2], '
                             'd-e (f, g)\n  result the sum\n  tolerance result.sum 0.005\n'
                             '  tolerance result.count 0\n  audit text\n  request {}\n'), [])
        self.assertEqual(one(HEAD + 'op f\n  input a\n  input a.b number\n  input b?number\n  input\n'
                             '  input c number, , d number,\n  input e \'x, y\'\n  input c number\n'
                             '  input \u00e9 number\nop g\n  audit json\nop\n  input x\n  tolerance result.y\n'),
                         ['s.duramen:4: error P017', 's.duramen:5: error P017', 's.duramen:6: error P017',
                          's.duramen:7: error P017', 's.duramen:8: error P017', 's.duramen:8: error P017',
                          's.duramen:9: error P017', 's.duramen:10: error P052', 's.duramen:11: error P017',
                          's.duramen:13: error P050', 's.duramen:14: error P031', 's.duramen:15: error P017',
                          's.duramen:16: error P018'])
        self.assertEqual(one(HEAD + 'op f\n  tolerance result.x\n  tolerance result.x -1\n'
                             '  tolerance result.x 0x10\n  tolerance result.x 1 2\n  tolerance result.x 1e-3\n'),
                         ['s.duramen:4: error P018', 's.duramen:5: error P018', 's.duramen:6: error P018',
                          's.duramen:7: error P018'])
        self.assertEqual(one(HEAD + 'op f\n  tolerance foo 0.1\n  tolerance result.x -0\n'
                             '  tolerance result.y 1e400\n'), ['s.duramen:6: error P018'])
        self.assertEqual(one(HEAD + 'op f\n  request 5\nop g\n  request {"input": 5}\nop h\n'
                             '  tolerance result.x 1\n  tolerance result.y 1\n  tolerance result.x 2\n'),
                         ['s.duramen:4: error P009', 's.duramen:6: error P051', 's.duramen:10: error P052'])
        self.assertEqual(one(HEAD + 'op f\n  input a x], b y\n  input b z\n  input c "a\\", b" x, d y\n'
                             'op h\n  tolerance result.x 1\n  tolerance result.x result\n  tolerance result.x 2\n'),
                         ['s.duramen:5: error P052', 's.duramen:9: error P018', 's.duramen:10: error P052'])
        self.assertEqual(one(ECHO + 'op f\n  input a (x}, b json\nreq A "a"\n  example f {"b": 1}\n'
                             '    expect result.b = 1\n'), ['s.duramen:7: error T010'])

    def test_sy008_errors_list(self):
        self.assertEqual(one(HEAD + 'errors\n  bad_input when the input is not an object, or\n'
                             '    when it lacks a field\n  not_found when there is no such thing\n'), [])
        self.assertEqual(one(HEAD + 'errors first\n  e when x\n'), ['s.duramen:3: error P050'])
        self.assertEqual(one(HEAD + 'errors\n  e if x\n  e when\n    the input is bad\n  when x\n'
                             '  f when y\n   and z\n  g is\n   wrong\n'),
                         ['s.duramen:4: error P019', 's.duramen:5: error P019', 's.duramen:7: error P019',
                          's.duramen:9: error P006', 's.duramen:10: error P019', 's.duramen:11: error P006'])
        self.assertEqual(one(HEAD + 'errors\n  e when x\n    # It MUST be read.\n'), ['s.duramen:4: error T004'])
        self.assertEqual(one(HEAD + 'errors\n  e when x\n  f when y\n  e when z\n'), [])

    def test_sy009_statements(self):
        self.assertEqual(one(HEAD + 'section S "Things"\n  text\n    About things.\nnote\n  text\n    A note.\n'
                             'open S-1 "Unsaid"\n  text\n    Left open.\ndecision D-1 "Why"\n  source the author\n'
                             '  status accepted\n  text\n    Because.\n  rejected "Another way, because no."\n'
                             '  rejected "A third way."\n'), ['s.duramen:12: warning T012'])
        self.assertEqual(one(HEAD + 'req A "a"\n  on mac\n  status accepted\n  example f {}\nnote x\n'
                             'section S "s"\n  example f {}\ndecision D "d"\n  title "x"\nopen O "o"\n  decision D\n'),
                         ['s.duramen:4: error P033', 's.duramen:5: error P015', 's.duramen:7: error P050',
                          's.duramen:9: error P015', 's.duramen:11: error P015', 's.duramen:13: error P015'])
        self.assertEqual(one('duramen 0.1\nspec s 1\n  contract\nreq A "a"\n  decision\n  text\n    Words.\n'),
                         ['s.duramen:4: error T001'])

    def test_sy010_examples(self):
        self.assertEqual(one(HEAD + 'req A "a"\n  example\n  example f [1]\n  example f {"x": 1\n  example f 2\n'
                             '  example raw "{\\"id\\": \\"1\\",\\n\\"op\\": \\"f\\"}"\n'),
                         ['s.duramen:4: error P012', 's.duramen:5: error P012', 's.duramen:6: error P009',
                          's.duramen:7: error P012', 's.duramen:8: error P026'])
        self.assertEqual(one(HEAD + 'req A "a"\n  example raw\n  example raw {"id": "x"}\n  example raw "unclosed\n'
                             '  example raw "a" "b"\n  example raw "carriage\\rreturn"\n  example f [1]\n'
                             '    expect result\n     expect result = 1\n    expect result \u2248 1\n'
                             '    expect result~1+-0.5\n    expect result="~"\n    expect result =\n'
                             '    expect = 1\n    request {"a": 1}\n    request {"b": 1}\n    omit\n'
                             '    omit a, b c\n    omit d\n'),
                         ['s.duramen:4: error P004', 's.duramen:5: error P004', 's.duramen:6: error P004',
                          's.duramen:7: error P004', 's.duramen:8: error P026', 's.duramen:9: error P012',
                          's.duramen:10: error P011', 's.duramen:11: error P006', 's.duramen:12: error P010',
                          's.duramen:15: error P009', 's.duramen:16: error P011', 's.duramen:18: error P052',
                          's.duramen:19: error P011'])
        self.assertEqual(one(HEAD + 'req A "a"\n  example raw \'{"id": "x"}\'\n    omit\n    request\n    input\n'
                             '  example f {}\n    request\n    input\n    omit ,\n'),
                         ['s.duramen:5: error P022', 's.duramen:6: error P022', 's.duramen:7: error P022',
                          's.duramen:9: error P009', 's.duramen:10: error P049', 's.duramen:11: error P011'])
        self.assertEqual(one(HEAD + 'req A "a"\n  example f {}\n    expect result \u2248 1 \u00b1 -1\n'
                             '    expect result ~ 1 +- x\n    expect result \u2248 0x10 \u00b1 1\n'
                             '    expect result = {nope}\n    expect result\n    result = 1\n'
                             '     expect result = 1\n      expect result = 1\n    request [1]\n'
                             '    request {"input": {}}\n  example raw \'{"id": "x"}\'\n    omit id\n'
                             '    request {"a": 1}\n    input files."a"\n      text\n'),
                         ['s.duramen:5: error P010', 's.duramen:6: error P010', 's.duramen:7: error P010',
                          's.duramen:8: error P009', 's.duramen:9: error P011', 's.duramen:10: error P011',
                          's.duramen:11: error P006', 's.duramen:12: error P006', 's.duramen:13: error P009',
                          's.duramen:14: error P051', 's.duramen:16: error P022', 's.duramen:17: error P022',
                          's.duramen:18: error P022'])
        self.assertEqual(one(HEAD + 'op f\nreq A "a"\n  text\n    T.\n  example f {}\n    request {"a": 1}\n'
                             '    request [2]\n    request {"id": 3}\n    request {"b": 4}\n'),
                         ['s.duramen:9: error P052', 's.duramen:10: error P052', 's.duramen:11: error P052'])
        self.assertEqual(one(HEAD + 'op f\nreq A "a"\n  text\n    T.\n  example raw \'{"id":"1","op":"f"}\'\n'
                             '    input files."a" from "nofile"\n    input files."b"\n      hello\n'
                             '  example raw x\n    input files."c" from "nofile"\n'),
                         ['s.duramen:8: error P022', 's.duramen:9: error P022', 's.duramen:11: error P004',
                          's.duramen:12: error P022'])
        self.assertEqual(one(HEAD + 'op f\nreq A "a"\n  text\n    T.\n  example raw \'{"id":"1","op":"f"}\'\n'
                             '    input files."a" from "nofile"\n      hello\n  example f [1]\n    input a\n'
                             '      t\n    input a.b\n      u\n'),
                         ['s.duramen:8: error P022', 's.duramen:9: error P006', 's.duramen:10: error P012',
                          's.duramen:13: error P049'])

    def test_sy011_input_texts(self):
        t = (ECHO + 'op f\n  input files object, n? number\nreq A "a"\n  example f {"n": 1}\n'
             '    input files."a b"\n      one\n        two\n\n    input files.x\n      three\n\n\n'
             '    expect result = {"n": 1, "files": {"a b": "one\\n  two\\n", "x": "three\\n"}}\n')
        self.assertEqual(one(t), [])
        self.assertEqual(one(HEAD + 'req A "a"\n  example f {"x": 1}\n    input files.\n    input files.."a"\n'
                             '    input "a\n    input x.y\n      text\n    input z\n    input y from "missing.txt"\n'),
                         ['s.duramen:5: error P049', 's.duramen:6: error P049', 's.duramen:7: error P049',
                          's.duramen:8: error P049', 's.duramen:10: error P049', 's.duramen:11: error P048'])
        self.assertEqual(one(HEAD + 'req A "a"\n  example f {}\n    input a\n     not six\n'
                             '      six, but after the line that ended the text\n'),
                         ['s.duramen:5: error P049', 's.duramen:6: error P006', 's.duramen:7: error P006'])
        r = diags({'r/s.duramen': HEAD + 'req A "a"\n  example f {}\n    input a from "../outside.txt"\n'
                                   '    input b from "t.txt"\n      not its text\n    input c from "unclosed\n'
                                   '  example f {\n    input d from "../outside.txt"\n',
                   'r/t.txt': 't\n', 'outside.txt': 'x'}, 'r')
        self.assertEqual(r, ['r/s.duramen:5: error P048', 'r/s.duramen:7: error P006', 'r/s.duramen:8: error P049',
                             'r/s.duramen:9: error P009', 'r/s.duramen:10: error P048'])
        r = diags({'sub/s.duramen': ECHO + 'op f\n  input t? string\nreq A "a"\n  example f {}\n'
                                    '    input t from "data/t.txt"\n    expect result = {"t": "hello,\\r\\nworld"}\n',
                   'sub/data/t.txt': 'hello,\r\nworld'})
        self.assertEqual(r, [])
        r = diags({'s.duramen': ECHO + 'op f\n  input t? json, u? json, a? json\nreq A "a"\n  example f {}\n'
                                '    input t\n      one\n# a comment at indent 0\n  # and one at indent 2\n'
                                '      two\n    input u from "./sub/..//b.txt"\n      # a comment indented six\n'
                                '    expect result = {"t": "one\\ntwo\\n", "u": "\\ufeffbom"}\n'
                                '  example f {"a": 1}\n    input x..y from "missing.txt"\n'
                                '    input a.b from "missing.txt"\n    input a.c from "t.txt"\n'
                                '    input t from "sub"\n',
                   'b.txt': '\ufeffbom', 't.txt': 't'})
        self.assertEqual(r, ['s.duramen:17: error P049', 's.duramen:18: error P048', 's.duramen:19: error P049',
                             's.duramen:20: error P048'])

    def test_sy012_tables(self):
        t = (ECHO + 'op f\n  input x? json, y? json\nreq A "a"\n  table f\n'
             '    | x        | y | result.x | result.y \u00b1 0.5 |\n'
             '    |----------|---|:--------:|----------------|\n'
             '    | "a\\|b"   |   | "a\\|b"   |                |\n'
             '    | 1        | 2 | ?        | 2.4            |\n')
        self.assertEqual(one(t), [])
        self.assertEqual(one(HEAD + 'req A "a"\n  table f\n  table f g\n    | x |\n    | 1 |\n  table f\n    | x |\n'
                             '  table f\n    | x | result \u00b1 -1 |\n    | 1 | 2           |\n  table f\n'
                             '    | x | result \u00b1 0.5 |\n    | 1 | "2"          |\n  table f\n    | x | y |\n'
                             '    | 1 |\n    | {  | 2 |\n    x | 1\n  table f\n    | x | |\n    | 1 | 2 |\n'
                             '  table f\n    | x \u00b1 1 |\n    | 1     |\n'),
                         ['s.duramen:4: error P013', 's.duramen:5: error P013', 's.duramen:8: error P013',
                          's.duramen:11: error P010', 's.duramen:15: error P010', 's.duramen:18: error P014',
                          's.duramen:19: error P009', 's.duramen:20: error P006', 's.duramen:22: error P013',
                          's.duramen:25: error P010'])
        self.assertEqual(one(HEAD + 'req A "a"\n  table f g\n    | x |\n    | {bad |\n  table f\n   | x |\n'
                             '    | 1 |\n  table f\n    | a.b | result |\n    | 1   | 2      |\n  table f\n'
                             '    | x | result \u00b1 lots |\n    | 1 | "two"         |\n  table f\n'
                             '    | x | result \u00b1 1 2 | result.y+-0.5 |\n    | 1 | 2            | 3             |\n'
                             '  table f\n    | x | x |\n    | 1 | 2 |\n  table f\n    | x | result \u00b1 0.5 |\n'
                             '    | 1 | 2.25 [       |\n    | { | ?            |\n'),
                         ['s.duramen:4: error P013', 's.duramen:7: error P013', 's.duramen:8: error P006',
                          's.duramen:11: error P013', 's.duramen:14: error P010', 's.duramen:17: error P010',
                          's.duramen:20: error P013', 's.duramen:24: error P010', 's.duramen:25: error P009'])
        self.assertEqual(one(ECHO + 'op f\n  input x? json\nreq A "a"\n  table f\n    |---|----------|\n'
                             '    | x | result.x |\n    |   |\n    | 1 | 1\n    |\n    | 2 | 2        |\n'), [])
        self.assertEqual(one(HEAD + 'op f\n  input a int\nreq A "a"\n  text\n    T.\n  table f\n'
                             '    | a \u00b1 1 | b! | result \u00b1 x |\n    | 1 | 2 | 3 |\n'),
                         ['s.duramen:9: error P010', 's.duramen:9: error P013'])
        t = ('duramen 0.1\nspec s 1\noracle node echo.mjs\nop f\n  input answer? json, id? json\nreq A "a"\n'
             '  table f\n    | answer | result.k=1 | result.k~2 \u00b1 0.5 | id |\n    | ---\t|---|:-:|\u3000|\n'
             '    | {"result": {"k=1": 1, "k~2": 2.25}} | 1 | 2 | "A#1" |\n  table f\n'
             '    | answer | result.a b |\n    | 1 | 2 |\n')
        self.assertEqual(one(t), ['s.duramen:12: error P013'])
        self.assertEqual(one(ECHO + 'op f\n  input result? json\nreq A "a"\n  table f\n    | result |\n    | 1 |\n'),
                         ['s.duramen:9: error T002'])

    def test_sy013_big_numbers(self):
        self.assertEqual(one(HEAD + '  request {"x": 1e400}\nop f\n  input a int\nreq A "a"\n  text\n    T.\n'
                             '  example f {"a": 1e400}\n  example f {"a": 1}\n    expect result.a = [1, -1e400]\n'
                             '    request {"y": 1e999}\n  table f\n    | a | result |\n    | 1e999 | 1 |\n'
                             '  example raw \'{"id":"r","op":"f","input":{"a":1e400}}\'\n'),
                         ['s.duramen:3: error P009', 's.duramen:9: error P009', 's.duramen:11: error P009',
                          's.duramen:12: error P009', 's.duramen:15: error P009'])
        self.assertEqual(one(HEAD + 'op f\n  input a int\n  tolerance result.x 1e400\nreq A "a"\n  text\n    T.\n'
                             '  example f {"a": 1}\n    expect result \u2248 1e400 \u00b1 1\n'
                             '    expect result \u2248 1 \u00b1 1e400\n  table f\n    | a | result \u00b1 1e400 |\n'
                             '    | 1 | 2 |\n  table f\n    | a | result \u00b1 1 |\n    | 1 | 1e400 |\n'),
                         ['s.duramen:5: error P018', 's.duramen:10: error P010', 's.duramen:11: error P010',
                          's.duramen:13: error P010', 's.duramen:17: error P010'])
        self.assertEqual(one(HEAD + 'op f\n  request {"id": 1e400}\nreq A "a"\n  text\n    T.\n  example f [1e400]\n'
                             '  example f 1e400\n'),
                         ['s.duramen:4: error P009', 's.duramen:8: error P009', 's.duramen:9: error P009'])


class Checks(unittest.TestCase):
    def test_ck001_every_req_has_example(self):
        self.assertEqual(one(HEAD + 'req A "a"\n  text\n    It MUST work.\n'), ['s.duramen:3: error T001'])
        self.assertEqual(one(HEAD + 'req A "a"\n  table f\n    | x |\n    |---|\n'), ['s.duramen:4: error P013'])

    def test_ck002_unique_ids(self):
        t = (ECHO + 'op f\n  input x? json\nreq A "a"\n  example f {}\nreq A "again"\n  example f {}\n'
             'open A "an open item may share a requirement\'s ID"\n  text\n    Open.\nopen B "b"\n  text\n    Open.\n'
             'open B "b again"\n  text\n    Open.\ndecision D-1 "d"\n  source s\ndecision D-1 "d again"\n  source s\n'
             'req C "c"\n  decision D-1\n  example f {}\n')
        self.assertEqual(one(t), ['s.duramen:8: error T007', 's.duramen:16: error T007', 's.duramen:21: error T007'])
        r = diags({'a.duramen': ECHO + 'op f\n  input x? json\nreq A "a"\n  example f {}\n',
                   'b.duramen': 'duramen 0.1\nreq A "a"\n  example f {}\nop f\n  input y? json\n'})
        self.assertEqual(r, ['b.duramen:2: error T007', 'b.duramen:4: error T007'])
        t = (ECHO + 'op f\n  input x? json\nreq A "a"\n  decision REQ-A, OPEN-B\n  example f {}\n'
             'decision REQ-A "named like a requirement"\n  source s\ndecision OPEN-B "named like an open item"\n'
             '  source s\nopen B "b"\n  text\n    Open.\nreq A "a third time"\n  example f {}\n'
             'req A "and a third"\n  example f {}\n')
        self.assertEqual(one(t), ['s.duramen:16: error T007', 's.duramen:18: error T007'])

    def test_ck003_cited_decisions(self):
        t = (ECHO + 'op f\n  input x? json\ndecision D-1 "d"\n  source s\nreq A "a"\n  decision D-1 D-2, D-3\n'
             '  decision D-2\n  example f {}\n')
        self.assertEqual(one(t), ['s.duramen:8: error T008', 's.duramen:8: error T008'])

    def test_ck004_declared_ops(self):
        t = (ECHO + 'op f\n  input a number, b? number\nerrors\n  e when never\nreq A "a"\n  example g {"a": 1}\n'
             '  example f {"b": 1}\n  example f {"a": 1, "c": 2}\n  example f\n'
             '  example g {"answer": {"error": "e"}}\n    expect error = "e"\n'
             '  example raw \'{"id": "A#6", "op": "g"}\'\n  table f\n    | b | c |\n    | 1 | 2 |\n'
             '  example g {}\n    expect error.code = "e"\n')
        self.assertEqual(one(t), ['s.duramen:9: error T009', 's.duramen:10: error T010', 's.duramen:11: warning T011',
                                  's.duramen:12: error T010', 's.duramen:18: error T010',
                                  's.duramen:18: warning T011', 's.duramen:19: error T009'])

    def test_ck005_expected_errors_declared(self):
        t = (ECHO + 'op f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n'
             '  example f {"answer": {"error": "e"}}\n    expect error = "e"\n'
             '  example f {"answer": {"error": "nope"}}\n    expect error = "nope"\n'
             '  example raw \'{"id": "r", "op": "f", "input": {"answer": {"error": "other"}}}\'\n'
             '    expect error = "other"\n  example f {"answer": {"error": "e"}}\n    expect error = ?\n')
        self.assertEqual(one(t), ['s.duramen:12: error T023', 's.duramen:14: error T023'])
        t = (ECHO + 'op f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n'
             '  example f {"answer": {"error": 1}}\n    expect error \u2248 1 \u00b1 0\n  table f\n'
             '    | answer           | error \u00b1 1 |\n    | {"error": 2}     | 2         |\n'
             '    | {"error": "e"}   | ?         |\n')
        self.assertEqual(one(t), ['s.duramen:10: error T023', 's.duramen:13: error T023'])

    def test_ck006_obligations(self):
        t = ('duramen 0.1\nspec s 1\n  text\n    The program MUST work.\nop f\n  result what it MUST return\n'
             'errors\n  e when it SHALL fail\nsection S "It MUST be titled"\n  text\n    REQUIRED reading.\nnote\n'
             '  text\n    This note says `MUST`, "SHALL" and \u201cREQUIRED\u201d, MUSTARD and must.\n'
             'decision D-1 "d"\n  source s\n  text\n    Fine.\n  rejected "Another MUST."\nopen O "o"\n  text\n'
             '    It MUST NOT be.\n')
        self.assertEqual(one(t), ['s.duramen:2: error T004', 's.duramen:5: error T004', 's.duramen:8: error T004',
                                  's.duramen:9: error T004', 's.duramen:15: error T004', 's.duramen:15: warning T012',
                                  's.duramen:20: warning T014'])
        self.assertEqual(one(HEAD + 'decision D-1 "d"\n  source s\n  text\n    It MUST.\n  rejected "It SHALL."\n'
                             '  rejected "It is REQUIRED."\n'),
                         ['s.duramen:3: error T004'] * 3 + ['s.duramen:3: warning T012'])
        self.assertEqual(one(HEAD + 'errors\n  e when the "MUST\n    hold" rule fails\n'
                             '  f when the "MUST hold" rule fails\nnote\n  text\n    A MUST-have.\nsection S "s"\n'
                             '  text\n    MUST\u00e9\n'),
                         ['s.duramen:4: error T004', 's.duramen:7: error T004', 's.duramen:10: error T004'])
        self.assertEqual(one(HEAD + 'section T "t"\n  text\n    It ``MUST`` be, and it `MUST` not.\n'),
                         ['s.duramen:3: error T004'])
        self.assertEqual(one(HEAD + 'note\n  text\n    x`a`MUST\nnote\n  text\n    MU`a`ST, and "MU"ST\nnote\n'
                             '  text\n    A"q"SHALL\ndecision D-1 "d"\n  source s\n  text\n    Fine.\n'
                             '  rejected "\\"It\\nMUST\\" be"\n'),
                         ['s.duramen:3: error T004', 's.duramen:9: error T004', 's.duramen:12: error T004',
                          's.duramen:12: warning T012'])
        self.assertEqual(one(HEAD + 'decision D-1 "d"\n  source s\n  text\n    Fine.\n  rejected "\\"It\\rMUST\\" be"\n'),
                         ['s.duramen:3: error T004', 's.duramen:3: warning T012'])

    def test_ck007_open_items(self):
        self.assertEqual(one(HEAD + 'open O "o"\n  example f {}\n  table f\n    | x |\n    | 1 |\n'
                             '  example f {not json\n    expect nothing at all\n  table g h\n    | {bad |\n'),
                         ['s.duramen:4: error T003', 's.duramen:5: error T003', 's.duramen:8: error T003',
                          's.duramen:10: error T003'])

    def test_ck008_order_stated_once(self):
        t = (ECHO + 'op f\n  input x? json\nerrors\n  too_big when x > 9\n  too_small when x < 0\n'
             'req A "a"\n  text\n    A request that is too_big gets too_big, and one too_small gets too_small.\n'
             '  example f {}\nreq B "b"\n  text\n    too_big is checked Before too_small.\n  example f {}\n'
             'req C "c"\n  text\n    too_big is checked first.\n    After that, nothing.\n  example f {}\n'
             'req D "d"\n  text\n    too_big and too_small are checked in this\n    order.\n  example f {}\n')
        self.assertEqual(one(t), ['s.duramen:14: error T005', 's.duramen:23: error T005'])
        t = (ECHO + 'op f\n  input x? json\nerrors\n  e when x\n  f when y\nreq A "a"\n  text\n'
             '    A request may be refused before it is read: see the errors list.\n  example f {}\n')
        self.assertEqual(one(t), [])
        t = (ECHO + 'op f\n  input x? json\nerrors\n  too_big when x > 9\n  too_small when x < 0\nreq A "a"\n  text\n'
             '    too_big\u00e9, then too_small: decided before-hand.\n  example f {}\nreq B "b"\n  text\n'
             '    xtoo_big and too_small2 come after.\n  example f {}\n')
        self.assertEqual(one(t), ['s.duramen:10: error T005'])

    def test_ck009_decisions(self):
        t = (ECHO + 'op f\n  input x? json\ndecision D-1 "uncited, no source"\ndecision D-2 "bad status"\n  source s\n'
             '  status Accepted\ndecision D-3 "superseded by nothing"\n  source s\n  status superseded\n'
             'decision D-4 "x"\n  source s\n  status superseded by D-9\ndecision D-5 "y"\n  source s\n'
             '  status superseded by D-6\ndecision D-6 "z"\n  source s\n  status accepted on 2026-01-01\n'
             'decision D-7 "observed"\n  source s\n  status observed\nreq A "a"\n'
             '  decision D-2, D-3, D-4, D-5, D-6, D-7\n  example f {}\n')
        self.assertEqual(one(t), ['s.duramen:6: warning T012', 's.duramen:6: warning T013', 's.duramen:7: error T027',
                                  's.duramen:10: error T027', 's.duramen:13: error T027',
                                  's.duramen:25: error T028', 's.duramen:25: error T028', 's.duramen:25: error T028',
                                  's.duramen:25: warning T028'])
        t = (ECHO + 'op f\n  input x? json\ndecision D-1 "a"\n  source s\n  status accepted, 2026-01-01\n'
             'decision D-2 "b"\n  source\n  status\nreq A "a"\n  decision D-1, D-2\n  example f {}\n')
        self.assertEqual(one(t), ['s.duramen:6: error T027', 's.duramen:9: warning T013', 's.duramen:9: error T027'])
        self.assertEqual(one(HEAD + 'req A "a"\n  decision D, E\n  text\n    T.\ndecision D "d"\n  source x\n'
                             '  status superseded  by E\ndecision E "e"\n  source x\n  status Accepted\n'),
                         ['s.duramen:3: error T001', 's.duramen:3: error T028', 's.duramen:7: error T027',
                          's.duramen:10: error T027'])
        t = (ECHO + 'op f\n  input x? json\nreq A "a"\n  decision D\n  example f {}\ndecision D "d"\n  source x\n'
             '  status rejected\ndecision D "d again"\n  source x\ndecision E "e"\n  source x\n'
             'decision E "e again"\n  source x\n')
        self.assertEqual(one(t), ['s.duramen:6: error T028', 's.duramen:12: error T007', 's.duramen:14: warning T012',
                                  's.duramen:16: error T007', 's.duramen:16: warning T012'])


class Oracle(unittest.TestCase):
    def test_or001_oracle_needed(self):
        self.assertEqual(one(HEAD + 'op f\n  input x? json\nreq A "a"\n  example f {}\n    expect result = 1\n'),
                         ['s.duramen:2: error T019'])
        self.assertEqual(one(HEAD + 'op f\n  input x? json\nreq A "a"\n  text\n    No example.\nreq B "b"\n'
                             '  example f {}\n'), ['s.duramen:2: error T019', 's.duramen:5: error T001'])

    def test_or002_how_run(self):
        t = ('duramen 0.1\nspec s 1\n  request {"clock": 1}\noracle node echo.mjs\nop f\n  input line? boolean, x? json\n'
             'req A "a"\n  example f {"line": true,  "x": 2.50}\n'
             '    expect result = "{\\"id\\":\\"A#1\\",\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true,  \\"x\\": 2.50}}"\n'
             '  example f {"line": true}\n    omit id\n'
             '    expect result = "{\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true}}"\n'
             '  example raw \'{"id": "x",  "op": "f", "input": {"line": true}}\'\n    expect id = "x"\n'
             '    expect result = "{\\"id\\": \\"x\\",  \\"op\\": \\"f\\", \\"input\\": {\\"line\\": true}}"\n')
        self.assertEqual(one(t), [])
        r = diags({'sub/s.duramen': 'duramen 0.1\nspec s 1\noracle node "my echo.mjs"\nop f\n  input x? json\n'
                                    'req A "a"\n  example f {"x": 1}\n    expect result.x = 1\n'})
        self.assertEqual(r, [])
        self.assertEqual(one(ECHO + 'op f\n  input x? json\nreq A "a"\n  text\n    No example.\nreq B "b"\n'
                             '  example f {"x": 1}\n    expect result.x = 2\n'),
                         ['s.duramen:6: error T001', 's.duramen:11: error T002'])
        t = (ECHO + 'op f\n  input say? string\nreq A "a"\n'
             '  example raw \'{"id": "r1", "op": "f", "input": {"say": " \\u00a0\\n{\\"id\\": \\"elsewhere\\", \\"result\\": 1}\\n\\t"}}\'\n'
             '    expect result = 1\n'
             '  example raw \'{"id": "r2", "op": "f", "input": {"say": "{\\"id\\": \\"r2\\", \\"result\\": 1}\\r\\n"}}\'\n'
             '    expect result = 1\n'
             '  example raw \'{"id": "r3", "op": "f", "input": {"say": "{\\"result\\": 1}\\r{\\"result\\": 2}"}}\'\n'
             '    expect result = ?\n'
             '  example raw \'{"id": "r4", "op": "f", "input": {"say": "{\\"result\\": 1}\\n[2]"}}\'\n'
             '    expect result = ?\n')
        self.assertEqual(one(t), ['s.duramen:11: error T021', 's.duramen:13: error T021'])
        t = (ECHO + 'op f\n  input x? json\nreq A "a"\n'
             '  example raw "{\\"id\\":\\"r\\",\\"op\\":\\"f\\",\\"input\\":{\\"x\\":\\"\\ud800\\"}}"\n'
             '    expect result = ?\n')
        r = cases({'s.duramen': t})
        self.assertEqual(r['cases'][0]['checks'][0]['value'], {'x': '\ufffd'})

    def test_or003_disagreement(self):
        t = (ECHO + 'op f\n  input x? json, y? json, answer? json\nreq A "a"\n'
             '  example f {"x": 1.0, "y": [5, {"z": null}]}\n    expect result = {"y": [5, {"z": null}], "x": 1}\n'
             '    expect result.y.1.z = null\n    expect result.y.0 \u2248 5.5 \u00b1 0.5\n    expect result.x = 2\n'
             '    expect result.y.2 = 5\n    expect result.y.0 \u2248 5.5 \u00b1 0.4\n    expect result.y.1 = {}\n'
             '  example f {"answer": {"result": 0, "audit": "{\\"a\\": [1, 2]}"}}\n    expect audit.a.1 = 2\n'
             '    expect audit = "{\\"a\\": [1, 2]}"\n    expect audit.b = 1\n  table f\n'
             '    | x | result.x | result.y |\n    | 1 | 2        | 3        |\n'
             '  example f {"x": {"": 1}}\n    expect result.x. = 1\n    expect result..x = 1\n'
             '  example f {"y": [7, 8]}\n    expect result.y.1 = 8\n    expect result.y.length = 2\n'
             '    expect result.y.01 = 8\n')
        self.assertEqual(one(t), ['s.duramen:11: error T002', 's.duramen:12: error T002', 's.duramen:13: error T002',
                                  's.duramen:14: error T002', 's.duramen:18: error T002', 's.duramen:21: error T002',
                                  's.duramen:21: error T002', 's.duramen:24: error T002', 's.duramen:27: error T002',
                                  's.duramen:28: error T002'])
        t = (ECHO + 'op f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n'
             '  example f {"answer": {"result": 1}}\n    expect error = "e"\n'
             '  example g {"answer": {"error": "e"}}\n    expect error = "e"\n')
        self.assertEqual(one(t), ['s.duramen:10: error T002'])
        t = (ECHO + 'op f\n  input answer? json, x? json\nreq A "a"\n'
             '  example f {"answer": {"result": 1, "audit": "{\\"a\\": 1e400, \\"b\\": 1}"}}\n'
             '    expect audit.b = 1\n    expect audit.a = ?\n  example f {"x": 2}\n'
             '    expect result.x \u2248 1.9 \u00b1 0.1\n    expect result.x \u2248 1.9 \u00b1 0.10000000000000009\n'
             '  example f {"x": 1}\n    expect result.x \u2248 -8.673617379884035e-19 \u00b1 1\n')
        self.assertEqual(one(t), ['s.duramen:8: error T002', 's.duramen:9: error T025', 's.duramen:11: error T002'])

    def test_or004_failing_oracle(self):
        self.assertEqual(one(HEAD + 'oracle no-such-program-for-duramen\nop f\n  input x? json\nreq A "a"\n'
                             '  example f {}\n'), ['s.duramen:3: error T020', 's.duramen:7: error T021'])
        self.assertEqual(one(ECHO + 'op f\n  input x? json, exit? integer\nreq A "a"\n  example f {"x": 1}\n'
                             '    expect result.x = 2\n  example f {"exit": 3}\n    expect result.exit = 3\n'),
                         ['s.duramen:3: error T020', 's.duramen:8: error T002'])
        self.assertEqual(one(ECHO + 'op f\n  input exit? integer\nreq A "a"\n  example f {}\n'
                             '  example raw \'{"id": "r", "op": "f", "input": {"exit": 4}}\'\n'),
                         ['s.duramen:8: error T020'])
        self.assertEqual(one(HEAD + 'oracle no-such-program-for-duramen\nop f\n  input x? json\nreq A "a"\n'
                             '  example raw \'{"id": "r", "op": "f"}\'\n'),
                         ['s.duramen:7: error T020', 's.duramen:7: error T021'])
        self.assertEqual(one(HEAD + 'oracle node "echo.mjs\nop f\n  input x? json\nreq A "a"\n  example f {}\n'),
                         ['s.duramen:3: error T020', 's.duramen:7: error T021'])

    def test_or005_no_answer(self):
        t = (ECHO + 'op f\n  input silent? boolean\nreq A "a"\n  example f {"silent": true}\n  example f {}\n'
             '  example raw \'{"id": "r", "op": "f", "input": {"silent": true}}\'\n')
        self.assertEqual(one(t), ['s.duramen:7: error T021', 's.duramen:9: error T021'])
        t = (ECHO + 'op f\n  input say string\nreq A "a"\n'
             '  example f {"say": "{\\"id\\":\\"A#1\\",\\"result\\":1e400}"}\n    expect result = ?\n'
             '  example f {"say": "{\\"id\\":\\"A#2\\",\\"result\\":1e300}"}\n    expect result = ?\n')
        self.assertEqual(one(t), ['s.duramen:7: error T021'])

    def test_or006_oracle_error(self):
        t = (ECHO + 'op f\n  input answer? json\nreq A "a"\n  example f {"answer": {"oracle_error": "left open"}}\n'
             '    expect result = 1\n    expect result = ?\n')
        self.assertEqual(one(t), ['s.duramen:7: error T022'])
        t = (ECHO + 'op f\n  input answer? json\nreq A "a"\n'
             '  example f {"answer": {"oracle_error": null, "error": "x"}}\n')
        self.assertEqual(one(t), ['s.duramen:7: error T022'])

    def test_or007_unexpected_errors(self):
        t = (ECHO + 'op f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n'
             '  example f {"answer": {"error": "e"}}\n  example f {"answer": {"error": "e"}}\n    expect error = "e"\n')
        self.assertEqual(check({'s.duramen': t}), {'diagnostics': ['s.duramen:9: warning T024'],
                                                  'errors': 0, 'warnings': 1})
        t = ECHO + 'op f\n  input answer? json\nreq A "a"\n  example f {"answer": {"error": null}}\n'
        self.assertEqual(one(t), ['s.duramen:7: warning T024'])
        t = (ECHO + 'op f\n  input answer? json\nreq A "a"\n  example f {"answer": {"error": "e"}}\n'
             '    expect result = 1\n  example f {"answer": {"error": "e"}}\n    expect id = "A#2"\n')
        self.assertEqual(one(t), ['s.duramen:8: error T002'])

    def test_or008_values_from_oracle(self):
        t = (ECHO + 'op f\n  input x? json\nreq A "a"\n  example f {"x": 1}\n    expect result.x = ?\n'
             '    expect result.y = ?\n')
        self.assertEqual(one(t), ['s.duramen:9: error T025'])


class Suite(unittest.TestCase):
    def test_su001_no_suite_with_errors(self):
        self.assertEqual(cases({'s.duramen': 'frobnicate\n'}), {'cases': [], 'errors': 3})
        self.assertEqual(cases({'s.duramen': HEAD + 'req A "a"\n  text\n    Nothing to show.\n'}),
                         {'cases': [], 'errors': 1})
        r = cases({'s.duramen': ECHO + 'op f\n  input x? json\nreq A "a"\n  example f {"y": 1}\n'})
        self.assertEqual(r['errors'], 0)
        self.assertEqual(r['cases'][0]['id'], 'A#1')

    def test_su002_one_case_per_example(self):
        t = (ECHO + 'op f\n  input x? json\nreq A "a"\n  example f {"x": 1}\n    expect result.x = 1\n'
             'req B "b"\n  on posix\n  table f\n    | x | result.x |\n    | 2 | 2        |\n    | 3 | ?        |\n')
        r = cases({'s.duramen': t})
        self.assertEqual(r, {'errors': 0, 'cases': [
            {'checks': [{'kind': 'eq', 'path': 'result.x', 'value': 1}],
             'full': {'members': ['id', 'result'], 'result': {'x': 1}, 'tolerances': {}},
             'id': 'A#1', 'kind': 'example', 'line': '{"id":"A#1","op":"f","input":{"x": 1}}',
             'platform': 'any', 'reqs': ['REQ-A']},
            {'checks': [{'kind': 'eq', 'path': 'result.x', 'value': 2}],
             'full': {'members': ['id', 'result'], 'result': {'x': 2}, 'tolerances': {}},
             'id': 'B#1', 'kind': 'example', 'line': '{"id":"B#1","op":"f","input":{"x":2}}',
             'platform': 'posix', 'reqs': ['REQ-B']},
            {'checks': [{'from': 'oracle', 'kind': 'eq', 'path': 'result.x', 'value': 3}],
             'full': {'members': ['id', 'result'], 'result': {'x': 3}, 'tolerances': {}},
             'id': 'B#2', 'kind': 'example', 'line': '{"id":"B#2","op":"f","input":{"x":3}}',
             'platform': 'posix', 'reqs': ['REQ-B']}]})
        r = cases({'b.duramen': 'duramen 0.1\nreq B "b"\n  on windows\n  example f {}\n',
                   'a.duramen': ECHO + 'op f\n  input x? json\nreq A "a"\n  example f {}\n  example f {}\n'})
        self.assertEqual([c['id'] for c in r['cases']], ['A#1', 'A#2', 'B#1'])
        self.assertEqual(r['cases'][2]['platform'], 'windows')

    def test_su003_request_lines(self):
        t = (HEAD.replace('spec s 1\n', 'spec s 1\n  request {"clock": "c", "trace": true}\n') +
             'oracle node echo.mjs\nop f\n  input x? json\nop g\n  input x? json\n  request {"mode": 2}\n'
             'req A "a"\n  example f {"x" : 2.50e0 }\n  example f\n  example f {"x": 1}\n'
             '    request {"trace": false, "user": "u"}\n    omit clock\n  example g {"x": 1}\n    omit id, input\n'
             '  example f {"x": 1}\n    omit op, id\n  example raw \'{"id": "A#6",  "op": "f"}\'\n'
             '  example f {"x": 1}\n    request {"b": {"z": 1, "10": 2, "9": 3}, "2": "two", "a": 1}\n'
             '    omit clock\n    omit trace\n  table f\n    | result |\n    | ?      |\n')
        r = cases({'s.duramen': t})
        c = r['cases']
        self.assertEqual(c[0], {'checks': [], 'full': {'members': ['id', 'result'], 'result': {'x': 2.5},
                                                        'tolerances': {}},
                                'id': 'A#1', 'kind': 'example',
                                'line': '{"id":"A#1","op":"f","clock":"c","trace":true,"input":{"x" : 2.50e0 }}',
                                'platform': 'any', 'reqs': ['REQ-A']})
        self.assertEqual(c[1]['line'], '{"id":"A#2","op":"f","clock":"c","trace":true}')
        self.assertEqual(c[2]['line'], '{"id":"A#3","op":"f","trace":false,"user":"u","input":{"x": 1}}')
        self.assertEqual(c[3], {'checks': [], 'full': {'members': ['id', 'result'], 'result': {}, 'tolerances': {}},
                                'id': 'A#4', 'kind': 'example', 'line': '{"op":"g","mode":2}', 'platform': 'any',
                                'reqs': ['REQ-A'], 'solo': True})
        self.assertEqual(c[4]['line'], '{"clock":"c","trace":true,"input":{"x": 1}}')
        self.assertTrue(c[4]['solo'])
        self.assertEqual(c[5]['line'], '{"id": "A#6",  "op": "f"}')
        self.assertTrue(c[5]['solo'])
        self.assertEqual(c[6]['line'],
                         '{"id":"A#7","op":"f","2":"two","b":{"9":3,"10":2,"z":1},"a":1,"input":{"x": 1}}')
        self.assertEqual(c[7]['line'], '{"id":"A#8","op":"f","clock":"c","trace":true,"input":{}}')
        t = (ECHO + 'op f\n  input files? object, n? number\nreq A "a"\n  example f {"n" : 1.50, "files": {"z": "old"}}\n'
             '    input files."a.duramen"\n      duramen 0.1\n      "quoted" \u00e9\n    input files.z\n      new\n'
             '  table f\n    | n      | files |\n    | 1.50   |       |\n    |        | {}    |\n')
        r = cases({'s.duramen': t})
        self.assertEqual(r['cases'][0]['line'],
                         '{"id":"A#1","op":"f","input":{"n":1.5,"files":{"z":"new\\n","a.duramen":'
                         '"duramen 0.1\\n\\"quoted\\" \u00e9\\n"}}}')
        self.assertEqual(r['cases'][1]['line'], '{"id":"A#2","op":"f","input":{"n":1.50}}')
        self.assertEqual(r['cases'][2]['line'], '{"id":"A#3","op":"f","input":{"files":{}}}')
        r = cases({'s.duramen': ECHO + 'op f\n  input t? string\nreq A "a"\n  example f\n    input t\n      x\n'})
        self.assertEqual(r['cases'][0]['line'], '{"id":"A#1","op":"f","input":{"t":"x\\n"}}')

    def test_su004_checks(self):
        t = (ECHO + 'op f\n  input x? json\nreq A "a"\n  example f {"x": {"y": [1, 2]}}\n'
             '    expect result.x.y.0 = 1\n    expect result.x.y.1 ~ 2.1 +- 0.25\n    expect result.x = ?\n'
             '    expect id = "A#1"\n  table f\n    | x | result.x \u00b1 0.5 |\n    | 2 | 2.25           |\n')
        r = cases({'s.duramen': t})
        self.assertEqual(r['cases'][0]['checks'], [
            {'kind': 'eq', 'path': 'result.x.y.0', 'value': 1},
            {'kind': 'approx', 'path': 'result.x.y.1', 'tol': 0.25, 'value': 2.1},
            {'from': 'oracle', 'kind': 'eq', 'path': 'result.x', 'value': {'y': [1, 2]}},
            {'kind': 'eq', 'path': 'id', 'value': 'A#1'}])
        self.assertEqual(r['cases'][1]['checks'], [{'kind': 'approx', 'path': 'result.x', 'tol': 0.5, 'value': 2.25}])

    def test_su005_full(self):
        t = (ECHO + 'op f\n  input answer? json\n  audit\n  tolerance result.t 0.5\n  tolerance result.u 0\n'
             'op g\n  input answer? json\nerrors\n  e when never\nreq A "a"\n'
             '  example f {"answer": {"result": {"t": 1}, "audit": "A"}}\n'
             '  example f {"answer": {"error": "e", "extra": 1}}\n    expect error = "e"\n'
             '  example g {"answer": {"result": 2, "audit": "B"}}\n'
             '  example h {"answer": {"error": "e"}}\n    expect error = "e"\n')
        c = cases({'s.duramen': t})['cases']
        tol = {'result.t': 0.5, 'result.u': 0}
        self.assertEqual(c[0]['full'], {'audit': 'A', 'members': ['audit', 'id', 'result'], 'result': {'t': 1},
                                        'tolerances': tol})
        self.assertEqual(c[1]['full'], {'error': 'e', 'members': ['error', 'extra', 'id'], 'tolerances': tol})
        self.assertEqual(c[2]['full'], {'members': ['audit', 'id', 'result'], 'result': 2, 'tolerances': {}})
        self.assertEqual(c[3]['full'], {'error': 'e', 'members': ['error', 'id'], 'tolerances': {}})
        t = (ECHO + 'op f\n  input answer? json\n  audit\nreq A "a"\n  example f {"answer": {"result": 1, "audit": 5}}\n'
             '  example f {"answer": {"result": 1, "audit": null}}\n')
        c = cases({'s.duramen': t})['cases']
        for x in c:
            self.assertEqual(x['full'], {'members': ['audit', 'id', 'result'], 'result': 1, 'tolerances': {}})
        t = (ECHO + 'op f\n  input x? json\n  tolerance __proto__ 1\n  tolerance result.constructor 2\nreq A "a"\n'
             '  example f {"x": 1}\n')
        c = cases({'s.duramen': t})['cases']
        self.assertEqual(c[0]['full']['tolerances'], {'__proto__': 1, 'result.constructor': 2})
        t = (ECHO + 'op f\n  input answer? json\n  audit\n  tolerance result.t 0.5\nreq A "a"\n'
             '  example raw \'{"id":"r","op":"f","input":{"answer":{"result":{"t":1},"audit":"A"}}}\'\n')
        c = cases({'s.duramen': t})['cases']
        self.assertEqual(c[0]['full'], {'members': ['audit', 'id', 'result'], 'result': {'t': 1}, 'tolerances': {}})


def judge(case, answer):
    return call('judge', {'case': case, 'answer': answer})


class Judge(unittest.TestCase):
    def test_ju001_verdicts(self):
        full = {'members': ['id', 'result'], 'result': {'x': 1}, 'tolerances': {}}
        chk = [{'path': 'result.x', 'kind': 'eq', 'value': 1}]
        self.assertEqual(judge({'checks': chk, 'full': full}, {'id': 'A#1', 'result': {'x': 1}})['result'],
                         {'pass': True})
        self.assertEqual(judge({'checks': chk, 'full': full}, None)['result'],
                         {'pass': False, 'failed': ['answer']})
        c3 = chk + [{'path': 'result.y', 'kind': 'eq', 'value': 2}, {'path': 'id', 'kind': 'eq', 'value': 'A#1'}]
        full3 = {'members': ['id', 'result'], 'result': {'x': 1, 'y': 2}, 'tolerances': {}}
        self.assertEqual(judge({'checks': c3, 'full': full3}, {'id': 'A#1', 'result': {'x': 5}, 'note': 1})['result'],
                         {'pass': False, 'failed': ['checks.0', 'checks.1', 'members', 'result']})
        self.assertEqual(judge({'id': 'A#1', 'kind': 'example', 'line': '{}', 'checks': [], 'full': None, 'more': 1},
                               {'id': 'anything', 'x': 1})['result'], {'pass': True})
        self.assertEqual(call('judge', {'case': {'checks': [], 'full': None}}), {'id': '1', 'error': 'bad_request'})
        self.assertEqual(driver.respond(b'{"id": "1", "op": "judge"}'), {'id': '1', 'error': 'bad_request'})
        bad = [
            ([], None), ({'checks': {}, 'full': None}, None),
            ({'checks': [{'path': 'result', 'kind': 'eq'}], 'full': None}, None),
            ({'checks': [{'path': 1, 'kind': 'eq', 'value': 1}], 'full': None}, None),
            ({'checks': [{'path': 'result', 'kind': 'approx', 'value': '1', 'tol': 0}], 'full': None}, None),
            ({'checks': [{'path': 'result', 'kind': 'approx', 'value': 1, 'tol': -1}], 'full': None}, None),
            ({'checks': [{'path': 'result', 'kind': 'approx', 'value': 1}], 'full': None}, None),
            ({'checks': [1], 'full': None}, None), ({'checks': []}, None), ({'full': None}, None),
            ({'checks': [], 'full': []}, None),
            ({'checks': [], 'full': {'members': 'id', 'tolerances': {}}}, None),
            ({'checks': [], 'full': {'members': [1], 'tolerances': {}}}, None),
            ({'checks': [], 'full': {'members': ['id']}}, None),
            ({'checks': [], 'full': {'members': ['id'], 'tolerances': {'result': '1'}}}, None),
            ({'checks': [], 'full': {'members': ['id'], 'tolerances': {'result': -1}}}, None),
            ({'checks': [], 'full': {'members': ['id', 'audit'], 'tolerances': {}, 'audit': 1}}, None),
            ({'checks': [], 'full': None}, []), ({'checks': [], 'full': None}, 'x')]
        for case, ans in bad:
            self.assertEqual(judge(case, ans), {'id': '1', 'error': 'bad_request'}, (case, ans))

    def test_ju002_paths(self):
        checks = [{'path': 'result.a.0', 'kind': 'eq', 'value': 5}, {'path': 'result.a.01', 'kind': 'eq', 'value': 6},
                  {'path': 'result.a.length', 'kind': 'eq', 'value': 2}, {'path': 'result.b.', 'kind': 'eq', 'value': 3},
                  {'path': 'result.c.0', 'kind': 'eq', 'value': 7}, {'path': 'result.d.length', 'kind': 'eq', 'value': 3},
                  {'path': 'audit.k.1', 'kind': 'eq', 'value': 2},
                  {'path': 'audit', 'kind': 'eq', 'value': '{"k": [1, 2]}'},
                  {'path': 'result.a.-1', 'kind': 'eq', 'value': 6}]
        ans = {'id': 'A#1', 'result': {'a': [5, 6], 'b': {'': 3}, 'c': {'0': 7}, 'd': 'abc'}, 'audit': '{"k": [1, 2]}'}
        self.assertEqual(judge({'checks': checks, 'full': None}, ans)['result'],
                         {'failed': ['checks.1', 'checks.2', 'checks.5', 'checks.8'], 'pass': False})
        checks = [{'path': 'audit.k', 'kind': 'eq', 'value': 1},
                  {'path': 'audit', 'kind': 'eq', 'value': '{"k": 1, "big": 1e400}'}]
        self.assertEqual(judge({'checks': checks, 'full': None}, {'id': 'A#1', 'audit': '{"k": 1, "big": 1e400}'})['result'],
                         {'failed': ['checks.0'], 'pass': False})
        checks = [{'path': 'audit.k', 'kind': 'eq', 'value': 1}, {'path': 'result', 'kind': 'eq', 'value': None}]
        self.assertEqual(judge({'checks': checks, 'full': None}, {'id': 'A#1', 'audit': 'k=1'})['result'],
                         {'failed': ['checks.0', 'checks.1'], 'pass': False})

    def test_ju003_checks(self):
        checks = [
            {'path': 'result.o', 'kind': 'eq', 'value': {'a': 1, 'b': [1, 2]}},
            {'path': 'result.z', 'kind': 'eq', 'value': 0}, {'path': 'result.t', 'kind': 'eq', 'value': 1},
            {'path': 'result.n', 'kind': 'eq', 'value': True}, {'path': 'result.s', 'kind': 'eq', 'value': 1},
            {'path': 'result.missing', 'kind': 'eq', 'value': None}, {'path': 'result.e', 'kind': 'eq', 'value': []},
            {'path': 'result.l', 'kind': 'eq', 'value': {}}, {'path': 'result.p', 'kind': 'eq', 'value': [1, 2]},
            {'path': 'result.w', 'kind': 'eq', 'value': {'a': 1}},
            {'path': 'result.h', 'kind': 'approx', 'value': 2, 'tol': 0.5},
            {'path': 'result.i', 'kind': 'approx', 'value': 2, 'tol': 0.5},
            {'path': 'result.j', 'kind': 'approx', 'value': 2, 'tol': 0.5},
            {'path': 'result.k', 'kind': 'approx', 'value': 2, 'tol': 0.5},
            {'path': 'result.m', 'kind': 'approx', 'value': 1.9, 'tol': 0.1},
            {'path': 'result.u', 'kind': 'eq', 'value': None}]
        ans = {'id': 'A#1', 'result': {'o': {'b': [1, 2.0], 'a': 1.0}, 'z': -0.0, 't': True, 'n': 1, 's': '1',
                                       'e': {}, 'l': [], 'p': [2, 1], 'w': {'a': 1, 'b': 2}, 'h': 2.5,
                                       'i': 2.5000001, 'j': '2', 'k': 1.5, 'm': 2, 'u': None}}
        want = ['checks.%d' % i for i in (2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14)]
        self.assertEqual(judge({'checks': checks, 'full': None}, ans)['result'], {'failed': want, 'pass': False})

    def test_ju004_whole_answer(self):
        def j(full, ans):
            return judge({'checks': [], 'full': dict(full, tolerances=full.get('tolerances', {}))}, ans)['result']
        self.assertEqual(j({'members': ['id', 'result'], 'result': 1}, {'result': 1, 'id': 'A#1'}), {'pass': True})
        self.assertEqual(j({'members': ['error', 'id'], 'error': 'e'}, {'id': 'x', 'error': 'f', 'result': 1}),
                         {'pass': False, 'failed': ['members', 'error']})
        self.assertEqual(j({'members': ['error', 'id'], 'error': {'code': 1, 'at': [1]}},
                           {'id': 'x', 'error': {'at': [1.0], 'code': 1}}), {'pass': True})
        self.assertEqual(j({'members': ['error', 'id'], 'error': None}, {'id': 'x'}),
                         {'pass': False, 'failed': ['members', 'error']})
        self.assertEqual(j({'members': ['id', 'result'], 'result': 10, 'tolerances': {'result': 1}},
                           {'id': 'A#1', 'result': 10.5}), {'pass': True})
        full = {'members': ['audit', 'id', 'result'], 'result': 1, 'audit': 'A'}
        self.assertEqual(j(full, {'id': 'A#1', 'result': 1, 'audit': 'A '}), {'pass': False, 'failed': ['audit']})
        self.assertEqual(j(full, {'id': 'A#1', 'result': 1}), {'pass': False, 'failed': ['members', 'audit']})
        self.assertEqual(j({'members': ['id']}, {'id': 'x', 'result': 1}), {'pass': False, 'failed': ['members']})
        full = {'members': ['id', 'result'], 'result': {'t': 1, 'u': [1, 2]},
                'tolerances': {'result.t': 0.5, 'result.u.1': 0.1}}
        rows = [({'id': 'A#1', 'result': {'u': [1, 2.05], 't': 1.5}}, None),
                ({'id': 'A#1', 'result': {'u': [1.01, 2], 't': 1}}, ['result']),
                ({'id': 'A#1', 'result': {'u': [1, 2], 't': '1'}}, ['result']),
                ({'id': 'A#1', 'result': {'u': [1, 2], 't': 1, 'v': 0}}, ['result']),
                ({'id': 'A#1', 'result': {'u': [1, 2, 3], 't': 1}}, ['result']),
                ({'id': 'A#1'}, ['members', 'result']),
                ({'id': 'A#1', 'result': {'u': [1, 2], 't': 0.4}}, ['result'])]
        for ans, failed in rows:
            want = {'pass': True} if failed is None else {'pass': False, 'failed': failed}
            self.assertEqual(j(full, ans), want, ans)


class Helpers(unittest.TestCase):
    def test_js_number_format(self):
        cases_ = {1.0: '1', 2.5: '2.5', 1e21: '1e+21', 1e-7: '1e-7', 123456789012345680000.0: '123456789012345680000',
                  0.000001: '0.000001', -0.0: '0', 1.5e300: '1.5e+300', 0.1: '0.1', 100.0: '100'}
        for k, v in cases_.items():
            self.assertEqual(js_num(k), v)
        self.assertEqual(js_dumps({'b': 1, '2': 2, 'a': 3}), '{"2":2,"b":1,"a":3}')
        self.assertEqual(js_dumps('\u2028\ud800\x01'), '"\u2028\\ud800\\u0001"')


class RealNode(unittest.TestCase):
    """The spec's own fixture, when Node.js is installed."""

    @unittest.skipUnless(shutil.which('node'), 'node is not installed')
    def test_echo_mjs(self):
        with open(os.path.join(HERE, 'fixtures', 'echo.mjs'), encoding='utf-8') as f:
            mjs = f.read()
        rec = (ECHO + 'op f\n  input x? json, exit? integer\nreq A "a"\n  example f {"x": 1}\n'
               '    expect result.x = 1\n  example f {"exit": 3}\n'
               '  example raw \'{"id":"r","op":"f","input":{"x":"\\u2028"}}\'\n    expect result.x = ?\n')
        r = check({'s.duramen': rec, 'echo.mjs': mjs}, raw=True)
        self.assertEqual(r['diagnostics'], ['s.duramen:3: error T020'])
        rec = rec.replace('  example f {"exit": 3}\n', '')
        r = call('cases', {'files': {'s.duramen': rec, 'echo.mjs': mjs}})['result']
        self.assertEqual(r['errors'], 0)
        self.assertEqual(r['cases'][1]['checks'][0]['value'], '\u2028')


class Protocol(unittest.TestCase):
    def test_driver_process(self):
        reqs = [{'id': 'a', 'op': 'check', 'input': {'files': {'s.duramen': HEAD}}},
                'not json', '', '   ',
                {'id': 'b', 'op': 'judge', 'input': {'case': {'checks': [], 'full': None}, 'answer': {}}}]
        data = ''.join((r if isinstance(r, str) else json.dumps(r)) + '\n' for r in reqs)
        p = subprocess.run([sys.executable, os.path.join(HERE, 'driver.py')], input=data.encode(),
                           capture_output=True, cwd=HERE)
        self.assertEqual(p.returncode, 0)
        lines = p.stdout.decode('utf-8').split('\n')
        self.assertEqual(lines.pop(), '')
        got = [json.loads(x) for x in lines]
        self.assertEqual(got, [{'id': 'a', 'result': {'diagnostics': [], 'errors': 0, 'warnings': 0}},
                               {'id': None, 'error': 'bad_request'},
                               {'id': 'b', 'result': {'pass': True}}])
        self.assertNotIn(b'\r', p.stdout)


if __name__ == '__main__':
    unittest.main()
