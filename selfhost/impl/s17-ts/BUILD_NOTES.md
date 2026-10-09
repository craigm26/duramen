# Build notes

## Build
There is no build step. TypeScript is run by Node.js 22.18 or later through type stripping
(erasable syntax only, relative imports end in `.ts`). It was built and tested with Node 22.22.

## Run
`REGEN.json` names the driver: `node driver.ts`. It reads one JSON request per line on standard
input and writes one JSON response per line on standard output (`check`, `cases`, `judge`).
`npm start` does the same.

## Test
`npm test` runs `node --test "tests/*.test.ts"`: 51 tests, at least one for every MUST, many
taken from the examples in SPEC.md. The oracle examples run `fixtures/echo.mjs` (the fixture
SPEC.md lists under Files) through real child processes, so they need `node` on the machine.

## Layout
- `driver.ts`: the line protocol. `src/handle.ts`: request validation and dispatch.
- `src/reader.ts`: lines, statements, clauses, examples and tables (the P codes).
  `src/record.ts`: which files make a record, and the record-level P codes.
- `src/check.ts`: the T codes and the run of the oracle. `src/oracle.ts`: starting it.
- `src/line.ts` and `src/suite.ts`: request lines and cases. `src/judge.ts`: `judge`.

## Surprises
- Diagnostics at line 1 of a record name (`.`, a folder, a file) and those of a table's header
  row come at lines the text does not state; I took them from the examples (CHOICES C-21).
- The oracle runs in a temporary folder to which the request's files are written, because the
  record only exists inside the request.
- The echo fixture's `exit` makes the oracle exit non-zero after answering; its answers still
  count (REQ-OR-004).
