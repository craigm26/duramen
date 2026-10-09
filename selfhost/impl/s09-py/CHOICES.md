# CHOICES

## C-1: Statements of the rest of the language
- Spec reference: OPEN-RC-001, REQ-SY-002
- Situation: missing
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` are accepted with no diagnostic and their bodies are ignored. Clauses `returns` (of `op`) and `static` (of `req`) are accepted as one-line clauses; `static` also satisfies T001.
- Alternatives: P002 for them; reading their bodies.
- Should the spec pin this? no, it is open on purpose.

## C-2: A `#` line at indent 0 inside a statement body
- Spec reference: REQ-SY-002
- Situation: missing
- What I chose: it is a comment and is skipped; it does not end the current clause or its text.
- Alternatives: it ends the statement's body.
- Should the spec pin this? yes, one sentence.

## C-3: Indent-1 lines under an unknown statement or clause
- Spec reference: REQ-SY-002, REQ-SY-003
- Situation: ambiguous
- What I chose: the body of an unknown statement is ignored entirely (no P007). Under a known statement an indent-1 line is P007 even inside an ignored (P015 / P052) clause.
- Alternatives: P007 everywhere.
- Should the spec pin this? yes.

## C-4: Missing ID or title on section/req/open/decision
- Spec reference: REQ-SY-006
- Situation: missing
- What I chose: `req` with no ID, or an ID and no title, is P005.
- Alternatives: P021 or P004 for a missing ID.
- Should the spec pin this? no.

## C-5: `duramen` statement text
- Spec reference: REQ-RC-003
- Situation: ambiguous
- What I chose: the whole rest of the line must be exactly `0.1` or `0.2`; `duramen 0.1 extra` is P023. A second `duramen` statement is always P023, whatever its version, and its clauses all get P015.
- Alternatives: judge only the first word.
- Should the spec pin this? yes.

## C-6: Where P047 is reported when several files disagree
- Spec reference: REQ-RC-003
- Situation: ambiguous
- What I chose: only the first `duramen` statement of each file counts; P047 once, at line 1 of the record's name.
- Alternatives: one per disagreeing file.
- Should the spec pin this? no, the spec says "the record".

## C-7: Tolerance clauses and P052
- Spec reference: REQ-SY-003, REQ-SY-007
- Situation: contradictory
- What I chose: REQ-SY-003 says a once-only clause counts even if its first copy had a problem, but REQ-SY-007 Example 5 shows repeated `tolerance result.x` clauses with bad numbers getting P018 each. So a tolerance path is "taken" only when its number was valid; a repeat of a valid one is P052.
- Alternatives: count bad ones too (contradicts the example).
- Should the spec pin this? yes.

## C-8: `audit` clause with a problem
- Spec reference: REQ-SY-007
- Situation: missing
- What I chose: `audit x` gets P050, counts as the op's one `audit` clause (a second is P052), and does not turn auditing on.
- Alternatives: turn it on anyway.
- Should the spec pin this? no (the record is in error anyway).

## C-9: `expect` line forms
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: after the path, `=` gives a value, `≈`/`~` gives the number form (separator `±` or `+-`, the earliest occurrence in the text), anything else, including a path alone, is P011. A `~`/`≈` line without a valid separator is P010. A value `?` is only recognised as the whole text after `=`.
- Alternatives: P009 for a path alone.
- Should the spec pin this? no, the examples pin it.

## C-10: Non-string code in `expect error = <value>`
- Spec reference: REQ-CK-005
- Situation: missing
- What I chose: a non-string value (`expect error = 5`) is not a declared code: T023.
- Alternatives: ignore it.
- Should the spec pin this? no.

## C-11: Table row `error` cells
- Spec reference: REQ-SY-012, REQ-CK-005
- Situation: missing
- What I chose: a cell under an `error` column is an expectation with path `error`, so it makes the row an error-expecting example and gets T023 when its code is not declared.
- Alternatives: no T023 for tables.
- Should the spec pin this? yes.

