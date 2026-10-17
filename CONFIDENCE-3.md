# Round three: can duramen be pure regenerative software?

Rounds one and two tested claims about duramen ([CONFIDENCE.md](CONFIDENCE.md),
[CONFIDENCE-2.md](CONFIDENCE-2.md)). This round lets the people who wrote about regenerative
software define it, and asks whether duramen meets what they require and, where it does not,
whether it can. Each requirement below quotes the source it comes from and has a test and a
pass condition. **This file was written on 2026-10-16 (UTC), and the commit that adds it is on
GitHub before any build, suite, probe or replay it judges.** Results go under each requirement
afterwards. The criteria are not edited after a run starts, and a requirement that fails is
reported as failing.

## Verdict (written after the round, 2026-10-16)

**By this method, duramen is not pure regenerative software, and three rounds did not show that it
can become one.** It fails R5, and with it R1. In each of three rounds, blind rebuilds of
duramen-core by two families of models, Claude (`claude-sonnet-5-5`) and OpenAI (`gpt-6.1-sol`
through the Codex CLI; this file named `gpt-5.5`, which Codex did not offer on Craig's login),
wrote the same suite of `spec/` with themselves as the oracle, passed every case of both suites
under both builds' `judge`, and answered alike every one of about 9,400 requests for mutated and
unmutated records. But each round they answered some probes differently where no open item allowed
it: 16 probes from five readings, then 10 from three, then 1 from one. The brief is words and
examples, and two builders, of different families and run by different harnesses, read some of its
corners differently (builders of one family did too, in claim 8's rounds). The probes, each
written for a corner some builder recorded, found readings that the suite, some 4,270 distinct
mutated records a round and an outside suite of 554 cases had all missed.

The verdict turns on round thirteen's one split. Given an oracle command whose first word is
empty, the Claude build failed on the request (`internal_error`), and the OpenAI build and
duramen answered that the oracle cannot be started. OPEN-RQ-004 leaves open what a driver answers
when it fails on a request; this round did not read it as leave to fail, so the split counts as
undeclared, and the independent check, whose dispute alone makes a citation undeclared, read it
the same way. Had both read it the other way, round thirteen would have passed R5, with its
thinnest citation (OPEN-JU-001, for a check whose kind is the number 1) still standing, and the
round would have gone on to R9 and the replay.

R3 and R8 fail as before: `src/` is written by hand, and only the core of the checker is
specified. R6 passes as far as the outside suite reaches; R4 is met for this round's builds and R7
for what the rounds found, and R2 stays met; R9 is not judged, since no round passed R5; and R10,
whether a change costs less through the spec than through the code, was not reached, because K1
stopped the round first. The undeclared splits fell each round, from 16 probes to 10 to 1, but in
claim 8's three rounds they went from 9 to 13 to 3, so the fall does not promise a clean fourth
round; this file allowed three. The results are under each requirement, and the evidence, the
measures from outside and every departure from this file are under [Results](#results).

## Sources

- Chad Fowler's essays in [The Phoenix Architecture](https://chadfowler.com/regenerative-software/):
  [Regenerative Software](https://chadfowler.com/regenerative-software/3majnyfydzs2y/) (2025-12-21),
  [Evaluations Are the Real Codebase](https://chadfowler.com/regenerative-software/3mb526js42k26/) (2025-12-29),
  [Immutable Infrastructure, Immutable Code](https://chadfowler.com/regenerative-software/3mbaguyrjek2g/) (2025-12-30),
  [Provenance Is the New Version Control](https://chadfowler.com/regenerative-software/3mcbiyal7jc2y/) (2026-01-13),
  [The Deletion Test](https://chadfowler.com/regenerative-software/3md5ftetaes2e/) (2026-01-24),
  [The Phoenix Primitives](https://chadfowler.com/regenerative-software/3mjfruwwuck2d/) (2026-04-13),
  [The Implementation Remembers](https://chadfowler.com/regenerative-software/3mobohx4fq22x/) (2026-06-14),
  [When Does a Specification Become a Program?](https://chadfowler.com/regenerative-software/3msssevtkqc2c/) (2026-08-11),
  [The Specification Is Not a Document](https://chadfowler.com/regenerative-software/3mtgs36dnq22o/) (2026-08-19) and
  [SaaS Isn't Dead. Sameness Is.](https://chadfowler.com/regenerative-software/3mtu6c5wsvc2n/) (2026-08-24).
- Carson Farmer's [iroh-acp-go](https://github.com/carsonfarmer/iroh-acp-go), its `.regenerate/`
  at commit `d3f3b959044a49be783c8fd766bec420db42b341`: the layout, the rules for a fair run and
  the provenance ledger.

The prompt for this round named two of the essays. Most of the requirements are stated in the
others, so all ten are used. Every quotation below was checked against its page on 2026-10-16.
Fowler gives no numeric threshold anywhere: every threshold below is this file's, set before any
run.

## The requirements

**R1. The deletion test.** Regeneration needs "a way to mechanically distinguish “correct” from
“incorrect” without referring to history" ([The Deletion Test](https://chadfowler.com/regenerative-software/3md5ftetaes2e/)).
"If the honest answer is “the old code,” then the old code is doing work it shouldn't be doing."
- *Test:* R5's loop, in which every judgment about a rebuild of duramen-core (reading a
  record, writing its suite, ruling on an answer) is made by regenerated programs. duramen's
  hand-written code makes none of them. Two things stay outside the regenerated programs, named
  here because duramen-core leaves the first open (OPEN-SU-001): sending a suite's requests to
  a program and pairing each response with its case, done by a new runner that pairs by
  request id and rules on nothing; and making the mutated records, done by duramen's `mutate`,
  which writes inputs and rules on nothing. The protocol cases that duramen's own runner adds
  outside the record are not part of the loop.
- *Passes if* R5 passes in that loop.
- *Before this round:* untested. Rebuilt programs have stood in for duramen one piece at a time
  (s08 as the suite's writer, s12 and s13 as the judge), and no loop has run without it.
- **Result: fails,** because R5 fails. The loop itself ran as stated: in rounds eleven to
  thirteen each build wrote the suite with itself as the oracle and both builds' `judge` gave every
  verdict; duramen answered only as a third subject in step 3; the runner
  ([`selfhost/loop/runner.mjs`](selfhost/loop/runner.mjs)) paired responses by id and ruled on
  nothing; and duramen's code only made the mutated records, ruling on nothing:
  [`selfhost/agree.mjs`](selfhost/agree.mjs) reads the suite's records with duramen's reader and
  mutates them with duramen's `mutate` and random numbers.

**R2. Evaluations that any implementation must pass.** An evaluation is one of the "runnable
contracts that any implementation must pass" ([The Phoenix Primitives](https://chadfowler.com/regenerative-software/3mjfruwwuck2d/)),
specified at a boundary that reimplementation in another language does not break
([Evaluations Are the Real Codebase](https://chadfowler.com/regenerative-software/3mb526js42k26/)).
- *Test:* one suite judges builds in two languages through the driver protocol, unchanged.
- *Passes if* it does.
- *Before:* met. Rounds six to ten judged TypeScript and Python builds with the same suite.
  This round's builds are both TypeScript, so it adds nothing here.
- **Result: met,** as before; this round adds nothing to it.

**R3. The code is derived, and a hand edit is drift.** The specification is "the source of
truth from which code is derived" ([The Phoenix Primitives](https://chadfowler.com/regenerative-software/3mjfruwwuck2d/)).
"Every in-place edit is a drift event" ([Immutable Infrastructure, Immutable Code](https://chadfowler.com/regenerative-software/3mbaguyrjek2g/)).
- *Test:* the implementation duramen ships for each specified operation is the output of a
  logged regeneration, and CI fails when any byte of it differs from that output.
- *Passes if* it is, and CI does.
- *Before:* failed. `src/` is written and edited by hand. Example builds are never edited, but
  by rule, not by CI.
- *This round* does not replace `src/`. It reports whether its evidence would support shipping
  the regenerated core, and R3 stays failed until that happens.
- **Result: fails,** as before. Would the evidence support shipping a regenerated core? Each of
  the six builds passed every case of its round's suite under both judges, answered every request
  for a mutated or unmutated record as its partner did, and answered all 554 outside cases as
  duramen does. But every round's probes found readings the suite, the mutants and the outside
  suite did not, and s27 answers `internal_error` to a record whose oracle command starts with an
  empty word. No build of either family has passed a round with no undeclared split, so the
  evidence does not yet support replacing `src/`.

**R4. Provenance.** It records "which specification version produced which implementation",
"which evaluation suite validated it" and "what triggered the regeneration"
([The Phoenix Primitives](https://chadfowler.com/regenerative-software/3mjfruwwuck2d/)).
Farmer's ledger has "One row per regeneration attempt, including the ones that failed."
- *Test:* every build in the repository has a ledger row naming the spec version, the suite,
  the model and harness, what triggered it, and the result, failures included.
- *Passes if* every build has one.
- *Before:* met, except that the trigger is implicit in the round. This round's rows name it.
- **Result: met for this round's builds.** Each build of this round, s23 to s28, has a row in
  [`selfhost/ledger.jsonl`](selfhost/ledger.jsonl) naming the record's version and the sha256 of
  its brief, the model and the harness, what triggered it, duramen's suite score, and its round's
  report and data. No build attempt failed. R6's writer is not a build; both of its attempts, the
  first of which wrote nothing, are in [`selfhost/loop/r6-suite.md`](selfhost/loop/r6-suite.md).
  Rows before s23 still leave the trigger implicit, as the *Before* line says. The rows record the
  choices as untriaged, as they stood when the build ended; the run records triage them.

**R5. The same behavior from every regeneration.** Deleting a component and recreating it
from stored intent should yield "the same behavior and integration guarantees"
([Provenance Is the New Version Control](https://chadfowler.com/regenerative-software/3mcbiyal7jc2y/)).
- *Test:* in each of up to three rounds, eleven to thirteen in `selfhost/`'s numbering, two
  builders build duramen-core blind, in TypeScript, from the same brief, byte for byte: **A**,
  `claude-sonnet-5-5`, and **B**, OpenAI's model through the Codex CLI.
  1. Each build writes the suite for `spec/`, with itself as the oracle. The two suites are
     compared case by case, as JSON values.
  2. Each build answers every case of both suites, and both builds' `judge` rule on every pair
     of a case and an answer. A case passes only if both judges pass it.
  3. Both builds, and duramen, answer `check` and `cases` for the 4,500 mutated records of seeds
     1 to 3 (as in claim 8) and the 410 probe records of rounds five to ten
     (`selfhost/probes/`). Each build's recorded choices are triaged, and every choice not
     already pinned or declared gets at least one new probe record that reaches it, written
     before any answer to it is seen. Those probes go to both builds and to duramen too.

  A **disagreement** is a pair the two judges rule on differently, or an input the two builds
  answer differently, as JSON values. It is **declared** only when an open item of the brief
  that round's builders were given covers it, cited by its ID. An open item added after
  0.12.0 covers only the inputs it lists. A citation the independent check disputes counts as
  undeclared.
- *Passes if* one of rounds eleven to thirteen has every case of both suites passing, the two
  suites equal, and no undeclared disagreement.
- *Between rounds:* what a round finds is pinned by examples or decisions, or declared open.
  Each new version's `duramen diff` shows only tightening, prose and the open items allowed
  above, with no new operation or statement. A disagreement about syntax (the builds report
  different parse diagnostics, P-codes, for one record) is settled with a grammar in ABNF
  (RFC 5234) added to the requirement's text, with examples, not with more prose.
- *Before:* failed within one family. Claim 8 found no clean round among Claude builds in
  three. Across families: untested.
- **Result: fails (K1).** Round by round
  ([`selfhost/rounds/round11.md`](selfhost/rounds/round11.md), [`round12.md`](selfhost/rounds/round12.md),
  [`round13.md`](selfhost/rounds/round13.md)):

  | round | builds (A, B) | brief | suites equal | cases passing, both judges | requests for mutated and unmutated records answered alike | probes | split | under open items | undeclared (readings) |
  |---|---|---|---|---|---|---|---|---|---|
  | eleven | s23, s24 | 0.12.0 | yes (243) | 972 of 972 | 9,378 of 9,378 | 443 | 31 | 15 | 16 (5) |
  | twelve | s25, s26 | 0.13.0 | yes (245) | 980 of 980 | 9,382 of 9,382 | 471 | 32 | 22 | 10 (3) |
  | thirteen | s27, s28 | 0.14.0 | yes (247) | 988 of 988 | 9,386 of 9,386 | 484 | 27 | 26 | 1 (1) |

  The undeclared readings: in round eleven, request lines of white space other than spaces and
  tabs (open in the driver protocol's words but under no `OPEN-` ID), `input a from"t.txt"`,
  `input x from "\q"` with a text under it, a `from` name that leaves the record's folder and comes
  back, and the kind of file the oracle's standard input is; in round twelve, a `..` in the
  request's top folder, a `from` name ending in `/`, and where the request's files are put for the
  oracle; in round thirteen, an oracle command whose first word is empty, which s27 answers
  `internal_error`. Between rounds, `duramen diff` showed only tightening, prose and open items, with
  no new operation or statement. duramen's answers did not change between rounds; its `diff` did,
  in `d843df6`, to report an added open item it had left out (Departure 6).

**R6. Precise enough to produce correct behavior.** A specification must be "precise enough to
produce correct behavior" ([The Phoenix Primitives](https://chadfowler.com/regenerative-software/3mjfruwwuck2d/)).
If the durable artifacts "are incomplete, stale, or wrong, regeneration will faithfully produce
the wrong software" ([SaaS Isn't Dead. Sameness Is.](https://chadfowler.com/regenerative-software/3mtu6c5wsvc2n/)).
- *Test:* before any build, a separate Codex session writes a suite for duramen-core from the
  round-one brief (0.12.0) alone, with no build and no duramen code in its folder. Its sha256 is
  pushed before the first build, and the suite is opened after the last round. Round one's
  builds and duramen run against it. Each failure of a build is triaged against 0.12.0's words,
  cited: the build is wrong, the outside suite is wrong, an open item allows both, or the brief
  does not decide.
- *Passes if* no failure of round one's A or B is "the build is wrong" or "the brief does not
  decide". Later rounds' builds also run against it, and are reported with no threshold.
- *Before:* for JSONPath, every build passed 704 of the 706 cases of a suite opened after the
  builds, but four C builds inherited a wrong reading (`$.ˋa`) from duramen's renderer that the
  suite never reached. Met as far as that suite reached. Untested for duramen-core.
- *Limit:* the outside suite comes from builder B's family, and from a model, not a person.
- **Result: passes, as far as this suite reaches** ([`selfhost/rounds/r6.md`](selfhost/rounds/r6.md)).
  s23 and s24 each pass 550 of the 554 cases. The four failures are the same for both, and in each
  the suite is wrong: it expects a problem in a table's header row at the `table` line, where
  0.12.0's examples (REQ-SY-012, examples 3 and 5) put it at the header row's. duramen and the four
  later builds also pass 550 of 554, failing the same four, and all seven programs answer every
  case alike. The suite did not reach most of the readings that split the builds: its writer
  listed seven corners it found undecided, one of which, a `from` name that leaves the record's
  folder and comes back, was one of them.

**R7. A return path.** "Without that return path, regeneration becomes amnesia"
([When Does a Specification Become a Program?](https://chadfowler.com/regenerative-software/3msssevtkqc2c/)).
- *Test:* every disagreement this round finds ends in the next version of the record as an
  example, a decision or an open item that names the round.
- *Passes if* every one does.
- *Before:* met where a round found something in the words. Rounds six, eight, nine and ten
  each led to a version whose examples or decisions cite them; round seven's findings were
  duramen's own mistakes, fixed in duramen, and 0.9.0 changed only the echo fixture.
- **Result: met.** Each undeclared reading ends in the next version: round eleven's in 0.13.0
  (OPEN-RQ-005, OPEN-OR-001, REQ-SY-011's grammar and examples 8 and 9, D-024), round twelve's in
  0.14.0 (REQ-SY-011 examples 10 and 11, OPEN-OR-002, D-025), and round thirteen's in 0.15.0
  (REQ-OR-002's words, REQ-OR-004's sixth example, D-026); each names its round. The declared
  splits fell under open items the brief already had, so they end in nothing new. No build has been
  made from 0.15.0 (or from 0.15.1, which corrects how D-024 to D-026 count).

**R8. Regeneration units that cover the program.** "Get the boundaries wrong and you've coupled
regeneration units that should be independent" ([The Phoenix Primitives](https://chadfowler.com/regenerative-software/3mjfruwwuck2d/)).
- *Test:* every command duramen ships belongs to a unit with a spec, a suite and a ledger.
- *Passes if* every one does.
- *Before:* failed. duramen-core specifies `check`, `cases` and `judge`. `build`, `run`,
  `regen`, `diff`, `mutate`, `serve`, `mcp` and `hook` have no spec.
- *This round* adds no specification beyond the core, so R8 is not tested and stays failed.
- **Result: fails,** not tested this round.

**R9. Knowledge out of the implementation.** The aim is that "deleting the implementation
destroys almost nothing the organization knows" ([The Specification Is Not a Document](https://chadfowler.com/regenerative-software/3mtgs36dnq22o/)).
Before regenerating, ask: "What does this implementation know that we have forgotten?"
([The Implementation Remembers](https://chadfowler.com/regenerative-software/3mobohx4fq22x/)).
- *Test:* duramen's hand-written implementation answers the same mutated records and probes as
  A and B.
- *Passes if,* in the round that passes R5, every input on which duramen differs from both
  builds is declared, or decided against duramen by the brief's cited words. A pin added later
  to settle one counts against R9. If no round passes R5, R9 is reported, not judged.
- *Before:* not tested as such. In rounds eight to ten, 8, 9 and 8 probe records (8, 10 and 9
  inputs, counting mutated records) split duramen from three rebuilds that agreed with each
  other.
- **Result: not judged,** since no round passed R5. Reported: where the two builds agreed,
  duramen answered otherwise on 6, 10 and 8 inputs in rounds eleven to thirteen, all under open
  items (the rest of the language, OPEN-RC-001, and checks of other kinds and numbers too large
  in `judge`, OPEN-JU-001 and OPEN-JU-002). No pin was needed to settle one of them, and duramen's
  answers did not change between rounds.

**R10. People do not restate the implementation.** "If maintaining the durable description
requires humans to manually reproduce every implementation decision in another form, we have
gained nothing." Fowler's answer is that agents can carry the clerical work: "It changes where
the cost lies" ([When Does a Specification Become a Program?](https://chadfowler.com/regenerative-software/3msssevtkqc2c/)).
- *Test (the replay):* the real changes to rcan-ts's `src/manifest.ts` and `src/encoding.ts`
  from 2026-04-18 to 2026-10-07, ten of them: `f5a4d28`, `2543e8e`, `5412e64`, `609b5b7`,
  `fb434a3`, `014e96c`, `5802674`, `fda218b`, `38a3882` and `b563fb5`. One more commit,
  `59ef806`, adds only the interfaces `5412e64` uses and no tests, so it is made together with
  `5412e64`.
  Each change is made twice from one change request:
  - **through the code:** a fresh agent edits the two files, given rcan-ts as it was before the
    change, with this path's own earlier results in place of the two files;
  - **through the spec:** a fresh agent edits a duramen record of the two files (with an oracle,
    if its examples need one), and a blind build then regenerates the two files from what
    `duramen build` writes from that record and from the declarations they import, and nothing
    else of rcan-ts.

  The change requests are written before any replay run, by a separate agent shown only each
  commit's message and, where there is one, its pull request, never its diff, and are committed
  then. The real commit's edits to other files (re-exports, an error class, packaging) are
  applied as they were, for both paths. Each path continues from its own results, passing or
  not, with one attempt per change. A result passes when every one of the real commit's tests
  for the two files passes; neither agent sees those tests or their fixtures. Every agent is
  `claude-sonnet-5-5` in Claude Code.
- *Measured:* for each change, the lines a person must review: lines added plus lines removed,
  by `git diff --numstat`, blank lines included, over the two files on the code path and over the
  record and its oracle on the spec path. Also whether each result passes, and the agents'
  tokens and minutes. The record starts empty, since neither file exists before `f5a4d28`.
  Craig reviews, but his minutes are not timed; reviewed lines stand for them, by his choice.
- *Passes if,* summed over the ten changes, the spec path needs fewer reviewed lines than the
  code path and passes at least as many changes.
- *Before:* untested. Measured already: duramen's JSONPath record is 1,509 lines and its oracle
  679 non-blank lines, against 762 to 1,084 non-blank lines for the six builds made from it.
- **Result: not reached.** The replay was to follow the rounds, and K1 stopped round three when
  the rounds ended. No change request was written and no replay run was made.

## Stopping

The round stops, and reports what it has, as soon as either of these happens:
- **K1:** rounds eleven to thirteen end without one that passes R5.
- **K2:** the replay ends and fails R10.

Either one answers the question this round asks: duramen does not meet that requirement, by
this method. Requirements the round has not reached when it stops are reported as not reached.

A build or replay run lost to a quota limit or a crash, before it finishes, is run once more.
A build lost twice counts its round toward K1, and a replay run lost twice counts as a failing
result; both are reported as such. Nothing that finished is run again.

## Outside us

- R6's outside suite.
- **Mutation scores.** Stryker mutates the code of A and B, and the score is the share of
  mutants the duramen-core suite kills, beside duramen's own `mutate` score on the record.
  mutmut is not used: both builds are TypeScript, so that the model family is the main thing
  that differs between A and B.
- **Raw answers.** Every request and every answer of A, B and duramen, on the suites, the
  mutated records, the probes and the outside suite, is committed as JSON with the scripts that
  produced it, so anyone can rerun the round from its pinned commits.
- **An independent check** of every result by agents that did none of the work, as in rounds
  one and two.

## How the builds run

- **The brief** is what `duramen build spec/` writes for the round's version of duramen-core
  (0.12.0 for the first), with the prompt `duramen regen` gives, as in rounds eight to ten. A
  and B get the same `SPEC.md`, `DECISIONS.md` and `PROMPT.md`, byte for byte, and never the
  suite.
- **A** runs through `duramen regen` in a Linux sandbox, as in rounds eight to ten.
- **B** runs through the Codex CLI on Craig's PC, with the model and reasoning effort set there
  (`gpt-5.5`, `xhigh`), in a fresh folder that holds only the brief, under Codex's
  `workspace-write` sandbox, where commands have no network. Its Codex home holds only the login
  and a config naming the model, effort and sandbox: no MCP servers, plugins, memories, web
  search or global `AGENTS.md`. R6's session runs the same way. duramen is cloned elsewhere on
  that PC: before B's first build, a probe checks that the sandbox cannot read those clones,
  and if it can, B runs instead in a WSL namespace that shows it only its folder. After each
  build, its transcript is checked for any path outside the folder.
- **All comparisons** (steps 1 to 3 of R5, R6, R9) run on one machine, with B's files copied
  there.
- Rules from Farmer's `.regenerate/`: the suite is not loosened and a build is not fixed by hand
  to make it pass; the spec changes and the build runs again in the next round. Every attempt
  gets a ledger row, failed or not.
- "Blind" means not shown, not never seen in training. duramen is public on GitHub.

## What this round cannot settle

- R8 stays failed, and R3 stays failed until a regenerated core is what duramen ships.
- One model per family, and one build per family per round. A and B differ in harness as well
  as in model family.
- The outside suite is a model's, not a person's, and comes from builder B's family.
- R10 measures one real codebase, and reviewed lines rather than Craig's minutes.

## Results

Written after the round, on 2026-10-16. The criteria above are as commit `60dc28b` pushed them;
only the verdict, the lines marked **Result** and this section were added.

### Where the evidence is

- **Reports:** [`selfhost/rounds/round11.md`](selfhost/rounds/round11.md),
  [`round12.md`](selfhost/rounds/round12.md) and [`round13.md`](selfhost/rounds/round13.md) for R5,
  R7 and R9, and [`r6.md`](selfhost/rounds/r6.md) for R6.
- **Every request and every answer:** each round's folder, [`round11/`](selfhost/rounds/round11/)
  to [`round13/`](selfhost/rounds/round13/), holds both suites (`suites.json`), both builds' answers
  to both suites (`answers-suites.json`), both judges' verdicts (`verdicts.json`), every input of
  step 3 (`step3-inputs.jsonl.gz`) with A's, B's and duramen's answers (`step3-A.jsonl.gz`,
  `step3-B.jsonl.gz`, `step3-duramen.jsonl.gz`), and the comparison (`report.json`). R6's suite,
  its writer's notes and both of the writer's transcripts are in
  [`selfhost/loop/r6/`](selfhost/loop/r6/), and the seven programs' answers to it in
  [`selfhost/rounds/r6/`](selfhost/rounds/r6/).
- **The builds:** [`selfhost/impl/s23-ts`](selfhost/impl/s23-ts) to `s28-ts`, as their builders
  left them, with run records [`selfhost/s23-ts.md`](selfhost/s23-ts.md) to `s28-ts.md`, each
  triaging its builder's recorded choices, and rows in
  [`selfhost/ledger.jsonl`](selfhost/ledger.jsonl).
- **The probes** written for each round's choices before any answer to them was seen:
  [`selfhost/probes/s23-s24.txt`](selfhost/probes/s23-s24.txt), `s25-s26.txt` and `s27-s28.txt`.
- **The build transcripts,** each with the sha256 its ledger row names:
  [`selfhost/rounds/transcripts/`](selfhost/rounds/transcripts/).
- **The versions** of duramen-core: 0.12.0 at `db94452` (unchanged at `6c847eb`), 0.13.0 at
  `d843df6`, 0.14.0 at `99a1c79`, 0.15.0 at `4d0c3cf`, and 0.15.1 at the commit that adds this
  section.
- **To rerun a round,** check out the commit that holds its builds and its brief (round eleven
  `6c847eb`, twelve `a1f9189`, thirteen `23d84de`) and run
  `node selfhost/loop/round.mjs --a selfhost/impl/s23-ts --b selfhost/impl/s24-ts --out <dir>`
  (round eleven's builds) with `--probes selfhost/probes/<file>` once for each probe file there.
  To rerun R6 on one program, from the commit that adds this section, run
  `node selfhost/loop/outside.mjs selfhost/loop/r6/outside-suite.jsonl <program> --out <file>`,
  where the program is a build's folder or `duramen`.
  [`selfhost/loop/README.md`](selfhost/loop/README.md) says what each script does.

### Outside us

- **R6's outside suite:** above, under R6.
- **Mutation scores.** Stryker 10.0.0 mutated the TypeScript of round eleven's builds, s23 (A) and
  s24 (B), and ran duramen-core 0.12.0's suite against every mutant through duramen's runner
  (`duramen run spec/ --impl .`, Stryker's command runner, no coverage analysis), on Craig's PC
  in WSL with Node.js 22.20.0, nine runners a build
  ([`selfhost/loop/wsl/stryker-run.sh`](selfhost/loop/wsl/stryker-run.sh); the reports are in
  [`selfhost/rounds/mutation/`](selfhost/rounds/mutation/), every mutant with the failures that
  killed it). A mutant is killed when any case of the suite fails, and the score is the share
  killed or timed out.

  | build | mutants | killed | timed out | survived | no coverage or errors | score | time |
  |---|---|---|---|---|---|---|---|
  | s23 (A) | 2,920 | 2,539 | 4 | 377 | 0 | 87.1% | 65 min |
  | s24 (B) | 2,447 | 2,135 | 4 | 308 | 0 | 87.4% | 59 min |

  The two builds score within half a point of each other. In each, about one mutant in eight
  survives the suite: code the suite does not pin, or a mutant that changes nothing, which Stryker
  does not tell apart. About half the survivors are in the code that reads records (s23's
  `reader.ts`, 196; s24's `parser.ts`, 164).

  duramen's own `mutate` planted one mistake at a time (a number, or an arithmetic, comparison or
  logical operator) in duramen's own code, the record's oracle, and ran the record's examples
  against each ([`selfhost/loop/mutate-record.sh`](selfhost/loop/mutate-record.sh), on 0.12.0 at
  `6c847eb`). It mutated the seven files of `src/` that carry duramen-core's operations (`parse`,
  `record`, `check`, `suite`, `serve`, `driver` and `types`). The oracle's process loads nine more,
  none mutated: the command line, `cli.mjs`, and the code of the other commands, and `expr`,
  `property` and `static`, which serve parts of the language duramen-core leaves open. Of the
  1,454 mutants in the seven, 609 are on lines no example runs. Of the 845 others it sampled up
  to 100 a file, 525 in all, and the examples caught 305 (58%); none of the other 220 changed any
  answer an example asks for (0 unpinned, 220 silent). Rerun with the script, it gave the same
  mutants and the same results. The two scores measure different things: Stryker's, how much of
  a build's code the suite pins; duramen's, how much of the oracle's code the record's examples
  pin.
- **Raw answers:** committed, as listed above, with the build transcripts.
- **Independent checks,** by three agents that did none of the work, each with scripts of its own:
  - The first recomputed every count in the three round reports and in R6's from the raw data,
    reran steps 1 and 2 of all three rounds and round thirteen's 484 probes on s27 and s28, and
    reran R6 on s24. It found no count wrong, and every rerun gave the recorded answers. Its
    doubts: the reports said "records" where they counted requests; the probe totals include
    protocol sessions; some mutated records are unchanged or repeated; R6's results were not yet
    committed; the runner changed after the seal; `outside.mjs` judges only the first line of a
    single-line case; s25's and s27's `REGEN.json` name `node src/driver.ts`, not `node driver.ts`
    as its task said (it used what `REGEN.json` says); and a few probe answers depend on the
    machine. The wording was fixed and the results committed; the rest is under *Departures*.
  - The second built each round's brief and checked every open-item citation, every undeclared
    reading, that the reports list every split, R7, the diffs, R6's triage, and whether R6's
    writer worked out any expected value by running an implementation (it did not). It disputed
    none of the classifications and reproduced every probe answer of s23 to s28. It found two
    errors, r6.md crediting a choice to s24 that was s26's (fixed) and the change of B's model
    (Departure 1), and the points under *Calls a reader may dispute*.
  - The third checked this section, the verdict and every **Result** line against the evidence
    and the criteria as `60dc28b` pushed them (unchanged but for the additions). It recomputed the
    counts, the Stryker and `mutate` scores and R6's answers, and found the hard verdict follows.
    It found statements that were wrong, all since corrected: that duramen did not change (its
    `diff` did, Departure 6), what `6c847eb` changed in the audit (Departure 5), how many files of
    `src/` the oracle loads, these summaries of the first two checks, the probe kinds in the round
    reports, two stale sentences in the READMEs, and a link. Its other points are taken up in the
    verdict, in R1's and R4's results, in Departures 1, 2, 4, 9, 10, 12 and 14, and in the first
    two calls below.

### Departures from this file

1. **B's model.** This file named `gpt-5.5`. The model list Codex CLI 0.163.0 fetched for Craig's
   login on 2026-10-16, at 19:56Z, does not hold it
   ([`selfhost/loop/wsl/codex-models.json`](selfhost/loop/wsl/codex-models.json)): it lists
   `gpt-6.1-sol` first, "Latest workhorse model for coding and everyday work.", then
   `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna` and three `gpt-5.6` models, with two more it hides.
   This file did not say how to choose another; B's three builds and R6's writer ran
   `gpt-6.1-sol`, the list's first, at `xhigh`, and no other was tried. The ledger and the run
   records name it, but no report said it differed from this file until the independent check
   did.
2. **Where B ran.** This file said B would run under Codex's own sandbox, and move to a WSL
   namespace only if a probe found that sandbox could read duramen's clones on the PC. The probe
   could not run a command at all: Codex's Windows sandbox refused each of its five
   (`helper_firewall_policy_ineffective`), and Codex read skill files from Craig's home folder,
   outside its Codex home. So B and R6's writer ran in the WSL namespace from the start, under
   Codex's Linux sandbox (`workspace-write`, no network for commands), in a mount namespace that
   covers every drive, every home folder and WSL's views of the PC with empty file systems
   ([`selfhost/loop/wsl/ns-run.sh`](selfhost/loop/wsl/ns-run.sh)). The ledger rows and run
   records say it shows only the build's folder; more exactly, it also shows its own Codex home
   and tools, the distro's system folders, and the distro's `/tmp`, which Codex's sandbox needs. No
   script of the round put anything in that `/tmp`, and no B transcript names it.
3. **R6's writer ran twice.** The first attempt was lost to a sandbox error before it wrote
   anything; the second, in a fresh folder, wrote the sealed suite
   ([`selfhost/loop/r6-suite.md`](selfhost/loop/r6-suite.md)). Both transcripts are committed.
4. **What the person running the round saw of the outside suite.** At about 20:36Z, just before
   the first builds started, the first version of the Codex audit printed fragments of the
   scripts that wrote the suite. No builder saw them. The pins added later near what they showed
   are listed in round eleven's and round twelve's reports. Round thirteen's, REQ-OR-002's words
   on an empty first word, sits near the outside suite's cases on oracle commands (an unclosed
   quote, and four more); whether the fragments showed those cannot be checked now, since the
   printout was not kept.
5. **The loop's tools after the seal.** `8c08f0b` pushed the loop's tools with R6's hash; its
   Codex audit already read only each command's first line, after the fragments of 4.
   `6c847eb`, pushed with round eleven's builds and before any answer of the round was seen,
   gave `runner.mjs` a `bytes` option and the probe files an `@stdin64` section, so that a probe
   can send bytes that are not lines of UTF-8; neither changes how answers are paired or ruled
   on. The same commit made the audit unquote the command inside Codex's shell wrapper as bash
   does and split it into simple commands outside quotes, and added `import-codex.mjs`. No script
   of the loop changed after it.
6. **`duramen diff` changed between rounds.** It had left out an added open item whose ID a
   requirement also has (OPEN-OR-001 beside REQ-OR-001); `d843df6`, with round eleven's answers,
   corrected it and added a test, and round eleven's report says so. That is the tool the rule
   *Between rounds* is checked with. Nothing duramen answers in the loop changed.
7. **Time limits.** This file set none. B ran under a 120-minute limit (`b-launch.sh`), and A
   under `duramen regen`'s (`--max-minutes`, 60 by default). No build came near either: the
   longest took 33.2 minutes.
8. **PROMPT.md's list of commands** is enforced for A by `duramen regen`'s harness. It refused
   one command of s23, one of s25 and two of s27; the last three reached outside the work folder
   (a listing of the folder above it, `ls /tmp`, and writing `/tmp/fix.mjs`), so those audits
   count them as violations. None ran. Codex does not enforce the list; the audit of each B
   transcript found every command B ran on it.
9. **How the transcripts were audited.** As each B build was imported, `import-codex.mjs` audited
   its transcript reading only each command's first line, though the audit's own notes say a
   build's transcript is read in full. Read in full after the round, the three name no path
   outside the box: the only tokens that look like one are pieces of regular expressions and code
   in `node -e` scripts (`/.exec`, `/.test`, `//`, `/Examples`, `/b`, `/g`, `/i.test`, `/m`), the
   two `..` are inside such scripts too, one in test data and one in text a script writes, and
   there is no network command. A's three were also read
   by [`selfhost/transcripts.mjs`](selfhost/transcripts.mjs), which reads inline scripts and
   here-documents too: besides the commands its harness refused, it finds only a `..` in code
   that checks paths and a relative path inside s27's own tests. All six transcripts are in
   [`selfhost/rounds/transcripts/`](selfhost/rounds/transcripts/), each with the sha256 its
   ledger row names.
10. **A choice with no new probe.** Step 3 gives every choice that is neither pinned nor declared
    at least one new probe. s28's C-20, members of a request the protocol does not name, got none:
    probes written in rounds eleven and twelve (`s23-s24` #28, `s25-s26` #17) already reached it,
    and both builds of round thirteen answered them.
11. **Mutated records.** R5 counts 4,500 mutated records a round. Some came out of `mutate`
    unchanged or as a repeat: 4,272, 4,260 and 4,279 are distinct and differ from every unmutated
    record. The round reports give the rest.
12. **Stryker on one pair.** Stryker mutated round eleven's builds, s23 and s24, the pair built from
    the brief R6's outside suite also judges, and not the four later builds; each run took about
    an hour on twenty cores.
13. **After the round,** 0.15.1 corrected how D-024 to D-026 count, as a patch version, in prose
    only. No build was made from 0.15.0 or 0.15.1.
14. **Answers that depend on the machine.** Two probes (`s25-s26` #2, `s27-s28` #10) ask an oracle
    for the names of its environment's variables; the committed answers hold the names of the
    machine the comparisons ran on, and no values. The answers to `s25-s26` #1, whose oracle
    looks at the folders above its own, depend on where the repository is, and those to the
    25-second oracle (`s14-s16` #1) on timing. The
    requests in `suites.json` name each build's driver by its path on that machine. A rerun
    elsewhere sends its own paths, and may answer these few probes otherwise.
15. **Where things ran.** As this file says, every comparison ran on one machine, the cloud
    container A was built in, with B's files copied there. Stryker ran on Craig's PC, in WSL,
    from the same commit fetched from GitHub, because it needed more cores than the container
    has; it is a measurement beside the loop.
16. **`outside.mjs`** judges a single-line case by the first line of output and does not look at
    the exit status or later lines. Every program answered every single-line case with exactly
    one line and exit status 0, so this changes no count.

### Calls a reader may dispute

- **OPEN-RQ-004 and round thirteen.** The call the verdict turns on, set out there: round thirteen
  passes R5 if both this round and the independent check read OPEN-RQ-004 as covering a build that
  fails on a request.
- **OPEN-JU-001 for a check whose kind is the number 1** (`s14-s16` #25), declared in rounds eleven
  and thirteen. REQ-JU-001 asks a check for a string `path` but only for "a `kind`", and calls
  checks of other kinds open. Builds of one family split on it too: s23 and s27 answer
  `pass: false`, and s25 answers `bad_request`, as s24, s26, s28 and duramen do. The independent
  check called it the thinnest citation and did not dispute it; disputed, it would add an
  undeclared split to rounds eleven and thirteen.
- **Declared means cited by ID.** Round eleven's first reading, request lines of other white space,
  was open in the driver protocol's words but under no `OPEN-` ID, so it counted as undeclared.
  Round eleven fails on its other four readings either way.
- **The ABNF rule.** R5 says a split over P codes is settled with a grammar in ABNF, "not with
  more prose". Round eleven's readings about `from` lines got one (REQ-SY-011's `from` line). Its
  fourth reading and round twelve's first two, all P048 and all about where a `from` name ends
  up, were settled with words and examples beside the grammar, and comments in it: a grammar of
  how a name is written cannot say which folder the name reaches. By the letter of the rule, that
  is a departure.
- **R7's "every disagreement".** The declared splits fell under open items older than the round,
  which do not name it. R7 is reported met for the undeclared readings, the findings in the
  words, as its *Before* line reads it.
- **`duramen diff`'s classes.** It calls every change to a requirement's words "prose", so "only
  tightening, prose and open items" cannot by itself catch a relaxation written in words. The
  words changed in 0.13.0, 0.14.0 and 0.15.0 were read by hand, by the independent check too:
  each pins one reading, and none relaxes one.
- **OPEN-RQ-005's words** name seven characters "or another of REQ-SY-001's list", which takes in
  characters no round probed. Every split counted under it is one of the inputs it names.
