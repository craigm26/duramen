# Can duramen do regenerative software?

Regenerative software, as used here: people maintain a specification and its evaluations;
implementations are rebuilt from them by any capable builder, and judged by checks that do
not depend on the implementation being judged. duramen claims a narrow form of this, for
programs whose behavior can be observed as requests and responses.

This file states six claims, the test for each, and what counts as passing. **The criteria
were written on 2026-10-09 (UTC), and the commit that adds this file comes before every run
it judges.** Results go under each claim afterwards; the criteria are not edited after a run
starts. A claim that fails is reported as failing.

## 1. The loop converges

**Test.** Round six: two blind builds of duramen-core 0.7.0 by `claude-sonnet-5-5`, s08
(TypeScript) and s09 (Python), judged as s01 to s07 were: the suite, the fixed point,
agreement with duramen on 4,500 mutated records (three seeds of 1,500), and records written
for the choices the builders record.

**Passes if** all of these hold:
- each build passes every case of the 0.7.0 suite;
- each is a fixed point (suites compared as JSON values);
- no request about a mutated record is answered differently from duramen;
- the triage of their choices finds no `clarify`;
- no record written for their choices is answered alike by both builds and differently by
  duramen.

## 2. The specification, not one model, carries the behavior

**Test.** Blind builds of duramen-core 0.7.0 from the same brief and prompt by
`claude-haiku-4-5` (s10, TypeScript) and `claude-opus-5-5` (s11, TypeScript), judged as in
claim 1; and a local model run through Ollama on Craig's PC (the strongest coding model
installed there), first on the heat-engine slice, then on duramen-core if it passes the
slice.

**Passes if** at least one model other than `claude-sonnet-5-5` produces a build of
duramen-core that passes every case of its suite and is a fixed point.

**Reported, with no threshold:** every other build's pass rate and fixed point. A model that
fails says something about that model at this size of specification. A local model that
passes less than half of the heat-engine suite would mean that models of its size cannot yet
serve as builders.

## 3. A regenerated build can be the reference

**Test.** s08 (or, if s08 fails claim 1, the first build of claim 1 that passes) replaces
duramen as the reference for its own specification:
- (a) `spec/` with its oracle pointed at s08 checks with no errors, so all 168 hand-typed
  examples agree with s08;
- (b) the suite s08 generates with itself as the oracle judges s09, s10 and s11, and gives
  each case the same verdict, pass or fail, as duramen's own suite;
- (c) s08 and s09 answer the 4,500 mutated records of claim 1 with duramen out of the loop.

**Passes if** (a) and (b) hold, and every difference in (c) is traced to an open item or
pinned by an example. In (b), the code that compares answers with checks is still duramen's;
claim 4 removes it.

## 4. The judge can be regenerated too

**Test.** duramen-core 0.8.0 adds `judge`: a suite case and an implementation's answer in, a
verdict out (pass, or the checks that failed). This is how `duramen run` compares answers
with checks, written as a requirement with examples for the first time. Blind builds from
0.8.0, s12 (TypeScript) and s13 (Python), implement it. Each earlier build's answers to the
0.7.0 suite are collected once, and s12 and s13 judge every one of them.

**Passes if** s12 and s13 each pass every case of the 0.8.0 suite, are fixed points, and give
every case of every earlier build the same verdict as `duramen run`.

## 5. A second domain: a robot command safety gate

**Test.** `examples/rcan-gate/`: a duramen record for a gate that decides whether a robot may
execute a command, following the RCAN specification (rcan.dev): roles and scopes, level of
assurance, confidence gating, emergency-stop precedence, joint and speed limits, and a replay
window. It is written as a pure transition (state and command in; decision, reason and next
state out), with a reference oracle written to it. Two blind builds, TypeScript and Python, by
`claude-sonnet-5-5`.

**Passes if** all of these hold:
- both builds pass every case of the suite;
- the two builds and the oracle answer 2,000 generated requests (`duramen agree`) alike, or
  every difference is traced;
- every mutant of the oracle that `duramen mutate` leaves alive is shown equivalent or gets
  an example that kills it.

## 6. Usable from Claude Code, Claude desktop and CI

**Test.** `duramen mcp`, an MCP server over standard input and output, registered with Claude
Code in this container: `claude -p` uses it to check a record with a planted mistake and
reports the diagnostic. A Claude Code hook that runs `duramen check` after an edit to a
`.duramen` file returns the diagnostic to the agent. A CI workflow template runs `check`,
`run` and `diff`.

**Passes if** each runs end to end, with its transcript kept.

## What would count against regenerative software here

- Builds that pass every case but differ from duramen on records nobody wrote down, in ways
  no one can trace.
