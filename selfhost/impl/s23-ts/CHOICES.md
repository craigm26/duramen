# CHOICES

## C-1: Statements of the rest of the language
- Spec reference: REQ-SY-002, OPEN-RC-001
- Situation: ambiguous
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` are known keywords: no P002, and their clauses and body lines are read as nothing (no diagnostics at all). The `returns` and `static` clauses are not specially handled (they get P015 under `op` and `req`, since the core language does not list them).
- Alternatives: give P002 to them; read them with some invented grammar; accept `returns`/`static` silently.
- Should the spec pin this? no, it is declared open; but a one-line statement of what a core-only checker does with them would help.

## C-2: What the oracle is run against: a temporary folder
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: the request's files exist only in memory, so before the first oracle run I write every file of the request to a fresh folder under the system temp directory (names as given, parent folders created), run the oracle with that folder's counterpart of the `oracle` statement's file folder as working directory, and delete the folder at the end of the request. A file that cannot be written is skipped silently.
- Alternatives: run in the implementation folder; give the oracle only the record's files; keep the folder between requests.
- Should the spec pin this? yes: "in the folder of the file that holds the oracle statement" does not say where that folder lives when a record travels inside a request, and whether files outside the record are visible to the oracle.

## C-3: Oracle time limit, and `node`
- Spec reference: REQ-OR-004, OPEN-RQ-001
- Situation: missing
- What I chose: an oracle run is stopped after 60 seconds (T020). When the first word of the oracle command is `node`, I start the running Node.js binary (`process.execPath`) instead of looking `node` up on PATH. A broken pipe on the oracle's standard input (it exited without reading) is not by itself a failure; a non-zero exit status is.
- Alternatives: shorter or longer limit; always PATH lookup.
- Should the spec pin this? no (time is OPEN-RQ-001), though the `node` substitution is invisible to specs.

## C-4: Unknown kinds of check in `judge`
- Spec reference: REQ-JU-001, OPEN-JU-001
- Situation: missing
- What I chose: a check whose `kind` is neither `eq` nor `approx` is well formed as long as it is an object with a string `path` and a `kind` member; it is never met, so its `checks.<n>` is listed as failed. A check without a `kind` member is `bad_request`.
- Alternatives: `bad_request` for unknown kinds; skip them.
- Should the spec pin this? no, it is declared open.

## C-5: `judge` requires `full` and `answer` to be present
- Spec reference: REQ-JU-001
- Situation: ambiguous
- What I chose: `case.full` and `input.answer` must be present as members (even if `null`); a missing one is `bad_request` (the examples show this for `{"checks": []}` and for a request with no `answer`). Extra members anywhere are ignored. A check's `tol` and `value` of `approx` must be JSON numbers; `tol` must be 0 or more.
- Alternatives: treat missing `full` as `null`.
- Should the spec pin this? no, the table makes it clear.

## C-6: `from` with white space
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: the `from` form needs at least one white space character before `from`, and allows none or more between `from` and the opening quote. When several `from "` positions exist, the leftmost one whose remainder is a JSON string wins. If none is a valid JSON string, the whole text is the path (and gets P049).
- Alternatives: require white space after `from`; use the rightmost position.
- Should the spec pin this? unsure, `from"x"` is a corner nobody will write.

## C-7: An input text that holds only blank lines
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: blank lines at the end are dropped, so a text of only blank lines is empty and the `input <path>` line gets P049 ("no text under it").
- Alternatives: a text of a single "\n".
- Should the spec pin this? yes, the phrase "no text under it" can mean no lines or no non-blank lines.

## C-8: A statement without an ID
- Spec reference: REQ-SY-006
- Situation: missing
- What I chose: `section`, `req`, `open` or `decision` with nothing after the keyword gets P005 (as a missing title), and no P004.
- Alternatives: a different code for the missing ID.
- Should the spec pin this? no, example 3 of REQ-SY-006 (`section S`) points the same way.

## C-9: Lines under an unknown statement
- Spec reference: REQ-SY-002
- Situation: ambiguous
- What I chose: the body of an unknown statement is skipped entirely, except P001 (a line-level fault, found before statements are formed). So an indent-1 line under it gets no P007.
- Alternatives: report P007 there.
- Should the spec pin this? no.

## C-10: An empty `contract` counts for P052
- Spec reference: REQ-SY-003, REQ-SY-004
- Situation: ambiguous
- What I chose: an empty `contract` (or `decision`/`source` clause) states nothing, but still counts as the first once-only clause, so a second one gets P052.
- Alternatives: an empty clause does not count.
- Should the spec pin this? yes, D-017 says "an empty `contract` ... is none", which can be read either way.

