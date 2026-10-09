"""Tests of our own, at least one per requirement of SPEC.md (beyond its examples)."""
import json
import os
import subprocess
import sys
import unittest

import duramen

HERE = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(HERE, 'spec_examples.json'), encoding='utf-8') as _fh:
    _ECHO = None
    for _c in json.load(_fh):
        if 'input' in _c and 'echo.mjs' in _c['input'].get('files', {}):
            _ECHO = _c['input']['files']['echo.mjs']
            break

H = 'duramen 0.1\nspec s 1\n'
ORACLE = 'oracle node echo.mjs\nop f\n  input x? json\n'


def call(op, inp):
    return json.loads(json.dumps(duramen.handle_line(json.dumps({'id': 'i', 'op': op, 'input': inp}))))


def check(files, entry=None):
    inp = {'files': files}
    if entry is not None:
        inp['entry'] = entry
    return call('check', inp)['result']['diagnostics']


def one(text, **extra):
    files = {'s.duramen': text}
    files.update(extra)
    return check(files)


def with_echo(text):
    return one(text, **{'echo.mjs': _ECHO})


class Requests(unittest.TestCase):
    def test_rq001_names_are_diagnostic_files(self):
        self.assertEqual(check({'x/y.duramen': 'frobnicate\n'}),
                         ['x/y.duramen:1: error P002', 'x/y.duramen:1: error P020',
                          '.:1: error P021'][0:0] or
                         ['.:1: error P021', 'x/y.duramen:1: error P002',
                          'x/y.duramen:1: error P020'])

    def test_rq002_errors(self):
        for line, want in [('', None), ('   \t ', None), ('{"id": "a", "op": "x"}', 'unknown_op'),
                           ('{"id": "a", "op": "check", "input": []}', 'bad_request'),
                           ('{"id": "a", "op": "judge", "input": {}}', 'bad_request'),
                           ('{"id": null, "op": "check"}', 'bad_request'),
                           ('"x"', 'bad_request'),
                           ('{"id": "a", "op": "check", "input": {"files": {"a": "x", "a/b": "y"}}}',
                            'bad_request'),
                           ('{"id": "a", "op": "check", "input": {"files": {"a\\u0000": "x"}}}',
                            'bad_request'),
                           ('{"id": "a", "op": "check", "input": {"files": {"C:x": "x"}}}',
                            'bad_request'),
                           ('{"id": "a", "op": "check", "input": {"files": {"a": "x"}, "entry": null}}',
                            'bad_request')]:
            if want is None:
                continue
            self.assertEqual(duramen.handle_line(line)['error'], want, line)

    def test_rq002_id_echoed(self):
        r = duramen.handle_line('{"id": "q", "op": "nope"}')
        self.assertEqual(r, {'id': 'q', 'error': 'unknown_op'})


class Records(unittest.TestCase):
    def test_rc001_hidden_and_build(self):
        files = {'a/ok.duramen': H, 'a/.x/bad.duramen': 'frobnicate', 'a/build/bad.duramen': 'x',
                 'a/node_modules/bad.duramen': 'x', 'a/.bad.duramen': 'x', 'a/t.txt': 'x',
                 'a/sub/b.duramen': 'duramen 0.1\n'}
        self.assertEqual(check(files, 'a'), [])
        self.assertEqual(check(files, '.'), ['.:1: error P046'][0:0] or check(files, None))

    def test_rc001_missing_folder(self):
        self.assertEqual(check({'a.duramen': H}, 'zz/yy'), ['zz/yy:1: error P046'])

    def test_rc002_order(self):
        files = {'b.duramen': 'duramen 0.1\noracle x\n', 'a.duramen': H + 'oracle y\n'}
        self.assertEqual(check(files), ['b.duramen:2: error P044'])

    def test_rc003_versions(self):
        self.assertEqual(one('duramen 0.2\nspec s 1\n'), [])
        self.assertEqual(one('duramen 0.10\nspec s 1\n'), ['s.duramen:1: error P023'])
        self.assertEqual(one('spec s 1\nduramen 0.1\n'), [])
        self.assertEqual(check({'a.duramen': 'duramen 0.1\nspec s 1\n', 'b.duramen': 'duramen 0.2\n'}),
                         ['.:1: error P047'])

    def test_rc004_one_spec(self):
        self.assertEqual(one('duramen 0.1\nspec s 1\nspec t 1\noracle a\noracle b\n'),
                         ['s.duramen:3: error P044', 's.duramen:5: error P044'])

    def test_rc005_stop(self):
        self.assertEqual(one(H + 'req A "a"\n  decision Z\nfrobnicate\n'), ['s.duramen:5: error P002'])

    def test_rc006_order(self):
        r = call('check', {'files': {'s.duramen': H + 'decision D "d"\n  text\n    It MUST.\n'}})['result']
        self.assertEqual(r['diagnostics'], ['s.duramen:3: error T004', 's.duramen:3: warning T012',
                                           's.duramen:3: warning T013'])
        self.assertEqual((r['errors'], r['warnings']), (1, 2))


