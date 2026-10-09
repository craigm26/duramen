# Choices

## C-1: Statements and clauses of the rest of the language
- Spec reference: OPEN-RC-001, REQ-SY-002
- Situation: missing
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` statements are accepted with no diagnostic and their bodies are ignored. The `returns` and `static` clauses are not recognised specially, so they get P015 like any unknown clause. `static` does not stand in for an example (T001 still applies).
- Alternatives: P015 on `returns` and `static` only inside `op` and `req`; letting `static` satisfy T001.
- Should the spec pin this? no, it is open on purpose.

## C-2: Where the oracle gets the `node` program
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: a command whose first word is exactly `node` is started with `process.execPath`, so it does not depend on PATH. Any other program is started by name. The oracle's standard error is discarded.
- Alternatives: always resolve through PATH; inherit standard error.
- Should the spec pin this? no.

## C-3: How long an oracle may run
- Spec reference: REQ-OR-004, OPEN-RQ-001
- Situation: missing
- What I chose: each run of the oracle is stopped after 30 seconds, which gives T020.
- Alternatives: no limit; a shorter one.
- Should the spec pin this? no, it is open.

## C-4: The oracle runs in a temporary copy of the request's files
- Spec reference: REQ-OR-002, OPEN-RQ-003
- Situation: missing
- What I chose: every file of the request is written under a fresh temporary folder (names a file system cannot hold are skipped), the oracle runs in the folder of the file that holds the `oracle` statement, and the folder is removed afterwards.
- Alternatives: write only the files of the record.
- Should the spec pin this? no.

## C-5: Blank lines of the driver
- Spec reference: Driver protocol
- Situation: ambiguous
- What I chose: a line of only spaces and tabs gets no response. Any other line, a lone CR included, is answered, with `bad_request` if it is not JSON. A last line with no LF is answered too. Requests are answered as they arrive, so an interactive caller is not blocked.
- Alternatives: treat every `\s` line as blank.
- Should the spec pin this? no, the spec says it is open.

## C-6: A `from` name that is not a JSON string
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: an `input` line is a `from` line only when it ends with `from` and a quoted string that is valid JSON. Otherwise it is an `input <path>` line, so `input a from "bad\q"` gets P049 (a path of another form), not P004.
- Alternatives: P004 for the quoted string.
- Should the spec pin this? yes, a malformed quoted string after `from` has no stated code.

## C-7: Text under a bad `input` line
- Spec reference: REQ-SY-011
- Situation: missing
- What I chose: lines indented six or more under an `input <path>` line whose path is malformed, or goes through a value that is not an object, are consumed as its text, so they get no P006. Under a `from` line they get P006 even when the `from` line itself failed.
- Alternatives: P006 for them.
- Should the spec pin this? yes.

## C-8: Raw example in single quotes
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: `example raw '...'` needs the text to start and end with `'` and have at least two characters. Anything after the closing `'` is part of the text, so `'a' b` is P004. The text between is not checked for being JSON.
- Alternatives: take the text up to the last `'` and ignore what follows.
- Should the spec pin this? no.

## C-9: An empty `contract` or `source` clause and the once-only rule
- Spec reference: REQ-SY-003, REQ-SY-004
- Situation: ambiguous
- What I chose: an empty `contract` clause still counts as the first one, so a second `contract` gets P052. An empty `source` or `status` does the same.
- Alternatives: an empty clause does not count.
- Should the spec pin this? yes.

## C-10: Empty platform
- Spec reference: REQ-SY-009
- Situation: ambiguous
- What I chose: `on` with nothing after it is "any other" platform: P033.
- Alternatives: read as `any`.
- Should the spec pin this? yes.

## C-11: Table rows that begin with `#`, and rows indented more than four
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a line under `table` is a comment when it starts with `#` after its indent; otherwise it is a row when it is indented four or more and starts with `|`, and P006 in every other case. A row with a different number of cells (P014) is skipped, but the others are still read.
- Alternatives: none seriously considered.
- Should the spec pin this? no.

## C-12: Where P013 is reported
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: P013 for a bad op, or for fewer than a header and one row, is at the `table` line. P013 for a header cell of no form or a repeated column is at the header row's line, as is the P010 for a header's tolerance. The examples in the spec fix these, but the prose does not say.
- Alternatives: the `table` line for all of them.
- Should the spec pin this? yes, only the examples show it.

## C-13: Separator rows
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a row is a separator when, trimmed, it is `|`, or it starts and ends with `|` and holds only `|`, `-`, `:` and white space. So `|   |` and a lone `|` are separators (the spec's Example 4 needs this).
- Alternatives: require at least one `-`.
- Should the spec pin this? yes, "a row of only `|`, `-`, `:` and white space" does not say a lone `|` counts.

## C-14: Same-name code lists
- Spec reference: REQ-CK-008
- Situation: ambiguous
- What I chose: T005 counts distinct declared codes named in a requirement's text; a code repeated in the text is one name. A code declared twice in `errors` is one code.
- Alternatives: count occurrences.
- Should the spec pin this? no.

## C-15: Quotations in the obligation check
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: a quotation is replaced by one space, found left to right: an opening `"`, `“` or backquote pairs with the next closing one on the same line (`”` closes `“`). An opener with no closer is an ordinary character. Quotations do not nest.
- Alternatives: remove the quotation and join the words around it (D-021 rejects this).
- Should the spec pin this? no.

## C-16: T004 for `spec` text
- Spec reference: REQ-CK-006
- Situation: missing
- What I chose: only the first `spec` statement's text is checked, at that statement's line. A spec's `title`, `contract` and a decision's `source` are not checked.
- Alternatives: none.
- Should the spec pin this? no.

## C-17: Which examples are sent to the oracle
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: an example of an undeclared operation that does not expect an error and is not raw is not sent (it already has T009). All other examples are, in record order. The first declaration of an operation is the one used when its name is repeated.
- Alternatives: send every example.
- Should the spec pin this? no.

## C-18: Judge: other kinds of check
- Spec reference: REQ-JU-001, OPEN-JU-001
- Situation: missing
- What I chose: a check whose `kind` is a string other than `eq` and `approx` is accepted by the form check and counts as not met. A `kind` that is not a string is a `bad_request`.
- Alternatives: `bad_request` for unknown kinds.
- Should the spec pin this? no, it is open.

## C-19: Judge: infinite numbers
- Spec reference: OPEN-JU-002
- Situation: missing
- What I chose: a number too large for binary64 reads as Infinity, as `JSON.parse` does, and a `tol` or tolerance of Infinity is a number of 0 or more, so it is accepted.
- Alternatives: `bad_request`.
- Should the spec pin this? no, it is open.

## C-20: Duplicate field names in an `input` clause that has a malformed field
- Spec reference: REQ-SY-007
- Situation: ambiguous
- What I chose: each well-formed field is judged on its own, in the order written, across all `input` clauses of the operation, so a second field of the same name gets P052 at its own clause's line even when a sibling field in that clause got P017.
- Alternatives: none.
- Should the spec pin this? no.

## C-21: Statement lines with a first word that has odd characters
- Spec reference: REQ-SY-002
- Situation: ambiguous
- What I chose: the first word is everything up to the first `\s` character, so `note:` is an unknown statement (P002) and `Note` too.
- Alternatives: none.
- Should the spec pin this? no.

## C-22: Internal failure
- Spec reference: OPEN-RQ-004
- Situation: missing
- What I chose: an exception while handling an accepted request answers `{"id", "error": "internal_error"}` and writes the stack to standard error, as the reference does.
- Alternatives: exit.
- Should the spec pin this? no, it is open.
