# Choices

## C-1: Statements of the rest of the language are accepted silently
- Spec reference: OPEN-RC-001, REQ-SY-002
- Situation: ambiguous
- What I chose: `type`, `edge`, `edgedef`, `property` and `evidence` are known keywords: no P002, and their bodies are skipped without any diagnostic. The `returns` and `static` clauses are not taken by `op` and `req`, so they get P015.
- Alternatives: read their clauses with some grammar of my own; give P002 to them.
- Should the spec pin this? no, it is an open item.

## C-2: A `duramen` statement anywhere in the file
- Spec reference: OPEN-RC-002, REQ-RC-003
- Situation: ambiguous
- What I chose: the statement may come after other statements; P020 is only for a file with no `duramen` statement at all, and the first one is the file's version wherever it stands.
- Alternatives: require it first.
- Should the spec pin this? no, open.

## C-3: What counts as a request line to answer
- Spec reference: Driver protocol, OPEN-RQ-005
- Situation: ambiguous
- What I chose: a line of only spaces and tabs (including empty) gets no response. Any other line (a CR before the LF, U+00A0 and so on) is parsed like any line, so a line of only such white space gets `bad_request` and a JSON line ending in CR is answered normally. Lines are split at LF only.
- Alternatives: treat all `\s` as blank.
- Should the spec pin this? no, open item.

## C-4: Oracle timeout and temporary folder
- Spec reference: REQ-OR-004, OPEN-RQ-001, OPEN-RQ-003
- Situation: missing
- What I chose: an oracle run that takes more than 30 seconds is killed and gets T020. The request's files are written into a fresh temporary folder (under the OS temp dir) and the oracle is started there, in the folder of the file holding the `oracle` statement; the folder is removed afterwards. A file that cannot be written is skipped. A command whose first word is `node` starts the running Node.js binary (`process.execPath`) instead of searching the path.
- Alternatives: a shorter or no timeout; running in a shared folder; resolving `node` through PATH.
- Should the spec pin this? no (open), though a time limit would help a tester.

## C-5: Oracle standard error and environment
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: the oracle's standard error is discarded and its environment is the driver's.
- Alternatives: pass it through to the driver's standard error.
- Should the spec pin this? no.

## C-6: A `..` that goes above the root in a `from` name
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: `..` at the root of the request's files stays at the root (as on POSIX), so `../x` from a root file names `x`. For a record folder `r`, such a name is a file only if it is a file of the request inside `r`. A name that resolves to the root itself is no file, so P048.
- Alternatives: P048 for any name that leaves the files.
- Should the spec pin this? yes, the text says "where the name ends is what counts", which does not say what ends above the root.

## C-7: Which lines end the text of an `input` block
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: only a comment at indent 0 or 2, a line indented one space and a P001 line are transparent. A comment at indent 3, 4 or 5 ends the text (it is a line of the example that is neither blank nor indented six); a comment indented six or more is text. A text that has no non-blank line gets P049.
- Alternatives: let every comment be transparent.
- Should the spec pin this? yes: "comment" is used for lines at several indents.

## C-8: A line indented one space or a P001 line inside a `text` clause
- Spec reference: REQ-SY-003, REQ-SY-005
- Situation: missing
- What I chose: a P007 line (indent 1) is reported and skipped everywhere; inside a `text` it does not end the text and is not part of it, as the spec says for input texts. An indent-2 comment between text lines is also skipped and does not end the text.
- Alternatives: end the text there.
- Should the spec pin this? no (the record has errors in these cases anyway, only the later diagnostics could differ).

## C-9: Blank lines inside an `errors` condition and a `text`
- Spec reference: REQ-SY-005, REQ-SY-008
- Situation: missing
- What I chose: blank lines under a condition are kept as empty lines of its text (they matter to nothing), and the extra indentation beyond four spaces is kept.
- Alternatives: drop them.
- Should the spec pin this? no.

## C-10: `example raw '…'` needs a closing quote at the end
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: after `raw`, a `'` form must start with `'` and end with `'` and be at least two characters; anything else is P004. "The text between the first and the last `'`" is therefore the whole of the rest without its two quotes (so inner quotes are kept).
- Alternatives: allow text after the last quote and ignore it.
- Should the spec pin this? no.

## C-11: What an `expect` line with a path and something unknown gives
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: after the path, a line whose next non-white-space character is not `=`, `≈` or `~` (or that has no path) is P011, as is `expect result` alone. `expect result ±1` is P011. The text after `≈`/`~` must match `<number> <±|+-> <number>` exactly (white space optional) or P010; a tolerance of `-0` is 0.
- Alternatives: P010 for any malformed approx line without a `≈`.
- Should the spec pin this? no.

## C-12: A table row cell count and its other cells
- Spec reference: REQ-SY-012
- Situation: missing
- What I chose: a row whose number of cells differs from the header gets P014 and its cells are not read otherwise. Cells are split at unescaped `|`; `\|` is a pipe; any other backslash is kept; the last cell may be unclosed. A lone `|` row is a separator.
- Alternatives: read the cells that exist.
- Should the spec pin this? yes for the lone `|` and the P014 consequence: example 4 of REQ-SY-012 only implies them.

