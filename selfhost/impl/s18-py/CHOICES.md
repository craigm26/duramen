# CHOICES

## C-1: P001 inside the body of an unknown statement
- Spec reference: REQ-SY-001, REQ-SY-002
- Situation: ambiguous
- What I chose: a line whose leading white space holds a non-space gets P001 even when it sits in the body of a statement that got P002 (whose body lines are otherwise ignored).
- Alternatives: ignore every line of such a body, P001 lines included.
- Should the spec pin this? yes, "ignored" and "P001 and otherwise ignored" overlap.

## C-2: An indented comment line before the first statement
- Spec reference: REQ-SY-002
- Situation: ambiguous
- What I chose: any non-blank indented line before the first statement of a file gets P003, comments (`  # x`) included, as the example with ` # indented too` shows for indent 1; also for indent 2.
- Alternatives: let an indent-2 `#` line pass as a comment.
- Should the spec pin this? no, the example already points one way.

## C-3: Statements and clauses of the rest of the language
- Spec reference: OPEN-RC-001, REQ-SY-002
- Situation: missing
- What I chose: `type`, `edge`, `edgedef`, `property`, `evidence` are known statement words: no P002, and their bodies are read as clauses and then dropped without diagnostics. `returns` (of `op`) and `static` (of `req`) are accepted clauses whose lines are ignored. Nothing is checked for them (a `static` clause does not satisfy T001).
- Alternatives: P002 / P015 for them.
- Should the spec pin this? no, it is declared open.

## C-4: A `duramen` statement after other statements
- Spec reference: OPEN-RC-002
- Situation: missing
- What I chose: the first `duramen` statement of a file counts wherever it is; P020 only when the file has none.
- Alternatives: P020 when it is not first.
- Should the spec pin this? no, declared open.

## C-5: An empty `contract` counts as the clause for P052
- Spec reference: REQ-SY-003, REQ-SY-004
- Situation: ambiguous
- What I chose: `contract` with nothing after it states no contract, but a second `contract` clause still gets P052.
- Alternatives: an empty clause is not a clause at all.
- Should the spec pin this? yes.

## C-6: Table header cells whose name is a declared input field
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a name the operation declares as an input field is an input column, even if it is `result`, `audit`, `error` or `id` (the sentence "an expectation path ... also when the operation declares an input field of that name" read as: the declaration wins). Otherwise `result|audit|error|id` with an optional `.rest` is an expectation path, and any other word is an input field.
- Alternatives: expectation path wins; a declared field named `id` would then be an expectation on `id`.
- Should the spec pin this? yes, the sentence can be read both ways.

## C-7: A row of only `|` is a separator
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a single `|` (and `| |`) starts and ends with `|` and holds only separator characters, so it is skipped (the example of REQ-SY-012 needs this).
- Alternatives: a one-character row is no separator.
- Should the spec pin this? no, the example shows it.

## C-8: Where `expect ... ≈` splits at `±`
- Spec reference: REQ-SY-010
- Situation: missing
- What I chose: the first `±` or `+-` (whichever is earlier) in the text after `≈`/`~` separates the number from the tolerance; either side not a finite JSON number (or a negative tolerance) is P010.
- Alternatives: parse the number token first, then require the separator.
- Should the spec pin this? no.

## C-9: An `input <path>` line with a bad path still takes its text
- Spec reference: REQ-SY-011
- Situation: missing
- What I chose: the lines indented six or more under any `input` line that is not a `from` line are consumed as its text even when the line got P048/P049, so they add no P006.
- Alternatives: give the text lines P006 after a bad path.
- Should the spec pin this? yes (the example with `input x.y` shows it only for a non-object path).

## C-10: What makes an `input ... from` line
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: a line is a `from` line when its rest ends with white space, `from`, white space and a complete JSON string; the path is everything before the last such `from`. Otherwise the whole rest is the path (and fails as P049 if it is not one).
- Alternatives: a stricter tokenizer for the path.
- Should the spec pin this? no.

## C-11: `..` above the root in a `from` name
- Spec reference: REQ-SY-011
- Situation: missing
- What I chose: a `..` that goes above the top of the request's files leaves the record's folder, so P048.
- Alternatives: clamp at the root.
- Should the spec pin this? no.

## C-12: Lines with `#` at indent 3 under `text` and `errors` clauses
- Spec reference: REQ-SY-005, REQ-SY-008
- Situation: ambiguous
- What I chose: such a line gets P008 (under `text`) or P006 (under an errors clause); the "comment" exemption is only for clauses that take no lines of their own, for tables and for examples.
- Alternatives: treat it as a comment.
- Should the spec pin this? yes.

## C-13: Brackets in `input` field splitting
- Spec reference: REQ-SY-007
- Situation: ambiguous
- What I chose: one depth counter for `(`/`[`/`{` against `)`/`]`/`}`, never below 0 (an unmatched closer is an ordinary character); single quotes mean nothing; an unclosed double quote runs to the end of the clause.
- Alternatives: a stack that matches bracket kinds.
- Should the spec pin this? unsure.

