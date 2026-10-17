# Round twelve (CONFIDENCE-3.md, R5): s25 and s26, from duramen-core 0.13.0

Builder **A**, [s25](../s25-ts.md): `claude-sonnet-5-5` through `duramen regen`, 14.1 minutes.
Builder **B**, [s26](../s26-ts.md): `gpt-6.1-sol` at `xhigh` through the Codex CLI 0.163.0, in
the WSL namespace on Craig's PC, 10.9 minutes. Both were given the 0.13.0 brief, byte for byte
(`SPEC.md` `35945301…`, `DECISIONS.md` `0b0aadcd…`, `PROMPT.md` `ff372957…`), and both started
at 21:15 UTC. s25's audit has one violation: a command its harness refused, a listing of the
sandbox folder above its work folder; nothing was read. Every request and answer is in
[`round12/`](round12/).

**Verdict: round twelve does not pass R5.** Steps 1 and 2 pass; step 3 finds 10 probes, three
readings, that split the builds under no open item.

## Step 1

Both wrote 245 cases and 0 errors; the two suites are the same as JSON values, case for case.

## Step 2

Each build answered each suite, and both judges passed every case: 245 of 245 in each of the
four pairs of suite and answers, and the two judges gave the same verdict all 980 times.

## Step 3

9,853 inputs: 9,000 requests for the 4,500 mutated records of seeds 1 to 3, 382 for the suite's
own 191 records, and 471 probes, 437 records, 12 `judge` requests and 22 protocol sessions (the
443 of round eleven and 28 written for this round's choices,
[`../probes/s25-s26.txt`](../probes/s25-s26.txt), before any answer to them was seen).

**A and B answer alike all 9,382 requests for the 4,691 mutated and unmutated records.** They
split on 32 probes. (4,260 of the mutated records are distinct and differ from every unmutated
one; 137 are the same as an unmutated record and 103 repeat an earlier mutant.)

**Declared: 22.** OPEN-RC-001, 7 (`s06-s07` #24; `s10-s11` #2, #3; `s12-s13` #4, #5, #39, #40);
OPEN-RQ-001, 1 (`s14-s16` #1, the 25-second oracle, past s26's five seconds); OPEN-RQ-005, 11
(`s14-s16` #2 to #6; `s23-s24` #18 to #23), the request lines of other white space, which it
lists; OPEN-JU-001, 1 (`s14-s16` #24); OPEN-RQ-003, 1 (`s14-s16` #36); OPEN-OR-001, 1
(`s23-s24` #29), the kind of the oracle's standard input and output, which it lists.

**Undeclared: 10 probes, three readings.**
1. *A `..` in the request's top folder*, as `../t.txt` from a file at the top: A stays in the
   top folder, as a POSIX path does, and reads `t.txt`; B and duramen name no file, P048. 5
   records (`s12-s13` #6; `s17-s19` #18; `s23-s24` #16; `s25-s26` #3, #4). In round eleven both
   builds gave P048 here; 0.13.0's "where the name ends is what counts" did not say what is above
   the top folder.
2. *A `from` name that ends in `/`*, as `sub/f.txt/`: A and duramen skip the empty last part, as
   REQ-SY-011 says empty parts are; B gives P048. 3 records (`s08-s09` #43, #45; `s12-s13` #7,
   its last line).
3. *Where the request's files are put to run the oracle*: B puts them in a folder inside its own
   implementation's folder, so an oracle that looks one folder up finds `REGEN.json`,
   `driver.ts` and `package.json`; A and duramen use the system's temporary folder. 2 records
   (`s23-s24` #1; `s25-s26` #1).

## duramen beside the builds (for R9)

duramen answers 24 inputs otherwise than A, 35 otherwise than B, and 10 otherwise than both where
the two agree: `seed2/m664` (`check` and `cases`, a `duramen 0.2` record) and seven probe records
of the rest of the language, all under OPEN-RC-001, and one `judge` request holding `1e400`
(`s17-s19` #10), under OPEN-JU-002.

## What 0.14.0 does with each (R7)

- Reading 1: REQ-SY-011 now says that a `..` in the request's top folder names no folder, so
  the name names no file (P048), in its text and in the comment of its grammar for file names;
  example 11 shows `../t.txt` and `sub/../../t.txt`.
- Reading 2: example 10 shows `sub/f.txt/` read as `sub/f.txt`, as the words already said
  (empty parts are skipped); the grammar's comment now says a name may end in `/`.
- Reading 3: OPEN-OR-002, *Where the request's files are put for the oracle*, naming this round
  and covering records whose oracle looks above the request's top folder.
- Decision D-025 names the round.

`duramen diff` from 0.13.0 to 0.14.0: two examples added (tightening), one open item added
(relaxing), and prose; no operation or statement added. duramen did not change.

**Pins near what the person running the round saw of R6's outside suite**: the fragments named a
case about a `from` name that cannot leave the record's folder, near examples 10 and 11.

Readings 1 and 2 are P048, a P code, so by R5's rule they are syntax: REQ-SY-011's grammar for
file names (ABNF, added in 0.13.0) covers how a name is written, and where a name ends is stated
in words beside it and shown by the examples; a grammar of the written form cannot say what
folder a name reaches.
