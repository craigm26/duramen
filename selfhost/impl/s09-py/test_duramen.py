"""Hand-written tests: at least one for every MUST of SPEC.md, plus the driver protocol."""
import json
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import driver  # noqa: E402
from jsutil import js_num, js_stringify  # noqa: E402

HEAD = 'duramen 0.1\nspec s 1\n'
ECHO = """import { createInterface } from 'node:readline';
for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === '') continue;
  const req = JSON.parse(line);
  const input = req.input && typeof req.input === 'object' ? req.input : {};
  if (input.silent === true) continue;
  console.log(JSON.stringify({ id: req.id ?? null, ...(input.answer ?? { result: input }) }));
}
"""


def call(op, inp=None, **extra):
    req = {'id': 'x', 'op': op}
    if inp is not None:
        req['input'] = inp
    req.update(extra)
    return json.loads(js_stringify(driver.respond(json.dumps(req))))


def diags(files, entry=None, op='check'):
    inp = {'files': files}
    if entry is not None:
        inp['entry'] = entry
    return call(op, inp)['result']['diagnostics']


def one(text):
    return diags({'s.duramen': text})


def with_oracle(body, extra=None):
    files = {'s.duramen': HEAD + 'oracle node echo.mjs\n' + body, 'echo.mjs': ECHO}
    files.update(extra or {})
    return files


class Requests(unittest.TestCase):
    def test_rq001_files_and_entry(self):
        files = {'a.duramen': HEAD, 'b.duramen': 'frobnicate\n'}
        self.assertEqual(diags(files, 'a.duramen'), [])
        self.assertEqual(diags(files), ['b.duramen:1: error P002', 'b.duramen:1: error P020'])
        self.assertEqual(diags(files, '.'), diags(files))

    def test_rq002_errors(self):
        good = {'files': {'a.duramen': HEAD}}
        cases = [
            ('{not json', None, 'bad_request'),
            ('[1, 2]', None, 'bad_request'),
            (json.dumps({'op': 'check', 'input': good}), None, 'bad_request'),
            (json.dumps({'id': 7, 'op': 'check', 'input': good}), None, 'bad_request'),
            (json.dumps({'id': 'i', 'op': 'lint', 'input': good}), 'i', 'unknown_op'),
            (json.dumps({'id': 'i', 'op': 'lint'}), 'i', 'unknown_op'),
            (json.dumps({'id': 'i', 'op': 'check'}), 'i', 'bad_request'),
        ]
        for name in ['../a', '/a', 'x/./a', 'x//a', 'c:a', 'a\\b', 'a\0b', '']:
            cases.append((json.dumps({'id': 'i', 'op': 'check', 'input': {'files': {name: 'x'}}}),
                          'i', 'bad_request'))
        for files in [{}, ['a'], {'a': 1}, {'a': 'x', 'a/b': 'y'}]:
            cases.append((json.dumps({'id': 'i', 'op': 'cases', 'input': {'files': files}}),
                          'i', 'bad_request'))
        for entry in ['../a.duramen', 1, '', None]:
            cases.append((json.dumps({'id': 'i', 'op': 'check',
                                      'input': dict(good, entry=entry)}), 'i', 'bad_request'))
        for line, rid, code in cases:
            self.assertEqual(json.loads(js_stringify(driver.respond(line))),
                             {'id': rid, 'error': code}, line)


