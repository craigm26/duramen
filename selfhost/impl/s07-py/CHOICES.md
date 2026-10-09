# Choices

## C-1: Statements of the rest of the language
- Spec reference: OPEN-RC-001, REQ-SY-002
- Situation: missing
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` are not P002; the statement and its body are silently ignored.
- Alternatives: report them as unsupported; read them as core statements.
- Should the spec pin this? no, it is open on purpose.

## C-2: Clauses `returns` (of op) and `static` (of req)
- Spec reference: OPEN-RC-001, REQ-SY-003
- Situation: missing
- What I chose: they are not clauses of the core language, so they get P015.
- Alternatives: accept them silently.
- Should the spec pin this? no.

## C-3: Where `duramen` may appear
- Spec reference: OPEN-RC-002
- Situation: missing
- What I chose: the first `duramen` statement anywhere in a file counts as the version statement; P020 only when a file has none.
- Alternatives: require it first.
- Should the spec pin this? no, it is open.

## C-4: `contract` with no value, `decision` clause with no IDs
- Spec reference: REQ-SY-004, REQ-SY-009
- Situation: missing
- What I chose: no diagnostic. `contract` keeps whatever text follows (possibly empty); an empty `decision` clause cites nothing.
- Alternatives: P017/P0xx style error for an empty value.
- Should the spec pin this? yes, the spec gives no code for an empty `contract` or `decision` clause.

## C-5: `on` with no platform
- Spec reference: REQ-SY-009
- Situation: ambiguous
- What I chose: `on` with nothing, or with more than one word, gets P033.
- Alternatives: treat empty as `any`.
- Should the spec pin this? no.

## C-6: Section/req/open/decision header with no ID
- Spec reference: REQ-SY-006
- Situation: ambiguous
- What I chose: a missing ID gets P005, like a missing title; one diagnostic.
- Alternatives: a separate code for the ID.
- Should the spec pin this? yes, the code for a missing ID is unstated.

## C-7: Lines that are ignored for P001
- Spec reference: REQ-SY-001
- Situation: ambiguous
- What I chose: a P001 line is dropped completely; it does not end a text block or an input text and counts as neither blank nor content.
- Alternatives: treat it as a blank line.
- Should the spec pin this? unsure.

## C-8: A line indented one space inside a text clause
- Spec reference: REQ-SY-003, REQ-SY-005
- Situation: ambiguous
- What I chose: P007 and the line is dropped; the text continues.
- Alternatives: end the text.
- Should the spec pin this? no.

## C-9: Raw example that was dropped for its first line
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: it is still raw, so `request`, `omit` and `input` lines under it get P022 (an `input` line still consumes its text lines).
- Alternatives: read the lines as for an ordinary example.
- Should the spec pin this? yes, two readings give different diagnostics.

## C-10: Which diagnostic a malformed second `request` line gets
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: its own problem first (P009/P051); P052 only for a valid second `request`.
- Alternatives: P052 for every second `request`.
- Should the spec pin this? no.

## C-11: Raw example line `'`  and trailing text
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: the single-quoted form must start with `'`, end with `'` and be at least two characters; otherwise P004. `''` is an empty request line.
- Alternatives: use first/last quote positions with text allowed outside.
- Should the spec pin this? no.

## C-12: `input` path scanner
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: a `from "<file>"` split is taken at the first ` from ` after which the rest is a JSON string; if none, the whole text is a path. An `input` line under a dropped example works on an empty object. `from` names are resolved with `.` and `..` segments (and empty segments skipped); absolute names and names leaving the record's folder get P048.
- Alternatives: stricter name syntax.
- Should the spec pin this? no.

## C-13: Input lines and comments in an input text
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: lines right after an `input` line that are blank or indented six or more are its text (a `#` line indented six is text); the first other line ends it.
- Alternatives: none obvious.
- Should the spec pin this? no.

## C-14: Table header details
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a header cell is split at the first `±` or `+-`; the left side must be an input field name or `result|audit|error|id` optionally followed by `.rest` (no white space). The name `result`, `audit`, `error`, `id` alone is always a path. P013 for a problem with the table as a whole (op, row count) is reported at the `table` line, and for header problems (bad cell, duplicate column) at the header row's line; P010 for a header tolerance is at the header row's line. P006 lines are reported even when the table is otherwise not checked.
- Alternatives: report everything at the table line.
- Should the spec pin this? yes (the examples imply it but no sentence says it).

