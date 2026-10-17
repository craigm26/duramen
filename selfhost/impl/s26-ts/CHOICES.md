# Implementation choices

## C-1: Small modules with no build
- Spec reference: Interface; PROMPT.md rule 2
- Situation: missing
- What I chose: Use driver.ts for the public protocol, parser.ts for reading records, checker.ts for semantic checks and oracle execution, and values.ts for JSON comparison and judging. package.json declares ECMAScript modules. All runtime dependencies are Node built-ins.
- Alternatives: One file, CommonJS, or more modules.
- Should the spec pin this? no, because this organization does not change the interface.

## C-2: Driver registration
- Spec reference: Interface / Driver protocol
- Situation: missing
- What I chose: REGEN.json registers the platform-independent command `node driver.ts`. npm start is a convenience; automated consumers should use REGEN.json or invoke Node directly.
- Alternatives: A platform command map or a wrapper script.
- Should the spec pin this? no, because the specified command-discovery protocol already allows this.

## C-3: Optional request members
- Spec reference: Interface / Errors
- Situation: missing
- What I chose: Ignore request and input members for which the operation specifies no validation. All explicitly required members still undergo validation in the stated order.
- Alternatives: Reject additional members.
- Should the spec pin this? unsure, because the exhaustive error conditions imply acceptance, but an explicit sentence would help.

## C-4: Other blank request lines
- Spec reference: OPEN-RQ-005
- Situation: ambiguous
- What I chose: Ignore lines consisting entirely of ECMAScript whitespace, including CR before LF. U+2028 and U+2029 never divide driver lines.
- Alternatives: Ignore only spaces and tabs and return bad_request for other whitespace-only lines.
- Should the spec pin this? no, because this is explicitly open.

## C-5: Final request without LF
- Spec reference: Interface / Driver protocol
- Situation: missing
- What I chose: Handle a nonempty final input segment at EOF as a request line, even without its terminating LF. Every response still ends with LF.
- Alternatives: Require every request to end with LF or discard the final segment.
- Should the spec pin this? yes, because callers can end input immediately after their JSON.

## C-6: Native JSON decoding
- Spec reference: Interface; REQ-SY-013; OPEN-JU-002
- Situation: missing
- What I chose: Use JSON.parse, including its last-value behavior for duplicate object names and binary64 numeric decoding. Reject nonfinite values in record JSON and oracle responses as specified. Judge values outside binary64 follow native JavaScript comparisons.
- Alternatives: Reject repeated JSON names or use an independent JSON decoder; reject nonfinite judge numbers.
- Should the spec pin this? unsure, because repeated JSON names can affect exact request spelling; judge overflow is explicitly open.

## C-7: Checker failures
- Spec reference: OPEN-RQ-004
- Situation: ambiguous
- What I chose: Catch failures while analyzing an accepted record, write the exception to stderr, and return internal_error with the request ID. Continue processing subsequent requests.
- Alternatives: Terminate or return a different error.
- Should the spec pin this? no, because the chosen behavior follows the documented reference convention for an explicitly open case.

## C-8: Human-facing output
- Spec reference: OPEN-RQ-002
- Situation: ambiguous
- What I chose: Return only the required file, line, level, and code strings. Do not add diagnostic messages, columns, or a separate brief operation.
- Alternatives: Additional human-readable renderings outside the judged interface.
- Should the spec pin this? no, because these renderings are explicitly open.

## C-9: Version position and extension statements
- Spec reference: OPEN-RC-001; OPEN-RC-002
- Situation: ambiguous
- What I chose: Accept duramen anywhere among statements. Apply the specified core checks equally to 0.1 and 0.2. Recognize extension statement keywords and ignore their bodies; accept returns and static as opaque clauses subject to the ordinary no-continuation rule.
- Alternatives: Require duramen first, implement additional version checks, or parse extension-specific bodies.
- Should the spec pin this? no, because these areas are expressly outside the core contract.

## C-10: Lexical indentation errors in ignored bodies
- Spec reference: REQ-SY-001; REQ-SY-002; REQ-SY-003
- Situation: ambiguous
- What I chose: Detect P001 before statement-specific processing, including in an otherwise ignored body. Suppress later structural checks within unknown statements, unknown clauses, and duplicate clauses. A one-space line after a recognized statement is P007 even if its clause is ignored.
- Alternatives: Suppress P001 too, or apply structural checks throughout ignored bodies.
- Should the spec pin this? yes, because the global line rule and the ignored-body rules overlap.

