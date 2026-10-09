# Round two: is it the language?

[CONFIDENCE.md](CONFIDENCE.md) showed that a checked record lets Claude models rebuild small
request-and-response programs blind, and that the rebuilt programs nearly always agree with
each other. It did not show that the language is what makes this work. Every build that passed
read a duramen brief, and every suite that judged one came from the record under test. "Claude
builds well from a clear spec" explains those results as well as "the language works" does.
Round one also failed to show that regeneration converges.

This file states two more claims, the test for each, and what counts as passing. **The
criteria were written on 2026-10-09 (UTC), and the commit that adds this file comes before
every run it judges: before brief B or record C is begun, and before any build.** Results go
under each claim afterwards. The criteria are not edited after a run starts, and a claim that
fails is reported as failing.

## 7. The language, not only the builder, carries the behavior

**Domain.** JSONPath, [RFC 9535](https://www.rfc-editor.org/rfc/rfc9535), with
[RFC 9485](https://www.rfc-editor.org/rfc/rfc9485) (I-Regexp) for its `match` and `search`
functions. One operation, `query`: a JSONPath query (a string) and a JSON document in; the
query's nodelist out, as its values and their normalized paths (RFC 9535, section 2.7), or the
error `invalid_query` for a query that is not well-formed and valid. The RFC texts are
rfc-editor.org's plain-text files, pinned below.

**Three briefs.** Each is a SPEC.md and a DECISIONS.md, given to the builder with the same
PROMPT.md (`lib/regen/prompt.ts.md` or `lib/regen/prompt.py.md`, pinned below).
- **A, the standard.** SPEC.md is the protocol section, then the full texts of RFC 9535 and
  RFC 9485. DECISIONS.md states that there are none.
- **B, a markdown spec.** SPEC.md is the protocol section, then a specification written from
  the two RFC texts by a separate agent (`claude-opus-5-5`) in one session. It is written in
  the style of spec-driven development tools: requirements with SHALL, and scenarios that give
  a query, a document and the expected result. Its author runs no code and reads nothing but
  the two RFC texts and the protocol section. DECISIONS.md holds the decisions it records, if
  any. The instructions it is given are kept with its brief.
- **C, duramen.** SPEC.md and DECISIONS.md are written by `duramen build` from a record of
  JSONPath, with an oracle. The session that runs these tests (`claude-opus-5-5` in Claude
  Code) writes it from the same two RFC texts, and it checks clean before it is frozen.

The protocol section is the Interface section and the implementation-folder section of C's
generated SPEC.md, copied verbatim: how the driver is started, the shapes of requests and
responses, the error codes, `REGEN.json`, the builder's own tests, the standard library only,
and the size limit. It carries no JSONPath semantics. B's author is shown the version that
exists when it starts; the briefs carry the version that exists when they are frozen, and any
difference is reported.

Neither B's author nor C's opens the compliance suite below, or the source or tests of any
JSONPath implementation. All three briefs are frozen in a commit before the first build.

**Builds.** All through `duramen regen`, with the same sandbox, prompt, isolation and audit for
every brief (`regen` gains `--brief` to launch A and B):
- `claude-sonnet-5-5`: TypeScript and Python, two builds of each per brief (12 builds);
- `claude-haiku-5-5`: TypeScript, two builds per brief (6 builds);
- a builder from outside Anthropic, if access exists before the first build: TypeScript, two
  builds per brief, reported and not judged.

Builds are launched cell by cell with the briefs interleaved (A, B, C, A, B, C, ...), at most
four at a time. Every build counts, including one whose driver does not start. A build that
uses a JSONPath library, or reads outside its folder, is disqualified, and that is reported.

**The judge.** The [JSONPath Compliance Test Suite](https://github.com/jsonpath-standard/jsonpath-compliance-test-suite)
at the commit pinned below, which nobody on this project opens until every build has ended.
Every case counts:
- a case that expects an invalid selector passes when the answer is the error `invalid_query`;
- a case with one `result` passes when the answer's values equal it, in order, and its paths
  equal the case's normalized paths when the case gives them;
- a case with several acceptable `results` passes when the answer equals any one of them,
  paths included when given.

Values compare as JSON values: member order does not matter, and numbers compare by value.

**Agreement.** [`examples/jsonpath/generate.mjs`](examples/jsonpath/generate.mjs), committed
with this file, generates 2,000 requests from each of three seeds (1, 2 and 3). The queries
are built from RFC 9535's grammar, and a quarter of them are then changed by one random edit;
the documents are random. Its output for each seed is pinned below. Two builds agree on a
request when both answer `invalid_query`, or both answer a nodelist with the same (path, value)
pairs, counted with multiplicity and in any order. A build that answers nothing, or anything
else, agrees with no build on that request.

**Passes if** all of these hold for the `claude-sonnet-5-5` builds:
1. each C build passes at least 95% of the suite's cases;
2. C's builds fail at most half as many cases as A's, and at most half as many as B's (the mean
   number of failed cases per build, over each brief's four builds);
3. C's builds agree with each other at least as often as A's builds agree with each other, and
   as B's do (mean agreement over the six pairs of each brief's four builds, on the 6,000
   requests).

**Reported, with no threshold:** each build's suite score and its failures by RFC section, the
`claude-haiku-5-5` builds, any builder from outside Anthropic, the oracle's own score on the
suite, each build's score on C's own suite, the size of each brief and build, and how long each
brief took to write.

**What counts against the language:** C no better than A, which would mean duramen adds nothing
over the standard's own text for this builder; and C no better than B, which would mean a
careful markdown spec does as well. Either is reported as such. Four builds per brief is a
small sample, so a pass needs a large effect, and a failure may be noise; the results will say
which it looks like.

**Pinned inputs** (sha256, except the suite's commit):

| input | value |
|---|---|
| `rfc9535.txt` (rfc-editor.org) | `bfcb53387d47e3b807bdb695d0a3e136f0c515947289d9c67df354f12ae1fda5` |
| `rfc9485.txt` (rfc-editor.org) | `61e7addfe64e3b0fbff96619d067f3812aa9960cf9b87526d064c3fb3bfbe91f` |
| `lib/regen/prompt.ts.md` | `5abf68e41ced98fe2dd932b640e54e9862b8abeb83f6abe6030e53762d451a8e` |
| `lib/regen/prompt.py.md` | `4163f836ed5988887c0dd01447cab7102791d0e02fac43ac78ad99339ed46599` |
| `generate.mjs 1 2000` | `235a31cdde6b2301de68b31de34163baffac80209822aac18ddace931465db58` |
| `generate.mjs 2 2000` | `9031ca80ba8d85ef1903fba534e8d9e7a7a2fa83e6408c5c965febbbcaa3e31c` |
| `generate.mjs 3 2000` | `2230ef66a3ac91a8697a989f71d9bab4cdabad9f8b9112438c7711eed53c765d` |
| the compliance suite's commit | `9d1a415a53f5dfb291bc874823892e49174e38eb` |

## 8. Regeneration converges at a frozen version

**Test.** duramen-core's operations and statements are frozen at 0.9.0: `check`, `cases` and
`judge`. Up to three rounds are run, eight to ten. Each launches blind builds from the current
brief: `claude-sonnet-5-5` in TypeScript and in Python, `claude-opus-5-5` in TypeScript, and a
builder from outside Anthropic when access exists at the round's start.
- A round's **checkers** are duramen and every build of the round that passes every case of its
  suite and is a fixed point.
- Each build's recorded choices are triaged as before. Every choice not already pinned gets at
  least one probe record written to reach it, and the probes go to every checker.
- Each build also answers `check` and `cases` for the 4,500 mutated records of three seeds
  (`selfhost/agree.mjs`, 1,500 each).
- A **split** is a probe or a mutated record that the checkers do not all answer alike, as JSON
  values. A split is **declared** when an open item in the brief the round's builders were
  given covers it. An open item added after a round's builds start counts only from the next
  round.

Between rounds, what a round finds is pinned by examples or decisions, or declared open. Each
change is tightening by `duramen diff`, with no new operation or statement. Where duramen is
wrong, duramen changes.

**Passes if** within rounds eight to ten, a round with at least three checkers besides duramen
has no undeclared split, on its probes or on its mutated records; and in that round, two of its
builds, with duramen out of the loop, answer the 4,500 mutated records alike, or every
difference is declared (claim 3 (c), again).

**Reported, with no threshold:** each round's probes, splits, undeclared splits and mutants
answered differently; the curve from round five on; every open item added, and why; and
whether any checker came from outside Anthropic. If none did, a pass holds among Claude builders
only, and is said so.

**What counts against convergence:** three rounds without a clean one. That would mean the
words of duramen-core have not been shown to settle its behavior, by this method.

## What would count against regenerative software here

- C's builds failing outside cases that A's pass: a checked record can pin the wrong reading of
  a standard, and every build then inherits it.
- A record that has to restate the implementation: C's oracle about as long as its builds
  (both sizes are reported).
- Rounds that keep finding undeclared splits.

Out of scope, as in round one: user interfaces, timing, concurrency and systems of several
services.

## Results

### 7. The language, not only the builder, carries the behavior: fails

All 18 builds ran on 2026-10-09 between 17:33 and 18:18 UTC, after the briefs were frozen in
a9aba75. The compliance suite was cloned at the pinned commit at 18:19, after the last build
ended. Every build, its run record and both reports are in
[`examples/jsonpath/`](examples/jsonpath/README.md).

| criterion | A (the RFCs) | B (markdown) | C (duramen) | holds? |
|---|---|---|---|---|
| 1. each C build passes at least 95% of the 706 cases | | | 704 each (99.7%) | yes |
| 2. mean failed cases, sonnet builds: C at most half of A and of B | 2.00 | 2.00 | 2.00 | **no** |
| 3. mean agreement over six pairs, sonnet builds: C at least A and B | 99.908% | 100.000% | 99.992% | **no** |

- **The suite saw no difference at all.** All 18 builds, of all three briefs and both models,
  passed 704 of 706 cases, and so did C's oracle. All 19 failed the same two cases,
  `functions, match, explicit caret` and `explicit dollar`, which expect `^` and `$` to anchor
  a pattern. RFC 9485's grammar makes them ordinary characters, as XSD does; its mapping to
  ECMAScript (section 5.3) leaves them unescaped, which makes them anchors there. The suite
  follows section 5.3, and every brief, and every builder of A, read the grammar.
- **On the 6,000 generated requests**, B's four sonnet builds agreed on every request; C's
  agreed on all but one, in the three pairs with C-sonnet-1-ts; A's on all but 11, in the three
  pairs with A-sonnet-2-py. The A sonnet builds accepted blank space inside the brackets of a
  singular query in a comparison (`@[ 1]`), and A-sonnet-2-py a dot before a bracket
  (`$.['A']`), which RFC 9535's grammar rejects and both written briefs state. C-sonnet-1-ts
  and C-haiku-2-ts accepted a tab inside such brackets, which C's own decision D-003 rejects;
  its examples show only spaces. The compliance suite tests none of these.

**Reported, with no threshold:**
- `claude-haiku-5-5`: all six builds 704 of 706. The A pair and the B pair agreed on all 6,000
  requests, the C pair on 5,999 (the tab, again).
- No builder from outside Anthropic took part: there was no access before the first build.
- The oracle: 704 of 706, the same two cases.
- C's own suite (738 cases): every C build 738; every B build 693; the A builds 688 to 693. The
  45 cases every A and B build fails are the order of an object's members, C's decision D-001
  (code-point order), where the RFC leaves the order to the implementation and the compliance
  suite accepts any; the A sonnet builds also fail D-003's three examples. C's suite measures C's
  decisions, not the standard.
- Sizes: SPEC.md of A 167,338 characters, of B 104,258, of C 87,171 (DECISIONS.md: A none, B
  4,455 bytes, C 5,192). Record C is 1,509 lines; its oracle is 679 non-blank lines. The sonnet
  builds are 762 to 1,078 non-blank lines outside their tests (C 762 to 908, B 783 to 1,078, A
  846 to 1,007), the haiku builds 1,033 to 1,307. C's oracle is about three quarters the size of
  a typical build: about as long, which this file named as counting against.
- Time to write: A, none beyond the protocol section. B, 14.3 minutes, one session. C, its
  oracle and its evidence: within the 45 minutes between the commit of these criteria (16:48
  UTC) and the freeze (17:33), which also covered B's author run and the tooling.
- Builds took 4.5 to 6.8 minutes each (sonnet) and 13 to 16 (haiku), at $0.77 to $1.46.
- Audits: no build imports anything but its standard library and its own files. B-sonnet-1-ts
  tried to write two test files one folder above its work folder, which the permission rules
  refused. B-haiku-1-ts read Claude Code's own output file for a command it had run in the
  background: outside its folder by path, holding only that command's output; it is counted.
- Faults in C's brief, all of duramen's making: its renderer wrote a backtick inside an
  example's query as `ˋ` (U+02CB), which made one example false (every C build noticed), and
  showed the evidence table's first 8 of 43 rows under the name `EV-EV-RFC`.
- One change during the builds: at 18:04:57 `src/check.mjs` and `src/suite.mjs` changed for claim
  8's round nine, and C-haiku-2-ts's run, started at 18:05:02, was scored by the changed code.
  The jsonpath record's check output, brief and suite are identical byte for byte before and
  after the change.

**What it says.** On JSONPath, duramen added nothing that the compliance suite can see, over
the standard's own text or over a careful markdown specification: the outcome this file named
as counting against the language, both ways. "Claude builds well from a clear spec" explains it,
and for this builder even the RFC alone is nearly enough. JSONPath may be the hardest place for
a brief to show its worth: RFC 9535 dates from February 2024, the compliance suite is public,
and the models have most likely seen both and many implementations ("blind" means not shown,
not never seen). The one measure that separated the briefs is agreement on generated requests,
where the RFC alone left two corners of its grammar to the builder and both written briefs
closed them; there C did not do better than B. Four builds per brief is a small sample, but no
sample size turns 2.00, 2.00 and 2.00 into a large effect.
