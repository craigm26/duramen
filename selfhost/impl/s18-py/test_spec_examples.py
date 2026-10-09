"""Runs the numbered examples of SPEC.md (the `check` and `cases` ones that list their texts) against
the implementation. Skipped when SPEC.md is not next to this file."""
import json
import os
import re
import unittest

import duramen

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = os.path.join(HERE, 'SPEC.md')

HEAD = re.compile(r'^Example (\d+): `(check|cases)` with input `(.*)` and these texts:$')
TEXT = re.compile(r'^`input\.files\.(".*")`:$')
FIXTURE = re.compile(r'^`input\.files\.(".*")`: the file `fixtures/echo\.mjs`')


def load_examples():
    with open(SPEC, encoding='utf-8') as fh:
        lines = fh.read().split('\n')
    echo = open(os.path.join(HERE, 'fixtures', 'echo.mjs'), encoding='utf-8').read()
    out = []
    section = ''
    i = 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith('**REQ-') or ln.startswith('**OPEN-'):
            section = ln[2:ln.index('.**')]
        m = HEAD.match(ln)
        if not m:
            i += 1
            continue
        num, op, inp = m.group(1), m.group(2), json.loads(m.group(3))
        files = dict(inp.get('files', {}))
        i += 1
        expect = None
        while i < len(lines):
            ln = lines[i]
            f = FIXTURE.match(ln)
            t = TEXT.match(ln)
            if f:
                files[json.loads(f.group(1))] = echo
            elif t:
                name = json.loads(t.group(1))
                i += 2
                assert lines[i] == '```', (section, num, lines[i])
                i += 1
                body = []
                while lines[i] != '```':
                    body.append(lines[i])
                    i += 1
                files[name] = '\n'.join(body) + '\n'
            elif ln.startswith('⟶ '):
                expect = ln[2:]
                break
            elif ln.startswith('Example ') or ln.startswith('**'):
                break
            i += 1
        if expect is not None:
            ins = {'files': files}
            if 'entry' in inp:
                ins['entry'] = inp['entry']
            out.append(('%s example %s' % (section, num), op, ins, expect))
        i += 1
    return out


def parse_expect(text):
    text = text.strip()
    assert text.startswith('`') and text.endswith('`'), text
    pairs = []
    for piece in text[1:-1].split('`; `'):
        path, val = piece.split('` = `', 1)
        pairs.append((path, json.loads(val)))
    return pairs


@unittest.skipUnless(os.path.exists(SPEC), 'SPEC.md not present')
class SpecExamples(unittest.TestCase):
    def test_examples(self):
        n = 0
        for label, op, ins, expect in load_examples():
            with self.subTest(label):
                resp = duramen.handle({'id': 'x', 'op': op, 'input': ins})
                self.assertIn('result', resp, resp)
                for path, want in parse_expect(expect):
                    cur = resp
                    for seg in path.split('.'):
                        cur = cur[int(seg)] if isinstance(cur, list) else cur[seg]
                    self.assertTrue(duramen.jeq(cur, want), '%s: got %r want %r' % (path, cur, want))
                n += 1
        self.assertGreater(n, 100)


if __name__ == '__main__':
    unittest.main()
