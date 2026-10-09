# CHOICES

## C-1: Which white space makes a request line blank
- Spec reference: Driver protocol, "whether other white space makes a line blank is open"
- Situation: ambiguous
- What I chose: a line is blank only if, after removing the trailing LF, it holds nothing but spaces and tabs. A lone CR, form feed or other white space is not blank. Such a line is parsed as JSON; a lone CR parses as empty JSON and gets `bad_request` with `id` null.
- Alternatives: treat CR (CRLF input) or all Unicode white space as blank and send no response.
- Should the spec pin this? yes, because a harness that sends CRLF lines or a whitespace-only line would see a different number of responses.

## C-2: Request lines that are not valid UTF-8 or contain NaN/Infinity
- Spec reference: Errors, check 1
- Situation: missing
- What I chose: invalid UTF-8, `NaN`, `Infinity` and `-Infinity` mean the line is not JSON, so `bad_request` with `id` null.
- Alternatives: accept the non-standard constants as Python does by default; replace bad bytes.
- Should the spec pin this? no, these are edge cases of "not a JSON object".

## C-3: Duplicate member names in request JSON
- Spec reference: RFC 9535 section 1.3 (unpredictable behaviour)
- Situation: missing
- What I chose: the last duplicate wins, as in Python's `json`.
- Alternatives: reject the line; keep the first.
- Should the spec pin this? no, RFC 9535 declares it undefined.

## C-4: Number representation
- Spec reference: "numbers compare exactly"; RFC 9535 2.3.5.2.2
- Situation: ambiguous
- What I chose: document numbers are parsed as Python `int` (no fraction or exponent) or `Decimal` (otherwise) and written back with their original digits (`Decimal` text such as `1E+2`). Comparison uses exact arithmetic, so `1 == 1.0` and `1.00000000000000000001 > 1` hold. Query number literals are handled the same way. Very large integers have no limit.
- Alternatives: IEEE doubles, which would lose precision beyond 2^53.
- Should the spec pin this? unsure; "compare exactly" suggests this, but output formatting is only compared after parsing.

## C-5: Numbers beyond Decimal range in requests
- Spec reference: none
- Situation: missing
- What I chose: a document with an exponent too large for `Decimal` fails parsing, so the line gets `bad_request`.
- Alternatives: convert to a double or infinity.
- Should the spec pin this? no.

## C-6: Whitespace at the ends of a query
- Spec reference: RFC 9535 2.1.1 grammar (`jsonpath-query = root-identifier segments`, `segments = *(S segment)`)
- Situation: ambiguous
- What I chose: follow the ABNF literally. Leading white space is invalid, and so is trailing white space (`"$ "`), because `S` only precedes a segment. Blank space is allowed between segments, inside brackets, around selector commas, after `?`, around `&&`/`||`/comparison operators, after `!`, and inside function argument lists. Blank space is not allowed after the `.` of dot notation or after `..`.
- Alternatives: trim the query; allow trailing blanks.
- Should the spec pin this? yes, many implementations accept trailing blanks and a test suite could go either way.

## C-7: `-0` as an index, slice bound or step
- Spec reference: RFC 9535 2.3.3.1 (`int = "0" / (["-"] DIGIT1 *DIGIT)`)
- Situation: ambiguous
- What I chose: `-0` is invalid in index and slice positions, since `int` does not allow it. In filter literals `-0` is valid (`number` allows `"-0"`) and equals 0.
- Alternatives: accept `-0` everywhere.
- Should the spec pin this? no, the ABNF is clear but easy to miss.

## C-8: Integer range check
- Spec reference: RFC 9535 2.1
- Situation: ambiguous
- What I chose: only integers in index selectors and slice start, end and step are range-checked, against [-(2^53)+1, 2^53-1]. Number literals in filter comparisons are not checked and may be any size or form.
- Alternatives: also reject out-of-range integer literals in comparisons.
- Should the spec pin this? yes; "relevant to the JSONPath processing" is vague.

## C-9: Function argument typing details
- Spec reference: RFC 9535 2.4.3
- Situation: ambiguous
- What I chose: the following rules.
  - A `ValueType` parameter accepts a literal, a singular query or a `ValueType` function.
  - A `NodesType` parameter accepts any query (singular or not).
  - A `LogicalType` parameter accepts a query (existence test), a function returning `LogicalType` or `NodesType`, and any logical expression (comparison, `&&`, `||`, `!`, parentheses).
  - A bare literal as a test expression, or a `ValueType` function as a test expression, is invalid.
  - The comparison operands must be literals, singular queries or `ValueType` functions.
  - An unknown function name or a wrong argument count is `invalid_query`.
  - An absolute query (`$...`) is allowed as a function argument and as a comparison operand, and `$` always means the document root.
