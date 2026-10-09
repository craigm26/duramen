# A-haiku-2: claude-haiku-5-5, ts, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 13 min / 48 turns / $0.95
- Isolation and audit: init_ok y; violations 0; denied calls 1; recognized reference n
- Model: `claude-haiku-5-5` (sandbox `ocirdl`)
- Brief: the folder `A-rfc` (SPEC.md sha256 233491fe6603, DECISIONS.md f5ed4f900ede); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 692/738 (example 634/675, evidence 47/52, property 3/3, static 5/5, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | Which lines are blank | ? | ? |
| C-2 | Line framing and CR | ? | ? |
| C-3 | The error code for overflow | ? | ? |
| C-4 | Numbers keep their source text | ? | ? |
| C-5 | Which numbers count as outside the exact range | ? | ? |
| C-6 | Out-of-range numbers in a query literal | ? | ? |
| C-7 | An unknown function name | ? | ? |
| C-8 | Wrong number of function arguments | ? | ? |
| C-9 | White space inside a singular query | ? | ? |
| C-10 | A bare literal as a function argument | ? | ? |
| C-11 | An invalid I-Regexp range or class range | ? | ? |
| C-12 | Resource limits on I-Regexp matching | ? | ? |
| C-13 | An I-Regexp the JavaScript engine rejects | ? | ? |
| C-14 | Member order for wildcards, filters and descendants | ? | ? |
| C-15 | Duplicate member names | ? | ? |
| C-16 | Lone surrogates in a query | ? | ? |
| C-17 | Lone surrogates in a document | ? | ? |
| C-18 | Strictness of the request JSON | ? | ? |
| C-19 | Build, test and module setup | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
