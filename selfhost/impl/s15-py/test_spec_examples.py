"""Runs every example of SPEC.md (extracted into spec_examples.json by
tools/extract_examples.py) through the implementation."""
import json
import os
import unittest

import duramen

HERE = os.path.dirname(os.path.abspath(__file__))


def lookup(obj, path):
    cur = obj
    for seg in path.split('.'):
        if isinstance(cur, dict):
            if seg not in cur:
                return duramen.NONE
            cur = cur[seg]
        elif isinstance(cur, list):
            if int(seg) >= len(cur):
                return duramen.NONE
            cur = cur[int(seg)]
        else:
            return duramen.NONE
    return cur


class SpecExamples(unittest.TestCase):
    def test_examples(self):
        with open(os.path.join(HERE, 'spec_examples.json'), encoding='utf-8') as fh:
            cases = json.load(fh)
        self.assertGreater(len(cases), 200)
        for c in cases:
            with self.subTest(src=c['src']):
                if 'raw' in c:
                    line = c['raw']
                elif 'op' in c and 'input' in c and 'request' not in c:
                    line = json.dumps({'id': 'x', 'op': c['op'], 'input': c['input']})
                else:
                    line = json.dumps(c['request'])
                resp = duramen.handle_line(line)
                resp = json.loads(json.dumps(resp))
                for path, want in c['expect'].items():
                    got = lookup(resp, path)
                    self.assertTrue(got is not duramen.NONE and duramen.jeq(got, want),
                                    '%s: %s: got %r want %r' % (c['src'], path, got, want))


if __name__ == '__main__':
    unittest.main()
