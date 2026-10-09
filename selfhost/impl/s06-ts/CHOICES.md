# Choices

## C-1: Lines that are only "\r" in the driver stream
- Spec reference: Driver protocol
- Situation: ambiguous
- What I chose: Only empty lines and lines of spaces and tabs are blank; a line with other white space (CR, U+00A0) is a request line and gets `bad_request` if it is not JSON. Lines are split on LF only.
- Alternatives: Treat any `\s`-only line as blank.
- Should the spec pin this? no, it is stated as open.

## C-2: Rest-of-language statements
- Spec reference: REQ-SY-002, OPEN-RC-001
- Situation: missing
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` statements are accepted silently and their bodies ignored (no P002, no other diagnostic).
- Alternatives: Report them as unsupported.
- Should the spec pin this? no, open item.

## C-3: Comments inside a body
- Spec reference: REQ-SY-003, REQ-SY-005
- Situation: ambiguous
- What I chose: A comment line (indent 0, or indent 2 starting with `#`) inside a clause body is skipped entirely; it does not end a `text` block and does not count as a blank line.
- Alternatives: A comment ends the clause's text.
- Should the spec pin this? unsure; a `text` interrupted by an indent-2 comment is rare.

## C-4: Repeated once-only clauses whose first copy was malformed
- Spec reference: REQ-SY-003, REQ-SY-004
- Situation: ambiguous
- What I chose: For `spec`, `op`, `req`, `decision` clauses, a second clause of a once-only kind gets P052 even when the first one got P004/P009/P051 (the first one "was seen"). Only example `request` lines follow the "one that was read" rule the spec states.
- Alternatives: Count only well-formed first clauses.
- Should the spec pin this? yes, the two rules differ.

## C-5: Empty title / `contract` / `decision` / `source` clauses
- Spec reference: REQ-SY-004, REQ-SY-009
- Situation: missing
- What I chose: `title` with nothing is P004 (not a JSON string). `contract` with nothing, a req `decision` clause with no IDs, and `source`/`status` with nothing raise no read error (`source` empty counts as none for T013, empty `status` is T027).
- Alternatives: P050 or P015 style errors for empty clauses.
- Should the spec pin this? yes.

