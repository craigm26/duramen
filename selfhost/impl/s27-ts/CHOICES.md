# Choices

## C-1: The rest of the language is accepted and not read
- Spec reference: OPEN-RC-001
- Situation: missing
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` are known statements: no P002, and their body is not read (not even for P006/P015). `returns` on an `op` and `static` on a `req` are accepted silently; `static` stands in for an example, so a requirement holding only it gets no T001. `duramen 0.2` is checked exactly like `0.1`.
- Alternatives: report P015 for `returns`/`static`; read the statements' bodies; refuse `0.2` features.
- Should the spec pin this? no, it is deliberately open.

## C-2: Comments are dropped before anything else reads a line
- Spec reference: REQ-SY-002, REQ-SY-003, REQ-SY-005
- Situation: ambiguous
- What I chose: a comment at indent 0 or 2 is skipped wherever it stands, including between the lines of a `text` clause (it is not text and does not end the text). A `#` line at indent 3 or more is a line of the latest clause: text inside `text`, a comment elsewhere, except that it gets P006 when the statement has no clause yet and P006 under an `errors` clause when indented exactly three.
- Alternatives: let an indent-0 comment end a text block; treat every `#` line as text inside `text`.
- Should the spec pin this? unsure, the input-text rule pins it for `input` blocks only.

## C-3: A missing ID or title is P005
- Spec reference: REQ-SY-006
- Situation: missing
- What I chose: `section`, `req`, `open` or `decision` with nothing after the keyword gets P005 once (no ID, no title). `rejected` or `title` with nothing is P004.
- Alternatives: a separate code for a missing ID; P004.
- Should the spec pin this? yes, the bare-keyword case is common in mutated records.

## C-4: Request lines of other white space are answered bad_request
- Spec reference: OPEN-RQ-005
- Situation: ambiguous
- What I chose: only empty and space/tab lines are blank. A line of other white space is not a JSON object, so it gets `{"id": null, "error": "bad_request"}`. A trailing CR before the LF is JSON white space and the line is handled normally.
- Alternatives: treat all `\s`-only lines as blank.
- Should the spec pin this? no, it is already an open item.

## C-5: Checks of unknown kind in `judge`
- Spec reference: OPEN-JU-001, REQ-JU-001
- Situation: ambiguous
- What I chose: a check with a `path` and any `kind` other than `eq`/`approx` is well formed (so no bad_request) and is never met, so it appears in `failed`. A check with no `kind` member is bad_request.
- Alternatives: bad_request for unknown kinds; ignore them.
- Should the spec pin this? no, open.

## C-6: A lone `|` is a table separator
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a row that is only `|` (starts and ends with `|`, nothing else) is a separator and skipped; REQ-SY-012's example 4 shows it must produce no diagnostic.
- Alternatives: a one-cell row, which would get P014.
- Should the spec pin this? no, the example already does.

## C-7: Oracle process limits and files
- Spec reference: REQ-OR-002, REQ-OR-004, OPEN-RQ-001, OPEN-OR-002
- Situation: missing
- What I chose: each oracle run gets 30 seconds, after which it is killed and T020 follows. The request's files are written into a fresh directory under the system's temp folder, which is deleted afterwards. Standard error of the oracle is discarded. An oracle that exits before reading its input (EPIPE) is judged by its exit status only.
- Alternatives: shorter or longer time; keep standard error for debugging.
- Should the spec pin this? no.

