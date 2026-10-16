# Build notes

duramen-core, built only from SPEC.md and DECISIONS.md. TypeScript run by Node.js through type
stripping: no build step, no dependencies.

## Run

    node src/driver.ts          # the driver named by REGEN.json: JSON requests on stdin, responses on stdout

## Test

    npm test                    # node --test "tests/*.test.ts"

The tests run the request handler in process (and one test starts the driver as a child process).
They cover every requirement (REQ-*) of SPEC.md with the examples of the spec, plus a few more.
Tests that need an oracle write `fixtures/echo.mjs` (the spec's echo oracle) into the request's
files; the checker copies the request's files into a temporary folder and runs the oracle there.

## Layout

- `src/driver.ts`: stdin/stdout loop, one request at a time, in order.
- `src/handle.ts`: one request line to one response; the `bad_request` / `unknown_op` rules.
- `src/reader.ts`: record, files, lines, statements, clauses; all P diagnostics and the model.
- `src/check.ts`: T checks, running the oracle, and building the suite (`cases`).
- `src/judge.ts`: `judge`.
- `src/util.ts`: JSON helpers (paths, equality, numbers too large for binary64).
- `fixtures/echo.mjs`: the spec's oracle for the example records.

## Surprises

- `JSON.parse` turns `1e400` into infinity, which makes REQ-SY-013 easy: parse, then look for a
  non-finite number. Building objects needs `defineProperty` because of `__proto__` keys.
- JS `.` does not match U+2028/U+2029, so patterns use `[\s\S]` for any character; `\s`, `trim`
  and the spec's white space list agree.
- The spec's ECMAScript member order (integer-like names first) comes for free from building a real
  object and writing its keys.
- Many P-diagnostics depend on the exact indent of a line; the clause splitter keeps blank lines
  in a clause so text blocks and input texts can keep or drop them.
- The oracle batch run and the "alone" runs each start a Node process, so a record with several
  solo examples takes a few hundred milliseconds per solo example.
