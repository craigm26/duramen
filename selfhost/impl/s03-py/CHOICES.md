# Choices

## C-1: Second request line only counts when the first was valid
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: an example's second `request` line gets P052 only if an earlier `request` line was accepted. A first line with P009/P051 does not count, so the next one is judged on its own (this is what SY-010 example 3 shows: `request [1]` then `request {"input": {}}` gives P009 then P051).
- Alternatives: count any earlier `request` line.
- Should the spec pin this? yes, the rule is only visible in an example.

## C-2: Unspecified statements are accepted and ignored
- Spec reference: REQ-SY-002, OPEN-RC-001
- Situation: missing
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` give no diagnostic and their bodies are skipped.
- Alternatives: report P002, or report their clauses as P015.
- Should the spec pin this? no, the spec makes it open.

## C-3: Duplicate spec/oracle/errors statements
- Spec reference: REQ-RC-004
- Situation: ambiguous
- What I chose: a second `spec` or `oracle` gets only P044 (its arguments are not checked for P021/P028) and a second `errors` only P032 plus P050 for stray arguments. Their clause lines are still read for P-diagnostics but nothing is registered (its error codes are not declared).
- Alternatives: skip the body entirely.
- Should the spec pin this? unsure.

## C-4: A comment line at indent 2 inside a text clause
- Spec reference: REQ-SY-003, REQ-SY-005
- Situation: missing
- What I chose: a `#` line at indent 2 is skipped as a comment and does not end the clause above it; later indented lines still belong to that clause.
- Alternatives: it ends the text.
- Should the spec pin this? no.

## C-5: Header problems do not drop the statement
- Spec reference: REQ-SY-006
- Situation: missing
- What I chose: after P004/P005 on a `req`/`open`/`decision`/`section` line the statement is still read (its clauses are checked), and the missing title is just `None`.
- Alternatives: ignore the body.
- Should the spec pin this? no.

## C-6: Tolerance duplicate detection
- Spec reference: REQ-SY-007
- Situation: ambiguous
- What I chose: P052 for a repeated `tolerance` path applies only against earlier valid tolerance lines.
- Alternatives: count lines with P018 too.
- Should the spec pin this? no.

## C-7: Path words are ASCII
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: a word in an `input` path is ASCII letters, digits, `_` and `-` (non-ASCII letters need quotes).
- Alternatives: Unicode letters.
- Should the spec pin this? yes ("letters" is not said to be ASCII, unlike field names).

## C-8: Leading blank lines of an input text are kept
- Spec reference: REQ-SY-011
- Situation: missing
- What I chose: only trailing blank lines are dropped; blank lines right after the `input` line become `\n`. An input whose lines are all blank counts as no text (P049).
- Alternatives: drop leading blanks too.
- Should the spec pin this? yes.

## C-9: `from` paths
- Spec reference: REQ-SY-011, D-012
- Situation: ambiguous
- What I chose: the path is resolved against the example file's folder with `.`/`..` normalised and `/` as separator; a path that starts with `/`, is empty, leaves the record's folder, names a folder or a missing file is P048. Files other than `.duramen` in `files` can be read.
- Alternatives: allow absolute paths from the record root.
- Should the spec pin this? no.

## C-10: `≈` and `~` both accept `±` and `+-`
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: either separator is accepted after either symbol, the first occurrence of `±` or `+-` splits number and tolerance.
- Alternatives: pair `≈` only with `±`.
- Should the spec pin this? yes.

