"""Tests for REQ-CK-*, REQ-OR-*: checking a record and running the oracle."""
import unittest

from helpers import S, check, ECHO

OR = ('duramen 0.1', 'spec s 1', 'oracle node echo.mjs')
OPF = ('op f', '  input x? json')


def t(*items):
    out = []
    for i in items:
        line, level, code = i
        out.append('s.duramen:%d: %s %s' % (line, level, code))
    return out


def E(line, code):
    return (line, 'error', code)


def W(line, code):
    return (line, 'warning', code)


class Table(unittest.TestCase):
    def run_cases(self, rows):
        for name, text, want in rows:
            with self.subTest(name):
                self.assertEqual(check(text, echo=True), want)


class Checks(Table):
    def test_ck001_every_requirement_has_an_example(self):
        self.run_cases([
            ('ex1', S('duramen 0.1', 'spec s 1', 'req A "a"', '  text', '    It MUST work.'),
             t(E(3, 'T001'))),
            ('ex2', S('duramen 0.1', 'spec s 1', 'req A "a"', '  table f', '    | x |', '    |---|'),
             t(E(4, 'P013'))),
        ])

    def test_ck002_ids_are_unique(self):
        self.run_cases([
            ('ex1', S(*OR, *OPF, 'req A "a"', '  example f {}', 'req A "again"', '  example f {}',
                      'open A "an open item may share a requirement\'s ID"', '  text', '    Open.',
                      'open B "b"', '  text', '    Open.', 'open B "b again"', '  text', '    Open.',
                      'decision D-1 "d"', '  source s', 'decision D-1 "d again"', '  source s',
                      'req C "c"', '  decision D-1', '  example f {}'),
             t(E(8, 'T007'), E(16, 'T007'), E(21, 'T007'))),
            ('ex2', {'a.duramen': S(*OR, *OPF, 'req A "a"', '  example f {}'),
                     'b.duramen': S('duramen 0.1', 'req A "a"', '  example f {}', 'op f', '  input y? json'),
                     'echo.mjs': ECHO}, ['b.duramen:2: error T007', 'b.duramen:4: error T007']),
            ('ex3', S(*OR, *OPF, 'req A "a"', '  decision REQ-A, OPEN-B', '  example f {}',
                      'decision REQ-A "named like a requirement"', '  source s',
                      'decision OPEN-B "named like an open item"', '  source s', 'open B "b"', '  text',
                      '    Open.', 'req A "a third time"', '  example f {}', 'req A "and a third"',
                      '  example f {}'), t(E(16, 'T007'), E(18, 'T007'))),
        ])

    def test_ck003_cited_decisions_are_declared(self):
        self.run_cases([
            ('ex1', S(*OR, *OPF, 'decision D-1 "d"', '  source s', 'req A "a"', '  decision D-1 D-2, D-3',
                      '  decision D-2', '  example f {}'), t(E(8, 'T008'), E(8, 'T008'))),
        ])

    def test_ck004_examples_of_declared_operations(self):
        self.run_cases([
            ('ex1', S(*OR, 'op f', '  input a number, b? number', 'errors', '  e when never', 'req A "a"',
                      '  example g {"a": 1}', '  example f {"b": 1}', '  example f {"a": 1, "c": 2}',
                      '  example f', '  example g {"answer": {"error": "e"}}', '    expect error = "e"',
                      '  example raw \'{"id": "A#6", "op": "g"}\'', '  table f', '    | b | c |',
                      '    | 1 | 2 |', '  example g {}', '    expect error.code = "e"'),
             t(E(9, 'T009'), E(10, 'T010'), W(11, 'T011'), E(12, 'T010'), E(18, 'T010'),
               W(18, 'T011'), E(19, 'T009'))),
        ])

    def test_ck005_expected_errors_are_declared(self):
        self.run_cases([
            ('ex1', S(*OR, 'op f', '  input answer? json', 'errors', '  e when never', 'req A "a"',
                      '  example f {"answer": {"error": "e"}}', '    expect error = "e"',
                      '  example f {"answer": {"error": "nope"}}', '    expect error = "nope"',
                      '  example raw \'{"id": "r", "op": "f", "input": {"answer": {"error": "other"}}}\'',
                      '    expect error = "other"', '  example f {"answer": {"error": "e"}}',
                      '    expect error = ?'), t(E(12, 'T023'), E(14, 'T023'))),
            ('ex2', S(*OR, 'op f', '  input answer? json', 'errors', '  e when never', 'req A "a"',
                      '  example f {"answer": {"error": 1}}', '    expect error ≈ 1 ± 0',
                      '  table f', '    | answer           | error ± 1 |',
                      '    | {"error": 2}     | 2         |', '    | {"error": "e"}   | ?         |'),
             t(E(10, 'T023'), E(13, 'T023'))),
        ])

    def test_ck006_obligations_live_in_requirements(self):
        self.run_cases([
            ('ex1', S('duramen 0.1', 'spec s 1', '  text', '    The program MUST work.', 'op f',
                      '  result what it MUST return', 'errors', '  e when it SHALL fail',
                      'section S "It MUST be titled"', '  text', '    REQUIRED reading.', 'note', '  text',
                      '    This note says `MUST`, "SHALL" and “REQUIRED”, MUSTARD and must.',
                      'decision D-1 "d"', '  source s', '  text', '    Fine.',
                      '  rejected "Another MUST."', 'open O "o"', '  text', '    It MUST NOT be.'),
             t(E(2, 'T004'), E(5, 'T004'), E(8, 'T004'), E(9, 'T004'), E(15, 'T004'), W(15, 'T012'),
               W(20, 'T014'))),
            ('ex2', S('duramen 0.1', 'spec s 1', 'decision D-1 "d"', '  source s', '  text', '    It MUST.',
                      '  rejected "It SHALL."', '  rejected "It is REQUIRED."'),
             t(E(3, 'T004'), E(3, 'T004'), E(3, 'T004'), W(3, 'T012'))),
            ('ex3', S('duramen 0.1', 'spec s 1', 'errors', '  e when the "MUST', '    hold" rule fails',
                      '  f when the "MUST hold" rule fails', 'note', '  text', '    A MUST-have.',
                      'section S "s"', '  text', '    MUSTé'),
             t(E(4, 'T004'), E(7, 'T004'), E(10, 'T004'))),
            ('ex4', S('duramen 0.1', 'spec s 1', 'section T "t"', '  text',
                      '    It ``MUST`` be, and it `MUST` not.'), t(E(3, 'T004'))),
        ])

    def test_ck007_open_items_are_not_tested(self):
        self.run_cases([
            ('ex1', S('duramen 0.1', 'spec s 1', 'open O "o"', '  example f {}', '  table f', '    | x |',
                      '    | 1 |', '  example f {not json', '    expect nothing at all', '  table g h',
                      '    | {bad |'), t(E(4, 'T003'), E(5, 'T003'), E(8, 'T003'), E(10, 'T003'))),
        ])

    def test_ck008_order_of_errors_stated_once(self):
        head = (*OR, *OPF, 'errors', '  too_big when x > 9', '  too_small when x < 0')
        self.run_cases([
            ('ex1', S(*head, 'req A "a"', '  text',
                      '    A request that is too_big gets too_big, and one too_small gets too_small.',
                      '  example f {}', 'req B "b"', '  text', '    too_big is checked Before too_small.',
                      '  example f {}', 'req C "c"', '  text', '    too_big is checked first.',
                      '    After that, nothing.', '  example f {}', 'req D "d"', '  text',
                      '    too_big and too_small are checked in this', '    order.', '  example f {}'),
             t(E(14, 'T005'), E(23, 'T005'))),
            ('ex2', S(*OR, *OPF, 'errors', '  e when x', '  f when y', 'req A "a"', '  text',
                      '    A request may be refused before it is read: see the errors list.',
                      '  example f {}'), []),
            ('ex3', S(*head, 'req A "a"', '  text', '    too_bigé, then too_small: decided before-hand.',
                      '  example f {}', 'req B "b"', '  text', '    xtoo_big and too_small2 come after.',
                      '  example f {}'), t(E(10, 'T005'))),
        ])

    def test_ck009_decisions(self):
        self.run_cases([
            ('ex1', S(*OR, *OPF, 'decision D-1 "uncited, no source"', 'decision D-2 "bad status"',
                      '  source s', '  status Accepted', 'decision D-3 "superseded by nothing"',
                      '  source s', '  status superseded', 'decision D-4 "superseded by an undeclared one"',
                      '  source s', '  status superseded by D-9', 'decision D-5 "superseded properly"',
                      '  source s', '  status superseded by D-6', 'decision D-6 "accepted, with more words"',
                      '  source s', '  status accepted on 2026-01-01', 'decision D-7 "observed"',
                      '  source s', '  status observed', 'req A "a"',
                      '  decision D-2, D-3, D-4, D-5, D-6, D-7', '  example f {}'),
             t(W(6, 'T012'), W(6, 'T013'), E(7, 'T027'), E(10, 'T027'), E(13, 'T027'), E(25, 'T028'),
               E(25, 'T028'), E(25, 'T028'), W(25, 'T028'))),
            ('ex2', S(*OR, *OPF, 'decision D-1 "a comma after the word"', '  source s',
                      '  status accepted, 2026-01-01', 'decision D-2 "an empty status"', '  source',
                      '  status', 'req A "a"', '  decision D-1, D-2', '  example f {}'),
             t(E(6, 'T027'), W(9, 'T013'), E(9, 'T027'))),
            ('ex3', S('duramen 0.1', 'spec s 1', 'req A "a"', '  decision D, E', '  text', '    T.',
                      'decision D "d"', '  source x', '  status superseded  by E', 'decision E "e"',
                      '  source x', '  status Accepted'),
             t(E(3, 'T001'), E(3, 'T028'), E(7, 'T027'), E(10, 'T027'))),
            ('ex4', S(*OR, *OPF, 'req A "a"', '  decision D', '  example f {}', 'decision D "d"',
                      '  source x', '  status rejected', 'decision D "d again"', '  source x',
                      'decision E "e"', '  source x', 'decision E "e again"', '  source x'),
             t(E(6, 'T028'), E(12, 'T007'), W(14, 'T012'), E(16, 'T007'), W(16, 'T012'))),
        ])


