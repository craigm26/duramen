# jsonpath: is it the language?

The test of claim 7 of [CONFIDENCE-2.md](../../CONFIDENCE-2.md): JSONPath, as
[RFC 9535](https://www.rfc-editor.org/rfc/rfc9535) defines it with
[RFC 9485](https://www.rfc-editor.org/rfc/rfc9485) (I-Regexp) for `match()` and `search()`,
built blind from three briefs, and judged by a suite none of them was written from: the
[JSONPath Compliance Test Suite](https://github.com/jsonpath-standard/jsonpath-compliance-test-suite)
at commit `9d1a415a53f5dfb291bc874823892e49174e38eb` (706 cases), opened only after every build
had ended.

| brief | what the builder got | SPEC.md |
|---|---|---|
| [A-rfc](briefs/A-rfc/) | the protocol, then RFC 9535 and RFC 9485 in full | 167,356 bytes |
| [B-markdown](briefs/B-markdown/) | the protocol, then a SHALL-and-scenario specification written from the two RFCs by a separate `claude-opus-5-5` session ([its instructions](briefs/B-markdown/AUTHOR-PROMPT.md)), and its decisions | 104,552 bytes |
| [C-duramen](briefs/C-duramen/) | what `duramen build` writes from [`jsonpath.duramen`](jsonpath.duramen) | 87,341 bytes |

The protocol section ([`briefs/protocol.md`](briefs/protocol.md)) is the same in all three: how
the driver is run, the request and response shapes, the error codes, the folder rules. It is
the driver protocol, operations and errors parts of C's Interface section and C's
implementation-folder section, verbatim; the Interface section's Types and Properties parts,
which list C's own test inputs, were left out. Every
build went through `duramen regen --brief`, with the same prompt, sandbox, isolation and audit,
and was scored afterwards by C's own suite as well.

## Results

**Claim 7 fails.** Every one of the 18 builds, A, B and C, `claude-sonnet-5-5` and
`claude-haiku-5-5` alike, passed 704 of the suite's 706 cases, and so did C's oracle. All 19
failed the same two cases. On 6,000 generated requests, B's four sonnet builds agreed with each
other on every one, C's on all but one request in three pairs, and A's on all but 11 in three.
And C's sonnet builds alone inherited an error from duramen's renderer (below).

| build | model | language | minutes | cost | compliance suite (706) | C's suite (738) | agrees with the oracle (6,000) | non-blank lines |
|---|---|---|---|---|---|---|---|---|
| [A-haiku-1-ts](regen/A-haiku-1-ts.md) | `claude-haiku-5-5` | ts | 15.2 | $0.90 | 704 | 693 | 6,000 | 1,307 |
| [A-haiku-2-ts](regen/A-haiku-2-ts.md) | `claude-haiku-5-5` | ts | 13 | $0.95 | 704 | 692 | 6,000 | 1,033 |
| [A-sonnet-1-py](regen/A-sonnet-1-py.md) | `claude-sonnet-5-5` | py | 6.4 | $1.30 | 704 | 689 | 5,984 | 846 |
| [A-sonnet-1-ts](regen/A-sonnet-1-ts.md) | `claude-sonnet-5-5` | ts | 5.2 | $1.15 | 704 | 690 | 5,984 | 1,007 |
| [A-sonnet-2-py](regen/A-sonnet-2-py.md) | `claude-sonnet-5-5` | py | 5.9 | $1.25 | 704 | 689 | 5,973 | 869 |
| [A-sonnet-2-ts](regen/A-sonnet-2-ts.md) | `claude-sonnet-5-5` | ts | 6.8 | $1.46 | 704 | 688 | 5,984 | 952 |
| [B-haiku-1-ts](regen/B-haiku-1-ts.md) (disqualified, below) | `claude-haiku-5-5` | ts | 16.2 | $1.15 | 704 | 693 | 6,000 | 1,257 |
| [B-haiku-2-ts](regen/B-haiku-2-ts.md) | `claude-haiku-5-5` | ts | 13.1 | $0.96 | 704 | 693 | 6,000 | 1,189 |
| [B-sonnet-1-py](regen/B-sonnet-1-py.md) | `claude-sonnet-5-5` | py | 4.8 | $0.99 | 704 | 693 | 6,000 | 854 |
| [B-sonnet-1-ts](regen/B-sonnet-1-ts.md) | `claude-sonnet-5-5` | ts | 6.3 | $1.39 | 704 | 693 | 6,000 | 929 |
| [B-sonnet-2-py](regen/B-sonnet-2-py.md) | `claude-sonnet-5-5` | py | 5.9 | $1.16 | 704 | 693 | 6,000 | 783 |
| [B-sonnet-2-ts](regen/B-sonnet-2-ts.md) | `claude-sonnet-5-5` | ts | 4.5 | $1.05 | 704 | 693 | 6,000 | 1,078 |
| [C-haiku-1-ts](regen/C-haiku-1-ts.md) | `claude-haiku-5-5` | ts | 15.9 | $1.36 | 704 | 738 | 6,000 | 1,064 |
| [C-haiku-2-ts](regen/C-haiku-2-ts.md) | `claude-haiku-5-5` | ts | 13.2 | $0.77 | 704 | 738 | 5,999 | 1,084 |
| [C-sonnet-1-py](regen/C-sonnet-1-py.md) | `claude-sonnet-5-5` | py | 4.7 | $1.06 | 704 | 738 | 6,000 | 762 |
| [C-sonnet-1-ts](regen/C-sonnet-1-ts.md) | `claude-sonnet-5-5` | ts | 5.3 | $1.24 | 704 | 738 | 5,999 | 908 |
| [C-sonnet-2-py](regen/C-sonnet-2-py.md) | `claude-sonnet-5-5` | py | 4.6 | $1.00 | 704 | 738 | 6,000 | 870 |
| [C-sonnet-2-ts](regen/C-sonnet-2-ts.md) | `claude-sonnet-5-5` | ts | 5.4 | $1.15 | 704 | 738 | 6,000 | 781 |

The reports are [`results/cts.json`](results/cts.json) (every failure, with what was answered)
and [`results/agreement.json`](results/agreement.json) (every pair of builds, the oracle
included). Lines are non-blank lines outside test files. The oracle is 679 non-blank lines
([`oracle.mjs`](oracle.mjs) and [`driver.mjs`](driver.mjs)); the record is 1,509 lines.

- **The two failed cases**, `functions, match, explicit caret` (`$[?match(@, '^ab.*')]`) and
  `explicit dollar` (`.*bc$`), expect `^` and `$` to anchor. RFC 9485's grammar makes both
  ordinary characters (`NormalChar`), and its semantics, normative in section 4, are XSD's,
  where they are literals; its mapping to ECMAScript (section 5.3), which the RFC marks not
  normative, wraps the pattern without escaping them, which makes them anchors there. The suite
  follows section 5.3. B and C state the literal reading in words and examples, and every A
  build chose it from the RFC.
- **Valid and invalid queries.** [`generate.mjs`](generate.mjs) builds some invalid queries on
  purpose before it mutates a quarter of them (its header says so), and 3,312 of the 6,000
  requests are invalid queries by the oracle. On the other 2,688, every sonnet build of every
  brief gave the oracle's answer to every request; all the disagreement is about which
  malformed queries to reject.
- **What the generated requests found and the suite does not test.** All four A sonnet builds
  accepted blank space inside the brackets of a singular query used as a comparable or a
  function's argument (`@[ 1]`), and A-sonnet-2-py also a dot before a bracket (`$.['A']`);
  RFC 9535's grammar has neither, and B's and C's briefs say so. C-sonnet-1-ts and
  C-haiku-2-ts accepted a tab inside a singular query's brackets, which decision D-003 of their
  own brief rejects (its examples use spaces).
- **C's own suite** is not a fair judge of B: the 45 of its cases that every A and B build
  fails are the order of an object's members, decision D-001 (code-point order), where the RFC
  leaves the order to the implementation and the compliance suite accepts any. The A builds'
  other failures are the standard's: D-003's three examples (RFC 9535's grammar of singular
  queries), `$.[0]` (A-sonnet-2-py), `count((@.a))` (A-haiku-2-ts), a request A-sonnet-2-ts
  did not answer (`$[?constructor(@)]`), and A-sonnet-1-py's own tests failing.
- **C's builds inherited a false example.** duramen's renderer wrote a backtick in an example's
  query as `ˋ` (U+02CB), so C's brief said `$.ˋa` is invalid, where RFC 9535 allows the name.
  Every C build noticed the contradiction; the four sonnet builds followed the example and
  answer `invalid_query` for `$.ˋa` and `$.aˋ`, where the oracle, every A and B build and both
  C haiku builds answer the node. Nothing above measures it. The evidence table also showed
  its first 8 of 43 rows, as the renderer does by design, under the heading `EV-EV-RFC` (the
  record named it `EV-RFC`).
- **Audits.** No build imports anything but its language's standard library and its own files
  ([`imports.mjs`](imports.mjs)). B-sonnet-1-ts tried to write two test files one folder above
  its work folder, which the permission rules refused. B-haiku-1-ts read Claude Code's output
  file for its own test command, which Claude Code had moved to the background after 120
  seconds: the file held only that command's output, but it is outside the build's folder, so
  by the rule of CONFIDENCE-2.md the build is disqualified. It is a haiku build, which no
  criterion uses.
- **Changes to duramen after the freeze.** `src/` changed for claim 8 at 18:04:57 UTC, during
  the haiku builds (C-haiku-2-ts's run started at 18:05:02 and was scored by the changed
  code), and at 18:40, after the last build. The jsonpath record's check output, brief and
  suite are identical byte for byte at a9aba75, after the first change and after the second.

## Files

| file | what it is |
|---|---|
| [`jsonpath.duramen`](jsonpath.duramen) | record C: 48 requirements, 675 examples, 52 evidence rows, 3 properties, 5 static checks, 5 decisions, 8 open items |
| [`oracle.mjs`](oracle.mjs), [`driver.mjs`](driver.mjs) | its oracle, written from the RFCs |
| [`evidence/`](evidence/) | the RFC's own tables of examples, as evidence rows |
| [`briefs/`](briefs/) | the three briefs, the RFC texts, the protocol, and how they were made ([`make-briefs.mjs`](briefs/make-briefs.mjs), [`author-launch.mjs`](briefs/author-launch.mjs)) |
| [`run-builds.mjs`](run-builds.mjs) | the 18 builds, four at a time, the briefs interleaved |
| [`regen/`](regen/) | the builds, their run records, the ledger and the logs |
| [`judge-cts.mjs`](judge-cts.mjs) | the compliance suite's judge, written before the suite was opened |
| [`generate.mjs`](generate.mjs), [`agreement.mjs`](agreement.mjs) | the 6,000 generated requests and the agreement measure |
| [`score-claim7.mjs`](score-claim7.mjs) | the three criteria, from the two reports |
| [`imports.mjs`](imports.mjs) | the audit for libraries |

```
node examples/jsonpath/briefs/make-briefs.mjs
node examples/jsonpath/run-builds.mjs
git clone https://github.com/jsonpath-standard/jsonpath-compliance-test-suite cts && git -C cts checkout 9d1a415a53f5dfb291bc874823892e49174e38eb
node examples/jsonpath/judge-cts.mjs cts/cts.json examples/jsonpath/regen/impl/* --oracle --out examples/jsonpath/results/cts.json
node examples/jsonpath/agreement.mjs examples/jsonpath/regen/impl/* --oracle --out examples/jsonpath/results/agreement.json
node examples/jsonpath/score-claim7.mjs examples/jsonpath/results/cts.json examples/jsonpath/results/agreement.json
node examples/jsonpath/imports.mjs examples/jsonpath/regen/impl/*
```

The suite's `cts.json` at that commit has sha256 `a49c3839659a6f5a0385c7704289d62305f3e198b1f19599d6165a0a0275b8bb`.
