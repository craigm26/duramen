# Choices

Where SPEC.md was silent, ambiguous or in conflict with itself, this is what I chose.

## C-1: Which lines are blank for the driver
- Spec reference: Driver protocol (blank lines)
- Situation: ambiguous
- What I chose: a request line is blank (no response) only when it is empty or holds spaces and tabs. A line of other white space (for instance a lone CR) is not blank and gets `bad_request` with `id` null. A CR at the end of a request line is JSON white space, so CRLF requests work.
- Alternatives: treat every ECMAScript white space line as blank.
- Should the spec pin this? no, it is already named open and a harness has little reason to send such lines.

## C-2: Bytes that are not UTF-8 on input
- Spec reference: Driver protocol
- Situation: missing
- What I chose: invalid UTF-8 in a request line is decoded with U+FFFD replacement, so the line is still handled.
- Alternatives: answer `bad_request`.
- Should the spec pin this? no.

## C-3: How output is encoded
- Spec reference: Driver protocol (standard output is UTF-8)
- Situation: missing
- What I chose: output is pure ASCII, with every non-ASCII character written as a `\uXXXX` escape (surrogate pairs for astral characters). It is valid UTF-8 and parses to the same values. Numbers use ECMAScript's number-to-string, and integral values are written without a fraction.
- Alternatives: raw UTF-8 output.
- Should the spec pin this? no, results are compared as parsed JSON.

## C-4: A check of a kind other than `eq` and `approx` in `judge`
- Spec reference: REQ-JU-001, OPEN-JU-001
- Situation: missing
- What I chose: the form is accepted when the check is an object with a string `path` and a string `kind`. A check of an unknown kind never holds, so its `checks.<n>` is listed as failed. A `kind` that is missing or not a string is a `bad_request`.
- Alternatives: `bad_request` for unknown kinds.
- Should the spec pin this? no, it is open on purpose.

## C-5: Numbers too large for binary64 in a `judge` request
- Spec reference: OPEN-JU-002
- Situation: missing
- What I chose: such a request is parsed with the number as infinity and judged like any other (an infinite value only equals itself).
- Alternatives: `bad_request`.
- Should the spec pin this? no, it is open.

## C-6: `entry` of the wrong type, or `null`
- Spec reference: Errors, step 3
- Situation: ambiguous
- What I chose: `entry` present with any value but `"."` or a valid relative path (a number, `null`, an empty string, a path with `..`) is a `bad_request`. The same name rules as for `files` apply, so `a/` and `/x` are refused.
- Alternatives: treat `null` as missing.
- Should the spec pin this? no, "present and neither" covers it.

## C-7: The statements and clauses the spec leaves open
- Spec reference: OPEN-RC-001, REQ-SY-002
- Situation: missing
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` statements are accepted with no diagnostic and their bodies are ignored. The clauses `returns` (of `op`) and `static` (of `req`) are accepted with no diagnostic and the lines under them are ignored. A `static` clause counts in place of an example for T001. `duramen 0.2` adds no check.
- Alternatives: report them as P002 or P015.
- Should the spec pin this? no, it is open.

## C-8: An ID statement with nothing after the keyword
- Spec reference: REQ-SY-006
- Situation: ambiguous
- What I chose: `section`, `req`, `open` or `decision` alone (no ID, no title) gets P005, one diagnostic. The ID is the first word whatever it holds; there is no ID syntax check.
- Alternatives: a separate code for a missing ID.
- Should the spec pin this? yes, an example with `req` alone would settle it.

## C-9: A table header name that is both an expectation path and an input field
- Spec reference: REQ-SY-012 ("also when the operation declares an input field of that name")
- Situation: ambiguous
- What I chose: I read "also when" as "even when". A name that is `result`, `audit`, `error` or `id`, alone or followed by `.` and more, is always an expectation path, whatever the operation declares. Any other name of letters, digits, `_` and `-` is an input field, declared or not.
- Alternatives: an input field when the operation declares one of that name.
- Should the spec pin this? yes. The sentence reads two ways, and the SY-012 example 6 passes either way.

## C-10: Brackets in `input` field lists
- Spec reference: REQ-SY-007
- Situation: ambiguous
- What I chose: one depth counter for `[`/`{`/`(`; any of `]`/`}`/`)` closes one level when the depth is above 0 and is an ordinary character otherwise. Brackets inside double quotes do not count, and a backslash inside quotes keeps the next character.
- Alternatives: a stack that matches the bracket kinds.
- Should the spec pin this? unsure; mixed pairs like `(]` are rare.

## C-11: Which expectations count as "expecting an error"
- Spec reference: REQ-CK-004, REQ-OR-007
- Situation: ambiguous
- What I chose: only an expectation whose path is exactly `error` (any form: `=`, `≈`, `?`, or a table cell) counts, for both T009–T011 and T024. `expect error.code = ...` does not.
- Alternatives: also count paths that start with `error.` for T024.
- Should the spec pin this? yes; REQ-OR-007 never defines "an expectation with an error".

## C-12: Comments inside an example's input text
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: a `#` line indented four or five spaces is an example line (a comment), so it ends the text of an `input` block. One indented six or more is text. Comments at indent 0 and 2 are skipped without ending the text.
- Alternatives: comments at any indent are skipped.
- Should the spec pin this? yes, with one example.

