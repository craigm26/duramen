# s25: sonnet, ts, duramen-core 0.13.0
- Date / exit / duration / turns / cost: 2026-10-16 / 0 / 14.1 min / 38 turns / $2.40
- Isolation and audit: init_ok y; violations 1; denied calls 1; recognized reference n
- Model: `claude-sonnet-5-5` (sandbox `ctfjbv`)
- Brief: the folder `r12-brief` (SPEC.md sha256 35945301d69e, DECISIONS.md 0b0aadcde492); scored by the suite of duramen-core 0.13.0
- duramen suite: passed 248/248 (example 245/245, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | Statements of the rest of the language are accepted silently | open: OPEN-RC-001 | none |
| C-2 | A `duramen` statement anywhere in the file | open: OPEN-RC-002 | none |
| C-3 | What counts as a request line to answer | open for lines of other white space (OPEN-RQ-005); pinned for a JSON line ending in CR (JSON white space) | none |
| C-4 | Oracle timeout and temporary folder | open for the time limit (OPEN-RQ-001) and for files a platform cannot write (OPEN-RQ-003); neither for where the files are put; `node` for process.execPath cannot be seen here | probe 1 |
| C-5 | Oracle standard error and environment | neither for the oracle's environment; its standard error cannot be seen | probe 2 |
| C-6 | A `..` that goes above the root in a `from` name | neither: what a `from` name that goes above the request's top folder names | probes 3, 4 |
| C-7 | Which lines end the text of an `input` block | pinned: REQ-SY-011 (only a comment at indent 0 or 2 is no line of the example) | probe 5, as a check |
| C-8 | A line indented one space or a P001 line inside a `text` clause | neither: a line indented one space inside a `text` | probe 6 |
| C-9 | Blank lines inside an `errors` condition and a `text` | cannot be seen: blank lines inside a condition or a text change no diagnostic | none |
| C-10 | `example raw '…'` needs a closing quote at the end | neither: words after a raw line's closing quote, and a quote inside it | probes 7, 8 |
| C-11 | What an `expect` line with a path and something unknown gives | neither: `expect` lines with `±` and no `≈`, or a malformed tolerance | probe 9 |
| C-12 | A table row cell count and its other cells | pinned for a lone `|` (REQ-SY-012 example 4); neither for the cells of a row with too few | probe 10 |
| C-13 | Table header cell form | neither: a header cell that repeats a column and has a tolerance of no form | probe 11 |
| C-14 | Duplicate keys in JSON in a record | neither: a member named twice in a record's JSON | probe 12 |
| C-15 | Case `line` for a raw example with a lone surrogate | neither: the suite's line for a raw example holding a lone surrogate | probe 13 |
| C-16 | `judge` with checks of an unknown kind | open: OPEN-JU-001 | none |
| C-17 | `judge` numbers | open: OPEN-JU-002 | none |
| C-18 | T-checks that read only part of a record | pinned: REQ-OR-001 ("at least one example"), REQ-SY-012 (a row is an example) | probe 14, as a check |
| C-19 | Responses with the same id in a batch run | pinned: REQ-OR-002 (of two responses with one `id`, the first) | none |
| C-20 | Duplicate-ID requirement cases | pinned: REQ-SU-001 (no suite from a record with errors) | none |
| C-21 | Order of equal diagnostics | cannot be seen: equal diagnostics are equal strings | none |
| C-22 | Status and source text for decisions | pinned: REQ-CK-009 ("exactly `superseded by <ID>`", a decision cited twice judged once) | none |
| C-23 | Order checks (T005) over the codes | neither: whether a code named twice is two of the codes | probe 15 |
| C-24 | Stdout flush and exit | cannot be seen by the loop's runner, which closes standard input before reading | none |
| C-25 | Reading an entry that is both a missing file and a prefix | pinned: REQ-RC-001 (a record named by a file is that file, whatever its name) | probe 16, as a check |

Triage before any answer was seen (CONFIDENCE-3.md, R5 step 3), against the 0.13.0 brief: open (an open item covers it, by ID), pinned (the brief's words or examples decide it), cannot be seen, or neither; every choice that is neither has a probe in [`probes/s25-s26.txt`](probes/s25-s26.txt), numbered in file order.
