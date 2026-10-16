# Round thirteen (CONFIDENCE-3.md, R5): s27 and s28, from duramen-core 0.14.0

Builder **A**, [s27](../s27-ts.md): `claude-sonnet-5-5` through `duramen regen`, 13.5 minutes.
Builder **B**, [s28](../s28-ts.md): `gpt-6.1-sol` at `xhigh` through the Codex CLI 0.163.0, in
the WSL namespace on Craig's PC, 33.2 minutes. Both were given the 0.14.0 brief, byte for byte
(`SPEC.md` `52f278f4…`, `DECISIONS.md` `cd17a14b…`, `PROMPT.md` `ff372957…`), and both started
at 21:42 UTC. s27's audit has two violations, both commands its harness refused (`ls /tmp`, and
writing `/tmp/fix.mjs`); nothing was read. Every request and answer is in
[`round13/`](round13/).

**Verdict: round thirteen does not pass R5.** Steps 1 and 2 pass; step 3 finds one probe record,
one reading, that splits the builds under no open item. It was the last of the three rounds, so
**K1 holds: rounds eleven to thirteen ended without one that passes R5**, and round three stops.

## Step 1

Both wrote 247 cases and 0 errors; the two suites are the same as JSON values, case for case.

## Step 2

247 of 247 in each of the four pairs of suite and answers, by both judges; the two judges gave
the same verdict all 988 times.

## Step 3

9,870 inputs: 9,000 requests for the 4,500 mutated records of seeds 1 to 3, 386 for the suite's
own 193 records, and 484 probe records (the 471 of round twelve and 13 written for this round's
choices, [`../probes/s27-s28.txt`](../probes/s27-s28.txt), before any answer to them was seen).

**A and B answer all 9,386 mutated and unmutated records alike.** They split on 27 probe
records.

**Declared: 26.** OPEN-RC-001, 10 (`s06-s07` #24; `s10-s11` #2, #3; `s12-s13` #3, #4, #5, #38,
#39, #40, #41); OPEN-RQ-001, 1 (`s14-s16` #1, the 25-second oracle, past s28's ten seconds);
OPEN-RQ-005, 11 (`s14-s16` #2 to #6; `s23-s24` #18 to #23); OPEN-JU-001, 1 (`s14-s16` #25, a
check whose kind is `1`); OPEN-RQ-003, 1 (`s14-s16` #36); OPEN-OR-001, 1 (`s23-s24` #29);
OPEN-OR-002, 1 (`s25-s26` #1, the folders above the oracle's, which it lists).

**Undeclared: 1 probe record, one reading.** *An oracle command whose first word is empty*,
`oracle "" node echo.mjs` (`s27-s28` #13): B and duramen cannot start it and give T020 and
T021; A fails on the request and answers `{"id": …, "error": "internal_error"}`. OPEN-RQ-004
leaves open what the driver answers when it fails on a request it accepted, but not whether it
may fail where REQ-OR-004 decides the answer (an oracle that cannot be started gets T020), so
this counts as undeclared. The other twelve probes of this round's choices were answered alike
by A, B and duramen.

## duramen beside the builds (for R9)

duramen answers 20 inputs otherwise than A, 32 otherwise than B, and 8 otherwise than both where
the two agree: `seed2/m663` (`check` and `cases`, a `duramen 0.2` record) and four probe records
of the rest of the language, under OPEN-RC-001; one `judge` request with a check of kind
`contains` (`s14-s16` #24), under OPEN-JU-001; and one holding `1e400` (`s17-s19` #10), under
OPEN-JU-002. R9 is judged only in a round that passes R5, and none did.

## What 0.15.0 does with it (R7)

REQ-OR-002 now says that a command whose first word is empty cannot be started, as one with an
unclosed quote cannot, and REQ-OR-004 has an example of it; decision D-026 names the round.
`duramen diff` from 0.14.0 to 0.15.0: one example added (tightening) and prose. duramen did not
change. No build has been made from 0.15.0: round three stopped at K1.

## Across the three rounds

| round | brief | suites equal | cases passing, both judges | mutated and unmutated records answered alike | probe records | split | under open items | undeclared (readings) |
|---|---|---|---|---|---|---|---|---|
| eleven | 0.12.0 | yes (243) | 972 of 972 | 9,378 of 9,378 | 443 | 31 | 15 | 16 (5) |
| twelve | 0.13.0 | yes (245) | 980 of 980 | 9,382 of 9,382 | 471 | 32 | 22 | 10 (3) |
| thirteen | 0.14.0 | yes (247) | 988 of 988 | 9,386 of 9,386 | 484 | 27 | 26 | 1 (1) |
