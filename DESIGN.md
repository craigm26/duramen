# tilth: design

## The problem

A regenerative system keeps its specification and its evaluations and treats the code as
replaceable. In the three regen experiments the brief (`SPEC.md` plus `DECISIONS.md`) was what a
blind builder got, and a hand-built suite judged the result. Most blind builds passed every
case. The mistakes worth a language surfaced elsewhere: in builders' notes on the choices a
brief forced on them, in a check on Windows after a build, and while a spec was extracted from
its sources. A hand-typed example disagreed with its formula; an order was stated twice; an
obligation was written as context in a decision; a protocol section named two incompatible key
orders.

Three of those four need no judgment to find. Each is a claim nobody ran, or the same fact in
two places that disagree. A spec language can give each kind of fact one place to live and can
run the claims that are runnable. That is the whole ambition here. Behavior is still described
in prose; the language checks the structure of authority around the prose. The fourth mistake,
a fact written as context, is a judgment about what a builder must act on; the language can
only catch it when the author used an obligation keyword in the wrong place.

This draws on Chad Fowler's essays on regenerative software. "The Specification Is Not a
Document" (2026-08-19) says "None of this requires a One True Metamodel" and "The durable model
should be strict about authority and loose about vocabulary"; "When Does a Specification Become
a Program?" (2026-08-11) says "A piece of executable code can define an obligation". It also
pulls against them. The first essay's point is that the durable asset is a connected body of
knowledge, and "It requires us to stop assuming that one of those representations must be the
source." tilth makes one file the source. It is a narrow, file-based step: it connects
requirements to evaluations, decisions and shared definitions and checks those connections,
and it does not try to hold incidents, production evidence or confidence.

## Principles

1. **One home per fact.** Obligations live in `req`, reasons in `decision`, deliberate gaps in
   `open`, an order that matters in a numbered list, shared semantics in an `edge`. The
   checker rejects RFC 2119 keywords in the other places and an order restated in a
   requirement.
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
spaces; prose, expectations and table rows are indented four. A line starting with `#` is a
comment, except inside prose (`text`), where it is part of the text. There are no comments at
the end of a line.

```
tilth 0.1

spec <name> <version>
  title "<title>"
  contract <version>
  request {"clock": "2026-05-26T17:00:00.000Z"}
  text
    <prose: what the program is for>

oracle <command>

edge <library name> via <op> <field> base64
  decision <ids>

section <id> "<title>"
  text
    <prose>

op <name>
  input <field> <type>, <field>? <type>
  result <prose summary>
  tolerance <result path> <number>
  audit text
  request {...}

errors
  <code> when <condition>
    <condition, continued>

req <id> "<title>"
  decision <ids>
  on posix
  text
    <prose>
  example <op> <json object>
    expect <path> = <json>
    expect <path> ≈ <number> ± <tolerance>
    expect <path> = ?
    request {...}
    omit <member>, <member>
  example <op>
  example raw "<request line>"
  table <op>
    | <input field> | <expect path> ± <tolerance> | <expect path> |
    | <json>        | <json>                      | ?             |

open <id> "<title>"
  text
    <prose>

decision <id> "<title>"
  source <where the claim came from>
  status accepted
  text
    <context, decision, why>
  rejected "<an alternative, and why not>"

note
  text
    <prose>
```

