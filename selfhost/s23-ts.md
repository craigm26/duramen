# s23: sonnet, ts, duramen-core 0.12.0
- Date / exit / duration / turns / cost: 2026-10-16 / 0 / 13.2 min / 33 turns / $2.32
- Isolation and audit: init_ok y; violations 0; denied calls 1; recognized reference n
- Model: `claude-sonnet-5-5` (sandbox `ewzagc`)
- Brief: the folder `r11-brief` (SPEC.md sha256 54d67d729a86, DECISIONS.md 7977c4907b4a); scored by the suite of duramen-core 0.12.0
- duramen suite: passed 246/246 (example 243/243, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | Statements of the rest of the language | open: OPEN-RC-001 | none |
| C-2 | What the oracle is run against: a temporary folder | neither: where the request's files are put for the oracle is not said | probes 1, 2 |
| C-3 | Oracle time limit, and `node` | open for the time limit (OPEN-RQ-001); pinned for a closed pipe (REQ-OR-004 lists the failures); `node` for process.execPath cannot be seen here | probe 33 (a pipe the oracle leaves unread) |
| C-4 | Unknown kinds of check in `judge` | open: OPEN-JU-001 | none |
| C-5 | `judge` requires `full` and `answer` to be present | pinned: REQ-JU-001's examples | none |
| C-6 | `from` with white space | neither: "white space of any length" before and after `from`, read as allowing none | probes 3 to 5 |
| C-7 | An input text that holds only blank lines | neither: a text of blank lines only, at once at its start (kept) and at its end (dropped) | probe 6 |
| C-8 | A statement without an ID | neither: a statement with no ID | probe 7 |
| C-9 | Lines under an unknown statement | neither: P001 and P007 in an ignored body | probe 8 |
| C-10 | An empty `contract` counts for P052 | neither: D-017 says an empty `contract` "is none" | probe 9 |
| C-11 | The oracle statement's `source` clause | neither: `source` of `oracle` is not in the once-only list, and nothing says more | probe 10 |
| C-12 | Obligation words in an error condition | neither: whether an error's code is part of its condition | probe 11 |
| C-13 | Clause lines that are comments at indent three or more | neither: whether a `#` line at indent 3, 5 or 7 under an example or a table is a comment | probe 12 |
| C-14 | `expect` lines with a character after the path that is no operator | neither: `expect <path> <word>` | probe 13 |
| C-15 | A text clause's lines when it also has a problem | cannot be seen: a P error stops the check (REQ-RC-005) | none |
| C-16 | `input` lines of an example: text taken even when the path is bad | neither: the text under an `input` line whose path is malformed | probe 14 |
| C-17 | A `from` name that leaves the request | neither: a `from` name that goes above the request's top folder | probes 15 to 17 |
| C-18 | Which whitespace-only lines the driver skips | neither by round three's rule: the driver protocol says which other white space makes a line blank "is open", but under no OPEN- ID | probes 18 to 23 |
| C-19 | Failures of the checker itself | open: OPEN-RQ-004 | none |
| C-20 | Where a table's header problems are reported | pinned: REQ-SY-012's examples | none |
| C-21 | Level `info` | pinned: no rule writes `info` | none |
| C-22 | Request members when an operation is declared twice | pinned: REQ-CK-002 (the first operation of a name) | none |
| C-23 | The `platform` of an invalid `on` | cannot be seen: P033 stops the check | none |

Triage before any answer was seen (CONFIDENCE-3.md, R5 step 3): open (an open item covers it, by ID), pinned (the brief's words or examples decide it), cannot be seen, or neither; every choice that is neither has a probe in [`probes/s23-s24.txt`](probes/s23-s24.txt), numbered in file order.
