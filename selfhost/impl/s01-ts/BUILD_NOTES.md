# Build notes

## Layout
- `REGEN.json`: `{"driver": "node src/driver.ts"}`; the driver speaks the protocol of SPEC.md.
- `src/driver.ts`: reads stdin, one response per non-blank line. `src/handle.ts`: request validation and the two operations.
- `src/reader.ts`: reads files into a record (P diagnostics). `src/checker.ts`: record selection, T checks, running the oracle, suite generation. `src/util.ts`: helpers.
- `fixtures/echo.mjs`: the oracle from the spec, used by the tests.
- `tests/*.test.ts`: `node:test` tests; at least one per MUST (one test per REQ).

## Build, test, run
- No build step. Needs Node.js 22.18 or later (type stripping).
- Test: `npm test` (runs `node --test "tests/*.test.ts"`).
- Run: `node src/driver.ts` and write one JSON request per line on standard input.

## Notes
- The oracle is started with `spawnSync` in a temporary copy of the request's files (see C-2), so a request blocks while its oracle runs (limit 30 s).
- Surprises: REQ-RC-006 example 1 shows line numbers that do not match its displayed file (C-1). Node 22's `--test` needs a glob (a directory argument fails).
