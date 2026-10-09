# Decisions (SPEC-B)

These are the choices that `SPEC-B.md` makes where RFC 9535, RFC 9485 or `protocol.md` leave
the behaviour to the implementation, together with readings of points the texts leave unclear.
Each one is stated normatively in the requirement cited.

1. **Order of object children (R30, R6, R9, R14).** RFC 9535 does not fix the order in which
   object members are visited by the wildcard, filter and descendant segments. Decision: the
   order in which the members appear in the document's JSON text. The order is deterministic,
   so repeated selectors (`$.o[*, *]`) repeat the same order.

2. **Duplicate member names in a document (R31).** RFC 9535 calls this unpredictable.
   Decision: the last occurrence's value is used, at the position of the first occurrence, and
   the name appears once.

3. **Comparing numbers (R18.5, R16.3).** RFC 9535 lets numbers outside the I-JSON
   interoperable range compare in an implementation-specific way. Decision: compare both sides
   as IEEE 754 binary64 values, rounded to nearest. Number literals in filters are not
   range-checked: they are converted the same way, and overflow becomes ±infinity. This is
   never an error.

4. **Reproducing numbers in output (R31.2).** Decision: each number in `values` keeps exactly the
   value it has in the document text, including integers above 2^53 and numbers that do not fit
   in binary64. Reproducing the original number text is recommended.

5. **Overflow indication (RFC 9535 §2.1).** The protocol has no error code for resource or
   overflow problems. Decision: no overflow error is raised. Numbers in documents are passed
   through as in decision 4 and compared as in decision 3.

6. **Invalid regular expressions (R24, R25, R27).** RFC 9535 makes `match()`/`search()`
   return LogicalFalse when the pattern is not a valid I-Regexp. Decision: this holds whether
   the pattern is a literal in the query or comes from the document. An invalid pattern never
   makes the query `invalid_query`. The implementation checks patterns against the full
   I-Regexp grammar, which RFC 9485 recommends but does not require.

7. **XSD constraints outside the I-Regexp ABNF (R27).** Decision: a class range whose start is
   above its end (`[z-a]`) and a quantifier `{n,m}` with `n > m` are invalid I-Regexps, so they
   give LogicalFalse, as in XSD.

8. **Range-quantifier limits (R27, RFC 9485 §8).** RFC 9485 allows implementations to limit
   range quantifiers. Decision: no limit is specified, and every quantifier the grammar allows is
   accepted.

9. **Unicode version for `\p{…}` (R28).** Decision: the Unicode character database of the
   runtime (Python `unicodedata`, the JavaScript engine's `\p` support) is used.

10. **Lone surrogates in the query (R2).** A query is a sequence of Unicode scalar values.
    Decision: a query that contains an unpaired surrogate code point (possible only through a
    `\uD8xx` escape in the JSON request) is `invalid_query`.

11. **Unknown function names (R20).** Decision: only `length`, `count`, `match`, `search` and
    `value` exist. Any other name cannot be typed, so the query is `invalid_query`.

12. **Blank space inside the brackets of singular queries (R17).** Decision: the grammar is
    followed literally. `name-segment` and `index-segment` allow no blank space inside the
    brackets, so `@[ 'a' ] == 1` is `invalid_query`, while `@[ 'a' ]` as an existence test is
    valid.

13. **Classifying function arguments (R20.4).** A bare query fits both `filter-query` and
    `logical-expr` in the grammar. Decision: an argument that is only a query is a query
    argument, one that is only a function call is a function argument, and one that is only a
    literal is a literal argument. Anything else is a logical-expr argument.

14. **Blank lines and CR (R1.1).** `protocol.md` leaves open whether white space other than
    spaces and tabs makes a line blank. Decision: a line made only of spaces, tabs and carriage
    returns is blank and gets no response. A trailing CR is ignored. A line made only of other
    white space is processed and gets `bad_request`.

15. **Extra request members (R1.4).** Decision: members of the request object or of `input`
    other than those the protocol names are ignored.

16. **Short-circuit evaluation (R14.3).** RFC 9535 allows short-circuit or full evaluation of
    `&&` and `||`. Both give the same results, and either is allowed.
