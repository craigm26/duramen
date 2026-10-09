# Build notes

## Layout
- `duramen_core.py`: reading, checking, oracle runs and suite generation.
- `duramen_driver.py`: the driver (stdin/stdout protocol). `REGEN.json` names it:
  `python3 duramen_driver.py` (`py -3 duramen_driver.py` on Windows).
- `fixtures/echo.mjs`: the oracle shown in SPEC.md, used by the tests.
- `test_duramen.py`: unittest tests; at least one per requirement, most taken from the spec's examples.

## Build, test, run
- No build step; Python 3.11+, standard library only.
- Test: `python3 -m unittest test_duramen` (on Windows `py -3 -m unittest test_duramen`).
  The tests that run an oracle need `node` on the PATH and are skipped without it.
- Run: `python3 duramen_driver.py`, one JSON request per line on standard input.

## Notes
- The oracle in the spec's examples is a Node.js program, so those examples really start `node`.
- The records arrive as texts, so for an oracle run the files are written to a temporary folder first.
- Surprises: the position of P013 differs (table line vs header line); the tests derived from the
  spec's examples fixed this. Some diagnostics are the same code on the same line more than once
  (e.g. several T002 on one table row), so diagnostics are a list, not a set.
- Choices that the spec leaves open are recorded in CHOICES.md.