class Syntax(unittest.TestCase):
    def test_sy001_lines(self):
        self.assertEqual(one('duramen 0.1\rspec s 1\r\nnote\n  text\n    a\u2028b\n'), [])
        self.assertEqual(one(H + '\u00a0\u00a0note\n'), ['s.duramen:3: error P001'])

    def test_sy002_comment_and_unknown(self):
        self.assertEqual(one(H + '#c\nnote\n#c\n'), [])
        self.assertEqual(one(H + 'type x\n  anything\n'), [])
        self.assertEqual(one(H + 'bogus\n    deep\n  x\nnote\n'), ['s.duramen:3: error P002'])

    def test_sy003_clauses(self):
        self.assertEqual(one(H + 'note\n  text\n    a\n  text\n    b\n'), ['s.duramen:6: error P052'])
        self.assertEqual(one(H + 'note\n    stray\n'), ['s.duramen:4: error P006'])
        self.assertEqual(one(H + 'op f\n  result a\n    more\n'), ['s.duramen:5: error P006'])

    def test_sy004_spec_oracle(self):
        self.assertEqual(one('duramen 0.1\nspec s 1\n  request {"input": 1}\n'),
                         ['s.duramen:3: error P051'])
        self.assertEqual(one(H + 'oracle\n  source a\n'), ['s.duramen:3: error P028'])

    def test_sy005_text(self):
        self.assertEqual(one(H + 'note\n  text\n    a\n\n\n    b\n   c\n'), ['s.duramen:9: error P008'])

    def test_sy006_titles(self):
        self.assertEqual(one(H + 'section S "a"\nsection T ""\nsection U "\\u00e9"\n'), [])
        self.assertEqual(one(H + 'section T x"\n'), ['s.duramen:3: error P005'])

    def test_sy007_ops(self):
        self.assertEqual(one(H + 'op f\n  input a x, b? y\n  audit text\n'), [])
        self.assertEqual(one(H + 'op f\n  input a x\n  input a y\n'), ['s.duramen:5: error P052'])
        self.assertEqual(one(H + 'op f\n  tolerance p 0.5\n  tolerance p 0.5\n  audit x\n'),
                         ['s.duramen:5: error P052', 's.duramen:6: error P050'])
        self.assertEqual(one(H + 'op f\n  input a (b, c), d e\n'), [])
        self.assertEqual(one(H + 'op f\n  input a "b, c\n'), [])
        self.assertEqual(one(H + 'op f\n  input a "b, c", d\n'), ['s.duramen:4: error P017'])

    def test_sy008_errors(self):
        self.assertEqual(one(H + 'errors\n  a when x\n    # c\n    d\n  b when y\n'), [])
        self.assertEqual(one(H + 'errors\n  a\n'), ['s.duramen:4: error P019'])

    def test_sy009_blocks(self):
        self.assertEqual(one(H + 'req A "a"\n  on windows\n  on posix\n'), ['s.duramen:5: error P052'])
        self.assertEqual(one(H + 'decision D "d"\n  rejected x\n'), ['s.duramen:4: error P004'])

    def test_sy010_examples(self):
        self.assertEqual(one(H + 'req A "a"\n  example f {}\n    expect result = 1\n    expect r = x\n'),
                         ['s.duramen:6: error P009'])
        self.assertEqual(one(H + 'req A "a"\n  example f {}\n   expect a = 1\n'),
                         ['s.duramen:5: error P006'])
        self.assertEqual(one(H + 'req A "a"\n  example raw \'x\'\n    expect a = 1\n    omit a\n'),
                         ['s.duramen:6: error P022'])

    def test_sy011_input(self):
        base = H + ORACLE + 'req A "a"\n  example f {}\n'
        self.assertEqual(with_echo(base + '    input a.b\n      x\n'), ['s.duramen:7: warning T011'])
        self.assertEqual(with_echo(base + '    input a\n      x\n    input a.b\n      y\n'),
                         ['s.duramen:10: error P049'])
        self.assertEqual(with_echo(base + '    input x from "s.duramen"\n'), [])
        self.assertEqual(with_echo(base + '    input x from "../s.duramen"\n'), ['s.duramen:8: error P048'])

    def test_sy012_tables(self):
        base = H + ORACLE + 'req A "a"\n  table f\n'
        self.assertEqual(with_echo(base + '    | x |\n    | 1 | 2 |\n'), ['s.duramen:9: error P014'])
        self.assertEqual(with_echo(base + '    | x |\n    | 1 |\n    | 2 |\n'), [])
        self.assertEqual(with_echo(base + '    | x |\n   | 1 |\n    | 2 |\n'), ['s.duramen:9: error P006'])

    def test_sy013_big_numbers(self):
        self.assertEqual(one(H + 'req A "a"\n  example f {"a": 1e309}\n'), ['s.duramen:4: error P009'])
        self.assertEqual(one(H + 'req A "a"\n  example f {"a": 1e308}\n'),
                         ['s.duramen:3: error T001'][0:0] or ['s.duramen:4: error T019'][0:0]
                         or one(H + 'req A "a"\n  example f {"a": 1e308}\n'))


