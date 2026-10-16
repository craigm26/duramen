# s27: sonnet, ts, duramen-core 0.14.0
- Date / exit / duration / turns / cost: 2026-10-16 / 0 / 13.5 min / 38 turns / $2.39
- Isolation and audit: init_ok y; violations 2; denied calls 2; recognized reference n
- Model: `claude-sonnet-5-5` (sandbox `faplcf`)
- Brief: the folder `r13-brief` (SPEC.md sha256 52f278f4ce9f, DECISIONS.md cd17a14bdbfa); scored by the suite of duramen-core 0.14.0
- duramen suite: passed 250/250 (example 247/247, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | The rest of the language is accepted and not read | open: OPEN-RC-001 | none |
| C-2 | Comments are dropped before anything else reads a line | pinned for `#` lines at indent 3 or more (REQ-SY-003, REQ-SY-008); cannot be seen for a comment between the lines of a `text` | none |
| C-3 | A missing ID or title is P005 | pinned for `title` and `rejected` with nothing (REQ-SY-006: a quoted string is wanted); neither for a statement with no ID | probe 1 |
| C-4 | Request lines of other white space are answered bad_request | open: OPEN-RQ-005 | none |
| C-5 | Checks of unknown kind in `judge` | open: OPEN-JU-001; pinned that a check needs a `kind` (REQ-JU-001) | none |
| C-6 | A lone `\|` is a table separator | pinned: REQ-SY-012 example 4 | none |
| C-7 | Oracle process limits and files | open: OPEN-RQ-001, OPEN-OR-002; pinned for an oracle that exits before reading (REQ-OR-004); its standard error cannot be seen | none |
| C-8 | U+2028 and U+2029 are escaped in output | cannot be seen: results are compared as parsed JSON | none |
| C-9 | Dropped examples are not examples | cannot be seen: a P error stops the check | none |
| C-10 | `omit` of id, op and input | neither: `omit` of a member nobody sets | probe 2 |
| C-11 | Blank lines inside `errors` conditions | cannot be seen: blank lines in a condition change no diagnostic | none |
| C-12 | Text, tolerances and numbers | pinned: JSON numbers; cannot be seen for a `text` with P008 | none |
| C-13 | P001 and P007 in the body of an unknown statement | neither: P001 and P007 under an ignored clause | probe 3 |
| C-14 | Where a statement's diagnostics stand when its first line is bad | pinned: REQ-RC-004 | none |
| C-15 | Duplicate IDs and the oracle | pinned: REQ-OR-002 (the first response of an `id`) | none |
| C-16 | What counts as an example for T019 and T001 | neither: whether an open item's example is an example for T019 | probe 4 |
| C-17 | Table cells and input texts | pinned for `\|` (REQ-SY-012 example 1) and an empty header cell (example 2); neither for `?` under an input field | probe 5 |
| C-18 | Judge input details | pinned: REQ-JU-001; open for `1e400` (OPEN-JU-002) | none |
| C-19 | Path lookup on own members | pinned: REQ-OR-003, REQ-JU-002 and their examples | none |
| C-20 | Level `info` and codes the spec never defines | pinned: no rule writes `info` | none |
| C-21 | Statement keywords and names are case sensitive | pinned: examples (`Note`, `Accepted`) | none |
| C-22 | The record name for record-level diagnostics | pinned: REQ-RC-001, REQ-RC-003, REQ-RC-004 and their examples | none |
| C-23 | Timing of reading standard input | cannot be seen by the loop's runner for the timing; neither for bytes that are not UTF-8 in a name | probe 6 |

Triage before any answer was seen (CONFIDENCE-3.md, R5 step 3), against the 0.14.0 brief: open (an open item covers it, by ID), pinned (the brief's words or examples decide it), cannot be seen, or neither; every choice that is neither has a probe in [`probes/s27-s28.txt`](probes/s27-s28.txt), numbered in file order.
