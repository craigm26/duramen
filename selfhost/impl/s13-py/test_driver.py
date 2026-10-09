"""Tests for the driver protocol and the JSON helpers."""
import json
import os
import subprocess
import sys
import unittest

import jsonx

HERE = os.path.dirname(os.path.abspath(__file__))
OK = 'duramen 0.1\nspec a 1\n'


def run_driver(data):
    p = subprocess.run([sys.executable, os.path.join(HERE, 'driver.py')], input=data,
                       capture_output=True, cwd=HERE, timeout=60)
    return p


class Protocol(unittest.TestCase):
    def test_one_line_per_request_in_order(self):
        reqs = [{'id': 'a', 'op': 'check', 'input': {'files': {'a.duramen': OK}}},
                {'id': 'b', 'op': 'lint', 'input': {}},
                {'id': 'c', 'op': 'cases', 'input': {'files': {'a.duramen': OK}}}]
        data = ('\n'.join(json.dumps(r) for r in reqs) + '\n').encode()
        data = data.replace(b'\n', b'\n \t\n\n')       # blank lines get no response
        p = run_driver(data)
        self.assertEqual(p.returncode, 0)
        self.assertTrue(p.stdout.endswith(b'\n'))
        self.assertNotIn(b'\r', p.stdout)
        lines = p.stdout.decode('utf-8').split('\n')[:-1]
        got = [json.loads(l) for l in lines]
        self.assertEqual(got, [
            {'id': 'a', 'result': {'diagnostics': [], 'errors': 0, 'warnings': 0}},
            {'id': 'b', 'error': 'unknown_op'},
            {'id': 'c', 'result': {'errors': 0, 'cases': []}}])

    def test_bad_lines_do_not_stop_the_driver(self):
        data = b'{not json\n[1]\n{"id":7}\n{"id":"z","op":"check","input":{"files":{"a.duramen":"duramen 0.1\\nspec a 1\\n"}}}\n'
        p = run_driver(data)
        got = [json.loads(l) for l in p.stdout.decode().split('\n')[:-1]]
        self.assertEqual(got[:3], [{'id': None, 'error': 'bad_request'}] * 3)
        self.assertEqual(got[3]['id'], 'z')
        self.assertEqual(p.returncode, 0)

    def test_crlf_request_lines_and_no_final_newline(self):
        line = json.dumps({'id': 'x', 'op': 'check', 'input': {'files': {'a.duramen': OK}}})
        p = run_driver((line + '\r\n' + line).encode())
        self.assertEqual(len(p.stdout.decode().split('\n')[:-1]), 2)

    def test_regen_json_names_a_driver(self):
        with open(os.path.join(HERE, 'REGEN.json'), encoding='utf-8') as f:
            conf = json.load(f)
        self.assertIn('default', conf['driver'])
        self.assertIn('win32', conf['driver'])
        self.assertTrue(os.path.exists(os.path.join(HERE, conf['driver']['default'].split(' ')[-1])))

    def test_non_ascii_output_is_valid_utf8_json(self):
        files = {'é.duramen': 'frobnicate\n'}
        line = json.dumps({'id': 'x', 'op': 'check', 'input': {'files': files}})
        p = run_driver((line + '\n').encode())
        got = json.loads(p.stdout.decode('utf-8'))
        self.assertIn('é.duramen:1: error P002', got['result']['diagnostics'])


class JsonHelpers(unittest.TestCase):
    def test_js_num(self):
        rows = [(1.0, '1'), (2.5, '2.5'), (-0.0, '0'), (1e21, '1e+21'), (1e20, '100000000000000000000'),
                (1.5e-7, '1.5e-7'), (0.000001, '0.000001'), (123456789012345680000.0, '123456789012345680000'),
                (0.1, '0.1'), (-3.0, '-3'), (1.7976931348623157e308, '1.7976931348623157e+308')]
        for v, want in rows:
            self.assertEqual(jsonx.js_num(v), want)

    def test_key_order(self):
        self.assertEqual(jsonx.stringify({'b': 1, '10': 2, '9': 3, 'a': 4, '01': 5}),
                         '{"9":3,"10":2,"b":1,"a":4,"01":5}')

    def test_strict_parse(self):
        for bad in ['01', '1.', '.5', '+1', 'NaN', '"\t"', "'a'", '{"a":1,}', '[1,]', '1e400', '"\\x"']:
            with self.assertRaises(jsonx.JsonError, msg=bad):
                jsonx.parse(bad)
        self.assertEqual(jsonx.parse('"\\ud83d\\ude00"'), '\U0001f600')
        self.assertEqual(jsonx.parse(' [1, {"a": -0}] '), [1.0, {'a': 0.0}])

    def test_string_writing(self):
        self.assertEqual(jsonx.js_str('a"\\\n\x01 '), '"a\\"\\\\\\n\\u0001 "')


if __name__ == '__main__':
    unittest.main()
