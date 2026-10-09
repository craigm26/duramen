# BUILD NOTES

## Build

Nothing to build. The program is TypeScript that Node.js runs directly through type stripping:
erasable syntax only, `.ts` relative imports, no compiler, no dependencies. It needs Node.js
22.18 or later (built and tested with 22.22.0).

## Run

`REGEN.json` names the driver: `node driver.ts`, started in this folder. It reads one JSON
request per line on standard input and writes one JSON response per line on standard
output:

    echo '{"id":"1","op":"check","input":{"files":{"a.duramen":"duramen 0.1\nspec a 1\n"}}}' | node driver.ts

`npm start` does the same. Set `DURAMEN_ORACLE_TIMEOUT_MS` to change the 60-second limit on
one run of an oracle (CHOICES.md C-9).

## Test

    npm test

This runs `node --test "test/**/*.test.ts"`:

- `test/spec-examples.test.ts` reads every example out of SPEC.md and sends them all through
  the driver, as REGEN.json names it. That covers the 160 block examples, the 46 one-line
  examples and the 26 rows of the judge tables. It checks every value the spec states. It
  also asserts that no example went unread, and that every `REQ-` has at least one example.
  So every MUST is tested by the spec's own examples. The echo oracle is taken from the
  spec's Files section.
- `test/driver.test.ts` covers the driver protocol: blank lines, order, exit status, CR LF
  input, no CR in the output, U+2028 inside a line, a last line without LF, and the shape
  of responses.
- `test/choices.test.ts` pins the choices in CHOICES.md (C-1 to C-20) and some corners the
  spec's examples do not reach.

All 262 tests pass.

## Layout

- `driver.ts`: stdin/stdout loop. Requests are handled one at a time, in order.
- `src/protocol.ts`: validates requests (the Errors list) and dispatches them.
- `src/record.ts`: which files make the record, and in what order.
- `src/reader.ts`: lines, statements, clauses, and every P diagnostic.
- `src/checks.ts`: the T checks that need no oracle.
- `src/oracle.ts`: builds request lines, runs the oracle, and reports T002 and T020 to T025.
- `src/check.ts`: the `check` and `cases` operations.
- `src/judge.ts`: the `judge` operation.
- `src/util.ts`: JSON equality, path reading, ECMAScript member order.

## Surprises

- U+2028 and U+2029 broke my own test harness before they broke the checker. JavaScript's
  `.` does not match them, so one SPEC.md example silently fell out of my extractor until a
  count check caught it. D-018 describes exactly this trap in duramen itself. The checker
  uses `[^]`, `/s` and `trimEnd()` throughout for that reason.
- `trimEnd()` removes exactly the set SY-001 calls white space (ECMAScript WhiteSpace plus
  LineTerminator), and it avoids the quadratic backtracking of `/\s+$/` on long lines.
- A request member named `"2"` has to go after `id` and `op`, but JavaScript objects put such
  names first. The request line is therefore assembled by hand, with ECMAScript ordering
  applied only to the members between `op` and `input`.
- An example's input is written into the request line as the original text, not
  re-serialised. A table row's input is assembled from the cell texts. Only input lines
  force `JSON.stringify`.
- The spec's examples were enough to pin almost everything. All 232 examples passed on the
  first full run once the extractor was right. The work was mostly in deciding the corners
  CHOICES.md lists.