class Records(unittest.TestCase):
    def test_rc001_record_files(self):
        files = {'a.duramen': HEAD, 'notes.md': 'x', 'build/x.duramen': 'frob',
                 'sub/build/x.duramen': 'frob', 'node_modules/x.duramen': 'frob',
                 '.hidden.duramen': 'frob', 'sub/.hidden/x.duramen': 'frob',
                 'sub/b.duramen': 'duramen 0.1\n'}
        self.assertEqual(diags(files), [])
        self.assertEqual(diags({'notes.md': HEAD, 'a.duramen': 'frob'}, 'notes.md'), [])
        self.assertEqual(diags({'sub/a.duramen': HEAD, 'c.duramen': 'frob'}, 'sub'), [])
        self.assertEqual(diags({'a.duramen': HEAD}, 'missing.duramen'),
                         ['missing.duramen:1: error P046'])
        self.assertEqual(diags({'a.duramen': HEAD}, 'sub'), ['sub:1: error P046'])
        self.assertEqual(diags({'notes.md': HEAD}), ['.:1: error P046'])

    def test_rc002_file_order(self):
        files = {'b.duramen': 'duramen 0.1\nspec b 1\n', 'a.duramen': 'duramen 0.1\nspec a 1\n'}
        self.assertEqual(diags(files), ['b.duramen:2: error P044'])
        files = {'｡.duramen': 'duramen 0.1\nspec x 1\n',
                 '\U0001F600.duramen': 'duramen 0.1\nspec y 1\n'}
        self.assertEqual(diags(files), ['｡.duramen:2: error P044'])

    def test_rc003_versions(self):
        self.assertEqual(one('spec s 1\n'), ['s.duramen:1: error P020'])
        self.assertEqual(one('duramen 0.3\nspec s 1\n'), ['s.duramen:1: error P023'])
        self.assertEqual(one('duramen 0.1\nspec s 1\nduramen 0.1\nduramen 9\n'),
                         ['s.duramen:3: error P023', 's.duramen:4: error P023'])
        self.assertEqual(diags({'a.duramen': HEAD, 'b.duramen': 'duramen 0.2\n'}),
                         ['.:1: error P047'])

    def test_rc004_one_spec(self):
        self.assertEqual(one('duramen 0.1\n'), ['.:1: error P021'])
        self.assertEqual(one('duramen 0.1\nspec a 1\nspec b 1\n'), ['s.duramen:3: error P044'])
        self.assertEqual(one('duramen 0.1\nspec s 1\noracle a\noracle b\n'),
                         ['s.duramen:4: error P044'])
        self.assertEqual(one('duramen 0.1\nspec s 1\nerrors\nerrors\n'), ['s.duramen:4: error P032'])

    def test_rc005_reading_stops_check(self):
        self.assertEqual(one(HEAD + 'frobnicate\nreq A "a"\n  example nope {}\n'),
                         ['s.duramen:3: error P002'])

    def test_rc006_order_and_counts(self):
        r = call('check', {'files': {'b.duramen': 'frobnicate\nduramen 0.1\n',
                                     'a.duramen': HEAD + '\n\nfrobnicate\nfrobnicate\n'}})['result']
        self.assertEqual(r['diagnostics'], ['a.duramen:5: error P002', 'a.duramen:6: error P002',
                                            'b.duramen:1: error P002'])
        self.assertEqual((r['errors'], r['warnings']), (3, 0))
        r = call('check', {'files': {'s.duramen': HEAD + '\ndecision D-1 "one"\n'}})['result']
        self.assertEqual(r['diagnostics'], ['s.duramen:4: warning T012', 's.duramen:4: warning T013'])
        self.assertEqual((r['errors'], r['warnings']), (0, 2))


