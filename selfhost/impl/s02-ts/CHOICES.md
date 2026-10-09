# Choices

## C-1: Driver command and layout
- Spec reference: Driver protocol
- Situation: missing
- What I chose: `REGEN.json` is `{"driver": "node driver.ts"}`; `driver.ts` streams stdin, answers each complete line as it arrives, and answers a last line that has no LF at end of input.
- Alternatives: reading all of stdin first; a per-platform driver object.
- Should the spec pin this? no, the driver is the implementation's own business.

## C-2: Blank lines at the protocol level
- Spec reference: Driver protocol (OPEN about other white space)
- Situation: ambiguous
- What I chose: only lines of spaces and tabs (or empty) are blank. A line holding only `\r` or other white space is parsed as JSON and gets `bad_request`.
- Alternatives: treat all `\s` as blank.
- Should the spec pin this? no, it is stated as open.

## C-3: Time limit for the oracle
- Spec reference: REQ-OR-004, OPEN-RQ-001
- Situation: missing
- What I chose: each oracle run is stopped after 10 seconds, which is reported as T020.
- Alternatives: a longer or shorter limit; no limit.
- Should the spec pin this? unsure; a suite author with a slow oracle may want to know the limit.

## C-4: Oracle files live in a temporary folder
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: the request's files are all written to a fresh temp folder (`os.tmpdir()`), the oracle runs there in the folder of the file holding `oracle`, and the folder is removed afterwards. It is created only when an oracle must run.
- Alternatives: run in the real working directory; write only `.duramen` files and referenced ones.
- Should the spec pin this? no.

## C-5: What counts as white space
- Spec reference: REQ-SY-001
- Situation: ambiguous
- What I chose: JavaScript's `\s` (so a no-break space is white space at the start of a line, giving P001, as an example shows, and white space at the end is stripped).
- Alternatives: only space and tab at the end of lines.
- Should the spec pin this? yes, since "white space" decides P001 versus P002 for odd characters.

## C-6: Bodies of statements of the rest of the language
- Spec reference: OPEN-RC-001, REQ-SY-002
- Situation: missing
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` are known statements; their clauses and lines are ignored without any diagnostic.
- Alternatives: P015 on their clauses; reading them.
- Should the spec pin this? no (open).

## C-7: A lone `"` as a title
- Spec reference: REQ-SY-006
- Situation: ambiguous
- What I chose: a title of just `"` starts and ends with `"`, so it is P004 (not JSON), not P005.
- Alternatives: P005 for fewer than two characters.
- Should the spec pin this? no.

## C-8: Missing ID with `req`, `open`, `decision`, `section`
- Spec reference: REQ-SY-006
- Situation: missing
- What I chose: a statement with nothing after the keyword, or an ID and no title, gets P005.
- Alternatives: P004; a separate code.
- Should the spec pin this? no.

## C-9: `audit` with an argument other than `text`
- Spec reference: REQ-SY-007
- Situation: missing
- What I chose: P015 at the line (`audit foo`).
- Alternatives: P018, P017, accepting any text.
- Should the spec pin this? yes, no code is named for it.

## C-10: Empty `input` clause, empty fields, trailing comma
- Spec reference: REQ-SY-007
- Situation: ambiguous
- What I chose: every empty field (including the one an empty `input` clause holds, or one left by a trailing comma) is P017, one per field, at the clause's line. Only double quotes are quotes when splitting fields; backslash escapes work inside them.
- Alternatives: allowing an empty list; treating single quotes as quotes.
- Should the spec pin this? no.

## C-11: Duplicate `input` field names, several `input` clauses, several `request`/`omit` lines
- Spec reference: REQ-SY-007, REQ-SY-010
- Situation: missing
- What I chose: several `input` clauses add their fields together and duplicate names are not reported. Several `request` lines of an example are merged in order (a member set again keeps its place); several `omit` lines add up.
- Alternatives: P052 for repeats.
- Should the spec pin this? yes, REQ-SY-003 lists the once-only clauses of `op` but an example's lines are silent.

## C-12: `oracle` and `source` details
- Spec reference: REQ-SY-004
- Situation: missing
- What I chose: the `source` clause of `oracle` may repeat and its content is not examined; `contract` text is not examined.
- Alternatives: P052 on repeats; requiring content.
- Should the spec pin this? no.

