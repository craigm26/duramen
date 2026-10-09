# CHOICES

Each entry is a place where SPEC.md or DECISIONS.md was silent, ambiguous or contradictory,
and what this build does about it. Entries are in the order the code meets them, roughly.

## C-1: The implementation folder's required contents
- Spec reference: none (SPEC.md says the folder "must contain" what it names, but names only REGEN.json)
- Situation: missing
- What I chose: The folder holds `REGEN.json` (with `"driver": "node src/serve.ts"`), `package.json` (with `test` and `serve` scripts and no dependencies), `src/` (the program and its `*.test.ts` files), `fixtures/echo.mjs` (the oracle from SPEC.md's Files section, verbatim), and this file and `BUILD_NOTES.md`.
- Alternatives: Put the program in `duramen.ts` at the top, or add a `bin/` folder with a `serve` entry point as D-001 hints (`duramen serve`).
- Should the spec pin this? yes. A builder cannot know what else "the implementation folder must contain" means without a list, and the phrase is in the PROMPT's own description of SPEC.md.

## C-2: The driver's command line
- Spec reference: Interface, Driver protocol; D-001
- Situation: ambiguous
- What I chose: The driver takes no arguments. D-001 names the command `duramen serve`, but no requirement says the driver must be started with a word, and REGEN.json's `driver` is the only thing the spec judges by. The entry point ignores extra arguments.
- Alternatives: Require a `serve` argument, as D-001's wording suggests.
- Should the spec pin this? no. REGEN.json already fixes how the driver is started.

## C-3: What makes a request line blank
- Spec reference: Driver protocol ("whether other white space makes a line blank is open")
- Situation: missing (explicitly left open)
- What I chose: A line is blank when it holds only spaces and tabs. Other white space (such as U+00A0) makes it a request line, which then gets bad_request.
- Alternatives: Treat every ECMAScript white space as blank, as REQ-SY-001 does for `.duramen` lines.
- Should the spec pin this? no. It is open, and the driver's choice is visible only on odd input.

## C-4: Statements and clauses that belong to the rest of the language
- Spec reference: REQ-SY-002; OPEN-RC-001
- Situation: contradictory. REQ-SY-002 gives P002 to a first word that is none of the core statements, yet names `type`, `edge`, `edgedef`, `property` and `evidence` as belonging to the rest of the language, which is open.
- What I chose: Those five words are recognized. Their statement and its body are ignored, with no diagnostic. Unknown words still get P002.
- Alternatives: P002 for them (the core reading), or reading them as far as the core can.
- Should the spec pin this? yes. Either a `duramen 0.1` record may contain them silently, or it must reject them; the spec should say which.

## C-5: `returns` and `static` clauses
- Spec reference: OPEN-RC-001; REQ-SY-007, REQ-SY-009
- Situation: contradictory. Both are named as belonging to the rest of the language (open), but REQ-SY-007 and REQ-SY-009 give P015 to any clause they do not take.
- What I chose: `returns` (under `op`) and `static` (under `req`) are accepted silently, and their lines are ignored. Other unknown clauses get P015.
- Alternatives: P015 for both, as the core rule says.
- Should the spec pin this? yes, for the same reason as C-4.

## C-6: P001 in an ignored statement body
- Spec reference: REQ-SY-001 (P001 applies to any line), REQ-SY-002 ("the lines of its body MUST be ignored")
- Situation: ambiguous
- What I chose: P001 is reported for a line with bad leading white space wherever it is, including under an unknown statement. Every other diagnostic under that statement is suppressed.
- Alternatives: Suppress P001 too, since the body is ignored.
- Should the spec pin this? unsure. REQ-SY-001 reads as a line rule, and REQ-SY-002 as a structure rule; they only conflict in this corner.

## C-7: Column-zero comments inside a body
- Spec reference: REQ-SY-002
- Situation: missing
- What I chose: A line at indent 0 that starts with `#` is skipped entirely. It does not end the current clause, so a text clause's lines after it still belong to it.
- Alternatives: End the clause, or treat it like an indented comment.
- Should the spec pin this? no.

## C-8: Trailing words after the version in `duramen`
- Spec reference: REQ-RC-003
- Situation: ambiguous
- What I chose: `duramen 0.1 extra` is a bad version: P023. The version is the whole rest of the line, and must be exactly `0.1` or `0.2`.
- Alternatives: Take the first word as the version and ignore the rest.
- Should the spec pin this? yes, since the spec says "states the version" and does not say whether extra words are allowed.

## C-9: Which versions count toward P047
- Spec reference: REQ-RC-003
- Situation: ambiguous
- What I chose: A file's read version is the version of its first `duramen` statement, if that version is `0.1` or `0.2`. P047 applies when the files of a record have different read versions. Later `duramen` statements never count.
- Alternatives: Count every valid `duramen` statement in every file.
- Should the spec pin this? no. The two readings agree on every example, and differ only in records with two `duramen` statements.

## C-10: The name of a spec or the words after a bad spec line
- Spec reference: REQ-SY-004
- Situation: missing
- What I chose: The spec name is the first word and is not checked. The spec's version is the second word and is not checked. A spec line with two words is correct; any other count is P021.
- Alternatives: Restrict names to ASCII letters, digits, `_` and `-`, as REQ-SY-007 does for input fields.
- Should the spec pin this? yes.

## C-11: IDs and titles with no ID
- Spec reference: REQ-SY-006
- Situation: missing
- What I chose: `req`, `open`, `decision` or `section` with no ID gets P005, as if the title were missing.
- Alternatives: A separate code for a missing ID.
- Should the spec pin this? no. P005 is the code for a malformed title line; no other fits.

## C-12: The `on` clause with nothing after it
- Spec reference: REQ-SY-009
- Situation: missing
- What I chose: `on` with no platform is P033, the same as an unknown platform.
- Alternatives: Treat it as `on any`, since an `on` clause is optional.
- Should the spec pin this? no.

## C-13: `audit` with a word other than `text`
- Spec reference: REQ-SY-007
- Situation: ambiguous
- What I chose: `audit json` gets P050, and the operation still declares an audit, so that a later `full` would carry one. Since P050 stops the checks, nothing downstream sees this.
- Alternatives: Do not declare the audit.
- Should the spec pin this? no. It is unobservable while the P050 stands.

## C-14: Tolerance paths: which tolerance counts for a repeated path
- Spec reference: REQ-SY-007; REQ-SY-007 Example 5
- Situation: contradictory. The rule says "one tolerance per path, a second gets P052"; Example 5 gives P018 (not P052) to later lines for a path whose earlier lines were invalid.
- What I chose: Only a valid tolerance registers its path. A later line for the path is then judged on its own.
- Alternatives: Register the path even when the first tolerance is invalid, as "a first once-only clause with a problem of its own still counts" (D-017) would suggest.
- Should the spec pin this? yes. Example 5 and D-017 disagree, and only one reading can hold.

## C-15: Input fields: duplicates and invalid fields
- Spec reference: REQ-SY-007
- Situation: ambiguous
- What I chose: An invalid field (P017) does not register its name. A field whose name is already registered gets P052 at its clause's line (not the field's own line, since fields in one clause share a line).
- Alternatives: Register invalid names too; report P052 on the field's own line within a clause.
- Should the spec pin this? no.

