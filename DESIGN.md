# tilth: design

## The problem

A regenerative system keeps its specification and its evaluations and treats the code as
replaceable. In the three regen experiments the brief (`SPEC.md` plus `DECISIONS.md`) was what a
blind builder got, and the suite was how the result was judged. The suites caught the
implementations' mistakes. The briefs' own mistakes were found later, by builders, at the cost
of a build each: a hand-typed example that disagreed with its formula, an order stated twice,
an obligation written as context, a protocol section that named two incompatible key orders.

None of these needs judgment to find. Each is a fact in the wrong place, or the same fact in
two places, or a claim nobody ran. A spec language can make each kind of fact live in one
place and can check the claims it can run. That is the whole ambition here. Behavior is still
described in prose; the language checks the structure of authority around the prose.

This follows Chad Fowler's essays on regenerative software, which argue against "a One True
Metamodel" and for a durable model that is "strict about authority and loose about vocabulary"
("The Specification Is Not a Document", 2026-08-19), and note that "a piece of executable code
can define an obligation" ("When Does a Specification Become a Program?", 2026-08-11). The
tension is plain too: those essays argue that the durable asset is a connected body of
knowledge, not one master document, and tilth is a file format. It is a narrow, file-based
step: it connects requirements to evaluations, decisions and shared definitions, and checks
those connections; it does not try to hold incidents, production evidence or confidence.

## Principles

1. **One home per fact.** Obligations live in `req`, reasons in `decision`, deliberate gaps in
   `open`, an order that matters in a numbered list, shared semantics in an `edge`. The
   checker rejects obligation words elsewhere and order restated in a requirement.
2. **Every obligation has an evaluation.** A `req` without an example or table row is an error.
3. **Examples are checked, never trusted.** Each example runs through the oracle at check time.
   A value can be left as `?` and is then the oracle's.
4. **The model is part of the spec.** The oracle is a plain executable model, written to the
   spec, allowed to be slow. Examples check it and it checks examples; edges check it.
5. **Vague names are refused.** "Canonical JSON" is a family. An edge names one member and
   brings a conformance pack; two bound edges that disagree are a contradiction the checker
   reports, instead of one a builder discovers.
6. **One source, several views.** The brief, the decisions, the trace and the suite are all
   generated, so the brief cannot show an example the suite does not check.

## The language (0.1)

A `.tilth` file is line-oriented. Statements start in column 0; their clauses are indented two
spaces; prose, expectations and table rows are indented four. `#` in column 0 starts a comment.

```
tilth 0.1
spec <name> <version>
  title "<title>"
  contract <version>                  # optional: a contract version the program emits
  request {"clock": "..."}            # members every request carries (an op can replace them)
  text
    <prose: what the program is for>

oracle <command>                      # a driver for the spec's executable model

edge <library name> [via <op> <field> [base64]]
  decision <ids>

section <id> "<title>"
  text
    <prose; no obligation words>

op <name>
  input <field>[?] <type>, ...        # ? = optional; types are documentation in 0.1
  result <prose summary>
  tolerance <result path> <number>    # e.g. result.wetBulbC 0.00001
  audit text                          # the response carries an audit text, compared byte for byte
  request {...}                       # replaces the spec's request members for this op

errors                                # the order of checks; the first that applies wins
  <code> when <condition>
    <condition continues>

req <id> "<title>"
  decision <ids>
  on any|posix|windows
  text
    <prose; MUST and friends belong here>
  example <op> <json object>          # a request; the input is sent exactly as written
    expect <path> = <json>            # path: result..., audit... (audit text is parsed), error, id
    expect <path> ≈ <number> ± <tol>  # or ~ and +-
    expect <path> = ?                 # the oracle's value, shown in the brief, checked by the suite
    request {...}                     # members for this request only
    omit <member>, ...                # leave members out (id, op, clock, input, ...)
  example <op>                        # a request with no input member
  example raw "<line>"                # exactly this line, sent on its own
  table <op>
    | <input field> | <expect path> ± <tol> | ... |
    | <json>        | <json or ?>           | ... |   # an empty cell states nothing

open <id> "<title>"
  text
    <prose: deliberately unspecified, never tested>

decision <id> "<title>"
  source <where the claim came from>
  status observed|inferred|proposed|accepted|contested|superseded by <id>|rejected
  text
    <context, decision, why>
  rejected "<an alternative, and why not>"

note
  text
    <background prose; no obligation words>
```

### The driver protocol

The oracle and every implementation speak the same protocol: JSON request lines on standard
input, one JSON response line per non-blank request on standard output, in order, with the
request's `id`. A response has `result` (and `audit` when the op declares one), or `error`.
Output is UTF-8 with LF line ends and nothing else on standard output; the driver exits 0 at end
of input. An implementation names its driver in `REGEN.json`, as in the regen kit. The rules are
rendered into every brief, and each `tilth run` checks them with three protocol cases (exit
status; bytes; one response per request, in order, with blank lines ignored).

### Checks

Syntax errors have P codes. The spec rules:

