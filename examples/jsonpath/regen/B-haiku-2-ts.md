# B-haiku-2: claude-haiku-5-5, ts, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 13.1 min / 53 turns / $0.96
- Isolation and audit: init_ok y; violations 0; denied calls 1; recognized reference n
- Model: `claude-haiku-5-5` (sandbox `saaupn`)
- Brief: the folder `B-markdown` (SPEC.md sha256 d3b3d2dc460c, DECISIONS.md 672321cf7696); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 693/738 (example 635/675, evidence 47/52, property 3/3, static 5/5, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | Standard input is decoded as UTF-8, invalid bytes become U+FFFD | ? | ? |
| C-2 | Lines are split on LF only | ? | ? |
| C-3 | The request line is parsed with a strict RFC 8259 JSON parser of my own | ? | ? |
| C-4 | Duplicate names in the request object: last value, first position | ? | ? |
| C-5 | Objects are Maps, and numbers keep their text | ? | ? |
| C-6 | Lone surrogates in document strings are passed through | ? | ? |
| C-7 | `\p{Cs}` is not accepted, although Appendix C lists `Cs` | ? | ? |
| C-8 | I-Regexps are checked by my parser and run by the JavaScript RegExp engine | ? | ? |
| C-9 | A lone surrogate in an I-Regexp is invalid, so the function gives LogicalFalse | ? | ? |
| C-10 | Quantifier counts above 2^53 are kept as written | ? | ? |
| C-11 | A parenthesized argument is a logical expression, even when it holds one query | ? | ? |
| C-12 | A bare literal is rejected in a static check, not in the parser | ? | ? |
| C-13 | Unknown function names are rejected by the static check | ? | ? |
| C-14 | Output of a document value is the document's own JSON text, with normal string escaping | ? | ? |
| C-15 | Blank lines and CR at the end of a line | ? | ? |
| C-16 | The response is written with `process.stdout.write`, and the process exits when input ends | ? | ? |
| C-17 | An unexpected internal error is not caught | ? | ? |
| C-18 | The implementation folder has a `package.json` that declares `"type": "module"` | ? | ? |
| C-19 | The test command is `node --test`, with the default file discovery | ? | ? |
| C-20 | The files the spec names are not all in the folder | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
