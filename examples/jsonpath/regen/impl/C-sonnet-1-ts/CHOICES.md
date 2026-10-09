## C-1: U+02CB in dot-notation names
- Spec reference: REQ-SY-002
- Situation: contradictory
- What I chose: the prose lets a name start with any code point from U+0080 up, but the example `$.ˋa` (U+02CB, MODIFIER LETTER GRAVE ACCENT) must give `invalid_query`. I follow the example: U+02CB alone is refused in dot names; every other code point from U+0080 up is accepted.
- Alternatives: accept U+02CB (follows the prose, fails the example); refuse the whole Sk category or all non-letters (would reject code points the prose accepts).
- Should the spec pin this? yes, the rule and the example disagree. If the example's character was meant to be something else (such as a backtick), the example is wrong.

## C-2: Blank lines in the driver protocol
- Spec reference: Driver protocol
- Situation: ambiguous
- What I chose: a line is blank (no response) only if empty or made of spaces and tabs. Any other line goes through the JSON parse, so a CR-only line gets `bad_request` with a null id. Lines are split on LF only; a trailing CR is JSON whitespace.
- Alternatives: also treat CR, LF, FF or other whitespace as blank.
- Should the spec pin this? no, the spec calls it open.

## C-3: Last line without a final LF
- Spec reference: Driver protocol
- Situation: missing
- What I chose: at end of input, leftover text without a trailing LF is handled as a request line.
- Alternatives: drop it.
- Should the spec pin this? no.

## C-4: Responses are streamed per line
- Spec reference: Driver protocol, Properties ("a request may use an earlier response")
- Situation: ambiguous
- What I chose: each response is written as soon as its line has been read, not after end of input, so a client that waits for each response works.
- Alternatives: read all input, then answer.
- Should the spec pin this? no.

## C-5: Request validity beyond the listed checks
- Spec reference: Errors
- Situation: ambiguous
- What I chose: `input` that is an array or `null` is "not an object" (`bad_request`). `document` counts as present if the member exists, even if it is `null`. Duplicate member names in the request line follow JSON.parse (last wins).
- Alternatives: none worth taking.
- Should the spec pin this? no.

## C-6: Regular expressions are translated to JavaScript RegExp
- Spec reference: REQ-RX-001 to REQ-RX-006
- Situation: missing (the spec does not say how to match)
- What I chose: validate the pattern with a parser of the RFC 9485 grammar, then emit an equivalent JavaScript `u`-flag RegExp. `.` becomes `[^\n\r]`, every literal becomes a `\u{...}` escape, `\p{X}` and `\P{X}` use JavaScript's General_Category support, `match` anchors with `^(?:...)$`. Category data comes from the Node.js Unicode version (OPEN-OP-005).
- Alternatives: write a backtracking or NFA matcher with own Unicode tables (bigger, and no gain).
- Should the spec pin this? no.

## C-7: Out-of-order bounds and ranges
- Spec reference: OPEN-OP-006
- Situation: ambiguous (open)
- What I chose: `[z-a]` and `a{3,2}` are not I-Regexps, so `match` and `search` are false for them.
- Alternatives: accept them and match nothing.
- Should the spec pin this? no, the spec leaves it open.

## C-8: Lone surrogates
- Spec reference: OPEN-OP-002
- Situation: ambiguous (open)
- What I chose: lone surrogates in the query's dot names or I-Regexps are treated as ordinary code points (in an I-Regexp NormalChar excludes the surrogate range, so such a pattern is not an I-Regexp). Lone surrogates in documents are kept as JavaScript strings and compared by code unit value.
- Alternatives: reject them.
- Should the spec pin this? no.

## C-9: Number comparison and output
- Spec reference: OPEN-OP-003, REQ-RQ-002
- Situation: ambiguous (open)
- What I chose: all numbers are JavaScript doubles; literals like `1e400` become Infinity and compare as such. Output uses JSON.stringify, so `-0` is written `0` and `1.0` as `1`. Duplicate member names in a document follow JSON.parse (last wins).
- Alternatives: arbitrary-precision numbers.
- Should the spec pin this? no.

## C-10: Descendant traversal of objects, and deep nesting
- Spec reference: REQ-SE-007, OPEN-OP-004
- Situation: ambiguous
- What I chose: the descendant walk uses an explicit stack (pre-order, name order for objects) so deep documents do not overflow the call stack. The filter and regex evaluators recurse with query depth; no limits are set.
- Alternatives: recursion everywhere.
- Should the spec pin this? no.

## C-11: Nodelist arguments given a singular or function argument
- Spec reference: REQ-SY-011
- Situation: ambiguous
- What I chose: for `count` and `value`, any query (`@` or `$` with any segments) is accepted; a literal, a function expression or a parenthesized expression is not. For `length`, `match`, `search`, a query argument must be singular in the REQ-SY-009 sense (so `@[ 'a' ]` is invalid there, per D-003).
- Alternatives: accept a query that merely selects at most one node.
- Should the spec pin this? no.

## C-12: Function name followed by blank space and literal words
- Spec reference: REQ-SY-010
- Situation: ambiguous
- What I chose: an identifier in a filter is a function call only if `(` follows at once. `true`, `false` and `null` are literals unless followed at once by `(`, in which case they are unknown function names and the query is invalid. Any other lower-case word is invalid.
- Alternatives: none.
- Should the spec pin this? no.

## C-13: Test for REQ-BU-* checks inside the suite
- Spec reference: REQ-BU-001 to REQ-BU-004
- Situation: missing
- What I chose: `REGEN.json` has `build` empty and `test` set to `node --test`; the suite checks the folder-level rules (keys, no dependencies, source size) itself.
- Alternatives: none.
- Should the spec pin this? no.

## C-14: Tests sample the spec instead of copying every row
- Spec reference: none
- Situation: missing
- What I chose: the tests cover every MUST and most example rows by hand; the three PROPs are checked on a few fixed documents, not generated ones. The EV-EV-RFC table was cut off in SPEC.md ("The first 8"), so only those 8 rows (and a few from other sections) are tested.
- Alternatives: a generator.
- Should the spec pin this? no. But the spec states "the suite checks all 43 rows" and lists only 8; the missing 35 are not in the file.
