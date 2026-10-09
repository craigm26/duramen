import json
import os
import shutil
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import duramen_core as core  # noqa: E402
import duramen_driver as drv  # noqa: E402

with open(os.path.join(HERE, 'fixtures', 'echo.mjs'), encoding='utf-8') as f:
    ECHO = f.read()
HAVE_NODE = shutil.which('node') is not None
H = 'duramen 0.1\nspec s 1\n'
OR = 'oracle node echo.mjs\n'


def run(op, files, entry=None, raw_input=None):
    inp = {'files': files} if raw_input is None else raw_input
    if entry is not None:
        inp['entry'] = entry
    line = json.dumps({'id': 'x', 'op': op, 'input': inp})
    return json.loads(drv.handle_line(line))['result']


def diags(files, entry=None):
    return run('check', files, entry)['diagnostics']


def S(text, **more):
    files = {'s.duramen': text}
    files.update(more)
    return files


def oracle_files(text, **more):
    return S(text, **{'echo.mjs': ECHO}, **more)


class Base(unittest.TestCase):
    def d(self, files, expect, entry=None):
        self.assertEqual(diags(files, entry), expect)

    def ds(self, text, expect):
        self.assertEqual(diags(S(text)), expect)


# ------------------------------------------------------------------ RQ

class TestRequests(Base):
    def resp(self, line):
        return json.loads(drv.handle_line(line))

    def test_rq001_entry_and_names(self):
        a = 'duramen 0.1\nspec a 1\n'
        self.d({'a.duramen': a, 'b.duramen': 'frobnicate\n'}, [], 'a.duramen')
        self.d({'a.duramen': a, 'b.duramen': 'frobnicate\n'},
               ['b.duramen:1: error P002', 'b.duramen:1: error P020'])

    def test_rq002_errors(self):
        good = {'a.duramen': 'duramen 0.1\nspec a 1\n'}
        self.assertEqual(self.resp('{not json'), {'id': None, 'error': 'bad_request'})
        self.assertEqual(self.resp('[1, 2]'), {'id': None, 'error': 'bad_request'})
        self.assertEqual(self.resp(json.dumps({'op': 'check', 'input': {'files': good}})),
                         {'id': None, 'error': 'bad_request'})
        self.assertEqual(self.resp('{"id": 7, "op": "check", "input": {}}'), {'id': None, 'error': 'bad_request'})
        self.assertEqual(self.resp('{"id": "a", "op": "lint", "input": {"files": {"a": "x"}}}'),
                         {'id': 'a', 'error': 'unknown_op'})
        self.assertEqual(self.resp('{"id": "a", "op": "lint"}'), {'id': 'a', 'error': 'unknown_op'})
        self.assertEqual(self.resp('{"id": "a", "op": "check"}'), {'id': 'a', 'error': 'bad_request'})

        def bad(inp, op='check'):
            r = self.resp(json.dumps({'id': 'a', 'op': op, 'input': inp}))
            self.assertEqual(r, {'id': 'a', 'error': 'bad_request'}, inp)
        bad({})
        bad({'files': {}})
        bad({'files': ['a.duramen']})
        bad({'files': {'a.duramen': 1}})
        for n in ('../a.duramen', '/a.duramen', 'x/./a.duramen', 'x//a.duramen', 'c:a.duramen', 'a\\b.duramen',
                  'a/', 'a\x00b'):
            bad({'files': {n: 'x'}})
        bad({'files': {'a': 'x', 'a/b.duramen': 'y'}}, 'cases')
        bad({'files': good, 'entry': '../a.duramen'})
        bad({'files': good, 'entry': 1})
        bad({'files': good, 'entry': ''})

    def test_rq002_blank_lines_and_order(self):
        self.assertIsNone(drv.handle_line(''))
        self.assertIsNone(drv.handle_line(' \t '))
        r = self.resp('{"id": "q", "op": "check", "input": {"files": {"a.duramen": "duramen 0.1\\nspec a 1\\n"}}}')
        self.assertEqual(r, {'id': 'q', 'result': {'diagnostics': [], 'errors': 0, 'warnings': 0}})

    def test_driver_process(self):
        req = json.dumps({'id': '1', 'op': 'check', 'input': {'files': {'a.duramen': 'duramen 0.1\nspec a 1\n'}}})
        p = subprocess.run([sys.executable, os.path.join(HERE, 'duramen_driver.py')],
                           input=(req + '\n\n{bad\n').encode(), capture_output=True, cwd=HERE)
        self.assertEqual(p.returncode, 0)
        lines = p.stdout.decode().split('\n')
        self.assertEqual(lines[2], '')
        self.assertEqual(json.loads(lines[1]), {'id': None, 'error': 'bad_request'})
        self.assertEqual(json.loads(lines[0])['result']['errors'], 0)
        self.assertNotIn(b'\r', p.stdout)


# ------------------------------------------------------------------ RC

