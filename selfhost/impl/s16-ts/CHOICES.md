# CHOICES

Choices made where SPEC.md is silent, ambiguous or contradictory. Entries C-1 to C-20 also
have a test with the same number in `test/choices.test.ts`. Later entries are recorded here
only.

## C-1: A missing entry and `"."`
- Spec reference: REQ-RQ-001
- Situation: missing
- What I chose: When `entry` is missing or is `"."`, the record is the folder that holds all the files. Diagnostics about the record as a whole go at `.`. Any other entry that names a file is a file record, and anything else is a folder record.
- Alternatives: Look for a file named `.` first. That cannot happen, because `.` is never a valid file name.
- Should the spec pin this? no. The spec already says it; the test only confirms it.

## C-2: Statements of the rest of the language
- Spec reference: OPEN-RC-001, REQ-SY-002
- Situation: missing
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` are read as statements with no diagnostic. Their bodies are ignored, the same way an unknown statement's body is, but without P002.
- Alternatives: Check their clauses in some way, or report P015 for every clause.
- Should the spec pin this? no. It is deliberately open.

## C-3: P001 inside ignored bodies
- Spec reference: REQ-SY-001, REQ-SY-002, REQ-SY-003
- Situation: ambiguous
- What I chose: P001 is found while splitting lines, before any statement structure exists. So a tab-indented line still gets P001 when it sits in the body of an unknown statement (P002) or under an ignored clause (P015, P052). P003, P006 and P007 are not reported inside the body of an unknown statement.
- Alternatives: Ignore every problem inside an ignored body, P001 included.
- Should the spec pin this? yes. "The lines of its body MUST be ignored" could be read either way.

## C-4: An indented comment before the first statement
- Spec reference: REQ-SY-002
- Situation: ambiguous
- What I chose: Any non-blank indented line before a file's first statement gets P003, including a line starting with `#` at indent 2 (the spec's example only shows indent 1). An unknown statement (P002) counts as a statement here.
- Alternatives: Treat `  # ...` as a comment there.
- Should the spec pin this? unsure. It is a corner case, but builds could easily differ on it.

## C-5: Several bad cells in one table row
- Spec reference: REQ-SY-012
- Situation: missing
- What I chose: Each cell that is not JSON (P009), or not a number in a column with a tolerance (P010), gets its own diagnostic at the row's line. A row with the wrong number of cells gets P014 and its cells are not checked.
- Alternatives: At most one diagnostic per row.
- Should the spec pin this? yes. The diagnostic lists would differ.

## C-6: Where an `input ... from` name ends up
- Spec reference: REQ-SY-011, D-012
- Situation: ambiguous
- What I chose: The name is resolved first: empty parts and `.` are skipped, and `..` pops one folder. Only the resulting path is judged. `../r/t.txt` from inside record `r` is accepted. A `..` above the folder that holds all the files gets P048. A file counts as "inside the folder of the record" when it is any request file below that folder, including files that are not `.duramen` and files in hidden or `build` folders.
- Alternatives: Give P048 to any name that goes above the record's folder at any step. Or allow only files that belong to the record itself.
- Should the spec pin this? yes. "a name that leaves the record's folder" can be read as describing the path or the result.

## C-7: Case IDs when two requirements share an ID
- Spec reference: REQ-SU-002, REQ-CK-002, REQ-OR-002
- Situation: ambiguous
- What I chose: Examples are counted within each `req` statement, so two `req A` statements both have an `A#1`. Both are sent in one batch, and both are matched to the first response with that id. (The record has T007, so no suite comes of it anyway.)
- Alternatives: Keep counting across all statements with one ID.
- Should the spec pin this? unsure. It only changes which response the second example gets.

## C-8: Two responses with one id
- Spec reference: REQ-OR-002
- Situation: missing (the rule is stated; how lines that do not count are skipped is not)
- What I chose: Responses are read in order. Lines that do not count (not JSON, not an object, no string id, a number too large to be finite) are skipped. Of the rest, the first line for each id is used.
- Alternatives: none worth considering.
- Should the spec pin this? no.

## C-9: How long the oracle may run
- Spec reference: REQ-OR-004, OPEN-RQ-001
- Situation: missing
- What I chose: Each run of the oracle (the batch, and each solo example) may take 60 seconds. After that it is killed with SIGKILL and gets T020; any responses it wrote are still used. The environment variable `DURAMEN_ORACLE_TIMEOUT_MS` can change the limit (the tests use it). If a process started by the oracle keeps the pipe open, the checker stops waiting one second after the kill.
- Alternatives: No limit, or a limit per example.
- Should the spec pin this? no. Running time is open.

## C-10: How the oracle is started
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: All of the request's files, not only the record's, are written to a fresh temporary folder and deleted afterwards. The oracle runs in the copy of the folder of the file that holds the `oracle` statement. Names the file system cannot hold are skipped (OPEN-RQ-003). The batch run and the solo runs happen concurrently. The oracle's standard error is ignored, and its standard output is decoded as UTF-8.
- Alternatives: Write only the record's files; run the solo examples one after another.
- Should the spec pin this? no.

