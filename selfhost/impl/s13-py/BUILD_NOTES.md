# Build notes

## Layout
- `REGEN.json`: names the driver (`py -3 driver.py` on Windows, `python3 driver.py` elsewhere).
- `driver.py`: reads one JSON request per line on standard input and writes one response per line.
- `jsonx.py`: strict JSON reader (numbers as binary64, a number too large to be finite is an error unless allowed), JSON.stringify-style writer, ECMAScript number formatting, value equality.
- `reader.py`: reads files into statements and clauses and reports the P codes.
- `checker.py`: finds the record's files, runs the T checks, runs the oracle, builds the suite, and judges answers.
- `fixtures/echo.mjs`: the oracle from SPEC.md (needs Node.js, only for the tests).
- `CHOICES.md`: what I chose where the spec was silent or unclear.

## Build
Nothing to build. Python 3.11 or later and the standard library only.

## Test
    python3 -m unittest discover -p "test_*.py"     (on Windows: py -3 -m unittest discover -p "test_*.py")

The tests for the oracle (T002, T020 to T025, and the suite) start `node fixtures/echo.mjs`, as the spec's examples do, so Node.js must be on the PATH for them. Everything else needs only Python. `test_read.py`, `test_check.py`, `test_suite.py` and `test_judge.py` hold the spec's examples, one test per requirement; `test_driver.py` checks the stream protocol and the JSON helpers; `test_fuzz.py` mutates a record and checks nothing crashes.

## Run
    python3 driver.py < requests.jsonl

## Surprises
- The spec's examples are exact enough to run as tests: all of them passed with only two bugs of mine at first (a file record was returned as a tuple, and `expect` did not skip the space after the keyword).
- A record that is read without errors can still send a request to the oracle that has no `id` (`omit id`); such a run is "solo" and its response is the only line the oracle writes.
- `input ... from` lines have no text, but the same line under a raw example still gets P006 for indented lines below it, while a plain `input` line under a raw example swallows its text silently.
- Output is pure ASCII (escaped), which keeps the stream valid UTF-8 even for lone surrogates.
- Only commands `py`/`python`/`python3`, `mkdir`, `ls` and `git` are allowed here, so files were created with the editor tools and not with shell redirection.
