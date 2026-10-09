# Choices

## C-1: RC-006 example 1 line numbers disagree with the displayed file
- Spec reference: REQ-RC-006, example 1
- Situation: contradictory
- What I chose: Count lines literally. The displayed `a.duramen` has `frobnicate` on lines 4 and 5, but the expected output says 5 and 6. My test uses a file with one more blank line, which gives the expected output.
- Alternatives: Add a phantom line before the first blank line; count blank lines twice.
- Should the spec pin this? yes, the example text or its expected lines is probably wrong (every other example counts literally).

## C-2: Temporary directory for the oracle
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: The files of a request are written to a fresh directory under the OS temp dir, and the oracle runs in the directory of the file with the `oracle` statement. The directory is deleted afterwards. The `node` command word is replaced by the running Node binary (`process.execPath`).
- Alternatives: Write inside the implementation folder; resolve `node` through PATH.
- Should the spec pin this? no, it is an implementation detail.

## C-3: Oracle timeout
- Spec reference: REQ-OR-004
- Situation: missing
- What I chose: 30 seconds per oracle run, then SIGKILL and T020.
- Alternatives: Shorter or configurable.
- Should the spec pin this? unsure, the spec says "for taking too long" without a limit (OPEN-RQ-001 covers time).

## C-4: Blank lines in the driver
- Spec reference: Driver protocol
- Situation: ambiguous (declared open)
- What I chose: A line is blank only when it is empty or holds spaces and tabs; anything else (even `\r` alone) gets a response (`bad_request`).
- Alternatives: Treat all white space as blank.
- Should the spec pin this? no, declared open.

## C-5: Comment-looking lines at indent 1 or 3+ with no clause
- Spec reference: REQ-SY-003
- Situation: ambiguous
- What I chose: A line indented one space is always P007, even if it starts with `#`. A line indented 3+ with no clause before it is P006 even if it is a `#` line. Under a clause that takes no lines, `#` lines at any indent are comments.
- Alternatives: Treat `#` lines as comments at every indent.
- Should the spec pin this? yes, it is a corner a builder cannot infer.

