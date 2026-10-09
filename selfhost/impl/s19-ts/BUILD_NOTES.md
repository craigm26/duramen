# Build notes

## Build

There is no build step. The sources are TypeScript that Node.js 22.18 or later runs directly
by type stripping (erasable syntax only, `.ts` relative imports). There are no dependencies,
so there is nothing to install.

## Run

The driver is named in `REGEN.json`:

    node src/driver.ts

It reads one JSON request per line on standard input and writes one JSON response per line
on standard output. When input ends it exits with status 0. `npm start` runs the same
command. Node prints an ExperimentalWarning about type stripping to standard error, which
the protocol leaves free.

## Test

    npm test

This runs `node --test "test/**/*.test.ts"`:

- `test/spec-examples.test.ts` takes **every example in SPEC.md** out of the text and runs it
  through the request handler, grouped by requirement ID. That covers the numbered examples
  with their texts, the bullet examples (including raw request lines and requests with no
  `id` or no `input`), and the `judge` tables. It also checks that every REQ has at least
  one example. The extractor is `test/spec-examples.ts`, and it takes the echo fixture from
  the Files section of SPEC.md.
- `test/driver.test.ts` starts the driver named in REGEN.json as a separate process. It
  checks ordering, blank lines, `bad_request` with `id: null`, CR LF input, a final line
  with no LF, U+2028 inside a line, UTF-8 output with no CR, and exit status 0.
- `test/choices.test.ts` pins the choices in CHOICES.md and tests the helpers behind
  several MUSTs: quotations for T004, phrases for T005, table rows, input paths, oracle
  command splitting, and T020 with responses still used.

## Layout

- `src/driver.ts`: the stdin/stdout loop, which handles requests one at a time in order.
- `src/protocol.ts`: request validation (the Errors list) and dispatch.
- `src/read.ts`: reading a record (lines, statements, clauses, every P diagnostic) into a model.
- `src/check.ts`: record selection (REQ-RC-001), the T checks, planning and judging oracle runs, request lines and cases.
- `src/oracle.ts`: oracle command splitting, the temporary folder, and running the process.
- `src/judge.ts`: the `judge` operation.
- `src/json.ts`: JSON helpers (finite-number parsing, equality, path reading).

## Surprises

- The spec examples carry their own oracle (`fixtures/echo.mjs`). So the checker really has
  to write the request's files to disk and run `node` on them. The examples are executable
  end to end, and about a third of the suite exercises process handling.
- JSON's object model does a lot of the work. "The order ECMAScript keeps the members of an
  object" means plain JS objects plus `JSON.stringify` give the right request-member order,
  with integer-like names first, for free. Because member names such as `__proto__` can
  come from records, members are set with `Object.defineProperty`.
- `JSON.parse` turns `1e400` into `Infinity` without complaint. REQ-SY-013 is therefore
  enforced by walking every parsed value for numbers that are not finite.
- Example 4 of REQ-SY-012 has a row `|   |`. It contains only `|` and white space, so it is
  a separator and is skipped, not a row of empty cells. The same goes for a row that is a
  single `|`.
- In REQ-SY-012 Example 3, a row indented three spaces gets P006 even though the table it
  belongs to also gets P013 ("nothing else in the table is checked"). P006 is decided line
  by line, before the table is read.
- The "first statement counts even when malformed" rule (REQ-RC-004) applies to `spec` too:
  `spec s` as a second spec gets both P021 and P044.
- Everything in the core runs in well under a second per request apart from oracle runs.
  The whole test suite takes about 4 seconds.
