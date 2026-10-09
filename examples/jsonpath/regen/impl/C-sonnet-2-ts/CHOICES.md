## C-1: U+02CB in dot-notation names
- Spec reference: REQ-SY-002
- Situation: contradictory
- What I chose: REQ-SY-002 says a shorthand name may use any code point from U+0080 up, but its table lists `$.ˋa` (U+02CB, a modifier letter) as `invalid_query`. I follow the prose for every code point except U+02CB, which I refuse.
- Alternatives: follow the prose alone, so that table row fails. Refuse a whole class of code points (such as modifier letters). I found no rule that rejects U+02CB while accepting U+0080, `é` and `😀`.
- Should the spec pin this? yes, the row looks like a typo for the backtick U+0060 (which is rejected anyway), or else the prose is missing a rule.

## C-2: Lone surrogates in the query or the document
- Spec reference: OPEN-OP-002
- Situation: ambiguous
- What I chose: a raw lone surrogate in a query string literal is kept as is. In a document it is compared by code point, and `length()` counts it as one. In a regex pattern it makes the pattern not an I-Regexp.
- Alternatives: reject lone surrogates in the query.
- Should the spec pin this? no, it is declared open.

## C-3: Character class ranges and quantifier bounds in the wrong order
- Spec reference: OPEN-OP-006
- Situation: ambiguous
- What I chose: `[z-a]` and `a{3,1}` are not I-Regexps, so `match()` and `search()` give false.
- Alternatives: accept them and match nothing.
- Should the spec pin this? no, it is declared open.

## C-4: Blank lines and line endings in the request stream
- Spec reference: Driver protocol
- Situation: ambiguous
- What I chose: a line of only spaces and tabs gets no response. A line with other white space (such as a lone CR) is parsed as JSON and, if that fails, gets `bad_request`. A trailing CR on a request line is accepted as JSON white space. The last line is handled even with no final LF. Lines are split only on LF, so U+2028 inside a line does not split it.
- Alternatives: treat any whitespace-only line as blank.
- Should the spec pin this? no, the spec says it is open.

## C-5: `invalid_query` is decided by the parser only
- Spec reference: REQ-RQ-004, REQ-SY-010, REQ-SY-011
- Situation: ambiguous
- What I chose: the query is parsed and type-checked in one pass. A function argument is a literal, a query or a function expression, and a logical expression there is rejected. Function names are looked up only among the five defined ones (`Object.hasOwn`), so `constructor` is an unknown function.
- Alternatives: parse logical expressions as arguments and reject them in a separate type-check pass. The result is the same.
- Should the spec pin this? no.

## C-6: Number literals and document numbers
- Spec reference: REQ-SY-008, OPEN-OP-003
- Situation: missing
- What I chose: number literals are read with `Number()`, so `1e400` becomes Infinity and `9007199254740993` rounds to 9007199254740992. Equality and order use binary64 values. `-0` equals `0`. Results are written with `JSON.stringify`, so `-0` prints as `0`.
- Alternatives: exact decimal comparison.
- Should the spec pin this? no, it is declared open.

## C-7: Deep nesting
- Spec reference: OPEN-OP-004
- Situation: missing
- What I chose: evaluation and parsing are recursive, with no depth limit. A very deep document or query can overflow the stack. The driver then crashes instead of answering.
- Alternatives: catch RangeError and answer with an error code, but the spec defines no such code.
- Should the spec pin this? no, it is declared open.

## C-8: Which requests count as `bad_request` for `input`
- Spec reference: Errors, items 1-3
- Situation: ambiguous
- What I chose: `input.document` counts as present when `input` has an own member named `document`, even if its value is `null`. A top-level `id` of any non-string type gives `"id": null` in the response, as the spec's examples show. Once `id` is a string it is echoed in every later error, including `unknown_op` and `bad_request`.
- Alternatives: none that fit the examples.
- Should the spec pin this? no.

## C-9: Regex implementation
- Spec reference: REQ-RX-001 to REQ-RX-006
- Situation: missing
- What I chose: I validate the I-Regexp grammar myself, then translate the pattern to a JavaScript `RegExp` with the `u` flag. `.` becomes `[^\n\r]`, `match()` anchors with `^(?:...)$`, and `\p{..}` uses JavaScript's built-in Unicode properties (including `Cn`). Compiled patterns are cached.
- Alternatives: write a matcher by hand. It would avoid catastrophic backtracking but would be much longer.
- Should the spec pin this? no.

## C-10: Singular check covers blank space only inside brackets
- Spec reference: REQ-SY-009, D-003
- Situation: ambiguous
- What I chose: a bracket is singular only if it holds one name or index selector with no blank space right after `[` or right before `]`. Blank space before a segment (`@ .b [0]`) is allowed. A `..` segment, a wildcard, a slice and a filter are never singular.
- Alternatives: none; this follows D-003.
- Should the spec pin this? no.