class TestRecords(Base):
    def test_rc001_files_of_a_record(self):
        ok = 'duramen 0.1\nspec a 1\n'
        self.d({'a.duramen': ok, 'notes.md': 'frobnicate', 'build/x.duramen': 'frobnicate',
                'sub/build/x.duramen': 'frobnicate', 'node_modules/x.duramen': 'frobnicate',
                '.hidden.duramen': 'frobnicate', 'sub/.hidden/x.duramen': 'frobnicate',
                'sub/b.duramen': 'duramen 0.1\n'}, [])
        self.d({'notes.md': 'duramen 0.1\nspec n 1\n', 'a.duramen': 'frobnicate'}, [], 'notes.md')
        self.d({'sub/a.duramen': ok, 'sub/deeper/b.duramen': 'duramen 0.1\n', 'c.duramen': 'frobnicate'}, [], 'sub')
        self.d({'sub/a.duramen': ok, 'sub/b.duramen': 'frobnicate'}, [], 'sub/a.duramen')
        self.d({'build/a.duramen': ok, 'build/build/b.duramen': 'frobnicate'}, [], 'build')
        self.d({'a.duramen': ok}, ['missing.duramen:1: error P046'], 'missing.duramen')
        self.d({'a.duramen': ok}, ['sub:1: error P046'], 'sub')
        r = run('check', {'notes.md': ok})
        self.assertEqual(r, {'diagnostics': ['.:1: error P046'], 'errors': 1, 'warnings': 0})

    def test_rc002_order_of_files(self):
        self.d({'b.duramen': 'duramen 0.1\nspec b 1\n', 'a.duramen': 'duramen 0.1\nspec a 1\n'},
               ['b.duramen:2: error P044'])
        self.d({'a.duramen': 'duramen 0.1\nspec a 1\n', 'B.duramen': 'duramen 0.1\nspec b 1\n'},
               ['a.duramen:2: error P044'])
        self.d({'a/z.duramen': 'duramen 0.1\nspec z 1\n', 'a.duramen': 'duramen 0.1\nspec a 1\n'},
               ['a/z.duramen:2: error P044'])
        self.d({'｡.duramen': 'duramen 0.1\nspec x 1\n', '\U0001F600.duramen': 'duramen 0.1\nspec y 1\n'},
               ['｡.duramen:2: error P044'])

    def test_rc003_versions(self):
        self.ds('spec s 1\n', ['s.duramen:1: error P020'])
        self.ds('duramen 0.3\nspec s 1\n', ['s.duramen:1: error P023'])
        self.ds('duramen 0.1\nspec s 1\nduramen 0.1\nduramen 9\n', ['s.duramen:3: error P023', 's.duramen:4: error P023'])
        self.ds('duramen\nspec s 1\n', ['s.duramen:1: error P023'])
        self.d({'a.duramen': 'duramen 0.1\nspec s 1\n', 'b.duramen': 'duramen 0.2\n'}, ['.:1: error P047'])
        self.d({'r/a.duramen': 'duramen 0.2\nspec s 1\n', 'r/b.duramen': 'duramen 0.1\n'}, ['r:1: error P047'], 'r')
        self.d({'a.duramen': 'duramen 0.2\nspec s 1\n', 'b.duramen': 'duramen 0.2\n'}, [])
        self.d({'a.duramen': 'duramen 0.2\nspec s 1\n', 'b.duramen': 'duramen 2\n'}, ['b.duramen:1: error P023'])
        self.assertEqual(diags(S('')), ['.:1: error P021', 's.duramen:1: error P020'])

    def test_rc004_one_spec(self):
        self.ds('duramen 0.1\n', ['.:1: error P021'])
        self.d(S('duramen 0.1\n'), ['s.duramen:1: error P021'], 's.duramen')
        self.d({'r/s.duramen': 'duramen 0.1\n'}, ['r:1: error P021'], 'r')
        self.ds('duramen 0.1\nspec a 1\n\nspec b 1\n', ['s.duramen:4: error P044'])
        self.d({'a.duramen': 'duramen 0.1\nspec s 1\noracle node a.mjs\n',
                'b.duramen': 'duramen 0.1\noracle node b.mjs\n'}, ['b.duramen:2: error P044'])
        self.ds('duramen 0.1\nspec s 1\nerrors\n  e1 when x\nerrors\n  e2 when y\n', ['s.duramen:5: error P032'])
        self.d({'a.duramen': 'duramen 0.1\nspec s 1\nerrors\n  e1 when x\n',
                'b.duramen': 'duramen 0.1\n\nerrors\n  e2 when y\n'}, ['b.duramen:3: error P032'])
        self.ds('duramen 0.1\nspec s 1\nerrors\nerrors\n', ['s.duramen:4: error P032'])
        self.ds('duramen 0.1\nspec s 1\nduramen 0.1\n  title "t"\nspec s\noracle\n  source o.mjs\n    more\n'
                'errors x\n  e if\n',
                ['s.duramen:3: error P023', 's.duramen:4: error P015', 's.duramen:5: error P021',
                 's.duramen:5: error P044', 's.duramen:6: error P028', 's.duramen:8: error P006',
                 's.duramen:9: error P050', 's.duramen:10: error P019'])
        self.d({'a.duramen': 'duramen 0.1\nspec s 1\noracle\noracle node a.mjs\n',
                'b.duramen': 'duramen 0.1\noracle node b.mjs\n'},
               ['a.duramen:3: error P028', 'a.duramen:4: error P044', 'b.duramen:2: error P044'])

    def test_rc005_read_errors_stop(self):
        self.ds('duramen 0.1\nspec s 1\nfrobnicate\nreq A "a"\n  example nope {}\n', ['s.duramen:3: error P002'])

    def test_rc006_order_and_counts(self):
        r = run('check', {'b.duramen': 'frobnicate\nduramen 0.1\n',
                          'a.duramen': 'duramen 0.1\nspec s 1\n\n\nfrobnicate\nfrobnicate\n'})
        self.assertEqual(r, {'diagnostics': ['a.duramen:5: error P002', 'a.duramen:6: error P002',
                                             'b.duramen:1: error P002'], 'errors': 3, 'warnings': 0})
        r = run('check', S(H + '\ndecision D-1 "one"\n  text\n    No source, and cited by nothing.\n\n'
                           'req A "a"\n  decision D-2\n'))
        self.assertEqual(r['diagnostics'], ['s.duramen:4: warning T012', 's.duramen:4: warning T013',
                                            's.duramen:8: error T001', 's.duramen:8: error T008'])
        self.assertEqual((r['errors'], r['warnings']), (2, 2))
        r = run('check', S(H + '\ndecision D-1 "proposed"\n  source here\n  status proposed\n\n'
                           'decision D-2 "contested"\n  source there\n  status contested\n\n'
                           'req A "a"\n  decision D-1, D-2\n'))
        self.assertEqual(r['diagnostics'], ['s.duramen:12: error T001', 's.duramen:12: error T028',
                                            's.duramen:12: warning T028'])


# ------------------------------------------------------------------ SY

