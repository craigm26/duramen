# Requirement coverage

`npm test` executes 265 node:test tests: 238 supplied examples, a coverage and fixture guard, and 26 independently written tests. The source-example loader asserts every documented result, including exact diagnostics and request strings; it does not ask the implementation to supply its own expected values. Each row below lists all normative behaviors in that requirement. Each is exercised by its named requirement's examples in specification.test.ts; core.test.ts adds the independent checks described in its test names.

| Requirement | Required behaviors covered |
|---|---|
| REQ-RQ-001 | Virtual file map, request-relative diagnostic names, entry file and folder selection, path restrictions, file/folder conflicts. |
| REQ-RQ-002 | Exact error envelopes, validation precedence, malformed JSON, invalid IDs, operations and inputs, continuation to the next request. |
| REQ-RC-001 | Single-file records, recursive folder selection and exclusions, explicit excluded-name roots, missing and empty records produce only P046. |
| REQ-RC-002 | UTF-16 ordering across files, ASCII case, path separators, and supplementary characters. |
| REQ-RC-003 | Required versions, missing P020, invalid and repeated P023, whole version line, first statement determines version, mixed-version P047. |
| REQ-RC-004 | Exactly one spec, missing P021 location, duplicate spec/oracle P044 and errors P032, malformed first declarations count, duplicate bodies still parsed. |
| REQ-RC-005 | Reading errors prevent semantic checking and oracle execution. |
| REQ-RC-006 | Diagnostic ordering by file, line, code and level; duplicate diagnostics retained; exact error and warning counts. |
| REQ-SY-001 | UTF-8, initial BOM, LF/CRLF/CR, trailing whitespace, whitespace-only lines, spaces-only indentation, P001 and ignored malformed indentation, U+2028/U+2029 remain within a line. |
| REQ-SY-002 | Statements and top-level comments, unknown P002 and ignored bodies, leading indented P003. |
| REQ-SY-003 | Two-space clauses, comments, orphan continuation P006, one-space P007, forbidden P015 with ignored body, repeated once-only P052 with ignored body, body restrictions. |
| REQ-SY-004 | Statement arities, spec clauses, object-only finite request JSON P009, reserved request keys P051, empty oracle P028 and continued clause parsing. |
| REQ-SY-005 | Text-clause arity P008, four-space removal, leading/trailing blank trimming, internal blank preservation, three-space P008, literal comments. |
| REQ-SY-006 | JSON-string validation P004; ID and full title extraction; missing, unclosed and lone-quote title P005; malformed quoted title P004. |
| REQ-SY-007 | Op arity P031, input-field grammar and delimiter nesting, malformed P017 claims no name, duplicate fields P052, tolerance P018 claims no path, duplicate tolerances P052, audit P050, request members. |
| REQ-SY-008 | Errors statement arity, when-clause grammar P019, continued condition text including comments, three-space continuation P006, repeated codes. |
| REQ-SY-009 | Requirement, open, decision, section and note clauses; platform grammar P033; empty citations; repeated citation clauses; note arity. |
| REQ-SY-010 | Ordinary, absent-input and raw examples; raw JSON/single-quote forms; CR/LF P026; malformed P004/P009/P012; dropped example body recovery; line indentation P006; equality, approximate and captured checks; P009/P010/P011; request duplicate P052; empty omit P011; raw mutation P022; from-line continuation P006. |
| REQ-SY-011 | Input path grammar, object creation, input-text boundaries and comments, LF and blank handling, from-line ABNF, exact file contents, relative normalization, final-location confinement, missing files, at most one diagnostic in the stated priority, dropped-example empty input. |
| REQ-SY-012 | Rows and non-row P006, escaped pipes and optional trailing pipe, separators anywhere, basic P013 recovery, header grammar and precedence, duplicate-header P013, left-to-right tolerance P010, wrong-width P014, input and expectation cells, captured cells, finite JSON and approximate-number errors. |
| REQ-SY-013 | Nested nonfinite record JSON P009 only, nonfinite expected numbers P010 and tolerances P018, raw overflow remains sendable, nonfinite oracle responses cannot supply values. |
| REQ-CK-001 | Missing example and table row T001. |
| REQ-CK-002 | Requirement/open/decision/op uniqueness within kind, subsequent-use T007, first operation's fields, distinct kinds share IDs. |
| REQ-CK-003 | Undeclared decision T008 once per cited ID. |
| REQ-CK-004 | Undeclared operation T009, each required missing field T010, each extra field warning T011, table-row locations, raw and error-expecting examples exempt. |
| REQ-CK-005 | Undeclared and non-string error values T023, equality and approximate checks and table cells, oracle-captured error exemption. |
| REQ-CK-006 | Obligation words, ASCII boundaries, each eligible text and alternative, proper diagnostic location, open warning T014, quote exemptions, no spanning lines, preserved quotation boundaries, titles exempt. |
| REQ-CK-007 | Each open example/table T003 with its body unread. |
| REQ-CK-008 | Two distinct declared error codes plus an ordering phrase T005, exact word boundaries, case folding, whitespace and line breaks. |
| REQ-CK-009 | Uncited T012 and missing source T013, lifecycle status grammar T027, superseded target and exact spacing, absent status accepted, citation warning/error T028, deduplicated citations and duplicate-declaration semantics. |
| REQ-OR-001 | Examples without oracle T019 at spec, no execution. |
| REQ-OR-002 | Quote-aware command splitting, direct process without shell, oracle-file cwd, request order and LF, UTF-8 surrogate replacement, output LF splitting, blank lines ignored, matching IDs and first response, solo runs and exactly-one-line rule, finite response validation, static errors do not suppress eligible examples, no empty launch. |
| REQ-OR-003 | Each failed expectation T002 at correct line, object-member and array paths, binary64 JSON equality, audit JSON decoding, empty path members, inclusive approximate distance. |
| REQ-OR-004 | Start/quote failures, nonzero exits, signal and timeout T020, shared and solo diagnostic locations, partial responses still used. |
| REQ-OR-005 | Missing or invalid/nonfinite responses T021. |
| REQ-OR-006 | Any oracle_error member produces T022; no expectation mismatch, missing capture, or unexpected-error warning for that response. |
| REQ-OR-007 | Error member of any value with no expectations produces warning T024, any explicit expectation suppresses it. |
| REQ-OR-008 | Oracle values populate captures, absent values produce T025. |
| REQ-SU-001 | Same error count as check, empty suite on errors, warnings allow cases. |
| REQ-SU-002 | One case per example/table row, record and line order, numbering and IDs, reqs, kind, platform, solo presence, checks and full. |
| REQ-SU-003 | Raw line exact, id/op first and input last, operation replacement and example overlay, ECMAScript member order, omit behavior, absent input, exact original JSON spellings, table cell spellings, compact updated input. |
| REQ-SU-004 | Ordered eq and approx check objects, tolerances, captured oracle values with from marker. |
| REQ-SU-005 | Sorted full members, error/result presence, declared string audit only, all tolerance paths including __proto__, raw has no operation or audit. |
| REQ-JU-001 | Validation of case/checks/full/answer, exact verdict envelopes, null answer failure alone, ordered check and full-part failures. |
| REQ-JU-002 | Object and canonical array-index paths, no array length, empty names, absent paths, finite audit JSON. |
| REQ-JU-003 | Structural JSON equality, type distinctions, -0 and binary64 equality, approximate inclusive binary64 distance. |
| REQ-JU-004 | Null full, exact sorted member list, structured error equality and result/audit suppression, recursive result tolerances with exact shape, exact audit code units. |

The driver integration test separately verifies the Interface's byte and process requirements: one response per nonblank request in order, no extra response members, UTF-8, LF termination, no literal CR, and exit status zero at EOF. Source documents are only read from this folder; no network or installed dependencies are used.