class Syntax(unittest.TestCase):
    def test_sy001_lines(self):
        self.assertEqual(one('﻿duramen 0.1\r\nspec s 1\rnote  \n  text\t\n    Some.  \r\n'), [])
        self.assertEqual(one(HEAD + '\tnote\n'), ['s.duramen:3: error P001'])
        self.assertEqual(one(HEAD + ' note\n'), ['s.duramen:3: error P001'])
        self.assertEqual(one('  \t \nduramen 0.1\n\t\nspec s 1\n   \n'), [])

    def test_sy002_statements(self):
        self.assertEqual(one('# c\nduramen 0.1\n#c\nspec s 1\nfrob this\n  title "x"\nNote\n'),
                         ['s.duramen:5: error P002', 's.duramen:7: error P002'])
        self.assertEqual(one('  x\n # y\nduramen 0.1\nspec s 1\n'),
                         ['s.duramen:1: error P003', 's.duramen:2: error P003'])

    def test_sy003_clauses(self):
        self.assertEqual(one(HEAD + 'note\n # x\n    # y\n  text\n    T.\n'),
                         ['s.duramen:4: error P007', 's.duramen:5: error P006'])
        self.assertEqual(one(HEAD + '  colour blue\n    more\n'), ['s.duramen:3: error P015'])
        self.assertEqual(one(HEAD + '  title "a"\n  title "b"\n    more\n'),
                         ['s.duramen:4: error P052'])
        self.assertEqual(one(HEAD + '  title "A"\n    goes on\n'), ['s.duramen:4: error P006'])

    def test_sy004_spec_oracle(self):
        self.assertEqual(one('duramen 0.1\nspec s\n'), ['s.duramen:2: error P021'])
        self.assertEqual(one('duramen 0.1\nspec s 1 2\n'), ['s.duramen:2: error P021'])
        self.assertEqual(one('duramen 0.1\nspec s 1.0\n  title "T"\n  contract c-2\n'
                             '  request {"a": 1}\n  text\n    What.\n'), [])
        self.assertEqual(one(HEAD + '  request {"op": "x"}\n'), ['s.duramen:3: error P051'])
        self.assertEqual(one(HEAD + '  request [1]\n'), ['s.duramen:3: error P009'])
        self.assertEqual(one(HEAD + 'oracle\n'), ['s.duramen:3: error P028'])
        self.assertEqual(one(HEAD + 'oracle node m\n  source a, b\n  timeout 5\n'),
                         ['s.duramen:5: error P015'])

    def test_sy005_text(self):
        self.assertEqual(one(HEAD + 'note\n  text Here.\n'), ['s.duramen:4: error P008'])
        self.assertEqual(one(HEAD + 'note\n  text\n    One.\n   Two.\n'),
                         ['s.duramen:6: error P008'])
        self.assertEqual(one(HEAD + 'note\n  text\n    # It MUST be text.\n'),
                         ['s.duramen:3: error T004'])

    def test_sy006_quoted(self):
        self.assertEqual(one(HEAD + 'section S A title\n'), ['s.duramen:3: error P005'])
        self.assertEqual(one(HEAD + 'section S\n'), ['s.duramen:3: error P005'])
        self.assertEqual(one(HEAD + 'section S "unclosed\nsection T "A" "B"\nsection U "\n'),
                         ['s.duramen:3: error P005', 's.duramen:4: error P004',
                          's.duramen:5: error P005'])
        self.assertEqual(one(HEAD + '  title A title\n'), ['s.duramen:3: error P004'])
        self.assertEqual(one(HEAD + 'section S-1.x "A \\"q\\" é"\n'), [])

    def test_sy007_operations(self):
        self.assertEqual(one(HEAD + 'op f g\n'), ['s.duramen:3: error P031'])
        self.assertEqual(one(HEAD + 'op f\n  input a number, b? {x: number, y: string}, '
                             'c "one, two" | [1, 2], d-e (f, g)\n  result r\n  tolerance result.s 0.005\n'
                             '  audit text\n  request {}\n'), [])
        self.assertEqual(one(HEAD + 'op f\n  input a\n  input a.b number\n  input\n'
                             '  input c number, , d number,\n  input c number\n'),
                         ['s.duramen:4: error P017', 's.duramen:5: error P017',
                          's.duramen:6: error P017', 's.duramen:7: error P017',
                          's.duramen:7: error P017', 's.duramen:8: error P052'])
        self.assertEqual(one(HEAD + 'op f\n  tolerance r\n  tolerance r -1\n  tolerance r 1e-3\n'),
                         ['s.duramen:4: error P018', 's.duramen:5: error P018'])
        self.assertEqual(one(HEAD + 'op f\n  audit json\n'), ['s.duramen:4: error P050'])

    def test_sy008_errors_list(self):
        self.assertEqual(one(HEAD + 'errors\n  a when x or\n    when y\n  b when z\n'), [])
        self.assertEqual(one(HEAD + 'errors first\n  e when x\n'), ['s.duramen:3: error P050'])
        self.assertEqual(one(HEAD + 'errors\n  e if x\n  e when\n    bad\n  f when y\n   and z\n'),
                         ['s.duramen:4: error P019', 's.duramen:5: error P019',
                          's.duramen:8: error P006'])

    def test_sy009_statements(self):
        self.assertEqual(one(HEAD + 'req A "a"\n  on mac\n  status accepted\n  example f {}\n'
                             'note x\nsection S "s"\n  example f {}\ndecision D "d"\n  title "x"\n'
                             'open O "o"\n  decision D\n'),
                         ['s.duramen:4: error P033', 's.duramen:5: error P015',
                          's.duramen:7: error P050', 's.duramen:9: error P015',
                          's.duramen:11: error P015', 's.duramen:13: error P015'])

    def test_sy010_examples(self):
        self.assertEqual(one(HEAD + 'req A "a"\n  example\n  example f [1]\n  example f {"x": 1\n'
                             '  example f 2\n'),
                         ['s.duramen:4: error P012', 's.duramen:5: error P012',
                          's.duramen:6: error P009', 's.duramen:7: error P012'])
        self.assertEqual(one(HEAD + 'req A "a"\n  example raw\n  example raw {"id": "x"}\n'
                             '  example raw "a\\nb"\n'),
                         ['s.duramen:4: error P004', 's.duramen:5: error P004',
                          's.duramen:6: error P026'])
        self.assertEqual(one(HEAD + 'req A "a"\n  example f {}\n    expect result\n'
                             '    expect result ~ 1 +- x\n    expect result =\n    expect = 1\n'
                             '    request {"a": 1}\n    request {"b": 1}\n    omit\n'),
                         ['s.duramen:5: error P011', 's.duramen:6: error P010',
                          's.duramen:7: error P009', 's.duramen:8: error P011',
                          's.duramen:10: error P052', 's.duramen:11: error P011'])
        self.assertEqual(one(HEAD + 'req A "a"\n  example raw \'{"id": "x"}\'\n    omit\n'
                             '    request\n    input\n'),
                         ['s.duramen:5: error P022', 's.duramen:6: error P022',
                          's.duramen:7: error P022'])

    def test_sy011_input_blocks(self):
        self.assertEqual(one(HEAD + 'req A "a"\n  example f {"x": 1}\n    input files.\n'
                             '    input x.y\n      text\n    input z\n    input y from "nope"\n'),
                         ['s.duramen:5: error P049', 's.duramen:6: error P049',
                          's.duramen:8: error P049', 's.duramen:9: error P048'])
        self.assertEqual(diags({'r/s.duramen': HEAD + 'req A "a"\n  example f {}\n'
                                '    input a from "../o.txt"\n', 'o.txt': 'x'}, 'r'),
                         ['r/s.duramen:5: error P048'])

    def test_sy012_tables(self):
        self.assertEqual(one(HEAD + 'req A "a"\n  table f\n  table f g\n    | x |\n    | 1 |\n'
                             '  table f\n    | x | result ± -1 |\n    | 1 | 2 |\n'
                             '  table f\n    | x | y |\n    | 1 |\n    | { | 2 |\n'),
                         ['s.duramen:4: error P013', 's.duramen:5: error P013',
                          's.duramen:9: error P010', 's.duramen:13: error P014',
                          's.duramen:14: error P009'])
        self.assertEqual(one(HEAD + 'req A "a"\n  table f\n    | x | x |\n    | 1 | 2 |\n'),
                         ['s.duramen:5: error P013'])

    def test_sy013_big_numbers(self):
        self.assertEqual(one(HEAD + '  request {"x": 1e400}\n'), ['s.duramen:3: error P009'])
        self.assertEqual(one(HEAD + 'op f\n  tolerance r 1e400\n'), ['s.duramen:4: error P018'])
        self.assertEqual(one(HEAD + 'req A "a"\n  example f {}\n    expect r ≈ 1e400 ± 1\n'),
                         ['s.duramen:5: error P010'])


