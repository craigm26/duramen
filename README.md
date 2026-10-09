# duramen

A small specification language for regenerative software. Duramen is botany's word for
heartwood: the durable core of a tree that stays while the living wood around it is replaced,
as a specification stays while its implementations are regenerated.

A *record*, one `.duramen` file or a folder of them, holds a program's requirements, examples,
decisions, deliberate gaps, named edge semantics, and evidence and properties that check the
spec's own executable model (its *oracle*). `duramen check` checks the record before any
implementation exists, running every example, evidence row and property through the oracle.
`duramen build` writes the builder's brief (`SPEC.md`), `DECISIONS.md`, a trace and the suite
from that one record, so they cannot drift apart. `duramen run` runs the suite against an
implementation's driver, and `duramen regen` runs one blind build from the brief, end to end.

duramen is specified in duramen: [`spec/`](spec/) is a record of the core language whose oracle
is duramen itself, and a checker rebuilt blind from its brief is judged by its suite (below).

Status: prototype, version 0.2.0. Node.js 22.18 or later, no dependencies.

```
node bin/duramen.mjs check examples/heat-engine
node bin/duramen.mjs build examples/heat-engine/heat.duramen --out examples/heat-engine/build
node bin/duramen.mjs run   examples/heat-engine/heat.duramen --impl examples/heat-engine/regen/impl/t06-ts
node bin/duramen.mjs mutate examples/heat-engine/heat.duramen
node bin/duramen.mjs agree examples/heat-engine/heat.duramen --impl <dir> --impl <dir> --oracle
node bin/duramen.mjs diff  <old record> <new record>
node bin/duramen.mjs regen examples/heat-engine/heat.duramen --lang ts --runs <dir>
node bin/duramen.mjs check spec/
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

- Every requirement has at least one evaluation (an example, a table row, a property, evidence
  or a static check), and every example is run through the oracle. A value the author typed
  must match (T002); a value written `?` is filled in from the oracle, so it cannot be mistyped.
- The oracle is checked too (0.2): evidence from outside the spec (published tables, another
  implementation's results, CSV or JSON Lines) must agree with it unless a decision waives a
  row (T030); properties must hold for it on generated inputs (T031); its answers must have
  the declared result types (T038); and a requirement whose every checked value is the
  oracle's own is reported (T032). `duramen mutate` plants mistakes in the oracle and counts
  the ones nothing catches.
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

## duramen specified in duramen

[`spec/`](spec/) is duramen-core 0.7.0: the core of the language (the statements of 0.1 other
than `edge`) and two operations of the checker, `check` (a record's diagnostics) and `cases`
(the suite generated from it), in 43 requirements and 168 examples. It is written in the core
language it specifies, so that a checker built from it can read it, and its oracle is duramen
itself, through `duramen serve`, which takes a record as a map of file names to texts. Every
expected value in it was typed by hand, and `duramen check spec/` runs all 168 through duramen
in about three seconds.

Writing it found behavior nobody had decided. Before it was written, duramen dropped some
lines without a word (a second line under a `title`, a line under a table that is not a row, an example line
indented three spaces), let a second `spec` in one file replace the first, dropped `request`
members it could not use, accepted hex numbers as tolerances, and could not read an input path
with a space in a quoted name. Each is now an error, with an example.

Then the loop ran on duramen itself ([`selfhost/`](selfhost/)):

1. **A blind build from the brief.** `duramen regen spec/ --lang ts` gave the generated brief to
   `claude -p` (`claude-sonnet-5-5`) in a sandbox. In 10.1 minutes it wrote a 1,414-line
   checker in TypeScript, s01, which passed all 142 cases of the suite.
2. **The fixed point.** Asked for the suite of `spec/` with itself as the record's oracle, s01
   writes the same 139 cases, as JSON, that duramen writes: the rebuilt checker regenerates
   the suite that judged it ([`fixedpoint.mjs`](selfhost/fixedpoint.mjs)).
3. **Past the suite.** s01 recorded 19 choices the brief had left to it, and on 600 mutated
   records it answered 15 differently from duramen ([`agree.mjs`](selfhost/agree.mjs)). One
   choice was a defect in how duramen rendered the brief (two blank lines in an example shown
   as one); most of the rest were places where the spec, or duramen itself, had never decided.
   0.3.0 decides each, with an example, and in most of them duramen itself changed
   ([s01's record](selfhost/s01-ts.md) says which reading won, and why).
4. **The version.** `duramen diff` first called 0.2.0 to 0.3.0 "tightening". Two examples had
   been replaced rather than edited, so no text showed that their behavior changed; `diff` now
   runs the old version's dropped examples through the new oracle, and reports both as
   breaking.
5. **Again.** s02, built blind from 0.3.0, passed all 153 cases and is a fixed point too. Of its
   33 choices, 12 were already decided and 6 deliberately open; it read 6 mutated records
   differently from duramen (s01: 15), and two of those were bugs in duramen that no example
   had reached: a request member named `"2"` was written before `id`, and `length` was read as
   a member of an array. 0.4.0 pins what remained ([s02's record](selfhost/s02-ts.md)).
6. **In another language.** s03, built blind in Python from 0.4.0, passed all 157 cases and is
   a fixed point when suites are compared as JSON values, the way the spec compares results
   (as text, three cases list their members in another order). Its one `clarify` came from
   the previous round: a sentence written to pin one behavior also said something duramen
   does not do ([s03's record](selfhost/s03-py.md)).
7. **Two builds against one model.** s04 (TypeScript) and s05 (Python), built at the same time
   from 0.5.0, passed all 159 cases, are fixed points, and answered every one of 600 mutated
   records as duramen did. On 4,500 more, they read 9 records differently from duramen, and
   on all 9 they gave each other's answer, in two languages. Where independent builds agree
   and the model does not, the model is the suspect: in each case duramen had not done what
   its own spec says, and 0.6.0 follows the builds ([s04](selfhost/s04-ts.md),
   [s05](selfhost/s05-py.md)).
8. **Past the mutants.** s06 (TypeScript) and s07 (Python), built from 0.6.0, passed all 161
   cases, are fixed points, and answered every request about 4,500 mutated records, and about
   the records they were made from, as duramen did. 49 records written for their recorded
   choices ([`probe.mjs`](selfhost/probe.mjs)) still found four kinds of difference. Three
   times both builds read a record alike and duramen otherwise: a table header's cells, read
   from the left; numbers too large for binary64 after `≈` or as tolerances; and the `returns`
   and `static` clauses, a deliberate gap. The fourth, a malformed second `request` line, was
   read three ways. On the numbers no checker was right: for an expectation of `1e999`,
   duramen and s06 wrote `null` into the suite and s07 could not answer. 0.7.0 refuses such
   numbers wherever a record holds JSON ([s06](selfhost/s06-ts.md), [s07](selfhost/s07-py.md)).

Blind means the builders were not shown duramen's source; the spec they read describes duramen
in detail, and seven builds with one model are a small sample.

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
bin/duramen.mjs              the command line (src/cli.mjs)
src/parse.mjs                .duramen source to a syntax tree, with diagnostics (P codes)
src/record.mjs               a record from disk: files, versions, the edge library, data files
src/check.mjs                the checks (T codes); runs examples, evidence, properties and packs through the oracle
src/types.mjs, expr.mjs      the type language and the property expressions
src/property.mjs, static.mjs properties on generated inputs; static checks on an implementation folder
src/render.mjs               SPEC.md, DECISIONS.md, trace.md
src/suite.mjs                the generated suite, and the runner
src/driver.mjs               the line protocol shared by oracles and implementations
src/mutate.mjs, agree.mjs, diff.mjs, regen.mjs, serve.mjs   the other commands
lib/edges/                   the edge library, as edgedef records
lib/regen/                   the generic builder prompts for duramen regen
spec/                        duramen-core, specified in duramen
selfhost/                    blind builds of duramen-core, the fixed-point and agreement tests, and the probes
examples/heat-engine/        the slice, its oracle and evidence, the generated build, mutants.mjs
examples/heat-engine/blind/  blind builds t01 to t05: prompts, the kit's tools, records, output
examples/heat-engine/regen/  blind builds t06 and t07 with duramen regen
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
