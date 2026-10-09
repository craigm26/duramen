"""The suite end to end through the driver (REQ-SU-001 to REQ-SU-005, REQ-OR-002)."""
import json
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ECHO = open(os.path.join(HERE, 'fixtures', 'echo.mjs'), encoding='utf-8').read()


def drive(reqs):
    data = ''.join(json.dumps(r) + '\n' for r in reqs).encode('utf-8')
    p = subprocess.run([sys.executable, 'driver.py'], input=data, stdout=subprocess.PIPE, cwd=HERE, timeout=120)
    return [json.loads(l) for l in p.stdout.decode('utf-8').split('\n') if l]


SRC = ('duramen 0.1\nspec s 1\n  request {"clock": "c", "trace": true}\noracle node echo.mjs\n'
       'op f\n  input x? json\nreq A "a"\n  example f {"x" : 2.50e0 }\n    expect result.x ≈ 2.5 ± 0.1\n'
       '  example raw "{\\"id\\":\\"r\\",\\"op\\":\\"f\\",\\"input\\":{\\"x\\":\\"\\ud800\\"}}"\n'
       '    expect result.x = ?\n')


class Suite(unittest.TestCase):
    def test_cases_through_the_driver(self):
        out = drive([{'id': '1', 'op': 'cases', 'input': {'files': {'s.duramen': SRC, 'echo.mjs': ECHO}}}])
        res = out[0]['result']
        self.assertEqual(res['errors'], 0)
        c0, c1 = res['cases']
        self.assertEqual(c0['id'], 'A#1')
        self.assertEqual(c0['line'], '{"id":"A#1","op":"f","clock":"c","trace":true,"input":{"x" : 2.50e0 }}')
        self.assertEqual(c0['checks'], [{'path': 'result.x', 'kind': 'approx', 'value': 2.5, 'tol': 0.1}])
        self.assertEqual(c0['full'], {'members': ['id', 'result'], 'result': {'x': 2.5}, 'tolerances': {}})
        self.assertNotIn('solo', c0)
        self.assertEqual(c1['id'], 'A#2')
        self.assertTrue(c1['solo'])
        self.assertEqual(c1['checks'], [{'path': 'result.x', 'kind': 'eq', 'value': '�', 'from': 'oracle'}])

    def test_no_cases_when_errors(self):
        bad = SRC + 'req B "b"\n'
        out = drive([{'id': '1', 'op': 'cases', 'input': {'files': {'s.duramen': bad, 'echo.mjs': ECHO}}},
                     {'id': '2', 'op': 'check', 'input': {'files': {'s.duramen': bad, 'echo.mjs': ECHO}}}])
        self.assertEqual(out[0]['result'], {'errors': 1, 'cases': []})
        self.assertEqual(out[1]['result']['diagnostics'], ['s.duramen:12: error T001'])

    def test_judge_the_oracle_against_its_own_cases(self):
        out = drive([{'id': '1', 'op': 'cases', 'input': {'files': {'s.duramen': SRC, 'echo.mjs': ECHO}}}])
        case = out[0]['result']['cases'][0]
        answer = {'id': 'A#1', 'result': {'x': 2.5}}
        out = drive([{'id': '2', 'op': 'judge', 'input': {'case': case, 'answer': answer}}])
        self.assertEqual(out[0]['result'], {'pass': True})

    def test_oracle_working_folder_is_the_folder_of_its_file(self):
        src = SRC.replace('oracle node echo.mjs', 'oracle node "my echo.mjs"')
        out = drive([{'id': '1', 'op': 'check', 'input': {'files': {'sub/s.duramen': src, 'sub/my echo.mjs': ECHO}}}])
        self.assertEqual(out[0]['result']['diagnostics'], [])


if __name__ == '__main__':
    unittest.main()
