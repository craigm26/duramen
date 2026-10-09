# BUILD NOTES

## What this is
`duramen-core` 0.7.0: the duramen checker for the core of the language, built from SPEC.md,
DECISIONS.md and PROMPT.md. It answers the two operations of the Interface (`check` and
`cases`) through the driver that REGEN.json names. Every decision the spec left open is in
CHOICES.md.

## Requirements
- Node.js 22.18 or later (built and tested on v22.22.0). TypeScript is run directly through
  type stripping: there is no build step and no compiler, and no dependencies to install.
- Erasable syntax only: no enums, namespaces or parameter properties. Relative imports carry
  the `.ts` extension.

## Layout
- `REGEN.json`: `"driver": "node src/serve.ts"`.
- `package.json`: `test` runs `node --test src/*.test.ts`; `serve` starts the driver.
- `src/serve.ts`: the driver. Reads requests on stdin, writes one response line per request on
  stdout, in order, and exits 0 after the last one.
- `src/check.ts`: the two operations (`check`, `cases`) and the shared analysis.
- `src/structure.ts`, `src/read.ts`, `src/examples.ts`, `src/table.ts`: reading a file into
  statements, clauses, examples and tables, and reporting the P codes.
- `src/files.ts`, `src/jsonpath.ts`, `src/text.ts`: names, records, paths into JSON, and JSON
  helpers (including detection of numbers too large for binary64).
- `src/checks.ts`: the T codes that need no oracle, and the comparison of answers with
  expectations.
- `src/oracle.ts`: running the oracle (batch and solo runs), matching responses.
- `src/requests.ts`, `src/cases.ts`: request lines, and the suite.
- `src/*.test.ts`: the tests (see below). `src/testkit.ts` is a helper, not a test file.
- `fixtures/echo.mjs`: the oracle from SPEC.md's Files section, verbatim.

## How to build, test and run
- Build: nothing to do.
- Test: `npm test` (102 tests, all passing at the time of writing).
- Run the driver: `node src/serve.ts`, then send request lines on stdin, for example
  `{"id":"1","op":"check","input":{"files":{"a.duramen":"duramen 0.1\nspec a 1\n"}}}`.
  The response is one line: `{"id":"1","result":{"diagnostics":[],"errors":0,"warnings":0}}`.

## Tests
The test files follow the spec's own sections: `driver.test.ts` (REQ-RQ-001/002 and the Errors
list, plus a test that starts the driver as a process), `records.test.ts` (REQ-RC-001 to 006),
`syntax.test.ts` (REQ-SY-001 to 003, 005, 006), `statements.test.ts` (REQ-SY-004, 007 to 013),
`checks.test.ts` (REQ-CK-001 to 009 and REQ-OR-001 to 008), and `suite.test.ts` (REQ-SU-001 to
005). Almost every test is one of the spec's own examples, with the spec's own expected
result. Each REQ has at least one test; not every sentence of every MUST has its own test.

## What surprised me
- The spec's REQ-SY-010 Example 6 shows that a malformed `example raw` line still makes its
  `input` lines raw-example lines (P022, not P048). A plain reading of "dropped" would not get
  this; the reader keeps a separate "raw form" flag for it.
- REQ-SY-007 Example 5 contradicts the text about tolerance paths (see CHOICES.md C-14). I
  followed the example.
- The spec does not say what the implementation folder must contain beyond REGEN.json's
  `driver` (CHOICES.md C-1). I chose the layout above.
- An oracle runs in the folder of its statement's file, and the record's `echo.mjs` is not a
  `.duramen` file, so it is not part of the record. The checker writes all the request's files
  to a temporary folder for each run, so the oracle can read them (CHOICES.md C-21).
- Several examples in the spec only work because the oracle sits in the same folder as the
  statement (for example `sub/echo.mjs` for `sub/s.duramen`).
- The spec's examples were the main check. Running them found two faults in the code: a
  tolerance path counted when its tolerance was invalid, and an oracle-less record that also got
  T021. A third was found by reading the spec while writing a test, before any run: the dropped
  raw example above. One test failure was my own mistake (the oracle was in the wrong folder).
- Each oracle run is capped at 10 seconds (CHOICES.md C-20).

## Not done
- `git init`, `git add` and `git commit` were not run: the task did not ask for them.
- The rest of the language (OPEN-RC-001, OPEN-SU-001) is not implemented, as the spec leaves it
  open.
