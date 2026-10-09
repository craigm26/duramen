import json
import os
import shutil
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import duramen_core as core  # noqa: E402


def _read(name):
    with open(os.path.join(HERE, 'fixtures', name), encoding='utf-8') as f:
        return f.read()


if shutil.which('node'):
    ORC = 'node echo.mjs'
else:
    ORC = '"%s" echo.py' % sys.executable
ECHO = {'echo.mjs': _read('echo.mjs'), 'echo.py': _read('echo.py')}


def T(*lines):
    return '\n'.join(lines) + '\n'


def call(op, files, entry=None, **extra):
    inp = {'files': files}
    if entry is not None:
        inp['entry'] = entry
    inp.update(extra)
    r = core.handle(json.dumps({'id': 'x', 'op': op, 'input': inp}))
    return json.loads(core.ascii_escape(core.stringify(r)))


def diags(files, entry=None):
    r = call('check', files, entry)
    return r['result']['diagnostics']


def S(*lines):
    """A record text with the oracle placeholder filled."""
    return T(*lines).replace('@ORC@', ORC)


def with_echo(files):
    d = dict(files)
    d.update(ECHO)
    return d


HEAD = ('duramen 0.1', 'spec s 1')


class Requests(unittest.TestCase):
    def test_rq001_entry_and_names(self):  # REQ-RQ-001
        a = T('duramen 0.1', 'spec a 1')
        self.assertEqual(diags({'a.duramen': a, 'b.duramen': 'frobnicate\n'}, 'a.duramen'), [])
        self.assertEqual(diags({'a.duramen': a, 'b.duramen': 'frobnicate\n'}),
                         ['b.duramen:1: error P002', 'b.duramen:1: error P020'])
        self.assertEqual(diags({'a.duramen': a, 'b.duramen': 'frobnicate\n'}, '.'),
                         ['b.duramen:1: error P002', 'b.duramen:1: error P020'])

    def test_rq002_errors(self):  # REQ-RQ-002
        ok = {'a.duramen': 'duramen 0.1\nspec a 1\n'}

        def raw(line):
            return json.loads(core.stringify(core.handle(line)))
        self.assertEqual(raw('{not json'), {'id': None, 'error': 'bad_request'})
        self.assertEqual(raw('[1, 2]'), {'id': None, 'error': 'bad_request'})
        self.assertEqual(raw('{"op":"check","input":{}}'), {'id': None, 'error': 'bad_request'})
        self.assertEqual(raw('{"id":7,"op":"check","input":{}}'), {'id': None, 'error': 'bad_request'})
        self.assertEqual(raw('{"id":"i","op":"lint","input":{}}')['error'], 'unknown_op')
        self.assertEqual(raw('{"id":"i","op":"lint"}')['error'], 'unknown_op')
        self.assertEqual(raw('{"id":"i","op":"check"}')['error'], 'bad_request')
        self.assertIsNone(core.handle('  \t'))
        self.assertIsNone(core.handle(''))
        bad = [{}, {'files': {}}, {'files': ['a.duramen']}, {'files': {'a.duramen': 1}},
               {'files': {'../a.duramen': 'x'}}, {'files': {'/a.duramen': 'x'}},
               {'files': {'x/./a.duramen': 'x'}}, {'files': {'x//a.duramen': 'x'}},
               {'files': {'c:a.duramen': 'x'}}, {'files': {'a\\b.duramen': 'x'}},
               {'files': {'a': 'x', 'a/b.duramen': 'x'}},
               {'files': ok, 'entry': '../a.duramen'}, {'files': ok, 'entry': 1}, {'files': ok, 'entry': ''},
               {'files': {'a\x00b': 'x'}}]
        for inp in bad:
            for op in ('check', 'cases'):
                r = core.handle(json.dumps({'id': 'i', 'op': op, 'input': inp}))
                self.assertEqual(r, {'id': 'i', 'error': 'bad_request'}, inp)
        r = core.handle(json.dumps({'id': 'i', 'op': 'check', 'input': 5}))
        self.assertEqual(r['error'], 'bad_request')


