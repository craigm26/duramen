## C-1: Direct Node driver
- Spec reference: Interface / Driver protocol
- Situation: missing
- What I chose: REGEN.json names `node driver.ts`. The driver and its reusable implementation are separate TypeScript modules. There is no build, dependency installation, or generated JavaScript.
- Alternatives: One TypeScript file, or a package-script entry point.
- Should the spec pin this? no, the protocol already makes the entry point discoverable.

## C-2: Native implementation and test organization
- Spec reference: none
- Situation: missing
- What I chose: Use Node built-ins only; separate parsing, semantic checks, oracle execution, and JSON comparison. Test modules use node:test and node:assert/strict.
- Alternatives: A monolithic module or additional libraries.
- Should the spec pin this? no, internal organization does not affect the contract.

## C-3: Late language declarations
- Spec reference: OPEN-RC-002
- Situation: missing
- What I chose: Accept a duramen statement anywhere among a file's statements. Version and duplicate checks apply in line order.
- Alternatives: Require it to be the first statement.
- Should the spec pin this? unsure, accepting it anywhere is useful, but this is explicitly open.

## C-4: Behavior for the rest of the language
- Spec reference: OPEN-RC-001
- Situation: missing
- What I chose: Recognize the additional statement keywords but report P015 for their clauses, which are not implemented. Accept returns and static as single-line clauses without further interpretation. Apply the same core checks to 0.2 files as to 0.1 files, adding no 0.2 checks.
- Alternatives: Ignore all additional statements and clauses, or implement extensions.
- Should the spec pin this? no, the core deliberately excludes their meaning.

## C-5: Blank request lines
- Spec reference: OPEN-RQ-005
- Situation: missing
- What I chose: Ignore every request line matching ECMAScript's whitespace-only pattern, including the empty line.
- Alternatives: Ignore only spaces and tabs and reject other whitespace-only lines.
- Should the spec pin this? no, it is explicitly open and does not change nonblank requests.

## C-6: Driver input delimiters
- Spec reference: Interface / Driver protocol
- Situation: ambiguous
- What I chose: Split requests at LF. Retain a preceding CR as JSON whitespace. A lone CR does not separate requests. Process a final nonempty request even when EOF arrives without LF.
- Alternatives: Require every incoming line to end in LF, or also split at lone CR.
- Should the spec pin this? yes, the output framing is exact but input framing and final EOF behavior could be equally explicit.

## C-7: Oracle stream files
- Spec reference: OPEN-OR-001
- Situation: missing
- What I chose: Use regular files for oracle stdin, stdout, and stderr. Write all input before starting the child, close the stream descriptors afterward, and read stdout in full. This environment's synchronous pipes returned EPERM and failed to deliver input; regular descriptors work.
- Alternatives: Pipes, sockets, or asynchronous child processes.
- Should the spec pin this? no, the specification explicitly permits different file kinds.

## C-8: Oracle file location
- Spec reference: OPEN-OR-002
- Situation: missing
- What I chose: Materialize the request under a fresh .duramen-run-* directory inside the implementation folder. Put the request's top folder in its record subfolder, and stream files alongside that subfolder. Remove the temporary tree in a finally block.
- Alternatives: The system temporary directory, or a persistent workspace.
- Should the spec pin this? no, the parent of the request's top folder is explicitly open; local placement also honors the build prompt's folder restriction.

## C-9: Oracle time limit
- Spec reference: OPEN-RQ-001; REQ-OR-004
- Situation: missing
- What I chose: Allow 10 seconds for each oracle run, then terminate it and report T020 while retaining any written responses. Impose no explicit record-size or stdout-size limit beyond available resources.
- Alternatives: No timeout, a configurable timeout, or a total timeout for the whole record.
- Should the spec pin this? no for this exercise, since time and size limits are open; a deployed service may need a documented policy.

## C-10: Scheduling solo runs
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: Send all eligible nonsolo examples in one batch, in record order, then run solo examples individually in their record order. Cases themselves always retain the full record order.
- Alternatives: Split the batch around each solo example to preserve process-start order across all examples.
- Should the spec pin this? yes, an oracle that changes files can observe process-start order even though each input stream is ordered.

## C-11: Oracle filesystem lifetime
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: Materialize files once per checker request and share that directory among its batch and solo runs. The next checker request gets a fresh directory.
- Alternatives: Recreate files before every child process or retain them across checker requests.
- Should the spec pin this? unsure, ordinary read-only oracles cannot observe this, but an oracle that modifies its files can.

