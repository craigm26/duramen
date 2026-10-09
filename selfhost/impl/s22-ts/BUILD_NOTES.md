# Build notes

duramen-core 0.11.0, built from SPEC.md and DECISIONS.md only.

## Build

There is no build step. The sources are TypeScript run directly by Node.js 22.18 or later
through type stripping (erasable syntax only, `.ts` extensions on relative imports). There are
no dependencies, so there's nothing to install.

## Run

The driver is what `REGEN.json` names: `node src/driver.ts`, started in this folder. It reads
one JSON request per line on standard input and writes one JSON response per line on standard
output, then exits with status 0 at end of input. `npm run serve` starts it too.

```
{"id":"1","op":"check","input":{"files":{"s.duramen":"duramen 0.1\nspec s 1\n"}}}
```

## Test

```
npm test
```

This runs `node --test "test/**/*.test.ts"`:

- `test/spec.test.ts` reads every example out of SPEC.md (the multi-file examples, the bullet
  examples, raw request lines, and the `judge` tables) and runs each through the request
  handler, asserting every value the example states. Tests are grouped by requirement ID, and
  one test checks that every `REQ-` has at least one example read. It also checks that
  `fixtures/echo.mjs` matches the fixture SPEC.md shows under Files, byte for byte.
- `test/driver.test.ts` starts the driver as REGEN.json names it and checks the protocol:
  one response per non-blank line, in order, LF endings and no CR, `id: null` for unparsable
  lines, exit status 0, and a last line without LF.
- `test/choices.test.ts` covers edges the examples don't show and the choices in CHOICES.md.

## Layout

- `src/driver.ts`: standard input/output loop.
- `src/handle.ts`: request validation (the Errors list) and dispatch to `check`, `cases`, `judge`.
- `src/record.ts`: which files make up the record, and their order.
- `src/parse.ts`: reading: lines, statements, clauses, examples, tables; the P diagnostics.
- `src/check.ts`: T checks, running examples through the oracle, request lines, cases.
- `src/oracle.ts`: oracle command splitting, starting it, the temporary folder it runs in.
- `src/judge.ts`: the `judge` operation.
- `src/json.ts`, `src/diag.ts`: shared helpers.
- `fixtures/echo.mjs`: the echo oracle from SPEC.md, used by the tests.

## Surprises

- Every one of the 241 examples in SPEC.md passed on the first full run. The examples are
  dense enough that most of the work went into reading the words closely, not into debugging.
- The oracle needs real files: records travel inside requests, but `oracle node echo.mjs` has
  to run a file on disk. So every check that runs examples writes the request's files to a
  temporary folder first, and removes it afterwards.
- `__proto__` has to be handled throughout: request members, input paths and tolerance paths
  can all be named `__proto__`, so objects are built with `Object.defineProperty`, never by
  plain assignment.
- Request-member order follows JavaScript object order on purpose (integer-like names first).
  The spec says so outright, so a plain object gives the right order for free.
- `JSON.parse` turns `1e400` into `Infinity` and never fails on it, so "too large for binary64"
  is detected by walking the parsed value for non-finite numbers.
- Wherever the spec says "white space", it means ECMAScript `\s`, including U+2028/U+2029. So no
  regex in the reader uses `.`; they use `[^]`, `\s` and `\S`.
- The oracle's timeout (60 s) is not tested, because a test would have to wait that long.
