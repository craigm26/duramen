# CHOICES

Choices made where SPEC.md is silent, ambiguous or contradicts itself.

## C-1: Which input lines are blank
- Spec reference: Driver protocol (blank lines), "whether other white space makes a line blank is open"
- Situation: ambiguous
- What I chose: a request line is blank when it holds only spaces, tabs and CRs (a CR so that CR LF input works); blank lines get no response. Any other line is parsed as JSON and, if that fails, gets `bad_request` with `id` null.
- Alternatives: only spaces and tabs (a lone `\r` line would then be `bad_request`); all of ECMAScript white space.
- Should the spec pin this? no, the spec already marks it open.

## C-2: Numbers in requests and records are binary64 floats
- Spec reference: REQ-SY-013, REQ-OR-003, "Results are compared as parsed JSON"
- Situation: missing
- What I chose: every JSON number I read is held as a float, and every number I write goes out the way `JSON.stringify` writes it (so `1.0` comes out `1`, `12345678901234567890` as `12345678901234567000`, `-0` as `0`). A request line holding `1e400` is read as infinity and is not rejected.
- Alternatives: keep integers as exact big integers in results.
- Should the spec pin this? no. It follows from "numbers compare as binary64" but a line saying results are written the way `JSON.stringify` writes them would help builders outside JavaScript.

## C-3: Unknown check kinds in `judge`
- Spec reference: REQ-JU-001, OPEN-JU-001
- Situation: missing
- What I chose: a check needs a string `path` and a `kind` member; a `kind` other than `eq` and `approx` is accepted as well-formed and never holds, so it is listed in `failed`. It is not a `bad_request`.
- Alternatives: `bad_request` for unknown kinds.
- Should the spec pin this? no, it is open.

## C-4: `#` lines at indent 3 under an `errors` clause
- Spec reference: REQ-SY-008, REQ-SY-003
- Situation: ambiguous
- What I chose: a line indented exactly three spaces under an `errors` clause gets P006 whether or not it starts with `#` (as for `text` P008, where `#` is text). From four spaces it is part of the condition, `#` included.
- Alternatives: treat a `#` line at indent 3 as a comment with no diagnostic.
- Should the spec pin this? yes, REQ-SY-008 says "including a line that starts with `#`" only for the four-space case.

## C-5: A `text` clause with words after its keyword
- Spec reference: REQ-SY-005
- Situation: ambiguous
- What I chose: P008 at the clause's line, and the clause is still the statement's `text` (its lines are read, a later `text` gets P052).
- Alternatives: drop the clause.
- Should the spec pin this? no.

## C-6: Statements and clauses of the rest of the language
- Spec reference: OPEN-RC-001, REQ-SY-002, REQ-CK-001
- Situation: missing
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` statements are accepted and their bodies ignored without a diagnostic. `returns` (on `op`) is accepted and ignored. `static` (on `req`) is accepted, ignored, and counts as standing in for an example, so T001 is not reported for that requirement. `duramen 0.2` has no checks beyond `0.1`.
- Alternatives: P002 for them; `static` not satisfying T001.
- Should the spec pin this? no, it is open.

## C-7: Table rows with the wrong number of cells, and bad cells
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a row with a different number of cells than the header gets P014 and its cells are not looked at. In any other row every cell is looked at and each bad cell gets its own diagnostic at the row's line.
- Alternatives: stop at the first bad cell of a row.
- Should the spec pin this? yes, "each bad cell its own diagnostic or one per row" is not stated.

## C-8: Header cell with a repeated name and a bad tolerance
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a cell is first tested for form (name, what follows it), then for a name that is already a column (both P013, which stops the table); only then is its tolerance judged (P010). So a repeated name with a bad tolerance gets P013 alone.
- Alternatives: report the P010 as well.
- Should the spec pin this? no.

## C-9: A table cell `?` in an input column
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: `?` is not JSON, so under an input field it gets P009. Under an expectation path (with or without a tolerance) it is the oracle's value.
- Alternatives: none sensible.
- Should the spec pin this? no.

## C-10: Which table rows expect an error
- Spec reference: REQ-CK-004, REQ-CK-005
- Situation: ambiguous
- What I chose: a table row expects an error when its `error` column holds a non-empty cell (an empty cell states nothing). A table with an `error` column but an empty cell in a row is checked against the operation like any other row.
- Alternatives: every row of a table with an `error` column.
- Should the spec pin this? yes.

## C-11: `example raw '...'` with a single quote only
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: the single-quoted form needs at least two characters, the first and last being `'`; `'` alone is P004.
- Alternatives: read it as an empty line.
- Should the spec pin this? no.

## C-12: Telling `input <path> from "<file>"` from a path
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: the line is the `from` form when its text ends with white space, `from`, white space and a complete JSON string; the path is everything before that (the last `from` wins). If the quoted part is not a valid JSON string, the whole text is read as a path (and so gets P049).
- Alternatives: P004 for a bad quoted file name.
- Should the spec pin this? no.

## C-13: What ends the text of an `input` line
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: any line at indent 3, 4 or 5, or a `#` line at any indent below six, ends the text (it is a line of the example); only comments at indent 0 and 2 (and P001, P007 lines) are skipped over. A `#` line indented six or more is text.
- Alternatives: comments at any indent are skipped inside a text.
- Should the spec pin this? no, REQ-SY-011 says it in the same words.