class Checks(unittest.TestCase):
    def test_ck001_example_required(self):
        self.assertEqual(one(HEAD + 'req A "a"\n  text\n    It works.\n'), ['s.duramen:3: error T001'])

    def test_ck002_unique_ids(self):
        body = ('op f\n  input x? json\nreq A "a"\n  example f {}\nreq A "b"\n  example f {}\n'
                'open A "o"\nopen B "b"\nopen B "b2"\ndecision D "d"\n  source s\n'
                'decision D "d2"\n  source s\nreq C "c"\n  decision D\n  example f {}\nop f\n')
        self.assertEqual(diags(with_oracle(body)),
                         ['s.duramen:8: error T007', 's.duramen:12: error T007',
                          's.duramen:15: error T007', 's.duramen:20: error T007'])

    def test_ck003_cited_decisions(self):
        body = ('op f\n  input x? json\ndecision D-1 "d"\n  source s\nreq A "a"\n'
                '  decision D-1 D-2, D-3\n  decision D-2\n  example f {}\n')
        self.assertEqual(diags(with_oracle(body)),
                         ['s.duramen:8: error T008', 's.duramen:8: error T008'])

    def test_ck004_declared_operations(self):
        body = ('op f\n  input a number, b? number\nreq A "a"\n  example g {"a": 1}\n'
                '  example f {"b": 1}\n  example f {"a": 1, "c": 2}\n')
        self.assertEqual(diags(with_oracle(body)),
                         ['s.duramen:7: error T009', 's.duramen:8: error T010',
                          's.duramen:9: warning T011'])

    def test_ck005_expected_errors(self):
        body = ('op f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n'
                '  example f {"answer": {"error": "e"}}\n    expect error = "e"\n'
                '  example f {"answer": {"error": "no"}}\n    expect error = "no"\n')
        self.assertEqual(diags(with_oracle(body)), ['s.duramen:12: error T023'])

    def test_ck006_obligations(self):
        text = (HEAD + '  text\n    The program MUST work.\nop f\n  result what it MUST return\n'
                'errors\n  e when it SHALL fail\nnote\n  text\n    Says `MUST`, "SHALL", MUSTARD.\n'
                'decision D-1 "d"\n  source s\n  rejected "Another MUST."\n'
                'open O "o"\n  text\n    It MUST NOT be.\n')
        self.assertEqual(one(text),
                         ['s.duramen:2: error T004', 's.duramen:5: error T004',
                          's.duramen:8: error T004', 's.duramen:12: error T004',
                          's.duramen:12: warning T012', 's.duramen:15: warning T014'])
        self.assertEqual(one(HEAD + 'note\n  text\n    A MUST-have.\n'), ['s.duramen:3: error T004'])

    def test_ck007_open_items(self):
        self.assertEqual(one(HEAD + 'open O "o"\n  example f {not json\n    junk\n  table g h\n'),
                         ['s.duramen:4: error T003', 's.duramen:6: error T003'])

    def test_ck008_order_stated_once(self):
        body = ('op f\n  input x? json\nerrors\n  too_big when x > 9\n  too_small when x < 0\n'
                'req A "a"\n  text\n    too_big is checked Before too_small.\n  example f {}\n'
                'req B "b"\n  text\n    too_big is checked first. After that, nothing.\n'
                '  example f {}\n')
        self.assertEqual(diags(with_oracle(body)), ['s.duramen:10: error T005'])

    def test_ck009_decisions(self):
        body = ('op f\n  input x? json\ndecision D-1 "u"\ndecision D-2 "bad"\n  source s\n'
                '  status Accepted\ndecision D-3 "o"\n  source s\n  status observed\n'
                'decision D-4 "s"\n  source s\n  status superseded by D-3\n'
                'decision D-5 "r"\n  source s\n  status rejected\n'
                'req A "a"\n  decision D-2, D-3, D-4, D-5\n  example f {}\n')
        got = diags(with_oracle(body))
        self.assertIn('s.duramen:6: warning T012', got)
        self.assertIn('s.duramen:6: warning T013', got)
        self.assertIn('s.duramen:7: error T027', got)
        self.assertEqual([d for d in got if 'T028' in d],
                         ['s.duramen:19: error T028', 's.duramen:19: error T028',
                          's.duramen:19: warning T028'])


