# Round three: can duramen be pure regenerative software?

Rounds one and two tested claims about duramen ([CONFIDENCE.md](CONFIDENCE.md),
[CONFIDENCE-2.md](CONFIDENCE-2.md)). This round lets the people who wrote about regenerative
software define it, and asks whether duramen meets what they require and, where it does not,
whether it can. Each requirement below quotes the source it comes from and has a test and a
pass condition. **This file was written on 2026-10-16 (UTC), and the commit that adds it is on
GitHub before any build, suite, probe or replay it judges.** Results go under each requirement
afterwards. The criteria are not edited after a run starts, and a requirement that fails is
reported as failing.

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

**R2. Evaluations that any implementation must pass.** An evaluation is one of the "runnable
contracts that any implementation must pass" ([The Phoenix Primitives](https://chadfowler.com/regenerative-software/3mjfruwwuck2d/)),
specified at a boundary that reimplementation in another language does not break
([Evaluations Are the Real Codebase](https://chadfowler.com/regenerative-software/3mb526js42k26/)).
- *Test:* one suite judges builds in two languages through the driver protocol, unchanged.
- *Passes if* it does.
- *Before:* met. Rounds six to ten judged TypeScript and Python builds with the same suite.
  This round's builds are both TypeScript, so it adds nothing here.

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

**R4. Provenance.** It records "which specification version produced which implementation",
"which evaluation suite validated it" and "what triggered the regeneration"
([The Phoenix Primitives](https://chadfowler.com/regenerative-software/3mjfruwwuck2d/)).
Farmer's ledger has "One row per regeneration attempt, including the ones that failed."
- *Test:* every build in the repository has a ledger row naming the spec version, the suite,
  the model and harness, what triggered it, and the result, failures included.
- *Passes if* every build has one.
- *Before:* met, except that the trigger is implicit in the round. This round's rows name it.

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

**R7. A return path.** "Without that return path, regeneration becomes amnesia"
([When Does a Specification Become a Program?](https://chadfowler.com/regenerative-software/3msssevtkqc2c/)).
- *Test:* every disagreement this round finds ends in the next version of the record as an
  example, a decision or an open item that names the round.
- *Passes if* every one does.
- *Before:* met where a round found something in the words. Rounds six, eight, nine and ten
  each led to a version whose examples or decisions cite them; round seven's findings were
  duramen's own mistakes, fixed in duramen, and 0.9.0 changed only the echo fixture.

**R8. Regeneration units that cover the program.** "Get the boundaries wrong and you've coupled
regeneration units that should be independent" ([The Phoenix Primitives](https://chadfowler.com/regenerative-software/3mjfruwwuck2d/)).
- *Test:* every command duramen ships belongs to a unit with a spec, a suite and a ledger.
- *Passes if* every one does.
- *Before:* failed. duramen-core specifies `check`, `cases` and `judge`. `build`, `run`,
  `regen`, `diff`, `mutate`, `serve`, `mcp` and `hook` have no spec.
- *This round* adds no specification beyond the core, so R8 is not tested and stays failed.

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
