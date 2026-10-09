# duramen: design

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
source." duramen makes one record the source. It is a narrow, file-based step: it connects
requirements to evaluations, decisions, evidence and shared definitions and checks those
connections, and it does not try to hold incidents, production telemetry or confidence.

## Principles

1. **One home per fact.** Obligations live in `req`, reasons in `decision`, deliberate gaps in
   `open`, an order that matters in a numbered list, shared semantics in an `edge`. The
   checker rejects RFC 2119 keywords in the other places and an order restated in a
   requirement.
2. **Every obligation has an evaluation.** A `req` without an example, table row, property,
   evidence or static check is an error.
3. **Examples are checked, never trusted.** Each example runs through the oracle at check time.
   A value can be left as `?` and is then the oracle's.
4. **The model is checked too.** The oracle is a plain executable model, written to the spec;
   values typed by hand, evidence from outside the spec, properties and edge packs all check
   it. A requirement whose only checks are the oracle's own answers is reported (T032), and
   `duramen mutate` measures how much of the oracle the spec pins down.
5. **Vague names are refused.** "Canonical JSON" is a family. An edge names one member and
   brings a conformance pack; two bound edges that disagree are a contradiction the checker
   reports, instead of one a builder discovers.
6. **One source, several views.** The brief, the decisions, the trace and the suite are all
   generated, so the brief cannot show an example the suite does not check.
7. **The language is specified in itself.** The core of duramen is a duramen record
   ([`spec/`](spec/)) whose oracle is duramen, and a checker rebuilt blind from that record's
   brief is judged by its suite (README, "duramen specified in duramen").

## The language (0.2)

A *record* is one `.duramen` file, or a folder of them read as one: every `.duramen` file in the
folder and below it, sorted by path (UTF-16 code units), leaving out names that start with `.`
and folders named `build` or `node_modules`. Every file states its version (`duramen 0.1` or
`duramen 0.2`), and all files of a record state the same one. A record has one `spec`, at most
one `oracle` and at most one `errors` list.

A file is line-oriented. Statements start in column 0; their clauses are indented two spaces;
prose, expectations and table rows are indented four (the text of an input block, six). A line
starting with `#` is a comment, except inside prose (`text`), where it is part of the text.
There are no comments at the end of a line, and every line of a file is either read or
reported: a line that belongs to nothing is P006.

The core of the language, the statements of `duramen 0.1` other than `edge`, is specified
exactly by [`spec/`](spec/): what each statement and clause accepts, which diagnostic each
mistake gets and at which line, and how examples become suite cases. Where this page and
`spec/` differ, `spec/` is checked and this page is not.