## C-14: Unknown kinds of check in `judge`
- Spec reference: OPEN-JU-001, REQ-JU-001
- Situation: missing
- What I chose: a check with a string `kind` other than `eq`/`approx` and a string `path` is accepted and never holds (it is listed in `failed`). A check whose `kind` is not a string is a `bad_request`.
- Alternatives: `bad_request` for unknown kinds.
- Should the spec pin this? no, declared open.

## C-15: Numbers too large in a `judge` request
- Spec reference: OPEN-JU-002
- Situation: missing
- What I chose: the request line is parsed with ordinary JSON rules, so `1e400` becomes infinity and is treated as an ordinary number.
- Alternatives: `bad_request`.
- Should the spec pin this? no, declared open.

## C-16: Which lines are blank in the driver
- Spec reference: Driver protocol
- Situation: ambiguous (declared open)
- What I chose: a line of only spaces, tabs, CR and LF gets no response; any other white space makes the line a request that fails to parse (`bad_request`, `id` null).
- Alternatives: any ECMAScript white space makes a line blank.
- Should the spec pin this? no, declared open.

## C-17: The oracle's working files and time limit
- Spec reference: REQ-OR-002, REQ-OR-004
- Situation: missing
- What I chose: the checker writes every file of the request into a fresh temporary folder (names a file system rejects are skipped), runs the oracle in the folder of the file holding the `oracle` statement, and removes the folder afterwards. Each run of the oracle may take 30 seconds, then it is stopped (T020). The oracle's standard error is discarded.
- Alternatives: other limits; run in the folder of the entry only.
- Should the spec pin this? no (the time is OPEN-RQ-001).

## C-18: Responses with one `id` for requests with one `id`
- Spec reference: REQ-OR-002, REQ-CK-002
- Situation: ambiguous
- What I chose: examples of two requirements with the same ID (T007) get the same case IDs, so they receive the same (first) response; nothing special is done for them.
- Alternatives: number them apart.
- Should the spec pin this? no, the record is an error anyway.

## C-19: Several oracle lines per example and T024
- Spec reference: REQ-OR-007
- Situation: ambiguous
- What I chose: a table row states an expectation when any cell under an expectation path is non-empty (a `?` cell included); T024 is given only to an example with none.
- Alternatives: `?` does not count.
- Should the spec pin this? no, REQ-OR-007 says non-empty cell.

## C-20: Splitting a rejected alternative into lines
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: the alternative's JSON-decoded text is split at LF, CR LF and CR, and each piece is a line for quotation matching.
- Alternatives: LF only.
- Should the spec pin this? no.

## C-21: Phrases of T005 and letter case
- Spec reference: REQ-CK-008
- Situation: ambiguous
- What I chose: "any letter case" is ASCII case folding only; codes are matched case-sensitively.
- Alternatives: Unicode case folding.
- Should the spec pin this? no.

## C-22: An unterminated `'` or `"` in the oracle command
- Spec reference: REQ-OR-002, REQ-OR-004
- Situation: contradictory (low)
- What I chose: inside `'…'` a backslash is an ordinary character and nothing is an escape; inside `"…"` only `\"` is. An unclosed quote of either kind means the command cannot be started (T020).
- Alternatives: backslash escapes in single quotes.
- Should the spec pin this? yes for single quotes.

## C-23: Failures of the checker
- Spec reference: OPEN-RQ-004
- Situation: missing
- What I chose: an unexpected exception gives `{"id": <id>, "error": "internal_error"}` with the traceback on standard error, as the reference does.
- Alternatives: none.
- Should the spec pin this? no, declared open.

## C-24: Duplicate request ids within the oracle batch and `id` that is not a string
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: a response matches an example when its `id` is a string equal to the example's case ID; the first of equal IDs wins; a response with an `id` that is not a string matches nothing.
- Alternatives: none.
- Should the spec pin this? no.

## C-25: A `text` clause's lines that are not four-space indented
- Spec reference: REQ-SY-005
- Situation: missing
- What I chose: a line under `text` indented three spaces gets P008 and is not part of the text; blank lines inside are kept, and leading and trailing blank lines are dropped.
- Alternatives: keep the P008 line in the text.
- Should the spec pin this? no (reading already fails).

## C-26: Empty input text and P049
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: an `input <path>` line has "no text" when its lines are all blank (or there are none); a text of only blank lines is therefore P049.
- Alternatives: an all-blank text is the empty string.
- Should the spec pin this? yes.

## C-27: The expected `error` member in `judge` when `full` has `error`
- Spec reference: REQ-JU-004
- Situation: ambiguous
- What I chose: "`full` has an `error`" is the presence of the member, so `"error": null` counts and the answer must then have an `error` member equal to `null`.
- Alternatives: none; the examples show it.
- Should the spec pin this? no.

## C-28: Decision status `superseded by <ID>` details
- Spec reference: REQ-CK-009
- Situation: ambiguous
- What I chose: the status must match `superseded by ` plus exactly one more word (no white space in it) with single spaces and nothing after; the ID must be the ID of some decision statement. Every declaration of an ID gets its own T027.
- Alternatives: the first declaration only.
- Should the spec pin this? no.
