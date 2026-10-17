# s28: gpt-6.1-sol, ts, duramen-core 0.14.0
- Builder: B of [CONFIDENCE-3.md](../CONFIDENCE-3.md)'s R5, codex exec (Codex CLI 0.163.0) on a ChatGPT login, reasoning effort xhigh, workspace-write sandbox with no network for commands, in a WSL mount namespace that shows only its folder (selfhost/loop/wsl/ns-run.sh)
- Trigger: round three, round thirteen (CONFIDENCE-3.md R5): builder B, from the 0.14.0 brief
- Run: 2026-10-16T21:42:47Z to 2026-10-16T22:15:58Z (33.2 min), exit 0; tokens {"input_tokens":2970761,"cached_input_tokens":2633600,"cache_write_input_tokens":0,"output_tokens":45063,"reasoning_output_tokens":9846}
- Audit: 31 commands; paths outside the folder: none; network: 0; MCP: {}; web searches: 0; file changes outside: 0; commands outside PROMPT.md's list: {}
- Brief: SPEC.md sha256 52f278f4ce9f, DECISIONS.md cd17a14bdbfa, PROMPT.md ff372957e34d
- duramen suite (beside the loop): passed 250/250

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | Direct Node driver | changes nothing a driver answers | none |
| C-2 | Native implementation and test organization | changes nothing a driver answers | none |
| C-3 | Late language declarations | open: OPEN-RC-002 | none |
| C-4 | Behavior for the rest of the language | open: OPEN-RC-001 | none |
| C-5 | Blank request lines | open: OPEN-RQ-005 | none |
| C-6 | Driver input delimiters | neither: a raw CR inside a request line | probe 7 |
| C-7 | Oracle stream files | open: OPEN-OR-001 | none |
| C-8 | Oracle file location | open: OPEN-OR-002 | none |
| C-9 | Oracle time limit | open: OPEN-RQ-001 | none |
| C-10 | Scheduling solo runs | neither: the order of the oracle's runs | probe 8 |
| C-11 | Oracle filesystem lifetime | neither: files an oracle run changes | probe 9 |
| C-12 | Child environment | neither: the oracle's environment | probe 10 |
| C-13 | Unexpected checker failures | open: OPEN-RQ-004 | none |
| C-14 | Human-readable output | open: OPEN-RQ-002 | none |
| C-15 | Unknown judge check kinds | open: OPEN-JU-001 | none |
| C-16 | Nonfinite numbers in judge requests | open: OPEN-JU-002 | none |
| C-17 | Lexical errors inside ignored bodies | neither: P001 under an open item's example, whose lines are not read | probe 11 |
| C-18 | Obligation quotation escapes | neither: escaped quotes in a rejected alternative | probe 12 |
| C-19 | Empty oracle command words | neither: an empty first word of an oracle command | probe 13 |
| C-20 | Extra request members | pinned for a case's members (REQ-JU-001); neither for the request's (probed in rounds eleven and twelve) | none new |
| C-21 | Test runner isolation | changes nothing a driver answers | none |
| C-22 | Published examples as regression fixtures | changes nothing a driver answers | none |

Triage before any answer was seen (CONFIDENCE-3.md, R5 step 3), against the 0.14.0 brief: open (an open item covers it, by ID), pinned (the brief's words or examples decide it), cannot be seen, or neither; every choice that is neither has a probe in [`probes/s27-s28.txt`](probes/s27-s28.txt), numbered in file order.
