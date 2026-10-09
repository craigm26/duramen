# Choices

Each entry records a point where SPEC.md was silent, ambiguous or contradictory, and what the
implementation does about it.

## C-1: Which request lines are blank
- Spec reference: Driver protocol (blank lines; "whether other white space makes a line blank is open")
- Situation: ambiguous
- What I chose: One CR at the end of a line is removed first, so CRLF input works. A line is blank when nothing is left but spaces and tabs. A line holding only CR is therefore blank. Other white space (form feed, vertical tab, NO-BREAK SPACE) is not blank, so such a line gets `bad_request`.
- Alternatives: Treat every JSON white space character as blank. Treat CR as a line break anywhere in the input.
- Should the spec pin this? yes. CRLF input is common, and the spec should say whether it is accepted and which lines count as blank.

## C-2: The name `$.` followed by U+02CB
- Spec reference: REQ-SY-002 (name rule), and its table row `"$.ˋa"` (U+02CB) gives `invalid_query`
- Situation: contradictory
- What I chose: Follow the rule. U+02CB is at or above U+0080, so it may begin a name, and `$.ˋa` selects `1` from `{"ˋa": 1}`. The test asserts this (`tests/syntax.test.ts`). RFC 9535's name grammar also allows this code point.
- Alternatives: Follow the table row. That needs a rule the grammar does not state, such as excluding modifier letters.
- Should the spec pin this? yes. One of the two statements is wrong, and the table row is the one that disagrees with the rule and with RFC 9535.