## C-13: An `input` block with only blank lines
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: blank lines at the end are dropped, so a block of only blank lines is empty and gets P049 ("no text under it").
- Alternatives: a text of `"\n"`.
- Should the spec pin this? no, it follows from the words.

## C-14: What an `expect` line without an operator is
- Spec reference: REQ-SY-010
- Situation: missing
- What I chose: after the path, anything other than `=`, `≈` or `~` (including nothing, as in `expect result`, or `expect result foo`) gets P011. `expect result =` gets P009.
- Alternatives: P009 or P010.
- Should the spec pin this? no, REQ-SY-010 example 2 shows `expect result` and `expect result =`.

## C-15: Splitting `≈ n ± tol`
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: the line splits at the first `±` or `+-`; the left and right parts, trimmed, must each be a JSON number (the right one 0 or more), else P010.
- Alternatives: a stricter grammar.
- Should the spec pin this? no.

## C-16: What a decision's status is for T027
- Spec reference: REQ-CK-009
- Situation: ambiguous
- What I chose: the first word is the status text up to the first white space. For `superseded` the whole text must match `superseded by <ID>` with one space each, an ID of one word, naming any declared decision (a decision may name itself). A `status` with nothing after it is T027, and counts as accepted for T028.
- Alternatives: allow several spaces.
- Should the spec pin this? no, the examples show it.

## C-17: The oracle's time limit and environment
- Spec reference: REQ-OR-004 ("for taking too long")
- Situation: missing
- What I chose: each run of the oracle (the batch run and each solo run) is stopped after 60 seconds, which gives T020, and the output written so far is used. The files of the request are written to a fresh temporary folder, the oracle starts there in the folder of the file that holds `oracle`, with the checker's environment and its standard error discarded, and the folder is removed afterwards.
- Alternatives: another limit.
- Should the spec pin this? no, OPEN-RQ-001 already leaves timing open.

## C-18: An oracle whose output has a stray byte sequence
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: standard output is decoded as UTF-8 with replacement, split at LF only, and a line is a response only if my strict JSON reader takes it (so `NaN` or a trailing comma is no response).
- Alternatives: lenient JSON.
- Should the spec pin this? no.

## C-19: A request that omits `id` is solo
- Spec reference: REQ-OR-002, REQ-SU-002
- Situation: ambiguous
- What I chose: an example is solo when it is raw or when an `omit` line names `id` (also from a table, which cannot omit). `omit op` or `omit input` alone does not make it solo.
- Alternatives: solo whenever the line has no `id` member.
- Should the spec pin this? no, these are the same set today.

## C-20: `omit` of a name nobody sets
- Spec reference: REQ-SU-003
- Situation: missing
- What I chose: ignored, with no diagnostic.
- Alternatives: a diagnostic.
- Should the spec pin this? no.

## C-21: Input cells in a table
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a `?` under an input field is not JSON (P009). A row with the wrong number of cells gets P014 and its cells are not read otherwise. A header that names `id` or any other column twice gets P013 at the header's line.
- Alternatives: allow `?` for input.
- Should the spec pin this? no, it follows from "any other column, JSON".

