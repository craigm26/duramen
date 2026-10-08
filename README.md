# tilth

A small specification language for regenerative software (working name; see the note at the
end). One `.tilth` file holds a program's requirements, examples, decisions, deliberate gaps
and named edge semantics. `tilth check` checks the file before any implementation exists,
running every example through the spec's own executable model (its *oracle*). `tilth build`
writes the builder's brief (`SPEC.md`), `DECISIONS.md`, a trace and the suite from that one
file, so they cannot drift apart. `tilth run` runs the suite against an implementation's driver.

Status: prototype, version 0.1.0, not published. Node.js 22.18 or later, no dependencies.

```
node bin/tilth.mjs check examples/heat-engine/heat.tilth
node bin/tilth.mjs build examples/heat-engine/heat.tilth --out examples/heat-engine/build
node bin/tilth.mjs run   examples/heat-engine/heat.tilth --impl <regen-heat-engine>/impl/ts
npm test
```

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

## What `tilth check` enforces

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

[`examples/heat-engine/heat.tilth`](examples/heat-engine/heat.tilth) restates part of
regen-heat-engine's SPEC 1.0.2: wet-bulb temperature, heat flags, the `canonical` operation,
audit records and request handling (18 requirements, 60 examples, 11 decisions, 8 open items,
3 edges). Its oracle is that repository's suite oracle, copied unchanged with attribution,
behind a 75-line driver. The generated brief, decisions, trace and suite are in
[`examples/heat-engine/build/`](examples/heat-engine/build/).

The generated suite has 102 cases (60 examples and 42 edge pack items) plus 3 protocol checks
in every run. Both released implementations from regen-heat-engine (commit 4d99222) pass it:

| implementation | `tilth run` |
|---|---|
| `impl/ts` | 105/105 |
| `impl/py` | 105/105 |

Does the suite have teeth? [`mutants.mjs`](examples/heat-engine/mutants.mjs) plants 14 small,
plausible mistakes in a copy of `impl/ts`, one at a time, and runs both this suite and the
hand-built regen suite. The hand-built suite has 364 cases for the whole spec; 240 of them (129
distinct requests) are in the slice's scope, against 102 requests here. I chose the mistakes,
mostly from the spec's decisions file (8 of the 14 imitate a decision), so they are a biased
sample.

- First run: the tilth suite caught 12 of 14, the hand-built suite 13 of 14. Both missed
  `(tempF - 32) / 1.8` in place of `((tempF - 32) * 5) / 9`; the tilth suite also missed an
  unknown operation without `input` being answered `bad_request` (it could not yet send a
  request without `input`).
- I then added one example (`tempF` 98.6, where the two expressions differ) and the missing
  error examples, which needed three additions to the language (`example raw`, `omit`, and an
  example with no input). Since then: tilth 14 of 14, hand-built 13 of 14.

The hand-built suite would also catch the first mutant with one more case. The comparison says
that a suite generated from the brief can be as strict as a hand-built one on this slice; it
does not say it is stricter.

## Blind builds from the generated brief

Three blind builds used only the generated `SPEC.md` and `DECISIONS.md` plus a prompt, under the
regen kit's isolation (nested `claude -p`, `claude-sonnet-5-5`, Linux container; details in
[`examples/heat-engine/blind/`](examples/heat-engine/blind/)). regen-heat-engine's r01 to r04
were built the same way from the prose brief, for the whole spec, on Windows.

| run | brief | tilth suite | hand-built suite, slice scope | own tests | lines | choices | clarify | clean |
|---|---|---|---|---|---|---|---|---|
| t01 (ts) | brief-t1 | 105/105 | 240/240 | 19/19 | 219 | 7 | 1 | no |
| t02 (py) | brief-t1 | 105/105 | 240/240 | 21/21 | 210 | 10 | 0 | yes |
| t03 (ts) | brief-t2 | 105/105 | 240/240 | 19/19 | 163 | 9 | 0 | yes |

None of the three has a silent divergence. t01's one `clarify` came from tilth itself: the
renderer showed an author-typed example object in source order, and the builder read it as
contradicting the canonical key order. The checker could not see this, because the example was
correct. The renderer now shows example values sorted, and t03, on the fixed brief, is clean.
The other choices are almost all deliberately open items.

For comparison, the prose brief's two `clarify` findings in the slice (r01's typed example and
r02's twice-stated order) are both rejected by `tilth check` before any build (see History);
r03 and r04, on the prose brief after those fixes, had none. So the generated brief did as well
as the corrected prose brief, introduced one defect of its own, and made the two earlier kinds
impossible. Three builds of a 160 to 220 line program are a small sample.

## The edge library across specs

[`examples/rcan/canonical.tilth`](examples/rcan/canonical.tilth) binds two edges: it
attaches the `json/rfc8785` and `number-text/ecmascript` packs (42 cases) to the `canonical`
operation that regen-rcan-assurance's driver protocol exposes. `tilth run` sends them to the
RCAN SDKs through regen-rcan-assurance's adapters (copied unchanged apart from the local path
file each one reads, and the driver flags noted below):

| subject | commit | `tilth run` | what fails against the packs |
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

[`examples/history/`](examples/history/) restates each incident above as a small `.tilth` file.
`npm test` checks that each one fails with exactly these codes:

| file | what happened | `tilth check` |
|---|---|---|
| `r01-typed-example.tilth` | heat-engine r01: `Tw=25.00°C` typed by hand; the formula gives 25.05 | T002 |
| `r02-order-restated.tilth` | heat-engine r02: "the order the table lists them, `unknown_op` before input checks" | T005 |
| `obligation-in-context.tilth` | mcp-tape r05: the Windows CRLF trap, written as context in a decision | T004, but only because this version says MUST; the original did not (see the file) |
| `ambiguous-edge.tilth` | "canonical JSON" without saying which | T015 |
| `rcan-two-orders.tilth` | RCAN: code-point order and RFC 8785 in one section | T026 on the input where the two orders differ, with no oracle and no implementation |
| `rfc8785-vs-oracle.tilth` | the heat-engine oracle bound to an edge it does not meet | T006 twice |

## Layout

```
bin/tilth.mjs          the command line
src/parse.mjs          .tilth source to a syntax tree, with diagnostics (P codes)
src/check.mjs          the checks (T codes); runs examples and bound edge packs through the oracle
src/edges.mjs          the edge library: normative texts and conformance packs
src/render.mjs         SPEC.md, DECISIONS.md, trace.md
src/suite.mjs          the generated suite, and the runner
src/driver.mjs         the line protocol shared by oracles and implementations
examples/heat-engine/  the slice, its oracle, the generated build, and mutants.mjs
examples/rcan/         the edge binding run against the RCAN SDKs
examples/history/      the incidents, one file each
test/                  node --test
```

## Name

"tilth" is a working name: the condition of soil that lets things grow. There is already a
tool called tilth in the same neighborhood (a code-reading command line and MCP server for
coding agents, github.com/jahala/tilth), so this needs a different name before it is published.

## License

MIT. `examples/heat-engine/oracle.mjs` and the adapted spec text and decisions in
`heat.tilth` come from regen-heat-engine (MIT, Copyright (c) 2026 craigm26).
