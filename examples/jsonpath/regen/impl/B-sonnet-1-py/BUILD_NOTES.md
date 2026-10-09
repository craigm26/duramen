# Build notes

- Python 3.11+, standard library only. No build step (`build` is empty in `REGEN.json`).
- Test: `python3 -m unittest discover -s . -p test_*.py` (Windows: `py -3 ...`). All tests are in `test_jsonpath.py`.
- Run: `python3 driver.py`, with JSON-lines requests on standard input.

Files:
- `jsonpath.py`: query parser (recursive descent, with the static type check done while parsing) and evaluator.
- `iregexp.py`: I-Regexp validator that translates a valid pattern to Python `re`. `\p{..}` classes are expanded to code-point ranges, computed once from `unicodedata` on first use (about 0.5 s).
- `driver.py`: the line protocol, error codes and the JSON writer.

Things that surprised me:
- The spec's own tests for REQ-BU need no extra tooling; they are plain unittest cases.
- Python's `json` module keeps document order and keeps the last value of a duplicate key at the first key's position, which is exactly what R31.3 asks for.
- Floats are parsed as `Decimal` so that numbers beyond binary64 survive; they are written as `1.5E+3`-style text (see CHOICES C-2).
- The `bool`-is-`int` trap in Python needs care in the comparison code (`kind()` checks `bool` first).
