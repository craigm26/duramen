"""Tests for REQ-JU-*: judging an answer."""
import json
import unittest

import driver


def judge(case, answer):
    line = json.dumps({'id': 'j', 'op': 'judge', 'input': {'case': case, 'answer': answer}})
    return driver.handle(line)


def res(case, answer):
    r = judge(case, answer)
    assert 'result' in r, r
    return r['result']


def eq(path, value):
    return {'path': path, 'kind': 'eq', 'value': value}


class Judge(unittest.TestCase):
    def test_ju001_verdicts(self):
        full = {'members': ['id', 'result'], 'result': {'x': 1}, 'tolerances': {}}
        case = {'checks': [eq('result.x', 1)], 'full': full}
        self.assertEqual(res(case, {'id': 'A#1', 'result': {'x': 1}}), {'pass': True})
        self.assertEqual(res(case, None), {'pass': False, 'failed': ['answer']})
        case = {'checks': [eq('result.x', 1), eq('result.y', 2), eq('id', 'A#1')],
                'full': {'members': ['id', 'result'], 'result': {'x': 1, 'y': 2}, 'tolerances': {}}}
        self.assertEqual(res(case, {'id': 'A#1', 'result': {'x': 5}, 'note': 1}),
                         {'pass': False, 'failed': ['checks.0', 'checks.1', 'members', 'result']})
        self.assertEqual(res({'id': 'A#1', 'kind': 'example', 'line': '{}', 'checks': [], 'full': None,
                              'more': 1}, {'id': 'anything', 'x': 1}), {'pass': True})
        self.assertEqual(driver.handle(json.dumps({'id': 'j', 'op': 'judge',
                                                   'input': {'case': {'checks': [], 'full': None}}})),
                         {'id': 'j', 'error': 'bad_request'})
        self.assertEqual(driver.handle(json.dumps({'id': 'j', 'op': 'judge'})),
                         {'id': 'j', 'error': 'bad_request'})

    def test_ju001_bad_forms(self):
        ok_full = {'members': ['id'], 'tolerances': {}}
        rows = [
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
            ({'checks': [], 'full': None}, []), ({'checks': [], 'full': None}, 'x'),
        ]
        for case, answer in rows:
            with self.subTest(case=case, answer=answer):
                self.assertEqual(judge(case, answer), {'id': 'j', 'error': 'bad_request'})
        self.assertEqual(res({'checks': [], 'full': ok_full}, {'id': 1}), {'pass': True})

    def test_ju002_paths(self):
        case = {'checks': [eq('result.a.0', 5), eq('result.a.01', 6), eq('result.a.length', 2),
                           eq('result.b.', 3), eq('result.c.0', 7), eq('result.d.length', 3),
                           eq('audit.k.1', 2), eq('audit', '{"k": [1, 2]}'), eq('result.a.-1', 6)],
                'full': None}
        ans = {'id': 'A#1', 'result': {'a': [5, 6], 'b': {'': 3}, 'c': {'0': 7}, 'd': 'abc'},
               'audit': '{"k": [1, 2]}'}
        self.assertEqual(res(case, ans), {'pass': False, 'failed': ['checks.1', 'checks.2', 'checks.5',
                                                                    'checks.8']})
        # a number too large for binary64 in the audit text: the audit holds no value
        line = ('{"id":"j","op":"judge","input":{"case":{"checks":[{"path":"audit.k","kind":"eq","value":1},'
                '{"path":"audit","kind":"eq","value":"{\\"k\\": 1, \\"big\\": 1e400}"}],"full":null},'
                '"answer":{"id":"A#1","audit":"{\\"k\\": 1, \\"big\\": 1e400}"}}}')
        self.assertEqual(driver.handle(line)['result'], {'pass': False, 'failed': ['checks.0']})
        case = {'checks': [eq('audit.k', 1), eq('result', None)], 'full': None}
        self.assertEqual(res(case, {'id': 'A#1', 'audit': 'k=1'}),
                         {'pass': False, 'failed': ['checks.0', 'checks.1']})

    def test_ju003_checks(self):
        def ap(path, v, tol):
            return {'path': path, 'kind': 'approx', 'value': v, 'tol': tol}
        case = {'checks': [eq('result.o', {'a': 1, 'b': [1, 2]}), eq('result.z', 0), eq('result.t', 1),
                           eq('result.n', True), eq('result.s', 1), eq('result.missing', None),
                           eq('result.e', []), eq('result.l', {}), eq('result.p', [1, 2]),
                           eq('result.w', {'a': 1}), ap('result.h', 2, 0.5), ap('result.i', 2, 0.5),
                           ap('result.j', 2, 0.5), ap('result.k', 2, 0.5), ap('result.m', 1.9, 0.1),
                           eq('result.u', None)], 'full': None}
        ans = {'id': 'A#1', 'result': {'o': {'b': [1, 2.0], 'a': 1.0}, 'z': -0.0, 't': True, 'n': 1,
                                       's': '1', 'e': {}, 'l': [], 'p': [2, 1], 'w': {'a': 1, 'b': 2},
                                       'h': 2.5, 'i': 2.5000001, 'j': '2', 'k': 1.5, 'm': 2, 'u': None}}
        self.assertEqual(res(case, ans), {'pass': False, 'failed': [
            'checks.2', 'checks.3', 'checks.4', 'checks.5', 'checks.6', 'checks.7', 'checks.8',
            'checks.9', 'checks.11', 'checks.12', 'checks.14']})

    def test_ju004_the_whole_answer(self):
        def full(**kw):
            d = {'tolerances': {}}
            d.update(kw)
            return {'checks': [], 'full': d}
        self.assertEqual(res(full(members=['id', 'result'], result=1), {'result': 1, 'id': 'A#1'}),
                         {'pass': True})
        self.assertEqual(res(full(members=['error', 'id'], error='e'), {'id': 'x', 'error': 'f', 'result': 1}),
                         {'pass': False, 'failed': ['members', 'error']})
        self.assertEqual(res(full(members=['error', 'id'], error={'code': 1, 'at': [1]}),
                             {'id': 'x', 'error': {'at': [1.0], 'code': 1}}), {'pass': True})
        self.assertEqual(res(full(members=['error', 'id'], error=None), {'id': 'x'}),
                         {'pass': False, 'failed': ['members', 'error']})
        c = full(members=['id', 'result'], result=10)
        c['full']['tolerances'] = {'result': 1}
        self.assertEqual(res(c, {'id': 'A#1', 'result': 10.5}), {'pass': True})
        self.assertEqual(res(full(members=['audit', 'id', 'result'], result=1, audit='A'),
                             {'id': 'A#1', 'result': 1, 'audit': 'A '}),
                         {'pass': False, 'failed': ['audit']})
        self.assertEqual(res(full(members=['audit', 'id', 'result'], result=1, audit='A'),
                             {'id': 'A#1', 'result': 1}), {'pass': False, 'failed': ['members', 'audit']})
        self.assertEqual(res(full(members=['id']), {'id': 'x', 'result': 1}),
                         {'pass': False, 'failed': ['members']})

    def test_ju004_tolerances(self):
        case = {'checks': [], 'full': {'members': ['id', 'result'], 'result': {'t': 1, 'u': [1, 2]},
                                       'tolerances': {'result.t': 0.5, 'result.u.1': 0.1}}}
        rows = [({'id': 'A#1', 'result': {'u': [1, 2.05], 't': 1.5}}, True, None),
                ({'id': 'A#1', 'result': {'u': [1.01, 2], 't': 1}}, False, ['result']),
                ({'id': 'A#1', 'result': {'u': [1, 2], 't': '1'}}, False, ['result']),
                ({'id': 'A#1', 'result': {'u': [1, 2], 't': 1, 'v': 0}}, False, ['result']),
                ({'id': 'A#1', 'result': {'u': [1, 2, 3], 't': 1}}, False, ['result']),
                ({'id': 'A#1'}, False, ['members', 'result']),
                ({'id': 'A#1', 'result': {'u': [1, 2], 't': 0.4}}, False, ['result'])]
        for ans, ok, failed in rows:
            with self.subTest(ans):
                want = {'pass': True} if ok else {'pass': False, 'failed': failed}
                self.assertEqual(res(case, ans), want)


if __name__ == '__main__':
    unittest.main()