## C-14: Lines that get P001 or P007 inside a `text`
- Spec reference: REQ-SY-005, REQ-SY-001
- Situation: missing
- What I chose: they are dropped before the text is formed, as inside an input text: they neither end the text nor belong to it.
- Alternatives: they end the text.
- Should the spec pin this? yes, it is only said for `input` texts.

## C-15: Oracle runs: working folder, time, standard error
- Spec reference: REQ-OR-002, REQ-OR-004, OPEN-RQ-001
- Situation: missing
- What I chose: the request's files are written into a fresh temporary folder (names the file system cannot store are skipped), the oracle runs in the folder of the file that holds `oracle`, each run may take 30 seconds, then it is killed and counts as stopped (T020); its standard error is thrown away; its output is decoded as UTF-8 with replacement characters.
- Alternatives: other limits.
- Should the spec pin this? no, OPEN-RQ-001.

## C-16: `expect ... = ?` when there is no response at all
- Spec reference: REQ-OR-008, REQ-OR-005
- Situation: ambiguous
- What I chose: an example with no response gets T021 only. T025 is for a response that lacks the path. A response with `oracle_error` gets T022 only (as REQ-OR-006 says).
- Alternatives: T021 and T025 for each `?`.
- Should the spec pin this? yes (by an example).

## C-17: T024 and an example that states no expectation
- Spec reference: REQ-OR-007
- Situation: ambiguous
- What I chose: T024 is the warning for a response with an `error` member when the example (or table row) has no expectation of any path, an empty table cell being none.
- Alternatives: also for examples whose only expectations are `?`.
- Should the spec pin this? no.

## C-18: Which examples are run when a record has T-level errors
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: exactly the raw ones, those that expect an error, and those that name a declared operation, as REQ-OR-002 says; examples with T010 or T011 problems are still run.
- Alternatives: none.
- Should the spec pin this? no.

## C-19: Requirement IDs repeated (T007) and case IDs
- Spec reference: REQ-CK-002, REQ-SU-002
- Situation: ambiguous
- What I chose: `cases` only lists cases for a record without errors, and T007 is an error, so duplicate case IDs never appear. For `check`, examples of duplicate requirements still use `<ID>#<n>` ids, and two examples with one id get the same (first) response.
- Alternatives: number the examples of a duplicate across both.
- Should the spec pin this? no.

## C-20: T005 details
- Spec reference: REQ-CK-008
- Situation: ambiguous
- What I chose: "two or more of the codes" means two or more distinct codes; code matching is case sensitive and phrase matching is case insensitive for ASCII letters only; the text checked is the requirement's `text` lines joined with LF.
- Alternatives: count occurrences.
- Should the spec pin this? no.

## C-21: `superseded by <ID>`
- Spec reference: REQ-CK-009
- Situation: ambiguous
- What I chose: the ID is the one non-white-space word after exactly `superseded by `; a decision that names itself counts as naming a declared decision.
- Alternatives: T027 for self reference.
- Should the spec pin this? no.

## C-22: Entry that is both a file name prefix and absent
- Spec reference: REQ-RC-001, REQ-RQ-001
- Situation: ambiguous
- What I chose: an `entry` equal to a request file name is a file record; otherwise it is a folder, which exists when some file name starts with `entry/`. A folder record counts a name only if every part below the folder (the file name included) is free of a leading `.`, and no folder part is `build` or `node_modules`. A file name of `.duramen` itself therefore counts as hidden.
- Alternatives: none.
- Should the spec pin this? no.

## C-23: Clause lines under clauses that take none, and `#` lines
- Spec reference: REQ-SY-003
- Situation: ambiguous
- What I chose: a `#` line at indent 3 or more under an example or table is a comment wherever it stands; under a clause that takes no lines it is a comment too.
- Alternatives: none.
- Should the spec pin this? no.

## C-24: Lines under a malformed or repeated clause
- Spec reference: REQ-SY-003
- Situation: ambiguous
- What I chose: a clause that gets P004, P009, P017 and so on is still a clause for its lines (they get P006 as under any clause that takes none); only an unknown clause (P015) or a repeated once-only clause (P052) ignores its lines.
- Alternatives: ignore lines under every clause with a problem.
- Should the spec pin this? yes.

## C-25: Process
- Spec reference: none
- Situation: missing
- What I chose: `REGEN.json` names `python3 driver.py` (and `py -3 driver.py` for `win32`); the tests substitute a Python port of `echo.mjs` for the oracle and also run the real fixture when `node` is on the path.
- Alternatives: none.
- Should the spec pin this? no.
