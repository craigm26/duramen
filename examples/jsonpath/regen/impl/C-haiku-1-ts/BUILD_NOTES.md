# Build notes

## What is here

- `driver.ts`: reads request lines on standard input and writes response lines on standard output.
- `protocol.ts`: one request line to one response object, following the order of checks in SPEC.md, Errors.
- `parse.ts`: parses a query into a tree, rejecting anything that is not well formed and valid.
- `regex.ts`: checks an I-Regexp against the RFC 9485 grammar and runs it as a JavaScript RegExp.
- `evaluate.ts`: runs the tree over a document: selectors, filters, functions and comparisons.
- `values.ts`: equality, ordering, and Normalized Path text.
- `tests/`: the test suite (`*.test.ts`), plus `tests/support.ts` for shared helpers.
- `REGEN.json`, `package.json`: the commands the harness runs, and the module type.
- `CHOICES.md`: each point where the spec was silent, ambiguous or contradictory.

## Build

Nothing to build. `REGEN.json` has `"build": ""`. TypeScript runs directly through Node's type
stripping. It needs Node.js 22.18 or later; this was checked on v22.22.0. No flags are needed,
and nothing is installed.

## Test

```
node --test
```

Or `npm test`, which runs the same command. The suite has 60 tests, and they all pass. They take
a few seconds. Every REQ that carries a MUST has at least one test, grouped by REQ id in the test
names. The three properties (PROP-SE-P1, PROP-NP-P1, PROP-FI-P1) run on generated cases from a
fixed seed, so every run checks the same 200 to 300 cases.

`tests/repo.test.ts` checks the implementation folder: the shape of `REGEN.json`, that no
dependencies are installed or declared, that the sources use erasable syntax and `.ts` import
extensions, and that the non-blank source lines number 1,064, under the 3,000 limit.

`tests/driver.test.ts` runs the driver exactly as `REGEN.json` starts it: the command split on
single spaces, no shell.

## Run

```
node driver.ts
```

Write one request object per line on standard input:

```
{"id":"r1","op":"query","input":{"query":"$..[?@.a > 1]","document":[{"a":2},{"a":1}]}}
```

It answers on standard output with one line per request:

```
{"id":"r1","result":{"values":[{"a":2}],"paths":["$[0]"]}}
```

Blank lines get no response. Standard error is not used.

## What surprised me

- **The spec's examples are not all consistent with its rules.** The table row for `"$.ˋa"`
  (U+02CB) says `invalid_query`, but the name rule allows it, and so does RFC 9535. I followed the
  rule (C-2).
- **Only 8 of the 43 EV-EV-RFC rows are in the spec files.** The spec says the suite checks all of
  them, but the other 35 are not in SPEC.md, PROMPT.md or DECISIONS.md, so they cannot be checked
  here. The 8 that are present are checked in `tests/selection.test.ts`.
- **A raw U+2028 or U+2029 character in a JavaScript source file breaks Node's parser** when it
  falls inside a regex literal, and it is easy to produce one by accident. The sources and tests
  write those code points as escapes, or build them with `String.fromCharCode`, so that no raw
  line separator appears. The test `Output keeps U+0085, U+2028 and U+2029 as escapes` checks the
  output side of this.
- **A real output bug, found by the tests:** the escape for U+0085 was written as `\u85`, which is
  not valid JSON. It is now padded to four hex digits.
- **`{ __proto__: 1 }` in an object literal sets the prototype and creates no member.** A test
  needs `{ ["__proto__"]: 1 }` for a document with a member of that name (REQ-SE-002).
- **Node's `JSON.stringify` writes `Infinity` and `NaN` as `null`,** so a document number beyond
  the double range shows as `null` in `values` (C-6).
- **The RegExp engine refuses `{3,2}` and `[z-a]`, but accepts `{100000000000000000000}`.** So a
  reversed count or range makes the pattern not an I-Regexp, and a huge count is simply accepted
  (C-8, C-9).
- **A few strings in the tests are non-ASCII** (U+FFFF, and a no-break space in one row). They are
  consistent within each test, and the tests pass with them, but escapes would be easier to read.

## Limits and open items

- Deep nesting in a query can exhaust the stack. That is answered as `invalid_query` (C-11).
  Deep nesting in a document is not guarded, so a very deep `values` may fail to serialize.
- The I-Regexp engine is JavaScript's, so `\p{...}` categories follow the Unicode version in
  Node.js (OPEN-OP-005).
- Standard input is read as a stream and each response is written as its line arrives (C-4).
