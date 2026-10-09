# Build notes

- Node.js 22.18 or later; TypeScript runs through type stripping, so there is no build step.
- Run: `node driver.ts` (named by `REGEN.json`); it reads request lines on standard input and writes one response line each.
- Test: `npm test` (`node --test "tests/*.test.ts"`). `tests/spec-examples.test.ts` replays every example of SPEC.md,
  read from `tests/spec-examples.json`; `tests/driver.test.ts` holds the protocol tests and a few extras.
- `npm run extract` (`node tools/extract-examples.ts`) rebuilds `tests/spec-examples.json` and `fixtures/echo.mjs` from SPEC.md.
- Layout: `src/read.ts` reads a file into statements and P diagnostics, `src/analyze.ts` selects the record and runs the T checks,
  the oracle and the suite, `src/oracle.ts` runs the oracle in a temporary folder, `src/handle.ts` validates requests.

Surprises:
- Node 22's `node --test` does not accept a directory; the test script uses a glob.
- D-017's "a first once-only clause with a problem still counts" contradicts REQ-SY-007 example 5 for `tolerance` (see C-1).
- The examples cannot be told from the model's output when a record has several oracle runs, so the oracle is real: the request's files
  are written to a temporary folder and run there.
