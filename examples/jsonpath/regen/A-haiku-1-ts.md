# A-haiku-1: claude-haiku-5-5, ts, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 15.2 min / 52 turns / $0.90
- Isolation and audit: init_ok y; violations 0; denied calls 1; recognized reference n
- Model: `claude-haiku-5-5` (sandbox `ltznvj`)
- Brief: the folder `A-rfc` (SPEC.md sha256 233491fe6603, DECISIONS.md f5ed4f900ede); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 693/738 (example 635/675, evidence 47/52, property 3/3, static 5/5, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | Which lines are blank | ? | ? |
| C-2 | Line endings on input | ? | ? |
| C-3 | A final line with no LF | ? | ? |
| C-4 | Byte order mark | ? | ? |
| C-5 | Invalid UTF-8 on standard input | ? | ? |
| C-6 | Number text and exact comparison | ? | ? |
| C-7 | Duplicate member names in the document | ? | ? |
| C-8 | Member order for objects | ? | ? |
| C-9 | Literal numbers and operands outside the I-JSON range | ? | ? |
| C-10 | Unknown function names | ? | ? |
| C-11 | Function arguments that could parse more than one way | ? | ? |
| C-12 | I-Regexp automaton size limit | ? | ? |
| C-13 | I-Regexp matching algorithm | ? | ? |
| C-14 | Range quantifiers with minimum above maximum | ? | ? |
| C-15 | Lone surrogates | ? | ? |
| C-16 | Deep nesting and unexpected internal errors | ? | ? |
| C-17 | Test command and package.json | ? | ? |
| C-18 | Output escaping of ids and paths | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
