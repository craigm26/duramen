# Choices

Each entry is a point where SPEC.md is silent, ambiguous, contradictory, or leaves something
open, and where I had to pick a behaviour. Entries are numbered in the order I met them.

## C-1: The row `$.ˋa` contradicts the name rule

- Spec reference: REQ-SY-002 (and its example row `"$.ˋa"` with document `{"ˋa": 1}`)
- Situation: contradictory
- What I chose: follow the rule. The row's name character is U+02CB (MODIFIER LETTER GRAVE
  ACCENT), a code point from U+0080 up, which REQ-SY-002 allows in a name. So `$.ˋa` is well
  formed and selects `1` from `{"ˋa": 1}`. The row expects `invalid_query`, so its test is
  skipped, with this reason, in `test/spec-examples.test.ts`.
- Alternatives: follow the row, and reject U+02CB. That needs a rule the spec does not state (a
  character class, or ASCII only), which would contradict the explicit "U+0080 up" wording.
- Should the spec pin this? yes. Either restate the row's expected value or add the rule that
  makes U+02CB invalid. As written, a suite built on both will fail one of them.

## C-2: The EV-EV-RFC table has 8 of the 43 rows it promises

- Spec reference: EV-EV-RFC
- Situation: missing
- What I chose: test the 8 rows that SPEC.md contains, and nothing else. The text says the
  suite checks all 43 rows and the 9 waived rows, but only 8 rows are written out.
- Alternatives: none that check the rest, since they are not in the spec.
- Should the spec pin this? yes. The missing rows are the evidence the spec cites. Without them,
  EV-EV-RFC cannot be checked by an implementation built from this file.

## C-3: A CR at the end of a request line is a CRLF line ending

- Spec reference: Driver protocol (requests arrive "one JSON object per line")
- Situation: missing. The spec says lines end in LF on output, but not what stdin lines end with.
- What I chose: strip one trailing CR from each request line before handling it. JSON already
  accepts CR as white space, so the strip only matters for a line that is a lone CR (blank).
- Alternatives: keep the CR, so a CR-only line gets `bad_request`.
- Should the spec pin this? unsure. It matters only for CRLF input or a stray CR-only line, and
  the spec never tests those.

## C-4: Only space, tab and the CR of a CRLF make a line blank

- Spec reference: Driver protocol, "Blank lines (empty, or only spaces and tabs) get no
  response; whether other white space makes a line blank is open."
- Situation: ambiguous. The spec marks the case as open.
- What I chose: a line is blank when it has only spaces, tabs (and the CR of C-3). Other white
  space such as form feed is an ordinary request line, so it gets `bad_request`.
- Alternatives: treat every JSON white space as blank, so no response is written.
- Should the spec pin this? no. The spec calls it open and never tests it.

## C-5: Stdin is decoded as UTF-8 and split on LF only

- Spec reference: OPEN-OP-008 (request bytes that are not UTF-8); Driver protocol (one object per
  line)
- Situation: missing
- What I chose: decode the byte stream with a UTF-8 `TextDecoder` (invalid bytes become U+FFFD),
  and split lines on LF only. A CR, U+2028 or U+0085 inside a line does not split it.
- Alternatives: Node's `readline`, which also splits on CR. That would turn a CR inside a line
  into two responses.
- Should the spec pin this? no. OPEN-OP-008 leaves invalid bytes open.

## C-6: A duplicate member name in a JSON object keeps the last value

- Spec reference: OPEN-OP-001 (duplicate member names in the document)
- Situation: missing (open)
- What I chose: `JSON.parse` behaviour. The last member with a name wins.
- Alternatives: the first one, or an error.
- Should the spec pin this? no. OPEN-OP-001 is never tested.

## C-7: Document numbers are read the way `JSON.parse` reads them

- Spec reference: OPEN-OP-003 (numbers beyond I-JSON or binary64 in the document)
- Situation: missing (open)
- What I chose: each number in the document is an IEEE 754 binary64 value, as `JSON.parse` gives
  it. A large integer loses precision, and a value beyond the binary64 range is ±Infinity.
- Alternatives: keep the number text and compare it exactly (BigInt-style), which would change
  equality for large integers.
- Should the spec pin this? no. OPEN-OP-003 says how such numbers are written in `values` is open.

## C-8: A number literal beyond the binary64 range is an infinity

- Spec reference: REQ-SY-008 ("A number literal is not checked against the I-JSON range"),
  OPEN-OP-003
- Situation: ambiguous. The spec says the literal "is the number it writes", but a value such as
  `1e400` is not a binary64 number.
- What I chose: `Number(text)`, so `1e400` is +Infinity and `-1e400` is -Infinity. Infinity
  compares as a number, and it equals nothing in a document, since JSON cannot give one.
- Alternatives: make such a literal invalid (`invalid_query`), or keep it as a non-number that
  compares as Nothing.
- Should the spec pin this? no. OPEN-OP-003 covers how such numbers compare.

## C-9: An I-Regexp character range out of order is not an I-Regexp

- Spec reference: OPEN-OP-006 (`[z-a]`); REQ-RX-003
- Situation: missing (open)
- What I chose: `[z-a]` is not an I-Regexp, so `match()` and `search()` give false.
- Alternatives: accept the range and match nothing, which is what XSD character classes do.
- Should the spec pin this? no. The spec says RFC 9485 leaves it to XSD, and it is never tested.

## C-10: A repeat range whose bounds are out of order is not an I-Regexp