## C-12: Child environment
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: Inherit the checker's environment and executable search path, using the command's words as arguments without a shell. Discard captured oracle stderr after the run.
- Alternatives: A curated environment or forwarding oracle stderr to the checker's stderr.
- Should the spec pin this? unsure, environment-dependent oracles can observe it, while stderr is explicitly free.

## C-13: Unexpected checker failures
- Spec reference: OPEN-RQ-004
- Situation: missing
- What I chose: Answer internal_error with the request id, write the exception to stderr, and continue processing subsequent request lines.
- Alternatives: Exit the driver or use another error code.
- Should the spec pin this? no, this follows the reference behavior suggested by the open item.

## C-14: Human-readable output
- Spec reference: OPEN-RQ-002
- Situation: missing
- What I chose: Return only the protocol's compact diagnostic strings; provide no message text, columns, builder brief, or additional command-line interface.
- Alternatives: Add a separate human-facing CLI or richer diagnostic rendering.
- Should the spec pin this? no, only the driver is judged and these renderings are open.

## C-15: Unknown judge check kinds
- Spec reference: OPEN-JU-001
- Situation: missing
- What I chose: Accept an otherwise well-formed check with an unknown string kind, then mark that check as failed. Require kind to be a string.
- Alternatives: Reject the request or ignore the check.
- Should the spec pin this? no for extension checks, though requiring a string kind could be stated directly in the shape definition.

## C-16: Nonfinite numbers in judge requests
- Spec reference: OPEN-JU-002
- Situation: missing
- What I chose: Keep JSON.parse's native binary64 values in judge requests, including overflow to infinities. Apply the same JavaScript equality and subtraction operations as for finite values; do not add an overflow-specific request error.
- Alternatives: Reject nonfinite judge requests or impose arbitrary-precision parsing.
- Should the spec pin this? no, the open item explicitly excludes these requests from conformance.

## C-17: Lexical errors inside ignored bodies
- Spec reference: REQ-SY-001; REQ-SY-002; REQ-SY-003; REQ-CK-007
- Situation: ambiguous
- What I chose: Detect P001 while scanning physical lines, before deciding which statement or clause bodies to ignore. An invalid-indent line therefore gets P001 even inside an otherwise ignored body. Other body diagnostics are suppressed as specified.
- Alternatives: Suppress P001 too when the enclosing body is ignored.
- Should the spec pin this? yes, the unconditional line rule and the phrase "not read" leave their precedence unclear.

## C-18: Obligation quotation escapes
- Spec reference: REQ-CK-006
- Situation: missing
- What I chose: Treat literal pairs of the specified quote characters as quotation delimiters within each physical line. Backslashes do not escape those delimiters for this text heuristic. Replace each matched quotation with a space so adjacent words cannot join across it.
- Alternatives: Interpret backslash escapes inside the text's quotations.
- Should the spec pin this? yes, escaped quotation marks can change which obligation words are detected.

## C-19: Empty oracle command words
- Spec reference: REQ-OR-002; REQ-OR-004
- Situation: missing
- What I chose: Preserve empty quoted words, including the first word. If the first word is empty, attempt no substitute executable; startup fails and produces T020.
- Alternatives: Drop an empty executable word or reject the oracle statement while reading.
- Should the spec pin this? no, keeping empty words and handling failed startup already strongly imply this behavior.

## C-20: Extra request members
- Spec reference: Interface / Errors
- Situation: missing
- What I chose: Ignore unrecognized members of the outer request and input. For judge, also ignore case members other than checks and full and unrecognized members of known checks and full objects.
- Alternatives: Reject unrecognized members.
- Should the spec pin this? unsure, judge explicitly ignores extra case metadata, but the general request envelope could state its extensibility policy.

## C-21: Test runner isolation
- Spec reference: none
- Situation: missing
- What I chose: Run node:test with --experimental-test-isolation=none. In this environment the default subprocess test runner reported only the file-level outcome; disabling isolation exposes every individual test and failure. All tests still use the required Node test and assertion modules.
- Alternatives: A custom test runner or the default isolated test processes.
- Should the spec pin this? no, test-process isolation is an implementation-environment detail.

## C-22: Published examples as regression fixtures
- Spec reference: PROMPT.md rule 4
- Situation: missing
- What I chose: Write independent normative tests, and additionally parse the published examples from SPEC.md into regression tests. Extract the supplied echo oracle only in tests. Production modules never read the specification, decisions, or test sources.
- Alternatives: Hand-copy every published example into a fixture file or test only newly written examples.
- Should the spec pin this? no, executable coverage matters more than fixture storage.
