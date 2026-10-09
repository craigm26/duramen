# CHOICES

## C-1: Other white space on a "blank" line
- Spec reference: Driver protocol (blank lines; "whether other white space makes a line blank is open")
- Situation: ambiguous
- What I chose: A line is blank only if it is empty or holds only spaces and tabs. Any other line (for example a lone CR, or form feed) is not blank. It goes through JSON parsing and gets a `bad_request` response with `"id": null`. A trailing CR on an otherwise non-blank line is JSON whitespace, so CRLF input works.
- Alternatives: Treat all Unicode or JSON white space (CR, LF, FF) as blank and send no response.
- Should the spec pin this? yes, because the response count depends on it.

## C-2: Lines that are not valid UTF-8
- Spec reference: Driver protocol, Errors step 1
- Situation: missing
- What I chose: Lines are split on LF bytes and decoded as UTF-8 one at a time. A line that does not decode gets `{"id": null, "error": "bad_request"}`. Later lines are still processed.
- Alternatives: Decode with replacement characters. Abort.
- Should the spec pin this? no. It is an edge case, and `bad_request` is the natural reading.

## C-3: Non-standard JSON in requests
- Spec reference: Errors step 1
- Situation: missing
- What I chose: `NaN`, `Infinity` and `-Infinity` are not JSON, so a line containing them is `bad_request`. Duplicate member names: the last one wins. Request lines are parsed with Python's `json` module, so very deep nesting that overflows the recursion limit is also `bad_request`.
- Alternatives: Accept the constants. Reject duplicate names.
- Should the spec pin this? no.

## C-4: Number representation
- Spec reference: Operations ("numbers compare exactly"), RFC 9535 2.3.5.2.2
- Situation: ambiguous
- What I chose: Integers stay arbitrary-precision Python ints. Numbers with a fraction or exponent are parsed as `Decimal` and written back as their original decimal text, for example `1.50` or `1E+2`. Comparisons are exact mathematical comparisons, including for numbers outside the I-JSON range, where the RFC allows an implementation-specific choice. `1`, `1.0` and `1e0` are equal. Booleans never equal numbers.
- Alternatives: IEEE doubles. Normalize numbers on output.
- Should the spec pin this? no. "Compared as parsed JSON, exactly" already covers it.

## C-5: Leading and trailing white space in a query
- Spec reference: RFC 9535 2.1.1 (`jsonpath-query = root-identifier segments`, `segments = *(S segment)`)
- Situation: ambiguous
- What I chose: White space is allowed only between segments, inside brackets and around filter operators. `" $.a"` and `"$.a "` are `invalid_query`. A trailing blank after the last segment is not part of any segment, so it is rejected.
- Alternatives: Trim the query.
- Should the spec pin this? yes. The ABNF can be read both ways, and the answer decides a common test case.

## C-6: White space inside shorthand segments
- Spec reference: RFC 9535 2.5.1.1, 2.5.2.1
- Situation: ambiguous
- What I chose: No white space is allowed between `.` or `..` and the name or `*`, so `$. a` and `$.. a` are invalid. White space before a segment, such as `$ .a`, is allowed. There is no white space between a function name and `(`.
- Alternatives: Allow white space after the dot.
- Should the spec pin this? no. The ABNF is clear.

## C-7: Lone surrogates in queries
- Spec reference: RFC 9535 1.1 (Unicode scalar value), 2.1
- Situation: ambiguous
- What I chose: A query that contains a surrogate code point is `invalid_query`. This can happen when the request JSON uses `\ud800` in the query string. Surrogate escapes inside a `\u` escape of the query's own text must be well-formed pairs, as the ABNF says.
- Alternatives: Pass lone surrogates through as characters.
- Should the spec pin this? unsure. It is rare, but the driver sees it, because JSON strings can carry lone surrogates.

## C-8: Lone surrogates in documents
- Spec reference: RFC 9535 1.3
- Situation: missing
- What I chose: Nothing special. Python's `json` keeps them in strings. They are written back as `\udXXX` escapes. `length()` counts them as one code point each. Normalized paths with such keys are written as the same ASCII-escaped JSON. The RFC calls this behavior unpredictable.
- Alternatives: Reject the request.
- Should the spec pin this? no.

## C-9: Output encoding
- Spec reference: Driver protocol (UTF-8, no CR)
- Situation: missing
- What I chose: Responses are written as ASCII-only JSON, so all non-ASCII characters are `\uXXXX` escapes. This is valid UTF-8 and cannot contain a stray CR, LF or U+2028.
- Alternatives: Emit raw UTF-8.
- Should the spec pin this? no. Results are compared as parsed JSON.

## C-10: Unknown functions and wrong argument counts
- Spec reference: RFC 9535 2.4, 2.4.3
- Situation: missing
- What I chose: Only `length`, `count`, `match`, `search` and `value` exist. Any other function name is `invalid_query`, because nothing else is registered. A wrong argument count is `invalid_query`. A function name is `[a-z][a-z0-9_]*` directly followed by `(`. An upper-case name is a syntax error.
- Alternatives: Treat unknown functions as always false.
- Should the spec pin this? no. The RFC requires an error for ill-typed uses, and an unknown function cannot be well-typed.

