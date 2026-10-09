# Choices

Places where SPEC.md was silent, ambiguous or contradictory, and what this build does there.

## C-1: How request lines are split
- Spec reference: Interface, Driver protocol
- Situation: missing
- What I chose: Standard input is split at LF only. A CR just before the LF is removed, and a last line with no LF is still handled.
- Alternatives: Split at CR as well (as readline does), or keep the CR (JSON.parse accepts it as white space anyway).
- Should the spec pin this? unsure. A judge sends LF lines, so it only matters for hand-written input.

## C-2: Which lines count as blank
- Spec reference: Interface, Driver protocol ("whether other white space makes a line blank is open")
- Situation: ambiguous
- What I chose: Only empty lines and lines of spaces and tabs (after the CR of C-1 is removed) get no response. A line of other white space, such as U+000B, gets `bad_request` with `"id": null`.
- Alternatives: Treat any `\s` line as blank.
- Should the spec pin this? no. The spec leaves it open on purpose.

## C-3: Where the `duramen` statement may stand
- Spec reference: OPEN-RC-002, REQ-RC-003, REQ-RC-006 Example 1
- Situation: ambiguous
- What I chose: A `duramen` statement anywhere in a file states the file's version. The first one is judged and any later one gets P023. P020 means the file has none at all. (REQ-RC-006 Example 1 has `duramen 0.1` on line 2 and expects no P020.)
- Alternatives: Require it to come first, giving P020 or another code otherwise.
- Should the spec pin this? no. It is open, and the example already constrains it.

## C-4: "Starting with a letter and a colon"
- Spec reference: REQ-RQ-001
- Situation: ambiguous
- What I chose: An ASCII letter `A`–`Z`/`a`–`z` followed by `:` at the start of the whole name.
- Alternatives: Any Unicode letter, or a drive pattern in any part of the path.
- Should the spec pin this? yes. It is cheap to state, and builds could differ on `é:x`.

## C-5: The rest of the language
- Spec reference: OPEN-RC-001, REQ-SY-002
- Situation: missing
- What I chose: The statements `type`, `edge`, `edgedef`, `property` and `evidence` get no P002, and their whole body is ignored without diagnostics. The clauses `returns` (of `op`) and `static` (of `req`) are accepted and ignored, lines under them included. A `static` clause does not stand in for an example (T001 still applies).
- Alternatives: Give P015 to `returns`/`static`, or read some structure (P006/P007) in rest-of-language bodies.
- Should the spec pin this? no. It is open by design.

## C-6: Comments at indent 0 inside a body
- Spec reference: REQ-SY-002, REQ-SY-005, REQ-SY-011
- Situation: missing
- What I chose: A line at indent 0 that starts with `#` is invisible. It does not end the current statement's body, a `text` block or an `input` text, and it is not part of any text.
- Alternatives: Let it end the input text ("the first line that is neither blank nor indented six spaces"), or make it end the statement.
- Should the spec pin this? yes. Under an `input` text, the words "the first line that is neither blank nor indented six" would make it end the text, and a build could reasonably follow that.

## C-7: `#` lines indented three under `text` and under an `errors` clause
- Spec reference: REQ-SY-005, REQ-SY-008
- Situation: ambiguous
- What I chose: Under `text`, a line indented three gets P008 even when it starts with `#`. Under a clause of `errors`, a line indented three gets P006 even when it starts with `#`.
- Alternatives: Treat a `#` line indented three as a comment there.
- Should the spec pin this? yes. SY-003 says "even when it starts with #" for P006/P007 elsewhere, but says nothing for these two.

## C-8: A statement with no ID
- Spec reference: REQ-SY-006
- Situation: missing
- What I chose: `req`, `open`, `decision` or `section` with nothing after the keyword gets P005 (no title), once.
- Alternatives: A separate code, or P004.
- Should the spec pin this? unsure. P005 is the natural reading.

## C-9: Comments under examples and tables
- Spec reference: REQ-SY-010, REQ-SY-012
- Situation: ambiguous
- What I chose: Under an example (outside an input text) and under a table, any non-blank line that starts with `#` is a comment, at any indent of three or more.
- Alternatives: Only lines indented exactly four count as comments.
- Should the spec pin this? yes. "Neither blank nor a comment" does not say at which indent.

