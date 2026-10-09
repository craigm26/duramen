# A-sonnet-1: claude-sonnet-5-5, py, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 6.4 min / 32 turns / $1.30
- Isolation and audit: init_ok y; violations 0; denied calls 2; recognized reference n
- Model: `claude-sonnet-5-5` (sandbox `whhmre`)
- Brief: the folder `A-rfc` (SPEC.md sha256 233491fe6603, DECISIONS.md f5ed4f900ede); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 689/738 (example 632/675, evidence 47/52, property 3/3, static 4/5, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | Which white space makes a request line blank | ? | ? |
| C-2 | Request lines that are not valid UTF-8 or contain NaN/Infinity | ? | ? |
| C-3 | Duplicate member names in request JSON | ? | ? |
| C-4 | Number representation | ? | ? |
| C-5 | Numbers beyond Decimal range in requests | ? | ? |
| C-6 | Whitespace at the ends of a query | ? | ? |
| C-7 | `-0` as an index, slice bound or step | ? | ? |
| C-8 | Integer range check | ? | ? |
| C-9 | Function argument typing details | ? | ? |
| C-10 | `!` applied to a comparison | ? | ? |
| C-11 | Member order of objects in results | ? | ? |
| C-12 | Regular expressions are translated to Python `re` | ? | ? |
| C-13 | Normalized path escaping of controls | ? | ? |
| C-14 | Errors other than the four codes | ? | ? |
| C-15 | Result `id` and the second error case | ? | ? |
| C-16 | Lone surrogates in queries | ? | ? |
| C-17 | Output escaping | ? | ? |
| C-18 | Reading input | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
