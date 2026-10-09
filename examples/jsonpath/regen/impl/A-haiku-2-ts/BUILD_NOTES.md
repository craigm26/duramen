# Build notes

## Requirements
- Node.js 22.18 or later. I built and tested with Node v22.22.0 on Linux.
- No install step. There are no dependencies, no `node_modules` and no lock file.

## Build
Nothing to build. `REGEN.json` gives `"build": ""`. TypeScript runs directly through type stripping.

## Test
```
npm test
```
or the command `REGEN.json` names as `test`:
```
node --test json.test.ts iregexp.test.ts query.test.ts evaluate.test.ts protocol.test.ts driver.test.ts repo.test.ts
```
Result: 63 tests, all passing. The run takes about 3 seconds.

The test files are `json`, `iregexp`, `query`, `evaluate`, `protocol`, `driver` and `repo`. `repo.test.ts` checks the REQ-BU requirements on the folder: the shape of `REGEN.json`, that `package.json` declares no dependencies, that the source is erasable TypeScript with `.ts` import extensions, and that the source has at most 3000 non-blank lines.

## Run
The driver reads requests from standard input, one JSON object per line, and writes one response line for each non-blank request:
```
node driver.ts
```
Example:
```
{"id":"1","op":"query","input":{"query":"$.a[*]","document":{"a":[1,2]}}}
```
gives
```
{"id":"1","result":{"values":[1,2],"paths":["$['a'][0]","$['a'][1]"]}}
```

## Files
- `driver.ts`: standard input and output loop.
- `protocol.ts`: the request checks, in the order the spec gives.
- `json.ts`: strict JSON reader and writer. Numbers keep their source text.
- `query.ts`: query parser, including the well-typedness check of function expressions.
- `evaluate.ts`: selection, filters, comparisons, function extensions, normalized paths.
- `iregexp.ts`: I-Regexp checker, translated to a JavaScript RegExp.
- `CHOICES.md`: the decisions where the spec was silent, ambiguous or open.

## Things that surprised me
- `JSON.parse` could not be used for requests. It turns `12345678901234567890` into `12345678901234567000` and `1.0` into `1`. The spec says numbers compare exactly, and output must reproduce them, so the reader keeps each number's text. That is why `json.ts` exists.
- The spec's protocol names no error code for overflow, but Section 2.1 requires an indication of overflow. I added the code `overflow` (C-3). It is the only code not named in the spec.
- The ABNF is strict about white space inside singular queries. `$[?@[ 'a' ] == 1]` is `invalid_query`, though the prose never says so (C-9).
- The spec's I-Regexp grammar excludes `{` and `}` as literal characters, so `a}` is not an I-Regexp. `[^]` is excluded explicitly, and `[]` is excluded by the grammar.
- `match()` is a whole-string match, and `search()` a substring match. The translation anchors the whole-string form with `^(?:...)$`.
- A `.` in an I-Regexp must not match CR or LF (RFC 9485 Section 5.3). JavaScript's `.` excludes a wider set of line terminators, so the translation writes `[^\n\r]` explicitly.
- Strings compare by Unicode scalar value, so `U+FFFD` is less than `U+1F600`. JavaScript string comparison uses UTF-16 units and gets this wrong. `compareCodePoints` in `evaluate.ts` handles it.
- The descendant segment is iterative, not recursive, so a deeply nested document does not exhaust the stack (Section 4.1). The request parser is recursive, so a request nested deeply enough is reported as `overflow`.

## Not verified
- Only Linux was tested. `REGEN.json` uses plain space-separated words, so it should also work on Windows, but I did not run it there.
- There is no type checker. `tsc` was not available, and I could not run it under the allowed commands. Type annotations are checked only by Node stripping them, so a type error would not be found. The tests do exercise every module.
- I did not inspect standard error from the driver directly. The spec allows any output there, and the driver tests check exit status and standard output.
- I-Regexp matching is delegated to the JavaScript regex engine, which can be slow on pathological patterns (CHOICES C-12).
- No git repository was created and nothing was committed.
