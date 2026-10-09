# B-sonnet-2: claude-sonnet-5-5, py, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 5.9 min / 16 turns / $1.16
- Isolation and audit: init_ok y; violations 0; denied calls 0; recognized reference n
- Model: `claude-sonnet-5-5` (sandbox `eutgod`)
- Brief: the folder `B-markdown` (SPEC.md sha256 d3b3d2dc460c, DECISIONS.md 672321cf7696); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 693/738 (example 635/675, evidence 47/52, property 3/3, static 5/5, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | Spec and DECISIONS refer to files that are not present | ? | ? |
| C-2 | Number representation and output | ? | ? |
| C-3 | Length and count results are numbers built from integers | ? | ? |
| C-4 | Non-UTF-8 input lines | ? | ? |
| C-5 | Non-standard JSON in requests | ? | ? |
| C-6 | Output string encoding | ? | ? |
| C-7 | Trailing CR stripping | ? | ? |
| C-8 | Bare literal as a function argument | ? | ? |
| C-9 | Type check order versus syntax errors | ? | ? |
| C-10 | Duplicate keys and key order with the host JSON parser | ? | ? |
| C-11 | Regex quantifier size | ? | ? |
| C-12 | Deep nesting | ? | ? |
| C-13 | Integer syntax with huge digit strings | ? | ? |
| C-14 | Whitespace around `?` and inside filters inside nested brackets | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