## C-12: `?` in a column with a tolerance
- Spec reference: REQ-SY-012, REQ-SU-004
- Situation: ambiguous
- What I chose: `?` there is an oracle value, `kind: "eq"`, `from: "oracle"` (no approx), as REQ-SU-004 says for every `?` cell.
- Alternatives: an approx check against the oracle value.
- Should the spec pin this? yes.

## C-13: Header cell name rules
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a cell's name runs up to white space, `±` or `+-`; what follows must be empty or start with `±`/`+-`, else P013. `result`, `audit`, `error`, `id` alone or followed by `.` and anything are expectation paths; any other ASCII word is an input field. An empty cell is P013.
- Alternatives: stricter path syntax.
- Should the spec pin this? no.

## C-14: Rows indented more than 4, and `|` alone
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a row is any line starting with `|` indented 4 or more. A line that is only `|` is a separator (Example 4 requires it).
- Alternatives: rows must be exactly 4.
- Should the spec pin this? no.

## C-15: `input` text and comments / blank lines
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: the text is the consecutive blank lines and lines indented 6+ after the `input` line (a `#` line indented 6+ is text); trailing blanks dropped; text consisting of blanks only is "no text" (P049). A path with bad syntax consumes its text silently. An `input ... from` line never takes text.
- Alternatives: report P006 for text after a bad path.
- Should the spec pin this? yes.

## C-16: `from` file resolution
- Spec reference: REQ-SY-011
- Situation: missing
- What I chose: the name is split on `/`; empty and `.` parts are skipped, `..` pops (going above the root is P048); a name starting with `/`, or empty, is P048; a result outside the record's folder or not among the request files is P048. Backslashes are ordinary characters. The file's text is used as given (no BOM stripping).
- Alternatives: reject `//`.
- Should the spec pin this? yes.

## C-17: A dropped example's `input` lines
- Spec reference: REQ-SY-010, REQ-SY-011
- Situation: missing
- What I chose: they are read against an empty scratch object, so only syntax (P049) and file (P048) problems are reported; "path through a non-object" can only arise from earlier `input` lines.
- Alternatives: skip the path-through check.
- Should the spec pin this? no.

## C-18: Raw example `input ... from` and text
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: in a raw example an `input` line gets P022; the text lines after a non-`from` one are skipped; after a `from` one they are P006 like anywhere else.
- Alternatives: skip text after both.
- Should the spec pin this? no.

## C-19: Raw example forms
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: `'...'` form requires the text to start and end with `'` and be at least 2 characters; `"..."` form needs the whole rest to be one JSON string. A raw line is not checked to be JSON.
- Alternatives: accept text after the closing quote.
- Should the spec pin this? no.

## C-20: Time limit of the oracle
- Spec reference: REQ-OR-004
- Situation: missing
- What I chose: each oracle run is killed after 20 seconds and counts as stopped (T020); output already written is used.
- Alternatives: other limits.
- Should the spec pin this? no (OPEN-RQ-001 covers time).

## C-21: Oracle files and working folder
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: the request's files are written to a fresh temporary folder (bytes as UTF-8) and the oracle starts in the sub-folder of the file with the `oracle` statement. Files that cannot be stored are skipped.
- Alternatives: none really; the oracle needs real files.
- Should the spec pin this? yes, it is how the oracle finds its source.

## C-22: What counts as "a line" in a solo run's output
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: non-blank lines (white space only is blank) after splitting on LF. Exactly one is needed; it must be a JSON object (an `id` is not required for a solo run).
- Alternatives: count blank lines too.
- Should the spec pin this? no.

## C-23: Response lines in a batch run
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: a trailing CR on an output line is tolerated (JSON white space); a response needs a string `id`; the first per `id` wins.
- Alternatives: none.
- Should the spec pin this? no.