- A regenerated reference that judges differently from the hand-written one.
- A domain whose specification must restate the implementation line by line (Fowler: "If
  maintaining the durable description requires humans to manually reproduce every
  implementation decision in another form, we have gained nothing").

Out of scope for every claim: user interfaces, timing, concurrency and systems of several
services. duramen does not specify those.

## Results

Run on 2026-10-09 (UTC). The criteria above are as committed in e519ba0; where a run departed
from them, it says so.

| claim | result |
|---|---|
| 1. The loop converges | **fails** |
| 2. The specification, not one model, carries the behavior | **passes** (with a deviation in the named model) |
| 3. A regenerated build can be the reference | **(a) and (b) pass, (c) fails**; run with a build that had failed claim 1 |
| 4. The judge can be regenerated too | **passes** |
| 5. A second domain: a robot command safety gate | **passes** |
| 6. Usable from Claude Code, Claude desktop and CI | **passes** |

### 1. The loop converges: fails

s08 (TypeScript) and s09 (Python) each passed every case of the 0.7.0 suite (171/171) and were
fixed points (as JSON values). Each of the three other conditions failed:

- **Mutated records.** s08 answered 9,945 of 9,948 requests as duramen did, and s09 9,947. The
  4 requests that differed came from three records: a raw example's `input ... from` line
  followed by a line indented six; a valid tolerance and then a malformed one for the same path;
  and two decisions with one ID.
- **`clarify`.** Each build's triage found three. The worst was a sentence of REQ-SY-003 that
  contradicted an example of REQ-SY-007.
- **Records written for their choices.** Of 72 such records, 18 were answered in more than one
  way. Several were answered alike by both builds and differently by duramen. On some of those,
  duramen was the one that was wrong: in JavaScript `.` matches no U+2028, and duramen's patterns
  used it.

Two more builds of 0.7.0 (claim 2) differed on two of the same three records and nowhere else
among the mutants. Their 75 choices led to 103 more records, 26 of them answered in more than one way. The
mutants, which explore near the suite's own records, have almost stopped finding differences;
the builders' recorded choices, which point at corners the words leave open, have not. 0.8.0
pins what the four builds found in 20 new examples. Where duramen was wrong, it changed (five
readings). Where a build was, the words now say so ([D-018](spec/90-decisions.duramen); the run
records are [`selfhost/s08-ts.md`](selfhost/s08-ts.md) to [`s11-ts.md`](selfhost/s11-ts.md)).

### 2. The specification, not one model, carries the behavior: passes

| run | model | suite | fixed point | mutated records answered as duramen did |
|---|---|---|---|---|
| s11 | `claude-opus-5-5` | 171/171 | yes, as text too | 9,945 of 9,948 |
| s10 | `claude-haiku-5-5` | 171/171 | yes, as text too | 9,945 of 9,948 |
| s10b | `claude-haiku-4-5-20251001` | 1/171 | (the driver does not start) | |
| L01 | Gemma 4 E2B, through llama.cpp, on Craig's PC | 0/209 of the heat-engine slice | | |

s11 meets the criterion, and so does s10. The deviations:

- **The Haiku model.** The criteria named `claude-haiku-4-5`. s10 was launched with
  `--model haiku`, which the CLI resolved to `claude-haiku-5-5`. The named model was then run
  as s10b. Its `REGEN.json` starts the driver with a flag Node refuses for a file, so nothing
  ran. As a diagnostic only, a copy started correctly passes 69 of 171.
- **The local model.** It ran through llama.cpp's server, not Ollama; both speak the same
  OpenAI-compatible protocol (`lib/regen/agent.mjs`).
- **L01.** It read part of the brief and wrote code that does not parse. It wrote no driver,
  and called `finish` with the work undone. By the criteria, that means models of its size
  cannot yet serve as builders, and it was not tried on duramen-core.
- **A bug in the audit.** s10b's run exposed it: the audit could not accept a model given by
  its full ID. Fixed, and the run audited again (clean).

### 3. A regenerated build can be the reference: (a) and (b) pass, (c) fails

The criteria said to use s08, or the first build of claim 1 that passed claim 1. None did, so
this ran with s08 anyway ([`selfhost/reference.mjs`](selfhost/reference.mjs)).

- **(a) passes.** `spec/`, with its oracle pointed at s08, checks with no errors: all 168
  hand-typed examples agree with s08.
- **(b) passes.** The suite s08 writes with itself as the oracle is duramen's, value for value.
  It gave every case the same verdict as duramen's suite, for eleven builds: the seven of the
  earlier rounds (147 to 167 of 171), s09, s10, s11, and s10b at 1/171. Once a build is
  a fixed point its suite equals duramen's, so (b) follows from it. The new evidence here is
  that the verdicts held across builds that fail cases, too.
- **(c) fails.** With duramen out of the loop, s08 and s09 answered 9,944 of the 9,948
  mutated-record requests alike. The 4 that differed are the three records of claim 1, all
  traced. None was open or pinned in 0.7.0, so (c) fails as worded. 0.8.0 pins all three.

### 4. The judge can be regenerated too: passes

duramen-core 0.8.0 adds `judge` (REQ-JU-001 to REQ-JU-004, D-019): a case and an answer in;
`{"pass": true}`, or the checks and parts of the whole answer that failed, out. Until then, how
`duramen run` compares an answer with a case had been written only in duramen's code.

| run | language | suite of 0.8.0 | fixed point | answers of earlier builds given duramen's verdict | the same failed parts |
|---|---|---|---|---|---|
| s12 | TypeScript | 235/235 | yes, as text too | 2,016 of 2,016 | 2,016 of 2,016 |
| s13 | Python | 235/235 | yes, as JSON values | 2,016 of 2,016 | 2,016 of 2,016 |

The answers are those of the twelve earlier builds (s01 to s11 and s10b) to every case of the
0.7.0 suite, collected once as `duramen run` collects them. duramen passes 0 to 168 of each
build's 168, so the judges had failures to agree on as well as passes. Both judges were built
by `claude-sonnet-5-5` from the brief alone ([`selfhost/judges.mjs`](selfhost/judges.mjs);
[s12](selfhost/s12-ts.md), [s13](selfhost/s13-py.md)).

With claim 3, every part of the loop has now been done by a rebuilt program at least once.
Builds wrote the suite (s08's equals duramen's), stood in as the oracle (every example agreed
with s08), and ran the comparison (s12 and s13). The pieces were tried one at a time. A whole
loop with no duramen in it (a build as the oracle, its suite, a rebuilt judge, run against a
fresh build) has not been run as one, and the runner that collects answers is still duramen's.

Their triage found more of duramen's mistakes than theirs. duramen was fixed after the round,
as the run records say. Among them: standard input decoded one 64 KiB read at a time, members
named `__proto__`, and the order of input lines.

### 5. A second domain, a robot command safety gate: passes

[`examples/rcan-gate/`](examples/rcan-gate/) specifies a gate for RCAN commands. It is a pure
function: state and command in; decision, reason and next state out. It covers RCAN's roles and
scopes, level of assurance, freshness and replay, the ESTOP and STOP latches, joint and speed
limits, and per-scope confidence gates that block or hold for a person. The record has 20
requirements, 197 examples, 4 properties, 12 decisions with their sources, and 4 open items.

| condition | result |
|---|---|
| both builds pass the suite | g01 (TypeScript) and g02 (Python), by `claude-sonnet-5-5`: **209/209** each, 2.3 minutes each |
| 2,000 generated requests answered alike, or every difference traced | **6,000 of 6,000** alike (three seeds of 2,000, the two builds and the oracle) |
| every mutant `duramen mutate` leaves alive shown equivalent, or killed | 148 mutants. 138 were caught, 3 of them by examples added after the first run. The 10 that change no answer are each shown equivalent in [the gate's README](examples/rcan-gate/README.md) |

- **A new duramen feature.** To pass, `duramen agree` needed a way to draw its requests from
  narrower types than an operation's inputs. duramen gained `op … draw` for that, before the
  builds were launched.
- **What agreement cannot see.** The drawn times are round numbers. A gate that compares
  freshness by another expression passes all 2,000 requests; the suite's examples catch it.
- **Size.** The record is 794 lines: 302 of examples, 210 of requirement text, and 131 of
  decisions and open items. The oracle is 118 lines; the builds are 158 and 179.
- **What it found in RCAN's own sources.** rcan-ts refuses the scopes `constructor` and
  `__proto__` for every role, against its own rule for unknown scopes. Its SDKs and one
  changelog line disagree about a confidence equal to the minimum. Its documents disagree with
  each other about where `min_loa_for_control` applies.

### 6. Usable from Claude Code, Claude desktop and CI: passes

Each ran end to end, with its transcript in [`integrations/`](integrations/):

- **The MCP server.** `claude -p`, with `duramen mcp`, found and explained a planted T002.
- **The hook.** It blocked an edit that broke an example, and told the agent why at once.
- **CI.** The workflow's steps ran on the heat-engine slice.

### Against regenerative software, as listed above

- **Builds that differ from duramen on records nobody wrote down, in ways no one can trace.**
  Each difference found was traced, to a builder's recorded choice or to a mutated example. But
  each round still found new ones: 44 of 175 records written for round six's choices were
  answered in more than one way.
- **A regenerated reference that judges differently from the hand-written one.** It did not
  happen (claim 3 (b)), and neither did a regenerated judge that judges differently (claim 4).
- **A domain whose specification must restate the implementation line by line.** The gate's
  prose (its requirements, sections and errors list) is longer than its oracle, 210 lines to
  118. It states behavior, not code: two builders who never saw the oracle wrote 158 and 179
  lines from it, in two languages. Whether that is a restatement is for the reader to judge
  from the record.