## C-11: Type checking of function arguments
- Spec reference: RFC 9535 2.4.3
- Situation: ambiguous
- What I chose: This follows the RFC's list.
  - A ValueType parameter takes a literal, a singular query, or a ValueType function.
  - A NodesType parameter takes any query, or a NodesType function. No built-in function returns NodesType, so in practice only queries.
  - A LogicalType parameter takes a query (an existence test), a LogicalType or NodesType function, or any logical expression. No built-in function has a LogicalType parameter, so this is only exercised through the generic check.
  - A bare literal is rejected in a test position, for example `$[?true]` and `$[?1]`.
  - A ValueType function such as `length(@)` or `value(@.a)` is rejected in a test position.
  - A LogicalType function such as `match()` is rejected as a comparison operand, for example `match(...) == true`.
  - A non-singular query is rejected as a comparison operand.
  - A parenthesized or negated expression is a logical expression, not a query.
- Alternatives: Looser coercions.
- Should the spec pin this? no.

## C-12: Integer range checks
- Spec reference: RFC 9535 2.1, 2.3.3.1, 2.3.4.1
- Situation: ambiguous
- What I chose: Index, slice start, end and step must satisfy |n| <= 2^53-1, or the query is `invalid_query`. Numbers in filter literals are not range-checked, because they are comparison operands and not "relevant to JSONPath processing". `-0` is not a valid `int` for index or slice, so `$[-0]` is invalid. In a filter, `-0` is a valid number literal.
- Alternatives: Range-check all numbers.
- Should the spec pin this? unsure.

## C-13: Order of children of objects
- Spec reference: RFC 9535 2.3.2.2, 2.5.2.2
- Situation: ambiguous (the RFC does not stipulate it)
- What I chose: Members come out in the document's member order, which is the order they appear in the request JSON. Descendant traversal is pre-order depth-first, arrays in index order.
- Alternatives: Sorted order.
- Should the spec pin this? yes, if the checker compares `values` as an ordered array. The RFC lets implementations choose, but the response format is an ordered array.

## C-14: Invalid I-Regexp in match and search
- Spec reference: RFC 9535 2.4.6, 2.4.7; RFC 9485 3
- Situation: ambiguous
- What I chose: A pattern that is not a valid I-Regexp makes the function return LogicalFalse at evaluation time, as 2.4.6 says. The query itself is still valid, even when the pattern is a literal. The checker is strict and follows the ABNF. `\d`, `\w`, `\s`, blocks such as `\p{IsBasicLatin}`, `\p{Cs}`, `{2,1}`, lazy quantifiers and `(?:` are all invalid. `^` and `$` are ordinary characters. `.` matches anything except LF and CR. Categories use Python's `unicodedata`, so the Unicode version is Python's.
- Alternatives: `invalid_query` for a literal bad pattern.
- Should the spec pin this? yes. A bad literal pattern can reasonably be read as "not well-formed".

## C-15: I-Regexp matching engine
- Spec reference: RFC 9485 4, 8
- Situation: missing
- What I chose: A hand-written matcher that propagates sets of string positions, with no backtracking, so patterns cannot blow up exponentially. Counted repetition runs its iterations directly, with early exit when the position set stops changing. A very large count such as `{1000000}` on a pattern that keeps changing the set would be slow.
- Alternatives: Translate to Python `re`. This is faster, but it needs care over `$` and `^` and has no `\p{}`.
- Should the spec pin this? no.

## C-16: Deep nesting
- Spec reference: RFC 9535 2.1, 4.1
- Situation: missing
- What I chose: The driver runs in a thread with a large stack and a high recursion limit. Descendant traversal is iterative. A query nested deeper than the limit (for example thousands of `(`) is `invalid_query`. A document so deep that the JSON parser or serializer overflows is `bad_request`, or an id-less error response.
- Alternatives: Fail with a new error code. The protocol has none.
- Should the spec pin this? no.

## C-17: Duplicate name handling and `id` checks
- Spec reference: Driver protocol, Errors
- Situation: ambiguous
- What I chose: `id` must be a JSON string, otherwise `bad_request` with `"id": null`. `op` is checked for being a string equal to `query` only after `id` passes. An empty-string `id` is valid. `document: null` counts as present.
- Alternatives: Reject empty ids.
- Should the spec pin this? no.

## C-18: Multiple selectors that overlap, and error scope
- Spec reference: RFC 9535 2.1.2, 2.5.1.2
- Situation: ambiguous
- What I chose: Duplicates are kept, with one entry per selector hit and in selector order. A descendant segment applies all its selectors to each visited node in turn, not once per selector over all nodes.
- Alternatives: none.
- Should the spec pin this? no.

## C-19: Test command and layout
- Spec reference: REQ-BU-001, REQ-BU-002
- Situation: missing
- What I chose: The `test` command is `python3 -m unittest discover`, with a `py -3` variant on win32. There is no build step. The test module is `test_jsonpath.py`. It starts the driver as a subprocess for protocol tests.
- Alternatives: `pytest`. It is not in the standard library.
- Should the spec pin this? no.

## C-20: What counts as a test for each MUST
- Spec reference: REQ-BU-002
- Situation: ambiguous
- What I chose: The RFC has many MUST and SHALL sentences. I wrote at least one test for each behavior I could identify: root identifier, I-JSON integer range, well-typedness, error on invalid queries, string equality without normalization, nodelist order and duplicates, no errors from valid segments, `match` and `search` semantics, I-Regexp syntax and Unicode categories, and descendant visiting order. The tests are named by area, and there is no one-to-one table.
- Alternatives: Annotate every test with its requirement.
- Should the spec pin this? yes, if a per-MUST ID list is wanted.
