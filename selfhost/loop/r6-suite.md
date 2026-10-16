# R6's outside suite, sealed before the first build

[CONFIDENCE-3.md](../../CONFIDENCE-3.md)'s R6: before any build, a separate Codex session writes a
suite for duramen-core from the round-one brief (0.12.0) alone, its sha256 is pushed before the
first build, and the suite is opened after the last round.

| | |
|---|---|
| File | `outside-suite.jsonl`, 554 cases (546 single requests, 8 sessions), 400,855 bytes |
| sha256 | `e40c2c2571d9e2c98f665b4dd546cbf3979e0c5d943c8dc778c4d4e69349fb6d` |
| Writer's notes | `NOTES.md`, sha256 `09b6f9d7177a2f4f75d0c588b066d19634757b90b51d80e85ab17400c894d0ed` |
| Inputs | the 0.12.0 brief's `SPEC.md` (sha256 `54d67d72…`) and `DECISIONS.md` (`7977c490…`), and the task [`r6-task.md`](r6-task.md) (`5466e33e…`); not `PROMPT.md`, which is about building |
| Writer | Codex CLI 0.163.0, `codex exec`, model `gpt-6.1-sol` at reasoning effort `xhigh` on Craig's ChatGPT login, `workspace-write` sandbox with no network for commands, in a WSL mount namespace that shows only its folder ([`wsl/ns-run.sh`](wsl/ns-run.sh)) |
| Run | 2026-10-16, 20:22:11Z to 20:34:02Z; transcript sha256 `b45ce4d74fc6f64eff63889548c39417e1a0ad835eac9f04bab592a09b3a1efc` |
| Tokens | 1,316,927 input (1,219,968 cached), 40,882 output (9,346 reasoning) |

The suite, the notes and the transcript stay on Craig's PC, outside every builder's view, until
the last round ends; then they are committed here beside the results.

**The first attempt** (20:11Z) wrote nothing: Codex's sandbox could not start a command
(`bwrap: Can't mkdir parents for /mnt/wslg/distro/tmp/codex-daemon-0`), because the namespace hid
WSLg's view of the distro, through which the sandbox reaches `/tmp`. `ns-run.sh` now shows `/tmp`
there again, and a probe (`wsl/probe3.md`) confirmed commands run. The second attempt is the one
above, in a fresh folder.

**The audit**, by [`codex-audit.mjs`](codex-audit.mjs) reading only each command's first line:
27 commands (`sed` 30 times, `cat` 9, `python3` 5, `rg` 2, `pwd` and `wc` once, 5 others), one
of which failed; no path outside the folder; no network command; no MCP tool, web search or file
change outside the folder. Its Python scripts built the cases by hand-written helpers and checked
the format and the coverage of every `REQ-` ID; whether they computed any expected value by
running an implementation is checked when the suite is opened.

**What the person running the round has seen of it, before any build.** The first version of
the audit split every line of every command, here-documents included, and printed their first
words. Its printout, at about 20:36Z, showed fragments of the scripts that wrote the suite: case
names, the shape of the helpers, and some expected values, most of them for `judge` (verdicts
for equality, paths, tolerances and members) and a few for `cases` and the protocol. No builder
has seen any of it. It cannot change R6's verdict, which is about round eleven's builds, made from
0.12.0 before any change to the record. It could steer what the person adds to the record
between rounds, so every pin added after round eleven that touches a point those fragments
covered is listed with the results.