## C-11: Header cell errors in tables
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: one P013 per header line (at the header's line) however many cells are bad, and bad forms are judged before tolerances (so no P010 appears when P013 does). P010 is once per bad tolerance cell. Non-row, non-comment lines (P006) are reported even if the table later gets P013.
- Alternatives: one P013 per bad cell.
- Should the spec pin this? unsure.

## C-12: Separator rows
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: any row made only of `|`, `-`, `:` and spaces that starts and ends with `|`, including `|` alone and `|   |`, is a separator (the table example 4 requires this).
- Alternatives: none consistent with the example.
- Should the spec pin this? no, the example pins it.

## C-13: Header cell path forms
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: `result`, `audit`, `error`, `id`, optionally followed by `.` and at least one non-white-space character; everything else made of `[A-Za-z0-9_-]` is an input field.
- Alternatives: allow `result.` alone.
- Should the spec pin this? no.

## C-14: Cited decisions are de-duplicated
- Spec reference: REQ-CK-003, REQ-CK-009
- Situation: missing
- What I chose: a decision cited twice by one requirement is judged once (one T008 or T028).
- Alternatives: one diagnostic per citation.
- Should the spec pin this? yes.

## C-15: T028 and invalid statuses
- Spec reference: REQ-CK-009
- Situation: ambiguous
- What I chose: T028 depends on the first word of the status even if the status also gets T027 (the example needs this for `status superseded`); an unknown first word or an empty status gives no T028.
- Alternatives: treat invalid statuses as accepted.
- Should the spec pin this? no, the example pins it.

## C-16: `superseded by <ID>` spacing
- Spec reference: REQ-CK-009
- Situation: ambiguous
- What I chose: exactly one space between the three words; the ID is one white-space-free word that must be declared.
- Alternatives: any white space.
- Should the spec pin this? no.

## C-17: What T024 means
- Spec reference: REQ-OR-007
- Situation: ambiguous
- What I chose: T024 is given when the oracle's answer has an `error` and the example has no expectation of any kind.
- Alternatives: any example with no expectation whose path is `error` or under it.
- Should the spec pin this? yes.

## C-18: Oracle run limits
- Spec reference: REQ-OR-004, OPEN-RQ-001
- Situation: missing
- What I chose: each oracle run is stopped after 20 seconds (counted as T020). The record's files are written to a temporary folder; the oracle runs in the folder of the file holding the `oracle` statement. Standard error is discarded.
- Alternatives: other timeouts.
- Should the spec pin this? no (open).

## C-19: Oracle command splitting
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: quotes may start in the middle of a word and parts join (`a"b c"d` is one word); an empty `""` is an empty word; inside `'…'` backslashes are literal; an unclosed quote means the command cannot be started.
- Alternatives: quotes only at word start.
- Should the spec pin this? no.

## C-20: Solo response that is not a JSON object
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: a solo run that writes exactly one non-blank line that is not a JSON object counts as no response (T021). Non-solo responses without a string `id` match nothing.
- Alternatives: accept any JSON.
- Should the spec pin this? no.

## C-21: Error when the path crosses a non-container
- Spec reference: REQ-OR-003
- Situation: missing
- What I chose: a path through a string, number, bool or null is simply absent (T002 for `=`/`≈`, T025 for `= ?`).
- Alternatives: string indexing.
- Should the spec pin this? no.

## C-22: Whitespace-only lines in requests
- Spec reference: Driver protocol
- Situation: ambiguous (the spec says it is open)
- What I chose: only lines of spaces and tabs are blank; a line holding only CR (or other white space) gets `bad_request`. A trailing CR on a request line is accepted by the JSON parser.
- Alternatives: treat all JS white space as blank.
- Should the spec pin this? no (open).

## C-23: Malformed input
- Spec reference: Driver protocol
- Situation: missing
- What I chose: invalid UTF-8 on stdin is decoded with replacement characters; non-finite numbers (NaN, Infinity) are rejected as invalid JSON everywhere; every JSON number is read as an IEEE double (so `1.0` equals `1`, huge integers lose precision as in ECMAScript).
- Alternatives: arbitrary-precision integers.
- Should the spec pin this? no.

## C-24: Duramen statement body and version spelling
- Spec reference: REQ-RC-003
- Situation: missing
- What I chose: the version must be exactly `0.1` or `0.2` after the keyword (extra words make it invalid, P023). A first `duramen` statement's clauses get P015; a repeated statement is not read further. `duramen` can appear anywhere in the file.
- Alternatives: allow trailing words.
- Should the spec pin this? no.

## C-25: `omit` of non-existing members and unknown `omit` names
- Spec reference: REQ-SU-003
- Situation: missing
- What I chose: omitting a member that is not there is silently fine.
- Alternatives: a diagnostic.
- Should the spec pin this? no.

## C-26: Which `id`-less examples are solo
- Spec reference: REQ-OR-002, REQ-SU-002
- Situation: ambiguous
- What I chose: an example with `omit id` or a raw example is solo. An example that only omits `op` or `input` is not solo.
- Alternatives: solo when the line has no string `id`.
- Should the spec pin this? no.

## C-27: Output encoding
- Spec reference: Driver protocol
- Situation: missing
- What I chose: responses are written as compact JSON with the non-ASCII characters left as UTF-8 and lone surrogates escaped as `\udXXX`.
- Alternatives: ASCII-only output.
- Should the spec pin this? no.
