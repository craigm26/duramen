# CHOICES

Where SPEC.md was silent, ambiguous or contradicted itself, these are the readings the implementation takes.

## C-1: Statements and clauses of the rest of the language
- Spec reference: OPEN-RC-001, REQ-SY-002
- Situation: missing
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` are known statements: no diagnostic, body ignored. On an `op`, a `returns` clause is accepted silently (its lines are not read); on a `req`, a `static` clause is accepted silently and counts as standing in for an example (T001 is not given).
- Alternatives: P002 for the statements; P015 for the clauses; reading their bodies.
- Should the spec pin this? no, the rest of the language is open on purpose.

## C-2: Comments and stray indents inside a `text`
- Spec reference: REQ-SY-005, REQ-SY-003
- Situation: missing
- What I chose: a comment at indent 0 or 2, a line indented one space (P007) and a P001 line inside a `text` clause are skipped and neither end the text nor belong to it (the same rule REQ-SY-011 states for input texts). Indent-0 comments are dropped everywhere.
- Alternatives: ending the text at the comment; treating an indent-2 comment as a clause boundary.
- Should the spec pin this? yes, REQ-SY-005 only says what lines belong to a text, not what a comment between them does.

## C-3: Comment lines at indent 2 do not change the "latest clause"
- Spec reference: REQ-SY-003
- Situation: ambiguous
- What I chose: a deeper line after an indent-2 comment still belongs to the clause before the comment.
- Alternatives: P006 for such lines.
- Should the spec pin this? no.

## C-4: An empty once-only clause still counts
- Spec reference: REQ-SY-003, REQ-SY-009, D-017
- Situation: ambiguous
- What I chose: an empty `contract`, `source`, `status` or `on` is a clause for P052 purposes (a second one gets P052), though an empty `contract`/`source`/`decision` states nothing.
- Alternatives: an empty clause does not count as the first.
- Should the spec pin this? unsure; D-017 says "an empty clause is none" without saying it is not a first clause.

## C-5: `section` with no ID, or an ID and no title
- Spec reference: REQ-SY-006
- Situation: missing
- What I chose: P005 (no title), nothing else.
- Alternatives: P005 plus another code for the missing ID.
- Should the spec pin this? no.

## C-6: `example raw '...'` forms
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: the single-quote form needs the text after `raw` to start and end with `'` and to be at least two characters long (the text between the first and last `'`); anything else, including `'a' b`, is P004. A JSON-string form that decodes to text with CR or LF is P026 and the example is dropped.
- Alternatives: taking the text between the first and last `'` wherever they are.
- Should the spec pin this? yes, `'a' b` is a corner case with a visible diagnostic.

## C-7: Table header names do not depend on the operation's declared fields
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a name is an expectation path when it is `result`, `audit`, `error` or `id` (alone or followed by `.rest`), whether or not the operation declares an input field of that name; any other name of ASCII letters, digits, `_`, `-` is an input field. I read "also when the operation declares an input field of that name" as "even when".
- Alternatives: the column is both; the declared field wins.
- Should the spec pin this? yes, the sentence is easy to read two ways.

## C-8: Cells in input columns
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: `?` is the oracle's value only in an expectation column; in an input column it is not JSON (P009). In a column with a tolerance every non-empty cell other than `?` must be a number (P010).
- Alternatives: `?` meaning something in input columns.
- Should the spec pin this? no.

## C-9: Which expectations make an error "expected" (T024, T009 and friends)
- Spec reference: REQ-OR-007, REQ-CK-004
- Situation: ambiguous
- What I chose: for T009/T010/T011 and running undeclared operations, an example "expects an error" when an expectation's path is exactly `error` (a `?` included). For T024, any expectation whose first path name is `error` (so `error.code` too) counts as expecting it. For a table row, only non-empty cells count.
- Alternatives: T024 only when the example has no expectations at all.
- Should the spec pin this? yes: "states no expectation with an error" can be read as "no expectations" or "no error expectation".

## C-10: Oracle timeout
- Spec reference: REQ-OR-004
- Situation: missing
- What I chose: 20 seconds per run of the oracle, after which it is killed and T020 is reported.
- Alternatives: other limits, none.
- Should the spec pin this? no (OPEN-RQ-001 covers running time).

## C-11: Where the oracle runs
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: the request's files are written into a fresh temporary folder (all of them, not only the record's), and the oracle is started in the sub-folder of the file with the `oracle` statement. The folder is deleted afterwards. Files that cannot be written are skipped.
- Alternatives: restricting to the record's files.
- Should the spec pin this? no (OPEN-RQ-003).

## C-12: Table row cell splitting
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: cells are split at `|` not preceded by a backslash that itself reads as an escape (left to right: `\|` is a literal `|`, any other backslash is itself). The row's leading `|` is removed, and a final empty piece (after a closing `|`) is dropped. A row that is only `|`, `-`, `:` and white space and starts and ends with `|` is a separator, so `|` alone and `| |` are skipped too.
- Alternatives: handling `\\|` as an escaped backslash then a bar.
- Should the spec pin this? no.

