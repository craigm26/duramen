# CHOICES

## C-1: Oracle files are written to a temporary folder
- Spec reference: REQ-OR-002, REQ-RQ-001
- Situation: missing
- What I chose: a record exists only inside the request, but the oracle is a real command run "in the folder of the file that holds the `oracle` statement". So when an oracle has to run, every file of the request is written under a fresh folder in the OS temp directory, the command is started there (in the oracle file's folder), and the folder is removed afterwards. A command whose first word is `node` is started with the running Node binary (`process.execPath`), so it does not depend on `PATH`.
- Alternatives: a folder inside the implementation folder; running with `PATH` lookup only.
- Should the spec pin this? yes, the spec never says where the files of a request are materialised, or that `node` must resolve.

## C-2: Oracle time limit
- Spec reference: REQ-OR-004, OPEN-RQ-001
- Situation: missing
- What I chose: 20 seconds per oracle run; a run that exceeds it is killed (SIGKILL) and reported as T020, keeping the responses that arrived.
- Alternatives: no limit; a shorter limit.
- Should the spec pin this? no, "for taking too long" is deliberately open.

## C-3: Blank request lines
- Spec reference: Driver protocol
- Situation: ambiguous
- What I chose: a request line is blank when it holds only spaces, tabs and CR; other white-space-only lines get a `bad_request` response with `id` null.
- Alternatives: any `\s`-only line blank; CR not blank.
- Should the spec pin this? no, it is stated open.

## C-4: Statement keywords of the rest of the language
- Spec reference: REQ-SY-002, OPEN-RC-001
- Situation: missing
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` statements are accepted without any diagnostic and their bodies are ignored (not even P006/P007/P015 inside them; P001 still applies, being lexical).
- Alternatives: read them with some clause set.
- Should the spec pin this? no, open.

## C-5: Header with no ID or no title
- Spec reference: REQ-SY-006
- Situation: ambiguous
- What I chose: `section`/`req`/`open`/`decision` with nothing after the keyword gets P005 (only), as a missing title does.
- Alternatives: an additional diagnostic for the missing ID.
- Should the spec pin this? yes, an example of a bare `req` would settle it.

## C-6: Comments between lines of a text block
- Spec reference: REQ-SY-003, REQ-SY-005
- Situation: ambiguous
- What I chose: a comment at indent 0 or 2 inside a `text` clause is skipped and the text goes on afterwards (as REQ-SY-011 says for input texts). A P001 line is dropped from a text as well.
- Alternatives: a comment ends the text clause.
- Should the spec pin this? yes, REQ-SY-005 says nothing about it.

## C-7: A `text` clause with words after the keyword
- Spec reference: REQ-SY-005
- Situation: ambiguous
- What I chose: it gets P008 but is still a `text` clause: the lines under it are read as its text, and it counts as the statement's one `text` (a second gets P052, without P008).
- Alternatives: dropping the clause and its lines.
- Should the spec pin this? no, example SY-003-6 settles the P052 side.

## C-8: Comment lines at indent 3 to 5 inside an example
- Spec reference: REQ-SY-010, REQ-SY-011
- Situation: ambiguous
- What I chose: a comment (starts with `#`) at any indent is never P006, but a comment at indent 3, 4 or 5 is a line of the example, so it ends the text of a preceding `input` line, while a comment at indent 6 or more directly after an `input` line is part of its text (and is skipped after an `input ... from` line).
- Alternatives: comments never end an input text.
- Should the spec pin this? yes.

## C-9: Finding `from` in an `input` line
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: the first white-space-delimited `from` after which the rest of the line is a JSON string splits the line into path and file; if there is none, the whole rest is the path (a text form). A path that has no text lines at all, or only blank lines, gets P049.
- Alternatives: the last `from`; a regular expression anchored at the end.
- Should the spec pin this? unsure, only paths holding the word `from` in quotes are affected.

## C-10: A `from` name that leaves and re-enters the record
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: only the final resolved name is tested against the record's folder (`..` above the root of the request is always outside). `../r/t.txt` from inside folder `r` is therefore found.
- Alternatives: any step outside the record's folder is P048.
- Should the spec pin this? unsure.

## C-11: Table cells and escapes
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: in a table row `\|` becomes `|` in the cell; every other backslash is kept. A trailing empty piece after a final `|` is dropped. A row of only `|` is a separator (so `|` alone is skipped). Cells are trimmed with ECMAScript white space.
- Alternatives: `\\` as an escape of the backslash.
- Should the spec pin this? yes (`\\|`).

## C-12: Table header with a tolerance on an input field
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: the name still claims the column (it is an input field) and the cell gets P010 only; a column named `id`, `result`, `audit` or `error` (or `x.` followed by a path) is an expectation path even when the operation has an input field of that name.
- Alternatives: the input field wins.
- Should the spec pin this? yes, the sentence "also when the operation declares an input field of that name" can be read both ways.

## C-13: Oracle command words
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: a command that is only white space cannot be started (T020); a lone `\` before a non-quote is literal inside `"…"`; `'…'` has no escapes.
- Alternatives: none worth listing.
- Should the spec pin this? no.

## C-14: `full.audit` with a non-string audit
- Spec reference: REQ-SU-005, REQ-JU-001
- Situation: ambiguous
- What I chose: `full.audit` is written only when the operation declares an audit and the response's `audit` is a string, since judge requires a string.
- Alternatives: copy any value.
- Should the spec pin this? no.

## C-15: Unknown check kinds in `judge`
- Spec reference: REQ-JU-001, OPEN-JU-001
- Situation: missing
- What I chose: a check with a string `path` and a string `kind` other than `eq` or `approx` is accepted (any other members) and counts as not met; a non-string `kind` is `bad_request`.
- Alternatives: `bad_request` for unknown kinds.
- Should the spec pin this? no, open.

## C-16: Tolerance on a result with differing shapes
- Spec reference: REQ-JU-004
- Situation: ambiguous
- What I chose: the result is compared recursively; a tolerance path applies only where both values are numbers; objects need the same member set and arrays the same length. Paths join keys with `.` without escaping.
- Alternatives: none.
- Should the spec pin this? no.

## C-17: Duplicate IDs and case ids
- Spec reference: REQ-CK-002, REQ-SU-002
- Situation: ambiguous
- What I chose: duplicate requirement IDs are only T007 (hence no suite); in the oracle run, responses match by case id and the first response with an id is used for all examples carrying it.
- Alternatives: none.
- Should the spec pin this? no.

## C-18: Which `request` members an operation overrides
- Spec reference: REQ-SU-003
- Situation: ambiguous
- What I chose: an operation with a `request` clause uses only its members (the spec's are not merged in); an operation without one, or an undeclared operation, gets the spec's.
- Alternatives: merge.
- Should the spec pin this? no, "replace" and the example decide it.

## C-19: Reading a record with an unreadable name
- Spec reference: OPEN-RQ-003
- Situation: missing
- What I chose: a file the temp folder cannot hold is skipped silently when materialising files for the oracle.
- Alternatives: report T020.
- Should the spec pin this? no, open.

## C-20: Paths in `expect` that contain odd characters
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: an `expect` path is the longest prefix without white space, `=`, `≈` or `~`; the operator that follows may be separated from it by white space; anything else after the path is P011.
- Alternatives: P009 for a missing operator.
- Should the spec pin this? no, example SY-010-2 settles `expect result` (P011).
