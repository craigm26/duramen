# Choices

Where SPEC.md was silent, ambiguous or self-contradictory, this is what the implementation does.

## C-1: Statements of the rest of the language
- Spec reference: OPEN-RC-001, REQ-SY-002
- Situation: missing
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` are accepted without a diagnostic, and their bodies are not read at all (no P006, P007 or P015 under them). The `returns` clause of `op` and the `static` clause of `req` are accepted the same way, and the lines under them are not read.
- Alternatives: report them as P002/P015 because this checker does not implement them; read their bodies as generic clauses.
- Should the spec pin this? no, it is deliberately open; any choice is fine as long as the core statements are unaffected.

## C-2: P001 inside bodies that are otherwise ignored
- Spec reference: REQ-SY-001, REQ-SY-002, REQ-SY-003
- Situation: ambiguous
- What I chose: a line whose leading white space holds something other than spaces gets P001 wherever it is, including in the body of an unknown statement (P002), under an unknown clause (P015) or under a second once-only clause (P052). Lines are read before structure, so this check runs first.
- Alternatives: "the lines of its body MUST be ignored" could be read as suppressing P001 too.
- Should the spec pin this? yes, it changes the diagnostics of a plausible record (a tab inside a misspelled statement).

## C-3: Lines indented one space in bodies that are ignored
- Spec reference: REQ-SY-002, REQ-SY-003
- Situation: ambiguous
- What I chose: in the body of an unknown statement, or of a statement of the rest of the language, a line indented one space gets nothing (the body is ignored). Under an unknown clause of a known statement it still gets P007, because P007 is about the statement's body, not the clause's lines.
- Alternatives: P007 everywhere; P007 nowhere in ignored material.
- Should the spec pin this? unsure; it is a corner, but two builds could differ on it.

## C-4: `#` lines indented three spaces under `text` and under an `errors` clause
- Spec reference: REQ-SY-005, REQ-SY-008, REQ-SY-003
- Situation: ambiguous
- What I chose: under a `text` clause a line indented three spaces gets P008 even when it starts with `#`; under an `errors` clause it gets P006 even when it starts with `#`. Both clauses take lines of their own, and the "neither blank nor a comment" exemption is stated only for clauses that take none; and under `errors` a `#` line is explicitly condition text, not a comment.
- Alternatives: treat a `#` line indented three as a comment in both places.
- Should the spec pin this? yes, an example for each would settle it.

## C-5: Comments under an example
- Spec reference: REQ-SY-010, REQ-SY-011
- Situation: ambiguous
- What I chose: a line under an example that starts with `#` is a comment at any indent other than inside an input text (indent 3, 4, 5, or 6+ when not taking text), and gets nothing. Inside an input text (indent 6 or more right after an `input <path>` line), a `#` line is text. A comment indented four spaces is a line of the example, so it ends an input text.
- Alternatives: comments only at indent 4; `#` lines at indent 6+ always comments.
- Should the spec pin this? yes, the end of an input text around comments decides what is sent.

## C-6: An `on` clause with nothing after it
- Spec reference: REQ-SY-009
- Situation: missing
- What I chose: P033 (an empty platform is "any other" platform).
- Alternatives: treat it as `any`, by analogy with an empty `decision` or `contract` clause.
- Should the spec pin this? unsure; it is rare, but the analogy points the other way.

## C-7: A `section`, `req`, `open` or `decision` with no ID at all
- Spec reference: REQ-SY-006
- Situation: missing
- What I chose: one P005 (there is no title after the missing ID).
- Alternatives: a separate diagnostic for the missing ID.
- Should the spec pin this? no; P005 already says the line is malformed.

## C-8: `input from "<file>"` with no path
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: a line that ends with `from` and a quoted string is the `from` form even when nothing comes before `from`; its empty path gets P049, and it takes no text, so lines indented six after it get P006. The quoted string must be a valid JSON string for the line to be the `from` form; otherwise the whole rest is a path (and normally P049).
- Alternatives: read `from "x"` as a path, so that the line takes text.
- Should the spec pin this? unsure.

## C-9: Where a `from` name may lead
- Spec reference: REQ-SY-011, REQ-RC-001
- Situation: ambiguous
- What I chose: the name is resolved part by part from the example file's folder; a `..` that would climb above the folder holding all the request files gets P048; otherwise only the final location is judged: it must be inside the record's folder and be one of the request's files. So `../r/t.txt` from `r/s.duramen` in record `r` reads `r/t.txt`. Any request file counts, also one whose name or folder starts with `.` or is under `build`.
- Alternatives: P048 for any name that leaves the record folder at any step; only files the record itself would list.
- Should the spec pin this? yes, "a name that leaves the record's folder" reads both ways.

## C-10: Blank request lines and CR
- Spec reference: Interface, Driver protocol
- Situation: ambiguous (whether other white space makes a line blank is open)
- What I chose: the driver splits standard input at LF, removes one CR at the end of each line, and treats a line of only spaces and tabs (after that) as blank. Any other white space-only line is answered `bad_request` with `"id": null`. A last line without LF is still answered.
- Alternatives: treat every `\s`-only line as blank; keep the CR (JSON.parse accepts it as white space anyway).
- Should the spec pin this? no, the spec already leaves it open.

## C-11: How long the oracle may run
- Spec reference: OPEN-RQ-001, REQ-OR-004
- Situation: missing
- What I chose: each run of the oracle is stopped with SIGKILL after 60 seconds, which is T020 as for any stopped oracle.
- Alternatives: no limit; a shorter one.
- Should the spec pin this? no, open on purpose.

