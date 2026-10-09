# C-sonnet-2: claude-sonnet-5-5, py, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 4.6 min / 20 turns / $1.00
- Isolation and audit: init_ok y; violations 0; denied calls 1; recognized reference n
- Model: `claude-sonnet-5-5` (sandbox `azkzpc`)
- Brief: the folder `C-duramen` (SPEC.md sha256 ac15b953383c, DECISIONS.md 15aa2cf18602); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 738/738 (example 675/675, evidence 52/52, property 3/3, static 5/5, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | U+02CB in dot-notation names | ? | ? |
| C-2 | Reversed ranges and bounds in I-Regexp | ? | ? |
| C-3 | Lone surrogates in a regex pattern | ? | ? |
| C-4 | Filter number literals are read as binary64 | ? | ? |
| C-5 | Non-finite or unencodable results | ? | ? |
| C-6 | Blank lines and line splitting | ? | ? |
| C-7 | Second selector error order | ? | ? |
| C-8 | Where a function argument is checked | ? | ? |
| C-9 | Blank space inside a singular query's brackets | ? | ? |
| C-10 | Regex matching strategy | ? | ? |
| C-11 | Number representation in output | ? | ? |
| C-12 | Duplicate member names in the document | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
