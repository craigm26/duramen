# Round eleven (CONFIDENCE-3.md, R5): s23 and s24, from duramen-core 0.12.0

Builder **A**, [s23](../s23-ts.md): `claude-sonnet-5-5` through `duramen regen` (Claude Code),
13.2 minutes. Builder **B**, [s24](../s24-ts.md): `gpt-6.1-sol` at reasoning effort `xhigh`
through the Codex CLI 0.163.0, in a WSL namespace on Craig's PC, 13.2 minutes. Both were given
the 0.12.0 brief, byte for byte (`SPEC.md` `54d67d72…`, `DECISIONS.md` `7977c490…`,
`PROMPT.md` `ff372957…`), and both started at 20:36 UTC on 2026-10-16. Every request and answer
is in [`round11/`](round11/), from `node selfhost/loop/round.mjs` (see
[`../loop/README.md`](../loop/README.md)).

**Verdict: round eleven does not pass R5.** Steps 1 and 2 pass; step 3 finds 16 probe records,
five readings, that split the builds under no open item.

## Step 1: each build writes the suite of spec/ with itself as the oracle

Both wrote 243 cases and 0 errors, and the two suites are the same as JSON values, case for case
(`round11/suites.json`). The suite of `spec/` has 243 cases; duramen's own runner adds three
protocol cases, which are not part of the loop.

## Step 2: both builds answer both suites, and both builds' `judge` rule

| suite | answers | passing (both judges) | verdicts the judges give differently |
|---|---|---|---|
| A's | A's | 243 of 243 | 0 |
| A's | B's | 243 of 243 | 0 |
| B's | A's | 243 of 243 | 0 |
| B's | B's | 243 of 243 | 0 |

All 972 verdicts of each judge are the same as the other's (`round11/verdicts.json`).

## Step 3: mutated records and probes, answered by A, B and duramen

9,821 inputs: 9,000 requests for the 4,500 mutated records of seeds 1 to 3 (`check` and `cases`
each), 378 for the suite's own 189 records unmutated, and 443 probe records: the 410 of rounds
five to ten and 33 written for this round's choices
([`../probes/s23-s24.txt`](../probes/s23-s24.txt)), before any answer to them was seen.

**A and B answer all 9,378 mutated and unmutated records alike.** They split on 31 probe
records.

**Declared: 15**, each under an open item of the 0.12.0 brief:
- OPEN-RC-001 (the rest of the language), 10: `returns` and `static` clauses and the
  statements `type`, `edge`, `edgedef`, `property` and `evidence`, with and without lines under
  them (`s06-s07` #24; `s08-s09` #14; `s10-s11` #2, #3; `s12-s13` #3, #4, #5, #39, #40; `s17-s19` #6).
- OPEN-RQ-001 (running time), 1: an oracle that answers after 25 seconds (`s14-s16` #1), past
  s24's five-second limit for an oracle run.
- OPEN-JU-001 (checks of other kinds), 2: a check of kind `contains`, and of kind `1`
  (`s14-s16` #24, #25).
- OPEN-RQ-003 (names a file system cannot hold), 1 (`s14-s16` #36).
- OPEN-JU-002 (numbers too large for binary64 in a judge request), 1 (`s17-s19` #10).

**Undeclared: 16 probe records, five readings.**
1. *A request line of white space other than spaces and tabs* (U+000B, U+000C, a lone CR
   before the LF, U+00A0, U+2028, U+FEFF, U+3000): A and duramen answer
   `{"id": null, "error": "bad_request"}`, B treats the line as blank and answers nothing. 11
   records (`s14-s16` #2 to #6; `s23-s24` #18 to #23). The driver protocol says "whether other
   white space makes a line blank is open", but under no `OPEN-` ID, and round three counts a
   disagreement as declared only under an open item cited by ID.
2. *`input a from"t.txt"`*, no white space between `from` and the name: A reads a `from` line;
   B and duramen read a path, P049. 1 record (`s23-s24` #3). REQ-SY-011 said "white space of
   any length before `from` and after it".
3. *`input x from "\q"`, then a line indented six*: A and duramen read an `input <path>` line
   (P049) whose text is the next line; B reads a `from` line, which takes no text, and gives the
   next line P006. 1 record (`s14-s16` #13).
4. *A `from` name that leaves the record's folder and comes back* (`../sub/t.txt` in a record
   `sub`): A and duramen follow it to `sub/t.txt`; B gives P048 as soon as it leaves. 2 records
   (`s14-s16` #14; `s23-s24` #15).
5. *The kind of file the oracle's standard input and output are*: A and duramen give it
   sockets (Node's pipes), B regular files that it writes in full before starting the oracle. 1
   record (`s23-s24` #29).

(Probe numbers count from 1 in each file's order; `round11/report.json` keys count from 0.)

## duramen beside the builds (for R9)

duramen answers 21 inputs otherwise than A, 32 otherwise than B, and 6 otherwise than both
where the two agree: a `duramen 0.2` record whose checks are open (`seed2/m660`, `check` and
`cases`) and four probe records of the rest of the language (`s10-s11` #1; `s12-s13` #38,
#41, #42), all under OPEN-RC-001. R9 is judged only in a round that passes R5.

## What 0.13.0 does with each (R7)

- Reading 1: OPEN-RQ-005, *Request lines of other white space*, naming this round and covering
  those lines only.
- Reading 5: OPEN-OR-001, *The oracle's standard input and output*, naming this round and
  covering records whose oracle reports the kind of its standard input or output.
- Readings 2, 3 and 4 are about which `input` lines are `from` lines and where a `from` name
  ends: REQ-SY-011's text now gives the `from` line in ABNF (RFC 5234), with one or more white
  space characters around `from` and a JSON string for the name, and says that only where a
  name ends counts; two new examples (8 and 9) show all three, as duramen already read them.
  Decision D-024 names the round.

`duramen diff` from 0.12.0 to 0.13.0: two examples added (tightening), two open items added
(relaxing), and prose; no operation or statement added. duramen did not change. (Its `diff`
did: it had left out an added open item whose ID a requirement also has, OPEN-OR-001 beside
REQ-OR-001, and now reports it.)

**Pins near what the person running the round saw of R6's outside suite**
([`../loop/r6-suite.md`](../loop/r6-suite.md)): its fragments named cases about `input` paths
and a `from` name that cannot leave the record's folder, near examples 8 and 9 of REQ-SY-011;
and two protocol sessions about blank lines, near OPEN-RQ-005, which declares rather than pins.
