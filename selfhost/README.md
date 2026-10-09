# duramen, rebuilt from its own specification

[`spec/`](../spec/) is duramen-core: the core of the duramen language and two operations of the
checker, `check` (a record's diagnostics) and `cases` (the suite generated from it), written in
that core language. Its oracle is duramen itself, through `duramen serve`. This folder holds
blind builds of duramen-core from the brief `duramen build spec/` writes, and two tests that go
beyond the suite.

```
node bin/duramen.mjs check spec/
node bin/duramen.mjs regen spec/ --lang ts --runs selfhost --run-id s02 --leak-terms selfhost/leak-terms.json
node bin/duramen.mjs run spec/ --impl selfhost/impl/s01-ts
node selfhost/fixedpoint.mjs selfhost/impl/s01-ts
node selfhost/agree.mjs selfhost/impl/s01-ts --mutants 600 --seed 1
```

- **The suite** (`duramen run`): one case per example of `spec/`, and the three protocol cases.
- **The fixed point** ([`fixedpoint.mjs`](fixedpoint.mjs)): the build and duramen are each
  asked for the suite of `spec/`, sent as files in a `cases` request, with the record's oracle
  pointed at one or the other. The build is a fixed point when, with itself as the oracle, it
  writes the same suite, case for case and as JSON, as duramen writes with duramen as the
  oracle: the suite that judged it.
- **Agreement** ([`agree.mjs`](agree.mjs)): the build and duramen answer `check` and `cases`
  for mutants of the records the suite sends (lines deleted, duplicated, swapped,
  re-indented, cut short, a word or a character changed), and the answers that differ are
  grouped. A difference is a misreading, a place the specification is silent, or a mistake
  in duramen.

| run | brief | suite | rescored | fixed point | mutants answered alike | choices | already pinned | clarify | clean |
|---|---|---|---|---|---|---|---|---|---|
| [s01](s01-ts.md) (ts) | 0.2.0 | 142/142 | 141/153 at 0.3.0 | yes | 1,429 of 1,458 (15 records differ) | 19 | 1 | 1 | no |
| [s02](s02-ts.md) (ts) | 0.3.0 | 153/153 | 152/157 at 0.4.0 | yes | 1,469 of 1,480 (6 records differ) | 33 | 12 | 0 | yes |

The ledger is [`ledger.jsonl`](ledger.jsonl); the builds are in [`impl/`](impl/), copied out of
their sandboxes unchanged. Blind means the builders were not shown duramen's source or earlier
builds; it does not mean the model never saw similar code in training. (duramen's source was
first published in October 2026.)