## C-6: Several diagnostics for one `input` clause
- Spec reference: REQ-SY-007
- Situation: ambiguous
- What I chose: One P017 per malformed field (the spec's example shows two on one line). A field that is malformed is not registered, so it cannot cause P052 later.
- Alternatives: Register names even from malformed fields.
- Should the spec pin this? no.

## C-7: Tolerance path form
- Spec reference: REQ-SY-007
- Situation: missing
- What I chose: The path is the first word, any non-blank text; only the number is validated (JSON number, value >= 0; `-0` accepted).
- Alternatives: Require the path to start with `result` or be a dotted name.
- Should the spec pin this? yes.

## C-8: Possible P013 count in a header
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: At most one P013 per header: the first bad cell (wrong form, or repeated name) stops the header. P010 (tolerance) problems found before it are still reported. Header P013 is at the header row's line; table-level P013 at the `table` line.
- Alternatives: One P013 per bad cell.
- Should the spec pin this? yes.

## C-9: Separator rows
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: Separator = text starting and ending with `|` made only of `|`, `-`, `:` and spaces (no dash needed), so `|   |` and `|` are separators (needed by example 4). A lone `|` counts as one.
- Alternatives: Require at least one dash.
- Should the spec pin this? no, an example already shows it.

## C-10: `?` in an input column of a table, and cell escapes
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: `?` is special only in expectation columns; in an input column it is "not JSON" (P009). Only `\|` is unescaped in a cell; other backslashes stay.
- Alternatives: Treat `?` in an input column as a hole.
- Should the spec pin this? no.

## C-11: Lines that keep an input text block
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: The block after any `input` line (also one with P049, P022 or `from`) is consumed: blank lines and lines indented six or more. After a `from` line, a non-comment such line gets P006. For a raw example, `input` gives P022 and no P048 even with `from`.
- Alternatives: Report P048 for raw examples too.
- Should the spec pin this? yes (raw plus `from`).

## C-12: `from` path resolution
- Spec reference: REQ-SY-011, REQ-RC-001
- Situation: ambiguous
- What I chose: The `from` string is split on `/`, empty and `.` parts skipped, `..` pops; an empty or absolute string, or any result outside the record's folder, is P048. Backslashes are ordinary characters. A malformed path with a readable `from` gets P049 and also P048 if the file is missing.
- Alternatives: Reject empty segments.
- Should the spec pin this? unsure.

## C-13: `input` through non-objects
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: Arrays count as "not an object" for a path through them (P049). Setting the last name over any existing value is allowed and keeps its place. The check is skipped for an example that was dropped.
- Alternatives: Allow indexes into arrays.
- Should the spec pin this? no.

## C-14: `expect` line forms
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: After the path, `=` gives eq/oracle; `≈`/`~` gives approx (P010 on failure); anything else, including nothing, is P011. The approximate form is `<number> (±|+-) <number>` with optional spaces; `1+-0.5` is accepted.
- Alternatives: P009 for `expect result` without `=`.
- Should the spec pin this? no; examples show P011.

## C-15: Raw examples
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: `example raw` with `'..'` needs length >= 2 and both quotes; the content is taken as is, even if empty. A raw example dropped for P004/P026 still reads its lines as a raw example (P022 for request/omit/input). The raw line need not be JSON.
- Alternatives: Validate JSON of the raw line.
- Should the spec pin this? no.

## C-16: Oracle timeout and response matching
- Spec reference: REQ-OR-002, REQ-OR-004
- Situation: missing
- What I chose: 20 seconds per oracle run. For a solo run the one non-blank line must be a JSON object, else no response. Stderr is discarded. An EPIPE on writing to the oracle is not a failure by itself.
- Alternatives: Other timeouts.
- Should the spec pin this? no (spec leaves "too long" open).

## C-17: Which examples are run and judged
- Spec reference: REQ-OR-002, REQ-CK-004
- Situation: ambiguous
- What I chose: A case is run if it is raw, or has an expectation whose path is exactly `error`, or names a declared operation. For a table row, "expects an error" means the row has a non-empty cell under an `error` column. T024 applies when the case has no expectation at all.
- Alternatives: Judge the column rather than the row.
- Should the spec pin this? yes (rows with an empty `error` cell).

## C-18: Edge cases in T-checks
- Spec reference: REQ-CK-005, REQ-CK-008, REQ-CK-009
- Situation: ambiguous
- What I chose: T023 also fires when the expected error value is not a string. Phrase words in T005 are whole when no ASCII letter, digit or `_` touches them (code words also exclude `-`). `superseded by <ID>` must have a single space between words. Status words are case-sensitive. The first declaration of a duplicated decision ID is the one judged.
- Alternatives: Lenient white space in `superseded by`.
- Should the spec pin this? no.

## C-19: Quotation handling in T004
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: Quoted spans are removed line by line with the leftmost matches of `"…"`, `“…”` and `` `…` ``; an opening quote without a closing one on its line quotes nothing. A rejected alternative is judged as its decoded string split on newlines.
- Alternatives: Pair quotes across lines.
- Should the spec pin this? no.

## C-20: Large or inexact numbers in `checks`
- Spec reference: REQ-SU-004
- Situation: missing
- What I chose: Expected values are parsed to JavaScript numbers and written back by `JSON.stringify`, so integers beyond 2^53 lose precision in `checks` and `full`.
- Alternatives: Keep the number's source text.
- Should the spec pin this? unsure.

## C-21: Temporary files for the oracle
- Spec reference: REQ-OR-002, OPEN-RQ-003
- Situation: missing
- What I chose: All request files are written to a fresh temporary directory per request (when an oracle is needed) and the oracle runs there; files with names the system cannot store are skipped.
- Alternatives: Only write the record's files.
- Should the spec pin this? no.

## C-22: Failure of the checker itself
- Spec reference: OPEN-RQ-004
- Situation: missing
- What I chose: An uncaught exception while handling a request gives `{"id":..., "error":"internal_error"}` and the stack goes to standard error, as the reference does.
- Alternatives: none.
- Should the spec pin this? no, it is open.

## C-23: Text of the `result` clause and conditions for T004
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: The text judged for `op ... result` is the rest of the clause line; for an `errors` condition it is the text after `when` plus the continuation lines (their indentation removed), each judged line by line.
- Alternatives: Include the code word.
- Should the spec pin this? no.