## C-11: Blank lines attach to the current clause
- Spec reference: REQ-SY-003; REQ-SY-005; REQ-SY-011
- Situation: missing
- What I chose: Retain blank lines in the current clause until its next real boundary; text and input blocks trim them according to their separate rules. Comments at indent zero or two and invalid indentation lines do not form boundaries.
- Alternatives: Discard all blank lines during lexing.
- Should the spec pin this? no, because preserving blanks is necessary to implement the specified block texts.

## C-12: Operation result and source text
- Spec reference: REQ-SY-004; REQ-SY-007; REQ-SY-009
- Situation: missing
- What I chose: Preserve opaque result, source, contract, and status clause contents as text after leading delimiter whitespace and trailing whitespace have been removed. An empty result is allowed. Oracle source lists are descriptive and do not restrict which request files are materialized.
- Alternatives: Require nonempty summaries, parse and validate source filenames, or copy only listed sources.
- Should the spec pin this? no, because these clauses supply information for people and no such validation is specified.

## C-13: Input updates overwrite the destination
- Spec reference: REQ-SY-011
- Situation: missing
- What I chose: An input line may replace an existing value at its final path member, including one set by an earlier input line. Intermediate values must be objects. Preserve ECMAScript property order and handle __proto__ and constructor as ordinary own names.
- Alternatives: Reject an existing destination or preserve its previous value.
- Should the spec pin this? unsure, because the request-writing requirement mentions a member being set again, but the input grammar could state this directly.

## C-14: Invalid input lines have no useful partial value
- Spec reference: REQ-SY-010; REQ-SY-011
- Situation: missing
- What I chose: Continue reading later lines after a failed input update. A malformed example begins with an empty object, which successful input lines can modify even though the example will ultimately be dropped. Creating intermediate empty objects before discovering an empty text block has no externally visible effect because parsing errors stop checking.
- Alternatives: Roll back every intermediate object or stop reading the example.
- Should the spec pin this? no, because the observable diagnostic order is already specified.

## C-15: Input comments and empty blocks
- Spec reference: REQ-SY-011
- Situation: missing
- What I chose: A six-space comment inside an ordinary input text is literal content. A blank-only text block is empty after its trailing blanks are removed and receives P049. A valid from-line may read an empty file successfully; six-space comments after a from-line remain comments.
- Alternatives: Discard comments inside input text or accept an empty inline block as an empty string.
- Should the spec pin this? unsure, because these follow the stated block and from-line rules, but examples would make the distinction explicit.

## C-16: Table row recovery
- Spec reference: REQ-SY-012
- Situation: missing
- What I chose: A row with the wrong cell count receives P014 and its cells are not parsed. Continue with later rows. For a correctly sized row, report each malformed cell independently from left to right. A header shape failure stops header and row checking, with independent non-row P006 errors retained.
- Alternatives: Parse the available cells of a short or long row, or stop the entire table at the first row error.
- Should the spec pin this? yes, because malformed cells in an incorrectly sized row could otherwise add diagnostics.

## C-17: Table diagnostic anchors
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: Put missing operation and insufficient row P013 at the table clause. Put header shape, repeated-column P013, and header tolerance P010 at the header row. Put cell errors at their data row. This matches every supplied example.
- Alternatives: Anchor all header problems at the table clause.
- Should the spec pin this? yes, because the examples settle a detail the prose does not state directly.

## C-18: Quotation recognition for obligations
- Spec reference: REQ-CK-006
- Situation: missing
- What I chose: On each physical line, mask complete pairs of straight double quotes, curly double quotes, or single backquotes with spaces before testing obligation words. A backslash in prose is ordinary; JSON strings in rejected alternatives are decoded first. Masking preserves the separation between the words around a quotation.
- Alternatives: Interpret escaped prose quotes, support multi-backquote delimiters, or recognize nested quotations.
- Should the spec pin this? yes, because prose escape and nesting behavior could change T004 and T014.

## C-19: Oracle file materialization
- Spec reference: REQ-RQ-001; REQ-OR-002; OPEN-RQ-003
- Situation: missing
- What I chose: Parse the record from its virtual file map, then materialize all request files as UTF-8 in a fresh hidden temporary directory inside the implementation folder only when an oracle run is needed. Start the oracle in its defining file's folder, with the inherited environment, and remove the temporary directory afterward. No host record files supplement the request.
- Alternatives: Maintain a persistent directory, materialize selected files, or use a different local staging folder.
- Should the spec pin this? no, because the record and oracle working-directory semantics are specified, while staging is an implementation detail.