class TestSyntax(Base):
    def test_sy001_lines(self):
        self.ds('﻿duramen 0.1\r\nspec s 1\rnote  \n  text\t\n    Some text.  \r\n', [])
        self.ds('duramen 0.1\nspec s 1\n\tnote\n', ['s.duramen:3: error P001'])
        self.ds('duramen 0.1\nspec s 1\nnote\n  \ttext\n', ['s.duramen:4: error P001'])
        self.ds('duramen 0.1\nspec s 1\n note\n', ['s.duramen:3: error P001'])
        self.ds('  \t \nduramen 0.1\n\t\nspec s 1\n   \n', [])
        self.ds('duramen 0.1　\nspec s 1 \nnote\n  text\n', ['s.duramen:4: error P001'])

    def test_sy002_statements(self):
        self.ds('# A comment.\nduramen 0.1\n#A comment too.\nspec s 1\nfrobnicate this\n  title "ignored"\n'
                '    ignored too\nNote\n', ['s.duramen:5: error P002', 's.duramen:8: error P002'])
        self.ds('  indented\n # indented too\nduramen 0.1\nspec s 1\n', ['s.duramen:1: error P003', 's.duramen:2: error P003'])

    def test_sy003_clauses(self):
        self.ds(H + 'note\n  # A comment.\n  text\n    Text.\n    # Text, not a comment.\n', [])
        self.ds(H + 'note\n text\n', ['s.duramen:4: error P007'])
        self.ds(H + 'note\n    Text without a clause.\n  text\n    Text.\n', ['s.duramen:4: error P006'])
        self.ds(H + '  colour blue\n    more\nnote\n  example f {}\n    expect result = 1\n',
                ['s.duramen:3: error P015', 's.duramen:6: error P015'])
        self.ds(H + 'note\n # not a comment here\n    # nor here\n  text\n    Text.\n',
                ['s.duramen:4: error P007', 's.duramen:5: error P006'])
        self.ds(H + '  title "one"\n  title "two"\n    more\nnote\n  text\n    One.\n  text Two.\n'
                'decision D "d"\n  source a\n  source b\n  status accepted\n  status rejected\n',
                ['s.duramen:4: error P052', 's.duramen:9: error P052', 's.duramen:12: error P052',
                 's.duramen:14: error P052'])
        self.ds(H + '  title "A title"\n    that goes on\n  # A comment.\n    # Another.\n', ['s.duramen:4: error P006'])

    def test_sy004_spec_oracle(self):
        self.ds('duramen 0.1\n  title "x"\nspec s 1\n', ['s.duramen:2: error P015'])
        self.ds('duramen 0.1\nspec s\n', ['s.duramen:2: error P021'])
        self.ds('duramen 0.1\nspec s 1 2\n', ['s.duramen:2: error P021'])
        self.ds('duramen 0.1\nspec s 1.0.0-beta\n  title "The s program"\n  contract s-out-2\n'
                '  request {"clock": "2026-01-01T00:00:00Z", "n": 1}\n  text\n    What s is.\n', [])
        self.ds('duramen 0.1\nspec s 1\n  request {"clock":\n', ['s.duramen:3: error P009'])
        self.ds('duramen 0.1\nspec s 1\n  request ["clock"]\n', ['s.duramen:3: error P009'])
        self.ds('duramen 0.1\nspec s 1\n  request {"op": "x"}\n', ['s.duramen:3: error P051'])
        self.ds('duramen 0.1\nspec s 1\noracle\n', ['s.duramen:3: error P028'])
        self.ds('duramen 0.1\nspec s 1\noracle node model.mjs --quiet\n  source model.mjs, lib/a.mjs lib/b.mjs\n'
                '  timeout 5\n', ['s.duramen:5: error P015'])

    def test_sy005_text(self):
        self.ds(H + 'note\n  text Here.\n', ['s.duramen:4: error P008'])
        self.ds(H + 'note\n  text\n    One.\n   Two.\n', ['s.duramen:6: error P008'])
        self.ds(H + 'note\n  text\n    # It MUST be text.\n', ['s.duramen:3: error T004'])

    def test_sy006_titles(self):
        for i, (t, code) in enumerate([('section S A title', 'P005'), ('section S "A title" and more', 'P005'),
                                       ('section S', 'P005'), ('section S "A \\q title"', 'P004'),
                                       ('section S "A "quoted" title"', 'P004')]):
            self.ds(H + t + '\n', ['s.duramen:3: error ' + code])
        self.ds(H + 'section S "unclosed\nsection T "A" "B"\nsection U "\n',
                ['s.duramen:3: error P005', 's.duramen:4: error P004', 's.duramen:5: error P005'])
        self.ds(H + '  title A title\n', ['s.duramen:3: error P004'])
        self.ds(H + 'section S-1.x "A \\"quoted\\" title, é and all"\n', [])

    def test_sy007_ops(self):
        self.ds(H + 'op f g\n', ['s.duramen:3: error P031'])
        self.ds(H + 'op\n', ['s.duramen:3: error P031'])
        self.ds(H + 'op f\n  input a number, b? {x: number, y: string}, c "one, two" | [1, 2], d-e (f, g)\n'
                '  result the sum\n  tolerance result.sum 0.005\n  tolerance result.count 0\n  audit text\n  request {}\n', [])
        self.ds(H + 'op f\n  input a\n  input a.b number\n  input b?number\n  input\n  input c number, , d number,\n'
                "  input e 'x, y'\n  input c number\n  input é number\nop g\n  audit json\nop\n  input x\n"
                '  tolerance result.y\n',
                ['s.duramen:4: error P017', 's.duramen:5: error P017', 's.duramen:6: error P017',
                 's.duramen:7: error P017', 's.duramen:8: error P017', 's.duramen:8: error P017',
                 's.duramen:9: error P017', 's.duramen:10: error P052', 's.duramen:11: error P017',
                 's.duramen:13: error P050', 's.duramen:14: error P031', 's.duramen:15: error P017',
                 's.duramen:16: error P018'])
        self.ds(H + 'op f\n  tolerance result.x\n  tolerance result.x -1\n  tolerance result.x 0x10\n'
                '  tolerance result.x 1 2\n  tolerance result.x 1e-3\n',
                ['s.duramen:4: error P018', 's.duramen:5: error P018', 's.duramen:6: error P018',
                 's.duramen:7: error P018'])
        self.ds(H + 'op f\n  request 5\nop g\n  request {"input": 5}\nop h\n  tolerance result.x 1\n'
                '  tolerance result.y 1\n  tolerance result.x 2\n',
                ['s.duramen:4: error P009', 's.duramen:6: error P051', 's.duramen:10: error P052'])

    def test_sy008_errors(self):
        self.ds(H + 'errors\n  bad_input when the input is not an object, or\n    when it lacks a field\n'
                '  not_found when there is no such thing\n', [])
        self.ds(H + 'errors first\n  e when x\n', ['s.duramen:3: error P050'])
        self.ds(H + 'errors\n  e if x\n  e when\n    the input is bad\n  when x\n  f when y\n   and z\n  g is\n   wrong\n',
                ['s.duramen:4: error P019', 's.duramen:5: error P019', 's.duramen:7: error P019',
                 's.duramen:9: error P006', 's.duramen:10: error P019', 's.duramen:11: error P006'])
        self.ds(H + 'errors\n  e when x\n    # It MUST be read.\n', ['s.duramen:4: error T004'])

    def test_sy009_statements(self):
        self.ds(H + 'section S "Things"\n  text\n    About things.\nnote\n  text\n    A note.\nopen S-1 "Unsaid"\n'
                '  text\n    Left open.\ndecision D-1 "Why"\n  source the author\n  status accepted\n  text\n'
                '    Because.\n  rejected "Another way, because no."\n  rejected "A third way."\n',
                ['s.duramen:12: warning T012'])
        self.ds(H + 'req A "a"\n  on mac\n  status accepted\n  example f {}\nnote x\nsection S "s"\n  example f {}\n'
                'decision D "d"\n  title "x"\nopen O "o"\n  decision D\n',
                ['s.duramen:4: error P033', 's.duramen:5: error P015', 's.duramen:7: error P050',
                 's.duramen:9: error P015', 's.duramen:11: error P015', 's.duramen:13: error P015'])

    def test_sy010_examples(self):
        self.ds(H + 'req A "a"\n  example\n  example f [1]\n  example f {"x": 1\n  example f 2\n'
                '  example raw "{\\"id\\": \\"1\\",\\n\\"op\\": \\"f\\"}"\n',
                ['s.duramen:4: error P012', 's.duramen:5: error P012', 's.duramen:6: error P009',
                 's.duramen:7: error P012', 's.duramen:8: error P026'])
        self.ds(H + 'req A "a"\n  example raw\n  example raw {"id": "x"}\n  example raw "unclosed\n'
                '  example raw "a" "b"\n  example raw "carriage\\rreturn"\n  example f [1]\n    expect result\n'
                '     expect result = 1\n    expect result ≈ 1\n    expect result~1+-0.5\n    expect result="~"\n'
                '    expect result =\n    expect = 1\n    request {"a": 1}\n    request {"b": 1}\n    omit\n'
                '    omit a, b c\n    omit d\n',
                ['s.duramen:4: error P004', 's.duramen:5: error P004', 's.duramen:6: error P004',
                 's.duramen:7: error P004', 's.duramen:8: error P026', 's.duramen:9: error P012',
                 's.duramen:10: error P011', 's.duramen:11: error P006', 's.duramen:12: error P010',
                 's.duramen:15: error P009', 's.duramen:16: error P011', 's.duramen:18: error P052',
                 's.duramen:19: error P011'])
        self.ds(H + 'req A "a"\n  example raw \'{"id": "x"}\'\n    omit\n    request\n    input\n  example f {}\n'
                '    request\n    input\n    omit ,\n',
                ['s.duramen:5: error P022', 's.duramen:6: error P022', 's.duramen:7: error P022',
                 's.duramen:9: error P009', 's.duramen:10: error P049', 's.duramen:11: error P011'])
        self.ds(H + 'req A "a"\n  example f {}\n    expect result ≈ 1 ± -1\n    expect result ~ 1 +- x\n'
                '    expect result ≈ 0x10 ± 1\n    expect result = {nope}\n    expect result\n    result = 1\n'
                '     expect result = 1\n      expect result = 1\n    request [1]\n    request {"input": {}}\n'
                '  example raw \'{"id": "x"}\'\n    omit id\n    request {"a": 1}\n    input files."a"\n      text\n',
                ['s.duramen:5: error P010', 's.duramen:6: error P010', 's.duramen:7: error P010',
                 's.duramen:8: error P009', 's.duramen:9: error P011', 's.duramen:10: error P011',
                 's.duramen:11: error P006', 's.duramen:12: error P006', 's.duramen:13: error P009',
                 's.duramen:14: error P051', 's.duramen:16: error P022', 's.duramen:17: error P022',
                 's.duramen:18: error P022'])

    @unittest.skipUnless(HAVE_NODE, 'needs node')
    def test_sy011_input_texts(self):
        self.d(oracle_files(H + OR + 'op f\n  input files object, n? number\nreq A "a"\n  example f {"n": 1}\n'
                            '    input files."a b"\n      one\n        two\n\n    input files.x\n      three\n\n\n'
                            '    expect result = {"n": 1, "files": {"a b": "one\\n  two\\n", "x": "three\\n"}}\n'), [])
        self.ds(H + 'req A "a"\n  example f {"x": 1}\n    input files.\n    input files.."a"\n    input "a\n'
                '    input x.y\n      text\n    input z\n    input y from "missing.txt"\n',
                ['s.duramen:5: error P049', 's.duramen:6: error P049', 's.duramen:7: error P049',
                 's.duramen:8: error P049', 's.duramen:10: error P049', 's.duramen:11: error P048'])
        self.ds(H + 'req A "a"\n  example f {}\n    input a\n     not six\n      six, but after\n',
                ['s.duramen:5: error P049', 's.duramen:6: error P006', 's.duramen:7: error P006'])
        self.d({'r/s.duramen': H + 'req A "a"\n  example f {}\n    input a from "../outside.txt"\n'
                '    input b from "t.txt"\n      not its text\n    input c from "unclosed\n  example f {\n'
                '    input d from "../outside.txt"\n', 'outside.txt': 'x', 'r/t.txt': 't\n'},
               ['r/s.duramen:5: error P048', 'r/s.duramen:7: error P006', 'r/s.duramen:8: error P049',
                'r/s.duramen:9: error P009', 'r/s.duramen:10: error P048'], 'r')

    @unittest.skipUnless(HAVE_NODE, 'needs node')
    def test_sy011_from_file(self):
        self.d({'sub/s.duramen': H + OR + 'op f\n  input t? string\nreq A "a"\n  example f {}\n'
                '    input t from "data/t.txt"\n    expect result = {"t": "hello,\\r\\nworld"}\n',
                'sub/data/t.txt': 'hello,\r\nworld', 'sub/echo.mjs': ECHO}, [])

    def test_sy012_tables_read(self):
        self.ds(H + 'req A "a"\n  table f\n  table f g\n    | x |\n    | 1 |\n  table f\n    | x |\n'
                '  table f\n    | x | result ± -1 |\n    | 1 | 2           |\n  table f\n'
                '    | x | result ± 0.5 |\n    | 1 | "2"          |\n  table f\n    | x | y |\n    | 1 |\n'
                '    | {  | 2 |\n    x | 1\n  table f\n    | x | |\n    | 1 | 2 |\n  table f\n    | x ± 1 |\n'
                '    | 1     |\n',
                ['s.duramen:4: error P013', 's.duramen:5: error P013', 's.duramen:8: error P013',
                 's.duramen:11: error P010', 's.duramen:15: error P010', 's.duramen:18: error P014',
                 's.duramen:19: error P009', 's.duramen:20: error P006', 's.duramen:22: error P013',
                 's.duramen:25: error P010'])
        self.ds(H + 'req A "a"\n  table f g\n    | x |\n    | {bad |\n  table f\n   | x |\n    | 1 |\n'
                '  table f\n    | a.b | result |\n    | 1   | 2      |\n  table f\n    | x | result ± lots |\n'
                '    | 1 | "two"         |\n  table f\n    | x | result ± 1 2 | result.y+-0.5 |\n'
                '    | 1 | 2            | 3             |\n  table f\n    | x | x |\n    | 1 | 2 |\n  table f\n'
                '    | x | result ± 0.5 |\n    | 1 | 2.25 [       |\n    | { | ?            |\n',
                ['s.duramen:4: error P013', 's.duramen:7: error P013', 's.duramen:8: error P006',
                 's.duramen:11: error P013', 's.duramen:14: error P010', 's.duramen:17: error P010',
                 's.duramen:20: error P013', 's.duramen:24: error P010', 's.duramen:25: error P009'])

    @unittest.skipUnless(HAVE_NODE, 'needs node')
    def test_sy012_tables_ok(self):
        self.d(oracle_files(H + OR + 'op f\n  input x? json, y? json\nreq A "a"\n  table f\n'
                            '    | x        | y | result.x | result.y ± 0.5 |\n'
                            '    |----------|---|:--------:|----------------|\n'
                            '    | "a\\|b"   |   | "a\\|b"   |                |\n'
                            '    | 1        | 2 | ?        | 2.4            |\n'), [])
        self.d(oracle_files(H + OR + 'op f\n  input x? json\nreq A "a"\n  table f\n    |---|----------|\n'
                            '    | x | result.x |\n    |   |\n    | 1 | 1\n    |\n    | 2 | 2        |\n'), [])


