# B-sonnet-1: claude-sonnet-5-5, py, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 4.8 min / 16 turns / $0.99
- Isolation and audit: init_ok y; violations 0; denied calls 0; recognized reference n
- Model: `claude-sonnet-5-5` (sandbox `qetjbn`)
- Brief: the folder `B-markdown` (SPEC.md sha256 d3b3d2dc460c, DECISIONS.md 672321cf7696); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 693/738 (example 635/675, evidence 47/52, property 3/3, static 5/5, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | Unterminated escape at end of query string | ? | ? |
| C-2 | Numbers in output are Decimal text, `-0` loses its sign | ? | ? |
| C-3 | Comparison converts numbers to binary64, overflow becomes infinity | ? | ? |
| C-4 | Invalid UTF-8 or a non-JSON constant in a request line | ? | ? |
| C-5 | Lone surrogates in a document | ? | ? |
| C-6 | Output escapes all non-ASCII characters | ? | ? |
| C-7 | Huge range quantifiers in I-Regexp | ? | ? |
| C-8 | Deep nesting | ? | ? |
| C-9 | Bare literal as function argument next to logical operators | ? | ? |
| C-10 | Test command uses an unquoted file pattern | ? | ? |
| C-11 | Whitespace-only lines that contain other characters | ? | ? |
| C-12 | Name shorthand with non-ASCII characters | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