## C-13: Table header cell form
- Spec reference: REQ-SY-012
- Situation: ambiguous
- What I chose: the name runs to the first white space, `±` or `+-`; the rest, if not empty, must start with `±` or `+-` (after white space) and is the tolerance, else the cell is of no form (P013). An empty tolerance after `±` is P010. A header cell naming a column twice is checked after the form and before the tolerance.
- Alternatives: a different order of the checks in one cell.
- Should the spec pin this? no.

## C-14: Duplicate keys in JSON in a record
- Spec reference: REQ-SU-003
- Situation: missing
- What I chose: JSON is read with `JSON.parse`, so a repeated member keeps its first place and its last value; all such values are rewritten with `JSON.stringify` where the spec says so. Verbatim input text is sent as written.
- Alternatives: report a repeated member.
- Should the spec pin this? no.

## C-15: Case `line` for a raw example with a lone surrogate
- Spec reference: REQ-OR-002, REQ-SU-002
- Situation: ambiguous
- What I chose: the raw line in a case is the line as read (a lone surrogate is kept in the string and written by `JSON.stringify` as `\udXXX`), while the bytes sent to the oracle have U+FFFD in its place.
- Alternatives: put U+FFFD in the case line too.
- Should the spec pin this? yes: the suite is what other implementations are sent.

## C-16: `judge` with checks of an unknown kind
- Spec reference: REQ-JU-001, OPEN-JU-001
- Situation: ambiguous
- What I chose: a check needs a string `path` and a string `kind`; a kind other than `eq` and `approx` is accepted and never holds (so it is listed in `failed`). A `kind` that is missing or not a string is `bad_request`. `full.result` and `full.error` may hold anything.
- Alternatives: `bad_request` for unknown kinds; ignore them.
- Should the spec pin this? no, open.

## C-17: `judge` numbers
- Spec reference: REQ-JU-003, OPEN-JU-002
- Situation: missing
- What I chose: the request is parsed with `JSON.parse`, so a number like `1e400` is read as infinity and compared like any number; it is not refused.
- Alternatives: `bad_request`.
- Should the spec pin this? no, open.

## C-18: T-checks that read only part of a record
- Spec reference: REQ-CK-004, REQ-OR-001
- Situation: ambiguous
- What I chose: "has at least one example" for T019 counts examples and table rows, including those of undeclared operations. The input of an example for T010/T011 is the object of its JSON text (plus its `input` lines), or `{}`.
- Alternatives: count only runnable examples.
- Should the spec pin this? no.

## C-19: Responses with the same id in a batch run
- Spec reference: REQ-OR-002
- Situation: missing
- What I chose: cases are matched to responses by `id`; two requirements with the same ID (already T007) therefore share the first response of that id.
- Alternatives: match by position.
- Should the spec pin this? no.

## C-20: Duplicate-ID requirement cases
- Spec reference: REQ-SU-002, REQ-CK-002
- Situation: missing
- What I chose: nothing special: a record with T007 has errors, so no suite is listed.
- Alternatives: none.
- Should the spec pin this? no.

## C-21: Order of equal diagnostics
- Spec reference: REQ-RC-006
- Situation: missing
- What I chose: diagnostics equal in file, line, code and level keep the order they were found in (they are equal strings anyway).
- Alternatives: none.
- Should the spec pin this? no.

## C-22: Status and source text for decisions
- Spec reference: REQ-CK-009
- Situation: ambiguous
- What I chose: the `status` text is what follows the keyword (trailing white space is already removed); its first word is split at white space; `superseded by <ID>` must match `^superseded by (\S+)$` exactly and the ID must be declared. A `decision` clause of a requirement may list IDs separated by commas and/or white space and repeated names are one citation.
- Alternatives: none obvious.
- Should the spec pin this? no.

## C-23: Order checks (T005) over the codes
- Spec reference: REQ-CK-008
- Situation: ambiguous
- What I chose: "two or more of the codes" means two distinct codes of the first `errors` list, each matching as a whole word with the stricter boundary (also `-`); the phrase boundary uses only letters, digits and `_`. The check runs over the requirement's one `text` clause.
- Alternatives: count each occurrence.
- Should the spec pin this? no.

## C-24: Stdout flush and exit
- Spec reference: Driver protocol
- Situation: missing
- What I chose: requests are answered one at a time as lines arrive (so an interactive runner works); the driver exits 0 by letting the event loop end after the last response, and any internal failure answers `internal_error` with the details on standard error.
- Alternatives: read all input first.
- Should the spec pin this? no.

## C-25: Reading an entry that is both a missing file and a prefix
- Spec reference: REQ-RC-001
- Situation: ambiguous
- What I chose: an `entry` that is the exact name of a file is a file record (even if it ends in `.duramen` or not); otherwise it is a folder and the record is every `.duramen` file under `entry/` (whose names, below the folder, hold no part starting with `.` and no folder named `build` or `node_modules`). A name of the file itself that starts with `.` is also left out, as the spec says "every file ... whose name starts with `.`".
- Alternatives: none.
- Should the spec pin this? no.