```
duramen 0.2

spec <name> <version>
  title "<title>"
  contract <version>
  request {"clock": "2026-05-26T17:00:00.000Z"}
  text
    <prose: what the program is for>

oracle <command>
  source <oracle source files>

type <name> = <type>

edge <library name> via <op> <field> base64
  decision <ids>

section <id> "<title>"
  text
    <prose>

op <name>
  input <field> <type>, <field>? <type>
  returns <type>
  result <prose summary>
  tolerance <result path> <number>
  audit text
  request {...}
  draw <field> <type>, <field> <type>

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
    input <path>
      <a text, line by line>
    input <path> from "<file>"
  example <op>
  example raw "<request line>"
  table <op>
    | <input field> | <expect path> ± <tolerance> | <expect path> |
    | <json>        | <json>                      | ?             |
  static file "<glob>" exists
  static lines "<glob>" at most <n> excluding "<glob>"
  static json "<file>" matches <type>
  static command <REGEN.json key> exits 0 within <seconds>
  static text "<glob>" not matching "<regex>"

property <id> "<title>"
  supports <req ids>
  decision <ids>
  for <name> in <lo> .. <hi> | int <lo> .. <hi> | one of <json>, ... | json | <type>
  where <expression>
  samples <n>
  seed <n>
  call <name> = <op> <expression>
  expect <expression>
  text
    <prose>

evidence <id> "<title>"
  source <where the values came from>
  kind published | derived | computed | measured | implementation | incident
  supports <req ids>
  decision <ids>
  table <op>
    | <input field> | <expect path> |
  table <op> from "<file.csv or .jsonl>"
    id <column>
    columns <field> = <column>, ...
    expect <path> = <column>
    expect <path> ≈ <column> ± <column or number>
  waive <row id> because <decision id>

edgedef <name> "<title>"
  family <names>
  text
    <normative prose>
  item <json input> => <expected text>
  item <json input> escaped <JSON string>
  item <json input> refused

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
| `spec … request` | members every request carries besides `id`, `op` and `input` (a JSON object, which cannot set those three) |
| `spec … contract` | a contract version the program emits, shown in the brief |
| `oracle` | a command that speaks the driver protocol for the spec's model; `source` names its files, for `duramen mutate` |
| `type` (0.2) | a named type (below) |
| `edge … via <op> <field>` | bind the edge's pack to an op: each item is sent as that input field; `base64` when the op answers with the bytes in base64 |
| `op … input` | `name type`, comma-separated; `?` after the name marks it optional; in 0.2 the types are checked, in 0.1 they are documentation |
| `op … returns` | the type of the result; the oracle's answers are checked against it (T038) |
| `op … tolerance` | how far a numeric result may differ, by path (`result.wetBulbC`) |
| `op … audit text` | the response also carries an `audit` string, compared byte for byte |
| `op … request` | replaces the spec's request members for this op (`request {}` for none) |
| `op … draw` (0.2) | where `duramen agree` draws an input field from, instead of its input type: a narrower or differently weighted type, so that generated requests reach the behavior that matters (times near the clock, names that collide); it is not shown in the brief and does not limit what a request may carry |
| `errors` | the error codes in the order the checks run; the first that applies wins |
| `req … on` | `any` (the default), `posix` or `windows` |
| `example <op> <json>` | a request with this input, sent exactly as written (spellings such as `2.0e1` survive) |
| `example <op>` | a request with no `input` member |
| `example raw "<line>"` | exactly this line, sent on its own in its own run (for lines that are not a well-formed request); `raw '<line>'` takes the line literally |
| `expect <path> = <json>` | the response holds this value at the path: `result…`, `audit…` (the audit text is parsed), `error`, `id` |
| `expect <path> ≈ x ± t` | a number within `t` of `x` (ASCII: `~` and `+-`) |
| `expect <path> = ?` | the oracle's value, shown in the brief and checked by the suite |
| `request`, `omit` under an example | add request members on top of the spec's or op's; leave members out (`id`, `op`, `input`, `clock`, ...) |
| `input <path>` under an example | a text (the lines below, indented six) at that path of the input, such as `files."a.duramen"`; the input is then sent as compact JSON |
| `input <path> from "<file>"` | the text of a file next to the record instead; the brief shows such a file once, under Files. The name is read from the example's folder, split at `/` (empty parts and `.` skipped, `..` one folder up), and input lines apply in order, `from` lines among them |
| table cells | inputs and expectations as JSON; `?` as above; an empty cell states nothing |
| `static …` (0.2) | a check on the implementation folder itself rather than through the driver |
| `property` (0.2) | a statement checked on generated inputs, for the oracle by `check` and for implementations by the suite |
| `evidence` (0.2) | values from outside the spec (published tables, another implementation's results); the oracle must agree with every row unless a decision waives it |
| `edgedef` (0.2) | an edge: normative text, the family names that are ambiguous without it, and its conformance pack |
| `decision … status` | `observed`, `inferred`, `proposed`, `accepted`, `contested`, `superseded by <id>` or `rejected` (Fowler's lifecycle states); none means accepted |

**Types** (0.2): `number` and `integer`, optionally `in <lo> .. <hi>`; `string`, optionally
`matching "<regex>"` (the whole string); `boolean`, `null`, `any`; literals (`"text"`, numbers,
`true`, `false`); `a | b`; `t[]`; `{a: t, b?: t}` with exactly these members (`b` optional), and
`{a: t, ...}` with any others; `(t)`; and names declared with `type`.

**Properties** (0.2): each sample draws a value for every `for` variable (a number in a closed
range, an integer, one of a list, any JSON value, or a value of a type), keeps it if every
`where` holds, sends the `call` requests in order (a call may use an earlier response), and
requires every `expect`. Expressions have `== != < <= > >= + - * / %`, `and or not`, `c ? x : y`,
member access and indexing, and the functions `abs`, `min`, `max`, `floor`, `ceil`, `round`,
`sqrt`, `exp`, `ln`, `pow`, `len`, `keys`, `has`, `parse`, `text`, `isnum`, `isint`, `isstr`,
`approx`, `num` and `contains`. Samples are drawn from a seeded generator (mulberry32), so a
property draws the same inputs every time.

### The driver protocol

The oracle and every implementation speak the same protocol: JSON request lines on standard
input, one JSON response line per non-blank request on standard output, in order, with the
request's `id`. A response has `result` (and `audit` when the op declares one), or `error`.
Output is UTF-8 with LF line ends and nothing else on standard output; the driver exits 0 at end
of input. An implementation names its driver in `REGEN.json`, as in the regen kit. The rules are
rendered into every brief, and each `duramen run` checks them with three protocol cases (exit
status; bytes; one response per request, in order, with blank lines ignored), and a fourth,
determinism, with `--repeat`.

The runner is defensive about the program on the other end: it never uses a shell, kills the
whole process tree on timeout or runaway output, keeps every response that arrived before a
failure, and reports the exit status, signal, timeout and the tail of standard error.

`duramen serve` is duramen itself as a driver, with three operations: `check` and `cases`, whose
input is a record as a map of file names to texts, and `judge`, whose input is a case of a suite
and an implementation's answer to it, and whose result is the verdict `duramen run` gives that
answer (pass, or the checks and parts of the whole answer it fails). It is the oracle of
`spec/`.

### Checks

Reading a record has P codes; checking it has T codes. When reading finds an error, nothing is
checked further (`spec/`, REQ-RC-005).

| code | rule (P codes for the core are specified exactly in `spec/`) |
|---|---|
| P001 | a line indented with anything but spaces |
| P002 | an unknown statement (its body is skipped) |
| P003 | an indented line before the first statement |
| P004 | not a quoted (JSON) string where one is needed |
| P005 | a statement that needs an ID and a quoted title |
| P006 | a line that belongs to nothing: no clause above it, under a clause that takes no lines, under an example or a table or an error condition at the wrong indent, or not a row under a table |
| P007 | a clause not indented two spaces |
| P008 | `text` with something after the keyword, or a line in it indented three spaces |
| P009 | not valid JSON, JSON holding a number too large for binary64 (`1e400`), or request members that are not a JSON object |
| P010 | an approximate expectation or tolerance column without finite JSON numbers and a tolerance of 0 or more |
| P011 | a line under an example that is none of `expect`, `request`, `omit`, `input` |
| P012 | an example with no op, or an input that is not a JSON object |
| P013 | a table without one op, a header and a row, or whose header has a cell of no known form or names a column twice (cells are read from the left; tolerance problems before that cell are still P010) |
| P014 | a table row with a different number of cells from the header |
| P015 | a clause the statement does not take (the lines under it are ignored) |
| P016 | `edge` not of the form `edge <name> [via <op> <field> [base64]]` |
| P017 | an input field not of the form `<name>[?] <type>`, including an empty one |
| P018 | `tolerance` not a path and a finite number of 0 or more |
| P019 | an `errors` clause not of the form `<code> when <condition>` |
| P020 | a file without a `duramen` statement |
| P021 | `spec` not of the form `spec <name> <version>`, or a record without one |
| P022 | `request`, `omit` or `input` lines under a raw example |
| P023 | an unknown version, or a version stated twice in a file |
| P024 | a type that does not parse |
| P025 | an expression that does not parse, or an unknown function |
| P026 | a raw request line with a line break |
| P027 | a `static` clause of no known form |
| P028 | `oracle` without a command (its clauses are still read) |
| P029 | `type` not of the form `type <name> = <type>` |
| P030 | an `edgedef` item of no known form |
| P031 | `op` without exactly one name (its clauses are still read) |
| P032 | a second `errors` list in a record |
| P033 | `on` other than `any`, `posix`, `windows` |
| P034 | `samples` or `seed` not a whole number in range |
| P035 | a `for` generator of no known form, or an empty or reversed range |
| P036 | `call` not of the form `call <name> = <op> <expression>` |
| P037 | a property expression that reads a name it does not bind |
| P038 | a property with no call or no expectation |
| P039 | an evidence `kind` not one of the six |
| P040 | `waive` not of the form `waive <row> because <decision>` |
| P041 | an evidence `table` of no known form |
| P042 | a line under `table … from` of no known form, or no `columns` line |
| P043 | evidence without `source` or `kind` |
| P044 | a second `spec` or `oracle` in a record |
| P045 | an evidence data file that cannot be read, is outside the record's folder, or lacks a column |
| P046 | a record that cannot be read, or a folder with no `.duramen` files |
| P047 | files of one record that state different versions (of those duramen reads) |
| P048 | an example input file that cannot be read, or is outside the record's folder |
| P049 | an `input` path of no known form, through a value that is not an object, or with no text |
| P050 | text after `note` or `errors`, which take none, or after `audit` other than `text` |
| P051 | request members that try to set `id`, `op` or `input` |
| P052 | a second clause of a kind a statement takes once (`text`, `title`, `source`, `status`, `on`, `result`, ...), a second tolerance for one path, a second input field of one name, or a second `request` line under an example |
| P099 | an internal error in the parser (please report it) |

| code | level | rule |
|---|---|---|
| T001 | error | a requirement has no example, table row, property, evidence or static check |
| T002 | error | an example disagrees with the oracle |
| T003 | error | an open item has examples |
| T004 | error | an uppercase MUST, SHALL or REQUIRED (or a negation) outside quotes in a note, section, the spec's text, a decision or its rejected alternatives, an op's result summary, an error condition, evidence or a property |
| T005 | error | a requirement's text names two codes declared in `errors` (as whole words) and talks about order |
| T006 | error | the oracle fails a bound edge pack |
| T007 | error | duplicate ID within one kind (`REQ-x`, `OPEN-x`, `PROP-x`, `EV-x`, decision IDs and operation names are each their own kind) |
| T008 | error | a requirement, edge, property or evidence cites an undeclared decision |
| T009 | error | an example names an unknown op (allowed when it expects an error, and for raw lines) |
| T010 | error | an example leaves out a required input field (same exceptions) |
| T011 | warning | an example sends an input field the op does not declare |
| T012 | warning | a decision that nothing cites |
| T013 | warning | a decision without `source` |
| T014 | warning | an obligation keyword in an open item |
| T015 | error | an ambiguous edge name; the message lists the choices |
| T016 | error | an unknown edge |
| T017 | error | an edge bound to an unknown op |
| T018 | info | an edge not bound to any op (its text is in the brief; no pack cases) |
| T019 | error / info | no oracle, with examples to run / with only edge packs |
| T020 | error | the oracle failed to run |
| T021 | error | the oracle gave no response for an example or a pack item (a response line holding a number too large for binary64 is none) |
| T022 | error | the oracle could not compute an example or a pack item (it says so instead of crashing) |
| T023 | error | an example expects an error code that `errors` does not declare |
| T024 | warning | the oracle answers an example that states no expectations with an error |
| T025 | error | `expect <path> = ?` names a path the oracle's answer does not have |
| T026 | error | two edges bound to the same op and field disagree on a shared pack input |
| T027 | error | a decision status whose first word is not one of the seven (an empty status included), or a supersession with no declared successor |
| T028 | error / warning | something rests on a contested, superseded or rejected decision / on one only observed, inferred or proposed |
| T029 | error | an example's or evidence row's input does not have the op's declared types (0.2) |
| T030 | error | an evidence row disagrees with the oracle and no decision waives it |
| T031 | error | the oracle breaks a property |
| T032 | warning (error with `--strict`) | a requirement rests on the oracle alone: every value its examples check is the oracle's (0.2) |
| T033 | error | an edge defined twice, or a name that is both an edge and a family |
| T034 | error | a type declared twice, an undeclared type name, or a type that refers to itself with no structure in between |
| T035 | error / warning | a property that calls an unknown op or cannot draw its inputs / whose `where` accepts fewer draws than its samples |
| T036 | error / warning | evidence about an unknown op, or a waiver of a row it does not have / a waiver of a row the oracle agrees with |
| T037 | error | static checks, evidence, properties or `draw` in a `duramen 0.1` record |
| T038 | error | the oracle's answer does not have the op's declared result type |
| T039 | error / warning | evidence or a property that supports an undeclared requirement / that supports none |
| T040 | error | an op input or draw type that does not parse (0.2) |
| T041 | error | an op `draw` for a field the op does not have, or a type nothing can be drawn from |

T004 and T005 are text heuristics. T005 catches the form r02's mistake took. T004 would not
have caught r05's as written, which used no uppercase keyword; an author can also phrase around
either check, and quotes exempt text from T004 so that decisions can quote earlier sources.

### The edge library

Edges are data: each is an `edgedef` in [`lib/edges/`](lib/edges/), and a record can define its
own.

| edge | pack | what it pins |
|---|---|---|
| `number-text/ecmascript` | 23 | ECMAScript `Number::toString`: `1e+21`, `1e-7`, `0.000001`, `-0` as `0`, binary64 rounding |
| `fixed-text/ecmascript` | 0 | ECMAScript `toFixed`: exact binary value, ties up (text only so far) |
| `json/sorted-utf16` | 19 | canonical JSON, keys by UTF-16 code units, lone surrogates escaped |
| `json/sorted-codepoint` | 19 | canonical JSON, keys by code point, lone surrogates refused |
| `json/rfc8785` | 19 | RFC 8785 read strictly: keys by UTF-16 code units, lone surrogates refused |

`canonical-json`, `json` and `number-text` are family names, ambiguous on their own. `npm test`
checks every pack against an independent model: ECMAScript `String`, the heat-engine canonical
writer, and a code-point writer written for the test. The texts are adapted from
regen-heat-engine's REQ-CJ-001 to REQ-CJ-004. Edge texts are normative and may use MUST.

## The tools

| command | what it does |
|---|---|
| `duramen check <record>` | reads and checks a record, running everything runnable through the oracle |
| `duramen build <record>` | writes the brief (`SPEC.md`), `DECISIONS.md`, `trace.md` and the suite (`cases.jsonl`) |
| `duramen run <record> --impl <dir>` | runs the suite against an implementation's driver, static checks included; `--without-oracle` drops every check whose value is the oracle's, to show what the rest catches |
| `duramen mutate <record>` | plants one small mistake at a time in the oracle's source and counts what the spec catches: a mistake that changes an answer and that no check catches marks behavior only the oracle stands behind |
| `duramen agree <record> --impl <dir> ...` | runs several implementations and the oracle on requests generated from the input types, and groups the answers: where builds agree with each other and not with the oracle, the oracle is the suspect |
| `duramen diff <old> <new>` | classifies what changed between two versions of a record (breaking, tightening, additive, relaxing, prose) and checks that the version number says so; the old version's examples that the new one dropped are run through the new oracle, so a change of behavior is breaking even when no text shows it |
| `duramen regen <record> --lang ts\|py` | one blind build, end to end: brief, sandbox, leak check, builder (`claude -p`, allow-listed environment, file and shell tools only), transcript audit, score, ledger |
| `duramen serve` | duramen as a driver (`check`, `cases`, `judge`), the oracle of `spec/` |

## What 0.2 does not do

- **The oracle is still hand-written.** Evidence, properties and `mutate` check it from
  outside, and in the heat-engine slice every `mutate` mutant that changes an answer is now
  caught; but a spec is still only as right as what checks it, and a property is only as right
  as its author.
- **Response shapes are fixed:** `result`, `audit`, `error`. Streams, signals and timing are
  not expressible.
- **Text heuristics** (T004, T005) can miss and can misfire.
- **The self-specification covers the core only:** types, properties, evidence, static checks,
  edges and the suite runner are open in `spec/`, so a checker rebuilt from it implements the
  0.1 language without edges.
- **Few blind builds:** seven of the heat-engine slice and the self-hosting runs, with one
  model family. They do not show how the language does with another builder.

## Compared with spec-driven development tools

Kiro, GitHub's spec-kit and Tessl structure specs as markdown for coding agents (Birgitta
Böckeler's survey on martinfowler.com, 2025-10-15, describes their formats). Kiro writes
acceptance criteria as GIVEN/WHEN/THEN; spec-kit adds a constitution and checklists that the
agent interprets; Tessl treats `.spec.md` files as the source of generated code. OpenSpec writes
`### Requirement:` blocks with SHALL and `#### Scenario:` blocks with WHEN/THEN. In each, the
scenarios are text for an agent or a reviewer to read. Böckeler notes that spec-kit's checklists
are "interpreted by AI, so there is no 100% guarantee that they will be respected".

duramen makes a narrower bet: examples are executed against a model when the spec is written,
the model is checked against evidence and properties, shared semantics are named and carry
conformance packs, and the places facts may live are enforced. It is a checker for briefs that
will be rebuilt from, not a workflow for agents.

## Next

1. Specify more of duramen in duramen: types, properties and the suite runner, so that the
   rebuilt checker covers the whole language.
2. Restating regen-mcp-tape or regen-rcan-assurance in full, with blind builds from it, which
   would test the response shape, streams and signals that 0.2 does not cover.
3. Blind builds with another model, to see whether a weaker builder gains more from a checked
   brief than a strong one does.
