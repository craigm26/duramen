## C-1: Unterminated escape at end of query string
- Spec reference: R7
- Situation: missing
- What I chose: a backslash as the last character of the query (inside an unterminated literal) is `invalid_query`, like any unterminated literal.
- Alternatives: none sensible.
- Should the spec pin this? no, it follows from "unterminated literal".

## C-2: Numbers in output are Decimal text, `-0` loses its sign
- Spec reference: R31.2, DECISIONS 4
- Situation: ambiguous
- What I chose: floats in the request are parsed as `Decimal` and written back with `str(Decimal)`, so `1.5e3` is written `1.5E+3` (JSON-equivalent, exact). Integers are Python ints, so a document `-0` is written `0`. `1e400` is reproduced exactly.
- Alternatives: keep the original number text (needs a custom JSON parser); use floats (loses precision and overflows).
- Should the spec pin this? yes: say whether `-0` must keep its sign. "Compared as parsed JSON" makes `-0` and `0` equal, but a strict checker could differ.

## C-3: Comparison converts numbers to binary64, overflow becomes infinity
- Spec reference: R16.3, R18.5
- Situation: ambiguous
- What I chose: every number (int, Decimal, literal) is converted with `float()`; an int or Decimal too large for binary64 becomes ±infinity, so two huge numbers of the same sign compare equal.
- Alternatives: exact comparison with Decimal.
- Should the spec pin this? no, DECISIONS 3 already pins it. The infinity case follows from it.

## C-4: Invalid UTF-8 or a non-JSON constant in a request line
- Spec reference: R1.2.1
- Situation: missing
- What I chose: a line that is not valid UTF-8, or that holds `NaN`, `Infinity` or `-Infinity`, is "not valid JSON" and gets `{"id":null,"error":"bad_request"}`. A UTF-8 BOM is not skipped, so it is also `bad_request`.
- Alternatives: decode with replacement characters; accept the constants as Python's parser does.
- Should the spec pin this? no, but a line about invalid UTF-8 would help.

## C-5: Lone surrogates in a document
- Spec reference: R1.7, R31.4
- Situation: missing
- What I chose: a document string with a lone surrogate (from a `\ud800` escape) is accepted. Strings are always written with JSON `\u` escapes for non-ASCII characters, so output stays valid UTF-8 and ASCII-only. Paths use the same escaping.
- Alternatives: reject the request; replace with U+FFFD.
- Should the spec pin this? yes. The spec says nothing about it, and the surrogate would otherwise break the UTF-8 output rule.

## C-6: Output escapes all non-ASCII characters
- Spec reference: R1.7
- Situation: ambiguous
- What I chose: output uses `\uXXXX` escapes for all non-ASCII characters (valid UTF-8, as only ASCII is written). Parsed JSON compares equal.
- Alternatives: write raw UTF-8.
- Should the spec pin this? no, since results are compared as parsed JSON.

## C-7: Huge range quantifiers in I-Regexp
- Spec reference: R27, DECISIONS 8
- Situation: ambiguous
- What I chose: the regexp is translated to Python `re`. A quantifier above Python's repeat limit (4294967295), or a pattern `re` cannot compile, makes the I-Regexp count as invalid, so `match`/`search` give false. Very large counts that `re` accepts but cannot finish in reasonable time are not guarded.
- Alternatives: write an own matcher that handles any count.
- Should the spec pin this? yes: "no limit" cannot be met by a host engine. Pin a limit, or say the result is false beyond it.

## C-8: Deep nesting
- Spec reference: none
- Situation: missing
- What I chose: the recursion limit is raised to 20000. A request nested deeper than Python's JSON parser allows is `bad_request`; a query that recurses too deeply (e.g. thousands of nested parentheses) is `invalid_query`.
- Alternatives: iterative parser.
- Should the spec pin this? no.

## C-9: Bare literal as function argument next to logical operators
- Spec reference: R20.4, DECISIONS 13
- Situation: ambiguous
- What I chose: a literal is accepted as an argument only when it is the whole argument. `length(1 && @.a)`, `match(@, 'a' || 'b')` are `invalid_query`. A parenthesised or negated argument counts as a logical-expr argument, so it fails every ValueType/NodesType parameter (`length((@.a))` is invalid, as the spec scenarios say).
- Alternatives: none consistent with the grammar.
- Should the spec pin this? no.

## C-10: Test command uses an unquoted file pattern
- Spec reference: REQ-BU-001
- Situation: ambiguous
- What I chose: `unittest discover -s . -p test_*.py` is unquoted so it works under both `sh` and `cmd.exe`. With one `test_*.py` file in the folder, `sh` expands the glob to that file name, which still works. Keep a single test file.
- Alternatives: quote the pattern (breaks on cmd.exe), or drop `-p` and rely on the default `test*.py`.
- Should the spec pin this? no.

## C-11: Whitespace-only lines that contain other characters
- Spec reference: R1.1, DECISIONS 14
- Situation: ambiguous
- What I chose: lines are split on LF only (not on U+2028, form feed, etc.). A trailing CR is removed, then a line of only space/tab/CR is blank. A form-feed-only line gets `bad_request`.
- Alternatives: `str.splitlines()`, which would split on many more characters.
- Should the spec pin this? no.

## C-12: Name shorthand with non-ASCII characters
- Spec reference: R5
- Situation: ambiguous
- What I chose: any character U+0080 or above is allowed in a shorthand name, including no-break space and U+2028, as R5 says, though R2.2 says they are not blank space. U+007F is not allowed.
- Alternatives: none; this is the grammar.
- Should the spec pin this? no.
