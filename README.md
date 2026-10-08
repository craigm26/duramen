# duramen

A small specification language for regenerative software. Duramen is botany's word for
heartwood: the durable core of a tree that stays while the living wood around it is replaced,
as a specification stays while its implementations are regenerated.

One `.duramen` file holds a program's requirements, examples, decisions, deliberate gaps and
named edge semantics. `duramen check` checks the file before any implementation exists, running
every example through the spec's own executable model (its *oracle*). `duramen build` writes the
builder's brief (`SPEC.md`), `DECISIONS.md`, a trace and the suite from that one file, so they
cannot drift apart. `duramen run` runs the suite against an implementation's driver.

Status: prototype, version 0.1.0. Node.js 22.18 or later, no dependencies.

```
node bin/duramen.mjs check examples/heat-engine/heat.duramen
node bin/duramen.mjs build examples/heat-engine/heat.duramen --out examples/heat-engine/build
node bin/duramen.mjs run   examples/heat-engine/heat.duramen --impl <regen-heat-engine>/impl/ts
npm test
```

Two of the tests run regen-heat-engine's released implementations; they are skipped unless a
clone of [regen-heat-engine](https://github.com/craigm26/regen-heat-engine) sits next to this
one, or `HEAT_ENGINE_IMPLS` points at its `impl/` folder. CI runs the rest on Linux and Windows.

## Why

Three specs were rebuilt blind from their briefs in the regen experiments
([regen-heat-engine](https://github.com/craigm26/regen-heat-engine),
[regen-mcp-tape](https://github.com/craigm26/regen-mcp-tape),
[regen-rcan-assurance](https://github.com/craigm26/regen-rcan-assurance)). The hand-built
suites measured the earlier implementations and judged every blind build; most blind builds
passed every case. Mistakes in the briefs and source texts surfaced another way: two in the
blind builders' notes on choices they had to make, one in a check on Windows after a build, and
one while a spec was being extracted:

- an example typed by hand that disagreed with the formula next to it (heat-engine r01);
- an error order stated twice, in two ways that disagree (heat-engine r02);
- a fact a builder had to act on, written only as context in a decision (mcp-tape r05);
- a canonical JSON section that names two different key orders, with no test vector that
  tells them apart (the RCAN protocol's own text, caught during rcan-assurance's extraction).

The first, second and fourth can be found mechanically before any build, if the spec says
where each kind of fact lives and a checker can run the examples; this language does that. The
third can be caught only when it is written with an RFC 2119 keyword such as MUST, and in
mcp-tape it was not. The language does not formalize behavior: requirement text stays prose.

## What `duramen check` enforces

- Every requirement has at least one example or table row, and every example is run through
  the oracle. A value the author typed must match (T002); a value written `?` is filled in from
  the oracle, so it cannot be mistyped.
- The RFC 2119 keywords (uppercase MUST, SHALL, REQUIRED, and their negations) are rejected
  outside requirements and imported edge texts: in notes, sections, the spec's text,
  decisions, operation summaries and error conditions (T004), unless quoted; in open items
  they are flagged (T014). Lowercase "must" is not checked.
- An order that matters, such as which error wins, is declared once, as a numbered `errors`
  list; a requirement that restates it is rejected (T005).
- Shared semantics are imported by name from an edge library instead of restated
  (`edge number-text/ecmascript`, `edge json/sorted-utf16`, ...). Each edge brings its
  normative text and a conformance pack (still empty for `fixed-text/ecmascript`). A vague name
  is refused (T015), the oracle must pass every bound pack (T006), and two edges bound to the
  same operation and field must not disagree (T026).
- Decisions should say where their claim came from (T013, a warning) and be cited by what rests
  on them (T012, a warning). They can carry a lifecycle status; a requirement cannot rest on a
  contested, superseded or rejected decision (T028).
- `open` items are deliberately unspecified and can have no examples (T003).

The full list of checks, the syntax and the limits are in [DESIGN.md](DESIGN.md).

## The heat-engine slice

[`examples/heat-engine/heat.duramen`](examples/heat-engine/heat.duramen) restates part of
regen-heat-engine's SPEC 1.0.2: wet-bulb temperature, heat flags, the `canonical` operation,
audit records and request handling (18 requirements, 62 examples, 11 decisions, 8 open items,
3 edges). Its oracle is that repository's suite oracle, copied unchanged with attribution,
behind a 75-line driver. The generated brief, decisions, trace and suite are in
[`examples/heat-engine/build/`](examples/heat-engine/build/).

The generated suite has 104 cases (62 examples and 42 edge pack items) plus 3 protocol checks
in every run. Both released implementations from regen-heat-engine (commit 4d99222) pass it:

| implementation | `duramen run` |
|---|---|
| `impl/ts` | 107/107 |
| `impl/py` | 107/107 |

Does the suite have teeth? [`mutants.mjs`](examples/heat-engine/mutants.mjs) plants 14 small,
plausible mistakes in a copy of `impl/ts`, one at a time, and runs both this suite and the
hand-built regen suite. The hand-built suite has 364 cases for the whole spec; 240 of them (129
distinct requests) are in the slice's scope, against 104 requests here. I chose the mistakes,
mostly from the spec's decisions file (8 of the 14 imitate a decision), so they are a biased
sample.

- First run: the duramen suite caught 12 of 14, the hand-built suite 13 of 14. Both missed
  `(tempF - 32) / 1.8` in place of `((tempF - 32) * 5) / 9`; the duramen suite also missed an
  unknown operation without `input` being answered `bad_request` (it could not yet send a
  request without `input`).
- I then added one example (`tempF` 98.6, where the two expressions differ) and the missing
  error examples, which needed three additions to the language (`example raw`, `omit`, and an
  example with no input). Since then: duramen 14 of 14, hand-built 13 of 14.

The hand-built suite would also catch the first mutant with one more case. The comparison says
that a suite generated from the brief can be as strict as a hand-built one on this slice; it
does not say it is stricter.

## Blind builds from the generated brief

Five blind builds used only the generated `SPEC.md` and `DECISIONS.md` plus a prompt (which
carried REGEN.json and the budgets, since duramen 0.1 cannot express them), under the regen kit's
isolation: nested `claude -p` with `claude-sonnet-5-5`, the kit's current launcher (blob f94f845,
an allow-listed environment), in a Linux container. Details are in
[`examples/heat-engine/blind/`](examples/heat-engine/blind/). regen-heat-engine's r01 to r04 were
built under the same protocol from the prose brief, for the whole spec, on Windows, with the
earlier launcher (blob 3b7118a, which passed the orchestrator's environment through instead of an
allow-list) and the unmodified prompt. Blind means the builders were not shown the reference or
earlier builds; the model may still have seen the public heat-engine sources in training.

| run | brief | duramen suite | hand-built suite, slice scope | own tests | non-blank lines | choices | clarify | clean |
|---|---|---|---|---|---|---|---|---|
| t01 (ts) | brief-t1 | 105/105 | 240/240 | 19/19 | 219 | 7 | 2 | no |
| t02 (py) | brief-t1 | 105/105 | 240/240 | 21/21 | 210 | 10 | 1 | no |
| t03 (ts) | brief-t2 | 105/105 | 240/240 | 19/19 | 163 | 9 | 0 | yes |
| t04 (ts) | brief-t3 | 107/107 | 240/240 | 19/19 | 174 | 10 | 0 | yes |
| t05 (py) | brief-t3 | 107/107 | 240/240 | 15/15 | 215 | 7 | 0 | yes |

Every build passes every in-scope case of both suites, and none has a silent divergence; t01 to
t03 also pass the brief-t3 suite (107/107). The three `clarify` items came from how duramen wrote
brief-t1. Its renderer showed an author-typed example object in source order, which t01 read as
contradicting the canonical key order, and its operations table never said that inputs are
required, which t01 and t02 both asked about for `canonical`'s `value`. brief-t2 shows example
values sorted and says inputs are required unless marked optional; brief-t3 also states the
`value` rule with two examples and says that objects written in the brief list their members in
no particular order. Of the other 40 choices, 21 were triaged open, all but two of them (t02 C-2
and t03 C-3) already marked open in the brief the builder had, and 19 were already answered by
the brief. (t05 C-1, counted as marked, also touches t02's unmarked question of line splitting.)

For comparison, the prose brief's two `clarify` findings in the slice, r01's typed example and
r02's twice-stated order, are of kinds that `duramen check` rejects as written (T002, T005; the
history files below), though T005 is a text heuristic and values typed in requirement prose are
never run. r03 and r04, on the prose brief after those fixes, had none. On this slice, then, the
final generated brief (t04 and t05, clean in both languages) did as well as the corrected prose
brief did on the whole spec, and the first generated brief had defects of its own that
`duramen check` could not find; the builders did. These are five builds of programs of 160 to 220 non-blank lines, with one
model: a small sample.

## The edge library across specs

[`examples/rcan/canonical.duramen`](examples/rcan/canonical.duramen) binds two edges: it
attaches the `json/rfc8785` and `number-text/ecmascript` packs (42 cases) to the `canonical`
operation that regen-rcan-assurance's driver protocol exposes. `duramen run` sends them to the
RCAN SDKs through regen-rcan-assurance's adapters (copied unchanged apart from the local path
file each one reads, and the driver flags noted below):

| subject | commit | `duramen run` | what fails against the packs |
|---|---|---|---|
| rcan-ts, master | ff8c73d | 42/45 | `"9"` written before `"10"`; two strings with lone surrogates accepted |
| rcan-ts, PR #55 head | b563fb5 | 45/45 | |
| rcan-py, main | 0184314 | 33/45 | keys in code-point order; exponent forms such as `1e-07` and `1.234e-06`; `1e21` and `1.7976931348623157e308` written as integer digits; `9007199254740993` kept exact |
| rcan-py, PR #66 head | 638ca3b | 45/45 | |
| regen-rcan-assurance `impl/ts` | ebb8281 | 45/45 | |
| regen-rcan-assurance `impl/py` | ebb8281 | 45/45 | |

The PR #55 source was loaded with `node --experimental-transform-types` and its
`./errors.js` import pointed at `./errors.ts`, because its error classes use TypeScript
parameter properties, which Node's default type stripping refuses. Caveat: I wrote these packs
after the rcan-assurance work, so they carry what that work found. This shows the findings
moving between specs by name; it does not show the packs finding them fresh.

## History

[`examples/history/`](examples/history/) restates each incident above as a small `.duramen` file.
`npm test` checks that each one fails with exactly these codes:

| file | what happened | `duramen check` |
|---|---|---|
| `r01-typed-example.duramen` | heat-engine r01: `Tw=25.00°C` typed by hand; the formula gives 25.05 | T002 |
| `r02-order-restated.duramen` | heat-engine r02: "the order the table lists them, `unknown_op` before input checks" | T005 |
| `obligation-in-context.duramen` | mcp-tape r05: the Windows CRLF trap, written as context in a decision | T004, but only because this version says MUST; the original did not (see the file) |
| `ambiguous-edge.duramen` | "canonical JSON" without saying which | T015 |
| `rcan-two-orders.duramen` | RCAN: code-point order and RFC 8785 in one section | T026 on the input where the two orders differ, with no oracle and no implementation |
| `rfc8785-vs-oracle.duramen` | the heat-engine oracle bound to an edge it does not meet | T006 twice |

## Layout

```
bin/duramen.mjs              the command line
src/parse.mjs                .duramen source to a syntax tree, with diagnostics (P codes)
src/check.mjs                the checks (T codes); runs examples and bound edge packs through the oracle
src/edges.mjs                the edge library: normative texts and conformance packs
src/render.mjs               SPEC.md, DECISIONS.md, trace.md
src/suite.mjs                the generated suite, and the runner
src/driver.mjs               the line protocol shared by oracles and implementations
examples/heat-engine/        the slice, its oracle, the generated build, and mutants.mjs
examples/heat-engine/blind/  the blind builds: prompts, the kit's tools, records, output
examples/rcan/               the edge binding run against the RCAN SDKs
examples/history/            the incidents, one file each
test/                        node --test
```

## Name

The language was called tilth while these experiments ran, and was renamed because another
tool for coding agents already has that name (github.com/jahala/tilth). The briefs the blind
builders received say "Generated ... by tilth 0.1.0", and the run records and ledger in
`examples/heat-engine/blind/runs/` keep the old name; tags `brief-t1` to `brief-t3` point at
those commits.

## License

MIT. `examples/heat-engine/oracle.mjs` and the adapted spec text and decisions in
`heat.duramen` come from regen-heat-engine (MIT, Copyright (c) 2026 craigm26).