## C-15: Table cells
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a row with no pipe at its end keeps its last cell; a trailing empty cell without a final `|` cannot be written. A separator test is: starts and ends with `|` and all characters in `|-: `.
- Alternatives: none.
- Should the spec pin this? no.

## C-16: Row with an error
- Spec reference: REQ-SY-012
- Situation: missing
- What I chose: a P014 row is skipped; a row with a bad cell reports each bad cell and is otherwise still built.
- Alternatives: stop at the first.
- Should the spec pin this? no (only matters with errors).

## C-17: T024 when the example has expectations
- Spec reference: REQ-OR-007
- Situation: ambiguous
- What I chose: T024 only when the example has no expectation at all; an example with other expectations that gets an error is reported through T002.
- Alternatives: T024 whenever no expectation names `error`.
- Should the spec pin this? yes.

## C-18: Response matching for solo examples
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: the one line a solo run writes counts when it is a JSON object (its `id` is not compared); anything else is no response.
- Alternatives: also require an `id`.
- Should the spec pin this? no.

## C-19: Oracle timeout and environment
- Spec reference: REQ-OR-004, OPEN-RQ-001
- Situation: missing
- What I chose: 30 seconds per run of the oracle, then it is killed (T020). The record's files are written to a temporary folder and the oracle runs in the folder of the file with the `oracle` statement; the environment is inherited and standard error is discarded.
- Alternatives: other limits.
- Should the spec pin this? no.

## C-20: Which statements count with duplicates
- Spec reference: REQ-RC-004
- Situation: ambiguous
- What I chose: the first `spec`, `oracle` and `errors` statements of the record are the ones in effect (spec request, oracle command, error codes). Operations with the same name: the first is used. Decisions with the same ID: the first is used for status.
- Alternatives: the last.
- Should the spec pin this? no (the duplicate is an error anyway).

## C-21: Phrase and code matching for T005
- Spec reference: REQ-CK-008
- Situation: ambiguous
- What I chose: phrases are whole words bounded by no ASCII letter, digit or `_` (a hyphen is allowed to touch); codes are bounded also by `-`. The text is the requirement's text lines joined with LF.
- Alternatives: stricter boundaries.
- Should the spec pin this? no.

## C-22: Quotations in T004
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: a quote opens at the first `"`, `“` or backquote and closes at the next matching closer on the same line; an unclosed one is not a quotation. Quotations do not nest.
- Alternatives: pair quotes left to right counting.
- Should the spec pin this? no.

## C-23: Condition text of an errors clause for T004
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: only the text after `when` on the clause line plus the continuation lines are checked, one line at a time.
- Alternatives: include the code word.
- Should the spec pin this? no.

## C-24: Numbers
- Spec reference: REQ-OR-003, REQ-SU-004
- Situation: missing
- What I chose: JSON numbers are read as binary64; integral values below 2^53 are kept as integers in output, so `1.0` in a check's `value` is written as `1`. Numbers that overflow (e.g. `1e999`) become infinity and are written as `Infinity` by the Python JSON writer, which is not valid JSON.
- Alternatives: special handling of infinity.
- Should the spec pin this? no.

## C-25: Blank lines and the driver
- Spec reference: REQ-RQ-002
- Situation: ambiguous (open)
- What I chose: only empty lines and lines of spaces and tabs are blank; any other whitespace-only line is `bad_request`. A line is split on LF only; a trailing CR is JSON whitespace. Invalid UTF-8 on input is decoded with replacement.
- Alternatives: treat all whitespace-only lines as blank.
- Should the spec pin this? no, it is stated open.

## C-26: Status words and `superseded by`
- Spec reference: REQ-CK-009
- Situation: ambiguous
- What I chose: `superseded by <ID>` must be exactly that, with single spaces and nothing after the ID; the ID must be declared. A decision with a bad status is not judged for T028.
- Alternatives: judge T028 by the first word anyway.
- Should the spec pin this? yes, a bad status plus a citation could be one or two diagnostics.

## C-27: Which examples count for T019 and are run
- Spec reference: REQ-OR-001, REQ-OR-002
- Situation: ambiguous
- What I chose: T019 when the record has any example or table row at all (including ones that would not be run). Open items' examples never count.
- Alternatives: count only runnable ones.
- Should the spec pin this? no.

## C-28: Cases for a record with warnings only
- Spec reference: REQ-SU-001, REQ-SU-002
- Situation: missing
- What I chose: a record with only warnings gets its cases; the oracle's answers are used for `full`. A `member` list for an example the oracle did not answer cannot occur because T021 is an error.
- Alternatives: none.
- Should the spec pin this? no.
