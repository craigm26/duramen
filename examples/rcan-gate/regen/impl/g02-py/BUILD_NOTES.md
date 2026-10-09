# Build notes

- Build: nothing (`build` is empty). Python 3.11+, standard library only.
- Test: `python3 -m unittest discover -p "test_*.py"` (Windows: `py -3 -m ...`), run in this folder.
- Run: `python3 driver.py`, reading one JSON request per line on stdin.
- Files: `gate.py` (validation and decision logic), `driver.py` (line protocol), `test_gate.py`.

Notes:
- Numbers are parsed with `parse_int=float` so integers beyond 2^53 round to binary64 as REQ-RQ-005 asks.
- Booleans are rejected as numbers by testing `type(v) is float` (Python's `bool` is an `int`).
- The state's `seen` is pruned on every path, including refusals and ESTOP, as the examples show.
- Numbers that overflow binary64 (`1e400`) reject the whole line (OPEN-OP-001, untested; see C-2).
