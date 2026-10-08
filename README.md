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
[regen-rcan-assurance](https://github.com/craigm26/regen-rcan-assurance)). The suites caught
mistakes in the implementations. The mistakes in the briefs were found by the blind builders,
one build at a time:

- an example typed by hand that disagreed with the formula next to it (heat-engine r01);
- an error order stated twice, in two ways that disagree (heat-engine r02);
- a fact a builder had to act on, written only as context (mcp-tape r05);
- a canonical JSON section that names two different key orders, with no test vector that
  tells them apart (rcan-assurance, in the protocol's own text).

Each of these can be found mechanically, before a build, if the spec says where each kind of
fact lives and the checker can run the examples. That is what this language does. It does not
formalize behavior: requirement text stays prose.

## What `tilth check` enforces

- Every requirement has at least one example or table row, and every example is run through
  the oracle. A value the author typed must match (T002); a value written `?` is filled in from
  the oracle, so it cannot be mistyped.
- MUST, SHALL and REQUIRED appear only in requirements (T004).
- An order that matters, such as which error wins, is declared once, as a numbered `errors`
  list; a requirement that restates it is rejected (T005).
- Shared semantics are imported by name from an edge library instead of restated
  (`edge number-text/ecmascript`, `edge json/sorted-utf16`, ...). Each edge brings its
  normative text and a conformance pack. A vague name is refused (T015), the oracle must pass
  every bound pack (T006), and two edges bound to the same operation must not disagree (T026).
- Decisions say where their claim came from (T013), are cited by what rests on them (T012),
  and carry a lifecycle status; a requirement cannot rest on a contested, superseded or
  rejected decision (T028).
- `open` items are deliberately unspecified and can have no examples (T003).

The full list of checks, the syntax and the limits are in [DESIGN.md](DESIGN.md).

## The heat-engine slice

[`examples/heat-engine/heat.tilth`](examples/heat-engine/heat.tilth) restates part of
regen-heat-engine's SPEC 1.0.2: wet-bulb temperature, heat flags, the `canonical` operation,
audit records and request errors (17 requirements, 59 examples, 10 decisions, 4 open items, 3
edges). Its oracle is that repository's suite oracle, copied unchanged with attribution, behind
a 75-line driver. The generated brief, decisions, trace and suite are in
[`examples/heat-engine/build/`](examples/heat-engine/build/).

The generated suite has 101 cases (59 examples and 42 edge pack items) plus 3 protocol checks
in every run. Both released implementations from regen-heat-engine (commit 4d99222) pass it:

| implementation | `tilth run` |
|---|---|
| `impl/ts` | 104/104 |
| `impl/py` | 104/104 |

Does the suite have teeth? [`mutants.mjs`](examples/heat-engine/mutants.mjs) plants 14 small,
plausible mistakes in a copy of `impl/ts`, one at a time, and runs both this suite and the
hand-built regen suite. The hand-built suite has 364 cases for the whole spec; 241 of them
(134 distinct requests) are for the slice's five operations or are error and stream checks,
against 101 requests here. I chose the mistakes from the spec's decisions file, so they are a
biased sample.

- First run: the tilth suite caught 12 of 14, the hand-built suite 13 of 14. Both missed
  `(tempF - 32) / 1.8` in place of `((tempF - 32) * 5) / 9`; the tilth suite also missed an
  unknown operation without `input` being answered `bad_request` (it could not yet send a
  request without `input`).
- I then added one example (`tempF` 98.6, where the two expressions differ) and the missing
  error examples, which needed three additions to the language (`example raw`, `omit`, and an
  example with no input). Second run: tilth 14 of 14, hand-built 13 of 14.

The hand-built suite would also catch the first mutant with one more case. The comparison says
that a suite generated from the brief can be as strict as a hand-built one on this slice; it
does not say it is stricter.

## The edge library across specs

[`examples/rcan/canonical.tilth`](examples/rcan/canonical.tilth) is two lines of binding: it
attaches the `json/rfc8785` and `number-text/ecmascript` packs (42 cases) to the `canonical`
operation that regen-rcan-assurance's driver protocol exposes. `tilth run` sends them to the
RCAN SDKs through regen-rcan-assurance's adapters (copied unchanged apart from the local path
file each one reads, and the driver flags noted below):

| subject | commit | `tilth run` | what fails |
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
| `obligation-in-context.tilth` | mcp-tape r05: the Windows CRLF trap, written as context | T004 (see the file: the original had no MUST) |
| `ambiguous-edge.tilth` | "canonical JSON" without saying which | T015 |
| `rcan-two-orders.tilth` | RCAN: code-point order and RFC 8785 in one section | T026 three times, with no oracle and no implementation |
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
