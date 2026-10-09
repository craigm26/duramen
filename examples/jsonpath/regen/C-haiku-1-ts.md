# C-haiku-1: claude-haiku-5-5, ts, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 15.9 min / 77 turns / $1.36
- Isolation and audit: init_ok y; violations 0; denied calls 1; recognized reference n
- Model: `claude-haiku-5-5` (sandbox `jnbijp`)
- Brief: the folder `C-duramen` (SPEC.md sha256 ac15b953383c, DECISIONS.md 15aa2cf18602); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 738/738 (example 675/675, evidence 52/52, property 3/3, static 5/5, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | Which request lines are blank | ? | ? |
| C-2 | The name `$.` followed by U+02CB | ? | ? |
| C-3 | Escaping U+0085, U+2028 and U+2029 in output | ? | ? |
| C-4 | Responses are written as their request lines arrive | ? | ? |
| C-5 | Lone surrogates in strings and names (OPEN-OP-002) | ? | ? |
| C-6 | Numbers beyond binary64 range, written in `values` (OPEN-OP-003) | ? | ? |
| C-7 | Negative zero in `values` | ? | ? |
| C-8 | I-Regexps with a range `{n,m}` where n > m, or a class range `[z-a]` | ? | ? |
| C-9 | Very large quantifier counts (OPEN-OP-004) | ? | ? |
| C-10 | I-Regexp matching uses the JavaScript RegExp engine | ? | ? |
| C-11 | Queries nested too deeply to parse (OPEN-OP-004) | ? | ? |
| C-12 | Duplicate member names in a document (OPEN-OP-001) | ? | ? |
| C-13 | Request bytes that are not UTF-8 (OPEN-OP-008) | ? | ? |
| C-14 | Negative-step slice defaults | ? | ? |
| C-15 | An internal error stops the driver | ? | ? |
| C-16 | Build, test and driver commands in REGEN.json | ? | ? |
| C-17 | A package.json with "type": "module" | ? | ? |
| C-18 | Test layout | ? | ? |
| C-19 | Standard error is left unused | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