## C-6: Lines under an errors clause
- Spec reference: REQ-SY-008
- Situation: ambiguous
- What I chose: Continuation lines need 4+ spaces; a line at 3 spaces under an errors clause is P006. `<code> when` with no condition text on the clause line but a continuation line is accepted (the condition is the clause line's remainder plus continuation lines). Comment lines (`#`) at 4+ spaces are part of the condition.
- Alternatives: P019 when the clause line itself has nothing after `when`.
- Should the spec pin this? yes.

## C-7: Parsing of titles after an ID
- Spec reference: REQ-SY-006
- Situation: ambiguous
- What I chose: After the ID, text not starting with `"` is P005. A JSON string literal that is malformed (bad escape, unterminated) is P004. A valid literal followed by white space and more text is P005; a valid literal followed at once by other characters (`"A "quoted" title"`) is P004. For `title`/`rejected` clauses anything but one JSON string is P004.
- Alternatives: P005 for every trailing-text case.
- Should the spec pin this? yes, examples 2 and 5 only fix two points of the rule.

## C-8: Example header forms
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: The op of `example <op>` is the first word. `example raw` with no argument, or an argument that is neither a JSON string nor `'…'` with two quotes, is P004. A raw line is not parsed as JSON (raw lines exist to send broken requests). Raw JSON-string values containing LF or CR are P026. `omit` with no names is P011. Example sub-lines must be indented exactly 4 spaces (other indents are P006), except input text. `#` lines are comments at any indent there.
- Alternatives: P012 for bad raw forms.
- Should the spec pin this? yes.

## C-9: Expect line forms
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: A path is words (letters, digits, `_`, `-`) or JSON strings separated by dots. A line `expect` that does not fit `<path> <=|≈|~> ...` is P011. `≈`/`~` without a `±`/`+-` part, or with a bad number/tolerance, is P010. The checks' `path` is the segments joined by dots.
- Alternatives: P009 for a missing `±`.
- Should the spec pin this? no.

## C-10: `input` lines
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: The text block after any `input` line is consumed (indent 6+ or blank) even if the line has an error. A malformed `from "<file>"` string is P004; a malformed path is P049. `from` paths are resolved relative to the example's file folder, `..` allowed within the request's file tree; a file outside the tree or missing is P048. A path through an existing non-object is P049. If the example's own JSON is invalid, path checks through values are skipped.
- Alternatives: P049 for a bad `from` string.
- Should the spec pin this? no.

## C-11: Table details
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: A row line needs 4+ spaces of indent and to start with `|`. Cells are split on unescaped `|`, only `\|` is an escape, and text after the last `|` that is only white space is not a cell. A header cell that is not a word-field name or an expectation path is P013, and then the column is skipped. A header tolerance that is bad is P010 and the column counts as having none. Separator rows are skipped anywhere. When the op is missing or has several words, or there are fewer than two rows, P013 is at the table line (and with fewer than two rows nothing else is checked). An `id`/`error` column counts as an expectation. A column `result` with `?` takes the oracle's value.
- Alternatives: Report header P013 at the table line.
- Should the spec pin this? no (example 2 pins the lines).

## C-12: Ops and clauses with unspecified form
- Spec reference: REQ-SY-004, REQ-SY-007
- Situation: missing
- What I chose: `contract`, `source`, `result` and `audit` clauses accept any text (no code). `audit` followed by anything is audit. The first `op` of a name wins; a repeated name is not an error. Several `request` clauses on one statement are merged, later ones replacing earlier members. `spec` with a bad header still counts as a spec statement (no extra P021). A second `spec`/`oracle`/`errors` is read for its own errors but ignored.
- Alternatives: Errors for duplicate ops.
- Should the spec pin this? yes for duplicate op names.

## C-13: What counts as "an example" and which examples run
- Spec reference: REQ-OR-001, REQ-OR-002
- Situation: ambiguous
- What I chose: T019 counts the examples and table rows of requirements only (not open items). An example is run when it is raw, expects an error (any `expect error`/`error.…` line or column), or names a declared op. Table cells under `error` count as expecting an error.
- Alternatives: Count open-item examples for T019.
- Should the spec pin this? no.

## C-14: Matching oracle responses
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: Response lines that are not JSON objects, or have no string `id`, are ignored in shared runs. The first response for an `id` wins. For a solo run the one non-blank output line must be a JSON object, else the example gets T021. Output lines are split at LF and blank lines are not counted.
- Alternatives: Last response wins.
- Should the spec pin this? no.

## C-15: T-check details
- Spec reference: REQ-CK-004..009
- Situation: ambiguous
- What I chose:
  - T004 is one per text (all `text` clauses of a spec, section or note are checked separately and at the statement line); quotations are removed line by line with `"…"`, `“…”` and `` `…` ``.
  - T005 matches codes as whole words (not touching letters, digits, `_`, `-`) and phrases with `\b`; each `text` clause is judged on its own.
  - T023 applies to `expect error = <value>` where the path is exactly `error`; a non-string value is also T023; `= ?` is skipped.
  - T027: a status's first word must be one of the seven words (case-sensitive); `superseded` must be exactly `superseded by <ID>` with a declared ID. An empty `source` counts as none (T013).
  - T028 uses the first status word even when T027 is also raised; a decision cited twice is reported twice.
  - T010/T011 compare against the example's final input object, or a table row's non-empty input cells.
- Alternatives: Case-insensitive status words.
- Should the spec pin this? no, except T023 for non-string values.

## C-16: Numbers and tolerance comparison
- Spec reference: REQ-OR-003
- Situation: ambiguous
- What I chose: Values are compared as JavaScript numbers (doubles), approximate checks pass when `|a - b| <= tol`.
- Alternatives: Exact decimal comparison.
- Should the spec pin this? unsure, "numbers compare exactly" could mean arbitrary precision.

## C-17: Names and entry
- Spec reference: REQ-RQ-001, REQ-RC-001
- Situation: ambiguous
- What I chose: An `entry` that equals a file name is a file record; one that is the folder of some file is a folder record (even if it has no `.duramen` file, which gives P046); anything else is P046. P021/P047 are placed at line 1 of the entry as given (`.` for the whole tree). The hidden-name and `build`/`node_modules` rules are applied to the path relative to the entry folder.
- Alternatives: Apply the rules to the whole path.
- Should the spec pin this? yes.

## C-18: `internal_error`
- Spec reference: OPEN-RQ-004
- Situation: missing (open)
- What I chose: Unexpected exceptions answer `{"id": <id>, "error": "internal_error"}` and print the stack to standard error, like the reference.
- Alternatives: Crash.
- Should the spec pin this? no.

## C-19: `P001` lines are dropped before everything else
- Spec reference: REQ-SY-001
- Situation: ambiguous
- What I chose: A line with bad leading white space gets P001 and then vanishes: it ends no text block and does not count as blank. P001 is also reported inside the bodies of unknown statements.
- Alternatives: Treat as blank for text blocks.
- Should the spec pin this? no.
