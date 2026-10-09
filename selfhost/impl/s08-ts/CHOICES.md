# Choices

## C-1: A malformed tolerance does not claim its path
- Spec reference: REQ-SY-007, REQ-SY-003, D-017
- Situation: contradictory
- What I chose: a `tolerance` clause registers its path only when it is valid (path, JSON number of 0 or more). A malformed one gets P018 and a later valid clause for the same path is not a duplicate. A second valid clause for a registered path gets P052 (and nothing else, even if its number is bad).
- Alternatives: count a malformed first clause (D-017 says a first once-only clause with a problem still counts), which would give P052 to lines 5 to 8 of REQ-SY-007 example 5, contradicting its stated output.
- Should the spec pin this? yes, D-017's sentence and the example disagree for `tolerance`.

## C-2: What counts as a valid version
- Spec reference: REQ-RC-003
- Situation: ambiguous
- What I chose: everything after `duramen` (trimmed) must be exactly `0.1` or `0.2`; `duramen 0.1 extra` gets P023. The first `duramen` of a file sets the file's version.
- Alternatives: read only the first word after the keyword.
- Should the spec pin this? no, rare.

## C-3: A header with no ID
- Spec reference: REQ-SY-006
- Situation: missing
- What I chose: `section`, `req`, `open` or `decision` with nothing after the keyword gets P005, like a missing title.
- Alternatives: a P-code of its own.
- Should the spec pin this? no.

## C-4: Single-quoted raw line
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: `example raw '...'` needs the argument to start and end with `'` (length 2 or more); text after the last `'` is P004. An empty `''` is a valid empty line.
- Alternatives: take the text between the first and last `'` and ignore what follows the last one.
- Should the spec pin this? unsure.

## C-5: Statements and clauses of the rest of the language
- Spec reference: OPEN-RC-001
- Situation: missing
- What I chose: `type`, `edge`, `edgedef`, `property`, `evidence` are read as statements with their body ignored; `returns` (op) and `static` (req) are accepted without checks; a `static` clause stands in for an example (no T001).
- Alternatives: reject them with P002/P015.
- Should the spec pin this? no, it is open on purpose.

## C-6: Comments at indent 0 inside a body
- Spec reference: REQ-SY-002, REQ-SY-005
- Situation: missing
- What I chose: a `#` line at indent 0 is dropped from the stream; it neither ends a statement's body nor a text block.
- Alternatives: it ends the current text block.
- Should the spec pin this? no.

## C-7: Lines with P001 are removed entirely
- Spec reference: REQ-SY-001
- Situation: ambiguous
- What I chose: such a line gets P001 and is as if absent, also inside a text or an input block (it does not count as a blank line there, and does not end the block).
- Alternatives: treat it as a blank line.
- Should the spec pin this? no.

## C-8: Lines of white space other than spaces and tabs in the protocol
- Spec reference: Driver protocol
- Situation: missing (stated as open)
- What I chose: only empty or space/tab lines are blank. A line of other white space (e.g. a lone CR or U+00A0) goes through JSON parsing and gets `bad_request`. A CR before the LF is stripped.
- Alternatives: treat all `\s` lines as blank.
- Should the spec pin this? no, stated open.

## C-9: Running the oracle
- Spec reference: REQ-OR-002, REQ-OR-004
- Situation: missing
- What I chose: the request's files are written to a temporary folder and the oracle runs there, in the folder of its file. A first word `node` is replaced by the running Node's path. Standard error is discarded. A run is stopped after 20 seconds (T020). A broken pipe on writing to the oracle is not a failure when it exits with 0. The folder is removed afterwards.
- Alternatives: other time limit, spawn `node` from the PATH.
- Should the spec pin this? unsure: the limit is untestable but a test with a slow oracle depends on it.

## C-10: The operation of a raw example
- Spec reference: REQ-SU-005
- Situation: ambiguous
- What I chose: for a raw example, `full.tolerances` and the audit rule use the operation named by the `op` of the raw line (if it parses as JSON with a string `op`); otherwise there is no operation.
- Alternatives: no operation for raw examples (`tolerances` is `{}`).
- Should the spec pin this? yes.

## C-11: A `?` cell under an input field
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: `?` is only the oracle's value under an expectation path; under an input field it is a cell that is not JSON (P009).
- Alternatives: skip it.
- Should the spec pin this? no.

## C-12: T023 and values that are not strings
- Spec reference: REQ-CK-005
- Situation: missing
- What I chose: `expect error = <value>` where the value is not a string (or any equal-kind expectation of path `error`, a table cell included) gets T023, since no declared code equals it.
- Alternatives: ignore it.
- Should the spec pin this? no.

## C-13: Which problem an `input` line reports
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: one diagnostic per line, in this order: path form (P049), file (P048), text missing (P049), path through a non-object (P049). Text under a line with a bad path is still consumed.
- Alternatives: both P049 and P048 on one line.
- Should the spec pin this? no.

## C-14: A `#` line indented three spaces
- Spec reference: REQ-SY-003, REQ-SY-005, REQ-SY-008
- Situation: ambiguous
- What I chose: under `text` it gets P008, under an `errors` clause P006, as any line of that indent does; only comments in clauses that take no lines are exempt from P006.
- Alternatives: comment.
- Should the spec pin this? no.

## C-15: The response of a solo run
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: the response is the only non-blank line of standard output, which must be a JSON object with no number too large for binary64; its `id` need not match. Blank lines are not lines.
- Alternatives: require a string `id`.
- Should the spec pin this? no.

## C-16: An empty `contract`, `status`, `source`
- Spec reference: REQ-SY-003, REQ-SY-004
- Situation: ambiguous
- What I chose: an empty `contract` is a first `contract` for P052; empty `source`/`status` likewise count as present once, `source` as none (T013) and `status` as a status with no word (T027).
- Alternatives: not counted.
- Should the spec pin this? no.

## C-17: Header cells of a table
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a cell's name runs up to the first white space, `±` or `+-`; the rest must start with `±` or `+-`, else the cell is of no form (P013). Names compare by their text; `id`, `result`, `audit`, `error` always name a path, even if an op has a field of that name.
- Alternatives: a field named `id` wins.
- Should the spec pin this? unsure.

## C-18: T005 and T-code boundary for names
- Spec reference: REQ-CK-008
- Situation: ambiguous
- What I chose: a code is named when no ASCII letter, digit, `_` or `-` touches it; a phrase when no letter, digit or `_` touches it. Only the `text` of a `req` is searched.
- Alternatives: `\b`-style boundaries.
- Should the spec pin this? no.

## C-19: A missing value of an oracle expectation in a case
- Spec reference: REQ-SU-004
- Situation: missing
- What I chose: unreachable in practice (T025 is an error and stops `cases`); `null` is written.
- Alternatives: omit the check.
- Should the spec pin this? no.

## C-20: Reading the driver's input
- Spec reference: Driver protocol
- Situation: missing
- What I chose: lines are handled as they arrive (an interactive caller gets each response at once), and a last line without LF is handled at end of input.
- Alternatives: read everything first.
- Should the spec pin this? no.
