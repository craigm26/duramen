# Test coverage

The executable tests use node:test and node:assert. spec-examples.test.ts independently reads the Markdown examples and checks every stated expected value through the public request handler, after JSON serialization. It includes every numbered example, inline example, and judge table row. Its final test requires coverage of all 47 requirement IDs. core.test.ts adds independent tests for the interactions listed below and a real driver process test.

Each mandatory behavior in a requirement is covered by its published examples and the independent tests. The table records those behaviors so requirements containing several MUST statements are not represented by their title alone.

| Requirement | Mandatory behavior exercised |
|---|---|
| REQ-RQ-001 | Virtual files; relative names; diagnostic names; explicit and default entries. |
| REQ-RQ-002 | Exact error envelopes, validation precedence, and continuation after invalid requests. |
| REQ-RC-001 | File-only and recursive folder selection, exclusions, missing entries and empty records. |
| REQ-RC-002 | File order by UTF-16 code units, including supplementary Unicode names. |
| REQ-RC-003 | Required versions, unknown and repeated versions, first declaration, mixed-version diagnostics. |
| REQ-RC-004 | Missing spec, duplicate singletons, malformed first declarations and reading duplicate bodies. |
| REQ-RC-005 | P diagnostics stop semantic checks and oracle execution. |
| REQ-RC-006 | File/line/code/level ordering, identical diagnostics retained, counts by level. |
| REQ-SY-001 | BOM, CR LF and CR lines, trailing and blank white space, P001, U+2028/U+2029. |
| REQ-SY-002 | Statement keywords, comments, unknown statements and skipped bodies, P003. |
| REQ-SY-003 | Clause indentation, comments, unsupported clauses, duplicate clauses and ignored continuations. |
| REQ-SY-004 | Spec/oracle headers, quoted titles, request object validation, reserved members and missing commands. |
| REQ-SY-005 | Text headers, four-space removal, three-space errors, blank edges and text comments. |
| REQ-SY-006 | JSON quoted strings, word IDs, title boundaries and malformed JSON titles. |
| REQ-SY-007 | Operation headers, field splitting and validation, duplicate names/paths, tolerance numbers, audit clauses. |
| REQ-SY-008 | Errors-list header, condition syntax and continuation indentation, repeated codes. |
| REQ-SY-009 | Requirement clauses, platforms, open items, decision clauses, section/note syntax. |
| REQ-SY-010 | Ordinary/raw/missing inputs, malformed-header recovery, expectations, request duplicates, omissions, raw restrictions. |
| REQ-SY-011 | Input paths and text, comments and boundaries, exact file texts, relative resolution and diagnostic precedence. |
| REQ-SY-012 | Row/separator syntax, structural diagnostics, header validation left to right, cell counts and values. |
| REQ-SY-013 | Finite binary64 validation for nested JSON, example objects, requests, tolerances and table cells. |
| REQ-CK-001 | Requirements without examples or table rows get T001. |
| REQ-CK-002 | ID uniqueness within each kind; duplicate operations use their first declaration. |
| REQ-CK-003 | Missing cited decisions get T008 once per distinct citation. |
| REQ-CK-004 | Unknown operations, missing required fields, extra-field warnings, raw/error exemptions. |
| REQ-CK-005 | Declared error values for equality, approximate and table expectations; oracle values exempt. |
| REQ-CK-006 | Obligations in each non-requirement text, warning for open items, whole words and line-local quotations. |
| REQ-CK-007 | Open examples and tables get T003 without reading their bodies. |
| REQ-CK-008 | Two distinct error codes and order phrases, ASCII boundaries, multiline phrases. |
| REQ-CK-009 | Unused and unsourced decisions, status syntax, supersession targets, citation levels, duplicate declaration behavior. |
| REQ-OR-001 | T019 without an oracle when any requirement has examples. |
| REQ-OR-002 | Shell-free tokenization, actual processes and cwd, lines and UTF-8, IDs, duplicate outputs, solo runs and eligibility. |
| REQ-OR-003 | Equality, missing values, object/array paths, JSON audit paths, binary64 approximation and per-expectation diagnostics. |
| REQ-OR-004 | Failed starts, unclosed commands, nonzero exits, signals, timeouts and retained answers; batch/solo locations. |
| REQ-OR-005 | T021 for absent, malformed, nonobject and nonfinite answers. |
| REQ-OR-006 | oracle_error values including null yield T022 and suppress response checks. |
| REQ-OR-007 | Unexpected error warnings only when no expectation at all is stated. |
| REQ-OR-008 | Oracle-derived expectations and T025 for missing paths. |
| REQ-SU-001 | Matching check/cases error counts, no cases with errors, warnings allow suites. |
| REQ-SU-002 | One case per example/row, record order, IDs, platform, reqs and solo field. |
| REQ-SU-003 | Raw line preservation; ordered envelope, request precedence, omissions, original JSON spelling and compact modified input. |
| REQ-SU-004 | Ordered equality, approximation and oracle-derived checks with their values and metadata. |
| REQ-SU-005 | Sorted response members, result/error presence, declared string audit, tolerance maps and raw-operation exemption. |
| REQ-JU-001 | Input validation, null answers, complete verdicts and failed-part ordering. |
| REQ-JU-002 | Own-member paths, canonical array indexes, missing values, empty names and parsed audit paths. |
| REQ-JU-003 | Strict JSON equality, binary64 numbers, object order, array order and approximation boundaries. |
| REQ-JU-004 | Exact member lists, error-first comparison, recursive result tolerances, exact audit text. |

The Interface driver protocol is tested with invalid requests followed by valid requests, blank lines, Unicode and embedded CR/LF in JSON strings, response order, exact response shapes, an unterminated final input line, output LF bytes, no literal output CR, empty standard error on successful requests, and exit status 0. Oracle deadline and process-isolation choices are also exercised. Open language extensions, human-facing rendering and unspecified external suite execution are intentionally outside mandatory coverage.
