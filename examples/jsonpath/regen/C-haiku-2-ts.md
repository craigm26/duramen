# C-haiku-2: claude-haiku-5-5, ts, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 13.2 min / 39 turns / $0.77
- Isolation and audit: init_ok y; violations 0; denied calls 1; recognized reference n
- Model: `claude-haiku-5-5` (sandbox `namjci`)
- Brief: the folder `C-duramen` (SPEC.md sha256 ac15b953383c, DECISIONS.md 15aa2cf18602); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 738/738 (example 675/675, evidence 52/52, property 3/3, static 5/5, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | The row `$.ˋa` contradicts the name rule | ? | ? |
| C-2 | The EV-EV-RFC table has 8 of the 43 rows it promises | ? | ? |
| C-3 | A CR at the end of a request line is a CRLF line ending | ? | ? |
| C-4 | Only space, tab and the CR of a CRLF make a line blank | ? | ? |
| C-5 | Stdin is decoded as UTF-8 and split on LF only | ? | ? |
| C-6 | A duplicate member name in a JSON object keeps the last value | ? | ? |
| C-7 | Document numbers are read the way `JSON.parse` reads them | ? | ? |
| C-8 | A number literal beyond the binary64 range is an infinity | ? | ? |
| C-9 | An I-Regexp character range out of order is not an I-Regexp | ? | ? |
| C-10 | A repeat range whose bounds are out of order is not an I-Regexp | ? | ? |
| C-11 | A repeat count the JavaScript engine refuses matches nothing | ? | ? |
| C-12 | `\p{X}` follows the Unicode tables of the JavaScript engine | ? | ? |
| C-13 | A function argument is parsed as a logical expression, then typed | ? | ? |
| C-14 | Lone surrogates: the escape is invalid, a raw one is kept as it is | ? | ? |
| C-15 | Responses are compact JSON in a fixed key order | ? | ? |
| C-16 | No guard against deep nesting | ? | ? |
| C-17 | Tooling: a `type: module` package, and `node --test` through `npm test` | ? | ? |
| C-18 | The example tests are generated from the spec's tables | ? | ? |
| C-19 | Property tests use a seeded generator of my own | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
