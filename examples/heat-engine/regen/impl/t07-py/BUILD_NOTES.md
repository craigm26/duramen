# Build notes

- Build: nothing (`build` is empty in REGEN.json). Python 3.11+, standard library only.
- Test: `python3 -m unittest discover -s .` (Windows: `py -3 -m unittest discover -s .`).
- Run: `python3 driver.py` reads request lines on stdin and writes one response line each.
- Files: `heat.py` (all logic: number text, toFixed, canonical JSON, wet-bulb, flags, request handling),
  `driver.py` (stdin/stdout loop), `test_heat.py` (tests, mostly through the real driver).

Notes:
- Python's `repr` gives the shortest digits, so ECMAScript number text is built from it; `toFixed` is done
  with exact `Fraction` arithmetic, rounding ties up.
- JSON is parsed with `parse_int=float` so `20`, `20.0` and `2e1` are the same value.
- A bare `NaN` token is rejected (Python's `json` accepts it by default).
- My own tests cover the spec's examples and properties on small random samples, not the full evidence tables
  (38 and 22 rows), which are not reproduced in SPEC.md.
- Shell commands other than `py`/`python`/`mkdir`/`ls`/git were refused, so files were written with the editor tools.
