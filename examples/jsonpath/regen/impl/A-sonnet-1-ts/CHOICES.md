# CHOICES

## C-1: Blank lines
- Spec reference: Driver protocol ("whether other white space makes a line blank is open")
- Situation: ambiguous
- What I chose: a line is blank (no response) if it consists only of spaces, tabs and CR. A line ending in CR is also parsed normally as JSON (CR is JSON whitespace).
- Alternatives: only space/tab blank (a lone CR line would get `bad_request`); all Unicode white space.
- Should the spec pin this? yes, CRLF input is common and the answer changes the number of responses.

## C-2: Numbers keep their exact lexeme
- Spec reference: Operations ("numbers compare exactly"), RFC 9535 2.3.5.2.2
- Situation: ambiguous
- What I chose: documents and query literals are parsed with a custom JSON parser that stores numbers as text. Comparisons use exact decimal arithmetic (BigInt); output echoes the original lexeme (`1.0`, `1E2`, `12345678901234567890` unchanged).
- Alternatives: JS doubles (loses precision above 2^53); canonicalising output numbers.
- Should the spec pin this? no, "compared as parsed JSON" is enough, but it is worth knowing that the output is not re-normalised.

## C-3: Order of object members
- Spec reference: RFC 9535 2.3.2.2 (order unstipulated)
- Situation: ambiguous
- What I chose: objects are `Map`s and iterate in the document's insertion order (so integer-like keys are not reordered). Duplicate names in the input: the last value wins, at the first position.
- Alternatives: JS plain objects (integer keys sorted first); rejecting duplicates.
- Should the spec pin this? no, the spec says order is free for objects.

## C-4: Invalid JSON line / non-object request
- Spec reference: Errors, step 1
- Situation: ambiguous
- What I chose: any line that is not strictly valid RFC 8259 JSON (including trailing garbage, NaN, trailing commas) gets `{"id":null,"error":"bad_request"}`. Duplicate keys in the request are accepted (last wins). Invalid UTF-8 bytes are decoded to U+FFFD.
- Alternatives: lenient JSON; treating invalid UTF-8 as an error.
- Should the spec pin this? unsure.

## C-5: Whitespace in queries
- Spec reference: RFC 9535 2.1.1 grammar
- Situation: ambiguous
- What I chose: follow the ABNF literally. Whitespace (space, tab, LF, CR) is allowed between segments (`$ .a`) and inside brackets and filter expressions, but not before the `$`, not after the last segment (`$ ` is invalid), not after `.` or `..`, and not between a function name and `(`.
- Alternatives: trimming leading/trailing whitespace.
- Should the spec pin this? no, the ABNF decides it; the trailing-space consequence is just easy to miss.

## C-6: "-0" as an integer
- Spec reference: RFC 9535 2.3.3.1 (`int = "0" / (["-"] DIGIT1 *DIGIT)`)
- Situation: ambiguous
- What I chose: `$[-0]` and slice parameters `-0` are invalid_query, whereas the filter literal `-0` is a valid number (`number = (int / "-0") ...`).
- Alternatives: accept `-0` as 0 for indexes.
- Should the spec pin this? no.

## C-7: Lone surrogates
- Spec reference: RFC 9535 2.1 (queries are Unicode scalar values), 2.3.1.1
- Situation: ambiguous
- What I chose: a query string holding a lone surrogate (raw, since the JSON request could carry one via `\ud800`) is invalid_query. A `\u` escape inside a query string literal must be a non-surrogate or a high+low pair. Document strings and member names may hold lone surrogates; they are passed through and re-escaped on output. Normalized paths are built from those names as-is.
- Alternatives: treat lone surrogates in documents as errors.
- Should the spec pin this? yes, the protocol allows JSON that cannot be represented as scalar values.

## C-8: Hex digits case in `\u` escapes
- Spec reference: RFC 9535 2.3.1.1 notes
- Situation: contradictory (ABNF writes upper case; note says case-insensitive)
- What I chose: accept both cases in queries; normalized paths emit lowercase hex (`\u000b`) as the normal-HEXDIG rule requires.
- Alternatives: upper case only.
- Should the spec pin this? no.

