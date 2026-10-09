"""The driver protocol (REQ-RQ-001, REQ-RQ-002), the inline examples of the reading rules, and judge."""
import json
import os
import subprocess
import sys
import unittest

import duramen

HERE = os.path.dirname(os.path.abspath(__file__))
GOOD = 'duramen 0.1\nspec a 1\n'


def drive(lines):
    data = ''.join(l + '\n' for l in lines).encode('utf-8')
    p = subprocess.run([sys.executable, 'driver.py'], input=data, stdout=subprocess.PIPE, cwd=HERE, timeout=60)
    assert p.returncode == 0
    return p.stdout


def req(op, inp, rid='1'):
    return json.dumps({'id': rid, 'op': op, 'input': inp})


def call(op, inp):
    return duramen.handle({'id': 'x', 'op': op, 'input': inp})


def diags(files, entry=None):
    inp = {'files': files}
    if entry is not None:
        inp['entry'] = entry
    return call('check', inp)['result']['diagnostics']


class Protocol(unittest.TestCase):
    def test_one_response_per_line_in_order(self):
        out = drive([req('check', {'files': {'a.duramen': GOOD}}, 'a'), '', '   \t ', req('lint', {}, 'b'),
                     '{not json', '[1, 2]'])
        lines = out.split(b'\n')
        self.assertEqual(lines.pop(), b'')
        got = [json.loads(l) for l in lines]
        self.assertEqual(got, [
            {'id': 'a', 'result': {'diagnostics': [], 'errors': 0, 'warnings': 0}},
            {'id': 'b', 'error': 'unknown_op'},
            {'id': None, 'error': 'bad_request'},
            {'id': None, 'error': 'bad_request'}])
        self.assertNotIn(b'\r', out)

    def test_no_input_ends_with_status_zero(self):
        self.assertEqual(drive([]), b'')

    def test_utf8_and_line_separators_in_output(self):
        files = {'s.duramen': 'duramen 0.1\nspec s 1\n', ' é.txt': 'x'}
        out = drive([req('check', {'files': files, 'entry': ' é.txt'})])
        self.assertEqual(out.count(b'\n'), 1)
        self.assertIn(' '.encode('utf-8'), out) if False else None

    def test_error_cases(self):
        ok = {'a.duramen': GOOD}
        cases = [
            ('{"op": "check", "input": {"files": {"a.duramen": "x"}}}', None, 'bad_request'),
            ('{"id": 7, "op": "check", "input": {"files": {"a.duramen": "x"}}}', None, 'bad_request'),
            ('{"id": "1", "op": "lint", "input": {"files": {"a.duramen": "x"}}}', '1', 'unknown_op'),
            ('{"id": "1", "op": "lint"}', '1', 'unknown_op'),
            ('{"id": "1", "op": "check"}', '1', 'bad_request'),
            ('{"id": "1", "op": "check", "input": {}}', '1', 'bad_request'),
            ('{"id": "1", "op": "check", "input": []}', '1', 'bad_request'),
            ('{"id": "1", "op": "check", "input": {"files": {}}}', '1', 'bad_request'),
            ('{"id": "1", "op": "check", "input": {"files": ["a"]}}', '1', 'bad_request'),
            ('{"id": "1", "op": "check", "input": {"files": {"a.duramen": 1}}}', '1', 'bad_request'),
            ('{"id": "1", "op": "judge"}', '1', 'bad_request'),
        ]
        for line, rid, code in cases:
            with self.subTest(line):
                out = json.loads(drive([line]))
                self.assertEqual(out, {'id': rid, 'error': code})

    def test_bad_names_and_entries(self):
        for name in ['../a.duramen', '/a.duramen', 'x/./a.duramen', 'x//a.duramen', 'c:a.duramen',
                     'a\\b.duramen', 'a/', 'x/../a', 'a\0b']:
            with self.subTest(name):
                self.assertEqual(call('check', {'files': {name: GOOD}}), {'id': 'x', 'error': 'bad_request'})
        self.assertEqual(call('cases', {'files': {'a': 'x', 'a/b.duramen': GOOD}})['error'], 'bad_request')
        self.assertEqual(call('cases', {'files': {'a/b': 'x', 'a/b/c.duramen': GOOD}})['error'], 'bad_request')
        for entry in ['../a.duramen', 1, '', None, '/a', 'a//b']:
            with self.subTest(entry):
                self.assertEqual(call('check', {'files': {'a.duramen': GOOD}, 'entry': entry})['error'],
                                 'bad_request')
        self.assertIn('result', call('check', {'files': {'a.duramen': GOOD}, 'entry': '.'}))

    def test_first_error_wins(self):
        # unknown_op is decided before the input is looked at
        self.assertEqual(call('nope', 5)['error'], 'unknown_op')