## C-11: Judge checks of unknown kinds
- Spec reference: REQ-JU-001, OPEN-JU-001
- Situation: missing
- What I chose: A check must have a `kind` member, of any value. A check whose kind is not `eq` or `approx` is reported as not met (`checks.<n>`), rather than being refused as a bad request.
- Alternatives: Count it as met, or answer `bad_request`.
- Should the spec pin this? no. It is open.

## C-12: The order of request members
- Spec reference: REQ-SU-003, D-014
- Situation: ambiguous
- What I chose: ECMAScript's order is reproduced explicitly. Members named by an array index (a canonical integer below 2^32−1) come first, in increasing order; the rest follow in the order first set. A member that is set again keeps its place. These members always come after `"id"` and `"op"`. Nested values use `JSON.stringify` ordering.
- Alternatives: none.
- Should the spec pin this? no. It already does.

## C-13: Members named `__proto__`
- Spec reference: REQ-SY-011, REQ-SU-003
- Situation: missing
- What I chose: Input paths, table columns and tolerances store every member as an own data property. A member named `__proto__` is therefore written like any other member and never changes an object's prototype.
- Alternatives: none sensible.
- Should the spec pin this? no.

## C-14: Which operation an example belongs to
- Spec reference: REQ-CK-002, REQ-SU-003, REQ-SU-005
- Situation: ambiguous
- What I chose: The first `op` of a name in record order supplies an example's fields, its `request` members, its tolerances and whether it has an audit. If that op has a `request` clause, its members replace the spec's.
- Alternatives: none.
- Should the spec pin this? no.

## C-15: Letter case in the phrases of T005
- Spec reference: REQ-CK-008
- Situation: ambiguous
- What I chose: "In any letter case" is read as ASCII case only. The text is lowercased for A–Z only before matching, so look-alikes such as the `ﬁ` ligature or the Kelvin sign do not match. Codes count once each, however often they are named.
- Alternatives: Unicode case folding.
- Should the spec pin this? unsure.

## C-16: A solo run that writes nothing
- Spec reference: REQ-OR-002, REQ-OR-005
- Situation: missing (it follows from the words)
- What I chose: When a solo run writes no non-blank line, the example has no response and gets T021.
- Alternatives: none.
- Should the spec pin this? no.

## C-17: Which request lines are blank
- Spec reference: Interface (Driver protocol)
- Situation: ambiguous (explicitly open)
- What I chose: Standard input is split at LF only. A line is blank when it holds only spaces and tabs, optionally followed by one CR (so CR LF input works). A line made of other white space, such as U+00A0, is not blank and gets `bad_request`. U+2028 and U+2029 never end a line.
- Alternatives: Treat every line of `\s` only as blank.
- Should the spec pin this? no. The spec leaves it open on purpose.

## C-18: `superseded by` a decision itself
- Spec reference: REQ-CK-009
- Situation: missing
- What I chose: `superseded by <ID>` only needs `<ID>` to be declared, which includes the decision itself. The status must match `superseded by <one word>` with single spaces.
- Alternatives: Refuse self-reference.
- Should the spec pin this? no.

## C-19: Table rows as inputs
- Spec reference: REQ-SU-003
- Situation: missing (it follows from the words)
- What I chose: A row's input is `{` followed by `"<field>":<cell>` for each non-empty input cell, using the cell's text as written (after `\|` is unescaped and white space around it is trimmed), then `}`. The field name is written with `JSON.stringify`.
- Alternatives: none.
- Should the spec pin this? no.

## C-20: `full.audit` that is not a text
- Spec reference: REQ-SU-005, REQ-JU-001
- Situation: contradictory (in a corner)
- What I chose: `full.audit` is included only when the operation declares an audit and the response's `audit` is a string. If the oracle answers with a non-string `audit`, the case would otherwise fail REQ-JU-001's form, which requires `audit` to be a string.
- Alternatives: Copy whatever value the response holds.
- Should the spec pin this? yes. One sentence would settle it.

## C-21: Versions 0.1 and 0.2
- Spec reference: REQ-RC-003, OPEN-RC-001
- Situation: missing
- What I chose: A file in `duramen 0.2` is read and checked exactly like one in `0.1`. The extra checks of 0.2 are open.
- Alternatives: none within the core.
- Should the spec pin this? no.

## C-22: Where the `duramen` statement may stand
- Spec reference: OPEN-RC-002
- Situation: missing
- What I chose: Anywhere in the file. The first `duramen` statement in a file states that file's version.
- Alternatives: Require it to come first.
- Should the spec pin this? no. It is open.