class Oracle(unittest.TestCase):
    def test_or001_oracle_needed(self):
        self.assertEqual(one(HEAD + 'op f\n  input x? json\nreq A "a"\n  example f {}\n'),
                         ['s.duramen:2: error T019'])

    def test_or002_how_it_runs(self):
        body = ('op f\n  input x? json\nreq A "a"\n  example f {"x": 2.50}\n'
                '    expect result.x = 2.5\n  example raw \'{"id": "r", "op": "f"}\'\n'
                '    expect id = "r"\n')
        self.assertEqual(diags(with_oracle(body)), [])
        quoted = {'sub/s.duramen': HEAD + 'oracle node "my echo.mjs"\nop f\n  input x? json\n'
                  'req A "a"\n  example f {"x": 1}\n    expect result.x = 1\n',
                  'sub/my echo.mjs': ECHO}
        self.assertEqual(diags(quoted), [])

    def test_or003_disagreement(self):
        body = ('op f\n  input x? json, y? json\nreq A "a"\n  example f {"x": 1.0, "y": [5]}\n'
                '    expect result = {"y": [5], "x": 1}\n    expect result.x = 2\n'
                '    expect result.y.length = 1\n    expect result.y.0 ≈ 5.5 ± 0.4\n'
                '    expect result.y.0 ≈ 5.5 ± 0.5\n')
        self.assertEqual(diags(with_oracle(body)),
                         ['s.duramen:9: error T002', 's.duramen:10: error T002',
                          's.duramen:11: error T002'])

    def test_or004_oracle_fails(self):
        files = {'s.duramen': HEAD + 'oracle no-such-program-for-duramen\nop f\n  input x? json\n'
                 'req A "a"\n  example f {}\n'}
        self.assertEqual(diags(files), ['s.duramen:3: error T020', 's.duramen:7: error T021'])
        files = {'s.duramen': HEAD + 'oracle node "echo.mjs\nop f\n  input x? json\n'
                 'req A "a"\n  example f {}\n', 'echo.mjs': ECHO}
        self.assertEqual(diags(files), ['s.duramen:3: error T020', 's.duramen:7: error T021'])

    def test_or005_no_answer(self):
        body = ('op f\n  input silent? boolean\nreq A "a"\n  example f {"silent": true}\n'
                '  example f {}\n')
        self.assertEqual(diags(with_oracle(body)), ['s.duramen:7: error T021'])

    def test_or006_oracle_error(self):
        body = ('op f\n  input answer? json\nreq A "a"\n'
                '  example f {"answer": {"oracle_error": "open"}}\n    expect result = 1\n')
        self.assertEqual(diags(with_oracle(body)), ['s.duramen:7: error T022'])

    def test_or007_unexpected_errors(self):
        body = ('op f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n'
                '  example f {"answer": {"error": "e"}}\n')
        self.assertEqual(diags(with_oracle(body)), ['s.duramen:9: warning T024'])

    def test_or008_oracle_values(self):
        body = ('op f\n  input x? json\nreq A "a"\n  example f {"x": 1}\n'
                '    expect result.x = ?\n    expect result.y = ?\n')
        self.assertEqual(diags(with_oracle(body)), ['s.duramen:9: error T025'])


