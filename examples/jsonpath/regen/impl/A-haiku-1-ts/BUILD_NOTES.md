# Build, test and run

## Requirements
- Node.js 22.18 or later (developed and tested on v22.22.0). Type stripping is on by default, so there is no compiler or build step.
- Nothing to install. There is no `node_modules`, lock file, or dependency.

## Build
Nothing to build. `REGEN.json` has `"build": ""`.

## Test
```
npm test
```
or the command REGEN.json names, `node --test "**/*.test.ts"`. The suite runs in about two seconds and has 56 tests. All pass.

## Run
The driver reads requests from standard input and writes one response line per request:
```
node driver.ts
```
Example request (one line):
```
{"id":"1","op":"query","input":{"query":"$.a[*]","document":{"a":[1,2]}}}
```
Response:
```
{"id":"1","result":{"values":[1,2],"paths":["$['a'][0]","$['a'][1]"]}}
```

## Layout
| File | Role |
|---|---|
| `driver.ts` | stdin to stdout loop |
| `protocol.ts` | one line to one response; the error checks in the spec's order |
| `json.ts` | strict JSON parser (member order, number text, exact numbers); serialiser |
| `query.ts` | JSONPath syntax, validity (I-JSON range, well-typedness) and parse tree |
| `evaluate.ts` | selectors, filters, comparisons, function extensions, normalized paths |
| `iregexp.ts` | I-Regexp (RFC 9485) parser and NFA matcher |
| `*.test.ts` | tests (`node:test`, `node:assert`) |
| `REGEN.json`, `package.json` | run metadata (no dependencies) |
| `CHOICES.md` | every decision the spec left open |

## How the tests map to the spec
- Driver protocol: `driver.test.ts` (end-to-end, exact output, exit status), `protocol.test.ts` (blank lines, error order, id echo, one line per response).
- REQ-BU-001 to REQ-BU-004: checks in `driver.test.ts` read the folder itself (REGEN.json keys, no dependencies, erasable syntax, `.ts` import extensions, at most 3000 non-blank source lines).
- RFC 9535 syntax and validity: `query.test.ts` (accepted and rejected lists, the I-JSON range, singular queries).
- RFC 9535 semantics: `evaluate.test.ts`. Most cases are the RFC's own tables (Tables 2, 5, 6, 7, 9, 11, 12, 15, 16, 17, 18) and section 2.4 function examples.
- RFC 9485: `iregexp.test.ts` (syntax accepted and rejected, the match/search distinction, Unicode categories, linear-time behaviour).
- Number and member handling: `json.test.ts`.

This is coverage by section and by RFC example, not one test per individual normative sentence. A few MUST statements that are only ever shown by example, such as the descendant-order note under Table 16, are covered by the table test rather than by a dedicated assertion.

## Things that surprised me
- The test command names the test files with a quoted glob rather than relying on `node --test`'s defaults. On Node 22.22 the defaults also find `.ts` files, but the explicit glob does not depend on that.
- Type-only names are imported with `import type`, so that the import is erased with the other annotations and never has to resolve at run time.
- The spec's number rule ("compare exactly") and the RFC's use of JSON numbers push against the usual JavaScript habit of parsing with `JSON.parse`. `JSON.parse` loses digits above 2^53 and reorders integer-like member names, so the parser here is written by hand (`json.ts`).
- Nothing type-checks the TypeScript. No compiler may be installed, and type stripping only removes annotations. The tests exercise every module at run time, but a type error that does not change behaviour would go unnoticed.
- `$` on its own is a singular query, so `$[?@.a == $]` is valid. Comparing with a LogicalType function (for example `match(...) == true`) is not.

## Known limits
- Deep nesting: there is no depth limit. Documents nested 500 levels deep are tested; much deeper ones may overflow the JavaScript stack, which I have not measured. See C-16.
- The I-Regexp automaton is capped at 20,000 states. Larger patterns give LogicalFalse. See C-12.
- An internal error other than the two spec error families is not caught.
