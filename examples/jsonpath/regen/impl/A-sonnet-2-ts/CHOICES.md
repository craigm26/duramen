# Choices

## C-1: Blank lines are only spaces and tabs
- Spec reference: Driver protocol ("whether other white space makes a line blank is open")
- Situation: ambiguous
- What I chose: A line is blank only if it is empty or holds just spaces and tabs. A line holding only CR, or any other white space, is not blank and gets a response (`bad_request` with `id: null`, since it is not a JSON object). A trailing CR after a request is JSON white space, so CRLF framing works.
- Alternatives: Treat CR-only lines (or all JSON white space) as blank.
- Should the spec pin this? yes, because a client that writes CRLF may send CR-only blank lines and the behavior decides whether the response stream stays aligned.

## C-2: Trailing and leading white space in a query is invalid
- Spec reference: RFC 9535 2.1.1 (`jsonpath-query = root-identifier segments`, `segments = *(S segment)`)
- Situation: ambiguous
- What I chose: Strict ABNF. `" $"` and `"$ "` are `invalid_query`. Blank space is allowed only before a segment (`$ .a`, `$ ..a`) and inside brackets, filters and function calls.
- Alternatives: Trim the query before parsing.
- Should the spec pin this? no, the ABNF settles it, but a test row would help.

## C-3: Blank space inside singular-query brackets is accepted
- Spec reference: RFC 9535 2.3.5.1 (`name-segment = "[" name-selector "]"`, no `S`)
- Situation: contradictory
- What I chose: Bracketed selections are parsed generically, so `S` is allowed inside the brackets everywhere, including in singular queries used in comparisons (`@[ 'a' ] == 1` is valid). A query is singular if every segment is a child segment with exactly one name or index selector.
- Alternatives: Reject blank space inside the brackets of singular queries, as the ABNF literally reads.
- Should the spec pin this? yes, the ABNF for singular queries and `bracketed-selection` disagree.

## C-4: Large numbers keep their text, via RawNum
- Spec reference: RFC 9535 2.3.5.2.2, "numbers compare exactly" in Interface
- Situation: missing
- What I chose: The JSON reader keeps an integer beyond 2^53-1, a number that overflows to infinity, or a decimal with more than 15 significant digits as an exact-text value (`RawNum`). Output echoes the original text. Comparison of two such integers is exact (BigInt). Otherwise it compares as doubles. Query literals follow the same rule. Other numbers become JS numbers, so `1.0` is output as `1` and `1e2` as `100`.
- Alternatives: Plain `JSON.parse`, which silently loses precision. Or a full arbitrary-precision decimal type.
- Should the spec pin this? yes, because test authors may use numbers outside the double range.

## C-5: Object member order and duplicate names
- Spec reference: RFC 9535 1.3, 2.3.2.2
- Situation: ambiguous
- What I chose: Objects are read into null-prototype objects, so `__proto__` is an ordinary name. For a duplicate name the last value wins. Wildcard and descendant traversal use JS own-key order, which puts integer-like names (`"1"`) first in ascending order and the rest in insertion order.
- Alternatives: A `Map` that keeps pure insertion order.
- Should the spec pin this? no, the RFC leaves object order unspecified and results compare as unordered per member, but the order of `values`/`paths` could matter to a strict comparer.

## C-6: Invalid I-Regexp makes match()/search() false
- Spec reference: RFC 9535 2.4.6, 2.4.7
- Situation: ambiguous
- What I chose: If the pattern argument is not a string or is not a valid I-Regexp, the result is LogicalFalse. The query is still valid, since it depends on the data. A pattern given as a literal that is invalid is also not rejected at parse time.
- Alternatives: Raise `invalid_query` when a literal pattern is not a valid I-Regexp.
- Should the spec pin this? yes, because 2.1 says well-formedness is independent of the data, which could be read as requiring an error for literal patterns.

