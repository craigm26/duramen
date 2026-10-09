# Build notes

- Needs Node.js 22.18 or later. There is no build step and nothing to install.
- Test: `npm test` (runs `node --test`, which finds `jsonpath.test.ts`).
- Run: `node src/driver.ts`. It reads one JSON request per line on stdin and writes one JSON response per line on stdout.
- `REGEN.json` names the driver, an empty build and the test command.

## Layout

- `src/parse.ts`: query parser (RFC 9535 grammar), including the well-typedness rules for function expressions.
- `src/eval.ts`: segments, selectors, filters, functions and Normalized Paths.
- `src/iregexp.ts`: I-Regexp (RFC 9485) validator that emits a JavaScript `u`-flag RegExp.
- `src/handle.ts`: one request line to one response line. `src/driver.ts`: stdin/stdout loop.

## Surprises

- The `$.ˋa` example (U+02CB) contradicts the prose rule for dot names (CHOICES C-1).
- `EV-EV-RFC` says 43 rows but SPEC.md lists only the first 8.
- In the `length` examples, the second `"é"` is the decomposed form (`e` + U+0301); the spec renders both alike.
- Several spec examples hold invisible characters (U+0085, U+00A0); I used escapes in the tests.
- The tool rules allow no `cat` or heredocs, so files were written with the file-writing tool, not the shell.
