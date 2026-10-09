# Choices

## C-1: Statements of the rest of the language
- Spec reference: REQ-SY-002, OPEN-RC-001
- Situation: ambiguous
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` are accepted with no diagnostic, and their bodies are ignored.
- Alternatives: P002 for them (the core language does not know them); read their clauses.
- Should the spec pin this? no, the rest of the language is open on purpose.

## C-2: Statement with no ID and title
- Spec reference: REQ-SY-006
- Situation: missing
- What I chose: `section`, `req`, `open` or `decision` with nothing after the keyword gets P005, like a missing title.
- Alternatives: P004; a new code.
- Should the spec pin this? yes, `req` alone is an easy mutation.

## C-3: Statement whose ID/title is bad is still read, but not registered
- Spec reference: REQ-SY-006, REQ-SY-009
- Situation: missing
- What I chose: the clauses of a statement with a P004/P005 title are still read for their own problems. The statement is dropped from the model, which only matters after a reading error, so it cannot change any later check.
- Alternatives: skip its clauses.
- Should the spec pin this? yes, it decides whether extra P codes appear.

## C-4: `omit` with no name in a raw example
- Spec reference: REQ-SY-010
- Situation: contradictory (P011 for empty `omit`, P022 for `omit` in a raw example)
- What I chose: P022 only.
- Alternatives: P011 only; both.
- Should the spec pin this? yes.

## C-5: Invalid `request` line in a raw example
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: P022 only. The JSON of a `request` line in a raw example is not looked at. Text lines under a raw example's `input` line are consumed as its text, so they give no P006, and the `input` line gets P022 only (no P049).
- Alternatives: P022 plus P009/P051 or P049.
- Should the spec pin this? yes.

## C-6: Example whose first line was rejected, and raw
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: a malformed `example raw ...` (P004 or P026) is still raw, so P022 applies to its `request`/`omit`/`input` lines. A malformed `example <op> ...` is not raw.
- Alternatives: treat a dropped example as neither.
- Should the spec pin this? unsure.

## C-7: `expect` line forms
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: after the path, `=` gives a value (P009 if it is empty or not JSON), `≈` or `~` gives the approximate form (P010 if malformed or the tolerance is negative), and anything else, including nothing, is P011. An empty path is P011. After `=` the whole rest of the line is the value, so `expect r == 1` is P009.
- Alternatives: P010 for `≈` with no `±` and a different code for `==`.
- Should the spec pin this? no, covered by examples.

## C-8: Input path details
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: an empty path (`input` alone) is P049; a quoted segment may be the empty string. The `from` form is recognised by the regex `<path> from "<json string>"` at the end of the line, taking the first ` from ` that leaves a valid quoted string at the end. If the quoted part is not a JSON string, the line is read as a plain `input <path>` (so P049). An invalid path gets P049, and P048 is only judged for a valid path. A path through an existing non-object (an array counts as one) gets P049. The last name of a path replaces whatever was there. After `input <path>` text lines are always consumed, even when the path is invalid.
- Alternatives: P004 for a bad quoted file name; P048 before P049.
- Should the spec pin this? yes.

## C-9: Files read by `from`
- Spec reference: REQ-SY-011, REQ-RC-001
- Situation: ambiguous
- What I chose: the name is resolved against the folder of the example's file, with `.` and empty parts skipped and `..` popping. An absolute name (starting with `/`) or one that leaves the record's folder is P048. A name that is a folder or missing is P048. File text is used as given (no newline conversion). The record's folder for a file record is the folder of that file.
- Alternatives: allow any file named in the request; backslashes as separators.
- Should the spec pin this? no.

## C-10: Ignored tab-indented lines
- Spec reference: REQ-SY-001
- Situation: ambiguous
- What I chose: a line with P001 is removed entirely. It is not blank and it does not end a text or an input text.
- Alternatives: treat it as blank.
- Should the spec pin this? yes.

## C-11: Comment lines and text clauses
- Spec reference: REQ-SY-003, REQ-SY-005, REQ-SY-008
- Situation: ambiguous
- What I chose: a `#` line indented two spaces never starts a clause and does not end the previous clause (a `text` goes on after it). A `#` line indented three spaces is not a comment under `text` (P008) or `errors` clauses (P006). A `#` line under an example, a table or a plain clause at indent 3 or more is a comment (no diagnostic).
- Alternatives: comment first, everywhere.
- Should the spec pin this? yes.

## C-12: More than one bad header cell, and P010 together with P013
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: P013 is reported once per header, at the header's line, and the header's P010s are dropped then. Each bad tolerance is one P010 at the header line. P006 for lines that are not rows is reported even when the table has P013.
- Alternatives: one P013 per bad cell.
- Should the spec pin this? unsure.

## C-13: Header cell named `result`, `audit`, `error` or `id`
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: such a cell is always an expectation path, even if the operation has an input field of that name.
- Alternatives: input field when the operation declares it.
- Should the spec pin this? unsure.

## C-14: Table row syntax corners
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a row such as `|   |` or `|` counts as a separator (it is only `|`, `-`, `:` and spaces and starts and ends with `|`). `\|` is a `|` in a cell; any other backslash stays. A trailing part after the last `|` that is not white space is a final cell. The header's tolerance is split at the first `±` or `+-`. In a tolerance column a `?` cell is still an oracle value. A table row's expectations can all be empty.
- Alternatives: none of note.
- Should the spec pin this? no.

## C-15: Whole-word test for MUST etc.
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: letters means ASCII letters, digits and `_` (as ECMAScript `\w`). A quotation is `"..."`, `“...”` or backquotes on one line, found left to right. One T004 per text however many words it holds.
- Alternatives: Unicode letters.
- Should the spec pin this? no.

