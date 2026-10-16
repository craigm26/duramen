# Build notes

## Run and test

- Needs Node.js 22.18 or later (built on 22.22). No build step, no dependencies: TypeScript runs through type stripping.
- Driver: `node src/driver.ts` (named in `REGEN.json`); it reads one JSON request per line on standard input and writes one response per line.
- Tests: `npm test` (runs `node --test "tests/*.test.ts"`).
  - `tests/spec-examples.test.ts` replays every example of SPEC.md, taken from `tests/fixtures/spec-examples.json`.
  - `tests/must.test.ts` has direct tests for each requirement and driver tests.
- `tools/extract-examples.ts` regenerates the fixture from SPEC.md (`node tools/extract-examples.ts`). `tests/fixtures/echo.mjs` is the oracle fixture from SPEC.md's Files section.

## Layout

- `src/protocol.ts`: request validation and the response of one line. `src/driver.ts` only wires it to standard input and output.
- `src/reader.ts`: lines, statements, clauses, and every P diagnostic; produces a model.
- `src/checker.ts`: T checks, the oracle run and `check`. `src/oracle.ts` runs the oracle command.
- `src/suite.ts`: `cases`. `src/judge.ts`: `judge`. `src/util.ts`: JSON helpers and path lookup.

## Notes

- The oracle runs by writing the request's files to a temp directory and spawning the command there, so `node` must be on the PATH.
- What surprised me: `.` in a JavaScript regex does not match U+2028/U+2029, which the spec says may appear anywhere; the reader uses `[\s\S]` for that. The example extractor tripped on it too.
- Every choice the spec left open is in CHOICES.md.
