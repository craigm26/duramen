# Build notes

## Layout
- `jsonpath.py`: query parser, well-typedness checks and evaluator (RFC 9535).
- `iregexp.py`: I-Regexp (RFC 9485) validator and translator to Python `re`.
- `driver.py`: the line-oriented JSON driver named in `REGEN.json`.
- `test_jsonpath.py`, `test_escapes.py`: `unittest` tests. They cover the driver protocol and error order, every selector, filters, comparisons, functions, the I-Regexp grammar and Unicode categories, normalized paths and the integer range limits.
- `REGEN.json`: build, test and driver commands for Windows (`py -3`) and Linux (`python3`).
- `CHOICES.md`: decisions where the spec was silent or unclear.

## Build
Nothing to build (`build` is empty). Python 3.11 or later, standard library only.

## Test
    python3 -m unittest discover -s . -p "test_*.py"      (Linux)
    py -3 -m unittest discover -s . -p "test_*.py"        (Windows)

The suite takes about 6 seconds. Most of that is the first use of a `\p{..}` category class, which scans all code points once.

## Run
    python3 driver.py

Read one JSON request per line on stdin and write one JSON response per line on stdout.

## Things that surprised me
- In single-quoted strings `\"` is not allowed, and in double-quoted strings `\'` is not allowed, per the ABNF. Only the matching quote can be escaped.
- `-0` is valid as a filter number literal but not as an index or slice value.
- The ABNF permits no white space after the final segment, so `"$ "` is invalid.
- Python's `True == 1`, so comparisons need explicit type checks. I also used `Decimal` for fractional numbers to keep comparisons exact.
- The regex engine is Python `re` after translation, so pathological patterns can be slow (see C-12).
- Only `py`/`python`/`python3` commands were allowed, so I could not run the driver by hand from a shell pipe. It is exercised through subprocess in the tests instead.
- The test file on disk was rewritten by something other than me once (escape sequences turned into literal characters), so the string-escape tests live in `test_escapes.py`, built from explicit backslash constants. The old method in `test_jsonpath.py` is disabled.
