# BUILD_NOTES

## Layout
- `driver.py`: the driver named by `REGEN.json` (requests in on stdin, one response per line out).
- `jsutil.py`: ECMAScript-style white space, JSON parsing (numbers as floats, too-large numbers refused), `JSON.stringify`-style output, path lookup.
- `reader.py`: reading a record (lines, statements, clauses, examples, tables): all P diagnostics.
- `checker.py`: entry resolution, the T checks, running the oracle, building the suite, ordering diagnostics.
- `judge.py`: the `judge` operation.
- `fixtures/echo.mjs`: the spec's oracle fixture; `fixtures/echo.py`: a Python port used by the tests.
- `test_duramen.py`: the tests (spec examples plus one or more per MUST).

## Build
Nothing to build: Python 3.11 or later, standard library only.

## Test
    python3 test_duramen.py        (Windows: py -3 test_duramen.py)

The tests swap the spec's `oracle node echo.mjs` for the Python port so they need no Node.js. One test runs the real `fixtures/echo.mjs` when `node` is installed.

## Run
    python3 driver.py < requests.jsonl

## Things that surprised me
- The spec's records run the oracle with `node echo.mjs` from files that travel inside the request, so the checker writes every request file to a temporary folder before starting the oracle.
- A table row of only `|` and white space is a separator wherever it stands, so `|   |` is skipped, not a one-cell row.
- A header-cell problem (P013, P010) is reported at the header row's line, not the `table` line; "too few rows" and a bad op are at the `table` line.
- A dropped raw example (`example raw x`) still counts as raw for its `input` lines (P022 and no file read).
- Python's `str.strip()` and `\s` differ from ECMAScript's `\s`; the code builds its own white space class.
- Running `python3 -I -m unittest test_duramen` fails to import the module because `-I` removes the current folder from the path; run the file directly.