# ------------------------------------------------------------------ CK

class TestChecks(Base):
    def test_ck001_example_required(self):
        self.ds(H + 'req A "a"\n  text\n    It MUST work.\n', ['s.duramen:3: error T001'])
        self.ds(H + 'req A "a"\n  table f\n    | x |\n    |---|\n', ['s.duramen:4: error P013'])

    @unittest.skipUnless(HAVE_NODE, 'needs node')
    def test_ck002_unique_ids(self):
        t = (H + OR + 'op f\n  input x? json\nreq A "a"\n  example f {}\nreq A "again"\n  example f {}\n'
             'open A "an open item may share a requirement\'s ID"\n  text\n    Open.\nopen B "b"\n  text\n    Open.\n'
             'open B "b again"\n  text\n    Open.\ndecision D-1 "d"\n  source s\ndecision D-1 "d again"\n  source s\n'
             'req C "c"\n  decision D-1\n  example f {}\n')
        self.d(oracle_files(t), ['s.duramen:8: error T007', 's.duramen:16: error T007', 's.duramen:21: error T007'])
        self.d({'a.duramen': H + OR + 'op f\n  input x? json\nreq A "a"\n  example f {}\n',
                'b.duramen': 'duramen 0.1\nreq A "a"\n  example f {}\nop f\n  input y? json\n', 'echo.mjs': ECHO},
               ['b.duramen:2: error T007', 'b.duramen:4: error T007'])

    @unittest.skipUnless(HAVE_NODE, 'needs node')
    def test_ck003_decisions_declared(self):
        self.d(oracle_files(H + OR + 'op f\n  input x? json\ndecision D-1 "d"\n  source s\nreq A "a"\n'
                            '  decision D-1 D-2, D-3\n  decision D-2\n  example f {}\n'),
               ['s.duramen:8: error T008', 's.duramen:8: error T008'])

    @unittest.skipUnless(HAVE_NODE, 'needs node')
    def test_ck004_declared_ops(self):
        self.d(oracle_files(H + OR + 'op f\n  input a number, b? number\nerrors\n  e when never\nreq A "a"\n'
                            '  example g {"a": 1}\n  example f {"b": 1}\n  example f {"a": 1, "c": 2}\n  example f\n'
                            '  example g {"answer": {"error": "e"}}\n    expect error = "e"\n'
                            '  example raw \'{"id": "A#6", "op": "g"}\'\n  table f\n    | b | c |\n    | 1 | 2 |\n'
                            '  example g {}\n    expect error.code = "e"\n'),
               ['s.duramen:9: error T009', 's.duramen:10: error T010', 's.duramen:11: warning T011',
                's.duramen:12: error T010', 's.duramen:18: error T010', 's.duramen:18: warning T011',
                's.duramen:19: error T009'])

    @unittest.skipUnless(HAVE_NODE, 'needs node')
    def test_ck005_expected_errors(self):
        self.d(oracle_files(H + OR + 'op f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n'
                            '  example f {"answer": {"error": "e"}}\n    expect error = "e"\n'
                            '  example f {"answer": {"error": "nope"}}\n    expect error = "nope"\n'
                            '  example raw \'{"id": "r", "op": "f", "input": {"answer": {"error": "other"}}}\'\n'
                            '    expect error = "other"\n  example f {"answer": {"error": "e"}}\n'
                            '    expect error = ?\n'),
               ['s.duramen:12: error T023', 's.duramen:14: error T023'])

    def test_ck006_obligations_full(self):
        text = ('duramen 0.1\nspec s 1\n  text\n    The program MUST work.\nop f\n  result what it MUST return\n'
                'errors\n  e when it SHALL fail\nsection S "It MUST be titled"\n  text\n    REQUIRED reading.\nnote\n'
                '  text\n    This note says `MUST`, "SHALL" and “REQUIRED”, MUSTARD and must.\n'
                'decision D-1 "d"\n  source s\n  text\n    Fine.\n  rejected "Another MUST."\nopen O "o"\n  text\n'
                '    It MUST NOT be.\n')
        self.ds(text, ['s.duramen:2: error T004', 's.duramen:5: error T004', 's.duramen:8: error T004',
                       's.duramen:9: error T004', 's.duramen:15: error T004', 's.duramen:15: warning T012',
                       's.duramen:20: warning T014'])
        self.ds(H + 'decision D-1 "d"\n  source s\n  text\n    It MUST.\n  rejected "It SHALL."\n'
                '  rejected "It is REQUIRED."\n',
                ['s.duramen:3: error T004', 's.duramen:3: error T004', 's.duramen:3: error T004',
                 's.duramen:3: warning T012'])
        self.ds(H + 'errors\n  e when the "MUST\n    hold" rule fails\n  f when the "MUST hold" rule fails\nnote\n'
                '  text\n    A MUST-have.\nsection S "s"\n  text\n    MUSTé\n',
                ['s.duramen:4: error T004', 's.duramen:7: error T004', 's.duramen:10: error T004'])

    def test_ck007_open_items(self):
        self.ds(H + 'open O "o"\n  example f {}\n  table f\n    | x |\n    | 1 |\n  example f {not json\n'
                '    expect nothing at all\n  table g h\n    | {bad |\n',
                ['s.duramen:4: error T003', 's.duramen:5: error T003', 's.duramen:8: error T003',
                 's.duramen:10: error T003'])

    @unittest.skipUnless(HAVE_NODE, 'needs node')
    def test_ck008_order_stated_once(self):
        self.d(oracle_files(H + OR + 'op f\n  input x? json\nerrors\n  too_big when x > 9\n  too_small when x < 0\n'
                            'req A "a"\n  text\n    A request that is too_big gets too_big, and one too_small gets too_small.\n'
                            '  example f {}\nreq B "b"\n  text\n    too_big is checked Before too_small.\n  example f {}\n'
                            'req C "c"\n  text\n    too_big is checked first.\n    After that, nothing.\n  example f {}\n'
                            'req D "d"\n  text\n    too_big and too_small are checked in this\n    order.\n'
                            '  example f {}\n'),
               ['s.duramen:14: error T005', 's.duramen:23: error T005'])
        self.d(oracle_files(H + OR + 'op f\n  input x? json\nerrors\n  e when x\n  f when y\nreq A "a"\n  text\n'
                            '    A request may be refused before it is read: see the errors list.\n  example f {}\n'), [])

    @unittest.skipUnless(HAVE_NODE, 'needs node')
    def test_ck009_decisions(self):
        self.d(oracle_files(H + OR + 'op f\n  input x? json\ndecision D-1 "uncited, no source"\n'
                            'decision D-2 "bad status"\n  source s\n  status Accepted\n'
                            'decision D-3 "superseded by nothing"\n  source s\n  status superseded\n'
                            'decision D-4 "x"\n  source s\n  status superseded by D-9\n'
                            'decision D-5 "x"\n  source s\n  status superseded by D-6\n'
                            'decision D-6 "x"\n  source s\n  status accepted on 2026-01-01\n'
                            'decision D-7 "observed"\n  source s\n  status observed\n'
                            'req A "a"\n  decision D-2, D-3, D-4, D-5, D-6, D-7\n  example f {}\n'),
               ['s.duramen:6: warning T012', 's.duramen:6: warning T013', 's.duramen:7: error T027',
                's.duramen:10: error T027', 's.duramen:13: error T027', 's.duramen:25: error T028',
                's.duramen:25: error T028', 's.duramen:25: error T028', 's.duramen:25: warning T028'])
        self.d(oracle_files(H + OR + 'op f\n  input x? json\ndecision D-1 "a"\n  source s\n  status accepted, 2026-01-01\n'
                            'decision D-2 "e"\n  source\n  status\nreq A "a"\n  decision D-1, D-2\n  example f {}\n'),
               ['s.duramen:6: error T027', 's.duramen:9: warning T013', 's.duramen:9: error T027'])