| statement or clause | meaning |
|---|---|
| `spec … request` | members every request carries besides `id`, `op` and `input` |
| `spec … contract` | a contract version the program emits, shown in the brief |
| `oracle` | a command that speaks the driver protocol for the spec's model |
| `edge … via <op> <field>` | bind the edge's pack to an op: each item is sent as that input field; `base64` when the op answers with the bytes in base64 |
| `op … input` | `name type`, comma-separated; `?` after the name marks it optional; types are documentation in 0.1 |
| `op … tolerance` | how far a numeric result may differ, by path (`result.wetBulbC`) |
| `op … audit text` | the response also carries an `audit` string, compared byte for byte |
| `op … request` | replaces the spec's request members for this op (`request {}` for none) |
| `errors` | the error codes in the order the checks run; the first that applies wins |
| `req … on` | `any` (the default), `posix` or `windows` |
| `example <op> <json>` | a request with this input, sent exactly as written (spellings such as `2.0e1` survive) |
| `example <op>` | a request with no `input` member |
| `example raw "<line>"` | exactly this line, sent on its own in its own run (for lines that are not a well-formed request) |
| `expect <path> = <json>` | the response holds this value at the path: `result…`, `audit…` (the audit text is parsed), `error`, `id` |
| `expect <path> ≈ x ± t` | a number within `t` of `x` (ASCII: `~` and `+-`) |
| `expect <path> = ?` | the oracle's value, shown in the brief and checked by the suite |
| `request`, `omit` under an example | add or replace request members; leave members out (`id`, `op`, `input`, `clock`, ...) |
| table cells | inputs and expectations as JSON; `?` as above; an empty cell states nothing |
| `decision … status` | `observed`, `inferred`, `proposed`, `accepted`, `contested`, `superseded by <id>` or `rejected` (Fowler's lifecycle states); none means accepted |

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
| T004 | error | an uppercase MUST, SHALL or REQUIRED (or a negation) outside quotes in a note, section, the spec's text, a decision or its rejected alternatives, an op's result summary, or an error condition |
| T005 | error | a requirement's text names two codes declared in `errors` and talks about order |
| T006 | error | the oracle fails a bound edge pack |
| T007 | error | duplicate ID (`REQ-x`, `OPEN-x` and decision IDs are separate) |
| T008 | error | a requirement or edge cites an undeclared decision |
| T009 | error | an example names an unknown op (allowed when it expects an error, and for raw lines) |
| T010 | error | an example leaves out a required input field (same exceptions) |
| T011 | warning | an example sends an input field the op does not declare |
| T012 | warning | a decision that no requirement or edge cites |
| T013 | warning | a decision without `source` |
| T014 | warning | an obligation keyword in an open item |
| T015 | error | an ambiguous edge name; the message lists the choices |
| T016 | error | an unknown edge |
| T017 | error | an edge bound to an unknown op |
| T018 | info | an edge not bound to any op (its text is in the brief; no pack cases) |
| T019 | error / info | no oracle, with examples to run / with only edge packs |
| T020 | error | the oracle failed to run |
| T021 | error | the oracle gave no response for an example or a pack item |
| T022 | error | the oracle could not compute an example or a pack item (it says so instead of crashing) |
| T023 | error | an example expects an error code that `errors` does not declare |
| T024 | warning | the oracle answers an example that states no expectations with an error |
| T025 | error | `expect <path> = ?` names a path the oracle's answer does not have |
| T026 | error | two edges bound to the same op and field disagree on a shared pack input |
| T027 | error | a decision status that is not one of the seven, or a supersession with no declared successor |
| T028 | error / warning | a requirement or edge rests on a contested, superseded or rejected decision / on one only observed, inferred or proposed |

T004 and T005 are text heuristics. T005 catches the form r02's mistake took. T004 would not
have caught r05's as written, which used no uppercase keyword; an author can also phrase around
either check, and quotes exempt text from T004 so that decisions can quote earlier sources.

### The edge library

| edge | pack | what it pins |
|---|---|---|
| `number-text/ecmascript` | 23 | ECMAScript `Number::toString`: `1e+21`, `1e-7`, `0.000001`, `-0` as `0`, binary64 rounding |
| `fixed-text/ecmascript` | 0 | ECMAScript `toFixed`: exact binary value, ties up (text only so far) |
| `json/sorted-utf16` | 19 | canonical JSON, keys by UTF-16 code units, lone surrogates escaped |
| `json/sorted-codepoint` | 19 | canonical JSON, keys by code point, lone surrogates refused |
| `json/rfc8785` | 19 | RFC 8785 read strictly: keys by UTF-16 code units, lone surrogates refused |

`canonical-json`, `json` and `number-text` are reserved as ambiguous. `npm test` checks every
pack against an independent model: ECMAScript `String`, the heat-engine canonical writer, and a
code-point writer written for the test. The texts are adapted from regen-heat-engine's
REQ-CJ-001 to REQ-CJ-004. Edge texts are normative and may use MUST.

## What 0.1 does not do

- **The oracle is still hand-written,** and about the size of the implementations it judges
  (256 lines here; regen-rcan-assurance's model is 314 lines, 294 of them not blank). Computed
  examples are only as right as the model. The hand-built heat-engine suite checks its oracle
  against fixtures imported from the earlier implementation; tilth 0.1 cannot import fixtures
  as independent evidence. That is the most important gap.
- **Requirements that are not observable through the driver,** such as REGEN.json fields,
  runtime and dependency budgets, or the builder's own test command, have no place: they cannot
  have examples. The hand-built suites check them statically.
- **The response shape is fixed:** `result`, `audit`, `error`. Types in `input` are not checked.
- **No modules or versions:** one file per spec, a built-in edge library, no deltas between
  spec versions.
- **Text heuristics** (T004, T005) can miss and can misfire.
- **Five blind builds, on one small slice.** Builders given only the generated brief and a
  prompt (which carried REGEN.json and the budgets) produced passing implementations in
  TypeScript and Python (README, Blind builds). The first two found defects in how tilth wrote
  the brief: example objects shown in source order, and a table that never said inputs are
  required. Only example values are now sorted; objects typed in requirement prose still appear
  as typed, so the brief says that objects list their members in no particular order. Five
  builds of programs of 160 to 220 non-blank lines, with one model, do not show how the
  language does on a larger spec or with another builder.

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

1. Fixture import: `table <op> from "<file>"`, so evidence from an earlier implementation
   checks the oracle instead of the oracle checking itself.
2. Static requirements (files, budgets, commands) with their own kind of evaluation, so the
   prompt no longer has to carry REGEN.json and the budgets.
3. Restating regen-mcp-tape or regen-rcan-assurance in full, with blind builds from it, which
   would test the response shape, streams and signals that 0.1 does not cover.
4. Blind builds with another model, to see whether a weaker builder gains more from a checked
   brief than a strong one does.