## C-13: A statement that fails to read is still registered
- Spec reference: REQ-RC-004, REQ-SY-004
- Situation: ambiguous
- What I chose: a `spec` with bad words (P021) still counts as the spec (no extra "no spec" P021) and a second one still gets P044; the body of a second `spec`, `oracle` or `errors` is read normally.
- Alternatives: ignoring a malformed statement entirely.
- Should the spec pin this? no.

## C-14: Which `duramen` statement states the version
- Spec reference: REQ-RC-003
- Situation: ambiguous
- What I chose: a file with any `duramen` statement does not get P020. Only the first statement can give the file's version (if it is `0.1` or `0.2`); a later one is P023. Files are compared for P047 only by those versions. The statement may be anywhere in the file.
- Alternatives: P020 as well as P023 when the version is bad.
- Should the spec pin this? yes (OPEN-RC-002 only covers placement).

## C-15: `omit` list syntax
- Spec reference: REQ-SY-010
- Situation: missing
- What I chose: names are split on commas and white space; empty names are dropped; an `omit` with no names is accepted.
- Alternatives: P011 for an empty list.
- Should the spec pin this? no.

## C-16: `expect` without an operator
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: after the path, anything other than `=`, `≈` or `~` is P011 (`expect result`, `expect result == 1` is P009 because the value after `=` is not JSON). `expect = 1` has an empty path, which is allowed. A `≈` line is P010 when the number, the sign or the tolerance (negative) is wrong. The `±`/`+-` separator may touch the numbers.
- Alternatives: P011 for an empty path.
- Should the spec pin this? no.

## C-17: A raw `'…'` line must end with `'`
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: `example raw '…'` needs the rest to start and end with `'`; the text between is the line. Anything else is P004.
- Alternatives: taking the text up to the last `'` and ignoring what follows.
- Should the spec pin this? no.

## C-18: Order of P-codes for a bad `input … from` line
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: one diagnostic per `input` line: a bad path is P049, then an unreadable or outside file P048, then a path through a non-object P049. A form is `from` only when the line ends with `from` and a well-formed JSON string. Text lines at indent 6 or more under a `from` line are each P006. A text block is the run of blank or 6+ indented lines straight after the `input` line; a line at 5 spaces ends it and is P006, and later 6+ lines are P006 too. Arrays count as "not an object" for paths. Input texts are used as given (no BOM or line-ending changes in files read with `from`).
- Alternatives: several diagnostics per line.
- Should the spec pin this? no.

## C-19: Table cells and rows
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a final empty piece after the last `|` is dropped; an empty cell between two `|` is a cell. A P013 header problem is reported at the header row's line, and the structure problems (no op, several ops, too few rows) at the `table` line. Separator rows are skipped anywhere. A header cell is an expectation path when it is `result`, `audit`, `error` or `id` optionally followed by `.` and anything without spaces; otherwise it must be a word (letters, digits, `_`, `-`; any Unicode letter or digit). A row with any bad cell is dropped after reporting. Table rows always have an `input` (`{}` when every input cell is empty).
- Alternatives: no `input` member for rows without input cells.
- Should the spec pin this? yes for the last point: "an example written `example <op>` has no input" does not say what a table row with no input cells sends.

## C-20: Open items
- Spec reference: REQ-SY-009, REQ-CK-007
- Situation: ambiguous
- What I chose: `example` and `table` clauses of an `open` item are not read at all (no P diagnostics for their content, lines under them ignored); each gets only T003.
- Alternatives: reading them and reporting P codes too.
- Should the spec pin this? yes; the example with `{not json` shows only T003 but the text does not say so.

## C-21: `text` clause details
- Spec reference: REQ-SY-005
- Situation: ambiguous
- What I chose: a `text` line indented three spaces is P008 and dropped (even if it starts with `#`); trailing white space is already stripped; blank lines inside are kept as empty lines.
- Alternatives: keeping the dropped line.
- Should the spec pin this? no.

## C-22: Errors list conditions
- Spec reference: REQ-SY-008
- Situation: ambiguous
- What I chose: a clause with a bad shape (P019) still has its continuation lines read (indent 3 is P006). The condition for T004 is the text after `when` plus the continuation lines, each tested alone against the quotation rule.
- Alternatives: ignoring lines under a P019 clause.
- Should the spec pin this? no.