- Alternatives: a stricter or looser reading of the rule list.
- Should the spec pin this? no.

## C-10: `!` applied to a comparison
- Spec reference: RFC 9535 2.3.5.1 (`paren-expr = [logical-not-op S] "(" ...`, `test-expr = [logical-not-op S] ...`)
- Situation: ambiguous
- What I chose: `!` may only prefix a parenthesised expression, a query or a function expression. `!@.a == 1` is invalid; write `!(@.a == 1)`.
- Alternatives: parse `!` with lower precedence than comparison.
- Should the spec pin this? no, the grammar decides it.

## C-11: Member order of objects in results
- Spec reference: RFC 9535 2.3.2.2 (object order is not stipulated)
- Situation: missing
- What I chose: object members are visited in document order (as parsed), for wildcards, descendants and filters.
- Alternatives: sorted order.
- Should the spec pin this? yes; the driver compares `values` and `paths` as ordered arrays, so an object-order requirement would help.

## C-12: Regular expressions are translated to Python `re`
- Spec reference: RFC 9485 section 3 and 4
- Situation: ambiguous
- What I chose: I validate an I-Regexp with my own parser that follows the ABNF exactly. `[^]` is rejected, as are ranges with a lower bound above the upper bound, `{n,m}` with n above m, and any unknown `\p{..}` property. I then translate it to a Python `re` pattern. The `.` becomes `[^\n\r]`. Category classes (`\p{..}`, `\P{..}`) are expanded to explicit code point ranges from `unicodedata`. Matching is `fullmatch` for `match()` and `search` for `search()`. Surrogate code points never match. An invalid I-Regexp makes `match()` and `search()` return LogicalFalse, as RFC 9535 says. A repeat count too large for Python `re` is treated like an invalid pattern.
- Alternatives: write a dedicated automaton matcher, which would avoid Python's backtracking blow-up on patterns such as `(a*)*b`.
- Should the spec pin this? unsure. Category data follows the Unicode version of the Python in use.

## C-13: Normalized path escaping of controls
- Spec reference: RFC 9535 2.7
- Situation: ambiguous
- What I chose: in `paths`, member names escape `'` and `\`, use `\b \f \n \r \t` for those controls, and use lowercase `\u00xx` for the other controls below 0x20. Everything else, including DEL (0x7F) and non-ASCII, is written as is. Array indexes are non-negative decimal.
- Alternatives: none; this follows the ABNF.
- Should the spec pin this? no.

## C-14: Errors other than the four codes
- Spec reference: Errors
- Situation: missing
- What I chose: a recursion failure while parsing a query gives `invalid_query`. Any unexpected internal exception while handling a line gives `{"id": null, "error": "bad_request"}`, so that every non-blank line gets exactly one response.
- Alternatives: crash.
- Should the spec pin this? no.

## C-15: Result `id` and the second error case
- Spec reference: Errors, checks 1 and 2
- Situation: ambiguous
- What I chose: `id` is null only when the line is not a JSON object or `id` is missing or not a string. In every other error the string `id` is echoed back.
- Alternatives: none.
- Should the spec pin this? no.

## C-16: Lone surrogates in queries
- Spec reference: RFC 9535 2.1 and 2.3.1.1
- Situation: ambiguous
- What I chose: a query that contains a lone surrogate code point (possible when the JSON request used an escape like `\ud800`) is invalid wherever it appears in a string or a shorthand name, because the grammar only allows Unicode scalar values.
- Alternatives: accept it.
- Should the spec pin this? no.

## C-17: Output escaping
- Spec reference: Driver protocol (standard output is UTF-8, LF only, no CR)
- Situation: missing
- What I chose: every response is written as ASCII-only JSON, with non-ASCII characters as `\uXXXX` escapes, so no CR or odd character can leak out and lone surrogates still serialize.
- Alternatives: raw UTF-8 output.
- Should the spec pin this? no; results are compared as parsed JSON.

## C-18: Reading input
- Spec reference: Driver protocol
- Situation: missing
- What I chose: the driver reads stdin line by line (split on LF only) and flushes after each response, so a client that waits for each answer before sending the next request does not deadlock. A final line without LF is still handled.
- Alternatives: read all input first.
- Should the spec pin this? no.
