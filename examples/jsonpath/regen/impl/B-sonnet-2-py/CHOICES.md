## C-1: Spec and DECISIONS refer to files that are not present
- Spec reference: SPEC.md preamble (`protocol.md`, `DECISIONS-B.md`, `SPEC-B.md`)
- Situation: missing
- What I chose: Used the Interface section of SPEC.md as the protocol and DECISIONS.md as the decision list. Nothing else was consulted.
- Alternatives: none available (only three input files).
- Should the spec pin this? no, it is only a stale cross-reference; but the spec should not name files that are not shipped.

## C-2: Number representation and output
- Spec reference: R31.2, DECISIONS 3/4
- Situation: ambiguous (original text "recommended", JSON-equivalent spellings "acceptable")
- What I chose: Document numbers are parsed into a `Num` object that keeps the original text (reproduced verbatim in `values`, e.g. `1.5e3`, `-0`, `12345678901234567890`) and a binary64 value (`float(text)`, overflow gives infinity) used for all comparisons.
- Alternatives: normalise to Python int/float (loses big integers and precision).
- Should the spec pin this? no, the spec already allows both; unsure whether a checker compares `1.5e3` and `1500` equal (it says "compare exactly").

## C-3: Length and count results are numbers built from integers
- Spec reference: R22, R23
- Situation: missing (which numeric type `length`/`count` return)
- What I chose: They return a `Num` with the integer's decimal text, so they compare by binary64 value with other numbers (`length(@) == 1.0` is true).
- Alternatives: Python int (would need special-casing in comparisons).
- Should the spec pin this? no.

## C-4: Non-UTF-8 input lines
- Spec reference: Interface (driver protocol), R1.2
- Situation: missing
- What I chose: A line that is not valid UTF-8 is answered `{"id":null,"error":"bad_request"}`, the same as invalid JSON. Lines are split on LF only; a U+2028 or other separator inside a line does not split it.
- Alternatives: decode with replacement characters and continue.
- Should the spec pin this? yes, cheap to state.

## C-5: Non-standard JSON in requests
- Spec reference: R1.2.1
- Situation: ambiguous ("not valid JSON")
- What I chose: `NaN`, `Infinity` and `-Infinity` (accepted by Python's parser by default) are rejected as invalid JSON. Control characters inside strings are rejected (Python strict mode). A lone surrogate escape in a *document* string is accepted and re-emitted as an escape (`\ud800`), since output strings are written with ASCII escapes only; a lone surrogate in the *query* is `invalid_query`.
- Alternatives: accept NaN/Infinity; reject lone surrogates in documents.
- Should the spec pin this? yes, for lone surrogates in document strings.

## C-6: Output string encoding
- Spec reference: R1.7
- Situation: missing (escape policy for output strings)
- What I chose: All output strings use `\uXXXX` escapes for non-ASCII, so stdout is pure ASCII (hence valid UTF-8, no CR, no stray characters). Decoded they are identical to the expected values.
- Alternatives: raw UTF-8 output.
- Should the spec pin this? no, results are compared as parsed JSON.

## C-7: Trailing CR stripping
- Spec reference: R1.1
- Situation: ambiguous ("a carriage return at the end of a line SHALL be ignored")
- What I chose: All trailing CR characters are stripped before processing; a CR inside a line is left to the JSON parser (where it is legal white space between tokens).
- Alternatives: strip exactly one.
- Should the spec pin this? no.

## C-8: Bare literal as a function argument
- Spec reference: R13.4, R20.4, Appendix A (`function-argument = literal / filter-query / logical-expr / function-expr`)
- Situation: ambiguous
- What I chose: A literal is accepted as a function argument only on its own (`length('ab')`, `match(@, 'a')`). Inside a logical operator (`&&`, `||`, `!`) or in a test position, a literal is an error, so `f(1 && @.a)` is `invalid_query`. A parenthesised expression argument is a logical-expr argument (`length((@.a))` is a type error per the spec scenario).
- Alternatives: treat literals as truthy in logical positions.
- Should the spec pin this? no, follows from R13.4 and R21.

## C-9: Type check order versus syntax errors
- Spec reference: R20, R21, DECISIONS 11
- Situation: ambiguous (nothing observable)
- What I chose: Function names, arity and argument types are checked right after the call is parsed; every failure is `invalid_query`. Argument type checks happen even for unknown function names being rejected first. All failures give the same error code, so the order is unobservable.
- Alternatives: separate pass after parsing.
- Should the spec pin this? no.

## C-10: Duplicate keys and key order with the host JSON parser
- Spec reference: R30, R31.3
- Situation: clear, noted for completeness
- What I chose: Python's `json` keeps first-position/last-value for duplicate keys and document order, matching R31.3, so no custom object hook was needed. Integer-like keys keep document order (dicts).
- Alternatives: custom parser.
- Should the spec pin this? no.

## C-11: Regex quantifier size
- Spec reference: R27, DECISIONS 8
- Situation: missing (limit)
- What I chose: No limit. A repeat count longer than 30 digits is clamped to 10^30 (unobservable in practice). Matching uses a position-set simulation on the parsed regexp, so there is no exponential backtracking and huge counts such as `a{100000000}` terminate as soon as no more progress is possible.
- Alternatives: translate to Python `re` (would need limits, and `\p` expansion).
- Should the spec pin this? no.

## C-12: Deep nesting
- Spec reference: none
- Situation: missing
- What I chose: The driver runs on a thread with a 256 MB stack and a high recursion limit. A query or request that still exceeds recursion is `invalid_query` (query) or `bad_request` (request line).
- Alternatives: iterative parsers.
- Should the spec pin this? unsure, a limit on nesting depth would help implementers.

## C-13: Integer syntax with huge digit strings
- Spec reference: R10, R12
- Situation: ambiguous (is an out-of-range integer reported before other syntax problems?)
- What I chose: Any index/slice integer outside ±(2^53−1), including one with more than 25 characters, is `invalid_query` as soon as it is read. Since all failures share one code, order is unobservable.
- Alternatives: none relevant.
- Should the spec pin this? no.

## C-14: Whitespace around `?` and inside filters inside nested brackets
- Spec reference: R2.3, R13.1
- Situation: ambiguous (blank space after `!` and before `(` etc.)
- What I chose: Followed the Appendix A grammar literally: blank space after `?`, after `!`, after `(`, before `)`, around `&&`, `||`, comparison operators and function-call commas and parentheses contents; none between a function name and `(`.
- Alternatives: none.
- Should the spec pin this? no.