## C-8: U+2028 and U+2029 are escaped in output
- Spec reference: Driver protocol
- Situation: missing
- What I chose: the driver writes them as ` ` / ` ` inside JSON strings, so a reader that splits lines there (Node 24's readline) cannot break a response. The parsed JSON is the same.
- Alternatives: write them raw, as `JSON.stringify` does.
- Should the spec pin this? no, results compare as parsed JSON.

## C-9: Dropped examples are not examples
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: an example whose first line has a problem is not kept in the model (the record has errors anyway). Its sub-lines are still read; a malformed raw example still counts as raw for P022.
- Alternatives: keep it as a half-example.
- Should the spec pin this? no, only observable through the diagnostics, which the spec pins.

## C-10: `omit` of id, op and input
- Spec reference: REQ-SU-003
- Situation: ambiguous
- What I chose: `omit id`, `omit op` and `omit input` leave out the leading members or the input; `omit` of any other name removes a request member from spec/operation/example members. A request member can never be `id`, `op` or `input` (P051), so nothing else is possible. `omit` of a name nobody sets is harmless.
- Alternatives: P011 for an unknown name.
- Should the spec pin this? no.

## C-11: Blank lines inside `errors` conditions
- Spec reference: REQ-SY-008
- Situation: missing
- What I chose: blank lines under an `errors` clause are not part of the condition; lines indented three (even `#` ones) get P006; lines of four or more, `#` included, continue the condition with their extra indent kept.
- Alternatives: keep blank lines as empty condition lines.
- Should the spec pin this? no, no check can see the difference.

## C-12: Text, tolerances and numbers
- Spec reference: REQ-SY-005, REQ-SY-007, REQ-SY-012
- Situation: ambiguous
- What I chose: a `text` clause whose own line has words (P008) still reads its lines; text lines keep indent beyond four spaces; a `-0` tolerance is stored as 0. A numeric text is a JSON number by the JSON grammar (no leading `+`, no `.5`, no `0x10`).
- Alternatives: stricter or looser number syntax.
- Should the spec pin this? no, JSON is named.

## C-13: P001 and P007 in the body of an unknown statement
- Spec reference: REQ-SY-001, REQ-SY-002, REQ-SY-003
- Situation: ambiguous
- What I chose: P001 is reported on every line, wherever it stands, because it is found while splitting lines. P007 and the other clause-structure problems are not reported under an unknown statement, whose body is ignored. Indented lines before the first statement get P003, whatever their indent.
- Alternatives: ignore P001 lines inside ignored bodies.
- Should the spec pin this? yes, both readings are defensible.

## C-14: Where a statement's diagnostics stand when its first line is bad
- Spec reference: REQ-RC-004, REQ-SY-004
- Situation: ambiguous
- What I chose: a first `spec` with a malformed line counts as the spec (no record-level P021), and a second one gets P021 for its own form and P044; only the first spec's `request` and `text` are used. An empty `oracle` is the oracle (its second gets P044); the command run is the first one's.
- Alternatives: none seen.
- Should the spec pin this? no, REQ-RC-004 says it.

## C-15: Duplicate IDs and the oracle
- Spec reference: REQ-CK-002, REQ-OR-002
- Situation: missing
- What I chose: requests sent for examples are numbered per requirement block, so two requirements with one ID send two requests with the same `id`; both examples then read the first response of that `id`. Only a record with errors can have this, so no suite is affected.
- Alternatives: number them uniquely.
- Should the spec pin this? no.

## C-16: What counts as an example for T019 and T001
- Spec reference: REQ-OR-001, REQ-CK-001
- Situation: ambiguous
- What I chose: examples and table rows of requirements count; the `example`/`table` clauses of open items do not (they are T003). T019 lands on the first `spec`'s line, and is not reported without a `spec` (P021 comes first).
- Alternatives: count open-item examples.
- Should the spec pin this? no.

## C-17: Table cells and input texts
- Spec reference: REQ-SY-012, REQ-SU-003
- Situation: ambiguous
- What I chose: in a row's input, each non-empty input cell is spliced as written after `\|` is turned into `|` and the cell is trimmed. A header cell may not be empty. Only `\|` is an escape in a cell. A `?` under an input column is P009.
- Alternatives: keep backslashes.
- Should the spec pin this? no.

## C-18: Judge input details
- Spec reference: REQ-JU-001
- Situation: ambiguous
- What I chose: `answer` must be present (an explicit `null` is fine); `full` must be present (`null` is fine); `members` etc. are checked only when `full` is not null. `approx` needs numbers for `value` and `tol` of JSON type `number`; infinity from `1e400` is not rejected (OPEN-JU-002). A `result` or `audit` that `full` carries is compared only when `full` has no `error`.
- Alternatives: reject non-finite numbers.
- Should the spec pin this? no, open.

## C-19: Path lookup on own members
- Spec reference: REQ-OR-003, REQ-JU-002
- Situation: missing
- What I chose: only own members of an object count (so `constructor` or `__proto__` name nothing unless present), and an index must be canonical (`0`, `12`; not `01`, `-1`, `1.0`). `audit` reads into the audit text only as the first name of the path.
- Alternatives: inherited members.
- Should the spec pin this? no.

## C-20: Level `info` and codes the spec never defines
- Spec reference: REQ-RC-006
- Situation: missing
- What I chose: the checker never writes `info` diagnostics, and never writes T codes the spec does not define (T006, T015 to T018, T026).
- Alternatives: none.
- Should the spec pin this? no.

## C-21: Statement keywords and names are case sensitive
- Spec reference: REQ-SY-002
- Situation: ambiguous
- What I chose: `Note` is unknown (P002, as the example shows); clause keywords, platforms (`any`, `posix`, `windows`) and status words are case sensitive too (`Accepted` is T027, as an example shows).
- Alternatives: none.
- Should the spec pin this? no, the examples show it.

## C-22: The record name for record-level diagnostics
- Spec reference: REQ-RC-001, REQ-RC-003, REQ-RC-004
- Situation: ambiguous
- What I chose: P021 and P047 use the entry exactly as given (`.` when missing or `.`), and P046 uses the given name. A file record never gets P047.
- Alternatives: none.
- Should the spec pin this? no, the examples show it.

## C-23: Timing of reading standard input
- Spec reference: Driver protocol
- Situation: missing
- What I chose: the driver answers each line as soon as it is complete, in order, and a last line with no LF at end of input is answered too. Invalid UTF-8 is decoded with U+FFFD.
- Alternatives: read all input first.
- Should the spec pin this? no.