class Records(unittest.TestCase):
    def test_rc001_files_of_a_record(self):  # REQ-RC-001
        a = T('duramen 0.1', 'spec a 1')
        junk = 'frobnicate\n'
        files = {'a.duramen': a, 'notes.md': junk, 'build/x.duramen': junk, 'sub/build/x.duramen': junk,
                 'node_modules/x.duramen': junk, '.hidden.duramen': junk, 'sub/.hidden/x.duramen': junk,
                 'sub/b.duramen': 'duramen 0.1\n'}
        self.assertEqual(diags(files), [])
        self.assertEqual(diags({'notes.md': a, 'a.duramen': junk}, 'notes.md'), [])
        self.assertEqual(diags({'sub/a.duramen': a, 'sub/deeper/b.duramen': 'duramen 0.1\n', 'c.duramen': junk}, 'sub'), [])
        self.assertEqual(diags({'sub/a.duramen': a, 'sub/b.duramen': junk}, 'sub/a.duramen'), [])
        self.assertEqual(diags({'build/a.duramen': a, 'build/build/b.duramen': junk}, 'build'), [])
        self.assertEqual(diags({'a.duramen': a}, 'missing.duramen'), ['missing.duramen:1: error P046'])
        self.assertEqual(diags({'a.duramen': a}, 'sub'), ['sub:1: error P046'])
        r = call('check', {'notes.md': a})
        self.assertEqual(r['result'], {'diagnostics': ['.:1: error P046'], 'errors': 1, 'warnings': 0})
        self.assertEqual(diags({'sub/.x.duramen': a}, 'sub'), ['sub:1: error P046'])

    def test_rc002_order_of_files(self):  # REQ-RC-002
        def mk(n):
            return T('duramen 0.1', 'spec %s 1' % n)
        self.assertEqual(diags({'b.duramen': mk('b'), 'a.duramen': mk('a')}), ['b.duramen:2: error P044'])
        self.assertEqual(diags({'a.duramen': mk('a'), 'B.duramen': mk('b')}), ['a.duramen:2: error P044'])
        self.assertEqual(diags({'a/z.duramen': mk('z'), 'a.duramen': mk('a')}), ['a/z.duramen:2: error P044'])
        self.assertEqual(diags({'｡.duramen': mk('x'), '\U0001f600.duramen': mk('y')}),
                         ['｡.duramen:2: error P044'])

    def test_rc003_versions(self):  # REQ-RC-003
        self.assertEqual(diags({'s.duramen': 'spec s 1\n'}), ['s.duramen:1: error P020'])
        self.assertEqual(diags({'s.duramen': T('duramen 0.3', 'spec s 1')}), ['s.duramen:1: error P023'])
        self.assertEqual(diags({'s.duramen': T('duramen 0.1', 'spec s 1', 'duramen 0.1', 'duramen 9')}),
                         ['s.duramen:3: error P023', 's.duramen:4: error P023'])
        self.assertEqual(diags({'s.duramen': T('duramen', 'spec s 1')}), ['s.duramen:1: error P023'])
        a = T('duramen 0.1', 'spec s 1')
        self.assertEqual(diags({'a.duramen': a, 'b.duramen': 'duramen 0.2\n'}), ['.:1: error P047'])
        self.assertEqual(diags({'r/a.duramen': T('duramen 0.2', 'spec s 1'), 'r/b.duramen': 'duramen 0.1\n'}, 'r'),
                         ['r:1: error P047'])
        self.assertEqual(diags({'a.duramen': T('duramen 0.2', 'spec s 1'), 'b.duramen': 'duramen 0.2\n'}), [])
        self.assertEqual(diags({'a.duramen': T('duramen 0.2', 'spec s 1'), 'b.duramen': 'duramen 2\n'}),
                         ['b.duramen:1: error P023'])
        self.assertEqual(diags({'s.duramen': ''}), ['.:1: error P021', 's.duramen:1: error P020'])

    def test_rc004_one_spec(self):  # REQ-RC-004
        self.assertEqual(diags({'s.duramen': 'duramen 0.1\n'}), ['.:1: error P021'])
        self.assertEqual(diags({'s.duramen': 'duramen 0.1\n'}, 's.duramen'), ['s.duramen:1: error P021'])
        self.assertEqual(diags({'r/s.duramen': 'duramen 0.1\n'}, 'r'), ['r:1: error P021'])
        self.assertEqual(diags({'s.duramen': T('duramen 0.1', 'spec a 1', '', 'spec b 1')}), ['s.duramen:4: error P044'])
        self.assertEqual(diags({'a.duramen': T('duramen 0.1', 'spec s 1', 'oracle node a.mjs'),
                                'b.duramen': T('duramen 0.1', 'oracle node b.mjs')}), ['b.duramen:2: error P044'])
        self.assertEqual(diags({'s.duramen': T('duramen 0.1', 'spec s 1', 'errors', '  e1 when x', 'errors', '  e2 when y')}),
                         ['s.duramen:5: error P032'])
        self.assertEqual(diags({'a.duramen': T('duramen 0.1', 'spec s 1', 'errors', '  e1 when x'),
                                'b.duramen': T('duramen 0.1', '', 'errors', '  e2 when y')}), ['b.duramen:3: error P032'])
        self.assertEqual(diags({'s.duramen': T('duramen 0.1', 'spec s 1', 'errors', 'errors')}), ['s.duramen:4: error P032'])
        self.assertEqual(diags({'s.duramen': T('duramen 0.1', 'spec s 1', 'duramen 0.1', '  title "t"', 'spec s',
                                               'oracle', '  source o.mjs', '    more', 'errors x', '  e if')}),
                         ['s.duramen:3: error P023', 's.duramen:4: error P015', 's.duramen:5: error P021',
                          's.duramen:5: error P044', 's.duramen:6: error P028', 's.duramen:8: error P006',
                          's.duramen:9: error P050', 's.duramen:10: error P019'])

    def test_rc005_reading_stops(self):  # REQ-RC-005
        self.assertEqual(diags({'s.duramen': T(*HEAD, 'frobnicate', 'req A "a"', '  example nope {}')}),
                         ['s.duramen:3: error P002'])

    def test_rc006_order(self):  # REQ-RC-006
        r = call('check', {'b.duramen': 'frobnicate\nduramen 0.1\n',
                           'a.duramen': T(*HEAD, '', '', 'frobnicate', 'frobnicate')})
        self.assertEqual(r['result'], {'diagnostics': ['a.duramen:5: error P002', 'a.duramen:6: error P002',
                                                       'b.duramen:1: error P002'], 'errors': 3, 'warnings': 0})
        r = call('check', {'s.duramen': T(*HEAD, '', 'decision D-1 "one"', '  text', '    No source, and cited by nothing.',
                                          '', 'req A "a"', '  decision D-2')})
        self.assertEqual(r['result'], {'diagnostics': ['s.duramen:4: warning T012', 's.duramen:4: warning T013',
                                                       's.duramen:8: error T001', 's.duramen:8: error T008'],
                                       'errors': 2, 'warnings': 2})
        r = call('check', {'s.duramen': T(*HEAD, '', 'decision D-1 "proposed"', '  source here', '  status proposed', '',
                                          'decision D-2 "contested"', '  source there', '  status contested', '',
                                          'req A "a"', '  decision D-1, D-2')})
        self.assertEqual(r['result'], {'diagnostics': ['s.duramen:12: error T001', 's.duramen:12: error T028',
                                                       's.duramen:12: warning T028'], 'errors': 2, 'warnings': 1})