## C-7: I-Regexp is checked by my own parser
- Spec reference: RFC 9485 3, 3.1
- Situation: missing
- What I chose: A full ABNF-based checker, which translates a valid pattern to an ECMAScript `u`-flag regexp, with `.` mapped to `[^\n\r]` and the pattern wrapped in `^(?:...)$` for `match()`. `[^]` is rejected. A range quantifier with max < min is rejected. A character class range with hi < lo is rejected. Category names are limited to the grammar's list. Unicode property data comes from the Node runtime, so it follows the Unicode version of Node.
- Alternatives: Pass the pattern straight to the JS engine, which would accept `\d`, lookahead and so on.
- Should the spec pin this? no.

## C-8: Chars NormalChar excludes
- Spec reference: RFC 9485 3 (`NormalChar`)
- Situation: ambiguous
- What I chose: Literal `{`, `}`, `|` (outside its alternation role), `]` and `)` (unbalanced) are rejected, as the ABNF excludes them from `NormalChar`. `^` and `$` outside a class are ordinary literal characters. `[a&&b]` is a valid class of three characters.
- Alternatives: None considered seriously.
- Should the spec pin this? no.

## C-9: Single `!` only
- Spec reference: RFC 9535 2.3.5.1 (`logical-not-op`)
- Situation: ambiguous
- What I chose: Only one `!` is allowed before a test or parenthesized expression (`!!@.a` is invalid, while `!(!@.a)` is valid). `!` before a comparison (`!@.a == 1`) is invalid.
- Alternatives: Accept repeated `!`.
- Should the spec pin this? no, the ABNF is clear.

## C-10: Function-argument typing details
- Spec reference: RFC 9535 2.4.3
- Situation: ambiguous
- What I chose: ValueType parameters accept a literal, a singular query or a ValueType function. NodesType parameters accept any query, but no function call, as no built-in returns NodesType. Function names must be lowercase and directly followed by `(`. Unknown functions and wrong argument counts are `invalid_query`.
- Alternatives: Allow a space between a function name and `(`.
- Should the spec pin this? no.

## C-11: Integer range is checked for index, slice and step only
- Spec reference: RFC 9535 2.1, 2.3.3.1, 2.3.4.1
- Situation: ambiguous
- What I chose: Index, slice start, end and step values outside [-(2^53)+1, 2^53-1] are `invalid_query`. Number literals in comparisons are not range-checked. `-0` is not a valid integer there (the `int` rule), but is a valid number literal.
- Alternatives: Range-check every integer in the query.
- Should the spec pin this? no.

## C-12: Request-level failures that are not in the error list
- Spec reference: Errors
- Situation: missing
- What I chose: An unexpected exception while handling a line (for example, stack exhaustion on an absurdly deep document) yields `{"id": null, "error": "bad_request"}` rather than crashing or skipping the response. Input is decoded as UTF-8 with invalid bytes replaced by U+FFFD.
- Alternatives: A new error code, which the protocol does not allow.
- Should the spec pin this? yes, a deep document may be a legitimate request, and the RFC says the implementation must indicate overflow.

## C-13: Lone surrogates
- Spec reference: RFC 9535 1.3, 2.3.1.1
- Situation: missing
- What I chose: A query with a raw lone surrogate (it can arrive via JSON `\ud800` in the query string) is invalid. Lone surrogates in documents are kept and echoed as `\ud800` escapes. A string's `length()` counts each lone surrogate as one.
- Alternatives: Replace with U+FFFD.
- Should the spec pin this? no.

## C-14: Normalized path escapes
- Spec reference: RFC 9535 2.7
- Situation: ambiguous
- What I chose: Only `'` and `\` plus `\b \f \n \r \t` use short escapes. Other control characters below U+0020 use `\u00xx` in lowercase hex. U+007F and everything above is written unescaped.
- Alternatives: None, the grammar fixes this.
- Should the spec pin this? no.

## C-15: Test command
- Spec reference: REQ-BU-001
- Situation: missing
- What I chose: `node --test tests/*.test.ts`. Node expands the glob itself, so the same string works in cmd.exe and in sh. `build` is the empty string.
- Alternatives: `node --test tests/` fails on Node 22 (it treats the directory as a module).
- Should the spec pin this? no.