## C-3: Escaping U+0085, U+2028 and U+2029 in output
- Spec reference: Driver protocol (standard output: "Every line ends with LF and contains no CR")
- Situation: missing
- What I chose: Those three code points are written as `\uXXXX` escapes in response lines. Inside a JSON string they are legal, and the parsed value is unchanged. Readers that split on them (Python's `splitlines`, for one) would otherwise see extra lines.
- Alternatives: Write them raw, as JSON.stringify does.
- Should the spec pin this? unsure. The spec should name the line terminator readers may split on; with that stated, this choice would be settled.

## C-4: Responses are written as their request lines arrive
- Spec reference: Driver protocol (requests on standard input; responses "in request order")
- Situation: missing
- What I chose: The driver answers each line as soon as it is complete, so output starts before input ends. Order is kept because lines are handled one at a time.
- Alternatives: Read all of standard input, then answer.
- Should the spec pin this? unsure. It only matters to a harness that waits for a response before sending the next request, which would then deadlock if buffering were required.

## C-5: Lone surrogates in strings and names (OPEN-OP-002)
- Spec reference: OPEN-OP-002
- Situation: missing (the spec leaves it open)
- What I chose: JavaScript strings are used as they are. A lone surrogate counts as one code point in `length()`, compares by its value, and is written in output as a `\uDXXX` escape, which JSON.stringify produces. The query parser treats a raw lone surrogate in a name as a name character, since it is at or above U+0080.
- Alternatives: Reject such strings, or replace them with U+FFFD.
- Should the spec pin this? no. It is listed as open and is never tested.

## C-6: Numbers beyond binary64 range, written in `values` (OPEN-OP-003)
- Spec reference: OPEN-OP-003
- Situation: missing (the spec leaves it open)
- What I chose: Numbers are IEEE 754 doubles from JSON.parse. A document number such as `1e400` becomes Infinity, so `values` shows `null` for it, because JSON.stringify writes Infinity as `null`. A literal `1e400` in a query compares as Infinity.
- Alternatives: Reject such documents. Write the original number text in `values`.
- Should the spec pin this? unsure. `null` for a number is surprising output, though the spec does leave it open.

## C-7: Negative zero in `values`
- Spec reference: REQ-RQ-002 (values), REQ-FI-004 (`0` and `-0` are equal)
- Situation: missing
- What I chose: `-0` in a document is written as `0`, which is what JSON.stringify produces. Its value is the same as `0` under REQ-FI-004.
- Alternatives: Write `-0` as text. JSON has no required form for it.
- Should the spec pin this? no. Equal numbers compare equal, and this choice does not change any comparison.

## C-8: I-Regexps with a range `{n,m}` where n > m, or a class range `[z-a]`
- Spec reference: OPEN-OP-006, REQ-RX-003, REQ-RX-006
- Situation: missing (the spec leaves it open)
- What I chose: Both make the pattern unusable, so `match()` and `search()` give false, never an error. For `{n,m}` the grammar accepts the string, and the RegExp engine then refuses it, which gives the same false. For `[z-a]` the translator refuses the class.
- Alternatives: Accept `[z-a]` as an empty class, or accept `{3,2}` as matching nothing.
- Should the spec pin this? unsure. The only visible effect is the result of `match`/`search`, so it matters for interoperability, but OPEN-OP-006 deliberately leaves it open.

## C-9: Very large quantifier counts (OPEN-OP-004)
- Spec reference: OPEN-OP-004 (resources), REQ-RX-006
- Situation: missing
- What I chose: A count that the RegExp engine accepts is used as written. Node 22 accepts `a{100000000000000000000}`, and that pattern matches no subject of realistic length (checked: `aaa` and a 1000-`a` string both give false). Nested unbounded quantifiers can still take a long time to match, and nothing limits that.
- Alternatives: Reject counts above some bound as not I-Regexps. Give an error.
- Should the spec pin this? no. It is a resource limit, and the spec leaves those open.

## C-10: I-Regexp matching uses the JavaScript RegExp engine
- Spec reference: REQ-RX-001 to REQ-RX-006, OPEN-OP-005 (Unicode versions)
- Situation: missing
- What I chose: The pattern is checked against the RFC 9485 grammar in full, then rewritten as a JavaScript RegExp with the `u` flag. Each literal is a `\u{...}` escape, `.` is `[^\n\r]`, `^` and `$` are escaped, and `\p{X}` uses the engine's General_Category support. Categories therefore follow the Unicode version built into Node.js (22.22 here).
- Alternatives: Write a matcher of my own, which means implementing Unicode category tables.
- Should the spec pin this? no. The spec defines the behavior, and the Unicode version is open under OPEN-OP-005.

## C-11: Queries nested too deeply to parse (OPEN-OP-004)
- Spec reference: OPEN-OP-004 (resources), REQ-RQ-004
- Situation: missing
- What I chose: A RangeError from the parser (stack exhaustion) is answered as `invalid_query`, since such a query cannot be parsed.
- Alternatives: Give a different error code, which the spec does not define. Crash.
- Should the spec pin this? unsure. The spec leaves "what it then answers" open, but the error list has no code for resource limits.

## C-12: Duplicate member names in a document (OPEN-OP-001)
- Spec reference: OPEN-OP-001
- Situation: missing (the spec leaves it open)
- What I chose: JSON.parse keeps the last value of a repeated name, and the member appears once.
- Alternatives: Keep the first value. Reject the document.
- Should the spec pin this? no. It is listed as open and is never tested.

## C-13: Request bytes that are not UTF-8 (OPEN-OP-008)
- Spec reference: OPEN-OP-008
- Situation: missing (the spec leaves it open)
- What I chose: The input is decoded with `StringDecoder`, which replaces each invalid byte sequence with U+FFFD. The line then goes through the normal checks.
- Alternatives: Answer the line with `bad_request`.
- Should the spec pin this? no. It is listed as open.

## C-14: Negative-step slice defaults
- Spec reference: REQ-SE-005 ("a negative start or end has `len` added to it")
- Situation: ambiguous
- What I chose: The default end of a negative step is `-len - 1`, and the default start is `len - 1`. The code adds `len` to both defaults when they are negative, as it does to explicit bounds. This gives the same selection as using the defaults unchanged. I checked both readings against each other for lengths 0 to 20 and a set of starts, ends and negative steps, with no difference.
- Alternatives: Use the defaults without adding `len`.
- Should the spec pin this? no. Both readings select the same nodes.

## C-15: An internal error stops the driver
- Spec reference: Driver protocol (exactly one response per non-blank line; exit status 0)
- Situation: missing
- What I chose: Only the parser's errors (QueryError, and RangeError from deep nesting) become error responses. Any other exception is a bug in the implementation, so it is not caught, and the driver exits with a failure status.
- Alternatives: Catch everything and answer with an error code. The spec defines no code for internal failures, so that would mislabel bugs as `bad_request` or `invalid_query`.
- Should the spec pin this? unsure. The spec defines no response for an internal failure.

## C-16: Build, test and driver commands in REGEN.json
- Spec reference: REQ-BU-001, REQ-BU-002, REQ-BU-003
- Situation: missing
- What I chose: `build` is empty, since there is nothing to build. `test` is `node --test`, which finds `tests/*.test.ts`. `driver` is `node driver.ts`. Node 22.18 and later strip types without a flag, so no flags are needed. The sources use only erasable syntax.
- Alternatives: `npm test` as the test command, which runs the same thing.
- Should the spec pin this? no.

## C-17: A package.json with "type": "module"
- Spec reference: REQ-BU-003 (a package.json is allowed if it declares no dependencies)
- Situation: missing
- What I chose: `package.json` sets `"type": "module"` so that `.ts` files load as ES modules without relying on syntax detection. It has no dependencies, and its `scripts.test` is `node --test`.
- Alternatives: No package.json, relying on Node's module syntax detection.
- Should the spec pin this? no.

## C-18: Test layout
- Spec reference: REQ-BU-002, REQ-BU-004
- Situation: missing
- What I chose: Tests are in `tests/`, named `*.test.ts`. `node --test` finds them, and REQ-BU-004 does not count them. `tests/support.ts` holds a shared helper. It is not a test file, but it sits in `tests/`, so it is not counted either.
- Alternatives: Tests beside the sources.
- Should the spec pin this? no.

## C-19: Standard error is left unused
- Spec reference: OPEN-OP-007 (standard error), Driver protocol (standard output holds only responses)
- Situation: missing (the spec leaves standard error open)
- What I chose: Nothing is written to standard error. Standard output carries only responses.
- Alternatives: Log diagnostics to standard error.
- Should the spec pin this? no.
