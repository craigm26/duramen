# B-haiku-1: claude-haiku-5-5, ts, jsonpath 1.0.0
- Date / exit / duration / turns / cost: 2026-10-09 / 0 / 16.2 min / 64 turns / $1.15
- Isolation and audit: init_ok y; violations 1; denied calls 2; recognized reference n
- Model: `claude-haiku-5-5` (sandbox `yqsfeo`)
- Brief: the folder `B-markdown` (SPEC.md sha256 d3b3d2dc460c, DECISIONS.md 672321cf7696); scored by the suite of jsonpath 1.0.0
- duramen suite: passed 693/738 (example 635/675, evidence 47/52, property 3/3, static 5/5, protocol 3/3)
- Clean run: not yet decided (triage the choices below)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | protocol.md is not in the folder | ? | ? |
| C-2 | DECISIONS-B.md is called DECISIONS.md | ? | ? |
| C-3 | Input is handled line by line as it arrives; a final line with no LF is answered | ? | ? |
| C-4 | Only LF ends a line; a bare CR does not | ? | ? |
| C-5 | Which lines are blank; the protocol and R1.1 disagree on the wording | ? | ? |
| C-6 | JSON reading is strict RFC 8259; the decoder replaces invalid UTF-8 | ? | ? |
| C-7 | Lone surrogates in document strings and in `id` are accepted | ? | ? |
| C-8 | Length and order of a lone surrogate in a document string | ? | ? |
| C-9 | Numbers in `values` keep their document text; comparisons use binary64 | ? | ? |
| C-10 | Duplicate member names keep the last value at the first position | ? | ? |
| C-11 | Object member order comes from our own parser (a `Map`), not from JavaScript objects | ? | ? |
| C-12 | Document nesting is not limited by the call stack | ? | ? |
| C-13 | A query too deeply nested for the parser is `invalid_query` | ? | ? |
| C-14 | Unexpected internal failures end the driver | ? | ? |
| C-15 | `&&` and `\|\|` short-circuit | ? | ? |
| C-16 | I-Regexp is compiled to a JavaScript `u`-flag RegExp, after validation | ? | ? |
| C-17 | Unicode data comes from the runtime, so `\p{...}` depends on the Node version | ? | ? |
| C-18 | The compiled-pattern cache is not bounded | ? | ? |
| C-19 | Wrong-length function calls are `invalid_query` before type checks | ? | ? |
| C-20 | REGEN.json: build is empty, test is `node --test`, driver is `node driver.ts` | ? | ? |
| C-21 | `package.json` is present, declares `"type": "module"` and no dependencies | ? | ? |

Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.