## C-10: Lines after a `from` input line, and the input lines of a raw example
- Spec reference: REQ-SY-010, REQ-SY-011
- Situation: ambiguous
- What I chose: After `input <path> from "<file>"`, each following line indented six or more gets P006, `#` lines too. Under a raw example, every `input` line gets P022, and the blank and six-or-more lines after it are skipped silently for both forms.
- Alternatives: Let `#` lines after a `from` line be comments, or report the lines after a raw `from` input.
- Should the spec pin this? no. These are corner cases with an obvious intent.

## C-11: A second `tolerance` for a path
- Spec reference: REQ-SY-003, REQ-SY-007 Examples 5 and 7
- Situation: contradictory
- What I chose: A tolerance counts as "the one for its path" only when it was valid. A later tolerance for a path that already has a valid one gets P052 and nothing else. Tolerances that got P018 do not count. SY-007 Example 5 has four P018 lines for `result.x` and then a valid one with no P052, which contradicts SY-003's "also when the first one got a problem of its own".
- Alternatives: Check P018 before P052 for every line.
- Should the spec pin this? yes. The general rule and the example disagree.

## C-12: An `input` line with several problems
- Spec reference: REQ-SY-011
- Situation: missing
- What I chose: At most one P049 per `input` line (bad path, a path through a value that is not an object, or no text). A `from` file that cannot be read gets P048 independently, so a line can have both.
- Alternatives: Stop at the first problem.
- Should the spec pin this? unsure.

## C-13: Input lines under an example with no input object
- Spec reference: REQ-SY-011, REQ-SU-003
- Situation: missing
- What I chose: Under `example <op>` with no JSON, or under a dropped example, input lines start from an empty object. `example f` with input lines then sends `"input":{...}`.
- Alternatives: Give P049 when there is no object to put the text in.
- Should the spec pin this? yes. "An example written `example <op>` has no input" conflicts with input lines that add one.

## C-14: A non-object JSON value holding a number too large
- Spec reference: REQ-SY-010, REQ-SY-013
- Situation: ambiguous
- What I chose: `example f [1e400]` gets P009 (too large counts as not JSON), not P012.
- Alternatives: P012, since it is not an object either.
- Should the spec pin this? no.

## C-15: Splitting the fields of `input`
- Spec reference: REQ-SY-007
- Situation: missing
- What I chose: Inside double quotes, a backslash escapes the next character. A closing bracket with no opening one is ignored (the depth stays 0). Single quotes protect nothing, as the `e 'x, y'` example needs.
- Alternatives: No escapes in quotes.
- Should the spec pin this? no.

## C-16: T023 for tables, and for values that are not strings
- Spec reference: REQ-CK-005
- Situation: missing
- What I chose: A cell in an `error` column of a table is an `expect error = <cell>` and gets T023 at the row's line when it names an undeclared code. A value that is not a string (`expect error = 5`) is not a declared code either, so it gets T023. `?` and `≈` expectations of `error` get no T023.
- Alternatives: Check only `expect` lines, or only string values.
- Should the spec pin this? yes.

## C-17: What "expects an error" means
- Spec reference: REQ-CK-004
- Situation: ambiguous
- What I chose: An example expects an error when any of its expectations has the path `error` exactly, whatever its kind (`= value`, `= ?` or `≈`). For a table row, that means a non-empty cell in an `error` column.
- Alternatives: Only `= <value>` expectations.
- Should the spec pin this? unsure.

## C-18: Header cells of tables
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: An expectation path in a header is `result`, `audit`, `error` or `id`, optionally followed by `.` and text with no white space. These names win over field names, so a column `id` is the response's `id` and not an input field. The tolerance starts at the first `±` or `+-` in the cell.
- Alternatives: Let paths hold spaces, or read `id` as an input field when the operation declares one.
- Should the spec pin this? yes, for `id`/`result` columns that are also field names.

## C-19: Spaces around cells
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: Cells are trimmed of all white space (ECMAScript `trim`), not only spaces.
- Alternatives: Trim spaces only.
- Should the spec pin this? no. Trailing white space of the line is removed anyway.