class Suite(unittest.TestCase):
    BODY = ('op f\n  input x? json\n  tolerance result.t 0.5\nreq A "a"\n  example f {"x": 1}\n'
            '    expect result.x = 1\n    expect result.x ≈ 1.2 ± 0.5\n    expect id = ?\n'
            'req B "b"\n  on posix\n  table f\n    | x | result.x |\n    | 2 | ? |\n'
            '  example raw \'{"id": "B#2", "op": "f"}\'\n')

    def cases(self, files):
        return call('cases', {'files': files})['result']

    def test_su001_no_suite_with_errors(self):
        self.assertEqual(self.cases({'s.duramen': 'frobnicate\n'}), {'cases': [], 'errors': 3})
        self.assertEqual(self.cases({'s.duramen': HEAD + 'req A "a"\n'}), {'cases': [], 'errors': 1})

    def test_su002_one_case_per_example(self):
        r = self.cases(with_oracle(self.BODY))
        self.assertEqual(r['errors'], 0)
        self.assertEqual([c['id'] for c in r['cases']], ['A#1', 'B#1', 'B#2'])
        c = r['cases'][1]
        self.assertEqual((c['kind'], c['reqs'], c['platform']), ('example', ['REQ-B'], 'posix'))
        self.assertNotIn('solo', c)
        self.assertTrue(r['cases'][2]['solo'])

    def test_su003_request_lines(self):
        files = {'s.duramen': 'duramen 0.1\nspec s 1\n  request {"clock": "c", "trace": true}\n'
                 'oracle node echo.mjs\nop f\n  input x? json\nop g\n  input x? json\n'
                 '  request {"mode": 2}\nreq A "a"\n  example f {"x" : 2.50e0 }\n  example f\n'
                 '  example f {"x": 1}\n    request {"trace": false, "user": "u"}\n'
                 '    omit clock\n  example g {"x": 1}\n    omit id, input\n'
                 '  example f {"x": 1}\n    request {"b": {"z": 1, "10": 2, "9": 3}, "2": "two"}\n'
                 '    omit clock\n    omit trace\n  example f {"n": 1.50}\n'
                 '    input files."a"\n      hi\n', 'echo.mjs': ECHO}
        lines = [c['line'] for c in self.cases(files)['cases']]
        self.assertEqual(lines, [
            '{"id":"A#1","op":"f","clock":"c","trace":true,"input":{"x" : 2.50e0 }}',
            '{"id":"A#2","op":"f","clock":"c","trace":true}',
            '{"id":"A#3","op":"f","trace":false,"user":"u","input":{"x": 1}}',
            '{"op":"g","mode":2}',
            '{"id":"A#5","op":"f","2":"two","b":{"9":3,"10":2,"z":1},"input":{"x": 1}}',
            '{"id":"A#6","op":"f","clock":"c","trace":true,"input":{"n":1.5,"files":{"a":"hi\\n"}}}'])

    def test_su004_checks(self):
        r = self.cases(with_oracle(self.BODY))
        self.assertEqual(r['cases'][0]['checks'], [
            {'kind': 'eq', 'path': 'result.x', 'value': 1},
            {'kind': 'approx', 'path': 'result.x', 'value': 1.2, 'tol': 0.5},
            {'kind': 'eq', 'path': 'id', 'value': 'A#1', 'from': 'oracle'}])
        self.assertEqual(r['cases'][1]['checks'],
                         [{'kind': 'eq', 'path': 'result.x', 'value': 2, 'from': 'oracle'}])

    def test_su005_full_answer(self):
        body = ('op f\n  input answer? json\n  audit\n  tolerance result.t 0.5\nop g\n'
                '  input answer? json\nerrors\n  e when never\nreq A "a"\n'
                '  example f {"answer": {"result": {"t": 1}, "audit": "A"}}\n'
                '  example f {"answer": {"error": "e", "extra": 1}}\n    expect error = "e"\n'
                '  example g {"answer": {"result": 2, "audit": "B"}}\n')
        cs = self.cases(with_oracle(body))['cases']
        self.assertEqual(cs[0]['full'], {'audit': 'A', 'members': ['audit', 'id', 'result'],
                                         'result': {'t': 1}, 'tolerances': {'result.t': 0.5}})
        self.assertEqual(cs[1]['full'], {'error': 'e', 'members': ['error', 'extra', 'id'],
                                         'tolerances': {'result.t': 0.5}})
        self.assertEqual(cs[2]['full'], {'members': ['audit', 'id', 'result'], 'result': 2,
                                         'tolerances': {}})


