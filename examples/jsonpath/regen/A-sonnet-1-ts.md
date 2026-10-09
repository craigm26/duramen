# A-sonnet-1: claude-sonnet-5-5, ts, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 5.2 min / 28 turns / $1.15
- Isolation and audit: init_ok y; violations 0; denied calls 1; recognized reference n
- Model: `claude-sonnet-5-5` (sandbox `uxtlqc`)
- Brief: the folder `A-rfc` (SPEC.md sha256 233491fe6603, DECISIONS.md f5ed4f900ede); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 690/738 (example 632/675, evidence 47/52, property 3/3, static 5/5, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | Blank lines | ? | ? |
| C-2 | Numbers keep their exact lexeme | ? | ? |
| C-3 | Order of object members | ? | ? |
| C-4 | Invalid JSON line / non-object request | ? | ? |
| C-5 | Whitespace in queries | ? | ? |
| C-6 | "-0" as an integer | ? | ? |
| C-7 | Lone surrogates | ? | ? |
| C-8 | Hex digits case in `\u` escapes | ? | ? |
| C-9 | Index and slice range | ? | ? |
| C-10 | Function argument typing | ? | ? |
| C-11 | Regexp engine | ? | ? |
| C-12 | Invalid regexp in a literal pattern | ? | ? |
| C-13 | Comparison of `<=`/`>=` on non-comparable values | ? | ? |
| C-14 | Failure modes beyond the listed errors | ? | ? |
| C-15 | Test command and layout | ? | ? |
| C-16 | Normalized path for escaped control characters | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