## C-13: Condition text of an `errors` clause
- Spec reference: REQ-SY-008, REQ-CK-006
- Situation: ambiguous
- What I chose: a condition is the text after `when` on the clause line followed by the lines under it (four spaces of indent removed, blank lines kept); T004 scans it line by line, once per clause. A clause with P019 has no condition.
- Alternatives: scanning the clause as one string.
- Should the spec pin this? no.

## C-14: Numbers
- Spec reference: REQ-SY-013, REQ-SU-003
- Situation: missing
- What I chose: all JSON integers are read as binary64 floats; JSON.stringify's number format is reproduced for request lines; results written by the driver show integral floats as integers (compared as JSON values, so this is not observable).
- Alternatives: exact big integers.
- Should the spec pin this? no.

## C-15: `judge` validation of check kinds
- Spec reference: REQ-JU-001, OPEN-JU-001
- Situation: missing
- What I chose: a check must be an object with a string `path` and a `kind` member; kinds other than `eq` and `approx` are accepted by the validation and never hold (they are listed in `failed`). A case without a `full` member is a `bad_request`.
- Alternatives: `bad_request` for unknown kinds.
- Should the spec pin this? no; OPEN-JU-001 leaves it open.

## C-16: Blank lines and line handling in the driver
- Spec reference: Driver protocol
- Situation: ambiguous
- What I chose: a line is blank only if it is empty or all spaces and tabs; a line holding only a CR (from CRLF input) is answered with `bad_request`. Input bytes are decoded as UTF-8 with replacement. After a request is handled any exception gives `{"id": <id>, "error": "internal_error"}`.
- Alternatives: treating all JavaScript white space as blank.
- Should the spec pin this? no (the spec says it is open).

## C-17: `input` lines under an example
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: the text under an `input <path>` line is always consumed (also when the path is bad, so no P006 for it); a text made only of blank lines is "no text" (P049). A `from` detection needs white space before `from` and a final JSON string. In a raw example, a non-`from` `input` line still consumes its text, a `from` line does not.
- Alternatives: leaving the text of a bad-path input to produce P006.
- Should the spec pin this? no.

## C-18: Duplicate once-only handling for `request` on `op`/`spec` when the first is malformed
- Spec reference: REQ-SY-003
- Situation: ambiguous
- What I chose: a malformed first `request` of a spec or operation still counts, so the second gets P052 (as the spec says for once-only clauses). The effective request of the op/spec is then empty.
- Alternatives: not counting a malformed one (the rule the spec states for examples).
- Should the spec pin this? no, REQ-SY-003 and Example 7 already say it.

## C-19: Diagnostics for the record as a whole
- Spec reference: REQ-RC-003, REQ-RC-004
- Situation: ambiguous
- What I chose: P021 (no spec) and P047 are reported with the record's name: the entry as given, or `.`. P020 is given only when a file has no `duramen` statement at all; a file whose first statement got P023 does not also get P020.
- Alternatives: P020 as well.
- Should the spec pin this? no, the examples already show it.

## C-20: What counts as T001 for a requirement with only a dropped example
- Spec reference: REQ-CK-001
- Situation: missing
- What I chose: not relevant for records that are read without errors (dropped examples always cause a P error first).
- Alternatives: none.
- Should the spec pin this? no.

## C-21: Order of the clauses P005 and P004 for IDs
- Spec reference: REQ-SY-006
- Situation: ambiguous
- What I chose: the ID is the first word; the title is everything after it. P005 when the title is empty, shorter than two characters, or does not start and end with `"`; P004 when it does but is not a JSON string. At most one of them per header.
- Alternatives: none obvious.
- Should the spec pin this? no.

## C-22: Which quotation marks T004 skips
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: per line, left to right, non-overlapping `"..."`, `“...”` and `` `...` `` are removed before looking for MUST/SHALL/REQUIRED; an unclosed opening mark removes nothing.
- Alternatives: nested handling.
- Should the spec pin this? no.

## C-23: Test of T005 phrases
- Spec reference: REQ-CK-008
- Situation: ambiguous
- What I chose: the requirement's `text` is the lines joined with LF (indent removed); phrases are matched ASCII-case-insensitively with any JavaScript white space between words; codes are matched as whole words (no ASCII letter, digit, `_` or `-` touching) and need two different declared codes.
- Alternatives: none obvious.
- Should the spec pin this? no.

## C-24: Judge: members compared after sorting
- Spec reference: REQ-JU-004
- Situation: ambiguous
- What I chose: the answer's member names are sorted by UTF-16 code units and compared with `full.members` as given (no sorting of `full.members`).
- Alternatives: comparing as sets.
- Should the spec pin this? no.

## C-25: Platform defaults
- Spec reference: REQ-SY-009
- Situation: missing
- What I chose: an `on` clause with nothing after it is P033.
- Alternatives: treating it as `any`.
- Should the spec pin this? no.
