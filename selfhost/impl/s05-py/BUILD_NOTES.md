# Build notes

## Layout
- `REGEN.json` names the driver: `python3 driver.py` (`py -3 driver.py` on Windows).
- `driver.py` starts `duramen_core.main()`: one JSON request per line on stdin, one response per line on stdout.
- `duramen_core.py`: request validation, record resolution, the T checks, the oracle run, `cases`.
- `reader.py`: lines, statements, clauses and every P diagnostic.
- `jsutil.py`: ECMAScript-compatible JSON (number printing, key order, white space set).
- `fixtures/echo.mjs` is the spec's oracle; `fixtures/echo.py` is a Python twin.

## Build
Nothing to build. Python 3.11 or later, standard library only.

## Test
`python3 -m unittest test_duramen` (on Windows `py -3 -m unittest test_duramen`).
Tests that use an oracle run `node echo.mjs` when `node` is on the PATH, else the Python twin.

## Run
`python3 driver.py < requests.jsonl`

## Surprises
- The oracle has to be a real process in a real folder, so the request's files are written to a temporary folder for each check. Nothing is left behind.
- Python's `str.splitlines`, `str.strip` and `\s` differ from ECMAScript's white space (U+2028 is not a line break here, U+FEFF is white space, U+0085 is not), so `jsutil.py` has its own white space set and the line splitter only breaks on CR and LF.
- All JSON numbers are parsed as floats and printed the way `JSON.stringify` does, so `2.50e0` becomes `2.5` when an input is rebuilt from `input` lines, but stays as written otherwise.
- The spec's own examples are the main test material; the line numbers in them are easy to mis-count by one.
- 29 choices are in CHOICES.md; the shakiest ones are about raw examples (C-4, C-5), input paths (C-8) and comment lines (C-11).