## C-11: The oracle statement's `source` clause
- Spec reference: REQ-SY-004
- Situation: missing
- What I chose: `source` may be given any number of times, takes any text (even none), and is not checked. Other clauses get P015.
- Alternatives: P052 for a second; check the list.
- Should the spec pin this? no.

## C-12: Obligation words in an error condition
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: the text checked for a clause under `errors` is what follows `when` on its line plus its continuation lines, not the code word.
- Alternatives: the whole clause line.
- Should the spec pin this? no.

## C-13: Clause lines that are comments at indent three or more
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: under an example, a line starting with `#` after its indent is a comment wherever its indent (3 or more), never P006 and never P011, except as text of an `input` block (indent 6 and more directly after the `input` line). Under a table, any `#` line is a comment.
- Alternatives: P006 for comments at an odd indent.
- Should the spec pin this? yes, REQ-SY-003 says only "a line that is neither blank nor a comment".

## C-14: `expect` lines with a character after the path that is no operator
- Spec reference: REQ-SY-010
- Situation: missing
- What I chose: `expect result foo` (anything after the path other than `=`, `≈` or `~`) gets P011, like `expect result` alone.
- Alternatives: P009.
- Should the spec pin this? no, it follows from "any other line P011" and the example `expect result`.

## C-15: A text clause's lines when it also has a problem
- Spec reference: REQ-SY-005
- Situation: ambiguous
- What I chose: a `text` clause that has words after the keyword gets P008 and its lines are still read as its text; a line indented three is P008 and dropped from the text.
- Alternatives: ignore the lines of a text clause with P008.
- Should the spec pin this? no, only diagnostics are observable.

## C-16: `input` lines of an example: text taken even when the path is bad
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: lines indented six after a text-form `input` line belong to it even when the line's path is bad (P049), so they add no P006. A line with a `from` file never takes text. A failing `input` line changes nothing in the example's input.
- Alternatives: P006 for the text of a bad path.
- Should the spec pin this? no (the "at most one diagnostic" rule covers it).

## C-17: A `from` name that leaves the request
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: `..` at the top of the request (above the root of the files) is P048, also when the record is the folder `.`.
- Alternatives: clamp at the root.
- Should the spec pin this? no.

## C-18: Which whitespace-only lines the driver skips
- Spec reference: Interface, driver protocol
- Situation: ambiguous (declared open)
- What I chose: a request line is blank only if it holds spaces and tabs; any other white space makes it a line that is not a JSON object, so `bad_request` with a null id (JSON.parse accepts it as white space only if it is JSON white space, in which case it is not an object anyway).
- Alternatives: skip all `\s`.
- Should the spec pin this? no, declared open.

## C-19: Failures of the checker itself
- Spec reference: OPEN-RQ-004
- Situation: missing (declared open)
- What I chose: any exception while handling an accepted request is caught, written to standard error, and answered `{"id": <id>, "error": "internal_error"}`.
- Alternatives: none worth listing.
- Should the spec pin this? no.

## C-20: Where a table's header problems are reported
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a table without an op, with several words, or with fewer than a header and one row gets P013 at the `table` line; a bad header cell (no form, repeated name) gets P013 at the header row's line, and a bad header tolerance P010 at the header row's line. These follow the examples. Rows that are separators are skipped even before the header, and a cell count different from the header's is P014 at the row line with the row's cells otherwise unread.
- Alternatives: all at the table line.
- Should the spec pin this? yes, the line is only visible in examples, not stated in the words.

## C-21: Level `info`
- Spec reference: Records intro, REQ-RC-006
- Situation: missing
- What I chose: no rule produces an `info` diagnostic; the level is only ordered after `warning` when sorting.
- Alternatives: none.
- Should the spec pin this? no.

## C-22: Request members when an operation is declared twice
- Spec reference: REQ-CK-002, REQ-SU-003
- Situation: missing
- What I chose: an example is checked against, and takes `request`, `audit` and `tolerance` members from, the first operation of its name. A duplicate is T007 anyway, so no suite is made.
- Alternatives: none.
- Should the spec pin this? no.

## C-23: The `platform` of an invalid `on`
- Spec reference: REQ-SY-009
- Situation: missing
- What I chose: a requirement whose `on` got P033 keeps `any`. (No suite is made from such a record.)
- Alternatives: none.
- Should the spec pin this? no.
