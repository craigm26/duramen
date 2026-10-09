# Build notes

## Layout
- `jsonpath.py`: query parser and validator (syntax, integer range, function typing), evaluator, normalized paths.
- `iregexp.py`: strict RFC 9485 parser and a non-backtracking matcher used by `match()` and `search()`.
- `driver.py`: the line protocol (`python3 driver.py`, or `py -3 driver.py` on Windows).
- `test_jsonpath.py`: all tests, including protocol tests that start the driver as a subprocess.
- `REGEN.json`: build, test and driver commands. Python only, standard library only, no build step.

## Build, test, run
- Build: nothing.
- Test: `python3 -m unittest discover` (Windows: `py -3 -m unittest discover`), run in this folder.
- Run: `python3 driver.py`, with one JSON request per line on stdin.

## Surprises
- RFC 9535 allows `\"` only inside double-quoted strings and `\'` only inside single-quoted ones. It is easy to write tests that break this.
- Python's `True == 1`, and `bool` is an `int`, so equality had to be written by hand, with the JSON type compared first.
- In I-Regexp, `^` and `$` are ordinary characters, not anchors, and `]` and `}` are not allowed bare outside classes. Translating to Python `re` would have needed care, so I wrote my own matcher.
- Whether a trailing space in a query is an error depends on how the ABNF `segments = *(S segment)` is read. See C-5.
- Shell pipelines were not available in this environment, so the driver was exercised only through the unit tests that start it as a subprocess, not by hand.