## C-12: Where the oracle runs
- Spec reference: REQ-OR-002, OPEN-RQ-003
- Situation: missing
- What I chose: every file of the request (not only the record's) is written into a fresh temporary folder, the oracle is started in the subfolder that holds the `oracle` statement's file, and the folder is removed afterwards. The oracle's standard error is discarded. Names the file system cannot hold make the request an `internal_error`.
- Alternatives: write only the record's folder.
- Should the spec pin this? no.

## C-13: Failures of the checker itself
- Spec reference: OPEN-RQ-004
- Situation: missing
- What I chose: as the reference: `{"id": <id>, "error": "internal_error"}`, with the details on standard error.
- Alternatives: none worth taking.
- Should the spec pin this? no.

## C-14: Checks of unknown kinds in `judge`
- Spec reference: REQ-JU-001, OPEN-JU-001
- Situation: missing
- What I chose: a check must have a `kind` member (else `bad_request`); a kind other than `eq` or `approx` is accepted and is never met, so it is listed as a failed `checks.<n>`.
- Alternatives: refuse unknown kinds as `bad_request`; count them as met.
- Should the spec pin this? no, open on purpose; failing them is the safe side for a judge.

## C-15: Numbers too large for binary64 in `judge`
- Spec reference: OPEN-JU-002
- Situation: missing
- What I chose: no special handling: `JSON.parse` makes them ±Infinity, and comparisons proceed with those values (an infinite `tol` is "0 or more").
- Alternatives: `bad_request`.
- Should the spec pin this? no.

## C-16: T019 counts table rows
- Spec reference: REQ-OR-001
- Situation: ambiguous
- What I chose: "at least one example" counts the examples and table rows of requirements (both become cases). An open item's examples are not counted (they are not read).
- Alternatives: count only `example` clauses.
- Should the spec pin this? yes, briefly: "an example or table row".

## C-17: T005 counts distinct codes of the first `errors` list
- Spec reference: REQ-CK-008
- Situation: ambiguous
- What I chose: "names two or more of the codes" means two different codes; a code named twice counts once. Codes are those of the first `errors` statement (a second one is P032, which stops the check anyway).
- Alternatives: count mentions.
- Should the spec pin this? no; the example with `too_big` and `too_small` already suggests it.

## C-18: What text of an `errors` clause T004 reads
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: the condition: the text after `when` on the clause's line, then each line under it. The code itself and the word `when` are not read.
- Alternatives: read the whole clause including the code.
- Should the spec pin this? no; a code spelled `MUST` is far-fetched.

## C-19: `audit.<path>` when the response's `audit` is not a string
- Spec reference: REQ-OR-003, REQ-JU-002
- Situation: missing
- What I chose: there is no audit text, so `audit.<path>` holds no value; `audit` alone still reads the member as it is.
- Alternatives: read the path inside the non-string value.
- Should the spec pin this? yes; REQ-SU-005 already excludes such audits from `full`, the same words could cover paths.

## C-20: `duramen 0.2`
- Spec reference: OPEN-RC-001, REQ-RC-003
- Situation: missing
- What I chose: a `duramen 0.2` file is read and checked exactly as a `duramen 0.1` one; no 0.2-only checks.
- Alternatives: none within the core.
- Should the spec pin this? no, open on purpose.

## C-21: Where the `duramen` statement stands
- Spec reference: OPEN-RC-002
- Situation: missing
- What I chose: anywhere in the file; the first one in the file decides its version.
- Alternatives: P-diagnostic when it is not first.
- Should the spec pin this? no, open on purpose.

## C-22: A second `spec`, `oracle` or `errors` statement has no effect
- Spec reference: REQ-RC-004
- Situation: ambiguous
- What I chose: its clauses are read and their problems reported, but its `request` members, its text (for T004), and a second `errors` list's codes and conditions are not kept. P044/P032 stops the check anyway, so this is invisible in diagnostics.
- Alternatives: keep them.
- Should the spec pin this? no.

## C-23: Table rows with the wrong number of cells
- Spec reference: REQ-SY-012
- Situation: missing
- What I chose: a row that gets P014 gets nothing else; its cells are not checked.
- Alternatives: also check the cells that line up with the header.
- Should the spec pin this? unsure; one diagnostic per mistake is the spirit of D-011.

## C-24: Clauses that are not once-only
- Spec reference: REQ-SY-003, REQ-SY-007
- Situation: missing
- What I chose: following the once-only list of REQ-SY-003 to the letter, every clause it does not name may repeat without P052: `audit` of `op`, `rejected` and `decision` of `req`/`decision`, and `source` of `oracle` (the list names only `decision`'s `source`).
- Alternatives: make `oracle`'s `source` once-only by analogy with `decision`'s.
- Should the spec pin this? yes for `oracle`'s `source`: the analogy with `decision` is strong enough that builds may differ.

## C-25: Request members written in the request line
- Spec reference: REQ-SU-003
- Situation: missing
- What I chose: every member name and value is written with `JSON.stringify`, including `__proto__`, which is kept as an ordinary own member everywhere (request members, inputs built from input lines, tolerances).
- Alternatives: none sensible.
- Should the spec pin this? no; D-018 and D-022 already say such a name is like any other.

## C-26: The order of requests to the driver
- Spec reference: Interface, Driver protocol
- Situation: missing
- What I chose: requests are handled one at a time, in order, and each response is written as soon as it is ready (not after end of input).
- Alternatives: handle requests concurrently and reorder the responses.
- Should the spec pin this? no.
