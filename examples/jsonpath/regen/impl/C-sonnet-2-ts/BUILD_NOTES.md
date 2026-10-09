# Build notes

## Build, test, run
- Build: nothing. Node.js 22.18 or later runs the `.ts` files directly by type stripping.
- Test: `npm test` (or `node --test`). It runs `spec.test.ts` and `driver.test.ts`.
- Run: `node driver.ts` reads one JSON request per line on stdin and writes one JSON response per line on stdout.

## Layout
- `jsonpath.ts`: query parser (with the well-typedness checks) and evaluator.
- `iregexp.ts`: I-Regexp validator that translates to a JavaScript `u`-flag regex.
- `driver.ts`: the driver protocol.
- `REGEN.json`, `package.json`: run configuration. There are no dependencies.

## Surprises
- REQ-SY-002's prose and its table disagree about `$.ˋa` (U+02CB). See CHOICES.md C-1.
- In the spec's length() examples, the decomposed `é` (length 2) is shown looking the same as the precomposed `é` (length 1).
- `JSON.parse` keeps `__proto__` as an own member. Members are read with `Object.hasOwn`, so `constructor` and the like find nothing.
- A name-selector query written with `-0` is invalid, but a number literal `-0` in a filter is valid.
