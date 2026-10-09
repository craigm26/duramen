# duramen, rebuilt from its own specification

[`spec/`](../spec/) is duramen-core: the core of the duramen language and three operations of
the checker, `check` (a record's diagnostics), `cases` (the suite generated from it) and, from
0.8.0, `judge` (whether an answer passes a case), written in that core language. Its oracle is duramen itself, through `duramen serve`. This folder holds
blind builds of duramen-core from the brief `duramen build spec/` writes, and two tests that go
beyond the suite.

```
node bin/duramen.mjs check spec/
node bin/duramen.mjs regen spec/ --lang ts --runs selfhost --run-id s02 --leak-terms selfhost/leak-terms.json
node bin/duramen.mjs run spec/ --impl selfhost/impl/s01-ts
node selfhost/fixedpoint.mjs selfhost/impl/s01-ts
node selfhost/agree.mjs selfhost/impl/s01-ts --mutants 600 --seed 1
node selfhost/probe.mjs selfhost/probes/s06-s07.txt selfhost/impl/s06-ts selfhost/impl/s07-py --diff
node selfhost/agree.mjs selfhost/impl/s09-py --against selfhost/impl/s08-ts --mutants 1500 --seed 1
node selfhost/reference.mjs selfhost/impl/s08-ts selfhost/impl/s09-py selfhost/impl/s10-ts
node selfhost/judges.mjs <0.7.0 spec folder> --answers selfhost/impl/s01-ts ... --judge selfhost/impl/s12-ts
```

- **The suite** (`duramen run`): one case per example of `spec/`, and the three protocol cases.
- **The fixed point** ([`fixedpoint.mjs`](fixedpoint.mjs)): the build and duramen are each
  asked for the suite of `spec/`, sent as files in a `cases` request, with the record's oracle
  pointed at one or the other. The build is a fixed point when, with itself as the oracle, it
  writes the same suite, case for case, as duramen writes with duramen as the oracle: the
  suite that judged it.
- **Agreement** ([`agree.mjs`](agree.mjs)): the build and duramen answer `check` and `cases`
  for mutants of the records the suite sends (lines deleted, duplicated, swapped,
  re-indented, cut short, a word or a character changed), and the answers that differ are
  grouped. A difference is a misreading, a place the specification is silent, or a mistake
  in duramen.
- **Probes** ([`probe.mjs`](probe.mjs)), part of the triage: the choices builders record in
  `CHOICES.md` are tried on records written to reach them ([`probes/`](probes/)), sent to
  duramen and to the builds of the round. The mutants explore near the suite's records; the
  choices point at the corners the brief left open. (The counts in the table are against the
  duramen of the build's round; the same records at a later version give later counts.)
- **The reference** ([`reference.mjs`](reference.mjs)): a build in duramen's place. `spec/` is
  checked with its oracle pointed at the build, and the suite the build writes judges other
  builds, case by case, beside duramen's own suite. `agree.mjs --against` compares two builds
  on mutated records with duramen out of the loop.
- **The judges** ([`judges.mjs`](judges.mjs)): every earlier build's answers to a suite,
  collected once, judged by duramen and by a build's `judge` operation (0.8.0), verdict by
  verdict. s12 and s13 each gave all 2,016 answers of twelve builds to the 0.7.0 suite the
  verdict duramen gives, and named the same failed parts.

| run | brief | suite | rescored | fixed point | mutants answered alike | choices | already pinned | clarify | clean |
|---|---|---|---|---|---|---|---|---|---|
| [s01](s01-ts.md) (ts) | 0.2.0 | 142/142 | 141/153 at 0.3.0 | yes | 1,429 of 1,458 (15 records differ) | 19 | 1 | 1 | no |
| [s02](s02-ts.md) (ts) | 0.3.0 | 153/153 | 152/157 at 0.4.0 | yes | 1,469 of 1,480 (6 records differ) | 33 | 12 | 0 | yes |
| [s03](s03-py.md) (py) | 0.4.0 | 157/157 | 157/159 at 0.5.0 | yes, as JSON values | 1,469 of 1,488 (10 records differ) | 27 | 14 | 1 | no |
| [s04](s04-ts.md) (ts) | 0.5.0 | 159/159 | 159/161 at 0.6.0 | yes, as JSON values | 1,492 of 1,492; on 4,500 more, 9 records differ | 34 | 29 | 0 | yes |
| [s05](s05-py.md) (py) | 0.5.0 | 159/159 | 160/161 at 0.6.0 | yes, as JSON values | 1,492 of 1,492; on 4,500 more, the same 9 records, with s04's answers | 29 | 21 | 0 | yes |
| [s06](s06-ts.md) (ts) | 0.6.0 | 161/161 | 167/171 at 0.7.0 | yes, as JSON values | 9,888 of 9,888 (three seeds of 1,500); 49 probes, 8 differ | 23 | 12 | 0 | yes |
| [s07](s07-py.md) (py) | 0.6.0 | 161/161 | 166/171 at 0.7.0 | yes, as JSON values | 9,888 of 9,888 (three seeds of 1,500); the same probes | 28 | 18 | 0 | yes |
| [s08](s08-ts.md) (ts) | 0.7.0 | 171/171 | 186/235 at 0.8.0 | yes, as JSON values | 9,945 of 9,948 (2 records differ); 72 probes, 18 differ | 20 | 6 | 3 | no |
| [s09](s09-py.md) (py) | 0.7.0 | 171/171 | 187/235 at 0.8.0 | yes, as JSON values | 9,947 of 9,948 (1 record differs); the same probes | 35 | 19 | 3 | no |
| [s10](s10-ts.md) (ts, haiku) | 0.7.0 | 171/171 | 186/235 at 0.8.0 | yes, as text too | 9,945 of 9,948 (2 records differ); 103 probes, 26 differ | 32 | 16 | 2 | no |
| [s11](s11-ts.md) (ts, opus) | 0.7.0 | 171/171 | 183/235 at 0.8.0 | yes, as text too | 9,945 of 9,948 (2 records differ); the same probes | 43 | 10 | 11 | no |
| [s10b](s10b-ts.md) (ts, haiku 4.5) | 0.7.0 | 1/171 | | (does not start) | | 13 | | | no |
| [s12](s12-ts.md) (ts) | 0.8.0 | 235/235 | 235/235 at 0.9.0 | yes, as text too | 10,066 of 10,068 (1 record differs); 37 probes, 17 differ (7 after 55ae953) | 27 | 16 | 4 | no |
| [s13](s13-py.md) (py) | 0.8.0 | 235/235 | 235/235 at 0.9.0 | yes, as JSON values | 10,067 of 10,068 (1 record differs); 46 probes, 14 differ (9 after 55ae953) | 34 | 18 | 4 | no |
| [s14](s14-ts.md) (ts) | 0.9.0 | 235/235 | 239/239 at 0.10.0 | yes, as text too | 10,068 of 10,068; round eight's 374 probes, 27 differ, 9 undeclared | 20 | 12 | 2 | no |
| [s15](s15-py.md) (py) | 0.9.0 | 235/235 | 236/239 at 0.10.0 | yes, as JSON values | 10,067 of 10,068 (1 record differs); the same probes | 25 | 17 | 2 | no |
| [s16](s16-ts.md) (ts, opus) | 0.9.0 | 235/235 | 238/239 at 0.10.0 | yes, as text too | 10,068 of 10,068; the same probes | 35 | 18 | 6 | no |
| [s17](s17-ts.md) (ts) | 0.10.0 | 239/239 | 242/243 at 0.11.0 | yes, as text too | 10,090 of 10,092 (1 record, open); round nine's 397 probes, 32 differ, 13 undeclared | 25 | 14 | 4 | no |
| [s18](s18-py.md) (py) | 0.10.0 | 239/239 | 242/243 at 0.11.0 | yes, as JSON values | 10,090 of 10,092 (the same record); the same probes | 28 | 16 | 4 | no |
| [s19](s19-ts.md) (ts, opus) | 0.10.0 | 239/239 | 242/243 at 0.11.0 | yes, as JSON values | 10,090 of 10,092 (the same record); the same probes | 30 | 18 | 3 | no |
| [s20](s20-ts.md) (ts) | 0.11.0 | 243/243 | 245/246 at 0.12.0 | yes, as JSON values | 10,106 of 10,116 (5 records differ, 1 of them open); round ten's 410 probes, 22 differ, 3 undeclared | 22 | 14 | 1 | no |
| [s21](s21-py.md) (py) | 0.11.0 | 243/243 | 245/246 at 0.12.0 | yes, as JSON values | 10,112 of 10,116 (2 records, 1 open); the same probes | 25 | 20 | 0 | no |
| [s22](s22-ts.md) (ts, opus) | 0.11.0 | 243/243 | 245/246 at 0.12.0 | yes, as JSON values | 10,110 of 10,116 (3 records, 1 open); the same probes | 26 | 15 | 1 | no |

A probe differs when its checkers do not all answer it alike: duramen and every build of the
round (five checkers in round six, three in rounds five and seven, four in rounds eight to
ten), with duramen as the round found it. From round eight, for [CONFIDENCE-2.md](../CONFIDENCE-2.md)'s
claim 8, a round's probes are every probe file so far, and a difference is *declared* when an
open item of the round's brief covers it; [`converge.mjs`](converge.mjs) runs a round's
checkers, mutants and pairs, and [`rounds/`](rounds/) holds each round's reports.
Each build is compared with the duramen of its own round: the fixed point and the agreement are
measured against the version of `spec/` it was built from (git: 0.2.0 at 63ff35a, 0.3.0 at
66b0b61, 0.4.0 at ee98e4b, 0.5.0 at b016ec0, 0.6.0 at 78ecd48, 0.7.0 at e39579d, 0.8.0 at c6d499d,
0.9.0 at 92dfcec, 0.10.0 at fb8f843, 0.11.0 at 4ca0ab7). s01 to s09
were built by `claude-sonnet-5-5`; s10, s10b and s11 by the models named, for
[CONFIDENCE.md](../CONFIDENCE.md)'s claim 2; from s14 on, each round is two `claude-sonnet-5-5`
builds and one `claude-opus-5-5` build. From s08 on, the rescored column counts the 44
cases of `judge`, an operation the earlier versions did not have. From s03 on, suites and answers
are compared as JSON values, member order ignored, as the specification compares results; s01's
and s02's were identical as text too.

The ledger is [`ledger.jsonl`](ledger.jsonl); the builds are in [`impl/`](impl/), copied out of
their sandboxes unchanged. Blind means the builders were not shown duramen's source or earlier
builds; it does not mean the model never saw similar code in training. (duramen's source was
first published in October 2026.)