- Spec reference: OPEN-OP-006 (`{n,m}` with n greater than m); REQ-RX-006
- Situation: missing (open)
- What I chose: `a{3,2}` is not an I-Regexp, and `a{2,2}` is.
- Alternatives: accept `a{3,2}` and match nothing.
- Should the spec pin this? no. OPEN-OP-006 covers it.

## C-11: A repeat count the JavaScript engine refuses matches nothing

- Spec reference: OPEN-OP-004 (very large quantifiers in an I-Regexp); REQ-RX-006
- Situation: missing (open)
- What I chose: the grammar accepts `a{99999…9}` (a count of 40 nines), but the translated
  JavaScript RegExp is refused. That pattern is then treated as not an I-Regexp, so `match()` and
  `search()` give false. The query is still valid, so it is never an `invalid_query`.
- Alternatives: report a resource error, which the protocol does not allow for.
- Should the spec pin this? no. OPEN-OP-004 leaves "what it answers" open.

## C-12: `\p{X}` follows the Unicode tables of the JavaScript engine

- Spec reference: OPEN-OP-005 (code points whose General Category differs between Unicode
  versions); REQ-RX-004
- Situation: missing (open)
- What I chose: `\p{X}` becomes JavaScript's `\p{X}` with the `u` flag, so the categories are
  those of the Node.js in use (22.22 here).
- Alternatives: ship a fixed table from one Unicode version.
- Should the spec pin this? no. OPEN-OP-005 says version differences are never tested.

## C-13: A function argument is parsed as a logical expression, then typed

- Spec reference: REQ-SY-010 ("An argument is a literal, a query, a logical expression or another
  function expression"); REQ-SY-011
- Situation: ambiguous. The spec does not say how an argument is parsed, only which argument
  kinds are allowed for each parameter.
- What I chose: a literal is parsed as a literal. Anything else is parsed as a logical
  expression, which yields a query, a function call, or a comparison or other logical form. The
  typing rules then accept or reject it. A comparison used as an argument, such as
  `length(@ == 1)`, is rejected by the typing rules.
- Alternatives: a separate argument grammar that accepts only the four kinds. The results are the
  same, since every rejected form becomes `invalid_query`.
- Should the spec pin this? no. The accept/reject result is the same either way.

## C-14: Lone surrogates: the escape is invalid, a raw one is kept as it is

- Spec reference: REQ-SY-003 (a surrogate escape that is not part of a pair is invalid);
  OPEN-OP-002 (strings that are not scalar values)
- Situation: ambiguous. REQ-SY-003 decides the escape form. The raw form, a lone surrogate inside
  the query or document, is open.
- What I chose: a `\uD800` escape without a following `\uDC00`-`\uDFFF` makes the query
  `invalid_query`. A raw lone surrogate in a query or a document is kept as one code point that
  matches itself, and `length()` counts it as 1.
- Alternatives: reject raw lone surrogates as `invalid_query`, or count them as two code units.
- Should the spec pin this? no. OPEN-OP-002 leaves them open.

## C-15: Responses are compact JSON in a fixed key order

- Spec reference: Driver protocol ("one JSON object, as one line")
- Situation: missing. The spec compares results as parsed JSON, so the text form is free.
- What I chose: `JSON.stringify` with no spaces. The keys are written `id`, then `result` with
  `values` and then `paths`, or `error`.
- Alternatives: a different key order or spacing. The parsed content is identical.
- Should the spec pin this? no. The spec says results are compared as parsed JSON.

## C-16: No guard against deep nesting

- Spec reference: OPEN-OP-004 (very deeply nested documents and queries)
- Situation: missing (open)
- What I chose: no depth limit. Evaluation and the parser recurse, so a very deep document or
  query can exhaust the stack. Node then throws, and the driver exits without answering that line.
- Alternatives: a depth limit that answers with an error. The protocol has no error code for it.
- Should the spec pin this? unsure. The spec names resource limits as open, but it does not say
  what the driver should write when it runs out.

## C-17: Tooling: a `type: module` package, and `node --test` through `npm test`

- Spec reference: REQ-BU-001, REQ-BU-002, REQ-BU-003
- Situation: missing. The spec names the `test` command but not how tests are found.
- What I chose: `package.json` sets `"type": "module"` (so `.ts` files load as ES modules) and
  `"test": "node --test \"**/*.test.ts\""`, which Node expands itself, so the glob works on
  Windows too. The package has no dependencies, and there is no build step (`build` is `""`).
- Alternatives: rely on Node's default test discovery, which does not include `.ts` files.
- Should the spec pin this? no.

## C-18: The example tests are generated from the spec's tables

- Spec reference: REQ-BU-002 (own tests for every MUST); the example tables throughout SPEC.md
- Situation: missing. The spec does not say how an implementation should test its examples.
- What I chose: `test/extract-spec-examples.ts` reads every table with a query, document, error or
  result column in SPEC.md, and writes `test/fixtures/spec-examples.json` (669 rows). The rows are
  run through `respondLine`, the same path the driver uses. Cells are read as JSON, since the spec
  writes them that way. Rows that have no query or document (the missing-member rows of
  REQ-RQ-001) are sent without that member.
- Alternatives: write each row by hand, which would take much longer and copy the same content.
- Should the spec pin this? no.

## C-19: Property tests use a seeded generator of my own

- Spec reference: PROP-SE-P1, PROP-NP-P1, PROP-FI-P1
- Situation: missing. The spec gives the sample types and the case counts, but not the
  generator.
- What I chose: a mulberry32 generator, seeded with a fixed value, that draws documents from the
  Types section's sample sets (200, 300 and 300 cases). A failure can be replayed.
- Alternatives: random seeds, which would find more cases on each run but would not be repeatable.
- Should the spec pin this? no.
