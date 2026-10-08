# Blind builds from the generated brief

The language was called tilth when these runs were made, so the briefs the builders received
and the records under `runs/` use that name.

The experiment: give a blind builder the brief duramen generates from `../heat.duramen`
(`../build/SPEC.md` and `../build/DECISIONS.md`) plus `PROMPT.<lang>.md`, under the regen kit's
isolation, and score the result with duramen's generated suite and with regen-heat-engine's
hand-built suite. regen-heat-engine's r01 to r04 were built under the same protocol from the
prose brief, for the whole spec, on Windows, with the earlier launcher (blob 3b7118a, which
passed the orchestrator's environment through instead of an allow-list) and the unmodified
prompt. Blind means not shown the reference or the earlier builds; the model may still have seen
the public heat-engine sources in training.

`PROMPT.<lang>.md` is regen-heat-engine's prompt with three changes, because duramen 0.1 cannot
express requirements that are not observable through the driver: rule 3 spells out REGEN.json
(the prose brief's REQ-IF-001), rule 6 states the budgets (its REQ-BU-001 to REQ-BU-003), and
rule 1 points at rule 6 instead of the brief's budgets section.

`tools/` are copies of the regen kit's tools (MIT, Copyright (c) 2026 craigm26):
`launch-blind.sh` and `audit-transcript.mjs` from regen-rcan-assurance at ebb8281 (the kit's
current launcher, with the allow-listed environment), and `allowed-*.txt`, `leak-check.mjs`,
`leak-terms.json`, `brief-terms.md` and `score.mjs` from regen-heat-engine at 4d99222.

Results are in `runs/`.

## Results

| run | brief | sandbox | duramen suite | hand-built, slice scope | own tests | clean |
|---|---|---|---|---|---|---|
| [t01](runs/t01.md) (ts) | brief-t1 | prdycy | 105/105 | 240/240 | 19/19 | no: two `clarify` |
| [t02](runs/t02.md) (py) | brief-t1 | rpgsul | 105/105 | 240/240 | 21/21 | no: one `clarify` |
| [t03](runs/t03.md) (ts) | brief-t2 | wbcasg | 105/105 | 240/240 | 19/19 | yes |
| [t04](runs/t04.md) (ts) | brief-t3 | frlixr | 107/107 | 240/240 | 19/19 | yes |
| [t05](runs/t05.md) (py) | brief-t3 | zocenj | 107/107 | 240/240 | 15/15 | yes |

t01 to t03 also pass the brief-t3 suite, 107/107 (rescores in the ledger). "Slice scope" is
computed by [`slice-score.mjs`](slice-score.mjs): the hand-built suite's 240 cases for the
slice's five operations, its error cases that name no other operation, and its stream and static
checks. The other 124 cases are for workRest, verdict and cascade (116 result and audit cases, 3
version cases, 5 error cases). `runs/ledger.jsonl` has one entry per run and rescore, adapted
from the regen kit's format (no `suite_tree` or `branch`; transcripts are identified by SHA-256
and stay in the sandbox). `impl/` holds each builder's output as copied for scoring.
