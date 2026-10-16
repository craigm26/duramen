# Building and running

Use Node.js 22.18 or later. There are no dependencies to install, no compiler, and no build step.

Run the JSON-lines driver with:

```text
node driver.ts
```

REGEN.json declares that exact command. The driver supports check, cases, and judge. For example, send this line on stdin:

```json
{"id":"demo","op":"check","input":{"files":{"s.duramen":"duramen 0.1\nspec demo 1\n"}}}
```

It responds:

```json
{"id":"demo","result":{"diagnostics":[],"errors":0,"warnings":0}}
```

Run all tests with:

```text
npm test
```

The npm script runs node:test directly with TypeScript stripping. It disables test-process isolation so this environment reports each test. The timeout regression intentionally takes about ten seconds. Nothing requires network access or package installation.

# Implementation and validation

- driver.ts handles UTF-8 framing, ordered responses, blank lines, and EOF.
- core.ts validates request forms and dispatches operations.
- parser.ts reads virtual records, statements, clauses, examples, tables, and input text blocks.
- checker.ts performs semantic checks and creates suite cases.
- oracle.ts materializes request files locally, starts commands without a shell, and collects responses.
- comparison.ts implements JSON paths, equality, tolerances, and judge verdicts.

The independent tests cover every normative requirement and its MUST clauses, including framing, diagnostic precedence, overflow, decision lifecycle, failed startup, nonzero exits, signals, timeouts, and preserving responses after failure. spec-examples.test.ts additionally executes all 247 published examples and checks that every REQ has published regression coverage. These fixtures are loaded only by tests; runtime behavior is derived from the incoming request.

The most surprising environment issue was synchronous child-process pipes: spawnSync returned EPERM and delivered no stdin even when the child started. Regular-file stdin/stdout/stderr work, and OPEN-OR-001 explicitly permits this. Oracle data and stream files live in a temporary directory under this folder and are removed after each request. The default isolated Node test runner also hid individual test results here, so the test script disables isolation.

Other subtle rules were the exact spelling of input JSON, the different once-only rules for example request lines, retaining duplicate diagnostics, binary64 rounding at tolerance boundaries, paths named __proto__, and allowing a from path to leave the record folder and reenter it while refusing any attempt to go above the request's top folder. CHOICES.md records the remaining gaps and selected behaviors.
