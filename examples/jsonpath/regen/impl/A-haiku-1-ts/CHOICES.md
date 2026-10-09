# Choices

Each entry records a point where SPEC.md or RFC 9535 / RFC 9485 was silent, ambiguous, or
contradictory, and what the implementation does about it.

## C-1: Which lines are blank
- Spec reference: Driver protocol (blank lines, "whether other white space makes a line blank is open")
- Situation: ambiguous
- What I chose: a line is blank when, after removing one trailing CR, it holds only spaces and tabs (or nothing). A line holding only other white space (for example form feed or a non-breaking space) is not blank and gets `bad_request`.
- Alternatives: treat every JSON white-space character (space, tab, CR, LF) as blank; treat every Unicode white space as blank.
- Should the spec pin this? yes: it decides whether a response line appears, which the judge can observe.

## C-2: Line endings on input
- Spec reference: Driver protocol (one JSON object per line; output lines end with LF)
- Situation: missing
- What I chose: lines are split on LF only. One trailing CR is removed before parsing, so CRLF input works. A CR anywhere else is ordinary JSON white space.
- Alternatives: split on CR and LF both; reject CR outright.
- Should the spec pin this? unsure: CRLF input is unlikely, but the spec says nothing about it.

## C-3: A final line with no LF
- Spec reference: Driver protocol (every non-blank line gets one response)
- Situation: missing
- What I chose: text left after the last LF is handled as a line when input ends, so it still gets a response.
- Alternatives: ignore an unterminated final line.
- Should the spec pin this? no: the "every non-blank line" rule already implies it.

## C-4: Byte order mark
- Spec reference: Driver protocol (requests are JSON objects); the spec does not mention a byte order mark
- Situation: missing
- What I chose: a leading U+FEFF is not skipped, so the line is `bad_request` with id null.
- Alternatives: skip a leading BOM, as RFC 8259 allows.
- Should the spec pin this? unsure: the judge probably sends no BOM, but the rule should be stated if it does.

## C-5: Invalid UTF-8 on standard input
- Spec reference: Driver protocol (standard output is UTF-8; input encoding is not stated)
- Situation: missing
- What I chose: input is decoded as UTF-8 and malformed sequences become U+FFFD, which is then processed like any other character.
- Alternatives: reject the line with `bad_request`.
- Should the spec pin this? unsure.

## C-6: Number text and exact comparison
- Spec reference: Driver protocol ("numbers compare exactly"); RFC 9535 section 2.3.5.2.2
- Situation: missing (the spec does not say what text a number is written as on output)
- What I chose: each number keeps its source text, and output reproduces that text (`1.50`, `1E5`, `-0`). Numbers are compared as exact decimals (sign, digits, power of ten), so `12345678901234567890` and `12345678901234567891` differ, and `1` equals `1.0` and `1e0`. Results of `length()` and `count()` are written as plain integers.
- Alternatives: parse to IEEE doubles (loses precision above 2^53); normalise output (`1.50` to `1.5`).
- Should the spec pin this? yes: the choice changes output text, and a judge comparing text (rather than parsed values) would see the difference.

## C-7: Duplicate member names in the document
- Spec reference: RFC 9535 section 1.3 (behaviour is unpredictable for duplicate names)
- Situation: ambiguous
- What I chose: a repeated name keeps the position of its first occurrence and takes the value of its last occurrence (the same as JavaScript objects).
- Alternatives: keep the first value; reject the document.
- Should the spec pin this? yes: a judge's expected output depends on it.

## C-8: Member order for objects
- Spec reference: RFC 9535 section 2.3.2.2 and 2.3.5.2 (order of object children not stipulated); Driver protocol (member order does not matter)
- Situation: ambiguous
- What I chose: children of an object are visited and emitted in the order their names appear in the document.
- Alternatives: sorted names; the order of a JavaScript object (integer-like names first).
- Should the spec pin this? no: the RFC leaves this open and the spec says member order does not matter, so a judge should not depend on it.

## C-9: Literal numbers and operands outside the I-JSON range
- Spec reference: RFC 9535 section 2.1 (validity: integers relevant to processing must be in range)
- Situation: ambiguous
- What I chose: only index and slice integers (index, start, end, step) are range-checked against [-(2^53)+1, (2^53)-1]. Number literals in comparisons and function arguments are not range-checked, and their exact value is used.
- Alternatives: range-check every number literal; check only the integers the RFC names explicitly.
- Should the spec pin this? yes: it decides whether a query like `$[?@ == 1e400]` is valid.