## C-16: An operation whose name is invalid
- Spec reference: REQ-SY-007
- Situation: missing
- What I chose: Its clauses are read (as the spec says), but it is not declared, so examples of that name get T009.
- Alternatives: Declare it under an empty name.
- Should the spec pin this? no. P031 stops the checks anyway.

## C-17: `example` with an op and no JSON, or a non-JSON op word
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: `example <op>` with nothing after the op is an example with no input. `example {}` takes `{}` as the operation's name and has no input, since the first word is the op.
- Alternatives: Treat a leading `{` as a missing op, and give P012.
- Should the spec pin this? no. Unlikely in practice.

## C-18: Expectations and input texts that a dropped example still has
- Spec reference: REQ-SY-010, REQ-SY-011
- Situation: ambiguous
- What I chose: A dropped example (its first line has a P problem) is not kept, but its lines are read. Lines that are valid are read for their own problems only, since a P problem stops the checks anyway. An input path that goes through a value that is not an object (P049) is judged only for examples that are kept, since the input is unknown otherwise.
- Alternatives: Judge the path against an empty object.
- Should the spec pin this? no. Reading errors stop the checks, so the only effect is which P codes appear.

## C-19: Solo responses
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: A solo run (a raw example, or one that omits `id`) has a response only when it writes exactly one non-blank line, which parses as a JSON object without a number too large to be finite. The line's `id` is not checked.
- Alternatives: Require the line's `id` to match the request's, as batch matching does.
- Should the spec pin this? yes. REQ-OR-002 says "the one line that run writes" but does not say what happens to a line that is not an object.

## C-20: Oracle timeout
- Spec reference: REQ-OR-004; OPEN-RQ-001
- Situation: missing (REQ-OR-004 requires a stop for taking too long, but no time is given, and OPEN-RQ-001 leaves running time open)
- What I chose: 10 seconds for one run of the oracle, whether a batch or a solo run. A run that takes longer is killed and reported as T020.
- Alternatives: A longer limit for big records; a per-example limit.
- Should the spec pin this? unsure. The spec leaves time open, so a builder's suite would only see this through T020 on a slow oracle.

