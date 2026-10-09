"""Runs every example of SPEC.md (snapshot in spec_examples.json) through the driver's handler."""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import driver  # noqa: E402
from jsutil import jeq, js_stringify, parse_json  # noqa: E402


def lookup(obj, path):
    cur = obj
    for name in path.split('.'):
        if isinstance(cur, dict) and name in cur:
            cur = cur[name]
        elif isinstance(cur, list) and name.isdigit() and int(name) < len(cur):
            cur = cur[int(name)]
        else:
            raise KeyError(path)
    return cur


def run_case(case):
    if 'line' in case:
        line = case['line']
    elif 'request' in case:
        line = json.dumps(case['request'])
    else:
        line = json.dumps({'id': 't', 'op': case['op'], 'input': case['input']})
    resp = json.loads(driver.respond(line) and js_stringify(driver.respond(line)))
    return resp


class SpecExamples(unittest.TestCase):
    def test_examples(self):
        with open(os.path.join(HERE, 'spec_examples.json'), encoding='utf-8') as f:
            cases = json.load(f)
        self.assertGreater(len(cases), 100)
        failures = []
        for case in cases:
            resp = run_case(case)
            for path, want in case['expect']:
                try:
                    got = lookup(resp, path)
                except KeyError:
                    failures.append('%s %s: no %s in %s' % (case['req'], case['name'], path,
                                                           js_stringify(resp)[:300]))
                    continue
                st, w = parse_json(json.dumps(want))
                if not jeq(got, w):
                    failures.append('%s %s: %s\n   want %s\n   got  %s' % (
                        case['req'], case['name'], path, js_stringify(want)[:600],
                        js_stringify(got)[:600]))
        self.assertEqual(failures, [], '\n' + '\n'.join(failures))


if __name__ == '__main__':
    unittest.main()
