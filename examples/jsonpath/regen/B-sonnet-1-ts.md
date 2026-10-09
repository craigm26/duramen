# B-sonnet-1: claude-sonnet-5-5, ts, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 6.3 min / 25 turns / $1.39
- Isolation and audit: init_ok y; violations 2; denied calls 3; recognized reference n
- Model: `claude-sonnet-5-5` (sandbox `adricx`)
- Brief: the folder `B-markdown` (SPEC.md sha256 d3b3d2dc460c, DECISIONS.md 672321cf7696); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 693/738 (example 635/675, evidence 47/52, property 3/3, static 5/5, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | Test command and test folder | ? | ? |
| C-2 | Failures that are not a protocol error (stack overflow, unexpected exception) | ? | ? |
| C-3 | Strict JSON for request lines | ? | ? |
| C-4 | Number output text | ? | ? |
| C-5 | Number comparison for huge values | ? | ? |
| C-6 | Blank space before the first selector in a singular query | ? | ? |
| C-7 | Function arguments, a bare literal and the type check | ? | ? |
| C-8 | Function name followed by `(` versus the keywords | ? | ? |
| C-9 | Slice and index parse details | ? | ? |
| C-10 | Descendant traversal and node identity | ? | ? |
| C-11 | I-Regexp implemented by translation to JavaScript `RegExp` | ? | ? |
| C-12 | Strings that contain lone surrogates in documents | ? | ? |
| C-13 | Line splitting and decoding of stdin | ? | ? |
| C-14 | Escaping in normalized paths for DEL and non-BMP characters | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
