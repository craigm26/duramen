# Build notes

## How to build, test and run

- **Build:** nothing. `REGEN.json` has `"build": ""`. TypeScript runs directly on Node.js 22.18 or
  later (this machine has Node 22.22.0). There is no compiler and no dependency to install.
- **Test:** `npm test`. This runs `node --test "**/*.test.ts"`. The suite has 698 tests: 669 rows
  from SPEC.md's example tables, plus the protocol, property, choice and repository checks. The
  last run passed 697 and skipped 1. The skipped row is the contradiction in CHOICES.md (C-1).
- **Run:** `node driver.ts`, which reads requests on standard input and writes responses on
  standard output. For example, a single request line:
  `{"id":"r1","op":"query","input":{"query":"$..a","document":{"x":{"a":1}}}}`.
  The response is `{"id":"r1","result":{"values":[1],"paths":["$['x']['a']"]}}`.
- **Rebuild the example fixture** (only if SPEC.md changes): `node test/extract-spec-examples.ts`.
  It rewrites `test/fixtures/spec-examples.json` from the tables in SPEC.md.

## Layout

- `driver.ts`: reads stdin, splits it into lines, and writes one response per non-blank line.
- `protocol.ts`: one request line to one response: the checks in the Errors order.
- `parse.ts`: the query grammar, the parse tree, and the typing rules (REQ-SY-009 to REQ-SY-011).
- `evaluate.ts`: segments, selectors, filters, comparisons, functions, Normalized Paths.
- `iregexp.ts`: checks an I-Regexp against RFC 9485's grammar and translates it to a JavaScript
  `u`-flag RegExp, writing every literal as a `\u{...}` escape.
- `test/`: the tests, the example fixture, and the script that makes it.

## What surprised me

- **The examples are JSON twice.** Each query cell is a JSON string, and a backslash in an I-Regexp
  or a JSONPath string literal is doubled again inside it. Read as JSON, the cells give the exact
  request text. The extractor depends on this.
- **One example contradicts the name rule.** `$.ˋa` uses U+02CB, which REQ-SY-002 allows, yet the
  row expects `invalid_query` (C-1).
- **The evidence table is short.** EV-EV-RFC shows 8 rows and says the suite checks 43 (C-2).
- **`\uD800` alone is invalid, but a raw lone surrogate is open.** The two forms are handled
  separately (C-14).
- **Function arguments need care.** A literal argument and a logical argument parse differently,
  but both end as `invalid_query` when they are wrong (C-13).

## What I could not verify

- **Type errors.** Node strips types and does not check them, and there is no `tsc` here (I may
  not install one). The code is written to type-check, but nothing has checked it.
- **Driver piped from a shell.** I tried a manual `printf | node driver.ts` check, but that
  shell command was refused by the permission policy, so I did not retry it. The driver is
  covered instead by a test that spawns `node driver.ts` with stdin, checks the lines, and checks
  exit status 0 (`test/protocol.test.ts`).
- **Windows.** The test command and `REGEN.json` are written to work there (a quoted glob that
  Node expands, and a driver of plain words), but I ran only on Linux.
- **Unicode tables.** `\p{...}` follows the JavaScript engine's Unicode version (C-12), so it is
  not checked against any other version.
