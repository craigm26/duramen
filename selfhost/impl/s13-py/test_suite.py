"""Tests for REQ-SU-*: the suite."""
import unittest

from helpers import S, cases, ECHO

OR = ('duramen 0.1', 'spec s 1', 'oracle node echo.mjs')


class Suite(unittest.TestCase):
    def test_su001_no_suite_from_a_record_with_errors(self):
        self.assertEqual(cases('frobnicate\n'), {'cases': [], 'errors': 3})
        self.assertEqual(cases(S('duramen 0.1', 'spec s 1', 'req A "a"', '  text', '    Nothing to show.')),
                         {'cases': [], 'errors': 1})
        r = cases(S(*OR, 'op f', '  input x? json', 'req A "a"', '  example f {"y": 1}'))
        self.assertEqual(r['errors'], 0)
        self.assertEqual(r['cases'][0]['id'], 'A#1')

    def test_su001_warnings_do_not_stop_the_suite(self):
        r = cases(S(*OR, 'op f', '  input x? json', 'decision D "d"', '  source s',
                    'req A "a"', '  example f {"y": 1}'))
        self.assertEqual(r['errors'], 0)
        self.assertEqual(len(r['cases']), 1)

    def test_su002_one_case_per_example(self):
        r = cases(S(*OR, 'op f', '  input x? json', 'req A "a"', '  example f {"x": 1}',
                    '    expect result.x = 1', 'req B "b"', '  on posix', '  table f',
                    '    | x | result.x |', '    | 2 | 2        |', '    | 3 | ?        |'))
        self.assertEqual(r, {'cases': [
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
             'platform': 'posix', 'reqs': ['REQ-B']}], 'errors': 0})

    def test_su002_record_order(self):
        r = cases({'b.duramen': S('duramen 0.1', 'req B "b"', '  on windows', '  example f {}'),
                   'a.duramen': S(*OR, 'op f', '  input x? json', 'req A "a"', '  example f {}',
                                  '  example f {}')})
        self.assertEqual([c['id'] for c in r['cases']], ['A#1', 'A#2', 'B#1'])
        self.assertEqual(r['cases'][2]['platform'], 'windows')

    def test_su003_request_lines(self):
        r = cases(S('duramen 0.1', 'spec s 1', '  request {"clock": "c", "trace": true}',
                    'oracle node echo.mjs', 'op f', '  input x? json', 'op g', '  input x? json',
                    '  request {"mode": 2}', 'req A "a"', '  example f {"x" : 2.50e0 }', '  example f',
                    '  example f {"x": 1}', '    request {"trace": false, "user": "u"}', '    omit clock',
                    '  example g {"x": 1}', '    omit id, input', '  example f {"x": 1}', '    omit op, id',
                    '  example raw \'{"id": "A#6",  "op": "f"}\'', '  example f {"x": 1}',
                    '    request {"b": {"z": 1, "10": 2, "9": 3}, "2": "two", "a": 1}', '    omit clock',
                    '    omit trace', '  table f', '    | result |', '    | ?      |'))
        c = r['cases']
        self.assertEqual(c[0], {'checks': [], 'full': {'members': ['id', 'result'],
                                                       'result': {'x': 2.5}, 'tolerances': {}},
                                'id': 'A#1', 'kind': 'example',
                                'line': '{"id":"A#1","op":"f","clock":"c","trace":true,"input":{"x" : 2.50e0 }}',
                                'platform': 'any', 'reqs': ['REQ-A']})
        self.assertEqual(c[1]['line'], '{"id":"A#2","op":"f","clock":"c","trace":true}')
        self.assertEqual(c[2]['line'], '{"id":"A#3","op":"f","trace":false,"user":"u","input":{"x": 1}}')
        self.assertEqual(c[3], {'checks': [], 'full': {'members': ['id', 'result'], 'result': {},
                                                       'tolerances': {}},
                                'id': 'A#4', 'kind': 'example', 'line': '{"op":"g","mode":2}',
                                'platform': 'any', 'reqs': ['REQ-A'], 'solo': True})
        self.assertEqual(c[4]['line'], '{"clock":"c","trace":true,"input":{"x": 1}}')
        self.assertTrue(c[4]['solo'])
        self.assertEqual(c[5]['line'], '{"id": "A#6",  "op": "f"}')
        self.assertTrue(c[5]['solo'])
        self.assertEqual(c[6]['line'],
                         '{"id":"A#7","op":"f","2":"two","b":{"9":3,"10":2,"z":1},"a":1,"input":{"x": 1}}')
        self.assertEqual(c[7]['line'], '{"id":"A#8","op":"f","clock":"c","trace":true,"input":{}}')

    def test_su003_input_lines(self):
        r = cases(S(*OR, 'op f', '  input files? object, n? number', 'req A "a"',
                    '  example f {"n" : 1.50, "files": {"z": "old"}}', '    input files."a.duramen"',
                    '      duramen 0.1', '      "quoted" é', '    input files.z', '      new',
                    '  table f', '    | n      | files |', '    | 1.50   |       |', '    |        | {}    |'))
        c = r['cases']
        self.assertEqual(c[0]['line'], '{"id":"A#1","op":"f","input":{"n":1.5,"files":{"z":"new\\n",'
                                       '"a.duramen":"duramen 0.1\\n\\"quoted\\" é\\n"}}}')
        self.assertEqual(c[1]['line'], '{"id":"A#2","op":"f","input":{"n":1.50}}')
        self.assertEqual(c[2]['line'], '{"id":"A#3","op":"f","input":{"files":{}}}')
        r = cases(S(*OR, 'op f', '  input t? string', 'req A "a"', '  example f', '    input t', '      x'))
        self.assertEqual(r['cases'][0]['line'], '{"id":"A#1","op":"f","input":{"t":"x\\n"}}')

    def test_su004_checks(self):
        r = cases(S(*OR, 'op f', '  input x? json', 'req A "a"', '  example f {"x": {"y": [1, 2]}}',
                    '    expect result.x.y.0 = 1', '    expect result.x.y.1 ~ 2.1 +- 0.25',
                    '    expect result.x = ?', '    expect id = "A#1"', '  table f',
                    '    | x | result.x ± 0.5 |', '    | 2 | 2.25           |'))
        self.assertEqual(r['cases'][0]['checks'], [
            {'kind': 'eq', 'path': 'result.x.y.0', 'value': 1},
            {'kind': 'approx', 'path': 'result.x.y.1', 'tol': 0.25, 'value': 2.1},
            {'from': 'oracle', 'kind': 'eq', 'path': 'result.x', 'value': {'y': [1, 2]}},
            {'kind': 'eq', 'path': 'id', 'value': 'A#1'}])
        self.assertEqual(r['cases'][1]['checks'],
                         [{'kind': 'approx', 'path': 'result.x', 'tol': 0.5, 'value': 2.25}])

    def test_su005_the_oracles_whole_answer(self):
        r = cases(S(*OR, 'op f', '  input answer? json', '  audit', '  tolerance result.t 0.5',
                    '  tolerance result.u 0', 'op g', '  input answer? json', 'errors', '  e when never',
                    'req A "a"', '  example f {"answer": {"result": {"t": 1}, "audit": "A"}}',
                    '  example f {"answer": {"error": "e", "extra": 1}}', '    expect error = "e"',
                    '  example g {"answer": {"result": 2, "audit": "B"}}',
                    '  example h {"answer": {"error": "e"}}', '    expect error = "e"'))
        c = r['cases']
        self.assertEqual(c[0]['full'], {'audit': 'A', 'members': ['audit', 'id', 'result'],
                                        'result': {'t': 1},
                                        'tolerances': {'result.t': 0.5, 'result.u': 0}})
        self.assertEqual(c[1]['full'], {'error': 'e', 'members': ['error', 'extra', 'id'],
                                        'tolerances': {'result.t': 0.5, 'result.u': 0}})
        self.assertEqual(c[2]['full'], {'members': ['audit', 'id', 'result'], 'result': 2,
                                        'tolerances': {}})
        self.assertEqual(c[3]['full'], {'error': 'e', 'members': ['error', 'id'], 'tolerances': {}})
        r = cases(S(*OR, 'op f', '  input answer? json', '  audit', '  tolerance result.t 0.5',
                    'req A "a"',
                    '  example raw \'{"id":"r","op":"f","input":{"answer":{"result":{"t":1},"audit":"A"}}}\''))
        self.assertEqual(r['cases'][0]['full'], {'members': ['audit', 'id', 'result'],
                                                 'result': {'t': 1}, 'tolerances': {}})


if __name__ == '__main__':
    unittest.main()
