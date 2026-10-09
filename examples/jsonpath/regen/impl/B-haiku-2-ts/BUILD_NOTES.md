# Build notes

## What is here

`jsonpath` evaluates RFC 9535 JSONPath queries, with RFC 9485 I-Regexp patterns, as SPEC.md describes.
It is TypeScript, run directly by Node.js type stripping. There is no build step and no dependency.

| File | Role |
|---|---|
| `REGEN.json` | Names the language, the (empty) build, the test command and the driver. |
| `driver.ts` | Entry point: reads request lines on standard input, writes responses on standard output. |
| `protocol.ts` | One request line to one response line: request checks in the order of R1, response text. |
| `json.ts` | JSON parser (objects are `Map`s, numbers keep their text) and JSON writer. |
| `query.ts` | Query parser (R2–R16, Appendix A/B) and static checks (R17, R20, R21). |
| `iregexp.ts` | I-Regexp parser (R27) and its translation to `RegExp` with the `u` flag (R28, Appendix D). |
| `eval.ts` | Evaluation: nodelists, selectors, filters, comparisons, the five functions, normalized paths. |
| `package.json` | Declares ES modules (`"type": "module"`) and no dependencies. |
| `helpers.ts` | Shared test helpers (not a test file). |
| `*.test.ts` | The tests (see below). |

## How to build

Nothing. `REGEN.json` has `"build": ""`, which means there is nothing to build.

## How to test

```
node --test
```

Run from this folder. It runs 57 tests in about 2 seconds, and exits with status 0 when they all pass.
Node 22.18 or later is required; the work was done and tested with Node 22.22.0.

The tests are grouped by requirement:

| Test file | Requirements covered |
|---|---|
| `protocol.test.ts` | R1 (blank lines, CR, error order, responses, exit status); the driver run as a child process. R31.3 (duplicate names). |
| `syntax.test.ts` | R2–R12 (blank space, root and segments, shorthands, string literals, name, wildcard, index, slice, integer range). |
| `filters.test.ts` | R13–R26 (filter syntax and semantics, existence tests, literals, singular queries, comparisons, logical operators, the five functions and their types). |
| `regexp.test.ts` | R27–R28 (I-Regexp syntax and semantics, invalid patterns, `\p`, quantifier limits), and the `\p{Cs}` choice (C-7). |
| `results.test.ts` | R29–R32 (normalized paths, order, JSON values, the BOOKSTORE examples). |
| `build.test.ts` | REQ-BU-001 (REGEN.json shape), REQ-BU-003 (no dependencies, erasable syntax, `.ts` imports, Node version), REQ-BU-004 (at most 3,000 non-blank source lines). |

The scenarios are the worked examples in SPEC.md, transcribed as written. Each one is a test row,
so a failure names the query and document. The suite covers every section of the spec; it is not an
exhaustive enumeration of every grammar production.

## How to run

The driver reads one JSON request per line on standard input and writes one JSON response per line.

```
printf '%s\n' '{"id":"1","op":"query","input":{"query":"$.a[*]","document":{"a":[1,2]}}}' | node driver.ts
```

prints

```
{"id":"1","result":{"values":[1,2],"paths":["$['a'][0]","$['a'][1]"]}}
```

Standard error may show Node's type-stripping notice. Standard output is only responses.

## Things that surprised me

- **The spec's grammar and its appendix disagree on `Cs`.** The R27 `charProp` rule has no `Cs`, but Appendix C lists it. I followed the grammar, which is normative for validity (C-7).
- **`JSON.parse` would be wrong for this.** It reorders integer-like keys (`{"b":1,"1":2}`) and cannot keep numbers like `12345678901234567890`. Objects are `Map`s and numbers keep their text (C-5).
- **Some `\uXXXX` escapes did not survive authoring.** While writing the tests, several escapes that denote printable characters (`a`, `é`, `😀`) were stored as the characters themselves. That silently changed what the query text contained, and the affected rows still passed. I found them by reading the files back and fixed them by writing the backslash as `\x5c` in normal strings. Check any new escape-heavy test by reading the stored text, not just by running it.
- **A real bug found by the tests.** The trailing `-` in a bracket class (`[a-]`) was consumed but not added to the class, so `-` was never matched. Fixed in `iregexp.ts`.
- **Type stripping needs `import type` for type-only names.** A plain `import` of an interface fails at run time in ESM. All type-only imports use `import type`.
- **JavaScript objects are unsafe for member names.** `constructor` and `__proto__` are ordinary member names here, so every name lookup (member, function, escape table) uses `Map` or `Set`.

## Limits and open points

- An unexpected internal exception is not caught. The evaluator should not throw for a well-formed, valid query, so a throw is a bug, and it stops the driver (C-17).
- The parser and evaluator are recursive. Very deeply nested documents or queries could exhaust the stack. The spec sets no limit, and none is enforced.
- Only Linux was run. `REGEN.json` uses plain commands (`node --test`, `node driver.ts`) that should work on Windows too, but that has not been tried.
- A pattern with a very large quantifier is passed to the JavaScript engine, which accepted the tested cases. Other engines may have other limits (C-10).
