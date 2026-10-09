# BUILD_NOTES

## Layout
- `duramen.py`: the whole checker (reader, checks, oracle runner, suite generator, judge, request handling).
- `driver.py`: the driver protocol (JSON lines on standard input and output).
- `REGEN.json`: `{"driver": {"default": "python3 driver.py", "win32": "py -3 driver.py"}}`.
- `fixtures/echo.mjs`: the example oracle from SPEC.md, used by the tests (needs Node.js).
- `test_*.py`: unittest tests.

## Build
Nothing to build. Python 3.11+, standard library only.

## Test
    python3 -m unittest discover -p "test_*.py"      (Windows: py -3 -m unittest discover -p "test_*.py")

`test_spec_examples.py` reads the numbered `check`/`cases` examples out of SPEC.md (164 of them) and runs
each; it is skipped when SPEC.md is absent. The other files cover the protocol, `judge`, number and string
writing, and a suite run through the driver. Tests that run an oracle need `node` on the PATH.

## Run
    python3 driver.py < requests.jsonl

## Notes
- Files of a record only exist in the request, so `check` writes all of them to a temporary folder to run
  the oracle there (C-17). Checking a record with examples therefore starts `node` once per run (once for
  the batch plus once per solo example).
- All JSON numbers in records are read as binary64 floats; ones that overflow are refused where the spec
  says so. Output numbers and strings are written the way `JSON.stringify` writes them (own writer),
  including the `\u` escape of lone surrogates and ECMAScript's order of object members.
- What surprised me: the sentence about header names that are "also" input fields (C-6); that `|` alone is
  a table separator; that lines under an unknown statement still get P001; that the first read pass has
  to wait for all operations before tables can be classified (tables are expanded after reading).
