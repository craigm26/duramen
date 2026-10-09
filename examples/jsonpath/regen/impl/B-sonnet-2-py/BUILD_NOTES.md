# Build notes

## Layout
- `jsonpath.py`: query parser (character-level recursive descent), evaluator, normalized paths, and an I-Regexp parser/matcher.
- `driver.py`: the JSON-lines protocol driver (`handle_line` is the testable core).
- `test_jsonpath.py`: unittest suite (one test group per requirement R1–R32 plus REQ-BU checks).
- `REGEN.json`: build/test/driver commands (Windows `py -3`, default `python3`).

## Build
Nothing to build (`build` is empty). Python 3.11+, standard library only.

## Test
    python3 -m unittest discover -s . -p "test_*.py"      (Windows: py -3 -m unittest discover -s . -p test_*.py)

## Run
    python3 driver.py      # reads request lines on stdin, writes one response line each

## Notes and surprises
- Python's `json` already gives the duplicate-key and key-order behaviour the spec wants; numbers are kept as text objects (`Num`) so big or odd numbers round-trip.
- Python's `in` with an empty string is always true (`"" in "abc"`), so the parser's end-of-input checks use sets/tuples, not strings, for membership.
- The I-Regexp matcher is a set-of-positions simulation rather than a translation to `re`, which avoids needing per-category range tables for `\p{..}` and avoids catastrophic backtracking.
- The spec text refers to `protocol.md`, `DECISIONS-B.md` and `SPEC-B.md`, which were not provided; see C-1 in CHOICES.md.