## C-16: Which examples are run when other checks fail
- Spec reference: REQ-OR-002, intro of "Running the examples"
- Situation: contradictory (the intro says "when a record has no other errors", REQ-OR-002 says "whatever else the checks find")
- What I chose: follow REQ-OR-002: every example of a declared op, and every raw or error-expecting example, is run when the record has an oracle and was read without errors.
- Alternatives: run nothing when T errors exist.
- Should the spec pin this? yes.

## C-17: Oracle timeouts and output
- Spec reference: REQ-OR-004
- Situation: missing
- What I chose: 30 seconds per run of the oracle, then it is killed (T020). Blank output lines are ignored; a trailing CR is removed. For a solo example, the response is the only non-blank line; it has to be a JSON object, else it counts as no response. The oracle runs in a temporary copy of the request's files, in the folder of the file holding the `oracle` statement. Its stderr is discarded.
- Alternatives: other limits.
- Should the spec pin this? no (OPEN-RQ-001).

## C-18: Who gets T024 and T025, and the expectations of unanswered examples
- Spec reference: REQ-OR-005, REQ-OR-007, REQ-OR-008
- Situation: ambiguous
- What I chose: T024 needs the example to have no expectation of any kind. An example with no response, or with `oracle_error`, has none of its expectations checked (no T002/T025). A non-number found where `≈` expects a number is T002.
- Alternatives: T024 only when there is no `error` expectation.
- Should the spec pin this? unsure.

## C-19: T023 with a non-string value
- Spec reference: REQ-CK-005
- Situation: missing
- What I chose: `expect error = <value>` where the value is not a string, or is not a declared code, is T023. The check is on `eq` expectations whose path is exactly `error`.
- Alternatives: ignore non-strings.
- Should the spec pin this? no.

## C-20: Decision status
- Spec reference: REQ-CK-009
- Situation: ambiguous
- What I chose: a status whose first word is not valid gets T027 and no T028. `superseded by <ID>` must match exactly one space between the words. A `status` with only white space is a status with no word (T027). T028 for a decision that is cited but undeclared is not raised (T008 covers it).
- Alternatives: treat invalid statuses as accepted.
- Should the spec pin this? no, the examples show it.

## C-21: T005 phrase matching
- Spec reference: REQ-CK-008
- Situation: ambiguous
- What I chose: phrases match case-insensitively with any white space between their words, and as whole words (no letter, digit or `_` touching). Codes use the `-` exclusion too, as the spec says. Codes are those of the first `errors` statement.
- Alternatives: single spaces only.
- Should the spec pin this? no.

## C-22: Second statements of a kind
- Spec reference: REQ-RC-004
- Situation: ambiguous
- What I chose: a second `spec`, `oracle`, `errors` has no effect on the model (its text is not checked for T004). A second `op` of the same name is T007, the first is the one used, but its `result` text is still checked for T004.
- Alternatives: check nothing of a duplicate op.
- Should the spec pin this? unsure.

## C-23: `duramen` statement details
- Spec reference: REQ-RC-003
- Situation: ambiguous
- What I chose: the version is the whole rest of the line, so `duramen 0.1 x` is P023. `duramen` may come anywhere in a file (OPEN-RC-002); only the first one counts for the version. A file with no `duramen` statement is P020 and takes no part in P047. A bad `duramen` clause is P015.
- Alternatives: first word only.
- Should the spec pin this? no.

## C-24: Request lines and numbers
- Spec reference: REQ-SU-003
- Situation: ambiguous
- What I chose: all JSON numbers are read as binary64 and written the way `JSON.stringify` writes them (`1e21`, `1e-7`, `-0` as `0`). Request members from `spec`/`op`/`example` use ECMAScript key order (index-like names first, ascending). Members named by `omit` are removed from the final set, including `id`, `op` and `input`. A table row's input text is built from the cell texts as written. An op `request` clause replaces the spec's, and an undeclared op uses the spec's. Duplicate object keys in JSON: the last value wins, in the first position.
- Alternatives: keep integer text.
- Should the spec pin this? no, the examples show it.

## C-25: Output encoding of responses
- Spec reference: Driver protocol
- Situation: missing
- What I chose: responses are written as ASCII, with every non-ASCII character as a `\uXXXX` escape (surrogate pairs for characters above U+FFFF). They parse to the same JSON.
- Alternatives: literal UTF-8.
- Should the spec pin this? no.

## C-26: Request validation
- Spec reference: Errors
- Situation: ambiguous
- What I chose: `entry` present as `null` is `bad_request`; JSON `NaN`/`Infinity` are not JSON, so `bad_request`; a request line with invalid UTF-8 is decoded with replacement characters. Lines are split on LF only, and a trailing CR is removed before parsing. A line is blank only if it holds spaces and tabs.
- Alternatives: reject invalid UTF-8.
- Should the spec pin this? no (the spec leaves other white space open).

## C-27: `errors` clause details
- Spec reference: REQ-SY-008
- Situation: ambiguous
- What I chose: the code is the first word, whatever it is (even `when`). P019 is judged on the first line only. The condition text is the rest of the first line plus the continuation lines (four spaces removed).
- Alternatives: a code that must look like an identifier.
- Should the spec pin this? no.

## C-28: Order of ops in `analyze` for IDs
- Spec reference: REQ-CK-002
- Situation: ambiguous
- What I chose: the second use of an ID gets T007 at its line, in record order. An op with a malformed name (P031) never gets this far.
- Alternatives: none.
- Should the spec pin this? no.

## C-29: Table rows with P009/P010 cells
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a row with any P009 or P010 cell is reported for every bad cell and then dropped, so it gives no example (and no T001 relief, which cannot matter as the record has a P error).
- Alternatives: keep the row.
- Should the spec pin this? no.
