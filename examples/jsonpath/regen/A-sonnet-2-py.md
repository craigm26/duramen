# A-sonnet-2: claude-sonnet-5-5, py, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 5.9 min / 34 turns / $1.25
- Isolation and audit: init_ok y; violations 0; denied calls 2; recognized reference n
- Model: `claude-sonnet-5-5` (sandbox `lhibzy`)
- Brief: the folder `A-rfc` (SPEC.md sha256 233491fe6603, DECISIONS.md f5ed4f900ede); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 689/738 (example 631/675, evidence 47/52, property 3/3, static 5/5, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | Other white space on a "blank" line | ? | ? |
| C-2 | Lines that are not valid UTF-8 | ? | ? |
| C-3 | Non-standard JSON in requests | ? | ? |
| C-4 | Number representation | ? | ? |
| C-5 | Leading and trailing white space in a query | ? | ? |
| C-6 | White space inside shorthand segments | ? | ? |
| C-7 | Lone surrogates in queries | ? | ? |
| C-8 | Lone surrogates in documents | ? | ? |
| C-9 | Output encoding | ? | ? |
| C-10 | Unknown functions and wrong argument counts | ? | ? |
| C-11 | Type checking of function arguments | ? | ? |
| C-12 | Integer range checks | ? | ? |
| C-13 | Order of children of objects | ? | ? |
| C-14 | Invalid I-Regexp in match and search | ? | ? |
| C-15 | I-Regexp matching engine | ? | ? |
| C-16 | Deep nesting | ? | ? |
| C-17 | Duplicate name handling and `id` checks | ? | ? |
| C-18 | Multiple selectors that overlap, and error scope | ? | ? |
| C-19 | Test command and layout | ? | ? |
| C-20 | What counts as a test for each MUST | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
