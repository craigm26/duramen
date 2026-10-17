# Test-suite notes

`outside-suite.jsonl` contains **554 cases**: **546 single requests** and **8 sessions**. Names are unique. All 47 `REQ-` requirements have cases beyond their own examples. Each case carries its supporting citations.

Expected values were derived from SPEC.md and DECISIONS.md. A temporary authoring script assembled the requests and serialized the authored expectations; it did not implement duramen, interpret records, judge answers, or run an oracle. Every embedded oracle file is an exact copy of `fixtures/echo.mjs` from SPEC.md, including its final newline. Nothing needs to be installed or placed on disk for a record.

## Coverage groups

Names begin with the group shown below. Ranges in this table include both endpoints.

| Name prefix | Count | Requirements and focus |
|---|---:|---|
| `protocol-` | 75 | REQ-RQ-001–002; Interface/Errors and Operations. Malformed JSON, envelope types, identifier and operation precedence, invalid file maps, path validation, file/folder conflicts, invalid entry values, empty and Unicode identifiers. |
| `stream-` | 8 | Driver protocol; REQ-RQ-002. Empty input, blank lines, recovery, ordered responses, repeated identifiers, independent records, mixed operations, exit status 0. |
| `record-` | 19 | REQ-RQ-001; REQ-RC-001–002, 004, 006. File and folder entries, recursion, exclusions, explicitly selected excluded names, missing/empty records, UTF-16 file and diagnostic order. |
| `version-` | 12 | REQ-RC-003–006; REQ-SY-003. Missing, invalid and repeated versions, whole-line version spelling, mixed versions, ineffective second directives, continued body reading. |
| `singleton-` | 4 | REQ-RC-004–006; REQ-SY-004, 008. Malformed first and repeated spec/oracle/errors statements, independent problems on repeated statements, diagnostic ordering. |
| `reading-` | 1 | REQ-RC-005–006; REQ-CK-001, 003. Reading errors suppress later semantic diagnostics. |
| `syntax-` | 137 | REQ-SY-001–013; REQ-RC-003–006; REQ-CK-006. Line endings and whitespace, statements, clauses, malformed first lines, duplicates, text, titles, operations, fields, tolerances, errors, examples, input texts/files, table headers/rows, nonfinite record numbers. Includes suppression and diagnostic multiplicity. |
| `semantic-` | 72 | REQ-CK-001–009; REQ-RC-006; related SY and OR rules. Missing examples, per-kind uniqueness, deduplicated citations, first operation/decision declarations, input fields, declared errors, obligation boundaries and quotations, open-item tests, error-order phrases, decision lifecycle and diagnostic levels. |
| `oracle-` | 41 | REQ-OR-001–008; REQ-SY-001, 013; REQ-RC-006. Missing/unused oracles, command quoting and working folder, semantic errors that permit execution, JSON equality and paths, binary64 distances, response matching/order, duplicate ids, solo responses, output lines, missing/nonfinite answers, process exit, oracle_error, unexpected errors, oracle-derived values. |
| `suite-` | 38 | REQ-SU-001–005; REQ-SY-007, 009, 011–012; REQ-RC-002, 005–006; relevant CK/OR rules. Error suppression and warning tolerance, complete case objects, counts/order/platforms, exact request text, request-member replacement/merge/order/omission, compact input texts, file resolution, raw requests, check order, audit inclusion, full member lists and tolerances. |
| `judge-` | 147 | REQ-JU-001–004; REQ-OR-003. Invalid forms, null answers, ignored metadata, JSON type equality, binary64 comparison, object/array/empty-name paths, audit JSON, approximate boundaries, exact full-member order, error precedence, result shape, path-specific tolerances, exact audit strings, failure order, independence of checks and full comparisons. |

The groups overlap intentionally. For example, an oracle comparison can verify a semantic diagnostic while also proving that semantic errors did not prevent oracle execution. Citations identify the rules that determine each expectation, rather than reproducing the entire transitive dependency chain.

## Deliberate omissions

The following open matters are not asserted:

- **OPEN-RQ-001:** size limits, execution deadlines and performance. Process-failure tests use explicit fixture exit codes or an unclosed command quote, without depending on a timeout or an installed nonexistent-command name.
- **OPEN-RQ-002:** diagnostic messages, columns, briefs, decisions renderings and traces. The suite uses the diagnostic representation specified for the driver and examples.
- **OPEN-RQ-003:** platform-forbidden names, reserved device names and case-only filename collisions. UTF-16 ordering tests use distinct, storable names. Universally invalid request paths are tested because REQ-RQ-001 explicitly decides their rejection.
- **OPEN-RQ-004:** checker failures after accepting a request and `internal_error` handling.
- **OPEN-RC-001:** other statements, `op.returns`, `req.static` and semantic additions of language version 0.2. The 0.2 records here either have a reading error that stops further checking or test mixed-version rejection.
- **OPEN-RC-002:** valid records that put their version directive after another statement. Missing-version and orphan-line cases do not rely on permitting a later version directive.
- **OPEN-SU-001:** running generated suites against implementations, selecting their responses and generated protocol-case behavior. The stream cases here exercise the duramen driver itself, whose protocol is specified separately.
- **OPEN-JU-001:** check kinds other than `eq` and `approx`, and their associated fields.
- **OPEN-JU-002:** nonfinite numeric values directly in a judge case or answer. A finite judge input containing an *audit string* with `1e400` is different: REQ-JU-002 explicitly decides that the audit JSON then holds no value.
- Driver blank lines containing whitespace other than spaces and tabs, which the Driver protocol expressly leaves open. Record whitespace is specified separately and is tested.

These additional corners were left out where the text does not give an unambiguous assertion:

- Duplicate member names in JSON object text: no general duplicate-key policy is stated for driver envelopes, example inputs, audit JSON or oracle responses. This differs from duplicate duramen declarations and clauses, which are specified and tested.
- An `expect` line with no recognizable comparison operator or with an empty path: the text identifies lines by their first word but does not expressly assign one diagnostic to every malformed remainder. Tests use malformed forms whose P009/P010 outcome is stated.
- An input built with input-text lines whose original object has integer-like member names: REQ-SU-003 invokes `JSON.stringify` order and also describes members in written order. Those descriptions can diverge for such keys. Integer-like *request* members are tested, since their order is explicit.
- Combining missing required fields with `omit input`: REQ-CK-004 does not explicitly distinguish checking the written input from checking the request after omission. Omission tests use operations with no required fields.
- A `from` path that temporarily ascends outside the record folder and then returns inside: the text does not expressly distinguish intermediate traversal from the final resolved name. Ordinary normalization, resolution from the example's folder, and direct escapes are tested.
- A solo oracle run that both returns `oracle_error` and exits unsuccessfully: REQ-OR-006 says T022 and nothing else, while REQ-OR-004 independently places T020 at the example. The interaction is omitted; each rule is tested independently.
- Malformed/extra driver-object members beyond the listed required fields, except where REQ-JU-001 expressly says only `checks` and `full` are read from a case. No general policy for extra envelope/input fields is inferred.

## Validation and limits

Validation checked JSONL structure, unique names, the two permitted case forms, request/session line boundaries, response envelopes, citation validity, coverage of every requirement ID, diagnostic counts and ordering, and exact fixture copies. Expected diagnostic lists do not mix semantic diagnostics with reading errors.

No duramen implementation is present, written or executed. These are specification-derived assertions, not results obtained from a reference implementation. Parsed-response expectations cannot independently inspect output encoding or CR/LF bytes; the session cases assert response content/count/order and exit status within the supplied format. Standard error is left unchecked.