## C-20: The response of an example sent alone
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: The run's non-blank output lines are counted. With exactly one, it is the response when it is a JSON object holding no number too large to be finite. It does not need an `id`.
- Alternatives: Count blank lines too, or require an `id`.
- Should the spec pin this? yes. "One line" could include blank lines.

## C-21: `oracle_error` and T024
- Spec reference: REQ-OR-006, REQ-OR-007
- Situation: missing
- What I chose: An example answered with `oracle_error` gets T022 only: no expectation checks, no T024 and no T025.
- Alternatives: Still give T024 when the response also holds `error`.
- Should the spec pin this? unsure.

## C-22: Lines the oracle writes
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: The oracle's standard output is split at LF, with a CR before the LF removed. Standard error is ignored.
- Alternatives: Treat CR as part of the line (JSON.parse accepts it anyway).
- Should the spec pin this? no.

## C-23: Running the oracle
- Spec reference: OPEN-RQ-001, REQ-OR-002, REQ-OR-004
- Situation: missing
- What I chose: All files of the request are written to a new temporary folder, which is removed afterwards. The oracle runs in that copy of the folder of the file with the first `oracle` statement. A run that takes more than 120 seconds is killed (and gets T020). At most 8 runs of the oracle go at once (the batch run plus the solo runs), and results are collected in record order.
- Alternatives: Run solo examples one after another, or use another timeout.
- Should the spec pin this? no. Time limits are open.

## C-24: The operation of a raw example
- Spec reference: REQ-SU-005
- Situation: missing
- What I chose: For `full.tolerances` and `full.audit`, a raw example's operation is the string `op` member of its line when the line is a JSON object, and none otherwise.
- Alternatives: A raw example never has an operation (`tolerances` always `{}`).
- Should the spec pin this? yes. The examples never show a raw case of an op with tolerances.

## C-25: Whole words for T005
- Spec reference: REQ-CK-008
- Situation: ambiguous
- What I chose: "Not next to a letter, digit, `_` or `-`" uses ASCII letters and digits, as REQ-CK-006 does. The phrases use the same boundary (no ASCII letter, digit or `_` touching them), are matched case-insensitively, and allow any `\s` run between their words. Codes count once each, however often they are named.
- Alternatives: Unicode letters.
- Should the spec pin this? yes, briefly.

## C-26: Quotations for T004
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: Each line is scanned from the left. At `"`, `“` or a backquote, the text up to the next matching close (`"`, `”` or a backquote) on the same line is a quotation. An opening mark with no close on its line is ordinary text. A rejected alternative is checked as its parsed string value, without its quote marks.
- Alternatives: Nested or overlapping quotations, or two backquotes in a row as the marker.
- Should the spec pin this? unsure. "Two backquotes" can be read as "a pair of backquotes" (my reading) or as "``".

## C-27: Decisions declared twice
- Spec reference: REQ-CK-002, REQ-CK-009
- Situation: missing
- What I chose: The first declaration of an ID decides its status for T028 and for `superseded by` lookups. A citation of the ID counts as citing every declaration of it (none of them gets T012).
- Alternatives: Judge each declaration on its own.
- Should the spec pin this? no. T007 already makes the record fail.

## C-28: The text of a `from` file
- Spec reference: REQ-SY-011
- Situation: missing
- What I chose: The file's text exactly as given in the request: BOM, CR and every other character kept.
- Alternatives: Strip a BOM, or normalize line ends.
- Should the spec pin this? no. SY-011 Example 5 keeps CR LF.

## C-29: Line breaks in a raw line
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: Only CR and LF count as line breaks for P026, not U+2028/U+2029.
- Alternatives: Refuse every Unicode line terminator.
- Should the spec pin this? yes. "A line break, CR or LF" could mean more than those two.

## C-30: Approximate comparisons
- Spec reference: REQ-OR-003
- Situation: missing
- What I chose: `|value - number| <= tolerance`, computed in binary64. So `2` is not within `0.1` of `1.9`, because the difference is 0.10000000000000009.
- Alternatives: Compare with a small epsilon, or in decimal.
- Should the spec pin this? yes. Builds in other languages could do the arithmetic differently.

## C-31: Failures of the checker itself
- Spec reference: OPEN-RQ-004
- Situation: missing
- What I chose: `{"id": <id>, "error": "internal_error"}`, with the stack trace on standard error, as the reference does.
- Alternatives: none considered.
- Should the spec pin this? no.

