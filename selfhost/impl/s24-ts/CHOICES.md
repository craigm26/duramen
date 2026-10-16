# Build choices

## C-1: Source organization
- Spec reference: none
- Situation: missing
- What I chose: Use small TypeScript modules for JSON values, parsing, semantic checks, oracle execution, judging, and the driver; expose the required driver through REGEN.json.
- Alternatives: One source file, or a class-based design.
- Should the spec pin this? no, module organization has no protocol effect.

## C-2: Additional driver white space
- Spec reference: Driver protocol; OPEN-RQ-001
- Situation: missing
- What I chose: Treat every ECMAScript-whitespace-only request line as blank, including a final unterminated blank line.
- Alternatives: Ignore only empty lines and lines made of spaces and tabs.
- Should the spec pin this? no, the protocol expressly leaves additional blank white space open.

## C-3: Driver input framing
- Spec reference: Driver protocol
- Situation: missing
- What I chose: End driver requests at LF, accept CR LF because the CR is JSON white space, and process a final nonblank line without LF. A lone CR does not frame a driver request. Decode invalid UTF-8 with the Node decoder replacement behavior.
- Alternatives: Require a final LF, or accept lone CR as a framing delimiter.
- Should the spec pin this? unsure, EOF framing and malformed UTF-8 are observable but are absent from the examples.

## C-4: Internal failures
- Spec reference: OPEN-RQ-004
- Situation: missing
- What I chose: Return internal_error with the request id and log the exception to standard error.
- Alternatives: Terminate the driver or invent another error code.
- Should the spec pin this? no, this behavior is explicitly open.

## C-5: Extra object members
- Spec reference: Interface; REQ-JU-001
- Situation: missing
- What I chose: Ignore extra members on requests, operation inputs, case objects, checks, and full objects after validating the specified members. Record request-member objects retain all their allowed members.
- Alternatives: Reject unknown members in protocol objects.
- Should the spec pin this? unsure, REQ-JU-001 explicitly ignores other case fields, but the request envelope could be stated equally explicitly.

## C-6: The open language
- Spec reference: OPEN-RC-001
- Situation: missing
- What I chose: Recognize type, edge, edgedef, property, and evidence as inert statements with ignored bodies. Accept returns and static clauses, applying the general clause indentation rule but adding no semantics or suite checks.
- Alternatives: Implement an extension language or reject these constructs.
- Should the spec pin this? no, these constructs are deliberately open.

## C-7: Version 0.2 checks
- Spec reference: OPEN-RC-001; REQ-RC-003
- Situation: missing
- What I chose: Read version 0.2 with the same core syntax and checks as 0.1, with no additional version-specific checks.
- Alternatives: Invent additional checks or a separate parser for 0.2.
- Should the spec pin this? no, the extra checks are explicitly open.

## C-8: Version statement position
- Spec reference: OPEN-RC-002
- Situation: missing
- What I chose: Allow duramen anywhere among statements; its first occurrence still decides the file version.
- Alternatives: Require duramen to be the first statement.
- Should the spec pin this? no, position is expressly open.

## C-9: Human-facing output
- Spec reference: OPEN-RQ-002
- Situation: missing
- What I chose: Return only the diagnostic strings, counts, cases, and verdicts specified by the driver; provide no separate brief renderer, columns, or diagnostic prose.
- Alternatives: Add a CLI and human-facing renderers.
- Should the spec pin this? no, the public operations do not require them.

## C-10: Oracle deadline
- Spec reference: OPEN-RQ-001; REQ-OR-004
- Situation: missing
- What I chose: Give each oracle run five seconds from process creation, then send SIGKILL. Preserve output already written and report T020. Set no separate record-size or output-size cap.
- Alternatives: Use another timeout or configurable limits.
- Should the spec pin this? no, running time and size are explicitly open.

## C-11: Oracle process transport
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: Use regular temporary file descriptors for child stdin and stdout. Write the entire UTF-8 input before launch, so the child reads the required lines followed by EOF; read output after exit. Stderr is discarded.
- Alternatives: Use child-process pipes and collect output incrementally.
- Should the spec pin this? no, pipes are not part of the protocol; this workspace rejects them, while ordinary file descriptors work.

