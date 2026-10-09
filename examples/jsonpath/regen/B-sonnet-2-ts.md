# B-sonnet-2: claude-sonnet-5-5, ts, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 4.5 min / 23 turns / $1.05
- Isolation and audit: init_ok y; violations 0; denied calls 0; recognized reference n
- Model: `claude-sonnet-5-5` (sandbox `cafvuf`)
- Brief: the folder `B-markdown` (SPEC.md sha256 d3b3d2dc460c, DECISIONS.md 672321cf7696); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 693/738 (example 635/675, evidence 47/52, property 3/3, static 5/5, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | REGEN.json test command uses a glob, not a folder | ? | ? |
| C-2 | package.json is present, with scripts only | ? | ? |
| C-3 | Document numbers are kept as raw text | ? | ? |
| C-4 | Rules for classifying function arguments | ? | ? |
| C-5 | Literals inside logical combinations | ? | ? |
| C-6 | Whitespace line handling | ? | ? |
| C-7 | Limit on nesting depth | ? | ? |
| C-8 | Regexp backtracking | ? | ? |
| C-9 | `\p{Cs}` is rejected | ? | ? |
| C-10 | Singular-query tightness check | ? | ? |
| C-11 | Number literal cut-off in filters | ? | ? |
| C-12 | Unknown function names and name syntax | ? | ? |
| C-13 | Stdout flushing | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