## C-23: Decision status and source
- Spec reference: REQ-CK-009
- Situation: ambiguous
- What I chose: a status starts with a word when it begins with it and the next character is not a letter, digit or `_`. T028 and T027 are independent, so `status superseded` (no `by`) gets T027 and also T028 when cited. An empty `source` or `status` clause counts as none for T013, and an empty status is T027.
- Alternatives: T028 only for valid statuses.
- Should the spec pin this? no; the spec's example already shows T027 with T028.

## C-24: Whole words
- Spec reference: REQ-CK-006, REQ-CK-008
- Situation: ambiguous
- What I chose: obligation words are whole when not next to a letter, digit or `_` (a hyphen does not join them). Codes in T005 are whole when not next to a letter, digit, `_` or `-`. Quotations are matched left to right, one line at a time, with the first opener winning.
- Alternatives: hyphen joins obligation words.
- Should the spec pin this? yes for the hyphen in obligation words.

## C-25: Which examples are run, and T009–T011 on dropped data
- Spec reference: REQ-CK-004, REQ-OR-002
- Situation: ambiguous
- What I chose: examples run are raw ones, ones with an expectation whose path is exactly `error`, and ones of a declared operation (the first declaration when an op is declared twice). A table cell under `error` makes a row an error example. A `T010`/`T011` check uses the input after input lines are applied.
- Alternatives: none notable.
- Should the spec pin this? no.

## C-26: Oracle responses
- Spec reference: REQ-OR-002, REQ-OR-005
- Situation: ambiguous
- What I chose: a solo run's response is its single non-blank output line, which must be a JSON object, else no response. Other lines are matched by `id` as stated. A run that cannot start gets T020; a failed run (non-zero status, signal, timeout) also does, and EPIPE on writing to the oracle's input alone is not a failure.
- Alternatives: requiring a string `id` for solo responses.
- Should the spec pin this? no.

## C-27: When the oracle response has `oracle_error` or no expectation
- Spec reference: REQ-OR-006, REQ-OR-007
- Situation: ambiguous
- What I chose: `oracle_error` wins: T022 only (no T024, no T025). T024 needs zero expectations and an `error` member.
- Alternatives: none notable.
- Should the spec pin this? no.

## C-28: Request member order and integer-like keys
- Spec reference: REQ-SU-003
- Situation: ambiguous
- What I chose: members of `request` values are parsed with `JSON.parse`, so a key like `"2"` sorts ahead of other keys in the written line (the ECMAScript rule, which the spec names for input lines anyway). Large numbers lose precision as in `JSON.stringify`.
- Alternatives: a hand-made JSON reader that keeps order and spelling.
- Should the spec pin this? unsure.

## C-29: Tolerance and approximate checks
- Spec reference: REQ-OR-003, REQ-SU-004
- Situation: ambiguous
- What I chose: `|actual − number| <= tolerance` in binary64 arithmetic; `value` and `tol` in checks are the numbers parsed from the text.
- Alternatives: decimal arithmetic.
- Should the spec pin this? no.

## C-30: Paths
- Spec reference: REQ-OR-003
- Situation: ambiguous
- What I chose: a path is split at every dot; an array index must be canonical decimal (no leading zeros, no sign); `audit.<path>` parses the `audit` string as JSON (absent if it is not a string or not JSON). Members are looked up as own properties only.
- Alternatives: none notable.
- Should the spec pin this? no.

## C-31: Duplicate IDs after T007
- Spec reference: REQ-CK-002, REQ-OR-002
- Situation: missing
- What I chose: duplicate requirement IDs keep running; examples whose IDs collide take the first response with that id.
- Alternatives: skipping them.
- Should the spec pin this? no.

## C-32: Folder record naming
- Spec reference: REQ-RC-001
- Situation: ambiguous
- What I chose: an entry that names a file wins over a folder of the same name (names that clash are refused earlier anyway). A folder record lists files whose any path part below the folder starts with `.`, and whose folder parts are `build` or `node_modules`, as excluded; the entry folder itself can be named `build`.
- Alternatives: none notable.
- Should the spec pin this? no.

## C-33: Internal failures
- Spec reference: OPEN-RQ-004
- Situation: missing
- What I chose: as the reference, `{"id": …, "error": "internal_error"}` with details on standard error.
- Alternatives: none.
- Should the spec pin this? no (open).
