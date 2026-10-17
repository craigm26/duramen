# Build notes

No build step, compiler, dependencies, network access, or installation is needed. Use Node.js 22.18 or later; development and verification used Node.js 22.20.0 with its native TypeScript type stripping. All relative TypeScript imports include .ts and the source uses only erasable TypeScript syntax.

Run the driver with:

    node driver.ts

REGEN.json declares that exact command. Send one JSON request per line on standard input; the driver returns one JSON response per nonblank line and exits successfully after EOF. The supported operations are check, cases, and judge. For example:

    {"id":"demo","op":"check","input":{"files":{"s.duramen":"duramen 0.1\nspec sample 1\n"}}}

The response is:

    {"id":"demo","result":{"diagnostics":[],"errors":0,"warnings":0}}

Run all tests with:

    npm test

Or invoke Node directly:

    node --test --experimental-test-isolation=none --test-reporter=spec *.test.ts

The suite contains 270 tests: 243 requests extracted from the supplied specification, one test verifying that all 47 requirement IDs have executable examples, and 26 independent tests. The independent tests cover the driver process and framing, parser interactions, repeated diagnostics, request spelling and order, actual oracle processes, failed starts, signals, timeouts, response matching, input files, cleanup, generated cases, and judging. TEST_COVERAGE.md maps all requirements and their mandatory behavior to the tests. The echo fixture is copied verbatim from SPEC.md's Files section.

Implementation files:

- driver.ts handles UTF-8 input framing and ordered responses.
- service.ts validates requests and dispatches operations.
- parser.ts reads virtual records and reports P diagnostics.
- checker.ts performs semantic checks and creates suites.
- oracle.ts stages the supplied files and runs oracle commands without a shell.
- judge.ts compares an answer with a case.
- values.ts shares finite JSON, own-member paths, equality, and tolerance semantics.

The checker stops before semantic checks or oracle execution on any parse error. Semantic errors do not prevent eligible examples from running. Oracle output is preserved after a nonzero exit or forced termination. Untrusted member names are stored with Maps or own-property-safe objects, including __proto__ and constructor.

Two workspace behaviors were surprising. Child-process pipes fail here, while file descriptors work, so oracle execution uses temporary input and output files. Node's default test isolation also relies on those pipes, so npm test disables process isolation. The driver integration test runs a real child with file descriptors too. No build or compilation was added to work around either restriction.

Oracle runs have a five-second deadline. Staging is created under the implementation folder and removed in a finally block; the folder must be writable when checking examples. The implementation follows the core rules for both supported versions and intentionally supplies no extra checks for the open language. All other unspecified behavior and small interpretation choices are recorded in CHOICES.md. The three supplied source documents are unchanged.