# ------------------------------------------------------------------ OR

@unittest.skipUnless(HAVE_NODE, 'needs node')
class TestOracle(Base):
    def test_or001_needs_oracle(self):
        self.ds(H + 'op f\n  input x? json\nreq A "a"\n  example f {}\n    expect result = 1\n', ['s.duramen:2: error T019'])
        self.ds(H + 'op f\n  input x? json\nreq A "a"\n  text\n    No example.\nreq B "b"\n  example f {}\n',
                ['s.duramen:2: error T019', 's.duramen:5: error T001'])

    def test_or002_running(self):
        self.d(oracle_files('duramen 0.1\nspec s 1\n  request {"clock": 1}\n' + OR +
                            'op f\n  input line? boolean, x? json\nreq A "a"\n  example f {"line": true,  "x": 2.50}\n'
                            '    expect result = "{\\"id\\":\\"A#1\\",\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":'
                            '{\\"line\\": true,  \\"x\\": 2.50}}"\n  example f {"line": true}\n    omit id\n'
                            '    expect result = "{\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true}}"\n'
                            '  example raw \'{"id": "x",  "op": "f", "input": {"line": true}}\'\n    expect id = "x"\n'
                            '    expect result = "{\\"id\\": \\"x\\",  \\"op\\": \\"f\\", \\"input\\": {\\"line\\": true}}"\n'),
               [])
        self.d({'sub/s.duramen': H + 'oracle node "my echo.mjs"\nop f\n  input x? json\nreq A "a"\n'
                '  example f {"x": 1}\n    expect result.x = 1\n', 'sub/my echo.mjs': ECHO}, [])
        self.d(oracle_files(H + OR + 'op f\n  input x? json\nreq A "a"\n  text\n    No example.\nreq B "b"\n'
                            '  example f {"x": 1}\n    expect result.x = 2\n'),
               ['s.duramen:6: error T001', 's.duramen:11: error T002'])

    def test_or003_disagreement(self):
        self.d(oracle_files(H + OR + 'op f\n  input x? json, y? json, answer? json\nreq A "a"\n'
                            '  example f {"x": 1.0, "y": [5, {"z": null}]}\n'
                            '    expect result = {"y": [5, {"z": null}], "x": 1}\n    expect result.y.1.z = null\n'
                            '    expect result.y.0 ≈ 5.5 ± 0.5\n    expect result.x = 2\n'
                            '    expect result.y.2 = 5\n    expect result.y.0 ≈ 5.5 ± 0.4\n'
                            '    expect result.y.1 = {}\n'
                            '  example f {"answer": {"result": 0, "audit": "{\\"a\\": [1, 2]}"}}\n    expect audit.a.1 = 2\n'
                            '    expect audit = "{\\"a\\": [1, 2]}"\n    expect audit.b = 1\n'
                            '  table f\n    | x | result.x | result.y |\n    | 1 | 2        | 3        |\n'
                            '  example f {"x": {"": 1}}\n    expect result.x. = 1\n    expect result..x = 1\n'
                            '  example f {"y": [7, 8]}\n    expect result.y.1 = 8\n    expect result.y.length = 2\n'
                            '    expect result.y.01 = 8\n'),
               ['s.duramen:11: error T002', 's.duramen:12: error T002', 's.duramen:13: error T002',
                's.duramen:14: error T002', 's.duramen:18: error T002', 's.duramen:21: error T002',
                's.duramen:21: error T002', 's.duramen:24: error T002', 's.duramen:27: error T002',
                's.duramen:28: error T002'])
        self.d(oracle_files(H + OR + 'op f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n'
                            '  example f {"answer": {"result": 1}}\n    expect error = "e"\n'
                            '  example g {"answer": {"error": "e"}}\n    expect error = "e"\n'),
               ['s.duramen:10: error T002'])

    def test_or004_failing_oracle(self):
        self.ds(H + 'oracle no-such-program-for-duramen\nop f\n  input x? json\nreq A "a"\n  example f {}\n',
                ['s.duramen:3: error T020', 's.duramen:7: error T021'])
        self.d(oracle_files(H + OR + 'op f\n  input x? json, exit? integer\nreq A "a"\n  example f {"x": 1}\n'
                            '    expect result.x = 2\n  example f {"exit": 3}\n    expect result.exit = 3\n'),
               ['s.duramen:3: error T020', 's.duramen:8: error T002'])
        self.d(oracle_files(H + OR + 'op f\n  input exit? integer\nreq A "a"\n  example f {}\n'
                            '  example raw \'{"id": "r", "op": "f", "input": {"exit": 4}}\'\n'),
               ['s.duramen:8: error T020'])
        self.ds(H + 'oracle no-such-program-for-duramen\nop f\n  input x? json\nreq A "a"\n'
                '  example raw \'{"id": "r", "op": "f"}\'\n', ['s.duramen:7: error T020', 's.duramen:7: error T021'])
        self.d(oracle_files(H + 'oracle node "echo.mjs\nop f\n  input x? json\nreq A "a"\n  example f {}\n'),
               ['s.duramen:3: error T020', 's.duramen:7: error T021'])

    def test_or005_no_answer(self):
        self.d(oracle_files(H + OR + 'op f\n  input silent? boolean\nreq A "a"\n  example f {"silent": true}\n'
                            '  example f {}\n  example raw \'{"id": "r", "op": "f", "input": {"silent": true}}\'\n'),
               ['s.duramen:7: error T021', 's.duramen:9: error T021'])

    def test_or006_oracle_error(self):
        self.d(oracle_files(H + OR + 'op f\n  input answer? json\nreq A "a"\n'
                            '  example f {"answer": {"oracle_error": "left open"}}\n    expect result = 1\n'
                            '    expect result = ?\n'), ['s.duramen:7: error T022'])

    def test_or007_unexpected_error(self):
        r = run('check', oracle_files(H + OR + 'op f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n'
                                      '  example f {"answer": {"error": "e"}}\n'
                                      '  example f {"answer": {"error": "e"}}\n    expect error = "e"\n'))
        self.assertEqual(r, {'diagnostics': ['s.duramen:9: warning T024'], 'errors': 0, 'warnings': 1})

    def test_or008_oracle_values(self):
        self.d(oracle_files(H + OR + 'op f\n  input x? json\nreq A "a"\n  example f {"x": 1}\n'
                            '    expect result.x = ?\n    expect result.y = ?\n'), ['s.duramen:9: error T025'])