class Syntax(unittest.TestCase):
    def test_sy001_lines(self):  # REQ-SY-001
        f = lambda t: diags({'s.duramen': t})
        self.assertEqual(f('﻿duramen 0.1\r\nspec s 1\rnote  \n  text\t\n    Some text.  \r\n'), [])
        self.assertEqual(f('duramen 0.1\nspec s 1\n\tnote\n'), ['s.duramen:3: error P001'])
        self.assertEqual(f('duramen 0.1\nspec s 1\nnote\n  \ttext\n'), ['s.duramen:4: error P001'])
        self.assertEqual(f('duramen 0.1\nspec s 1\n note\n'), ['s.duramen:3: error P001'])
        self.assertEqual(f('  \t \nduramen 0.1\n\t\nspec s 1\n   \n'), [])
        self.assertEqual(f('duramen 0.1　\nspec s 1 \nnote\n  text\n'), ['s.duramen:4: error P001'])

    def test_sy002_statements(self):  # REQ-SY-002
        t = T('# A comment.', 'duramen 0.1', '#A comment too.', 'spec s 1', 'frobnicate this', '  title "ignored"',
              '    ignored too', 'Note')
        self.assertEqual(diags({'s.duramen': t}), ['s.duramen:5: error P002', 's.duramen:8: error P002'])
        self.assertEqual(diags({'s.duramen': T('  indented', ' # indented too', 'duramen 0.1', 'spec s 1')}),
                         ['s.duramen:1: error P003', 's.duramen:2: error P003'])

    def test_sy003_clauses(self):  # REQ-SY-003
        f = lambda *l: diags({'s.duramen': T(*HEAD, *l)})
        self.assertEqual(f('note', '  # A comment.', '  text', '    Text.', '    # Text, not a comment.'), [])
        self.assertEqual(f('note', ' text'), ['s.duramen:4: error P007'])
        self.assertEqual(f('note', '    Text without a clause.', '  text', '    Text.'), ['s.duramen:4: error P006'])
        self.assertEqual(f('  colour blue', '    more', 'note', '  example f {}', '    expect result = 1'),
                         ['s.duramen:3: error P015', 's.duramen:6: error P015'])
        self.assertEqual(f('note', ' # not a comment here', '    # nor here', '  text', '    Text.'),
                         ['s.duramen:4: error P007', 's.duramen:5: error P006'])
        self.assertEqual(f('  title "one"', '  title "two"', '    more', 'note', '  text', '    One.', '  text Two.',
                           'decision D "d"', '  source a', '  source b', '  status accepted', '  status rejected'),
                         ['s.duramen:4: error P052', 's.duramen:9: error P052', 's.duramen:12: error P052',
                          's.duramen:14: error P052'])
        self.assertEqual(f('  title "A title"', '    that goes on', '  # A comment.', '    # Another.'),
                         ['s.duramen:4: error P006'])

    def test_sy004_spec_oracle(self):  # REQ-SY-004
        g = lambda *l: diags({'s.duramen': T(*l)})
        self.assertEqual(g('duramen 0.1', '  title "x"', 'spec s 1'), ['s.duramen:2: error P015'])
        self.assertEqual(g('duramen 0.1', 'spec s'), ['s.duramen:2: error P021'])
        self.assertEqual(g('duramen 0.1', 'spec s 1 2'), ['s.duramen:2: error P021'])
        self.assertEqual(g('duramen 0.1', 'spec s 1.0.0-beta', '  title "The s program"', '  contract s-out-2',
                           '  request {"clock": "2026-01-01T00:00:00Z", "n": 1}', '  text', '    What s is.'), [])
        self.assertEqual(g(*HEAD, '  request {"clock":'), ['s.duramen:3: error P009'])
        self.assertEqual(g(*HEAD, '  request ["clock"]'), ['s.duramen:3: error P009'])
        self.assertEqual(g(*HEAD, '  request {"op": "x"}'), ['s.duramen:3: error P051'])
        self.assertEqual(g(*HEAD, 'oracle'), ['s.duramen:3: error P028'])
        self.assertEqual(g(*HEAD, 'oracle node model.mjs --quiet', '  source model.mjs, lib/a.mjs lib/b.mjs',
                           '  timeout 5'), ['s.duramen:5: error P015'])

    def test_sy005_text(self):  # REQ-SY-005
        f = lambda *l: diags({'s.duramen': T(*HEAD, *l)})
        self.assertEqual(f('note', '  text Here.'), ['s.duramen:4: error P008'])
        self.assertEqual(f('note', '  text', '    One.', '   Two.'), ['s.duramen:6: error P008'])
        self.assertEqual(f('note', '  text', '    # It MUST be text.'), ['s.duramen:3: error T004'])

    def test_sy006_quoted(self):  # REQ-SY-006
        f = lambda *l: diags({'s.duramen': T(*HEAD, *l)})
        self.assertEqual(f('section S A title'), ['s.duramen:3: error P005'])
        self.assertEqual(f('section S "A title" and more'), ['s.duramen:3: error P005'])
        self.assertEqual(f('section S'), ['s.duramen:3: error P005'])
        self.assertEqual(f('section S "unclosed', 'section T "A" "B"', 'section U "'),
                         ['s.duramen:3: error P005', 's.duramen:4: error P004', 's.duramen:5: error P005'])
        self.assertEqual(f('section S "A \\q title"'), ['s.duramen:3: error P004'])
        self.assertEqual(f('section S "A "quoted" title"'), ['s.duramen:3: error P004'])
        self.assertEqual(f('  title A title'), ['s.duramen:3: error P004'])
        self.assertEqual(f('section S-1.x "A \\"quoted\\" title, é and all"'), [])

    def test_sy007_operations(self):  # REQ-SY-007
        f = lambda *l: diags({'s.duramen': T(*HEAD, *l)})
        self.assertEqual(f('op f g'), ['s.duramen:3: error P031'])
        self.assertEqual(f('op'), ['s.duramen:3: error P031'])
        self.assertEqual(f('op f', '  input a number, b? {x: number, y: string}, c "one, two" | [1, 2], d-e (f, g)',
                           '  result the sum', '  tolerance result.sum 0.005', '  tolerance result.count 0',
                           '  audit text', '  request {}'), [])
        self.assertEqual(
            f('op f', '  input a', '  input a.b number', '  input b?number', '  input', '  input c number, , d number,',
              "  input e 'x, y'", '  input c number', '  input é number', 'op g', '  audit json', 'op',
              '  input x', '  tolerance result.y'),
            ['s.duramen:4: error P017', 's.duramen:5: error P017', 's.duramen:6: error P017', 's.duramen:7: error P017',
             's.duramen:8: error P017', 's.duramen:8: error P017', 's.duramen:9: error P017', 's.duramen:10: error P052',
             's.duramen:11: error P017', 's.duramen:13: error P050', 's.duramen:14: error P031',
             's.duramen:15: error P017', 's.duramen:16: error P018'])
        self.assertEqual(f('op f', '  tolerance result.x', '  tolerance result.x -1', '  tolerance result.x 0x10',
                           '  tolerance result.x 1 2', '  tolerance result.x 1e-3'),
                         ['s.duramen:4: error P018', 's.duramen:5: error P018', 's.duramen:6: error P018',
                          's.duramen:7: error P018'])
        self.assertEqual(f('op f', '  request 5', 'op g', '  request {"input": 5}', 'op h', '  tolerance result.x 1',
                           '  tolerance result.y 1', '  tolerance result.x 2'),
                         ['s.duramen:4: error P009', 's.duramen:6: error P051', 's.duramen:10: error P052'])

    def test_sy008_errors(self):  # REQ-SY-008
        f = lambda *l: diags({'s.duramen': T(*HEAD, *l)})
        self.assertEqual(f('errors', '  bad_input when the input is not an object, or', '    when it lacks a field',
                           '  not_found when there is no such thing'), [])
        self.assertEqual(f('errors first', '  e when x'), ['s.duramen:3: error P050'])
        self.assertEqual(f('errors', '  e if x', '  e when', '    the input is bad', '  when x', '  f when y',
                           '   and z', '  g is', '   wrong'),
                         ['s.duramen:4: error P019', 's.duramen:5: error P019', 's.duramen:7: error P019',
                          's.duramen:9: error P006', 's.duramen:10: error P019', 's.duramen:11: error P006'])
        self.assertEqual(f('errors', '  e when x', '    # It MUST be read.'), ['s.duramen:4: error T004'])

    def test_sy009_statements(self):  # REQ-SY-009
        f = lambda *l: diags({'s.duramen': T(*HEAD, *l)})
        self.assertEqual(f('section S "Things"', '  text', '    About things.', 'note', '  text', '    A note.',
                           'open S-1 "Unsaid"', '  text', '    Left open.', 'decision D-1 "Why"', '  source the author',
                           '  status accepted', '  text', '    Because.', '  rejected "Another way, because no."',
                           '  rejected "A third way."'), ['s.duramen:12: warning T012'])
        self.assertEqual(f('req A "a"', '  on mac', '  status accepted', '  example f {}', 'note x', 'section S "s"',
                           '  example f {}', 'decision D "d"', '  title "x"', 'open O "o"', '  decision D'),
                         ['s.duramen:4: error P033', 's.duramen:5: error P015', 's.duramen:7: error P050',
                          's.duramen:9: error P015', 's.duramen:11: error P015', 's.duramen:13: error P015'])

    def test_sy010_examples(self):  # REQ-SY-010
        f = lambda *l: diags({'s.duramen': T(*HEAD, 'req A "a"', *l)})
        self.assertEqual(f('  example', '  example f [1]', '  example f {"x": 1', '  example f 2',
                           '  example raw "{\\"id\\": \\"1\\",\\n\\"op\\": \\"f\\"}"'),
                         ['s.duramen:4: error P012', 's.duramen:5: error P012', 's.duramen:6: error P009',
                          's.duramen:7: error P012', 's.duramen:8: error P026'])
        self.assertEqual(
            f('  example raw', '  example raw {"id": "x"}', '  example raw "unclosed', '  example raw "a" "b"',
              '  example raw "carriage\\rreturn"', '  example f [1]', '    expect result', '     expect result = 1',
              '    expect result ≈ 1', '    expect result~1+-0.5', '    expect result="~"', '    expect result =',
              '    expect = 1', '    request {"a": 1}', '    request {"b": 1}', '    omit', '    omit a, b c', '    omit d'),
            ['s.duramen:4: error P004', 's.duramen:5: error P004', 's.duramen:6: error P004', 's.duramen:7: error P004',
             's.duramen:8: error P026', 's.duramen:9: error P012', 's.duramen:10: error P011', 's.duramen:11: error P006',
             's.duramen:12: error P010', 's.duramen:15: error P009', 's.duramen:16: error P011', 's.duramen:18: error P052',
             's.duramen:19: error P011'])
        self.assertEqual(
            f('  example f {}', '    expect result ≈ 1 ± -1', '    expect result ~ 1 +- x',
              '    expect result ≈ 0x10 ± 1', '    expect result = {nope}', '    expect result', '    result = 1',
              '     expect result = 1', '      expect result = 1', '    request [1]', '    request {"input": {}}',
              "  example raw '{\"id\": \"x\"}'", '    omit id', '    request {"a": 1}', '    input files."a"', '      text'),
            ['s.duramen:5: error P010', 's.duramen:6: error P010', 's.duramen:7: error P010', 's.duramen:8: error P009',
             's.duramen:9: error P011', 's.duramen:10: error P011', 's.duramen:11: error P006', 's.duramen:12: error P006',
             's.duramen:13: error P009', 's.duramen:14: error P051', 's.duramen:16: error P022', 's.duramen:17: error P022',
             's.duramen:18: error P022'])

    def test_sy011_input_texts(self):  # REQ-SY-011
        t = S('duramen 0.1', 'spec s 1', 'oracle @ORC@', 'op f', '  input files object, n? number', 'req A "a"',
              '  example f {"n": 1}', '    input files."a b"', '      one', '        two', '', '    input files.x',
              '      three', '', '', '    expect result = {"n": 1, "files": {"a b": "one\\n  two\\n", "x": "three\\n"}}')
        self.assertEqual(diags(with_echo({'s.duramen': t})), [])
        f = lambda *l: diags({'s.duramen': T(*HEAD, 'req A "a"', *l)})
        self.assertEqual(f('  example f {"x": 1}', '    input files.', '    input files.."a"', '    input "a', '    input x.y',
                           '      text', '    input z', '    input y from "missing.txt"'),
                         ['s.duramen:5: error P049', 's.duramen:6: error P049', 's.duramen:7: error P049',
                          's.duramen:8: error P049', 's.duramen:10: error P049', 's.duramen:11: error P048'])
        self.assertEqual(f('  example f {}', '    input a', '     not six', '      six, but after the line that ended the text'),
                         ['s.duramen:5: error P049', 's.duramen:6: error P006', 's.duramen:7: error P006'])
        r = diags({'r/s.duramen': T(*HEAD, 'req A "a"', '  example f {}', '    input a from "../outside.txt"',
                                    '    input b from "t.txt"', '      not its text', '    input c from "unclosed'),
                   'r/t.txt': 't\n', 'outside.txt': 'x'}, 'r')
        self.assertEqual(r, ['r/s.duramen:5: error P048', 'r/s.duramen:7: error P006', 'r/s.duramen:8: error P049'])
        t = S('duramen 0.1', 'spec s 1', 'oracle @ORC@', 'op f', '  input t? string', 'req A "a"', '  example f {}',
              '    input t from "data/t.txt"', '    expect result = {"t": "hello,\\r\\nworld"}')
        files = {'sub/s.duramen': t, 'sub/data/t.txt': 'hello,\r\nworld',
                 'sub/echo.mjs': ECHO['echo.mjs'], 'sub/echo.py': ECHO['echo.py']}
        self.assertEqual(diags(files), [])

    def test_sy012_tables(self):  # REQ-SY-012
        t = S('duramen 0.1', 'spec s 1', 'oracle @ORC@', 'op f', '  input x? json, y? json', 'req A "a"', '  table f',
              '    | x        | y | result.x | result.y ± 0.5 |', '    |----------|---|:--------:|----------------|',
              '    | "a\\|b"   |   | "a\\|b"   |                |', '    | 1        | 2 | ?        | 2.4            |')
        self.assertEqual(diags(with_echo({'s.duramen': t})), [])
        f = lambda *l: diags({'s.duramen': T(*HEAD, 'req A "a"', *l)})
        self.assertEqual(
            f('  table f', '  table f g', '    | x |', '    | 1 |', '  table f', '    | x |', '  table f',
              '    | x | result ± -1 |', '    | 1 | 2           |', '  table f', '    | x | result ± 0.5 |',
              '    | 1 | "2"          |', '  table f', '    | x | y |', '    | 1 |', '    | {  | 2 |', '    x | 1',
              '  table f', '    | x | |', '    | 1 | 2 |', '  table f', '    | x ± 1 |', '    | 1     |'),
            ['s.duramen:4: error P013', 's.duramen:5: error P013', 's.duramen:8: error P013', 's.duramen:11: error P010',
             's.duramen:15: error P010', 's.duramen:18: error P014', 's.duramen:19: error P009', 's.duramen:20: error P006',
             's.duramen:22: error P013', 's.duramen:25: error P010'])
        self.assertEqual(
            f('  table f g', '    | x |', '    | {bad |', '  table f', '   | x |', '    | 1 |', '  table f',
              '    | a.b | result |', '    | 1   | 2      |', '  table f', '    | x | result ± lots |',
              '    | 1 | "two"         |', '  table f', '    | x | result ± 1 2 | result.y+-0.5 |',
              '    | 1 | 2            | 3             |'),
            ['s.duramen:4: error P013', 's.duramen:7: error P013', 's.duramen:8: error P006', 's.duramen:11: error P013',
             's.duramen:14: error P010', 's.duramen:17: error P010'])
        t = S('duramen 0.1', 'spec s 1', 'oracle @ORC@', 'op f', '  input x? json', 'req A "a"', '  table f',
              '    |---|----------|', '    | x | result.x |', '    |   |', '    | 1 | 1', '    |', '    | 2 | 2        |')
        self.assertEqual(diags(with_echo({'s.duramen': t})), [])


