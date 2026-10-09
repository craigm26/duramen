# Build notes

- Python 3.11+, standard library only. Nothing to build (`build` is empty in `REGEN.json`).
- Test: `python3 -m unittest discover -s .` (Windows: `py -3 -m unittest discover -s .`).
- Run: `python3 driver.py`, with one JSON request per line on stdin and one response per line on stdout.

## Files
- `driver.py`: the line protocol and the error order.
- `jp.py`: query parser (with the well-formed and well-typed checks) and evaluator.
- `rx.py`: I-Regexp (RFC 9485) parser and matcher.
- `test_jsonpath.py`: tests for every requirement, driven through the parser, the evaluator and the real driver process.

## Surprises
- The `$.ˋa` example in REQ-SY-002 contradicts the prose rule (see C-1 in CHOICES.md); I special-cased U+02CB.
- Object members are visited in code point order, not insertion order (D-001), and Python's string sort already compares code points, so no UTF-16 fix-up is needed.
- Python's `True == 1`, so equality of JSON values has its own function that keeps booleans apart from numbers.
- Splitting stdin must be done on LF only: `str.splitlines()` would also split on U+2028 and similar characters inside a request.