# ------------------------------------------------------------------ SU

@unittest.skipUnless(HAVE_NODE, 'needs node')
class TestSuite(Base):
    def cases(self, files, entry=None):
        return run('cases', files, entry)

    def test_su001_no_suite_with_errors(self):
        self.assertEqual(self.cases(S('frobnicate\n')), {'cases': [], 'errors': 3})
        self.assertEqual(self.cases(S(H + 'req A "a"\n  text\n    Nothing to show.\n')), {'cases': [], 'errors': 1})
        r = self.cases(oracle_files(H + OR + 'op f\n  input x? json\nreq A "a"\n  example f {"y": 1}\n'))
        self.assertEqual(r['errors'], 0)
        self.assertEqual(r['cases'][0]['id'], 'A#1')

    def test_su002_one_case_per_example(self):
        r = self.cases(oracle_files(H + OR + 'op f\n  input x? json\nreq A "a"\n  example f {"x": 1}\n'
                                    '    expect result.x = 1\nreq B "b"\n  on posix\n  table f\n    | x | result.x |\n'
                                    '    | 2 | 2        |\n    | 3 | ?        |\n'))
        self.assertEqual(r, {'cases': [
            {'checks': [{'kind': 'eq', 'path': 'result.x', 'value': 1}],
             'full': {'members': ['id', 'result'], 'result': {'x': 1}, 'tolerances': {}}, 'id': 'A#1',
             'kind': 'example', 'line': '{"id":"A#1","op":"f","input":{"x": 1}}', 'platform': 'any', 'reqs': ['REQ-A']},
            {'checks': [{'kind': 'eq', 'path': 'result.x', 'value': 2}],
             'full': {'members': ['id', 'result'], 'result': {'x': 2}, 'tolerances': {}}, 'id': 'B#1',
             'kind': 'example', 'line': '{"id":"B#1","op":"f","input":{"x":2}}', 'platform': 'posix', 'reqs': ['REQ-B']},
            {'checks': [{'from': 'oracle', 'kind': 'eq', 'path': 'result.x', 'value': 3}],
             'full': {'members': ['id', 'result'], 'result': {'x': 3}, 'tolerances': {}}, 'id': 'B#2',
             'kind': 'example', 'line': '{"id":"B#2","op":"f","input":{"x":3}}', 'platform': 'posix', 'reqs': ['REQ-B']}],
            'errors': 0})
        r = self.cases({'b.duramen': 'duramen 0.1\nreq B "b"\n  on windows\n  example f {}\n',
                        'a.duramen': H + OR + 'op f\n  input x? json\nreq A "a"\n  example f {}\n  example f {}\n',
                        'echo.mjs': ECHO})
        self.assertEqual([c['id'] for c in r['cases']], ['A#1', 'A#2', 'B#1'])
        self.assertEqual(r['cases'][2]['platform'], 'windows')

    def test_su003_request_lines(self):
        r = self.cases(oracle_files(
            'duramen 0.1\nspec s 1\n  request {"clock": "c", "trace": true}\n' + OR +
            'op f\n  input x? json\nop g\n  input x? json\n  request {"mode": 2}\nreq A "a"\n'
            '  example f {"x" : 2.50e0 }\n  example f\n  example f {"x": 1}\n    request {"trace": false, "user": "u"}\n'
            '    omit clock\n  example g {"x": 1}\n    omit id, input\n  example f {"x": 1}\n    omit op, id\n'
            '  example raw \'{"id": "A#6",  "op": "f"}\'\n  example f {"x": 1}\n'
            '    request {"b": {"z": 1, "10": 2, "9": 3}, "2": "two", "a": 1}\n    omit clock\n    omit trace\n'
            '  table f\n    | result |\n    | ?      |\n'))
        c = r['cases']
        self.assertEqual(c[0], {'checks': [], 'full': {'members': ['id', 'result'], 'result': {'x': 2.5}, 'tolerances': {}},
                                'id': 'A#1', 'kind': 'example', 'platform': 'any', 'reqs': ['REQ-A'],
                                'line': '{"id":"A#1","op":"f","clock":"c","trace":true,"input":{"x" : 2.50e0 }}'})
        self.assertEqual(c[1]['line'], '{"id":"A#2","op":"f","clock":"c","trace":true}')
        self.assertEqual(c[2]['line'], '{"id":"A#3","op":"f","trace":false,"user":"u","input":{"x": 1}}')
        self.assertEqual(c[3], {'checks': [], 'full': {'members': ['id', 'result'], 'result': {}, 'tolerances': {}},
                                'id': 'A#4', 'kind': 'example', 'line': '{"op":"g","mode":2}', 'platform': 'any',
                                'reqs': ['REQ-A'], 'solo': True})
        self.assertEqual(c[4]['line'], '{"clock":"c","trace":true,"input":{"x": 1}}')
        self.assertTrue(c[4]['solo'])
        self.assertEqual(c[5]['line'], '{"id": "A#6",  "op": "f"}')
        self.assertTrue(c[5]['solo'])
        self.assertEqual(c[6]['line'], '{"id":"A#7","op":"f","2":"two","b":{"9":3,"10":2,"z":1},"a":1,"input":{"x": 1}}')
        self.assertEqual(c[7]['line'], '{"id":"A#8","op":"f","clock":"c","trace":true,"input":{}}')

    def test_su003_input_lines(self):
        r = self.cases(oracle_files(H + OR + 'op f\n  input files? object, n? number\nreq A "a"\n'
                                    '  example f {"n" : 1.50, "files": {"z": "old"}}\n    input files."a.duramen"\n'
                                    '      duramen 0.1\n      "quoted" é\n    input files.z\n      new\n'
                                    '  table f\n    | n      | files |\n    | 1.50   |       |\n    |        | {}    |\n'))
        c = r['cases']
        self.assertEqual(c[0]['line'], '{"id":"A#1","op":"f","input":{"n":1.5,"files":{"z":"new\\n",'
                                       '"a.duramen":"duramen 0.1\\n\\"quoted\\" é\\n"}}}')
        self.assertEqual(c[1]['line'], '{"id":"A#2","op":"f","input":{"n":1.50}}')
        self.assertEqual(c[2]['line'], '{"id":"A#3","op":"f","input":{"files":{}}}')

    def test_su004_checks(self):
        r = self.cases(oracle_files(H + OR + 'op f\n  input x? json\nreq A "a"\n  example f {"x": {"y": [1, 2]}}\n'
                                    '    expect result.x.y.0 = 1\n    expect result.x.y.1 ~ 2.1 +- 0.25\n'
                                    '    expect result.x = ?\n    expect id = "A#1"\n  table f\n'
                                    '    | x | result.x ± 0.5 |\n    | 2 | 2.25           |\n'))
        self.assertEqual(r['cases'][0]['checks'], [
            {'kind': 'eq', 'path': 'result.x.y.0', 'value': 1},
            {'kind': 'approx', 'path': 'result.x.y.1', 'tol': 0.25, 'value': 2.1},
            {'from': 'oracle', 'kind': 'eq', 'path': 'result.x', 'value': {'y': [1, 2]}},
            {'kind': 'eq', 'path': 'id', 'value': 'A#1'}])
        self.assertEqual(r['cases'][1]['checks'], [{'kind': 'approx', 'path': 'result.x', 'tol': 0.5, 'value': 2.25}])

    def test_su005_full(self):
        r = self.cases(oracle_files(H + OR + 'op f\n  input answer? json\n  audit\n  tolerance result.t 0.5\n'
                                    '  tolerance result.u 0\nop g\n  input answer? json\nerrors\n  e when never\n'
                                    'req A "a"\n  example f {"answer": {"result": {"t": 1}, "audit": "A"}}\n'
                                    '  example f {"answer": {"error": "e", "extra": 1}}\n    expect error = "e"\n'
                                    '  example g {"answer": {"result": 2, "audit": "B"}}\n'
                                    '  example h {"answer": {"error": "e"}}\n    expect error = "e"\n'))
        c = r['cases']
        tol = {'result.t': 0.5, 'result.u': 0}
        self.assertEqual(c[0]['full'], {'audit': 'A', 'members': ['audit', 'id', 'result'], 'result': {'t': 1},
                                        'tolerances': tol})
        self.assertEqual(c[1]['full'], {'error': 'e', 'members': ['error', 'extra', 'id'], 'tolerances': tol})
        self.assertEqual(c[2]['full'], {'members': ['audit', 'id', 'result'], 'result': 2, 'tolerances': {}})
        self.assertEqual(c[3]['full'], {'error': 'e', 'members': ['error', 'id'], 'tolerances': {}})


class TestHelpers(unittest.TestCase):
    def test_es_number(self):
        for v, s in [(2.5, '2.5'), (1e21, '1e+21'), (1e-7, '1e-7'), (0.000001, '0.000001'), (123.0, '123'),
                     (1.5e300, '1.5e+300'), (-0.5, '-0.5'), (1e20, '100000000000000000000')]:
            self.assertEqual(core.es_number(core.normnum(v)), s)

    def test_stringify_order(self):
        self.assertEqual(core.js_stringify({'z': 1, '10': 2, '9': 3, 'a': [None, True, 'x\n']}),
                         '{"9":3,"10":2,"z":1,"a":[null,true,"x\\n"]}')

    def test_split_command(self):
        self.assertEqual(core.split_command('node "a b.mjs" \'c d\' x"y z"w ""'), ['node', 'a b.mjs', 'c d', 'xy zw', ''])
        self.assertIsNone(core.split_command('node "a'))
        self.assertEqual(core.split_command('a "b\\"c" \\d'), ['a', 'b"c', '\\d'])


if __name__ == '__main__':
    unittest.main()