## C-21: How the oracle is started, and where its files are
- Spec reference: REQ-OR-002 ("start it without a shell, in the folder of the file that holds the oracle statement")
- Situation: missing (how an oracle reads the record's other files is not said)
- What I chose: All files of the request are written to a fresh temporary folder, with their names as paths, and the oracle runs there in the folder of its statement's file. The first word of the command is run through the system's PATH, so `node` means the `node` on PATH. The folder is removed after the run.
- Alternatives: Run the oracle in a folder of only the record's own files, which would not carry `echo.mjs` (it is not a `.duramen` file) and so would not work.
- Should the spec pin this? yes, since a builder must know which files the oracle can see.

## C-22: A table whose op is malformed still gets line-level P006
- Spec reference: REQ-SY-012 ("nothing else in the table is checked" after P013; "Any other line under it ... MUST get P006 too")
- Situation: contradictory
- What I chose: Lines under a table with a bad op still get P006 for their own shape. Rows are not read further.
- Alternatives: Suppress P006 too, since "nothing else" covers it.
- Should the spec pin this? yes.

## C-23: Table header details
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: A header cell is split at its first `±` (or `+-`); the name is the text before it, trimmed. An input-field name is ASCII letters, digits, `_` and `-`, and is never one of the four expectation words followed by end or a dot. Two columns with the same name part (even if one has a tolerance) are a repeated column, P013.
- Alternatives: Treat `result.x ± 1` and `result.x` as different columns.
- Should the spec pin this? no.

## C-24: Input texts: trailing blank lines and the last line
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: Blank lines inside an input text are kept; trailing blank lines are dropped; every line ends with LF, including the last. A text with only blank lines has no text (P049).
- Alternatives: Keep the final line's LF out.
- Should the spec pin this? no. The examples pin the LF behaviour.

## C-25: A `from` file input after a bad path
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: If the path is malformed, the line gets P049 only and the file is not read. If the path is well formed but the file is missing or outside the record, P048.
- Alternatives: Check the file as well.
- Should the spec pin this? no.

## C-26: Case IDs and the oracle's answer for a table row
- Spec reference: REQ-SU-002
- Situation: missing
- What I chose: A table row's case has the same ID form as an example, numbered in the requirement's order of examples and rows together. Its line is built from the non-empty input cells, written as they stand.
- Alternatives: Number rows apart from examples.
- Should the spec pin this? no. The spec's own example (REQ-SU-002, Example 1) already numbers them together.

## C-27: Which examples the oracle runs when they are malformed
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: An example is run when its op is declared, when it expects an error (a path of `error`), or when it is raw. Otherwise it is not run. Its request line is still built the same way (with the spec's request members, since the op is unknown).
- Alternatives: Run only declared ops.
- Should the spec pin this? no. The spec states the rule in the same words; the choice is only how an undeclared op's request members are built.

## C-28: What counts as "expects no expectation" for T024
- Spec reference: REQ-OR-007
- Situation: ambiguous
- What I chose: An example states an expectation when it has any expect line, of any kind. A table row with no expectation cell states none.
- Alternatives: Count only `expect` lines and not table cells.
- Should the spec pin this? no.

## C-29: T004 and quotations
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: A quotation is a pair of `"..."`, `“...”` or backquotes on one line. An unpaired quote is not a quotation, so a MUST after it counts.
- Alternatives: Treat an unpaired quote as opening a quotation that runs to the end of the line.
- Should the spec pin this? no. The spec's own examples match this reading.

## C-30: T005 names and phrases
- Spec reference: REQ-CK-008
- Situation: ambiguous
- What I chose: Codes are matched case-sensitively, as whole words not next to a letter, digit, `_` or `-`. Phrases are matched case-insensitively, as whole words, with any white space between their words (line breaks included).
- Alternatives: Case-insensitive code matching.
- Should the spec pin this? no.

## C-31: Diagnostics of the oracle that are not about one example
- Spec reference: REQ-OR-004
- Situation: missing
- What I chose: A batch run that cannot start, exits badly or times out gets one T020 at the oracle statement's line, not one per example. Each example without a response gets T021.
- Alternatives: One T020 per example in the batch.
- Should the spec pin this? no. The spec's own Example 1 (REQ-OR-004) pins one T020 for a batch.

## C-32: An error expectation with a non-string value
- Spec reference: REQ-CK-005
- Situation: missing
- What I chose: `expect error = <value>` where the value is not a string is T023 (no declared code is a non-string).
- Alternatives: Skip the check for non-string values.
- Should the spec pin this? no.
