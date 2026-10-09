# Build notes

duramen-core, version 0.5.0 of the spec, in TypeScript run by Node.js 22.18+ with type stripping. There is
no build step and there are no dependencies.

## Layout
- `REGEN.json`: `{"driver": "node driver.ts"}`.
- `driver.ts`: the line protocol (requests, errors, output).
- `reader.ts`: reads files into a model and the P diagnostics.
- `checker.ts`: record selection, the T checks, running the oracle, and `check` / `cases`.
- `fixtures/echo.mjs`: the spec's echo oracle (used by the tests).
- `test/*.test.ts`: tests (`node:test`), at least one per MUST.

## Run
- Tests: `npm test` (runs `node --test`).
- Driver: `node driver.ts`, then JSON requests on standard input, one per line.

## Surprises
- The oracle runs in the real file system, so the request's files are copied to a temporary directory
  for each check that has examples. The directory is removed afterwards.
- `|   |` and a lone `|` in a table are separators (Example 4 of REQ-SY-012 only works that way).
- Two diagnostics may be the same string (same file, line, level and code); both are kept.
- The oracle `exit` behaviour of echo.mjs makes T020 at the `oracle` line while its answers are still used.
- `import.meta.main` is used so that `driver.ts` can be imported by the tests without reading standard input.