class Checking(unittest.TestCase):
    def rec(self, *lines):
        return with_echo({'s.duramen': S('duramen 0.1', 'spec s 1', 'oracle @ORC@', *lines)})

    def test_ck001_example_required(self):  # REQ-CK-001
        self.assertEqual(diags({'s.duramen': T(*HEAD, 'req A "a"', '  text', '    It MUST work.')}),
                         ['s.duramen:3: error T001'])
        self.assertEqual(diags({'s.duramen': T(*HEAD, 'req A "a"', '  table f', '    | x |', '    |---|')}),
                         ['s.duramen:4: error P013'])

    def test_ck002_unique_ids(self):  # REQ-CK-002
        files = self.rec('op f', '  input x? json', 'req A "a"', '  example f {}', 'req A "again"', '  example f {}',
                         'open A "an open item may share a requirement\'s ID"', '  text', '    Open.', 'open B "b"',
                         '  text', '    Open.', 'open B "b again"', '  text', '    Open.', 'decision D-1 "d"',
                         '  source s', 'decision D-1 "d again"', '  source s', 'req C "c"', '  decision D-1',
                         '  example f {}')
        self.assertEqual(diags(files), ['s.duramen:8: error T007', 's.duramen:16: error T007', 's.duramen:21: error T007'])
        files = with_echo({'a.duramen': S('duramen 0.1', 'spec s 1', 'oracle @ORC@', 'op f', '  input x? json',
                                          'req A "a"', '  example f {}'),
                           'b.duramen': T('duramen 0.1', 'req A "a"', '  example f {}', 'op f', '  input y? json')})
        self.assertEqual(diags(files), ['b.duramen:2: error T007', 'b.duramen:4: error T007'])

    def test_ck003_decisions_declared(self):  # REQ-CK-003
        files = self.rec('op f', '  input x? json', 'decision D-1 "d"', '  source s', 'req A "a"',
                         '  decision D-1 D-2, D-3', '  decision D-2', '  example f {}')
        self.assertEqual(diags(files), ['s.duramen:8: error T008', 's.duramen:8: error T008'])

    def test_ck004_declared_ops(self):  # REQ-CK-004
        files = self.rec('op f', '  input a number, b? number', 'errors', '  e when never', 'req A "a"',
                         '  example g {"a": 1}', '  example f {"b": 1}', '  example f {"a": 1, "c": 2}', '  example f',
                         '  example g {"answer": {"error": "e"}}', '    expect error = "e"',
                         '  example raw \'{"id": "A#6", "op": "g"}\'', '  table f', '    | b | c |', '    | 1 | 2 |',
                         '  example g {}', '    expect error.code = "e"')
        self.assertEqual(diags(files), ['s.duramen:9: error T009', 's.duramen:10: error T010',
                                        's.duramen:11: warning T011', 's.duramen:12: error T010',
                                        's.duramen:18: error T010', 's.duramen:18: warning T011',
                                        's.duramen:19: error T009'])

    def test_ck005_expected_errors(self):  # REQ-CK-005
        files = self.rec('op f', '  input answer? json', 'errors', '  e when never', 'req A "a"',
                         '  example f {"answer": {"error": "e"}}', '    expect error = "e"',
                         '  example f {"answer": {"error": "nope"}}', '    expect error = "nope"',
                         '  example raw \'{"id": "r", "op": "f", "input": {"answer": {"error": "other"}}}\'',
                         '    expect error = "other"', '  example f {"answer": {"error": "e"}}', '    expect error = ?')
        self.assertEqual(diags(files), ['s.duramen:12: error T023', 's.duramen:14: error T023'])

    def test_ck006_obligations(self):  # REQ-CK-006
        t = T(*HEAD, '  text', '    The program MUST work.', 'op f', '  result what it MUST return', 'errors',
              '  e when it SHALL fail', 'section S "It MUST be titled"', '  text', '    REQUIRED reading.', 'note', '  text',
              '    This note says `MUST`, "SHALL" and “REQUIRED”, MUSTARD and must.', 'decision D-1 "d"',
              '  source s', '  text', '    Fine.', '  rejected "Another MUST."', 'open O "o"', '  text', '    It MUST NOT be.')
        self.assertEqual(diags({'s.duramen': t}), ['s.duramen:2: error T004', 's.duramen:5: error T004',
                                                   's.duramen:8: error T004', 's.duramen:9: error T004',
                                                   's.duramen:15: error T004', 's.duramen:15: warning T012',
                                                   's.duramen:20: warning T014'])
        t = T(*HEAD, 'decision D-1 "d"', '  source s', '  text', '    It MUST.', '  rejected "It SHALL."',
              '  rejected "It is REQUIRED."')
        self.assertEqual(diags({'s.duramen': t}), ['s.duramen:3: error T004'] * 3 + ['s.duramen:3: warning T012'])
        t = T(*HEAD, 'errors', '  e when the "MUST', '    hold" rule fails', '  f when the "MUST hold" rule fails',
              'note', '  text', '    A MUST-have.')
        self.assertEqual(diags({'s.duramen': t}), ['s.duramen:4: error T004', 's.duramen:7: error T004'])

    def test_ck007_open_items(self):  # REQ-CK-007
        t = T(*HEAD, 'open O "o"', '  example f {}', '  table f', '    | x |', '    | 1 |', '  example f {not json',
              '    expect nothing at all', '  table g h', '    | {bad |')
        self.assertEqual(diags({'s.duramen': t}), ['s.duramen:4: error T003', 's.duramen:5: error T003',
                                                   's.duramen:8: error T003', 's.duramen:10: error T003'])

    def test_ck008_order_stated_once(self):  # REQ-CK-008
        files = self.rec('op f', '  input x? json', 'errors', '  too_big when x > 9', '  too_small when x < 0',
                         'req A "a"', '  text', '    A request that is too_big gets too_big, and one too_small gets too_small.',
                         '  example f {}', 'req B "b"', '  text', '    too_big is checked Before too_small.',
                         '  example f {}', 'req C "c"', '  text', '    too_big is checked first.', '    After that, nothing.',
                         '  example f {}')
        self.assertEqual(diags(files), ['s.duramen:14: error T005'])
        files = self.rec('op f', '  input x? json', 'errors', '  e when x', '  f when y', 'req A "a"', '  text',
                         '    A request may be refused before it is read: see the errors list.', '  example f {}')
        self.assertEqual(diags(files), [])

    def test_ck009_decisions(self):  # REQ-CK-009
        files = self.rec(
            'op f', '  input x? json', 'decision D-1 "uncited, no source"', 'decision D-2 "bad status"', '  source s',
            '  status Accepted', 'decision D-3 "superseded by nothing"', '  source s', '  status superseded',
            'decision D-4 "superseded by an undeclared one"', '  source s', '  status superseded by D-9',
            'decision D-5 "superseded properly"', '  source s', '  status superseded by D-6',
            'decision D-6 "accepted, with more words"', '  source s', '  status accepted on 2026-01-01',
            'decision D-7 "observed"', '  source s', '  status observed', 'req A "a"',
            '  decision D-2, D-3, D-4, D-5, D-6, D-7', '  example f {}')
        self.assertEqual(diags(files), ['s.duramen:6: warning T012', 's.duramen:6: warning T013', 's.duramen:7: error T027',
                                        's.duramen:10: error T027', 's.duramen:13: error T027'] +
                         ['s.duramen:25: error T028'] * 3 + ['s.duramen:25: warning T028'])
        files = self.rec('op f', '  input x? json', 'decision D-1 "a comma after the word"', '  source s',
                         '  status accepted, 2026-01-01', 'decision D-2 "an empty status"', '  source', '  status',
                         'req A "a"', '  decision D-1, D-2', '  example f {}')
        self.assertEqual(diags(files), ['s.duramen:6: error T027', 's.duramen:9: warning T013', 's.duramen:9: error T027'])