class Oracle(Table):
    def test_or001_record_with_examples_has_an_oracle(self):
        self.run_cases([
            ('ex1', S('duramen 0.1', 'spec s 1', *OPF, 'req A "a"', '  example f {}',
                      '    expect result = 1'), t(E(2, 'T019'))),
            ('ex2', S('duramen 0.1', 'spec s 1', *OPF, 'req A "a"', '  text', '    No example.',
                      'req B "b"', '  example f {}'), t(E(2, 'T019'), E(5, 'T001'))),
        ])

    def test_or002_how_the_oracle_is_run(self):
        self.run_cases([
            ('ex1', S('duramen 0.1', 'spec s 1', '  request {"clock": 1}', 'oracle node echo.mjs', 'op f',
                      '  input line? boolean, x? json', 'req A "a"',
                      '  example f {"line": true,  "x": 2.50}',
                      '    expect result = "{\\"id\\":\\"A#1\\",\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true,  \\"x\\": 2.50}}"',
                      '  example f {"line": true}', '    omit id',
                      '    expect result = "{\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true}}"',
                      '  example raw \'{"id": "x",  "op": "f", "input": {"line": true}}\'',
                      '    expect id = "x"',
                      '    expect result = "{\\"id\\": \\"x\\",  \\"op\\": \\"f\\", \\"input\\": {\\"line\\": true}}"'),
             []),
            ('ex4', S(*OR, 'op f', '  input say? string', 'req A "a"',
                      '  example raw \'{"id": "r1", "op": "f", "input": {"say": " \\u00a0\\n{\\"id\\": \\"elsewhere\\", \\"result\\": 1}\\n\\t"}}\'',
                      '    expect result = 1',
                      '  example raw \'{"id": "r2", "op": "f", "input": {"say": "{\\"id\\": \\"r2\\", \\"result\\": 1}\\r\\n"}}\'',
                      '    expect result = 1',
                      '  example raw \'{"id": "r3", "op": "f", "input": {"say": "{\\"result\\": 1}\\r{\\"result\\": 2}"}}\'',
                      '    expect result = ?',
                      '  example raw \'{"id": "r4", "op": "f", "input": {"say": "{\\"result\\": 1}\\n[2]"}}\'',
                      '    expect result = ?'), t(E(11, 'T021'), E(13, 'T021'))),
        ])
        self.assertEqual(check({'sub/s.duramen': S('duramen 0.1', 'spec s 1', 'oracle node "my echo.mjs"',
                                                   'op f', '  input x? json', 'req A "a"',
                                                   '  example f {"x": 1}', '    expect result.x = 1'),
                                'sub/my echo.mjs': ECHO}), [])

    def test_or003_examples_the_oracle_disagrees_with(self):
        self.run_cases([
            ('ex1', S(*OR, 'op f', '  input x? json, y? json, answer? json', 'req A "a"',
                      '  example f {"x": 1.0, "y": [5, {"z": null}]}',
                      '    expect result = {"y": [5, {"z": null}], "x": 1}',
                      '    expect result.y.1.z = null', '    expect result.y.0 ≈ 5.5 ± 0.5',
                      '    expect result.x = 2', '    expect result.y.2 = 5',
                      '    expect result.y.0 ≈ 5.5 ± 0.4', '    expect result.y.1 = {}',
                      '  example f {"answer": {"result": 0, "audit": "{\\"a\\": [1, 2]}"}}',
                      '    expect audit.a.1 = 2', '    expect audit = "{\\"a\\": [1, 2]}"',
                      '    expect audit.b = 1', '  table f', '    | x | result.x | result.y |',
                      '    | 1 | 2        | 3        |', '  example f {"x": {"": 1}}',
                      '    expect result.x. = 1', '    expect result..x = 1', '  example f {"y": [7, 8]}',
                      '    expect result.y.1 = 8', '    expect result.y.length = 2',
                      '    expect result.y.01 = 8'),
             t(E(11, 'T002'), E(12, 'T002'), E(13, 'T002'), E(14, 'T002'), E(18, 'T002'), E(21, 'T002'),
               E(21, 'T002'), E(24, 'T002'), E(27, 'T002'), E(28, 'T002'))),
            ('ex2', S(*OR, 'op f', '  input answer? json', 'errors', '  e when never', 'req A "a"',
                      '  example f {"answer": {"result": 1}}', '    expect error = "e"',
                      '  example g {"answer": {"error": "e"}}', '    expect error = "e"'),
             t(E(10, 'T002'))),
            ('ex3', S(*OR, 'op f', '  input answer? json, x? json', 'req A "a"',
                      '  example f {"answer": {"result": 1, "audit": "{\\"a\\": 1e400, \\"b\\": 1}"}}',
                      '    expect audit.b = 1', '    expect audit.a = ?', '  example f {"x": 2}',
                      '    expect result.x ≈ 1.9 ± 0.1',
                      '    expect result.x ≈ 1.9 ± 0.10000000000000009', '  example f {"x": 1}',
                      '    expect result.x ≈ -8.673617379884035e-19 ± 1'),
             t(E(8, 'T002'), E(9, 'T025'), E(11, 'T002'))),
        ])

    def test_or004_an_oracle_that_fails(self):
        self.run_cases([
            ('ex1', S('duramen 0.1', 'spec s 1', 'oracle no-such-program-for-duramen', *OPF, 'req A "a"',
                      '  example f {}'), t(E(3, 'T020'), E(7, 'T021'))),
            ('ex2', S(*OR, 'op f', '  input x? json, exit? integer', 'req A "a"', '  example f {"x": 1}',
                      '    expect result.x = 2', '  example f {"exit": 3}', '    expect result.exit = 3'),
             t(E(3, 'T020'), E(8, 'T002'))),
            ('ex3', S(*OR, 'op f', '  input exit? integer', 'req A "a"', '  example f {}',
                      '  example raw \'{"id": "r", "op": "f", "input": {"exit": 4}}\''), t(E(8, 'T020'))),
            ('ex4', S('duramen 0.1', 'spec s 1', 'oracle no-such-program-for-duramen', *OPF, 'req A "a"',
                      '  example raw \'{"id": "r", "op": "f"}\''), t(E(7, 'T020'), E(7, 'T021'))),
            ('ex5', S('duramen 0.1', 'spec s 1', 'oracle node "echo.mjs', *OPF, 'req A "a"', '  example f {}'),
             t(E(3, 'T020'), E(7, 'T021'))),
        ])

    def test_or005_examples_with_no_answer(self):
        self.run_cases([
            ('ex1', S(*OR, 'op f', '  input silent? boolean', 'req A "a"', '  example f {"silent": true}',
                      '  example f {}',
                      '  example raw \'{"id": "r", "op": "f", "input": {"silent": true}}\''),
             t(E(7, 'T021'), E(9, 'T021'))),
            ('ex2', S(*OR, 'op f', '  input say string', 'req A "a"',
                      '  example f {"say": "{\\"id\\":\\"A#1\\",\\"result\\":1e400}"}', '    expect result = ?',
                      '  example f {"say": "{\\"id\\":\\"A#2\\",\\"result\\":1e300}"}', '    expect result = ?'),
             t(E(7, 'T021'))),
        ])

    def test_or006_oracle_cannot_compute(self):
        self.run_cases([
            ('ex1', S(*OR, 'op f', '  input answer? json', 'req A "a"',
                      '  example f {"answer": {"oracle_error": "left open"}}', '    expect result = 1',
                      '    expect result = ?'), t(E(7, 'T022'))),
            ('ex2', S(*OR, 'op f', '  input answer? json', 'req A "a"',
                      '  example f {"answer": {"oracle_error": null, "error": "x"}}'), t(E(7, 'T022'))),
        ])

    def test_or007_unexpected_errors(self):
        self.run_cases([
            ('ex1', S(*OR, 'op f', '  input answer? json', 'errors', '  e when never', 'req A "a"',
                      '  example f {"answer": {"error": "e"}}', '  example f {"answer": {"error": "e"}}',
                      '    expect error = "e"'), t(W(9, 'T024'))),
            ('ex2', S(*OR, 'op f', '  input answer? json', 'req A "a"',
                      '  example f {"answer": {"error": null}}'), t(W(7, 'T024'))),
        ])
        r = __import__('helpers').ask('check', {'files': {'s.duramen': S(*OR, 'op f', '  input answer? json',
                                                                         'req A "a"',
                                                                         '  example f {"answer": {"error": null}}'),
                                                          'echo.mjs': ECHO}})
        self.assertEqual(r['result']['errors'], 0)
        self.assertEqual(r['result']['warnings'], 1)

    def test_or008_values_from_the_oracle(self):
        self.run_cases([
            ('ex1', S(*OR, *OPF, 'req A "a"', '  example f {"x": 1}', '    expect result.x = ?',
                      '    expect result.y = ?'), t(E(9, 'T025'))),
        ])


if __name__ == '__main__':
    unittest.main()
