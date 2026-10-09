# Build notes

## Build, test, run
- Build: nothing. Node.js 22.18+ runs the TypeScript directly by type stripping (tested on v22.22.0).
- Test: `npm test` (same as `node --test "tests/*.test.ts"`).
- Run: `node driver.ts`. It reads JSON request lines on stdin and writes one JSON response line per non-blank request.

## Layout
- `driver.ts`: stdin line reader and stdout writer.
- `src/protocol.ts`: error checks in spec order, response formatting.
- `src/json.ts`: JSON parser that keeps member order (Map), first-key position / last-key value for duplicates, and the raw text of numbers.
- `src/parse.ts`: query parser with the static function type checks.
- `src/eval.ts`: segments, selectors, filters, comparison, normalized paths.
- `src/regexp.ts`: I-Regexp validator and translator to JS `RegExp`.
- `tests/`: `jsonpath.test.ts` (spec scenarios by requirement) and `impl.test.ts` (REQ-BU checks and a driver end-to-end run).

## Surprises
- `node --test <directory>` does not work on Node 22. It tries to run the directory as a file, so a quoted glob is used.
- SPEC refers to `protocol.md` and `DECISIONS-B.md`, which are not in the folder. The interface section inside SPEC.md and DECISIONS.md stood in for them.
- Appendix C lists `Cs`, but the R27 grammar does not allow `\p{Cs}` (see CHOICES.md C-9).
- `JSON.parse` would reorder integer-like keys and lose big numbers, so the program has its own JSON parser.
- In the tests, `-0` in a parsed expectation does not `deepStrictEqual` `0`, so that one test compares paths only.