## C-22: Raw examples: the two forms
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: `example raw '...'` needs the text to start and end with `'` and be at least two characters, else P004. The line between them is not checked as JSON. An empty raw line is allowed.
- Alternatives: require valid JSON.
- Should the spec pin this? no.

## C-23: A `from` file name that leaves the folder, or a folder
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: a `..` that goes above the root of the request, a name that resolves to a folder or to nothing, and a file outside the record's folder, all get P048. Hidden and `build` files inside the record's folder are allowed as `from` files.
- Alternatives: apply the REQ-RC-001 exclusions to `from` files.
- Should the spec pin this? unsure.

## C-24: Duplicate keys in JSON
- Spec reference: REQ-SU-003, REQ-OR-003
- Situation: missing
- What I chose: as ECMAScript: the last value wins and the member keeps the position of its first appearance. Request members are written with array-index names first in increasing order.
- Alternatives: P009 for duplicate names.
- Should the spec pin this? no.

## C-25: Very deep JSON
- Spec reference: REQ-SY-013
- Situation: missing
- What I chose: JSON nested too deeply for the Python recursion limit (raised to 20000) is treated as not JSON (P009 or similar) instead of crashing.
- Alternatives: none.
- Should the spec pin this? no.

## C-26: T005 matching
- Spec reference: REQ-CK-008
- Situation: ambiguous
- What I chose: the phrases are matched case-insensitively with ASCII-only case folding and white space from the spec's list between words. Codes are counted by distinct code, and a code listed twice counts once. The diagnostic goes at the requirement's `text` clause line, one per requirement.
- Alternatives: count repeated names as several codes.
- Should the spec pin this? no.

## C-27: Quotations in T004
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: a line is scanned left to right; an opening `"`, `“` or backquote with a matching closer later on the same line makes the span between them (closers included) disappear, replaced by a space. An opener with no closer on its line is an ordinary character. A `”` or a closing quote alone is ordinary.
- Alternatives: remove the span without a space.
- Should the spec pin this? no.

## C-28: A `cases` request when the record has errors from the oracle's silence
- Spec reference: REQ-SU-001
- Situation: ambiguous
- What I chose: T021, T022 and T025 are errors, so they stop the suite like any other error. T024 is a warning and does not.
- Alternatives: none.
- Should the spec pin this? no.

## C-29: `full.audit` types
- Spec reference: REQ-SU-005
- Situation: ambiguous
- What I chose: when the operation declares `audit` and the response has an `audit` member, `full.audit` is that member as the oracle wrote it, even when it is not a string. A path under `audit` reads only a string audit.
- Alternatives: leave out a non-string audit.
- Should the spec pin this? no.

## C-30: Statements before `duramen` in a file and the position of `duramen`
- Spec reference: OPEN-RC-002
- Situation: ambiguous
- What I chose: the `duramen` statement may come anywhere; the first one in a file states its version.
- Alternatives: require it first.
- Should the spec pin this? no, it is open.

## C-31: P001 lines inside texts
- Spec reference: REQ-SY-001, REQ-SY-005
- Situation: ambiguous
- What I chose: a line with a tab (or another non-space) in its leading white space gets P001 and is dropped everywhere, so it does not belong to a `text`, a condition or an input text, and does not end them.
- Alternatives: treat it as text.
- Should the spec pin this? no.

## C-32: Statements split with a comment at indent 0
- Spec reference: REQ-SY-002, REQ-SY-005
- Situation: ambiguous
- What I chose: a comment at indent 0 neither starts a statement nor ends the body of the statement above it, nor is it text, so a `text` clause carries on after it. Blank lines inside a text are kept; those at its start and end are dropped.
- Alternatives: a comment at indent 0 ends the statement body.
- Should the spec pin this? no.

## C-33: Where record-level problems are reported
- Spec reference: REQ-RC-003, REQ-RC-004
- Situation: ambiguous
- What I chose: P021 (no spec) and P047 (mixed versions) go at line 1 of `.` for a record that is the whole request, of the entry's name for a named folder or file. A file record's folder is the folder of the file.
- Alternatives: none; the spec says so.
- Should the spec pin this? no.

## C-34: Table header cell with an empty tolerance
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: `result ±` with nothing after the sign is a tolerance that is not a number (P010), not a cell of no form.
- Alternatives: P013.
- Should the spec pin this? no.
