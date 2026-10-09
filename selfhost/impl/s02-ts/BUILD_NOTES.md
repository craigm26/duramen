# Build notes

## Build, test, run
- No build step. Node.js 22.18 or later runs the TypeScript directly (type stripping).
- Test: `npm test` (runs `node --test "test/*.test.ts"`).
- Run: `node driver.ts`, which reads one JSON request per line on standard input and writes one JSON response per line. `REGEN.json` names this as the driver.

## Layout
- `driver.ts`: standard input and output loop.
- `src/protocol.ts`: request validation and the two operations.
- `src/record.ts`: which files make up a record.
- `src/reader.ts`: reading a file into lines, statements, clauses and the model (P codes).
- `src/checker.ts`: the T checks, running the oracle, and building the suite.
- `src/oracle.ts`: command splitting, a temp folder for the request's files, running the oracle.
- `src/json.ts`, `src/types.ts`: helpers and types.
- `fixtures/echo.mjs`: the oracle from the specification, used by the tests.
- `test/`: tests; every requirement has at least one (the examples of the spec are reproduced as cases).

## Surprises
- The oracle needs real files, so each request that has to run an oracle writes its files into a temp folder first.
- Line numbers in the spec examples count the `duramen`/`spec` header lines, and the tests reuse them.
- Several examples are only consistent if reading is lenient in a particular way (separator rows like `|   |` and a lone `|`; `open` items not having their examples read). See CHOICES.md.
