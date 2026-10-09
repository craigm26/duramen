# C-sonnet-1: claude-sonnet-5-5, py, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 4.7 min / 17 turns / $1.06
- Isolation and audit: init_ok y; violations 0; denied calls 1; recognized reference n
- Model: `claude-sonnet-5-5` (sandbox `fwthva`)
- Brief: the folder `C-duramen` (SPEC.md sha256 ac15b953383c, DECISIONS.md 15aa2cf18602); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 738/738 (example 675/675, evidence 52/52, property 3/3, static 5/5, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | U+02CB after a dot | ? | ? |
| C-2 | Reversed ranges and bounds in I-Regexp | ? | ? |
| C-3 | Lone surrogates in I-Regexp | ? | ? |
| C-4 | Lines that are not blank but hold other white space | ? | ? |
| C-5 | Request JSON parsing | ? | ? |
| C-6 | Output encoding | ? | ? |
| C-7 | Number comparison | ? | ? |
| C-8 | Deep recursion | ? | ? |
| C-9 | Arguments of functions are parsed as terms | ? | ? |
| C-10 | Function-named literals | ? | ? |
| C-11 | Unicode category data | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