## C-20: Regular files for oracle streams
- Spec reference: OPEN-OR-001
- Situation: ambiguous
- What I chose: Write oracle stdin completely before launch and attach regular files to stdin, stdout, and stderr. Keep those files in a separate temporary directory, outside the materialized record. Read stdout after exit or termination, then remove the files. This environment refuses child processes using pipes, while file descriptors work.
- Alternatives: Pipes or sockets and asynchronous reads.
- Should the spec pin this? no, because stream file kinds are explicitly open.

## C-21: Oracle execution limits
- Spec reference: OPEN-RQ-001; REQ-OR-004
- Situation: missing
- What I chose: Allow five seconds per oracle process, using Node's default timeout termination signal. There is no additional application limit on request length or captured output size. A timed-out run produces T020 and retains complete response lines already written.
- Alternatives: Another timeout, configurable limits, or no timeout.
- Should the spec pin this? no, because execution limits are deliberately unspecified.

## C-22: Ordering separate oracle processes
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: Send all eligible ordinary examples in one process in record order; then send solo examples in record order, each in a separate process. Start no process for an empty group. The order within the shared stream is preserved.
- Alternatives: Run contiguous ordinary groups interleaved with solo processes or launch solo processes concurrently.
- Should the spec pin this? unsure, because processes share an oracle command and record folder, so external side effects could expose ordering between runs.

## C-23: Oracle response text at EOF
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: Treat a final nonblank stdout segment without LF as one response line. Split at LF only and ignore whitespace-only lines. An incomplete or invalid final JSON segment is an invalid response line, including when deciding whether a solo process produced exactly one line.
- Alternatives: Require LF before any response can count.
- Should the spec pin this? yes, for the same reason as final request lines.

## C-24: Oracle failures and stderr
- Spec reference: REQ-OR-004; OPEN-RQ-002
- Situation: missing
- What I chose: Treat an unclosed command quote, spawn error, signal, timeout, or nonzero exit as T020. Capture stderr separately and discard it after the run; public diagnostics expose the required code and location. Malformed command quoting is checked only if a process would actually be needed.
- Alternatives: Forward stderr or include its contents in human diagnostics.
- Should the spec pin this? no, because diagnostic messages and empty-run behavior are already covered or open.

## C-25: Oracle command single quotes
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: Within single quotes, every character except the closing single quote is literal, including backslashes. Outside quotes, backslashes are also literal. Only the specified backslash-double-quote sequence inside double quotes receives special handling.
- Alternatives: Shell-style escaping or backslash escaping outside quotes.
- Should the spec pin this? unsure, because the explicit double-quote escape rule suggests this choice, but a formal command grammar would be clearer.

## C-26: Unknown judge checks
- Spec reference: OPEN-JU-001
- Situation: ambiguous
- What I chose: Reject check kinds other than eq and approx as bad_request. Ignore additional members of recognized checks, cases, and full objects.
- Alternatives: Accept unknown checks and always pass or fail them, or add extension checks.
- Should the spec pin this? no, because other check kinds are expressly open.

## C-27: Tests execute in one process
- Spec reference: PROMPT.md rule 4; Interface
- Situation: missing
- What I chose: npm test invokes node:test with --experimental-test-isolation=none so all assertions run in the current process. This avoids the environment's restriction on subprocess pipes, including the test runner's worker transport. Driver integration tests launch a real child with regular-file descriptors.
- Alternatives: Default isolated test workers or a custom test runner.
- Should the spec pin this? no, because test infrastructure does not change program behavior.

## C-28: Supplied examples remain executable source tests
- Spec reference: PROMPT.md rule 4; all REQ sections
- Situation: missing
- What I chose: Write a test loader for every numbered, inline, and validation-table example in SPEC.md, asserting the documented values directly. Add independently written regression and integration tests, plus a guard that every requirement has executable coverage. Keep the supplied echo fixture verbatim as a local example asset and verify it against the document.
- Alternatives: Copy every example into separate fixtures or test only independent cases.
- Should the spec pin this? no, because the testing strategy is the builder's responsibility.
