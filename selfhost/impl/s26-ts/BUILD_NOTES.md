# Build notes

Use Node.js 22.18 or later. No installation, compilation, generated JavaScript, or third-party packages are needed.

- Test: `npm test`
- Equivalent direct test command: `node --experimental-test-isolation=none --test *.test.ts`
- Run the driver: `node driver.ts`
- Driver discovery: `REGEN.json` contains `{"driver":"node driver.ts"}`.

The driver accepts one JSON request per stdin line and writes one JSON response per nonblank line, preserving request order. It also accepts a final request without LF. For example, send this line to check a minimal record:

```json
{"id":"demo","op":"check","input":{"files":{"example.duramen":"duramen 0.1\nspec demo 1\n"}}}
```

The response is:

```json
{"id":"demo","result":{"diagnostics":[],"errors":0,"warnings":0}}
```

The implementation is split across driver.ts (protocol and validation), parser.ts (record syntax), checker.ts (static checks, oracle execution, and cases), and values.ts (JSON paths, comparison, and judge). All relative TypeScript imports include their .ts extension and use erasable syntax.

specification.test.ts executes all 238 examples supplied in SPEC.md and includes a coverage guard for all 47 requirements. core.test.ts adds 26 independent tests, including driver process output, path validation, parser recovery, oracle timeouts and signals, duplicate responses, exact request text, special property names, and generated-suite judging. The suite contains 265 tests total. TEST_COVERAGE.md maps each normative requirement to those tests.

Two environment details were surprising. Child processes using pipes fail with EPERM, so oracle processes and driver integration tests use regular files for their standard streams, as OPEN-OR-001 permits. The default node:test worker transport is also affected; disabling test isolation ensures the runner executes every assertion and reports the full test count. No alternate oracle implementation or fixture-specific shortcut is used.

Each oracle run has a five-second timeout. The checker retains responses written before a failing exit, signal, or timeout. Request files and stream files live in fresh hidden temporary directories under the implementation folder and are removed after use. Oracle working directories follow their statements' defining files. The provided fixtures/echo.mjs is copied verbatim from SPEC.md; runtime oracle files always come from each request.

The specification intentionally leaves extension statements, extra 0.2 checks, human renderings, some resource limits, and additional judge check kinds open. CHOICES.md records their treatment and the smaller recovery, quoting, and EOF choices. Only SPEC.md, DECISIONS.md, and PROMPT.md informed the implementation. No packages or external sources were fetched.