## C-23: The version text
- Spec reference: REQ-RC-003
- Situation: ambiguous
- What I chose: "Everything after the keyword" means the rest of the line after the white space that follows `duramen`, with white space at the end of the line already removed. So `duramen   0.1` states `0.1`.
- Alternatives: Count the first separating space only, so that extra spaces would make the version invalid.
- Should the spec pin this? unsure.

## C-24: Comments below a clause
- Spec reference: REQ-SY-003, REQ-SY-008, REQ-SY-010, REQ-SY-012
- Situation: ambiguous
- What I chose: Under a clause that takes no lines, and under an example or a table, a line indented three or more that starts with `#` is a comment. Inside a `text`, an `errors` condition, or the text of an `input <path>`, such a line is content. Under `errors`, a line indented exactly three gets P006 even when it starts with `#`. Under `text`, a line indented exactly three gets P008 even when it starts with `#`.
- Alternatives: Accept indent-3 `#` lines as comments in those places too.
- Should the spec pin this? unsure.

## C-25: The single-quoted raw form
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: `example raw '<line>'` requires the rest of the line to start and end with `'` and to be at least two characters long. The line is everything between the first and the last `'`. Anything else gets P004.
- Alternatives: Allow text after the last `'`.
- Should the spec pin this? no.

## C-26: Recognising `input <path> from "<file>"`
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: An input line is in the `from` form when it ends with white space, `from`, white space, and a double-quoted string that is valid JSON. Otherwise the whole rest is the path. So `from "unclosed` and `from "\q"` are not the `from` form, and their paths get P049.
- Alternatives: Decide the form by the word `from` alone.
- Should the spec pin this? no. The spec's examples already imply it.

## C-27: Order of the checks on an input line
- Spec reference: REQ-SY-011
- Situation: missing (it follows from the words)
- What I chose: The checks are made in the stated order before the input is changed: path form (P049), then the `from` file (P048), then reachability through objects (P049), then whether there is any text (P049). A line with a problem does not change the input.
- Alternatives: none.
- Should the spec pin this? no.

## C-28: Which examples expect an error
- Spec reference: REQ-CK-004, REQ-CK-005
- Situation: ambiguous
- What I chose: `expect error = ?` and `expect error ≈ ...` both count as expectations whose path is `error`, so they are not checked against the operation. A table row with a non-empty cell (including `?`) in an `error` column also counts.
- Alternatives: Count only expectations that state a value.
- Should the spec pin this? yes. "an expectation whose path is `error` itself" does not say whether `?` counts.

## C-29: Duplicate decisions: T013 and T027
- Spec reference: REQ-CK-009
- Situation: ambiguous
- What I chose: When an ID is declared twice, each declaration gets its own T013 (no source) and its own T027 (bad status), judged by its own clauses. T028 uses the first declaration's status, as the spec says.
- Alternatives: Judge only the first declaration.
- Should the spec pin this? unsure.

## C-30: What T004 reads
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: For a rejected alternative, the decoded JSON string is checked, not the raw `"..."` text; otherwise every alternative would be one big quotation. For an errors clause, only the condition is checked (the text after `when`, plus its continuation lines), not the code. Quotations are found left to right on each line: an opening `"`, `“` or `` ` `` closes at the next `"`, `”` or `` ` `` on the same line, and a quote with no closer is an ordinary character.
- Alternatives: Check the raw alternative text.
- Should the spec pin this? yes. Reading the alternative raw would exempt every alternative.

## C-31: Judge input forms
- Spec reference: REQ-JU-001
- Situation: missing
- What I chose: `case.full.tolerances` must be an object that is not an array. `kind` may hold any value, and other members of a case or check are ignored. When `answer` is `null`, the only failed part is `"answer"`.
- Alternatives: none.
- Should the spec pin this? no.

## C-32: Failures of the checker itself
- Spec reference: OPEN-RQ-004
- Situation: missing
- What I chose: Like the reference: `{"id": <id>, "error": "internal_error"}`, with the stack written to standard error. The driver goes on to the next line.
- Alternatives: none.
- Should the spec pin this? no.

## C-33: Requests are answered one at a time
- Spec reference: Interface (Driver protocol)
- Situation: missing
- What I chose: The driver handles requests one after another, so responses come out in request order without reordering. A `check` that runs an oracle holds up the requests behind it.
- Alternatives: Handle requests concurrently and reorder the output.
- Should the spec pin this? no.

## C-34: `-0` in tolerances
- Spec reference: REQ-SY-007, REQ-SU-005
- Situation: missing
- What I chose: A tolerance written `-0`, in an op, an `expect ≈` line or a header, is stored as `0`, so the suite writes `0`.
- Alternatives: Keep `-0`. `JSON.stringify` writes `0` anyway, so the output is the same.
- Should the spec pin this? no.

## C-35: The spec's `request` members
- Spec reference: REQ-SY-004, REQ-RC-004
- Situation: missing
- What I chose: Only the first `spec` statement's `request` clause is used. A second `spec` gets P044, so no suite comes from that record anyway.
- Alternatives: none.
- Should the spec pin this? no.
