# Blind builds with `duramen regen`

These runs used duramen 0.2's own loop instead of the regen kit's scripts:

```
node bin/duramen.mjs regen examples/heat-engine/heat.duramen --lang ts --runs examples/heat-engine/regen \
  --run-id t06 --leak-terms examples/heat-engine/blind/tools/leak-terms.json
```

`regen` writes the brief into a fresh sandbox, checks it for leaks, runs the builder (`claude -p`
with an allow-listed environment, file and shell tools only, the language's toolchain only),
audits the transcript, copies the build here (`impl/`), scores it with the record's own suite,
and appends to `ledger.jsonl`. The choices each builder recorded are triaged by hand in the run
records (`t06-ts.md`, `t07-py.md`).

What differs from t01 to t05 (`../blind/`): the brief is heat-engine 1.1.0-slice, with evidence,
properties, result types and static checks, and the prompt is generic (`lib/regen/prompt.*.md`).
Nothing about this program is in the prompt: REGEN.json and the budgets are requirements in the
brief, checked on the implementation folder.

| run | brief | duramen suite | at 1.2.0-slice | choices | clarify | clean |
|---|---|---|---|---|---|---|
| [t06](t06-ts.md) (ts) | 1.1.0-slice | 207/207 | 209/209 | 7 | 0 | yes |
| [t07](t07-py.md) (py) | 1.1.0-slice | 207/207 | 207/209 | 9 | 1 | no |

t07 passed every case and still differed from the spec's text: for an infinite `tempF` it wrote
`"NaN"` where the exact conversion gives an infinity. `duramen agree` found it by comparing the
builds on generated requests; 1.2.0-slice pins it (D-025). Blind means the builders were not
shown the reference or earlier builds; the model may have seen similar code in training.