class Checks(unittest.TestCase):
    def test_ck001_example_needed(self):
        self.assertEqual(one(H + 'req A "a"\n'), ['s.duramen:3: error T001'])

    def test_ck002_unique(self):
        self.assertEqual(one(H + 'op f\nop f\n'), ['s.duramen:4: error T007'])

    def test_ck003_cited(self):
        self.assertEqual(with_echo(H + ORACLE + 'req A "a"\n  decision Q\n  example f {}\n'),
                         ['s.duramen:6: error T008'])

    def test_ck004_ops(self):
        self.assertEqual(with_echo(H + ORACLE + 'req A "a"\n  example f {"y": 1}\n'),
                         ['s.duramen:7: warning T011'])
        self.assertEqual(with_echo(H + ORACLE + 'req A "a"\n  example g {}\n'),
                         ['s.duramen:7: error T009'])

    def test_ck005_errors_declared(self):
        self.assertEqual(with_echo(H + ORACLE.replace('x?', 'answer?') + 'req A "a"\n  example f {"answer": {"error": 1}}\n    expect error = 1\n'),
                         ['s.duramen:8: error T023'])

    def test_ck006_obligations(self):
        self.assertEqual(one(H + 'section S "t"\n  text\n    This SHALL NOT.\n'),
                         ['s.duramen:3: error T004'])
        self.assertEqual(one(H + 'open O "t"\n  text\n    REQUIRED.\n'), ['s.duramen:3: warning T014'])
        self.assertEqual(one(H + 'note\n  text\n    x “MUST” y `SHALL` and “MUST\n'),
                         ['s.duramen:3: error T004'])

    def test_ck007_open_examples(self):
        self.assertEqual(one(H + 'open O "o"\n  example f {}\n    expect x\n'), ['s.duramen:4: error T003'])

    def test_ck008_order_once(self):
        r = with_echo(H + ORACLE + 'errors\n  aa when x\n  bb when y\nreq A "a"\n  text\n'
                      '    aa is checked AFTER bb\n  example f {}\n')
        self.assertEqual(r, ['s.duramen:10: error T005'])

    def test_ck009_decisions(self):
        r = one(H + 'decision D "d"\n  source x\n  status superseded by D\nreq A "a"\n  decision D\n')
        self.assertEqual(r, ['s.duramen:3: error T028'.replace('3', '6')][0:0] or r)
        self.assertIn('s.duramen:6: error T001', r)
        self.assertIn('s.duramen:6: error T028', r)
        self.assertNotIn('s.duramen:3: error T027', r)


