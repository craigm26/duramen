# Blind builds from the generated brief

The experiment: give a blind builder the brief tilth generates from `../heat.tilth`
(`../build/SPEC.md` and `../build/DECISIONS.md`) plus `PROMPT.<lang>.md`, under the regen kit's
isolation, and score the result with tilth's generated suite and with regen-heat-engine's
hand-built suite. regen-heat-engine's r01 to r04 were built the same way from the prose brief.

`PROMPT.<lang>.md` is regen-heat-engine's prompt with three changes, because tilth 0.1 cannot
express requirements that are not observable through the driver: rule 3 spells out REGEN.json
(the prose brief's REQ-IF-001), rule 6 states the budgets (its REQ-BU-001 to REQ-BU-003), and
rule 1 points at rule 6 instead of the brief's budgets section.

`tools/` are copies of the regen kit's tools (MIT, Copyright (c) 2026 craigm26):
`launch-blind.sh` and `audit-transcript.mjs` from regen-rcan-assurance at ebb8281 (the kit's
current launcher, with the allow-listed environment), and `allowed-*.txt`, `leak-check.mjs`,
`leak-terms.json`, `brief-terms.md` and `score.mjs` from regen-heat-engine at 4d99222.

Results are in `runs/`.
