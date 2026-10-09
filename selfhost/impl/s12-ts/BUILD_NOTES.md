# Build notes

## Build, test, run
- No build step. Needs Node.js 22.18 or later (developed on 22.22), which strips types itself.
- Test: `npm test` (runs `node --test "tests/*.test.ts"`). The tests include the examples from SPEC.md, and `fixtures/echo.mjs` is the oracle the spec shows under Files.
- Run: `node src/driver.ts` reads one JSON request per line on standard input and writes one response per line. `REGEN.json` names this command as the driver.

## Layout
- `src/driver.ts`: line protocol. `src/service.ts`: request validation and the three operations.
- `src/reader.ts`: lexing, statements, clauses, all P diagnostics, the model. `src/check.ts`: T checks, oracle runs, case generation. `src/judge.ts`: `judge`. `src/util.ts`: JSON helpers.
- `tests/*.test.ts`: one test per requirement, mostly taken from the spec's examples.

## Things that surprised me
- Records travel as texts, but the oracle is a real program, so the request's files are written to a temporary directory for each `check`/`cases` request that runs examples (CHOICES C-1).
- Diagnostics are plain strings such as `s.duramen:3: error P002` and are sorted by file, line, code, level.
- Imports of types need `import type`, since type stripping does not remove ordinary imports.
- Sorting uses default JS string comparison, which is UTF-16 code unit order, as the spec asks.
- A bare `|` row in a table is a separator, not an empty row.