## C-10: Unknown function names
- Spec reference: RFC 9535 section 2.4 and 3.2 (function extensions and the registry)
- Situation: missing
- What I chose: only the five functions in RFC 9535 Table 19 exist. Any other name, or a wrong argument count, is `invalid_query`.
- Alternatives: accept any name and treat it as a function that returns LogicalFalse.
- Should the spec pin this? yes: the spec should list the functions the driver must know.

## C-11: Function arguments that could parse more than one way
- Spec reference: RFC 9535 Appendix A (`function-argument = literal / filter-query / logical-expr / function-expr`, which overlap)
- Situation: ambiguous
- What I chose: a literal followed directly by `,` or `)` is a literal argument. Any other argument is parsed as a logical expression, and a lone query or function call keeps its own kind. Well-typedness (RFC 9535 section 2.4.3) then decides whether the argument fits the parameter.
- Alternatives: a different precedence between the alternatives would change which queries are valid.
- Should the spec pin this? no: section 2.4.3 defines the rules that settle it.

## C-12: I-Regexp automaton size limit
- Spec reference: RFC 9485 section 8 (implementations may limit range quantifiers, and must detect excessive resource use)
- Situation: missing
- What I chose: a pattern whose automaton would have more than 20,000 states is treated as not an I-Regexp, so `match()` and `search()` return LogicalFalse for it. The limit is checked while the automaton is built, so the cost is bounded.
- Alternatives: no limit (memory and time grow with the pattern); a smaller limit.
- Should the spec pin this? yes: a valid pattern that the driver refuses changes results.

## C-13: I-Regexp matching algorithm
- Spec reference: RFC 9485 section 4 (Boolean results as in XSD) and section 8 (linear-time implementations are encouraged)
- Situation: missing
- What I chose: the pattern is compiled to a Thompson NFA and simulated over the input, so matching never backtracks. Compiled patterns are cached (cleared when 500 are held).
- Alternatives: translate to a JavaScript `RegExp` (simpler, but exposed to exponential backtracking).
- Should the spec pin this? no: the RFC asks only for Boolean results.

## C-14: Range quantifiers with minimum above maximum
- Spec reference: RFC 9485 section 3 (Figure 1 syntactically accepts `{m,n}` with m > n); RFC 9485 section 4 (Boolean results as specified in XSD, which is not included)
- Situation: ambiguous
- What I chose: `a{3,2}` is not an I-Regexp, so the pattern gives LogicalFalse. A repetition whose minimum exceeds its maximum has no sensible meaning.
- Alternatives: accept it and match nothing.
- Should the spec pin this? yes: the grammar accepts it, and the semantics that would settle it are defined by a document the spec does not include.

## C-15: Lone surrogates
- Spec reference: RFC 9535 section 1.1 (query text is a sequence of scalar values); RFC 9535 section 1.3 (behaviour is unpredictable for surrogates in strings)
- Situation: ambiguous
- What I chose: a lone surrogate in the query text is `invalid_query`. In document or request strings it is kept as is, and output escapes it as `\udXXX` so the line stays valid JSON.
- Alternatives: reject lines that contain lone surrogates.
- Should the spec pin this? unsure: it does not come up in ordinary input.

## C-16: Deep nesting and unexpected internal errors
- Spec reference: RFC 9535 section 4.1 (implementations need resource management)
- Situation: missing
- What I chose: no explicit depth limit. The JSON parser and the evaluator recurse with the nesting. Documents nested 500 levels deep are tested. Past the JavaScript stack limit I expect a `RangeError` that is not caught, so the driver would stop with a non-zero status. I did not measure where that limit falls. Internal errors other than the two spec error families are not caught.
- Alternatives: an iterative parser; a depth limit mapped to `bad_request`; catching all exceptions and answering `bad_request`.
- Should the spec pin this? yes: the spec needs an error code for resource exhaustion, or a stated depth limit.

## C-17: Test command and package.json
- Spec reference: REQ-BU-001 (REGEN.json), REQ-BU-002 (the test command must pass), REQ-BU-003 (no dependencies)
- Situation: missing
- What I chose: `test` is `node --test "**/*.test.ts"`. The glob is quoted, so Node expands it on Windows and Linux alike, and it does not depend on which default patterns a given Node version uses (on 22.22 a bare `node --test` finds the same files). `package.json` sets `"type": "module"` and a matching `test` script and declares no dependencies.
- Alternatives: list the test files explicitly; no package.json (`.ts` files then depend on Node's syntax detection).
- Should the spec pin this? no.

## C-18: Output escaping of ids and paths
- Spec reference: Driver protocol (JSON output, one line)
- Situation: missing
- What I chose: ids and normalized paths are written with `JSON.stringify`, which escapes controls, quotes and backslashes and leaves other characters as UTF-8.
- Alternatives: escape every non-ASCII character.
- Should the spec pin this? no: any valid JSON string escaping compares equal once parsed.