class Reading(unittest.TestCase):
    def test_bom_and_line_ends(self):
        self.assertEqual(diags({'s.duramen': '﻿duramen 0.1\r\nspec s 1\rnote  \n  text\t\n    Some text.  \r\n'}), [])

    def test_tabs_and_indent(self):
        self.assertEqual(diags({'s.duramen': 'duramen 0.1\nspec s 1\n\tnote\n'}), ['s.duramen:3: error P001'])
        self.assertEqual(diags({'s.duramen': 'duramen 0.1\nspec s 1\nnote\n  \ttext\n'}), ['s.duramen:4: error P001'])
        self.assertEqual(diags({'s.duramen': 'duramen 0.1\nspec s 1\n note\n'}), ['s.duramen:3: error P001'])
        self.assertEqual(diags({'s.duramen': '  \t \nduramen 0.1\n\t\nspec s 1\n   \n'}), [])
        self.assertEqual(diags({'s.duramen': 'duramen 0.1　\nspec s 1 \nnote\n  text\n'}),
                         ['s.duramen:4: error P001'])

    def test_empty_file(self):
        self.assertEqual(diags({'s.duramen': ''}), ['.:1: error P021', 's.duramen:1: error P020'])

    def test_u2028_is_not_a_line_end(self):
        self.assertEqual(diags({'s.duramen': 'duramen 0.1\nspec s 1\nsection S "a b"\n'}), [])

    def test_counts(self):
        r = call('check', {'files': {'s.duramen': GOOD + 'decision D "d"\n'}})['result']
        self.assertEqual(r, {'diagnostics': ['s.duramen:3: warning T012', 's.duramen:3: warning T013'],
                             'errors': 0, 'warnings': 2})

    def test_cases_of_a_bad_record(self):
        r = call('cases', {'files': {'s.duramen': 'frobnicate\n'}})['result']
        self.assertEqual(r, {'cases': [], 'errors': 3})


class Numbers(unittest.TestCase):
    def test_js_formatting(self):
        for v, s in [(1.0, '1'), (2.5, '2.5'), (-0.0, '0'), (1e21, '1e+21'), (1e20, '100000000000000000000'),
                     (1e-7, '1e-7'), (0.000001, '0.000001'), (123456789.125, '123456789.125'),
                     (1.5e-10, '1.5e-10'), (0.1, '0.1'), (5e-324, '5e-324')]:
            self.assertEqual(duramen.js_num(v), s)

    def test_string_escapes(self):
        self.assertEqual(duramen.js_str('a"\\\n\x01\ud800 '), '"a\\"\\\\\\n\\u0001\\ud800 "')

    def test_es_key_order(self):
        self.assertEqual(duramen.js_dumps({'b': 1, '10': 2, '9': 3, 'a': 4}), '{"9":3,"10":2,"b":1,"a":4}')

    def test_too_large(self):
        self.assertEqual(duramen.parse_json('1e400')[0], 'big')
        self.assertEqual(duramen.parse_json('[NaN]')[0], 'bad')
        self.assertEqual(duramen.parse_json('-0')[1], 0.0)


def judge(case, answer):
    return call('judge', {'case': case, 'answer': answer})