class Helpers(unittest.TestCase):
    def test_js_numbers(self):
        for value, text in [(1.0, '1'), (2.5, '2.5'), (1e21, '1e+21'), (1e20, '100000000000000000000'),
                            (1e-7, '1e-7'), (0.000001, '0.000001'), (-0.0, '0'), (123456.789, '123456.789'),
                            (1.5e300, '1.5e+300')]:
            self.assertEqual(js_num(value), text)

    def test_stringify_orders_index_keys_first(self):
        self.assertEqual(js_stringify({'b': 1, '10': 2, '9': 3, 'a': [None, True]}),
                         '{"9":3,"10":2,"b":1,"a":[null,true]}')


class Protocol(unittest.TestCase):
    def test_driver_process(self):
        good = {'files': {'a.duramen': HEAD}}
        lines = [json.dumps({'id': '1', 'op': 'check', 'input': good}), '', '  \t ', 'garbage',
                 json.dumps({'id': '2', 'op': 'cases', 'input': good})]
        p = subprocess.run([sys.executable, os.path.join(HERE, 'driver.py')],
                           input=('\n'.join(lines) + '\n').encode(), capture_output=True, timeout=60)
        self.assertEqual(p.returncode, 0)
        out = p.stdout.decode('utf-8').split('\n')
        self.assertEqual(out[-1], '')
        self.assertNotIn('\r', p.stdout.decode('utf-8'))
        got = [json.loads(l) for l in out[:-1]]
        self.assertEqual(got, [
            {'id': '1', 'result': {'diagnostics': [], 'errors': 0, 'warnings': 0}},
            {'id': None, 'error': 'bad_request'},
            {'id': '2', 'result': {'errors': 0, 'cases': []}}])


if __name__ == '__main__':
    unittest.main()
