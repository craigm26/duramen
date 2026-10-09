# CHOICES

## C-1: Files are materialized in a temp directory to run the oracle
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: the request's files are all written to a fresh directory under the OS temp dir and the oracle is started with its working directory set to the folder of the file holding the `oracle` statement inside it; the directory is removed afterwards. Files outside the record folder are written too.
- Alternatives: writing only the record's files; running the oracle in memory.
- Should the spec pin this? no, it only follows from "in the folder of the file that holds the oracle statement" with records travelling as texts.

## C-2: Oracle time limit
- Spec reference: REQ-OR-004, OPEN-RQ-001
- Situation: missing
- What I chose: each oracle run is stopped after 20 seconds, which counts as "stopped for taking too long" (T020); output that arrived is still used.
- Alternatives: no limit; a shorter limit.
- Should the spec pin this? no (OPEN-RQ-001 already leaves it open).

## C-3: `node` falls back to the running Node binary
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: if the program `node` cannot be found on PATH, the oracle is started with the Node binary running the checker.
- Alternatives: fail with T020.
- Should the spec pin this? no.

## C-4: `entry` that is `null`
- Spec reference: Errors, item 3
- Situation: ambiguous
- What I chose: `entry` counts as present when the key exists, so `null` is a `bad_request`; only a missing key means "the whole folder".
- Alternatives: treat `null` as missing.
- Should the spec pin this? yes, one example would settle it.

## C-5: Unknown `kind` of check in `judge`
- Spec reference: REQ-JU-001, OPEN-JU-001
- Situation: missing
- What I chose: a check whose `kind` is a string other than `eq`/`approx` is well-formed; it never holds (reported as `checks.<n>`). A non-string `kind` is a `bad_request`.
- Alternatives: `bad_request` for unknown kinds.
- Should the spec pin this? no, it is open on purpose.

## C-6: `returns` of `op` and `static` of `req`, and the rest-of-language statements
- Spec reference: OPEN-RC-001, REQ-SY-002
- Situation: ambiguous
- What I chose: `type`, `edge`, `edgedef`, `property`, `evidence` statements are accepted with their bodies ignored; `returns` (in `op`) and `static` (in `req`) clauses are accepted and ignored with the lines under them, with no diagnostics.
- Alternatives: P015 for them; reading their syntax.
- Should the spec pin this? no (open).

## C-7: `..` above the root in an input `from` name
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: `..` with no folder left to go up to makes the file not one of the request's files inside the record's folder (P048).
- Alternatives: stay at the root.
- Should the spec pin this? yes, an example `from "../x"` at the root with `x` present would settle it.

