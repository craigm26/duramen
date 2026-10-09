# Choices

## C-1: The statements of the rest of the language
- Spec reference: OPEN-RC-001, REQ-SY-002
- Situation: missing
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` are accepted as statements and ignored together with their bodies, with no diagnostic.
- Alternatives: report P002 for them; read their clauses.
- Should the spec pin this? no, it is declared open.

## C-2: Where the `duramen` statement may stand
- Spec reference: OPEN-RC-002
- Situation: missing
- What I chose: it may stand anywhere in a file. The first `duramen` statement of a file decides the file's version; P020 is given only when a file has none at all.
- Alternatives: require it first.
- Should the spec pin this? no, it is declared open.

## C-3: A `duramen` statement with other than one word after it
- Spec reference: REQ-RC-003
- Situation: ambiguous
- What I chose: `duramen` alone (Example 5) and `duramen 0.1 extra` both get P023 (one word is wanted, and it must be 0.1 or 0.2).
- Alternatives: ignore extra words.
- Should the spec pin this? yes, for the extra-words case.

## C-4: A file's version for P047
- Spec reference: REQ-RC-003
- Situation: ambiguous
- What I chose: a file's version is that of its first `duramen` statement if it is one of 0.1 and 0.2; a file with no valid version takes no part in P047.
- Alternatives: look at every statement.
- Should the spec pin this? no, it follows from "not judged again".

## C-5: Indent-0 comments between a statement's lines
- Spec reference: REQ-SY-002
- Situation: ambiguous
- What I chose: a `#` line at indent 0 is skipped wherever it is and does not end the body of the statement before it.
- Alternatives: let it end the body.
- Should the spec pin this? unsure; no example shows it.

## C-6: The `example raw '<line>'` form
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: the argument must start and end with `'` and be at least two characters long, else P004. Anything after the last `'` is therefore P004. `example raw ''` is an empty line.
- Alternatives: allow text after the closing quote.
- Should the spec pin this? yes, text after the last `'`.

## C-7: A body line under an example that is a comment at another indent
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: any line under an example whose first non-space character is `#` is a comment, at any indent of three or more (outside input texts).
- Alternatives: comments only at indent 4.
- Should the spec pin this? no.

## C-8: `input` lines that are in error still consume their text
- Spec reference: REQ-SY-011
- Situation: missing
- What I chose: an `input <path>` line with a bad path (P049) or in a raw example (P022) still takes the consecutive lines indented six or more as its text, so they do not add P006s. A `from` line takes no text.
- Alternatives: report the text lines as P006.
- Should the spec pin this? yes.

## C-9: How a `from` line is recognised
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: the first occurrence of white space, `from`, white space and a quote such that the rest of the line is a JSON string, with a non-empty path before it. A `from` with a bad quoted string is an ordinary `input <path>` line (so P049).
- Alternatives: the last `from`.
- Should the spec pin this? no.

## C-10: Resolving `from` files
- Spec reference: REQ-SY-011, REQ-RC-001
- Situation: ambiguous
- What I chose: the name is joined to the folder of the example's file, `.` and empty parts are skipped, and `..` going above the root of the request or above the record's folder gives P048. A name that is not a file of the request (including a folder) gives P048. The text is the file's text unchanged.
- Alternatives: normalise CR LF.
- Should the spec pin this? no.

## C-11: `expect` lines whose path is followed by something else
- Spec reference: REQ-SY-010
- Situation: missing
- What I chose: a path followed by nothing (`expect result`) or by a character other than `=`, `≈`, `~` is P011. `≈` forms accept `±` or `+-` with optional white space around them.
- Alternatives: P009 or P010.
- Should the spec pin this? no; Example 2 shows the first.

## C-12: Tolerance of 0 in tolerance numbers
- Spec reference: REQ-SY-007, REQ-SY-010
- Situation: ambiguous
- What I chose: `-0` counts as 0 or more and is accepted.
- Alternatives: reject.
- Should the spec pin this? no.

## C-13: Duplicate tolerance paths with a bad first one
- Spec reference: REQ-SY-007
- Situation: ambiguous
- What I chose: only a tolerance that was read (valid) takes its path; a second tolerance for the path of an invalid one is judged on its own. The P052 test comes before the P018 test.
- Alternatives: register the path anyway.
- Should the spec pin this? no.

## C-14: Table rows that are separators
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a row made only of `|`, `-`, `:` and spaces that ends with `|` is a separator. That includes `|   |` and a lone `|`, which Example 4 needs.
- Alternatives: none fits the example.
- Should the spec pin this? yes, say so in an example comment.

## C-15: Header problems are reported before tolerance problems
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: if any header cell has a bad form the table gets one P013 and no P010 for its other cells.
- Alternatives: report P010 for earlier cells too.
- Should the spec pin this? no.

## C-16: `?` in a column with a tolerance
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: `?` there takes the oracle's value, as everywhere else. A `?` under an input field is not JSON, so P009.
- Alternatives: P010.
- Should the spec pin this? yes.

## C-17: Table cells and `\`
- Spec reference: REQ-SY-012
- Situation: missing
- What I chose: only `\|` is an escape; other backslashes stay.
- Alternatives: also `\\`.
- Should the spec pin this? yes.

## C-18: Statements with a malformed first line
- Spec reference: REQ-SY-004, REQ-SY-006, REQ-SY-007
- Situation: ambiguous
- What I chose: a `req`/`open`/`decision` with a bad title keeps its ID and is still recorded; a bad `op` line makes a nameless op that no example finds. This matters only for the checks that run after a clean read, so it is never visible.
- Alternatives: drop the statement.
- Should the spec pin this? no.