| code | level | rule |
|---|---|---|
| T001 | error | a requirement has no example or table row |
| T002 | error | an example disagrees with the oracle |
| T003 | error | an open item has examples |
| T004 | error | MUST, SHALL or REQUIRED outside a requirement (note, section, spec text) |
| T005 | error | a requirement names two error codes and talks about order |
| T006 | error | the oracle fails a bound edge pack |
| T007 | error | duplicate ID (`REQ-x`, `OPEN-x` and decision IDs are separate) |
| T008 | error | a requirement or edge cites an undeclared decision |
| T009 | error | an example names an unknown op (allowed when it expects an error) |
| T010 | error | an example leaves out a required input field (same exception) |
| T011 | warning | an example sends an input field the op does not declare |
| T012 | warning | a decision nothing cites |
| T013 | warning | a decision without `source` |
| T014 | warning | an obligation word in an open item |
| T015 | error | an ambiguous edge name; the message lists the choices |
| T016 | error | an unknown edge |
| T017 | error | an edge bound to an unknown op |
| T018 | info | an edge not bound to any op (its text is in the brief; no pack cases) |
| T019 | error / info | no oracle, with examples to run / with only edge packs |
| T020 | error | the oracle failed to run |
| T021 | error | the oracle gave no response for an example |
| T022 | error | the oracle could not compute an example (it says so instead of crashing) |
| T023 | error | an example expects an error code that `errors` does not declare |
| T024 | warning | the oracle answers an example with an error the example does not state |
| T025 | error | `expect <path> = ?` names a path the oracle's answer does not have |
| T026 | error | two edges bound to the same op and field disagree on a shared pack input |
| T027 | error | a decision status that is not one of the seven, or a supersession with no successor |
| T028 | error / warning | a requirement rests on a contested, superseded or rejected / an unaccepted decision |

T004 and T005 are text heuristics. They catch the form these mistakes took in the experiments;
an author can phrase around them.

### The edge library

| edge | pack | what it pins |
|---|---|---|
| `number-text/ecmascript` | 23 | ECMAScript `Number::toString`: `1e+21`, `1e-7`, `0.000001`, `-0` as `0`, binary64 rounding |
| `fixed-text/ecmascript` | 0 | ECMAScript `toFixed`: exact binary value, ties up (text only so far) |
| `json/sorted-utf16` | 19 | canonical JSON, keys by UTF-16 code units, lone surrogates escaped |
| `json/sorted-codepoint` | 19 | the same with keys by code point |
| `json/rfc8785` | 19 | RFC 8785 read strictly: as `json/sorted-utf16`, but lone surrogates are refused |

`canonical-json`, `json` and `number-text` are reserved as ambiguous. `npm test` checks every
pack against an independent model (ECMAScript `String`, the heat-engine writer, a code-point
writer). The texts are adapted from regen-heat-engine's REQ-CJ-001 to REQ-CJ-004.

## What 0.1 does not do

- **The oracle is still hand-written,** and about the size of the implementations it judges
  (256 lines here; regen-rcan-assurance's model was 294). Computed examples are only as right
  as the model. The hand-built heat-engine suite checks its oracle against fixtures imported
  from the earlier implementation; tilth 0.1 cannot import fixtures as independent evidence.
  That is the most important gap.
- **Requirements that are not observable through the driver,** such as REGEN.json fields,
  runtime and dependency budgets, or the builder's own test command, have no place: they cannot
  have examples. The hand-built suites check them statically.
- **The response shape is fixed:** `result`, `audit`, `error`. Types in `input` are not checked.
- **No modules or versions:** one file per spec, a built-in edge library, no deltas between
  spec versions.
- **Text heuristics** (T004, T005) can miss and can misfire.
- **Not tested on a blind build yet.** Both heat-engine implementations pass the generated
  suite, but they were built from the prose brief. Whether a builder does as well from the
  generated brief is the experiment that would test the language.

## Compared with spec-driven development tools

Kiro, GitHub's spec-kit and Tessl structure specs as markdown for coding agents (Birgitta
Böckeler's survey on martinfowler.com, 2025-10-15, describes their formats). Kiro writes
acceptance criteria as GIVEN/WHEN/THEN; spec-kit adds a constitution and checklists that the
agent interprets; Tessl treats `.spec.md` files as the source of generated code. OpenSpec writes
`### Requirement:` blocks with SHALL and `#### Scenario:` blocks with WHEN/THEN. In each, the
scenarios are text for an agent or a reviewer to read. Böckeler notes that spec-kit's checklists
are "interpreted by AI, so there is no 100% guarantee that they will be respected".

tilth makes a narrower bet: examples are executed against a model when the spec is written,
shared semantics are named and carry conformance packs, and the places facts may live are
enforced. It is a checker for briefs that will be rebuilt from, not a workflow for agents.

## Next

1. A blind build from the generated heat-engine brief, scored against the prose brief's
   results (r01 to r04 in regen-heat-engine).
2. Fixture import: `table <op> from "<file>"`, so evidence from an earlier implementation
   checks the oracle instead of the oracle checking itself.
3. Static requirements (files, budgets, commands) with their own kind of evaluation.
4. Restating regen-mcp-tape or regen-rcan-assurance in full, which would test the response
   shape, streams and signals that 0.1 does not cover.
