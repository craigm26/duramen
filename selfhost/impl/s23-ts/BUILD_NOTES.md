# BUILD_NOTES

## Layout
- `REGEN.json` names the driver: `node driver.ts` (Node.js 22.18+, type stripping, no build step).
- `driver.ts` reads request lines on standard input (split at LF only) and writes one response line each.
- `src/server.ts` validates requests (Errors section) and dispatches `check`, `cases`, `judge`.
- `src/reader.ts` reads files into a model and the P diagnostics (REQ-SY-*, REQ-RC-003/004).
- `src/checker.ts` resolves the record (REQ-RC-001/002), runs the T checks, runs the oracle and builds the suite.
- `src/judge.ts` is `judge`; `src/json.ts` holds JSON helpers (path lookup, equality, the binary64 rule).
- `fixtures/echo.mjs` is the spec's oracle fixture, used only by the tests.

## Test
`npm test` (runs `node --test "test/*.test.ts"`). One test per requirement, built from the spec's own examples; `test/helpers.ts` is not a test file.

## Run
`node driver.ts < requests.jsonl`

## Surprises
- Record files live only in the request, but an oracle is a real program: the checker writes the files to a temp folder under the system temp directory for each request that runs an oracle, and deletes it afterwards (CHOICES C-2). The tests therefore need a writable temp directory and `node` able to start itself.
- Object member order matters in two places: request lines (ECMAScript order, integer-like names first) and `tolerances` with the name `__proto__`. Objects that take user-chosen names are filled with `Object.defineProperty` or null-prototype objects.
- Examples are small enough that the spec's own diagnostics lists fully determine many reading details (which line a table problem is reported at, for instance); the words alone did not.
- The task rules allow only `node`, `npm`, `mkdir`, `ls`, `git` as commands, so files were written with the editor tool and no shell redirection.
