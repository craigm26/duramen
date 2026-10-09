# C-sonnet-2: claude-sonnet-5-5, ts, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 5.4 min / 23 turns / $1.15
- Isolation and audit: init_ok y; violations 0; denied calls 0; recognized reference n
- Model: `claude-sonnet-5-5` (sandbox `covpqu`)
- Brief: the folder `C-duramen` (SPEC.md sha256 ac15b953383c, DECISIONS.md 15aa2cf18602); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 738/738 (example 675/675, evidence 52/52, property 3/3, static 5/5, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | U+02CB in dot-notation names | ? | ? |
| C-2 | Lone surrogates in the query or the document | ? | ? |
| C-3 | Character class ranges and quantifier bounds in the wrong order | ? | ? |
| C-4 | Blank lines and line endings in the request stream | ? | ? |
| C-5 | `invalid_query` is decided by the parser only | ? | ? |
| C-6 | Number literals and document numbers | ? | ? |
| C-7 | Deep nesting | ? | ? |
| C-8 | Which requests count as `bad_request` for `input` | ? | ? |
| C-9 | Regex implementation | ? | ? |
| C-10 | Singular check covers blank space only inside brackets | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
