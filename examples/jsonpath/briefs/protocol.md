## Interface

### Driver protocol

An implementation is judged only through its driver: the program named by `driver` in the
implementation folder's `REGEN.json` (a command string, or an object whose keys are Node.js
`process.platform` values plus `default`). The command is split on single spaces and started
without a shell, in the implementation folder.

- Requests arrive on standard input, one JSON object per line:
  `{"id": <string>, "op": <string>, "input": <object>}`, plus any members named below.
- For each line that is not blank the driver writes exactly one JSON object, as one line, to
  standard output, in request order, with the request's `id`. Blank lines (empty, or only
  spaces and tabs) get no response; whether other white space makes a line blank is open.
- A response holds `id` and `result` (plus `audit` for operations that have one), or `id` and
  `error`, and nothing else.
- Standard output is UTF-8. Every line ends with LF (0x0A) and contains no CR (0x0D). Nothing
  else is written to standard output; standard error is free.
- After end of input and the last response, the driver exits with status 0.

### Operations

| op | input fields (required unless marked optional) | result | audit |
|---|---|---|---|
| `query` | `query` (string), `document` (any) | `{values: any[], paths: string[]}`; `values`, the values of the nodes the query selects, in the order of the nodelist, and `paths`, the normalized path of each of those nodes, in the same order | no |

Results are compared as parsed JSON: member order does not matter, and numbers compare exactly.

### Errors

A request that cannot be handled gets `{"id": <id>, "error": <code>}`. The checks run in this
order, and the first that applies decides the response:

1. `bad_request` when the line is not a JSON object, or `id` is missing or not a string (the response then has `"id": null`)
2. `unknown_op` when `op` is missing, not a string, or not `query`
3. `bad_request` when `input` is missing or not an object, `input.query` is missing or not a string, or `input.document` is missing
4. `invalid_query` when `input.query` is not a well-formed and valid JSONPath query

## The implementation folder

These requirements are checked on the implementation folder, not through the driver.

**REQ-BU-001.** *REGEN.json.*

The implementation folder MUST contain `REGEN.json`, a JSON object with exactly the keys
`lang` (`"ts"` or `"py"`), `build`, `test` and `driver`. Each of `build`, `test` and
`driver` is a command string, or an object whose keys are Node.js `process.platform` values
(such as `"win32"`) plus a required `"default"`, each mapping to a command string. Commands
run in the implementation folder. `build` and `test` run through the platform shell; an
empty `build` means there is nothing to build. `driver` is split on single spaces and
started without a shell, so it MUST be plain space-separated words. The same REGEN.json
MUST work on Windows and on Linux.

Checked on the implementation folder:
- `REGEN.json` is JSON of type `{lang: "ts" | "py", build: string | {default: string, ...}, test: string | {default: string, ...}, driver: string | {default: string, ...}}`.

**REQ-BU-002.** *Own tests.*

The implementation MUST have its own tests, including at least one for every MUST in this
document, and the command `REGEN.json` names as `test` MUST pass.

Checked on the implementation folder:
- the command REGEN.json names as `test` exits with status 0 within 300 s (run in the implementation folder, through the platform shell).

**REQ-BU-003.** *Runtime and dependencies.*

TypeScript MUST run on Node.js 22.18 or later directly by type stripping: erasable syntax
only, no build step, relative imports with the `.ts` extension. Python MUST run on 3.11 or
later. Only the language's standard library is used: nothing is installed, and a
`package.json`, if there is one, declares no dependencies.

Checked on the implementation folder:
- the implementation folder has nothing matching `node_modules`, `package-lock.json`, `requirements.txt`, `Pipfile`, `poetry.lock`.
- no file matching `package.json` has a line matching `"(dev|peer|optional)?[dD]ependencies"`.

**REQ-BU-004.** *Size.*

At most 3,000 non-blank lines of source in all: `.ts .mts .mjs .js` or `.py` files under
the implementation folder, not counting tests (`*.test.*`, `*_test.*`, `test_*.py`, and
anything under a `test/` or `tests/` folder).

Checked on the implementation folder:
- files matching `**/*.ts`, `**/*.mts`, `**/*.mjs`, `**/*.js`, `**/*.py`, excluding `**/*.test.*`, `**/*_test.*`, `**/test_*.py`, `**/test/**`, `**/tests/**`, hold at most 3000 non-blank lines in total.
