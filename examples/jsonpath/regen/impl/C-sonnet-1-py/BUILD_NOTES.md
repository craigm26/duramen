# Build notes

- Build: nothing to build (`build` is empty in REGEN.json). Python 3.11+, standard library only.
- Test: `python3 -m unittest discover -p "test_*.py"` (on Windows `py -3 -m unittest discover -p test_*.py`). 47 tests pass, covering every REQ and the three kinds of property.
- Run: `python3 driver.py` reads one JSON request per line on stdin and writes one response per line on stdout.
- Files: `jsonpath.py` (query parser, type checker, evaluator), `iregexp.py` (I-Regexp parser and backtracking matcher), `driver.py` (protocol), `test_jsonpath.py`.

Surprises:
- `$.ˋa` (U+02CB) must be rejected, contradicting the "U+0080 and up" prose of REQ-SY-002 (CHOICES C-1).
- Python's `"" in " \t"` is true, so empty-string peeks need explicit guards. I handled these.
- The descendant order is a pre-order walk of the visited nodes. The RFC-style example `$..*` shows a node's children listed before its descendants, one node at a time.
- I did not use Python's `re`: `\p{..}` is not supported there, and the I-Regexp grammar differs from it.
- Bash was restricted to python/mkdir/ls, so all files were written with the editor tool.
