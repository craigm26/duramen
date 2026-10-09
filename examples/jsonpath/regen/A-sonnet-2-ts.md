# A-sonnet-2: claude-sonnet-5-5, ts, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 6.8 min / 45 turns / $1.46
- Isolation and audit: init_ok y; violations 0; denied calls 1; recognized reference n
- Model: `claude-sonnet-5-5` (sandbox `bhnikk`)
- Brief: the folder `A-rfc` (SPEC.md sha256 233491fe6603, DECISIONS.md f5ed4f900ede); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 688/738 (example 631/675, evidence 47/52, property 3/3, static 5/5, protocol 2/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | Blank lines are only spaces and tabs | ? | ? |
| C-2 | Trailing and leading white space in a query is invalid | ? | ? |
| C-3 | Blank space inside singular-query brackets is accepted | ? | ? |
| C-4 | Large numbers keep their text, via RawNum | ? | ? |
| C-5 | Object member order and duplicate names | ? | ? |
| C-6 | Invalid I-Regexp makes match()/search() false | ? | ? |
| C-7 | I-Regexp is checked by my own parser | ? | ? |
| C-8 | Chars NormalChar excludes | ? | ? |
| C-9 | Single `!` only | ? | ? |
| C-10 | Function-argument typing details | ? | ? |
| C-11 | Integer range is checked for index, slice and step only | ? | ? |
| C-12 | Request-level failures that are not in the error list | ? | ? |
| C-13 | Lone surrogates | ? | ? |
| C-14 | Normalized path escapes | ? | ? |
| C-15 | Test command | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
