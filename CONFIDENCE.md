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

Run on 2026-10-09 (UTC). The criteria above are as committed in e519ba0, which reached GitHub
by 03:48:48 UTC, when its CI run
([37880980807](https://github.com/craigm26/duramen/actions/runs/37880980807)) started. The
first builds started about 15 seconds later (their records' end times less their durations).
Where a run departed from the criteria, it says so. An agent that had not seen the work then
checked these results against the repository, rerunning what it could; what it found, and what
changed, is [the last section](#the-independent-check).

| claim | result |
|---|---|
| 1. The loop converges | **fails** |
| 2. The specification, not one model, carries the behavior | **passes**, with a deviation in the named model |
| 3. A regenerated build can be the reference | **fails**: (a) and (b) pass, (c) does not; run with a build that had failed claim 1 |
| 4. The judge can be regenerated too | **passes**, on every case that has an answer; the 3 protocol cases of a run are outside `judge` |
| 5. A second domain: a robot command safety gate | **passes** |
| 6. Usable from Claude Code, Claude desktop and CI | **passes**: the MCP server, the hook, and the CI template on GitHub's runners; Claude desktop was not tried |

### 1. The loop converges: fails

s08 (TypeScript) and s09 (Python) each passed every case of the 0.7.0 suite (171/171) and were
fixed points (as JSON values). Each of the three other conditions failed:

- **Mutated records.** Each build got 9,948 requests: `check` and `cases` for each of 4,500
  mutated records, and, in each of the three runs, for the suite's own 158 records. s08 answered
  9,945 as duramen did, and s09 9,947. The 4 requests that differed were all about mutated
  records, and about three of them: a raw example's `input ... from` line followed by a line
  indented six, and two decisions with one ID (s08); a valid tolerance and then a malformed one
  for the same path (s09).
- **`clarify`.** Each build's triage found three. The worst was a sentence of REQ-SY-003 that
  contradicted an example of REQ-SY-007.
- **Records written for their choices.** Of 72 such records, 15 were answered in more than one
  way by duramen, s08 and s09, and 12 of those alike by both builds and differently by duramen.
  (Counting s10's and s11's answers too, 18 were answered in more than one way.) On some of the
  12, duramen was the one that was wrong: in JavaScript `.` matches no U+2028, and duramen's
  patterns used it.

Two more builds of 0.7.0 (claim 2) differed from duramen on two of the same three records and
on no other mutant. Their 75 choices led to 103 more records, 26 of them answered in more than
one way by duramen and the four builds. The mutants, which explore near the suite's own
records, have almost stopped finding differences; the builders' recorded choices, which point
at corners the words leave open, have not. 0.8.0 pins what the four builds found in 20 new
examples. Where duramen was wrong, it changed (five readings). Where a build was, the words now
say so ([D-018](spec/90-decisions.duramen); the run records are
[`selfhost/s08-ts.md`](selfhost/s08-ts.md) to [`s11-ts.md`](selfhost/s11-ts.md)).

### 2. The specification, not one model, carries the behavior: passes

| run | model | suite | fixed point | of the 9,948 requests of claim 1, answered as duramen did |
|---|---|---|---|---|
| s11 | `claude-opus-5-5` | 171/171 | yes, as text too | 9,945 of 9,948 |
| s10 | `claude-haiku-5-5` | 171/171 | yes, as text too | 9,945 of 9,948 |
| s10b | `claude-haiku-4-5-20251001` | 1/171 | (the driver does not start) | |
| L01 | Gemma 4 E2B, through llama.cpp, on Craig's PC | none of the 209 cases of the heat-engine slice could run | | |

s11 meets the criterion, and so does s10. The deviations and caveats:

- **The Haiku model.** The criteria named `claude-haiku-4-5`. s10 was launched with
  `--model haiku`, which the CLI resolved to `claude-haiku-5-5`. The named model was then run
  as s10b. Its `REGEN.json` starts the driver with a flag Node refuses for a file, so nothing
  ran. As a diagnostic only, a copy started correctly passes 69 of 171. That is one run.
- **The local model.** It ran through llama.cpp's server, not Ollama; both speak the same
  OpenAI-compatible protocol (`lib/regen/agent.mjs`).
- **L01.** It read part of the brief and wrote a driver that Node cannot run (an `await`
  outside an async function, and one constant declared twice), with no `REGEN.json` to start
  it, and called `finish` with the work undone. By the criteria, that means models of its size
  cannot yet serve as builders, and it was not tried on duramen-core. Its transcript is kept on
  Craig's PC, because it holds local paths; the record gives its sha256.
- **A bug in the audit.** s10b's run exposed it: the audit could not accept a model given by
  its full ID. Fixed, and the run audited again (clean).
- **s10's fixed point under load.** Alone, s10 is a fixed point, as text too. With seven other
  runs on the same machine, its check of `spec/` passed the 10-second limit it sets its own
  oracle (its choice C-20) and reported T020 and T021.

### 3. A regenerated build can be the reference: fails

The criteria said to use s08, or the first build of claim 1 that passed claim 1. None did, so
this ran with s08 anyway ([`selfhost/reference.mjs`](selfhost/reference.mjs)). The claim passes
only if (a), (b) and (c) all hold, and (c) does not.

- **(a) holds.** `spec/`, with its oracle pointed at s08, checks with no errors: all 168
  hand-typed examples agree with s08.
- **(b) holds.** The suite s08 writes with itself as the oracle is duramen's, value for value.
  It gave every case the same verdict as duramen's suite, for eleven builds: the seven of the
  earlier rounds (147 to 167 of 171), s09, s10, s11, and s10b at 1/171. Once a build is a fixed
  point its suite equals duramen's, so (b) follows from it. The new evidence here is that the
  verdicts held across builds that fail cases, too.
- **(c) does not hold.** With duramen out of the loop, s08 and s09 answered 9,944 of the 9,948
  requests alike. The 4 that differed are about the three records of claim 1, all traced. None
  was open or pinned in 0.7.0, which (c) requires. 0.8.0 pins all three.

### 4. The judge can be regenerated too: passes

duramen-core 0.8.0 adds `judge` (REQ-JU-001 to REQ-JU-004, D-019): a case and an answer in;
`{"pass": true}`, or the checks and parts of the whole answer that failed, out. Until then, how
`duramen run` compares an answer with a case had been written only in duramen's code.

| run | language | suite of 0.8.0 | fixed point | answers of earlier builds given duramen's verdict | the same failed parts |
|---|---|---|---|---|---|
| s12 | TypeScript | 235/235 | yes, as text too | 2,016 of 2,016 | 2,016 of 2,016 |
| s13 | Python | 235/235 | yes, as JSON values | 2,016 of 2,016 | 2,016 of 2,016 |

The answers are those of the twelve earlier builds (s01 to s11 and s10b) to the 168 example
cases of the 0.7.0 suite, collected once as `duramen run` collects them. duramen passes 0 to
168 of each build's 168, so the judges had failures to agree on as well as passes. A run's
other 3 cases (its exit status, its bytes, one response per request) judge the whole stream,
not one answer, and `judge` does not take them: that narrows the criteria's "every case", and
is said here. Both judges were built by `claude-sonnet-5-5` from the brief alone
([`selfhost/judges.mjs`](selfhost/judges.mjs); [s12](selfhost/s12-ts.md),
[s13](selfhost/s13-py.md)).

With claim 3, every part of the loop has now been done by a rebuilt program at least once.
Builds wrote the suite (s08's equals duramen's), stood in as the oracle (every example agreed
with s08), and ran the comparison (s12 and s13). The pieces were tried one at a time. A whole
loop with no duramen in it (a build as the oracle, its suite, a rebuilt judge, run against a
fresh build) has not been run as one, and the runner that collects answers is still duramen's.

Their triage found more of duramen's mistakes than theirs. duramen was fixed after the round,
in 55ae953, as the run records say. Among them: standard input decoded one 64 KiB read at a
time, members named `__proto__`, and the order of input lines.

### 5. A second domain, a robot command safety gate: passes

[`examples/rcan-gate/`](examples/rcan-gate/) specifies a gate for RCAN commands. It is a pure
function: state and command in; decision, reason and next state out. It covers RCAN's roles and
scopes, level of assurance, freshness and replay, the ESTOP and STOP latches, joint and speed
limits, and per-scope confidence gates that block or hold for a person. The record the builds
were made from, 1.0.0, has 20 requirements, 197 examples, 4 properties, 12 decisions with their
sources, and 4 open items.

| condition | result |
|---|---|
| both builds pass the suite | g01 (TypeScript) and g02 (Python), by `claude-sonnet-5-5` in 2.3 minutes each: **209/209** each |
| 2,000 generated requests answered alike, or every difference traced | **6,000 of 6,000** alike (three seeds of 2,000, the two builds and the oracle) |
| every mutant `duramen mutate` leaves alive shown equivalent, or killed | 148 mutants. 138 were caught, 3 of them by examples added after a first run of `duramen mutate`, whose output was not kept. The 10 that change no answer are each shown equivalent in [the gate's README](examples/rcan-gate/README.md) |

- **A new duramen feature.** To pass, `duramen agree` needed a way to draw its requests from
  narrower types than an operation's inputs. duramen gained `op … draw` for that while the
  record was written, before the builds were launched; it was committed afterwards, with the
  round's other changes, in fe33f6d. It changes what `agree` sends, and nothing in the brief.
- **What agreement cannot see.** The drawn times are round numbers. A gate that compares
  freshness by another expression passes all 2,000 requests; the suite's examples catch it.
- **What a second sweep found.** [`sweep.mjs`](examples/rcan-gate/sweep.mjs), outside
  `duramen mutate` and so outside the criteria, swaps each string literal of the oracle for
  another of its family and deletes each early return. At 1.0.0 it left 12 of 117 mutants
  alive. Six change only the label of a malformed member, which only ever becomes
  `bad_request`. The other six raise the lowest role of a scope no example reached:
  `discover`, `observer`, `training`, `config`, `authority` and `admin`. The record stated
  those roles; nothing checked them. Record 1.1.0 adds 16 examples (`duramen diff`:
  tightening). The sweep then leaves only the six labels, `duramen mutate` gives the same 148,
  138 and 10, and both builds pass the 1.1.0 suite, 225/225
  ([`sweep.txt`](examples/rcan-gate/sweep.txt)).
- **Size.** Record 1.0.0 is 793 lines, 729 of them not blank: 259 of examples, 184 of
  requirement text and 131 of decisions and open items. The oracle is 118 non-blank lines; the
  builds are 158 and 179.
- **What it found in RCAN's own sources.** rcan-ts refuses the scopes `constructor` and
  `__proto__` for every role, against its own rule for unknown scopes. Its SDKs and one
  changelog line disagree about a confidence equal to the minimum. Its documents disagree with
  each other about where `min_loa_for_control` applies.

### 6. Usable from Claude Code, Claude desktop and CI: passes

The transcripts are in [`integrations/`](integrations/). The two Claude Code transcripts are
extracts of the raw streams: the lines that show the tool calls and their results. The CI
transcripts are GitHub's whole job logs.

- **The MCP server: passes.** `claude -p`, with `duramen mcp`, found and explained a planted
  T002.
- **The hook: passes.** It blocked an edit that broke an example, and told the agent why at
  once.
- **CI: passes.** [`duramen-template.yml`](.github/workflows/duramen-template.yml) is the
  template with its two paths set to the heat-engine slice and one blind build of it. On
  GitHub's runners it ran `check` and `run` (209/209) on the push of the branch
  ([run 37903296525](https://github.com/craigm26/duramen/actions/runs/37903296525)), and
  `check`, `run` and `diff` on its pull request
  ([run 37903423478](https://github.com/craigm26/duramen/actions/runs/37903423478)); the logs
  are kept in [`integrations/ci/`](integrations/ci/). The template's steps were first run only
  by hand in this container ([`local-run.txt`](integrations/ci/local-run.txt)); the independent
  check pointed out that the workflow itself had not run, and these runs followed.
- **Claude desktop** has a configuration file ([`claude_desktop_config.json`](integrations/claude-desktop/claude_desktop_config.json))
  and was not tried. The criteria's test does not include it, so the title claims more than
  the test shows.

### Against regenerative software, as listed above

- **Builds that differ from duramen on records nobody wrote down, in ways no one can trace.**
  Each difference found was traced, to a builder's recorded choice or to a mutated example. But
  each round still found new ones: 44 of 175 records written for round six's choices were
  answered in more than one way by duramen and the four builds.
- **A regenerated reference that judges differently from the hand-written one.** It did not
  happen (claim 3 (b)), and neither did a regenerated judge that judges differently (claim 4).
- **A domain whose specification must restate the implementation line by line.** The gate's
  prose (its requirements, sections and errors list) is longer than its oracle, 195 non-blank
  lines to 118. It states behavior, not code: two builders who never saw the oracle wrote 158
  and 179 non-blank lines from it, in two languages. Whether that is a restatement is for the reader to
  judge from the record.

## The independent check

After the results above were first written, an agent that had not seen the work checked each
of them against this repository: it rebuilt old versions in git worktrees and reran the
suites, the fixed points, the agreement runs, the probes, the judges, the gate's suite,
`agree` and `mutate`, and counted lines and cases. Every number it could rerun came out as
written, except for these, which are corrected above and in the run records:

| what it found | what changed |
|---|---|
| Claim 3's verdict did not follow its own criteria: (c) failed, so the claim fails | claim 3 is reported as failing; README.md no longer says "passes in part" |
| s08's record said each build differed from duramen on three mutated records; they differed on one or two (s08 two, s09 one, s10 two, s11 two) | the sentence in [`selfhost/s08-ts.md`](selfhost/s08-ts.md) |
| L01 was said to have written no driver; it wrote one Node cannot run, and no REGEN.json | claim 2, L01 |
| The gate record was said to be 794 lines, and its parts were counted by no stated rule | 793 lines; the parts as non-blank lines |
| The round-seven records said duramen had been fixed, in the commit before the fix (a1b7b16, then 55ae953) | the records now name 55ae953 |
| s12's record called a choice `clarify` that s13's called already pinned, though it is a 0.9.0 proposal | both `clarify`; s13 has 4, and 18 already pinned |
| Claim 1's 18 of 72 counted five checkers' answers; for duramen, s08 and s09 it is 15, and 12 alike in both builds | claim 1 gives both |
| s13's record counted kept records with requests that were not kept (87, 29) | 46 records, 14 answered in more than one way; the other requests are described, not counted |
| Claim 4 judged the 168 example cases of each build, not the 3 protocol cases of each run | said in claim 4 |
| Claim 6's CI ran the template's steps by hand, not as a workflow | the template then ran on GitHub's runners, on a push and on the pull request; claim 6 passes on those runs |
| The gate README's second sweep of mutants (102 mutants, 6 alive, all label changes) had no script or output kept | rewritten and kept as [`sweep.mjs`](examples/rcan-gate/sweep.mjs) and [`sweep.txt`](examples/rcan-gate/sweep.txt), it makes 117 mutants and left 12 alive at 1.0.0: the six label changes, and six raised lowest roles no example reached, pinned in 1.1.0 |
| "9,948 mutated-record requests" included 948 about the suite's own, unmutated records | claim 1 says what the requests were |
| s10 is a fixed point only on a machine running nothing else | said in claim 2 and in s10's record |
| s10b's and L01's records said their models cannot build; each is one run | both say one run |
| `op … draw` came "before the builds were launched" by its files' times only; it was committed after them | claim 5 says when it was committed |
| Claim 6's transcripts are extracts of the raw streams, and Claude desktop was never tried | said in claim 6 |

It could not check what the repository does not hold: the builders' transcripts (the ledgers
keep their sha256), L01's transcript on Craig's PC, and the first run of `duramen mutate` on the
gate. It was not asked to read RCAN's sources. While these were corrected, one more mismatch
turned up: the proposals for 0.9.0 in s12's and s13's records were cited by numbers from an
older, longer list. The list is now numbered, and the citations match it.