## C-24: `oracle_error` present with any value
- Spec reference: REQ-OR-006
- Situation: ambiguous
- What I chose: the member being present (any value) is enough.
- Alternatives: only a string.
- Should the spec pin this? no.

## C-25: Which `audit` the `full` answer uses for raw examples
- Spec reference: REQ-SU-005
- Situation: missing
- What I chose: for a raw example the operation is taken from the `op` member of its line when that parses as a JSON object; its tolerances and audit declaration apply. Examples of an undeclared op get `tolerances: {}`.
- Alternatives: raw examples never have an operation.
- Should the spec pin this? yes.

## C-26: Raw example and `omit`ted `op`
- Spec reference: REQ-SU-003
- Situation: missing
- What I chose: `omit op` leaves `op` out of the line and the example is not solo (only a missing `id` makes a case solo). The case still has an operation (the example's own) for T009 etc.
- Alternatives: none.
- Should the spec pin this? no.

## C-27: Number output
- Spec reference: REQ-SU-003, REQ-SU-004
- Situation: missing
- What I chose: every JSON number is held as binary64 and written the way ECMAScript writes it (`1e+21`, `1e-7`), so values that the reference would have rounded are rounded alike.
- Alternatives: keep Python integers exact.
- Should the spec pin this? no, REQ-OR-003 already says binary64.

## C-28: Statements that are not core in blank-ish positions
- Spec reference: REQ-SY-001
- Situation: ambiguous
- What I chose: a P001 line (tab or other white space in the indent) is reported even inside the body of an unknown statement; a blank line is detected before indentation, so a line of tabs only is blank.
- Alternatives: skip P001 in ignored bodies.
- Should the spec pin this? no.

## C-29: Blank request lines in the driver
- Spec reference: Driver protocol
- Situation: ambiguous
- What I chose: a line is blank only if it is empty or holds only spaces and tabs, as stated. A line holding only CR is therefore a `bad_request`. The input is decoded as UTF-8 with bad bytes replaced; a missing final LF is fine.
- Alternatives: treat any white space line as blank (the spec leaves it open).
- Should the spec pin this? no, it is open.

## C-30: `internal_error`
- Spec reference: OPEN-RQ-004
- Situation: missing
- What I chose: like the reference, `{"id": <id>, "error": "internal_error"}` plus details on standard error.
- Alternatives: none.
- Should the spec pin this? no.

## C-31: T004 for texts with P-free but unusual quoting
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: per line, quotations are removed left to right with the first opening mark winning (`"…"`, `“…”`, `` `…` ``), then the whole-word test runs; an unmatched mark removes nothing. A rejected alternative is checked as its decoded text. The text of a second `spec` is not checked.
- Alternatives: nested quotation handling.
- Should the spec pin this? no.

## C-32: Which `errors` statement declares codes
- Spec reference: REQ-RC-004, REQ-CK-005, REQ-CK-008
- Situation: ambiguous
- What I chose: only the first `errors` statement's codes and conditions count (a second one is P032 anyway, so this only matters for reading).
- Alternatives: union.
- Should the spec pin this? no.

## C-33: Examples of open items and counting
- Spec reference: REQ-CK-007, REQ-OR-001
- Situation: ambiguous
- What I chose: an open item's `example`/`table` clauses are never read, so they are not examples for T019, ids or the suite.
- Alternatives: none.
- Should the spec pin this? no.

## C-34: Case of T007 across statement kinds and the ops map
- Spec reference: REQ-CK-002, REQ-CK-004
- Situation: ambiguous
- What I chose: every use of an ID after the first (not only the second) gets T007. The first declaration of an op name is the one examples are checked against.
- Alternatives: second only.
- Should the spec pin this? no ("a second use").

## C-35: A file entry that is also a folder prefix
- Spec reference: REQ-RQ-001
- Situation: missing
- What I chose: a name in `files` is always a file (request validation forbids a name being a folder of another).
- Alternatives: none.
- Should the spec pin this? no.