## C-9: Index and slice range
- Spec reference: RFC 9535 2.1, 2.3.3.1, 2.3.4.1
- Situation: ambiguous
- What I chose: indexes, slice start/end/step must be within [-(2^53)+1, 2^53-1], else invalid_query. Number literals in filters are not range-checked (they are not "relevant to the JSONPath processing"); exact decimal comparison handles them.
- Alternatives: range-checking filter literals.
- Should the spec pin this? unsure.

## C-10: Function argument typing
- Spec reference: RFC 9535 2.4.3
- Situation: ambiguous
- What I chose: only the five built-in functions exist (unknown names are invalid_query). An argument that is a logical expression (comparison, `&&`, `!`, parenthesised) is a syntax/type error for every built-in, since none takes LogicalType. Wrong argument count is invalid_query. A literal given for a NodesType parameter, or a non-singular query/NodesType function for a ValueType parameter, is invalid_query.
- Alternatives: none really; the extra parse shapes are rejected the same way.
- Should the spec pin this? no.

## C-11: Regexp engine
- Spec reference: RFC 9485 section 3, 4, 5.3; RFC 9535 2.4.6, 2.4.7
- Situation: missing (no performance requirement)
- What I chose: a checking I-Regexp parser (own grammar implementation, rejects `\d`, `[^]`, class subtraction, `\p{IsX}`, reversed ranges, `{n,m}` with n>m, etc.) that translates to a JS `u`-flag RegExp following the RFC 9485 5.3 recipe (`.` -> `[^\n\r]`, `^(?:...)$` for match). Every literal is emitted as `\u{..}`. An invalid pattern or non-string argument gives LogicalFalse. Catastrophic backtracking is possible for adversarial patterns because the JS engine backtracks; there is no mitigation. Unicode category data comes from the Node runtime, so it follows its Unicode version.
- Alternatives: own linear-time NFA matcher.
- Should the spec pin this? unsure; resource limits are not stated.

## C-12: Invalid regexp in a literal pattern
- Spec reference: RFC 9535 2.4.6
- Situation: ambiguous
- What I chose: an invalid I-Regexp in a literal second argument is NOT an invalid_query; the call yields false at evaluation time (the RFC says "the result is LogicalFalse").
- Alternatives: reject at query-parse time when the pattern is a literal.
- Should the spec pin this? yes, since the RFC allows both readings of "valid query".

## C-13: Comparison of `<=`/`>=` on non-comparable values
- Spec reference: RFC 9535 2.3.5.2.2
- Situation: ambiguous
- What I chose: exactly as defined: `a <= b` is `a < b || a == b`; so `{} <= {}` and `true <= true` are true; `1 <= [1]` false. Strings are ordered by code point (not UTF-16 unit).
- Alternatives: none.
- Should the spec pin this? no.

## C-14: Failure modes beyond the listed errors
- Spec reference: RFC 9535 2.1 ("MUST NOT silently malfunction")
- Situation: missing
- What I chose: JSON parsing and descendant traversal are iterative so deep documents work; filter nesting deeper than 500 levels is rejected as invalid_query. Equality of extremely deeply nested values uses recursion and could overflow the stack for depths in the tens of thousands.
- Alternatives: iterative equality.
- Should the spec pin this? no.

## C-15: Test command and layout
- Spec reference: REQ-BU-001, REQ-BU-002
- Situation: missing
- What I chose: `test` is `node --test` (auto-discovers `tests/*.test.ts`); `build` is empty; `driver` is `node driver.ts`. A `package.json` with only `"type": "module"` is included. Source files sit in the folder root.
- Alternatives: explicit test file path.
- Should the spec pin this? no.

## C-16: Normalized path for escaped control characters
- Spec reference: RFC 9535 2.7
- Situation: ambiguous
- What I chose: `\b \t \n \f \r \' \\` use short escapes; other characters below U+0020 become `\u00xx` (lowercase hex); U+007F and above are emitted raw.
- Alternatives: none; this is the RFC's one-and-only form.
- Should the spec pin this? no.
