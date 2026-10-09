# BUILD_NOTES

## Build
Python 3.11+, standard library only; nothing to build.

Files:
- `driver.py`: the driver named in `REGEN.json` (`python3 driver.py`, `py -3 driver.py` on Windows).
- `reader.py`: lines, statements, clauses and every P diagnostic.
- `checker.py`: records, T diagnostics, running the oracle, the suite.
- `jsutil.py`: white space as ECMAScript's `\s`, JSON parsing with binary64 numbers, `JSON.stringify`-like output.
- `extract_examples.py`: regenerates `spec_examples.json` from the examples in SPEC.md.

## Test
    python3 -m unittest          (Windows: py -3 -m unittest)

- `test_duramen.py`: hand-written tests, at least one per requirement.
- `test_spec_examples.py`: runs all 168 examples of SPEC.md (snapshot in `spec_examples.json`).
- Oracle examples start `node`, so Node.js must be on the PATH for those tests (the spec's own oracle is a Node script).

## Run
    python3 driver.py < requests.jsonl

## Surprises
- REQ-SY-007 Example 5 contradicts the general "first once-only clause counts even with a problem" rule for `tolerance` (C-7); the examples won.
- The oracle needs real files, so each request's files are materialised in a temporary folder (C-21).
- A single `|` row is a table separator; this is only visible in REQ-SY-012 Example 4.
- Numbers must be written as ECMAScript writes them (`JSON.stringify`), and Python's `repr` differs, hence `js_num`.
- Only `py`/`python` commands could be run while building, so nothing was committed to git.