class Oracle(unittest.TestCase):
    def rec(self, *lines, head=('oracle @ORC@',)):
        return with_echo({'s.duramen': S('duramen 0.1', 'spec s 1', *head, *lines)})

    def test_or001_oracle_required(self):  # REQ-OR-001
        t = T(*HEAD, 'op f', '  input x? json', 'req A "a"', '  example f {}', '    expect result = 1')
        self.assertEqual(diags({'s.duramen': t}), ['s.duramen:2: error T019'])
        t = T(*HEAD, 'op f', '  input x? json', 'req A "a"', '  text', '    No example.', 'req B "b"', '  example f {}')
        self.assertEqual(diags({'s.duramen': t}), ['s.duramen:2: error T019', 's.duramen:5: error T001'])

    def test_or002_how_run(self):  # REQ-OR-002
        files = self.rec('op f', '  input line? boolean, x? json', 'req A "a"', '  example f {"line": true,  "x": 2.50}',
                         '    expect result = "{\\"id\\":\\"A#1\\",\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true,  \\"x\\": 2.50}}"',
                         '  example f {"line": true}', '    omit id',
                         '    expect result = "{\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true}}"',
                         '  example raw \'{"id": "x",  "op": "f", "input": {"line": true}}\'', '    expect id = "x"',
                         '    expect result = "{\\"id\\": \\"x\\",  \\"op\\": \\"f\\",  \\"input\\": {\\"line\\": true}}"'.replace('f\\",  \\"input', 'f\\", \\"input'),
                         head=('  request {"clock": 1}', 'oracle @ORC@'))
        # the spec's example puts the request under the spec; build that record by hand
        t = S('duramen 0.1', 'spec s 1', '  request {"clock": 1}', 'oracle @ORC@', 'op f',
              '  input line? boolean, x? json', 'req A "a"', '  example f {"line": true,  "x": 2.50}',
              '    expect result = "{\\"id\\":\\"A#1\\",\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true,  \\"x\\": 2.50}}"',
              '  example f {"line": true}', '    omit id',
              '    expect result = "{\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true}}"',
              '  example raw \'{"id": "x",  "op": "f", "input": {"line": true}}\'', '    expect id = "x"',
              '    expect result = "{\\"id\\": \\"x\\",  \\"op\\": \\"f\\", \\"input\\": {\\"line\\": true}}"')
        self.assertEqual(diags(with_echo({'s.duramen': t})), [])
        t = S('duramen 0.1', 'spec s 1', 'oracle %s' % ORC.replace('echo', 'my echo').replace('node ', 'node "').replace(
            '.mjs', '.mjs"') if ORC.startswith('node') else 'oracle x', 'op f')
        files = {'sub/s.duramen': S('duramen 0.1', 'spec s 1', 'oracle ' + ORC.replace('echo.mjs', '"my echo.mjs"').replace(
            'echo.py', 'echo.py'), 'op f', '  input x? json', 'req A "a"', '  example f {"x": 1}', '    expect result.x = 1'),
            'sub/my echo.mjs': ECHO['echo.mjs'], 'sub/echo.py': ECHO['echo.py']}
        self.assertEqual(diags(files), [])
        files = self.rec('op f', '  input x? json', 'req A "a"', '  text', '    No example.', 'req B "b"',
                         '  example f {"x": 1}', '    expect result.x = 2')
        self.assertEqual(diags(files), ['s.duramen:6: error T001', 's.duramen:11: error T002'])

    def test_or003_disagreement(self):  # REQ-OR-003
        files = self.rec(
            'op f', '  input x? json, y? json, answer? json', 'req A "a"', '  example f {"x": 1.0, "y": [5, {"z": null}]}',
            '    expect result = {"y": [5, {"z": null}], "x": 1}', '    expect result.y.1.z = null',
            '    expect result.y.0 ≈ 5.5 ± 0.5', '    expect result.x = 2', '    expect result.y.2 = 5',
            '    expect result.y.0 ≈ 5.5 ± 0.4', '    expect result.y.1 = {}',
            '  example f {"answer": {"result": 0, "audit": "{\\"a\\": [1, 2]}"}}', '    expect audit.a.1 = 2',
            '    expect audit = "{\\"a\\": [1, 2]}"', '    expect audit.b = 1', '  table f',
            '    | x | result.x | result.y |', '    | 1 | 2        | 3        |', '  example f {"x": {"": 1}}',
            '    expect result.x. = 1', '    expect result..x = 1', '  example f {"y": [7, 8]}', '    expect result.y.1 = 8',
            '    expect result.y.length = 2', '    expect result.y.01 = 8')
        self.assertEqual(diags(files), [('s.duramen:%d: error T002' % n) for n in (11, 12, 13, 14, 18, 21, 21, 24, 27, 28)])
        files = self.rec('op f', '  input answer? json', 'errors', '  e when never', 'req A "a"',
                         '  example f {"answer": {"result": 1}}', '    expect error = "e"',
                         '  example g {"answer": {"error": "e"}}', '    expect error = "e"')
        self.assertEqual(diags(files), ['s.duramen:10: error T002'])

    def test_or004_failures(self):  # REQ-OR-004
        t = T(*HEAD, 'oracle no-such-program-for-duramen', 'op f', '  input x? json', 'req A "a"', '  example f {}')
        self.assertEqual(diags({'s.duramen': t}), ['s.duramen:3: error T020', 's.duramen:7: error T021'])
        files = self.rec('op f', '  input x? json, exit? integer', 'req A "a"', '  example f {"x": 1}',
                         '    expect result.x = 2', '  example f {"exit": 3}', '    expect result.exit = 3')
        self.assertEqual(diags(files), ['s.duramen:3: error T020', 's.duramen:8: error T002'])
        files = self.rec('op f', '  input exit? integer', 'req A "a"', '  example f {}',
                         '  example raw \'{"id": "r", "op": "f", "input": {"exit": 4}}\'')
        self.assertEqual(diags(files), ['s.duramen:8: error T020'])
        t = T(*HEAD, 'oracle no-such-program-for-duramen', 'op f', '  input x? json', 'req A "a"',
              '  example raw \'{"id": "r", "op": "f"}\'')
        self.assertEqual(diags({'s.duramen': t}), ['s.duramen:7: error T020', 's.duramen:7: error T021'])
        t = T(*HEAD, 'oracle node "echo.mjs', 'op f', '  input x? json', 'req A "a"', '  example f {}')
        self.assertEqual(diags(with_echo({'s.duramen': t})), ['s.duramen:3: error T020', 's.duramen:7: error T021'])

    def test_or005_no_answer(self):  # REQ-OR-005
        files = self.rec('op f', '  input silent? boolean', 'req A "a"', '  example f {"silent": true}', '  example f {}',
                         '  example raw \'{"id": "r", "op": "f", "input": {"silent": true}}\'')
        self.assertEqual(diags(files), ['s.duramen:7: error T021', 's.duramen:9: error T021'])

    def test_or006_oracle_error(self):  # REQ-OR-006
        files = self.rec('op f', '  input answer? json', 'req A "a"', '  example f {"answer": {"oracle_error": "left open"}}',
                         '    expect result = 1', '    expect result = ?')
        self.assertEqual(diags(files), ['s.duramen:7: error T022'])

    def test_or007_unexpected_errors(self):  # REQ-OR-007
        files = self.rec('op f', '  input answer? json', 'errors', '  e when never', 'req A "a"',
                         '  example f {"answer": {"error": "e"}}', '  example f {"answer": {"error": "e"}}',
                         '    expect error = "e"')
        r = call('check', files)
        self.assertEqual(r['result'], {'diagnostics': ['s.duramen:9: warning T024'], 'errors': 0, 'warnings': 1})

    def test_or008_oracle_values(self):  # REQ-OR-008
        files = self.rec('op f', '  input x? json', 'req A "a"', '  example f {"x": 1}', '    expect result.x = ?',
                         '    expect result.y = ?')
        self.assertEqual(diags(files), ['s.duramen:9: error T025'])


