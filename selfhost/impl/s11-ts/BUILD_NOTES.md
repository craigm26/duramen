# Build notes

## Build

There is no build step. The sources are TypeScript with erasable syntax only, and Node.js 22.18 or later runs them directly by type stripping. The program has no dependencies and needs no `npm install`.

## Run

The driver is named in `REGEN.json` as `node driver.ts`. It reads one JSON request per line on standard input and writes one JSON response per line:

    node driver.ts < requests.jsonl

Example request:

    {"id":"1","op":"check","input":{"files":{"s.duramen":"duramen 0.1\nspec s 1\n"}}}

## Test

    npm test

This runs `node --test "tests/*.test.ts"`:

- `tests/spec-examples.test.ts`: all 168 examples of SPEC.md. They are sent to one driver process, started from `REGEN.json` the way a judge starts it, and each expectation is compared as parsed JSON.
- `tests/musts.test.ts`: further tests for the MUSTs of each requirement beyond its examples, and for the choices in CHOICES.md (named `C-<n>`).
- `tests/driver.test.ts`: the protocol: order, blank lines, LF/no CR, exit status, and the error codes.
- `tests/units.test.ts`: the small parsers (command words, table cells, input paths, fields, quotations, paths into responses).

`tests/spec-examples.json` is generated from SPEC.md and committed. To regenerate it after SPEC.md changes:

    npm run extract

## Layout

- `driver.ts`: reads standard input and writes responses, in order.
- `src/protocol.ts`: validates requests (the Errors list) and dispatches them.
- `src/files.ts`: request files as a folder: relative paths, the files of a record, and their order.
- `src/reader.ts`: lines, statements and clauses, which give all P codes.
- `src/checker.ts`: T codes, and running the examples through the oracle.
- `src/oracle.ts`: splitting the oracle command, the temporary folder and the child process.
- `src/suite.ts`: request lines and the cases of `cases`.
- `src/ops.ts`: `check` and `cases`, and the order of diagnostics.

## What surprised me

- The oracle has to actually run. Many examples need `node echo.mjs` to start from the request's files, so the checker writes all of them to a temporary folder for each record that runs examples. This is the slowest part (one Node start per run), and the spec-examples suite takes about 10 s for that reason.
- The general rule and an example disagree on whether a second `tolerance` for a path gets P052 when the first one was malformed (C-11). I followed the example.
- ECMAScript member order matters for request lines (integer-like names first, SU-003 Example 1). Building the members in a null-prototype object and writing `id`/`op` by hand gives exactly that, and also handles `__proto__` safely.
- Floating point shows up in `≈` checks: 2 is not within 0.1 of 1.9 in binary64 (C-30). One of my own tests tripped on it.
- Every example in SPEC.md passed on the first full run. Most of the work went into reading the corners (comments at odd indents, dropped examples whose lines are still read, raw examples whose `input` lines are only P022), not into debugging.