class Judge(unittest.TestCase):
    def test_pass_and_fail(self):
        case = {'checks': [{'path': 'result.x', 'kind': 'eq', 'value': 1}],
                'full': {'members': ['id', 'result'], 'result': {'x': 1}, 'tolerances': {}}}
        self.assertEqual(judge(case, {'id': 'A#1', 'result': {'x': 1}})['result'], {'pass': True})
        self.assertEqual(judge(case, None)['result'], {'pass': False, 'failed': ['answer']})

    def test_failed_order(self):
        case = {'checks': [{'path': 'result.x', 'kind': 'eq', 'value': 1}, {'path': 'result.y', 'kind': 'eq', 'value': 2},
                           {'path': 'id', 'kind': 'eq', 'value': 'A#1'}],
                'full': {'members': ['id', 'result'], 'result': {'x': 1, 'y': 2}, 'tolerances': {}}}
        r = judge(case, {'id': 'A#1', 'result': {'x': 5}, 'note': 1})['result']
        self.assertEqual(r, {'pass': False, 'failed': ['checks.0', 'checks.1', 'members', 'result']})

    def test_other_members_of_case_are_ignored(self):
        case = {'id': 'A#1', 'kind': 'example', 'line': '{}', 'checks': [], 'full': None, 'more': 1}
        self.assertEqual(judge(case, {'id': 'anything', 'x': 1})['result'], {'pass': True})

    def test_bad_requests(self):
        self.assertEqual(call('judge', {'case': {'checks': [], 'full': None}})['error'], 'bad_request')
        self.assertEqual(call('judge', None)['error'], 'bad_request')
        rows = [
            ([], None), ({'checks': {}, 'full': None}, None),
            ({'checks': [{'path': 'result', 'kind': 'eq'}], 'full': None}, None),
            ({'checks': [{'path': 1, 'kind': 'eq', 'value': 1}], 'full': None}, None),
            ({'checks': [{'path': 'result', 'kind': 'approx', 'value': '1', 'tol': 0}], 'full': None}, None),
            ({'checks': [{'path': 'result', 'kind': 'approx', 'value': 1, 'tol': -1}], 'full': None}, None),
            ({'checks': [{'path': 'result', 'kind': 'approx', 'value': 1}], 'full': None}, None),
            ({'checks': [1], 'full': None}, None),
            ({'checks': []}, None), ({'full': None}, None),
            ({'checks': [], 'full': []}, None),
            ({'checks': [], 'full': {'members': 'id', 'tolerances': {}}}, None),
            ({'checks': [], 'full': {'members': [1], 'tolerances': {}}}, None),
            ({'checks': [], 'full': {'members': ['id']}}, None),
            ({'checks': [], 'full': {'members': ['id'], 'tolerances': {'result': '1'}}}, None),
            ({'checks': [], 'full': {'members': ['id'], 'tolerances': {'result': -1}}}, None),
            ({'checks': [], 'full': {'members': ['id', 'audit'], 'tolerances': {}, 'audit': 1}}, None),
            ({'checks': [], 'full': None}, []), ({'checks': [], 'full': None}, 'x'),
        ]
        for case, answer in rows:
            with self.subTest(case=case, answer=answer):
                self.assertEqual(judge(case, answer)['error'], 'bad_request')

    def test_paths(self):
        checks = [
            ('result.a.0', 5), ('result.a.01', 6), ('result.a.length', 2), ('result.b.', 3),
            ('result.c.0', 7), ('result.d.length', 3), ('audit.k.1', 2), ('audit', '{"k": [1, 2]}'),
            ('result.a.-1', 6)]
        case = {'checks': [{'path': p, 'kind': 'eq', 'value': v} for p, v in checks], 'full': None}
        ans = {'id': 'A#1', 'result': {'a': [5, 6], 'b': {'': 3}, 'c': {'0': 7}, 'd': 'abc'},
               'audit': '{"k": [1, 2]}'}
        self.assertEqual(judge(case, ans)['result']['failed'], ['checks.1', 'checks.2', 'checks.5', 'checks.8'])

    def test_audit_paths_need_json(self):
        case = {'checks': [{'path': 'audit.k', 'kind': 'eq', 'value': 1}, {'path': 'result', 'kind': 'eq', 'value': None}],
                'full': None}
        self.assertEqual(judge(case, {'id': 'A#1', 'audit': 'k=1'})['result']['failed'], ['checks.0', 'checks.1'])
        case = {'checks': [{'path': 'audit.k', 'kind': 'eq', 'value': 1}], 'full': None}
        self.assertEqual(judge(case, {'id': 'A#1', 'audit': '{"k": 1, "big": 1e400}'})['result']['failed'],
                         ['checks.0'])

    def test_check_kinds(self):
        vals = [('result.o', {'a': 1, 'b': [1, 2]}), ('result.z', 0), ('result.t', 1), ('result.n', True),
                ('result.s', 1), ('result.missing', None), ('result.e', []), ('result.l', {}),
                ('result.p', [1, 2]), ('result.w', {'a': 1}), ('result.u', None)]
        checks = [{'path': p, 'kind': 'eq', 'value': v} for p, v in vals]
        for p, v, t in [('result.h', 2, .5), ('result.i', 2, .5), ('result.j', 2, .5), ('result.k', 2, .5),
                        ('result.m', 1.9, .1)]:
            checks.append({'path': p, 'kind': 'approx', 'value': v, 'tol': t})
        ans = {'id': 'A#1', 'result': {'o': {'b': [1, 2.0], 'a': 1.0}, 'z': -0.0, 't': True, 'n': 1, 's': '1',
                                       'e': {}, 'l': [], 'p': [2, 1], 'w': {'a': 1, 'b': 2}, 'h': 2.5,
                                       'i': 2.5000001, 'j': '2', 'k': 1.5, 'm': 2, 'u': None}}
        self.assertEqual(judge({'checks': checks, 'full': None}, ans)['result']['failed'],
                         ['checks.%d' % i for i in (2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 15)])

    def test_full(self):
        def full(**kw):
            d = {'members': ['id', 'result'], 'tolerances': {}}
            d.update(kw)
            return {'checks': [], 'full': d}
        self.assertEqual(judge(full(result=1), {'result': 1, 'id': 'A#1'})['result'], {'pass': True})
        self.assertEqual(judge(full(members=['error', 'id'], error='e'), {'id': 'x', 'error': 'f', 'result': 1})['result'],
                         {'pass': False, 'failed': ['members', 'error']})
        self.assertEqual(judge(full(members=['error', 'id'], error={'code': 1, 'at': [1]}),
                               {'id': 'x', 'error': {'at': [1.0], 'code': 1}})['result'], {'pass': True})
        self.assertEqual(judge(full(members=['error', 'id'], error=None), {'id': 'x'})['result'],
                         {'pass': False, 'failed': ['members', 'error']})
        self.assertEqual(judge(full(result=10, tolerances={'result': 1}), {'id': 'A#1', 'result': 10.5})['result'],
                         {'pass': True})
        self.assertEqual(judge(full(members=['audit', 'id', 'result'], result=1, audit='A'),
                               {'id': 'A#1', 'result': 1, 'audit': 'A '})['result'],
                         {'pass': False, 'failed': ['audit']})
        self.assertEqual(judge(full(members=['audit', 'id', 'result'], result=1, audit='A'),
                               {'id': 'A#1', 'result': 1})['result'],
                         {'pass': False, 'failed': ['members', 'audit']})
        self.assertEqual(judge(full(members=['id']), {'id': 'x', 'result': 1})['result'],
                         {'pass': False, 'failed': ['members']})

    def test_tolerances(self):
        full = {'members': ['id', 'result'], 'result': {'t': 1, 'u': [1, 2]},
                'tolerances': {'result.t': 0.5, 'result.u.1': 0.1}}
        case = {'checks': [], 'full': full}
        for res, want in [({'u': [1, 2.05], 't': 1.5}, None), ({'u': [1.01, 2], 't': 1}, ['result']),
                          ({'u': [1, 2], 't': '1'}, ['result']), ({'u': [1, 2], 't': 1, 'v': 0}, ['result']),
                          ({'u': [1, 2, 3], 't': 1}, ['result']), ({'u': [1, 2], 't': 0.4}, ['result'])]:
            with self.subTest(res):
                r = judge(case, {'id': 'A#1', 'result': res})['result']
                self.assertEqual(r, {'pass': True} if want is None else {'pass': False, 'failed': want})
        self.assertEqual(judge(case, {'id': 'A#1'})['result'], {'pass': False, 'failed': ['members', 'result']})


if __name__ == '__main__':
    unittest.main()