## C-32: A code listed twice under `errors`
- Spec reference: REQ-SY-008
- Situation: missing
- What I chose: No diagnostic. The code is simply declared.
- Alternatives: P052 or T007.
- Should the spec pin this? unsure. It is another "one of each" case (D-013).

## C-33: An operation with a malformed name
- Spec reference: REQ-SY-007
- Situation: missing
- What I chose: `op` with no name or several words gets P031. Its clauses are read and reported, but it declares no operation.
- Alternatives: Declare it under its first word.
- Should the spec pin this? no. P031 stops the check anyway.

## C-34: An entry that names both a file and a folder
- Spec reference: REQ-RQ-001, REQ-RC-001
- Situation: missing
- What I chose: This cannot happen, because the folder rule of the Errors list refuses such requests. An entry naming a file is a file record, and a name below a file names nothing (P046).
- Alternatives: none.
- Should the spec pin this? no.

## C-35: Versions for P047
- Spec reference: REQ-RC-003
- Situation: ambiguous
- What I chose: Only each file's first `duramen` statement counts, and only when its version is `0.1` or `0.2`. Files whose first version got P023 do not take part.
- Alternatives: Count every valid statement.
- Should the spec pin this? no. "Not judged again" implies it.

## C-36: `audit.<path>` when the audit text is not JSON
- Spec reference: REQ-OR-003
- Situation: missing
- What I chose: The path holds no value, which gives T002 for an expectation and T025 for `?`.
- Alternatives: none considered.
- Should the spec pin this? no.

## C-37: What "answers with an error" means for T024
- Spec reference: REQ-OR-007
- Situation: ambiguous
- What I chose: The response has an `error` member, whatever its value (`null` included).
- Alternatives: Require a non-null or string value.
- Should the spec pin this? unsure.

## C-38: An `on` clause with nothing after it
- Spec reference: REQ-SY-009
- Situation: missing
- What I chose: P033. The empty string is not `any`, `posix` or `windows`.
- Alternatives: Read it as `any`.
- Should the spec pin this? no.

## C-39: Empty raw lines and empty texts
- Spec reference: REQ-SY-005, REQ-SY-010
- Situation: missing
- What I chose: `example raw ''` and `example raw ""` are accepted (the line is sent, and the oracle will likely not answer it). A `text` clause with no lines under it is accepted.
- Alternatives: P004 for an empty raw line, or a diagnostic for an empty text.
- Should the spec pin this? unsure.

## C-40: Hidden files in a folder record
- Spec reference: REQ-RC-001
- Situation: ambiguous
- What I chose: Each part of a name below the record's folder is checked: a part starting with `.` leaves the file out, and a folder part named `build` or `node_modules` leaves it out. The named folder itself may have such a name (as RC-001 Example 5 shows for `build`).
- Alternatives: none.
- Should the spec pin this? no.

## C-41: Line ends in record texts that are not `\r\n`, `\r` or `\n`
- Spec reference: REQ-SY-001
- Situation: ambiguous
- What I chose: Only CR LF, lone CR and LF end lines. U+2028/U+2029 are white space within a line, and are removed when they come at its end (SY-001 example with `spec s 1 `).
- Alternatives: Treat U+2028 as a line end.
- Should the spec pin this? no. The example pins it already.

## C-42: The text of a `title`, `contract` and the other single-line clauses
- Spec reference: REQ-SY-003, REQ-SY-004
- Situation: missing
- What I chose: `contract`, `source` (of `oracle` and of `decision`), `result` and `status` take any text, empty included. `title` and `rejected` with nothing after them get P004.
- Alternatives: P004 or P050 for empty clauses.
- Should the spec pin this? no.

## C-43: Testing the examples of SPEC.md
- Spec reference: none
- Situation: missing
- What I chose: Every example in SPEC.md is extracted into `tests/spec-examples.json` by `tools/extract-examples.ts`. Each block of a record text gets a final LF. All the examples go to one driver process, and responses are matched by position.
- Alternatives: Hand-copy each example as a test.
- Should the spec pin this? yes. Whether a record text shown in a code block ends with a newline is not stated, though no example depends on it.
