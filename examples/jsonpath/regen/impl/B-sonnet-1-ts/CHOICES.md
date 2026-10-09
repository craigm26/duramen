## C-1: Test command and test folder
- Spec reference: REQ-BU-001, REQ-BU-002
- Situation: missing
- What I chose: `test` is `node --test "tests/*.test.ts"` (double quotes work in both sh and cmd; Node expands the glob itself on Windows). Tests live in `tests/`. `build` is the empty string.
- Alternatives: bare `node --test` (relies on the default `.ts` discovery); tests at the folder root.
- Should the spec pin this? no, the spec already leaves it to the implementer.

## C-2: Failures that are not a protocol error (stack overflow, unexpected exception)
- Spec reference: Errors section, R1
- Situation: missing
- What I chose: a `RangeError` (a stack overflow on very deeply nested JSON) while parsing a request line or evaluating gives `bad_request`. Any other unexpected exception in the driver gives `{"id":null,"error":"bad_request"}`, so one response is always written per line and the driver does not crash.
- Alternatives: crash; invent an error code (not allowed by the protocol).
- Should the spec pin this? unsure. A maximum nesting depth would make it testable.

## C-3: Strict JSON for request lines
- Spec reference: R1.2
- Situation: ambiguous
- What I chose: a request line must be strict RFC 8259 JSON. JSON white space is space, tab, LF and CR only. Leading zeros, trailing commas, NaN, raw control characters in strings and trailing garbage are all `bad_request`. Duplicate members in the request itself: the last one wins, as for documents. Lone-surrogate escapes in strings are accepted. A lone surrogate in the `query` string gives `invalid_query`, because the id and op checks come first.
- Alternatives: lenient parsing via `JSON.parse`. That cannot preserve key order or big numbers anyway.
- Should the spec pin this? no.

## C-4: Number output text
- Spec reference: R31.2, DECISIONS 4
- Situation: ambiguous
- What I chose: numbers in `values` are written exactly as in the input text (`1.0`, `1E5`, `-0` and 20-digit integers are kept). Numbers made by `length()` and `count()` are only used in comparisons and never reach the output.
- Alternatives: normalize through `Number`, which loses precision.
- Should the spec pin this? no. Compared as parsed JSON, both choices are acceptable.

## C-5: Number comparison for huge values
- Spec reference: R18.5, DECISIONS 3
- Situation: ambiguous
- What I chose: `Number(text)` (round to nearest binary64) on both sides. Integers above 2^53 that differ in the last digits can therefore compare equal. `-0 == 0`. An overflow to infinity compares equal to another overflow of the same sign.
- Alternatives: exact decimal comparison, which the spec rules out.
- Should the spec pin this? no, DECISIONS already pins it.

## C-6: Blank space before the first selector in a singular query
- Spec reference: R17.1, DECISIONS 12
- Situation: ambiguous
- What I chose: blank space is accepted before a segment of a singular query (`@.a [0] == 1` is valid, as the spec's scenario says). Blank space inside the brackets makes the query non-singular, so it is `invalid_query` as a comparable and valid as an existence test. A singular segment is a bracketed single name or index, or `.name`. `[` alone, `.*` and `..` are not singular.
- Alternatives: none that fit the grammar.
- Should the spec pin this? no.

## C-7: Function arguments, a bare literal and the type check
- Spec reference: R20.4, R21, DECISIONS 13
- Situation: ambiguous
- What I chose: each argument is parsed as a full logical expression. A bare literal, bare query or bare function call keeps its own kind. Anything else (parenthesized, negated, compared, joined with `&&` or `||`) is a logical-expr argument. No built-in function takes LogicalType, so a logical-expr argument is always `invalid_query`. The type check runs when the call is parsed. A literal as an operand of `&&`, `||` or `!` is `invalid_query`. A function of ValueType used as a test is `invalid_query`, and so is a LogicalType function used as a comparable.
- Alternatives: separate grammar passes.
- Should the spec pin this? no.

## C-8: Function name followed by `(` versus the keywords
- Spec reference: R16, R20
- Situation: ambiguous
- What I chose: a run of lowercase letters, digits and `_` is read first. If `(` follows immediately it is a function call (so `true(` is an unknown function and `invalid_query`). Otherwise it must be exactly `true`, `false` or `null`. `nullx` and similar are invalid.
- Alternatives: none.
- Should the spec pin this? no.

## C-9: Slice and index parse details
- Spec reference: R10, R11
- Situation: ambiguous
- What I chose: the integer text is parsed with `BigInt` and range-checked before conversion. `-0`, leading zeros and a space after `-` are invalid everywhere an integer appears, including slice parts and filter queries. Blank space is accepted around the colons of a slice, and after the second colon before the step.
- Alternatives: none.
- Should the spec pin this? no.

## C-10: Descendant traversal and node identity
- Spec reference: R6, R3
- Situation: missing
- What I chose: pre-order traversal with an explicit stack, so deep documents do not overflow it. The selectors of a descendant segment are applied node by node, as R6.3 says. Nodes are never de-duplicated. A node's path is built from parent links when the result is written.
- Alternatives: recursion.
- Should the spec pin this? no.

## C-11: I-Regexp implemented by translation to JavaScript `RegExp`
- Spec reference: R27, R28, Appendix D
- Situation: missing
- What I chose: the pattern is validated by a hand-written parser that follows the R27 grammar and emits a `u`-flag `RegExp` source. Every literal is emitted as `\u{hex}`, `.` becomes `[^\n\r]`, and groups become non-capturing. `match` wraps the pattern in `^(?:…)$`. Quantifier counts are not limited (DECISIONS 8). Compiled patterns are cached by pattern string, including invalid ones. A pattern whose `RegExp` construction throws is treated as invalid, so the result is false. Catastrophic backtracking is possible and is not guarded.
- Alternatives: own NFA matcher, which would be immune to backtracking blowup.
- Should the spec pin this? unsure. A time or step limit could matter for hostile patterns.

## C-12: Strings that contain lone surrogates in documents
- Spec reference: R31.4, R22
- Situation: missing
- What I chose: a document string with a lone surrogate (from a `\ud800` escape) is kept as such. `length()` counts it as one character and the output re-escapes it as `\ud800` (JSON.stringify well-formed output), so stdout stays valid UTF-8. Comparison orders it by its surrogate code point.
- Alternatives: reject the document.
- Should the spec pin this? yes, the spec says the document can be any JSON value but is silent about unpaired surrogates in it.

## C-13: Line splitting and decoding of stdin
- Spec reference: R1.1
- Situation: ambiguous
- What I chose: lines are split on LF only (U+2028, U+0085 and others are not separators). Input is decoded as UTF-8 with replacement of invalid bytes. A final line with no LF is processed. A line is blank if it consists only of space, tab and CR, anywhere in it. Other lines are parsed as JSON, so a trailing CR is JSON white space.
- Alternatives: fatal UTF-8 decoding giving `bad_request`.
- Should the spec pin this? no.

## C-14: Escaping in normalized paths for DEL and non-BMP characters
- Spec reference: R29.2
- Situation: ambiguous
- What I chose: exactly as R29.2: only U+0000–U+001F, `'` and `\` are escaped. U+007F and everything above are written as is. U+2028 and U+2029 are written raw into the JSON string by `JSON.stringify`, which is valid JSON.
- Alternatives: none.
- Should the spec pin this? no.