## C-12: Oracle staging and file permissions
- Spec reference: REQ-RQ-001; REQ-OR-002; OPEN-RQ-003
- Situation: missing
- What I chose: Materialize request files in a fresh folder inside the implementation folder for each request. Use ordinary newly created file permissions, without executable bits, preserve file text, and remove staging after success or failure. All runs for a request share its materialized files.
- Alternatives: Reuse a working folder, change process cwd globally, or mark supplied files executable.
- Should the spec pin this? unsure, executable permissions and mutations between oracle runs are not represented in input.files.

## C-13: Order of independent oracle runs
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: Send ordinary examples together in record order, then run solo examples one by one in record order. Do not start a process for an empty group.
- Alternatives: Start solo processes before the ordinary batch, or split the batch at every solo example.
- Should the spec pin this? unsure, order within each input stream is clear, but relative process-launch order is not.

## C-14: Leaving and reentering the record folder
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: Reject a from-file path immediately if a .. component would leave the record folder, even if later components could reenter it. Empty components and . still disappear as specified.
- Alternatives: Normalize the entire path first and test only its final location.
- Should the spec pin this? yes, transient traversal could be pinned for consistent implementations.

## C-15: Line errors in ignored bodies
- Spec reference: REQ-SY-001; REQ-SY-002; REQ-SY-003
- Situation: ambiguous
- What I chose: Apply the leading-white-space check globally before parsing statements. Thus P001 can occur inside an otherwise ignored unknown or duplicate body; other body syntax is ignored there.
- Alternatives: Suppress P001 along with the rest of an ignored body.
- Should the spec pin this? yes, the universal line rule and body-skipping rules have overlapping scope.

## C-16: Comments before the first statement
- Spec reference: REQ-SY-002; REQ-SY-003
- Situation: ambiguous
- What I chose: An indent-zero comment is always ignored. An indented comment before the first statement gets P003; indent-two comments become comments once there is a statement body.
- Alternatives: Ignore indent-two comments even before the first statement.
- Should the spec pin this? yes, the distinction between file context and clause context deserves an example.

## C-17: Unusual file system names
- Spec reference: OPEN-RQ-003
- Situation: missing
- What I chose: Keep record selection and from-file lookup in memory using exact JavaScript string keys. If materializing a platform-inexpressible file name fails, use the internal_error response.
- Alternatives: Normalize names or reject them as bad_request.
- Should the spec pin this? no, platform-inexpressible names are expressly open.

## C-18: Other judge check kinds
- Spec reference: OPEN-JU-001
- Situation: missing
- What I chose: Reject checks of kinds other than eq and approx with bad_request.
- Alternatives: Accept unknown kinds and always fail them, or add extension checks.
- Should the spec pin this? no, these checks are expressly open.

## C-19: Nonfinite judge values
- Spec reference: OPEN-JU-002
- Situation: missing
- What I chose: Reject a judge input containing any nonfinite binary64 number with bad_request, including numbers nested in an eq value or answer.
- Alternatives: Compare infinities using native arithmetic or treat them as missing.
- Should the spec pin this? no, overflow in judge inputs is expressly open.

## C-20: Diagnostics for malformed indentation under open clauses
- Spec reference: OPEN-RC-001; REQ-SY-003
- Situation: ambiguous
- What I chose: Let accepted returns and static clauses take no continuation lines, like ordinary non-text clauses. Ignore the entire body only for open statement kinds.
- Alternatives: Ignore continuation lines for every open construct.
- Should the spec pin this? no, this concerns constructs whose semantics are explicitly open.

## C-21: Test runner isolation
- Spec reference: PROMPT.md rule 4
- Situation: missing
- What I chose: Run node:test in the current process using --experimental-test-isolation=none. The tests still use node:test and node:assert and all test files end in .test.ts.
- Alternatives: Use the default child-process isolation.
- Should the spec pin this? no, the workspace pipe restriction requires this runner setting, not a language choice.
