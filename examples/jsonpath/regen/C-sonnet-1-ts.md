# C-sonnet-1: claude-sonnet-5-5, ts, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 5.3 min / 26 turns / $1.24
- Isolation and audit: init_ok y; violations 0; denied calls 1; recognized reference n
- Model: `claude-sonnet-5-5` (sandbox `mopbbb`)
- Brief: the folder `C-duramen` (SPEC.md sha256 ac15b953383c, DECISIONS.md 15aa2cf18602); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 738/738 (example 675/675, evidence 52/52, property 3/3, static 5/5, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | U+02CB in dot-notation names | ? | ? |
| C-2 | Blank lines in the driver protocol | ? | ? |
| C-3 | Last line without a final LF | ? | ? |
| C-4 | Responses are streamed per line | ? | ? |
| C-5 | Request validity beyond the listed checks | ? | ? |
| C-6 | Regular expressions are translated to JavaScript RegExp | ? | ? |
| C-7 | Out-of-order bounds and ranges | ? | ? |
| C-8 | Lone surrogates | ? | ? |
| C-9 | Number comparison and output | ? | ? |
| C-10 | Descendant traversal of objects, and deep nesting | ? | ? |
| C-11 | Nodelist arguments given a singular or function argument | ? | ? |
| C-12 | Function name followed by blank space and literal words | ? | ? |
| C-13 | Test for REQ-BU-* checks inside the suite | ? | ? |
| C-14 | Tests sample the spec instead of copying every row | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