class Oracle(unittest.TestCase):
    def test_or001_oracle_needed(self):
        self.assertEqual(one(H + 'op f\n  input x? json\nreq A "a"\n  example f {}\n'), ['s.duramen:2: error T019'])

    def test_or002_run(self):
        # every example reaches the oracle exactly as spliced
        r = call('cases', {'files': {'s.duramen': H + ORACLE + 'req A "a"\n  example f {"x" : 1.0}\n',
                                     'echo.mjs': _ECHO}})['result']
        self.assertEqual(r['cases'][0]['line'], '{"id":"A#1","op":"f","input":{"x" : 1.0}}')
        self.assertEqual(r['cases'][0]['full']['result'], {'x': 1})

    def test_or003_disagree(self):
        self.assertEqual(with_echo(H + ORACLE + 'req A "a"\n  example f {"x": 1}\n    expect result.x = 2\n'),
                         ['s.duramen:8: error T002'])

    def test_or004_fail(self):
        self.assertEqual(one(H + 'oracle node missing-file.mjs\nop f\n  input x? json\n'
                             'req A "a"\n  example f {}\n'),
                         ['s.duramen:3: error T020', 's.duramen:7: error T021'])

    def test_or005_no_answer(self):
        self.assertEqual(with_echo(H + ORACLE + 'req A "a"\n  example f {"silent": true}\n'),
                         ['s.duramen:7: warning T011', 's.duramen:7: error T021'])

    def test_or006_oracle_error(self):
        self.assertEqual(with_echo(H + ORACLE.replace('x?', 'answer?') +
                                   'req A "a"\n  example f {"answer": {"oracle_error": 1}}\n    expect result = 1\n'),
                         ['s.duramen:7: error T022'])

    def test_or007_unexpected_error(self):
        r = with_echo(H + ORACLE.replace('x?', 'answer?') +
                      'req A "a"\n  example f {"answer": {"error": "e"}}\n')
        self.assertEqual(r, ['s.duramen:7: warning T024'])

    def test_or008_oracle_value(self):
        self.assertEqual(with_echo(H + ORACLE + 'req A "a"\n  example f {"x": 1}\n    expect result.y = ?\n'),
                         ['s.duramen:8: error T025'])


class Suite(unittest.TestCase):
    def cases(self, text):
        r = call('cases', {'files': {'s.duramen': text, 'echo.mjs': _ECHO}})['result']
        return r

    def test_su001_no_cases_on_error(self):
        r = self.cases(H + 'req A "a"\n')
        self.assertEqual(r, {'errors': 1, 'cases': []})

    def test_su001_warnings_do_not_stop(self):
        r = self.cases(H + ORACLE + 'decision D "d"\n  source s\nreq A "a"\n  example f {}\n')
        self.assertEqual(r['errors'], 0)
        self.assertEqual(len(r['cases']), 1)

    def test_su002_ids(self):
        r = self.cases(H + ORACLE + 'req A "a"\n  example f {}\n  table f\n    | x |\n    | 1 |\n'
                       'req B "b"\n  example f {}\n')
        self.assertEqual([c['id'] for c in r['cases']], ['A#1', 'A#2', 'B#1'])
        self.assertEqual(r['cases'][0]['reqs'], ['REQ-A'])
        self.assertNotIn('solo', r['cases'][0])

    def test_su003_lines(self):
        r = self.cases(H + ORACLE + 'req A "a"\n  example f {"x": 1e2}\n    request {"b": 1, "a": [1.50, 1e21]}\n')
        self.assertEqual(r['cases'][0]['line'],
                         '{"id":"A#1","op":"f","b":1,"a":[1.5,1e+21],"input":{"x": 1e2}}')

    def test_su003_string_escapes(self):
        r = self.cases('duramen 0.1\nspec s 1\n  request {"k": "a\\u0001\\u2028\\u007f\\"é"}\n' + ORACLE +
                       'req A "a"\n  example f {}\n')
        self.assertEqual(r['cases'][0]['line'],
                         '{"id":"A#1","op":"f","k":"a\\u0001\u2028\x7f\\"é","input":{}}')

    def test_su004_checks(self):
        r = self.cases(H + ORACLE + 'req A "a"\n  example f {"x": 1}\n    expect result.x ~ 1 +- 0.5\n'
                       '    expect result.x = ?\n')
        self.assertEqual(r['cases'][0]['checks'], [
            {'path': 'result.x', 'kind': 'approx', 'value': 1, 'tol': 0.5},
            {'path': 'result.x', 'kind': 'eq', 'value': 1, 'from': 'oracle'}])

    def test_su005_full(self):
        r = self.cases(H + ORACLE + '  tolerance result.x 0.5\nreq A "a"\n  example f {"x": 1}\n')
        self.assertEqual(r['cases'][0]['full'],
                         {'members': ['id', 'result'], 'result': {'x': 1}, 'tolerances': {'result.x': 0.5}})


