# Build notes

## Build, test, run
- Build: nothing. The TypeScript runs directly through Node's type stripping (Node 22.18+).
- Test: `npm test`, which runs `node --test tests/*.test.ts`. All 29 tests pass.
- Run: `node driver.ts`. It reads one JSON request per line on stdin and writes one JSON response per line on stdout.

```
echo '{"id":"1","op":"query","input":{"query":"$.a[*]","document":{"a":[1,2]}}}' | node driver.ts
```

## Layout
- `driver.ts`: stdin/stdout loop.
- `src/protocol.ts`: request checks and error codes, in the order the spec gives.
- `src/json.ts`: strict JSON reader/writer that keeps big numbers exact.
- `src/parse.ts`: JSONPath parser, including the validity checks (integer range, function typing).
- `src/eval.ts`: selectors, segments, filters, comparisons, functions and normalized paths.
- `src/iregexp.ts`: RFC 9485 checker and translator to a JS regexp.
- `tests/`: `node:test` suites for the protocol, the REQ-BU checks, JSONPath and I-Regexp.

Source is about 1,000 non-blank lines, well under the 3,000 limit.

## Surprises
- `node --test tests/` does not work on Node 22 (it tries to load the directory as a module), so the glob is spelled out.
- The RFC's `$..*` example table lists 13 rows for the sample document, but the document has 11 descendants. I trusted the document.
- The ABNF for singular queries has no blank space inside brackets, while `bracketed-selection` has. See C-3.
- `}` and `{` are not allowed as plain characters in an I-Regexp, so something like `a}` is invalid.
- `match()`/`search()` on a pattern that fails to compile do not make the query invalid. They return false (C-6).
- Regexes run on the JS engine, so a hostile pattern such as `(a*)*b` against a long string can still backtrack badly. I did not add a guard.
- I did not run `git init` or commit, as that was not needed.
