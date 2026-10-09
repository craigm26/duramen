# Build notes

## Layout
- `driver.py` — the driver named in `REGEN.json` (reads requests on stdin, writes responses on stdout).
- `reader.py` — reads files into statements, clauses, examples and tables (P diagnostics).
- `checker.py` — checks a record (T diagnostics), runs the oracle, builds the suite for `cases`.
- `jsutil.py` — JSON helpers that match ECMAScript (number printing, key order, white space).
- `test_duramen.py` — unittest suite, at least one test for every MUST (it embeds the spec's `echo.mjs`).

## Build / run / test
- No build step. Python 3.11+, standard library only.
- Run: `python3 driver.py` (Windows: `py -3 driver.py`), in this folder.
- Test: `python3 -m unittest test_duramen` (Windows: `py -3 -m unittest test_duramen`).
- The oracle examples need `node` on PATH; those tests are skipped when it is missing.

## Things that surprised me
- A second `request` line in an example is P052 only when an earlier one was valid (spec example SY-010/3).
- Lines `|   |` and `|` are table separators (table example 4).
- `T028` still applies when a status also gets `T027`.
- The record's files must be written to a temporary folder for the oracle, since a record only exists in the request.