## C-8: A `from` name that resolves to the empty path or a folder
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: P048 (it is not one of the request's files).
- Alternatives: none really.
- Should the spec pin this? no.

## C-9: Several splits of `±` / `+-` in an `expect ≈` line
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: the line is split at each `±` or `+-` in turn and the first split where both sides are JSON numbers (tolerance 0 or more, finite) is used; if none works, P010. So `1e+-5`-like oddities are decided by validity, not by the first separator.
- Alternatives: split only at the first separator.
- Should the spec pin this? no.

## C-10: `expect` line whose path is followed by something other than `=`, `≈`, `~`
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: P011 (as `expect result`, with nothing after the path, is in the spec's example). An empty path is P011 too.
- Alternatives: P009.
- Should the spec pin this? no; the examples show the cases.

## C-11: Table separator rows
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: a row is a separator when it starts with `|`, ends with `|` and holds only `|`, `-`, `:` and white space (so `|` alone and `|   |` are separators). A tab cannot occur inside a row (P001 is only for leading white space; an inner tab counts as white space and is allowed here).
- Alternatives: requiring at least one `-`.
- Should the spec pin this? no, the example with `|   |` and `|` fixes it.

## C-12: Header cell with a name but an empty tolerance after `±`
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: `result ±` has the form name-plus-tolerance with an empty tolerance, which is not a JSON number: P010 and the column has no tolerance.
- Alternatives: P013 (no form).
- Should the spec pin this? yes.

## C-13: Header cell names an input field that the op does not declare
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: any name of ASCII letters, digits, `_` and `-` that is not an expectation root is an input column, declared or not; T011 reports it later. The sentence "also when the operation declares an input field of that name" is read as: an expectation root name stays an expectation path even if the op declares a field of that name.
- Alternatives: a declared field named `result` becomes an input column.
- Should the spec pin this? yes; the sentence reads two ways.

## C-14: Which `text` lines count when a `text` clause also has words after its keyword
- Spec reference: REQ-SY-005
- Situation: ambiguous
- What I chose: the P008 for words after `text` does not discard the lines under it; they are still read as its text.
- Alternatives: ignoring the lines.
- Should the spec pin this? no.

## C-15: `on` with nothing after it
- Spec reference: REQ-SY-009
- Situation: missing
- What I chose: P033 (an empty platform is not `any`, `posix` or `windows`).
- Alternatives: treat as `any`.
- Should the spec pin this? no.

## C-16: Duplicate decision IDs and `superseded by`
- Spec reference: REQ-CK-009
- Situation: ambiguous
- What I chose: `superseded by <ID>` is valid when any decision of that ID is declared (first or later declaration), and the ID is the whole remaining text with no white space in it.
- Alternatives: only first declarations.
- Should the spec pin this? no.

## C-17: T005 counts distinct codes
- Spec reference: REQ-CK-008
- Situation: ambiguous
- What I chose: "two or more of the codes" means two or more distinct codes named; one code named twice is not enough.
- Alternatives: counting occurrences.
- Should the spec pin this? yes, one example.

## C-18: Quotation handling in T004
- Spec reference: REQ-CK-006
- Situation: ambiguous
- What I chose: each line is scanned left to right; at an opening `"`, `“` or `` ` `` the quotation runs to the next closing mark on the same line and is replaced with a space (so words next to it are still whole); an opening mark with no closing one on its line is an ordinary character. For conditions, the first line after `when` and each continuation line are lines.
- Alternatives: removing the quotation without a space.
- Should the spec pin this? no.

## C-19: Response matching for the batch run when ids repeat
- Spec reference: REQ-OR-002
- Situation: ambiguous
- What I chose: examples are matched to responses by case id only; two requirements with the same ID (T007) share responses by id.
- Alternatives: none.
- Should the spec pin this? no.

## C-20: What counts as "states no expectation" for T024
- Spec reference: REQ-OR-007
- Situation: ambiguous
- What I chose: an example with no `expect` line at all and no expectation cell in its table row.
- Alternatives: no expectation about `error`.
- Should the spec pin this? no, the examples agree.

## C-21: Judging `members` and `error` when `full` has an `error`
- Spec reference: REQ-JU-004
- Situation: ambiguous
- What I chose: when `full` has an `error` member (even `null`), `result` and `audit` of `full` are not compared; `error` requires the answer to have an own `error` member equal as JSON.
- Alternatives: none.
- Should the spec pin this? no.

## C-22: Tolerance in `result` comparison when the values are not both numbers
- Spec reference: REQ-JU-004
- Situation: missing
- What I chose: a path named in `tolerances` is compared with the tolerance only when both values are numbers; otherwise as plain JSON equality (so a string never equals a number).
- Alternatives: none.
- Should the spec pin this? no.

## C-23: `__proto__` and similar member names
- Spec reference: REQ-SU-003
- Situation: missing
- What I chose: members are defined as own data properties, so a member named `__proto__` is kept like any other.
- Alternatives: none.
- Should the spec pin this? no.

## C-24: Reading from standard input
- Spec reference: Driver protocol
- Situation: ambiguous
- What I chose: lines end at LF only; a line of only spaces and tabs is blank; other white space (for example a lone CR) does not make a line blank, so that line gets `bad_request`. A last line with no LF is answered. The driver answers each line as it arrives.
- Alternatives: treating all `\s` as blank (open in the spec).
- Should the spec pin this? no (open).

## C-25: `internal_error`
- Spec reference: OPEN-RQ-004
- Situation: missing
- What I chose: follow the reference: `{"id": <id>, "error": "internal_error"}` with details on standard error.
- Alternatives: none.
- Should the spec pin this? no.

## C-26: Comments and indented lines inside an example body
- Spec reference: REQ-SY-010, REQ-SY-011
- Situation: ambiguous
- What I chose: a line starting with `#` at any indent of 3 or more under an example is a comment (also at indent 6 when not inside an input text), and it ends an input text when its indent is under 6. Inside an input text a `#` line at indent 6 or more is text.
- Alternatives: comments only at indent 4.
- Should the spec pin this? no.

## C-27: Open items with a bad title or ID
- Spec reference: REQ-SY-006
- Situation: ambiguous
- What I chose: `section`, `req`, `open` and `decision` with a missing ID are treated as ID `""` with P005; their clauses are still read.
- Alternatives: skipping the clauses.
- Should the spec pin this? no.