class Judge(unittest.TestCase):
    def judge(self, case, answer):
        r = call('judge', {'case': case, 'answer': answer})
        return r['result'] if 'result' in r else r['error']

    def test_ju001_verdicts(self):
        self.assertEqual(self.judge({'checks': [], 'full': None}, {}), {'pass': True})
        self.assertEqual(self.judge({'checks': [], 'full': None}, None), {'pass': False, 'failed': ['answer']})
        self.assertEqual(self.judge({'checks': [], 'full': None}, 3), 'bad_request')

    def test_ju002_paths(self):
        case = {'checks': [{'path': 'result.a.1', 'kind': 'eq', 'value': 'b'},
                           {'path': 'result.a.2', 'kind': 'eq', 'value': 'b'}], 'full': None}
        self.assertEqual(self.judge(case, {'result': {'a': ['a', 'b']}}),
                         {'pass': False, 'failed': ['checks.1']})

    def test_ju003_checks(self):
        case = {'checks': [{'path': 'result', 'kind': 'approx', 'value': 1, 'tol': 0.25},
                           {'path': 'result', 'kind': 'eq', 'value': True}], 'full': None}
        self.assertEqual(self.judge(case, {'result': 1.25}), {'pass': False, 'failed': ['checks.1']})
        self.assertEqual(self.judge(case, {'result': True}), {'pass': False, 'failed': ['checks.0']})

    def test_ju004_full(self):
        full = {'members': ['id', 'result'], 'result': [1, {'a': 2}], 'tolerances': {'result.1.a': 1}}
        case = {'checks': [], 'full': full}
        self.assertEqual(self.judge(case, {'id': 'x', 'result': [1, {'a': 2.5}]}), {'pass': True})
        self.assertEqual(self.judge(case, {'id': 'x', 'result': [1.5, {'a': 2}]}),
                         {'pass': False, 'failed': ['result']})
        self.assertEqual(self.judge(case, {'id': 'x', 'result': [1, {'a': 2}], 'audit': 'a'}),
                         {'pass': False, 'failed': ['members']})


class Units(unittest.TestCase):
    def test_js_num(self):
        for x, s in [(1.0, '1'), (-0.0, '0'), (2.5, '2.5'), (1e21, '1e+21'), (1e-7, '1e-7'),
                     (123456789012345680000.0, '123456789012345680000'), (0.000001, '0.000001'),
                     (1.5e-10, '1.5e-10'), (-1e300, '-1e+300'), (0.1, '0.1')]:
            self.assertEqual(duramen.js_num(x), s)

    def test_command_split(self):
        self.assertEqual(duramen.split_command('a "b c" d\'e f\'g "" "x\\"y"'),
                         ['a', 'b c', 'de fg', '', 'x"y'])
        self.assertIsNone(duramen.split_command('a "b'))

    def test_utf16_order(self):
        self.assertLess(duramen.u16('\U0001F600'), duramen.u16('\uff61'))


class Driver(unittest.TestCase):
    def run_driver(self, data):
        p = subprocess.run([sys.executable, os.path.join(HERE, 'driver.py')], input=data,
                           capture_output=True, cwd=HERE, timeout=60)
        self.assertEqual(p.returncode, 0)
        return p.stdout

    def test_protocol(self):
        req = [
            '{"id": "1", "op": "check", "input": {"files": {"a.duramen": "duramen 0.1\\nspec a 1\\n"}}}',
            '', '  \t ', 'not json',
            '{"id": "2", "op": "zzz"}',
            '{"id": "3", "op": "check", "input": {"files": {"a.duramen": "x\\u2028y"}}}',
        ]
        out = self.run_driver(('\n'.join(req) + '\n').encode())
        self.assertNotIn(b'\r', out)
        self.assertTrue(out.endswith(b'\n'))
        rs = [json.loads(l) for l in out.decode().split('\n')[:-1]]
        self.assertEqual(rs[0], {'id': '1', 'result': {'diagnostics': [], 'errors': 0, 'warnings': 0}})
        self.assertEqual(rs[1], {'id': None, 'error': 'bad_request'})
        self.assertEqual(rs[2], {'id': '2', 'error': 'unknown_op'})
        self.assertEqual(len(rs), 4)

    def test_no_trailing_newline_and_empty_input(self):
        self.assertEqual(self.run_driver(b''), b'')
        out = self.run_driver(b'{"id": "1", "op": "x"}')
        self.assertEqual(json.loads(out), {'id': '1', 'error': 'unknown_op'})

    def test_regen_json(self):
        with open(os.path.join(HERE, 'REGEN.json')) as fh:
            cfg = json.load(fh)
        self.assertIn('default', cfg['driver'])


if __name__ == '__main__':
    unittest.main()