class Suite(unittest.TestCase):
    def rec(self, *lines):
        return with_echo({'s.duramen': S('duramen 0.1', 'spec s 1', 'oracle @ORC@', *lines)})

    def test_su001_no_suite_with_errors(self):  # REQ-SU-001
        self.assertEqual(call('cases', {'s.duramen': 'frobnicate\n'})['result'], {'cases': [], 'errors': 3})
        t = T(*HEAD, 'req A "a"', '  text', '    Nothing to show.')
        self.assertEqual(call('cases', {'s.duramen': t})['result'], {'cases': [], 'errors': 1})
        r = call('cases', self.rec('op f', '  input x? json', 'req A "a"', '  example f {"y": 1}'))['result']
        self.assertEqual(r['errors'], 0)
        self.assertEqual(r['cases'][0]['id'], 'A#1')

    def test_su002_one_case_per_example(self):  # REQ-SU-002
        r = call('cases', self.rec('op f', '  input x? json', 'req A "a"', '  example f {"x": 1}', '    expect result.x = 1',
                                   'req B "b"', '  on posix', '  table f', '    | x | result.x |', '    | 2 | 2        |',
                                   '    | 3 | ?        |'))['result']
        self.assertEqual(r, {'cases': [
            {'checks': [{'kind': 'eq', 'path': 'result.x', 'value': 1}],
             'full': {'members': ['id', 'result'], 'result': {'x': 1}, 'tolerances': {}}, 'id': 'A#1', 'kind': 'example',
             'line': '{"id":"A#1","op":"f","input":{"x": 1}}', 'platform': 'any', 'reqs': ['REQ-A']},
            {'checks': [{'kind': 'eq', 'path': 'result.x', 'value': 2}],
             'full': {'members': ['id', 'result'], 'result': {'x': 2}, 'tolerances': {}}, 'id': 'B#1', 'kind': 'example',
             'line': '{"id":"B#1","op":"f","input":{"x":2}}', 'platform': 'posix', 'reqs': ['REQ-B']},
            {'checks': [{'from': 'oracle', 'kind': 'eq', 'path': 'result.x', 'value': 3}],
             'full': {'members': ['id', 'result'], 'result': {'x': 3}, 'tolerances': {}}, 'id': 'B#2', 'kind': 'example',
             'line': '{"id":"B#2","op":"f","input":{"x":3}}', 'platform': 'posix', 'reqs': ['REQ-B']}], 'errors': 0})
        files = with_echo({'b.duramen': T('duramen 0.1', 'req B "b"', '  on windows', '  example f {}'),
                           'a.duramen': S('duramen 0.1', 'spec s 1', 'oracle @ORC@', 'op f', '  input x? json', 'req A "a"',
                                          '  example f {}', '  example f {}')})
        r = call('cases', files)['result']['cases']
        self.assertEqual([c['id'] for c in r], ['A#1', 'A#2', 'B#1'])
        self.assertEqual(r[2]['platform'], 'windows')

    def test_su003_request_lines(self):  # REQ-SU-003
        t = S('duramen 0.1', 'spec s 1', '  request {"clock": "c", "trace": true}', 'oracle @ORC@', 'op f',
              '  input x? json', 'op g', '  input x? json', '  request {"mode": 2}', 'req A "a"',
              '  example f {"x" : 2.50e0 }', '  example f', '  example f {"x": 1}',
              '    request {"trace": false, "user": "u"}', '    omit clock', '  example g {"x": 1}', '    omit id, input',
              '  example f {"x": 1}', '    omit op, id', '  example raw \'{"id": "A#6",  "op": "f"}\'',
              '  example f {"x": 1}', '    request {"b": {"z": 1, "10": 2, "9": 3}, "2": "two", "a": 1}',
              '    omit clock', '    omit trace', '  table f', '    | result |', '    | ?      |')
        cs = call('cases', with_echo({'s.duramen': t}))['result']['cases']
        self.assertEqual(cs[0], {'checks': [], 'full': {'members': ['id', 'result'], 'result': {'x': 2.5}, 'tolerances': {}},
                                 'id': 'A#1', 'kind': 'example',
                                 'line': '{"id":"A#1","op":"f","clock":"c","trace":true,"input":{"x" : 2.50e0 }}',
                                 'platform': 'any', 'reqs': ['REQ-A']})
        self.assertEqual(cs[1]['line'], '{"id":"A#2","op":"f","clock":"c","trace":true}')
        self.assertEqual(cs[2]['line'], '{"id":"A#3","op":"f","trace":false,"user":"u","input":{"x": 1}}')
        self.assertEqual(cs[3], {'checks': [], 'full': {'members': ['id', 'result'], 'result': {}, 'tolerances': {}},
                                 'id': 'A#4', 'kind': 'example', 'line': '{"op":"g","mode":2}', 'platform': 'any',
                                 'reqs': ['REQ-A'], 'solo': True})
        self.assertEqual(cs[4]['line'], '{"clock":"c","trace":true,"input":{"x": 1}}')
        self.assertTrue(cs[4]['solo'])
        self.assertEqual(cs[5]['line'], '{"id": "A#6",  "op": "f"}')
        self.assertTrue(cs[5]['solo'])
        self.assertEqual(cs[6]['line'], '{"id":"A#7","op":"f","2":"two","b":{"9":3,"10":2,"z":1},"a":1,"input":{"x": 1}}')
        self.assertEqual(cs[7]['line'], '{"id":"A#8","op":"f","clock":"c","trace":true,"input":{}}')
        t = S('duramen 0.1', 'spec s 1', 'oracle @ORC@', 'op f', '  input files? object, n? number', 'req A "a"',
              '  example f {"n" : 1.50, "files": {"z": "old"}}', '    input files."a.duramen"', '      duramen 0.1',
              '      "quoted" é', '    input files.z', '      new', '  table f', '    | n      | files |',
              '    | 1.50   |       |', '    |        | {}    |')
        cs = call('cases', with_echo({'s.duramen': t}))['result']['cases']
        self.assertEqual(cs[0]['line'], '{"id":"A#1","op":"f","input":{"n":1.5,"files":{"z":"new\\n",'
                                        '"a.duramen":"duramen 0.1\\n\\"quoted\\" é\\n"}}}')
        self.assertEqual(cs[1]['line'], '{"id":"A#2","op":"f","input":{"n":1.50}}')
        self.assertEqual(cs[2]['line'], '{"id":"A#3","op":"f","input":{"files":{}}}')

    def test_su004_checks(self):  # REQ-SU-004
        r = call('cases', self.rec('op f', '  input x? json', 'req A "a"', '  example f {"x": {"y": [1, 2]}}',
                                   '    expect result.x.y.0 = 1', '    expect result.x.y.1 ~ 2.1 +- 0.25',
                                   '    expect result.x = ?', '    expect id = "A#1"', '  table f',
                                   '    | x | result.x ± 0.5 |', '    | 2 | 2.25           |'))['result']['cases']
        self.assertEqual(r[0]['checks'], [{'kind': 'eq', 'path': 'result.x.y.0', 'value': 1},
                                          {'kind': 'approx', 'path': 'result.x.y.1', 'tol': 0.25, 'value': 2.1},
                                          {'from': 'oracle', 'kind': 'eq', 'path': 'result.x', 'value': {'y': [1, 2]}},
                                          {'kind': 'eq', 'path': 'id', 'value': 'A#1'}])
        self.assertEqual(r[1]['checks'], [{'kind': 'approx', 'path': 'result.x', 'tol': 0.5, 'value': 2.25}])

    def test_su005_full(self):  # REQ-SU-005
        r = call('cases', self.rec(
            'op f', '  input answer? json', '  audit', '  tolerance result.t 0.5', '  tolerance result.u 0', 'op g',
            '  input answer? json', 'errors', '  e when never', 'req A "a"',
            '  example f {"answer": {"result": {"t": 1}, "audit": "A"}}',
            '  example f {"answer": {"error": "e", "extra": 1}}', '    expect error = "e"',
            '  example g {"answer": {"result": 2, "audit": "B"}}', '  example h {"answer": {"error": "e"}}',
            '    expect error = "e"'))['result']['cases']
        tol = {'result.t': 0.5, 'result.u': 0}
        self.assertEqual(r[0]['full'], {'audit': 'A', 'members': ['audit', 'id', 'result'], 'result': {'t': 1}, 'tolerances': tol})
        self.assertEqual(r[1]['full'], {'error': 'e', 'members': ['error', 'extra', 'id'], 'tolerances': tol})
        self.assertEqual(r[2]['full'], {'members': ['audit', 'id', 'result'], 'result': 2, 'tolerances': {}})
        self.assertEqual(r[3]['full'], {'error': 'e', 'members': ['error', 'id'], 'tolerances': {}})


