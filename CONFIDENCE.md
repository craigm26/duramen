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

Filled in as the runs finish.
