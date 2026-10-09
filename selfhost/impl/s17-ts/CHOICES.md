# CHOICES

## C-1: Statements of the rest of the language
- Spec reference: OPEN-RC-001, REQ-SY-002
- Situation: ambiguous
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` are known statement keywords: no P002, and their bodies are ignored without diagnostics.
- Alternatives: report them as P002 (the spec lists them as keywords of the language, so P002 seemed wrong); read their clauses.
- Should the spec pin this? no, it is open on purpose.

## C-2: `returns` and `static` clauses
- Spec reference: OPEN-RC-001, REQ-SY-003
- Situation: ambiguous
- What I chose: they are not taken by `op` and `req`, so they get P015 like any other unknown clause.
- Alternatives: accept them silently (and let `static` stand in for an example in T001).
- Should the spec pin this? no, open.

## C-3: Which white space makes a driver line blank
- Spec reference: Driver protocol
- Situation: ambiguous (declared open)
- What I chose: one trailing CR is dropped from each input line first; then a line of only spaces and tabs is blank and gets no response. Any other line of white space (U+00A0, say) gets `bad_request` with `id` null.
- Alternatives: treat all of `\s` as blank.
- Should the spec pin this? no, it already says it is open.

## C-4: Lines under a statement that gets P002
- Spec reference: REQ-SY-002, REQ-SY-001
- Situation: ambiguous
- What I chose: the body of an unknown statement is ignored except that a line with a tab or other non-space leading white space still gets P001 (lexical, found before statements are grouped). P007, P006 and the rest are not reported there.
- Alternatives: also ignore P001 there.
- Should the spec pin this? yes, a P001 line inside an ignored body is a corner two builds could differ on.

## C-5: `req`, `open`, `decision`, `section` with no ID at all
- Spec reference: REQ-SY-006
- Situation: missing
- What I chose: `req` alone is P005 (no ID and no title: one diagnostic, P005).
- Alternatives: another code for the missing ID; P005 plus P004.
- Should the spec pin this? yes.

## C-6: Comments between the lines of a `text` clause
- Spec reference: REQ-SY-003, REQ-SY-005
- Situation: ambiguous
- What I chose: a comment at indent 2 (or indent 0) between text lines is skipped and does not end the text, the same way REQ-SY-011 says for an input text. A 1-space line (P007) is likewise dropped and does not end it.
- Alternatives: a comment ends the text, and later 4-space lines are P006.
- Should the spec pin this? yes.

## C-7: Table header name that is both an expectation path and a declared input field
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: the expectation path reading wins whenever the name is `result`, `audit`, `error` or `id` (alone or with `.rest`), even when the operation declares an input field of that name. Only names with no such reading are input fields.
- Alternatives: the declared input field wins.
- Should the spec pin this? yes; the sentence "also when the operation declares an input field of that name" is hard to read.

## C-8: Checks of an unknown `kind` in `judge`
- Spec reference: REQ-JU-001, OPEN-JU-001
- Situation: ambiguous
- What I chose: such a check has a string `path` and a `kind`, so the request is well formed, and the check is not met (`checks.<n>` is listed in `failed`).
- Alternatives: `bad_request`.
- Should the spec pin this? no, open.

## C-9: Oracle timeout and the `node` command
- Spec reference: REQ-OR-002, REQ-OR-004, OPEN-RQ-001
- Situation: missing
- What I chose: one oracle run may take 10 seconds, then it is killed (T020). A command whose first word is exactly `node` is started with the path of the running Node.js binary, so it does not depend on PATH. The oracle's standard error is discarded. The record's files are written to a fresh temporary folder, and the oracle starts in the folder of the file holding `oracle`; the folder is removed after the request.
- Alternatives: longer or shorter timeout; look `node` up on PATH.
- Should the spec pin this? no (the time is open); the `node` substitution is an implementation detail.

## C-10: Lines of a rejected alternative
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: the decoded alternative is split into lines at LF, CR LF and a lone CR, and quotations are looked for in each line. Texts (`text` clauses) are split the same way.
- Alternatives: LF only.
- Should the spec pin this? yes, a CR inside a JSON string is the one place it matters.

## C-11: Brackets in the fields of `input`
- Spec reference: REQ-SY-007
- Situation: ambiguous
- What I chose: one depth counter for `[`, `{` and `(` together; any closing one lowers it, but never below 0. So `(]` closes. Single quotes quote nothing (`'x, y'` is split at the comma).
- Alternatives: one counter per bracket kind or a matching stack.
- Should the spec pin this? yes.

## C-12: Text after an `input` line whose path is malformed
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: every `input` line that is not of the `from "<file>"` form takes the text under it (lines indented six or more, blank lines included), whether or not its path is good; the one diagnostic is for the path, the file or the missing text. So there is no P006 cascade from a bad path.
- Alternatives: leave the text of a bad-path line unread, giving P006 for each of its lines.
- Should the spec pin this? yes.

## C-13: What makes an `input` line a `from` line
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: the rest of the line must be `<anything lazily> <white space> from <white space> <JSON string>` up to the end of the line, and the last part must be a valid JSON string. Otherwise the whole rest is the path (and usually P049). A `from` line with an empty path (`input from "x"`) is a path of the form `from "x"`, so P049.
- Alternatives: report P004 for a bad quoted string after `from`.
- Should the spec pin this? yes.

## C-14: Unknown clause followed by a 1-space line
- Spec reference: REQ-SY-003
- Situation: ambiguous
- What I chose: a line indented one space always gets P007, also under a clause that is ignored (unknown or repeated).
- Alternatives: ignore it with the lines under that clause.
- Should the spec pin this? no, rare.

## C-15: Raw example in single quotes
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: `'` alone, or text that does not end with `'`, is P004; `''` is an empty raw line. An empty raw line is accepted by the reader and sent as an empty request line to the oracle.
- Alternatives: P004 for an empty line.
- Should the spec pin this? no.

## C-16: Request member values that are not JSON.stringify-able
- Spec reference: REQ-SU-003
- Situation: missing
- What I chose: nothing special; request members come from parsed JSON, so they are always stringifiable. Numbers are written as JSON.stringify writes them (`1.50` becomes `1.5`) in request members and in the compact input of an example with input lines, while the input of an example without input lines is the text as written.
- Alternatives: none seen.
- Should the spec pin this? no.

## C-17: A `status` or `source` that repeats on a decision with a weak first
- Spec reference: REQ-CK-009
- Situation: ambiguous
- What I chose: the check (T027, T028) uses the first `status` clause only; a second one is P052 and stops the check anyway.
- Alternatives: none.
- Should the spec pin this? no.

## C-18: The `solo` flag for an example that omits `op`
- Spec reference: REQ-OR-002, REQ-SU-002
- Situation: ambiguous
- What I chose: an example is solo only when it is raw or omits `id`. Omitting only `op` leaves it in the batch (its `id` still matches).
- Alternatives: solo for any omitted `id`, `op` or `input`.
- Should the spec pin this? no, the text says "leaves out `id`".

## C-19: Which operation an example of a duplicated operation uses
- Spec reference: REQ-CK-002
- Situation: ambiguous
- What I chose: the first operation of the name, for fields, `request`, `audit` and tolerances; a malformed op name (P031) is never registered.
- Alternatives: none.
- Should the spec pin this? no; the spec says it.

## C-20: Table cell parsing details
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a backslash not followed by `|` is an ordinary character in a cell. A cell with trailing text after the last `|` is a cell (the closing `|` may be left out). A row like `|   |` or `|` is a separator (only `|`, `-`, `:` and white space, starting and ending with `|`), so it is skipped, also between data rows. The `error`, `id` and other header names are compared as whole strings for the "names a column again" rule (the tolerance is not part of the name).
- Alternatives: treat `|   |` as a row with one empty cell.
- Should the spec pin this? no; Example 4 of REQ-SY-012 settles the first two.

## C-21: Where a table problem is reported
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: structure problems (no op, an op of several words, fewer than a header and one row) are P013 at the `table` line; header problems (P013 for a cell of no form or a repeated name, P010 for a tolerance) are at the header row's line; cell problems at their row's line.
- Alternatives: all at the `table` line.
- Should the spec pin this? yes; I read it off the examples' line numbers.

## C-22: Text of an `errors` condition
- Spec reference: REQ-SY-008, REQ-CK-006
- Situation: ambiguous
- What I chose: a condition is the text after `when` on the clause's line plus every continuation line (indent four or more, with four spaces removed); each is a separate line for quotation matching. A continuation line indented 3 is P006 and not part of it.
- Alternatives: join the lines.
- Should the spec pin this? no (REQ-CK-006 says lines).

## C-23: A number too large in a judge request
- Spec reference: OPEN-JU-002
- Situation: ambiguous (open)
- What I chose: JSON.parse reads `1e400` as Infinity and the request is judged with that value as a JS number, so `tol: 1e400` is a valid tolerance and an `approx` value of `1e400` compares as Infinity.
- Alternatives: `bad_request`.
- Should the spec pin this? no, open.

## C-24: Oracle responses in a batch with a repeated or missing id
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: a batch's response lines are matched by `id` as the spec says; a line that is valid but whose id matches no example is ignored.
- Alternatives: none.
- Should the spec pin this? no.

## C-25: T004 on a spec, section or note with no text
- Spec reference: REQ-CK-006
- Situation: missing
- What I chose: a statement with no `text` clause has nothing to check. Each `text` is checked as a whole with each of its lines separately for quotations.
- Alternatives: none.
- Should the spec pin this? no.