class Driver(unittest.TestCase):
    def test_driver_protocol(self):  # Driver protocol
        a = {'a.duramen': 'duramen 0.1\nspec a 1\n'}
        lines = [json.dumps({'id': '1', 'op': 'check', 'input': {'files': a}}), '', '   \t', '{bad',
                 json.dumps({'id': '2', 'op': 'cases', 'input': {'files': a}})]
        p = subprocess.run([sys.executable, os.path.join(HERE, 'driver.py')], input=('\n'.join(lines) + '\n').encode(),
                           capture_output=True, cwd=HERE)
        self.assertEqual(p.returncode, 0)
        self.assertNotIn(b'\r', p.stdout)
        out = [json.loads(l) for l in p.stdout.decode('utf-8').split('\n') if l]
        self.assertEqual(out, [{'id': '1', 'result': {'diagnostics': [], 'errors': 0, 'warnings': 0}},
                               {'id': None, 'error': 'bad_request'},
                               {'id': '2', 'result': {'errors': 0, 'cases': []}}])

    def test_regen_json(self):
        with open(os.path.join(HERE, 'REGEN.json')) as f:
            cfg = json.load(f)
        self.assertIn('default', cfg['driver'])


class Units(unittest.TestCase):
    def test_js_numbers(self):
        from jsutil import js_num
        for x, s in [(1.0, '1'), (2.5, '2.5'), (1e21, '1e+21'), (1e-7, '1e-7'), (123456789012345680000.0, '123456789012345680000'),
                     (0.000001, '0.000001'), (-0.0, '0'), (1.5e300, '1.5e+300'), (-2.0, '-2')]:
            self.assertEqual(js_num(x), s)

    def test_split_command(self):
        self.assertEqual(core.split_command('node "my echo.mjs" a"b c"d \'x y\' ""'), ['node', 'my echo.mjs', 'ab cd', 'x y', ''])
        self.assertIsNone(core.split_command('node "echo.mjs'))


if __name__ == '__main__':
    unittest.main()
