# Build notes

## Build, test, run
- Build: nothing. TypeScript runs directly through Node's type stripping, Node 22.18 or later (developed on 22.22). `REGEN.json` has an empty `build`.
- Test: `npm test` (the same as `node --test "tests/*.test.ts"`). There are 29 tests: one group per requirement R1–R32 with the spec's scenarios, one for the folder requirements REQ-BU-001..004, and one spawning the real driver.
- Run: `node driver.ts` reads JSON-lines requests on stdin and writes one response line per request on stdout.

## Layout
- `driver.ts`: stdin/stdout loop.
- `jsonpath.ts`: request validation, error order, response formatting.
- `json.ts`: order-preserving JSON parser (object members in a `Map`, duplicate names last-value-first-position, numbers kept as source text) and the serializer.
- `query.ts`: recursive-descent query parser over code points, with the static type check and the singular-query check.
- `evaluate.ts`: segment, selector and filter evaluation, comparison, and normalized paths.
- `iregexp.ts`: I-Regexp validator and translator to `RegExp`.
- `package.json` only sets `"type": "module"` and the test script. There are no dependencies.

## Surprises
- `JSON.parse` could not be used at all: it reorders integer-like keys, loses precision on big numbers and cannot see duplicate keys. Both the request and the document go through `json.ts`.
- The grammar has real ambiguity between a function argument that is a bare query and a logical expression (DECISIONS 13). Parsing every argument as a full logical expression and classifying it afterwards was the simplest correct approach (see C-7).
- All spec scenarios I transcribed passed on the first run. Regex catastrophic backtracking is the one known weak point (C-11).
