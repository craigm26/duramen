## C-1: U+02CB in dot-notation names
- Spec reference: REQ-SY-002
- Situation: contradictory
- What I chose: the text says any code point from U+0080 up may appear in a `.name`, but the example `$.ˋa` (U+02CB MODIFIER LETTER GRAVE ACCENT) must be `invalid_query`. I accept everything from U+0080 up (surrogates excepted) except U+02CB itself, which is rejected.
- Alternatives: follow the prose only (accept U+02CB, failing the example); or reject by Unicode category (would wrongly reject `😀`, U+0080).
- Should the spec pin this? yes, the example is probably meant to be an ASCII backtick (U+0060), which is invalid under the prose rule; fix the example or state the rule.

## C-2: Reversed ranges and bounds in I-Regexp
- Spec reference: OPEN-OP-006
- Situation: ambiguous
- What I chose: `[z-a]` and `a{3,2}` are not I-Regexps, so `match`/`search` are false.
- Alternatives: accept them and match nothing.
- Should the spec pin this? no, deliberately open.

## C-3: Lone surrogates in a regex pattern
- Spec reference: REQ-RX-001, OPEN-OP-002
- Situation: ambiguous
- What I chose: following the grammar (NormalChar and CCchar exclude U+D800-DFFF), a pattern containing a lone surrogate is not an I-Regexp. Lone surrogates in subject strings and names are handled as ordinary code points.
- Alternatives: allow them as literal characters.
- Should the spec pin this? no, open item.

## C-4: Filter number literals are read as binary64
- Spec reference: REQ-SY-008, OPEN-OP-003
- Situation: missing
- What I chose: a number literal is converted with `float()`. Document numbers keep Python's `int` or `float` and are compared exactly with it. `1e400` becomes infinity and equals nothing in a document.
- Alternatives: convert document integers to binary64 too; exact decimal comparison.
- Should the spec pin this? no, open item.

## C-5: Non-finite or unencodable results
- Spec reference: OPEN-OP-003
- Situation: missing
- What I chose: a request whose parsed document holds a number beyond binary64 (for example `1e400` in the document, read as infinity) cannot be written as JSON. The driver answers `bad_request` for that line rather than writing invalid JSON. Also, request lines containing `NaN`, `Infinity` or `-Infinity` as bare tokens are not JSON and get `bad_request`. All output is ASCII (`\uXXXX` escapes), so it is valid UTF-8.
- Alternatives: clamp to the largest double; write `null`.
- Should the spec pin this? no.

## C-6: Blank lines and line splitting
- Spec reference: Driver protocol
- Situation: ambiguous
- What I chose: input is split on LF only. A line that is empty or only spaces and tabs gets no response. A line with other white space (for example only a CR, or a form feed) is handled as a request and gets `bad_request` with a null id, because it is not a JSON object. A CR before the LF is JSON white space and does not matter. Input bytes that are not valid UTF-8 are decoded with replacement characters.
- Alternatives: treat any white-space-only line as blank.
- Should the spec pin this? no, the spec says it is open.

## C-7: Second selector error order
- Spec reference: Errors, order list
- Situation: ambiguous
- What I chose: `op` missing is `unknown_op` even when `input` is also wrong; an `id` that is not a string gives `bad_request` with a null id before anything else, even if the op is also unknown, as the list orders them.
- Alternatives: none really.
- Should the spec pin this? no, the numbered list already does.

## C-8: Where a function argument is checked
- Spec reference: REQ-SY-010, REQ-SY-011
- Situation: ambiguous
- What I chose: an argument is first parsed as a full logical expression and then checked against the parameter type of its function. A logical-expression argument (comparison, `!`, `&&`, `||`, parentheses) therefore makes the query invalid, as does an unknown function name or a wrong argument count, even when it is nested inside another function or in a part of the query that is never reached for a given document.
- Alternatives: reject earlier in the grammar; the result (`invalid_query`) is the same.
- Should the spec pin this? no.

## C-9: Blank space inside a singular query's brackets
- Spec reference: REQ-SY-009, D-003
- Situation: ambiguous (resolved by D-003)
- What I chose: a bracket counts as singular only when it holds exactly one name or index selector and has no blank space right after `[` or right before `]`. Blank before a segment is fine. Such a query is still valid as a plain test or as a `count`/`value` argument.
- Alternatives: none, D-003 says so.
- Should the spec pin this? no.

## C-10: Regex matching strategy
- Spec reference: REQ-RX-002, OPEN-OP-004
- Situation: missing
- What I chose: my own I-Regexp parser plus a matcher that tracks the set of reachable positions (no backtracking, so `(a*)*b` is not exponential). Repeats stop early once the position set stops changing, so very large counts like `a{1000000000}` finish quickly. Categories come from Python's `unicodedata`, so they follow the Unicode version of the interpreter.
- Alternatives: translate to Python `re` (it has no `\p{..}` and differs on `$`, `.` and so on).
- Should the spec pin this? no.

## C-11: Number representation in output
- Spec reference: REQ-RQ-002
- Situation: missing
- What I chose: values are written back with Python's `json.dumps`, so `1.0` stays `1.0` and `1e0` becomes `1.0`; the spec compares results as parsed JSON, so this is equivalent.
- Alternatives: normalise integral floats to integers.
- Should the spec pin this? no.

## C-12: Duplicate member names in the document
- Spec reference: OPEN-OP-001
- Situation: missing
- What I chose: the last duplicate wins (Python `json.loads`).
- Alternatives: first wins.
- Should the spec pin this? no, open item.
