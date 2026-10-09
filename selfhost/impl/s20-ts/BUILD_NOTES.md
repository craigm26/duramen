# Build notes

## Layout
- `driver.ts` is the driver named in `REGEN.json`: `node driver.ts`. It reads requests from standard input as they arrive and answers each non-blank line.
- `src/handler.ts` validates a request and dispatches `check`, `cases` and `judge`.
- `src/reader.ts` reads files into a model and finds the P diagnostics (lines, statements, clauses, examples, tables).
- `src/checker.ts` resolves the record, runs the T checks and the oracle phase, and builds the suite.
- `src/oracle.ts` starts the oracle (a temporary copy of the request's files, no shell) and matches its responses.
- `src/judge.ts` is `judge`. `src/util.ts` holds JSON and path helpers.
- `fixtures/echo.mjs` is the oracle of the example records; it is copied from the spec.

## Build, test, run
- No build step. Node.js 22.18 or later runs the TypeScript directly.
- Test: `npm test` (`node:test`, files `test/*.test.ts`).
- Run: `node driver.ts`, or `npm start`.
- `test/spec-examples.json` holds the 231 examples of SPEC.md, made by `node tools/extract-examples.mjs SPEC.md test/spec-examples.json`. `test/spec.test.ts` runs them in process; every requirement has examples, so each MUST is tested there. `test/driver.test.ts` and `test/extra.test.ts` add protocol and edge tests.

## What surprised me
- Most of the work is in reading (REQ-SY-*). The examples there pin down details the prose does not, such as where P013 is reported for a header (see CHOICES.md C-12) and that a lone `|` is a separator row.
- `check` runs real child processes, so the tests take a few seconds.
- Objects built from JSON need care: a member named `__proto__` must be defined, not assigned (`setOwn` in `src/util.ts`).
- Node's `readline` is not used for input: from Node 24 it also ends lines at U+2028 and U+2029.
