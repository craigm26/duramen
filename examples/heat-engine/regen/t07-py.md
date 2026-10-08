# t07: sonnet, py, heat-engine 1.1.0-slice
- Date / exit / duration / turns / cost: 2026-10-08 / 0 / 2.1 min / 15 turns / $0.40
- Isolation and audit: init_ok y; violations 0; denied calls 1 (a heredoc append to
  `heat.py` with `cat`; the builder then used the Edit tool); recognized reference n
- Model: `claude-sonnet-5-5` (sandbox `xftzga`), launched by `duramen regen`
- Brief: as t06 (heat-engine 1.1.0-slice), with the generic prompt `lib/regen/prompt.py.md`
- duramen suite: passed 207/207 (example 63/63, evidence 80/80, edge 42/42, property 14/14,
  static 5/5, protocol 3/3); rescored at 1.2.0-slice: **207/209** (the two new examples
  below)
- Clean run: **no** (one `clarify`)

## CHOICES triage
| C-id | Builder's choice | Triage | Action |
|---|---|---|---|
| C-1 | A bare `NaN` token is not JSON: `bad_request` | already pinned | None (errors 1) |
| C-2 | `1e400` reads as Infinity | open | Already OPEN-CJ-001 |
| C-3 | Only spaces and tabs make a line blank; a lone CR gets `bad_request` | open | None (the protocol says other white space is open) |
| C-4 | Invalid UTF-8 becomes U+FFFD; the last duplicate member wins | open | Already OPEN-IF-005 |
| C-5 | Responses written as ASCII-only JSON | already pinned | None (UTF-8, compared as parsed JSON) |
| C-6 | `flagC` overflow gives `invalid_input:wetBulbC` | open | Already OPEN-FL-001 |
| C-7 | An infinite `tempF` gives `tempC` NaN, so the audit says `"NaN"` | **clarify** | REQ-WB-005 reworded and two examples added (D-025, 1.2.0-slice) |
| C-8 | `canonical` needs an object `input` with `value` | already pinned | None (REQ-CJ-005) |
| C-9 | `py -3` on Windows, `python3` elsewhere | open | None (any command that works) |

Totals: 9 choices; pin 0, clarify 1, open 5, wrong 0, quirk 0; 3 already pinned.

## Silent divergences
`duramen agree` (the oracle, t06 and t07; 400 generated requests per operation) found one
behavior on which t07 differs and no case had checked: for `wetBulbF` with `tempF` `"Infinity"`
or `"-Infinity"`, t07 writes `"tempC": "NaN"` in the audit, where the exact expression of
REQ-WB-005 gives an infinity (199 of the 400 `wetBulbF` requests). The builder flagged it
itself (C-7: "Should the spec pin this? yes"). The brief's summary sentence, "a non-finite
`tempF` gives a non-finite `tempC`", invited the shortcut, so this is `clarify`: 1.2.0-slice
says the expression applies to non-finite values and pins both infinities. The other
disagreement, `flagC` at 1.7976931348623157e308, is open (OPEN-FL-001).

## What this run taught
A suite can pass a build that the spec's text already rules out. `agree` is the check for
that: it compares independent builds on inputs no one wrote down. None of the seven earlier
builds took this shortcut; all pass 1.2.0-slice.
