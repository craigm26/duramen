"""Mutated records never make the checker fail (OPEN-RQ-004 aside)."""
import json
import random
import unittest

import driver
from helpers import ECHO

BASE = '''duramen 0.1
spec s 1
  request {"clock": 1}
oracle node echo.mjs
op f
  input x? json, y? json
  tolerance result.x 0.5
  audit
errors
  e when never
decision D "d"
  source s
  status accepted
req A "a"
  decision D
  text
    Words.
  example f {"x": 1}
    input y.k
      text
    expect result.x = 1
    expect result.x ~ 1 +- 0.5
    request {"a": 1}
    omit clock
  table f
    | x | result.x ± 0.5 | y |
    |---|---|---|
    | 1 | ? | 2 |
  example raw '{"id":"r","op":"f"}'
open O "o"
  example f {}
'''
CHARS = list(' \t\n"{}[]|\\#0123456789abcxyzf.,:?±≈~=+-')


class Fuzz(unittest.TestCase):
    def test_mutated_records(self):
        rnd = random.Random(7)
        for i in range(150):
            s = list(BASE)
            for _ in range(rnd.randint(1, 6)):
                k = rnd.randrange(len(s))
                r = rnd.random()
                if r < 0.4:
                    del s[k]
                elif r < 0.8:
                    s.insert(k, rnd.choice(CHARS))
                else:
                    s[k] = rnd.choice(CHARS)
            text = ''.join(s)
            for op in ('check', 'cases'):
                r = driver.handle(json.dumps({'id': 'x', 'op': op,
                                              'input': {'files': {'s.duramen': text, 'echo.mjs': ECHO}}}))
                self.assertIn('result', r, text)


if __name__ == '__main__':
    unittest.main()
