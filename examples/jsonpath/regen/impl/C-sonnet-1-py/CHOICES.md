# Choices

## C-1: U+02CB after a dot
- Spec reference: REQ-SY-002
- Situation: contradictory
- What I chose: a member-name shorthand rejects U+02CB (MODIFIER LETTER GRAVE ACCENT), so `$.ˋa` is `invalid_query`. All other code points from U+0080 up are accepted.
- Alternatives: follow the prose rule only and accept U+02CB; or reject a whole category such as Sk (it would also reject other code points the prose accepts, with no evidence for them).
- Should the spec pin this? yes. The prose says every code point from U+0080 up is allowed, but an example rejects U+02CB. The rule that explains the example should be stated.

## C-2: Reversed ranges and bounds in I-Regexp
- Spec reference: OPEN-OP-006
- Situation: ambiguous
- What I chose: `[z-a]` and `a{3,2}` are not I-Regexps, so `match` and `search` are false.
- Alternatives: accept them and match nothing.
- Should the spec pin this? no, it is deliberately open.

## C-3: Lone surrogates in I-Regexp
- Spec reference: OPEN-OP-002, REQ-RX-001
- Situation: missing
- What I chose: a lone surrogate code point in a pattern is not a NormalChar or CCchar, so the pattern is invalid. Lone surrogates elsewhere are handled as ordinary code points.
- Alternatives: treat them as ordinary characters.
- Should the spec pin this? no.

## C-4: Lines that are not blank but hold other white space
- Spec reference: Driver protocol
- Situation: ambiguous (the spec says it is open)
- What I chose: only lines of spaces and tabs are blank and get no response. A line with other white space, such as a lone CR, goes through JSON parsing, so a lone CR gets `bad_request` with `id` null. A trailing CR after valid JSON is JSON white space and is accepted.
- Alternatives: also treat CR-only lines as blank.
- Should the spec pin this? no.

## C-5: Request JSON parsing
- Spec reference: Errors, step 1
- Situation: missing
- What I chose: `NaN`, `Infinity` and `-Infinity` in a request are not JSON, so the line is `bad_request`. Duplicate object members keep the last value (OPEN-OP-001). Invalid UTF-8 is replaced with U+FFFD (OPEN-OP-008).
- Alternatives: accept the constants (Python's default).
- Should the spec pin this? no.

## C-6: Output encoding
- Spec reference: Driver protocol
- Situation: missing
- What I chose: responses are written as ASCII JSON, with non-ASCII characters as `\uXXXX` escapes. This is valid UTF-8 and cannot contain CR or a raw LF. It also copes with lone surrogates.
- Alternatives: raw UTF-8 output.
- Should the spec pin this? no.

## C-7: Number comparison
- Spec reference: OPEN-OP-003, REQ-FI-004
- Situation: ambiguous
- What I chose: numbers are converted to binary64 before comparing, so integers beyond 2^53 compare as their rounded doubles. A literal such as `1e400` becomes infinity. Values are returned as parsed, with Python integers kept exact.
- Alternatives: exact big-integer comparison.
- Should the spec pin this? no, it is open.

## C-8: Deep recursion
- Spec reference: OPEN-OP-004
- Situation: missing
- What I chose: the recursion limit is raised to 20000. A `RecursionError` while parsing a query gives `invalid_query`. In a regexp match it gives false. A `RecursionError` in the driver's catch-all gives `bad_request`.
- Alternatives: an explicit nesting limit.
- Should the spec pin this? no.

## C-9: Arguments of functions are parsed as terms
- Spec reference: REQ-SY-010, REQ-SY-011
- Situation: ambiguous
- What I chose: an argument is a literal, a query or a function expression. An argument that starts a logical expression (parentheses, `!`, a comparison, `&&`, `||`) is rejected as `invalid_query`. This agrees with REQ-SY-011, which forbids those as arguments of the five functions.
- Alternatives: parse them and then reject for typing; the result is the same.
- Should the spec pin this? no.

## C-10: Function-named literals
- Spec reference: REQ-SY-008, REQ-SY-010
- Situation: ambiguous
- What I chose: a lower-case word followed immediately by `(` is a function call, even for `true(`, so `true(@)` is an unknown function and `invalid_query`. A word not followed by `(` must be exactly `true`, `false` or `null`.
- Alternatives: none that differ in observable results.
- Should the spec pin this? no.

## C-11: Unicode category data
- Spec reference: OPEN-OP-005
- Situation: missing
- What I chose: Python's `unicodedata` provides the General Category, whatever Unicode version the interpreter has. `Cn` covers unassigned code points and `C` also covers surrogates.
- Alternatives: a bundled table.
- Should the spec pin this? no, it is open.