## C-19: Rest-of-line syntax of clauses
- Spec reference: REQ-SY-004, REQ-SY-009
- Situation: missing
- What I chose: `contract`, `source` (of `oracle`) and `result` take any text, with no check. `decision` in a requirement splits on commas and white space; empty gives no IDs. `on` must be exactly one of `any`, `posix`, `windows` (else P033).
- Alternatives: P-codes for an empty `contract` etc.
- Should the spec pin this? no.

## C-20: Which `spec`, `oracle` and `errors` is used
- Spec reference: REQ-RC-004
- Situation: missing
- What I chose: the first of each in record order. A second one only gets its own problems and P044/P032. Error codes of every `errors` list are pooled for T005 and T023 (only one list can exist after a clean read anyway).
- Alternatives: the last.
- Should the spec pin this? no.

## C-21: Non-string values in `expect error = <value>`
- Spec reference: REQ-CK-005
- Situation: missing
- What I chose: a value that is not a declared string code (a number, say) gets T023. `≈` forms on `error` are not looked at.
- Alternatives: ignore non-strings.
- Should the spec pin this? yes.

## C-22: Which examples count as "has an example" for T019
- Spec reference: REQ-OR-001
- Situation: ambiguous
- What I chose: any example or table row of a requirement, runnable or not. Those under `open` items do not count.
- Alternatives: only runnable ones.
- Should the spec pin this? no.

## C-23: Responses from a solo run
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: lines are counted after dropping blank ones. If exactly one is left and it is a JSON object it is the response; if it is not an object the example has no response (T021). Responses in a batch need a string `id`.
- Alternatives: count blank lines; take a non-object as a response.
- Should the spec pin this? no.

## C-24: Oracle start-up details
- Spec reference: REQ-OR-002, REQ-OR-004
- Situation: missing
- What I chose: a file system copy of the request's files is made in a temporary directory and the oracle runs in the copy of its file's folder. The command `node` is started as the running Node binary. A timeout of 60 seconds per run counts as a stop (T020). An EPIPE on the oracle's input (it exited without reading) is not itself a failure; its exit status is.
- Alternatives: other time limits.
- Should the spec pin this? no (OPEN-RQ-001 leaves limits open).

## C-25: T020 when the command is empty or has an unclosed quote
- Spec reference: REQ-OR-004
- Situation: ambiguous
- What I chose: one T020 at the `oracle` line if any batch example would have been run, and one at each solo example's line; no process is started and every such example then gets T021.
- Alternatives: T020 only once.
- Should the spec pin this? no; Examples 4 and 5 fit it.

## C-26: Matching paths through `audit`
- Spec reference: REQ-OR-003
- Situation: ambiguous
- What I chose: `audit` alone is the audit text; `audit.<rest>` parses the text as JSON and reads the rest. If the text is not a string or not JSON, the path holds nothing (T002, or T025 for `?`).
- Alternatives: none.
- Should the spec pin this? no.

## C-27: Approximate expectations
- Spec reference: REQ-OR-003
- Situation: missing
- What I chose: `|value - number| <= tolerance` in binary64; a value that is not a number fails with T002.
- Alternatives: none.
- Should the spec pin this? no.

## C-28: Unquoted words and Unicode in whole-word tests
- Spec reference: REQ-CK-006, REQ-CK-008
- Situation: ambiguous
- What I chose: "letter or digit" means any Unicode letter or number (`\p{L}`, `\p{N}`). Quotations are removed line by line, leftmost first, with a regular expression for `"…"`, `“…”` and `` `…` ``; the three kinds do not nest. The phrases of T005 are matched with `\s+` between their words, so they may cross a line.
- Alternatives: ASCII only.
- Should the spec pin this? no.

## C-29: The text of an op's `result` and rejected alternatives
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: rejected alternatives are checked on their decoded string; `result` on the text after the keyword; each only one line.
- Alternatives: check the raw text with its quotes (a word is then always inside quotes).
- Should the spec pin this? no.

## C-30: Only the first spec's request is used
- Spec reference: REQ-SU-003
- Situation: missing
- What I chose: the request members of the first `spec`; a second spec's `request` is ignored.
- Alternatives: merge.
- Should the spec pin this? no.

## C-31: The `driver` and requests with odd shapes
- Spec reference: Driver protocol
- Situation: ambiguous
- What I chose: a line is blank only when it holds spaces and tabs. A line with other white space is parsed (JSON allows some of it) or is `bad_request`. `entry: null` is present, hence `bad_request`. Duplicate member names in a request follow `JSON.parse` (the last wins). When the checker throws, the answer is `internal_error`.
- Alternatives: none.
- Should the spec pin this? no (OPEN-RQ-004).

## C-32: Order of statements for "first"
- Spec reference: REQ-RC-002
- Situation: ambiguous
- What I chose: files sorted by their full name in the request, which gives the same order as the name relative to the folder.
- Alternatives: none; it is equal.
- Should the spec pin this? no.

## C-33: An example's reading when its line was dropped
- Spec reference: REQ-SY-010, REQ-SY-011
- Situation: ambiguous
- What I chose: the lines under a dropped example are read in full, with P022 if it began with `raw`; its `input` lines are applied to a scratch object, so P049 for a path through a non-object cannot be seen for it.
- Alternatives: none.
- Should the spec pin this? no.

## C-34: Case order across duplicated requirement IDs and the like
- Spec reference: REQ-SU-002
- Situation: missing
- What I chose: nothing special; a duplicate ID is an error (T007) so no cases are made.
- Alternatives: none.
- Should the spec pin this? no.
