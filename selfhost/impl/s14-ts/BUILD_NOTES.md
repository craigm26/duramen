# BUILD_NOTES

## Layout
- `REGEN.json`: `{"driver": "node src/driver.ts"}`; Node.js 22.18+ runs the TypeScript directly (type stripping), no build step.
- `src/driver.ts`: the stdin/stdout protocol, request validation, `check`, `cases`, `judge` dispatch.
- `src/reader.ts`: reads a file into the record model and emits the P diagnostics.
- `src/checker.ts`: record resolution (REQ-RC-001/002), T checks, oracle runs, request lines, cases.
- `src/oracle.ts`: command splitting, temp-folder sandbox, running the oracle, reading its responses.
- `src/judge.ts`: the `judge` comparison. `src/util.ts`, `src/model.ts`: helpers and types.
- `test/*.test.ts`: tests. `test/spec-examples.json` holds every example of SPEC.md (extracted by `tools/extract-examples.ts`) and `test/spec-examples.test.ts` replays them all through the driver. `test/protocol.test.ts` holds the hand-written tests (protocol errors, entries, REQ-SU-003 table rows, ...).
- `tools/`: `extract-examples.ts` regenerates the JSON from SPEC.md; `debug*.ts` are small helpers I used to look at one example.

## Build, test, run
- No build.
- `npm test` (= `node --test "test/*.test.ts"`), about a minute of wall time at most; the tests start the driver and many oracle processes.
- Run: `node src/driver.ts`, requests one JSON per line on stdin.

## Surprises
- The spec's examples are machine-readable enough to extract: that gave 223 cases for almost no work, and found two bugs in my own extractor before it found any in the program.
- The oracle fixture is a real program, so the checker must write the request's files to disk (C-1).
- `spawnSync` with `stdio` given explicitly together with `input` worked, but I dropped `stdio` while chasing an empty fixture (the real cause was my extractor); stderr of the oracle is therefore captured and ignored.
- Reading is the bulk of the work; the T checks are short.
