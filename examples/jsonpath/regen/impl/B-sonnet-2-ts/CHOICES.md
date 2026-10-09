## C-1: REGEN.json test command uses a glob, not a folder
- Spec reference: REQ-BU-001, REQ-BU-002
- Situation: missing
- What I chose: `node --test "tests/*.test.ts"`. Node 22 treats a bare directory argument as a file and fails. Node expands the quoted glob itself, so it works under cmd.exe and sh.
- Alternatives: `node --test` with no arguments (relies on version-specific default discovery of `.ts` tests); a shell glob (not portable to Windows).
- Should the spec pin this? no, the implementer's tooling is its own business.

## C-2: package.json is present, with scripts only
- Spec reference: REQ-BU-003
- Situation: missing
- What I chose: a minimal `package.json` (`"type": "module"`, `npm test` script, no dependency fields) so that `npm test` works.
- Alternatives: no package.json (then `npm test` fails and `.ts` module typing is left to Node's detection).
- Should the spec pin this? no.

## C-3: Document numbers are kept as raw text
- Spec reference: R31.2, DECISIONS 4
- Situation: ambiguous ("JSON-equivalent spellings are acceptable")
- What I chose: a custom JSON parser keeps each number's original text and its binary64 value. Output reproduces the text verbatim (`1.5e3` stays `1.5e3`, `-0` stays `-0`). Comparisons use the binary64 value.
- Alternatives: normalize to JS number formatting (loses big integers).
- Should the spec pin this? no. Results are compared as parsed JSON, so either works.

## C-4: Rules for classifying function arguments
- Spec reference: R20.4, DECISIONS 13
- Situation: ambiguous
- What I chose: an argument is parsed as a full logical expression. A bare literal, bare query or bare function call keeps its kind. Anything else, including a parenthesised query such as `(@.a)` and a negated query, is a logical-expr argument. No function takes a LogicalType parameter, so `length((@.a))` is invalid, as the spec says.
- Alternatives: unwrap redundant parentheses.
- Should the spec pin this? no, the scenarios already cover it.

## C-5: Literals inside logical combinations
- Spec reference: R13.4
- Situation: ambiguous for `$[?1 && @.a]`
- What I chose: a bare literal, or a ValueType function, used as an operand of `&&`, `||`, `!`, a parenthesis or the filter itself is `invalid_query`. This holds whether or not the literal sits inside a function argument.
- Alternatives: none sensible.
- Should the spec pin this? no.

## C-6: Whitespace line handling
- Spec reference: R1.1
- Situation: ambiguous (the protocol leaves it open, DECISIONS 14 closes it)
- What I chose: a line is blank only if it holds just space, tab or CR. A form feed or other whitespace line gets `bad_request` with `id` null. Lines are split on LF bytes and decoded as UTF-8 with replacement characters. A leading BOM makes the line a `bad_request`.
- Alternatives: strip a BOM.
- Should the spec pin this? unsure; BOM and invalid UTF-8 behaviour is unspecified.

## C-7: Limit on nesting depth
- Spec reference: none
- Situation: missing
- What I chose: filter-expression nesting deeper than 500 levels is reported as `invalid_query`, so the parser cannot overflow the stack. A very deeply nested document (many thousands of levels) in a request overflows the JSON parser's recursion. That throws, and the process would crash. I did not guard this.
- Alternatives: iterative parsing; mapping the overflow to `bad_request`.
- Should the spec pin this? yes, "never errors" and resource limits conflict for extreme inputs.

## C-8: Regexp backtracking
- Spec reference: R27, R28, DECISIONS 8
- Situation: missing
- What I chose: a validated I-Regexp is translated to a JS `RegExp` with the `u` flag, as Appendix D suggests. Pathological patterns such as `(a*)*b` can take exponential time because the JS engine backtracks. I did not write an NFA matcher.
- Alternatives: own NFA/DFA matcher with linear-time guarantee.
- Should the spec pin this? unsure; a time limit would matter for adversarial tests.

## C-9: `\p{Cs}` is rejected
- Spec reference: R27 grammar vs Appendix C
- Situation: contradictory
- What I chose: the grammar's `charProp` lists `C` followed by c, f, n or o, with no `s`, while Appendix C lists `Cs`. I followed the normative ABNF, so `\p{Cs}` is an invalid I-Regexp and `match`/`search` give LogicalFalse.
- Alternatives: accept `Cs` (it can never match in a valid string anyway).
- Should the spec pin this? yes.

## C-10: Singular-query tightness check
- Spec reference: R17, DECISIONS 12
- Situation: ambiguous in detail
- What I chose: a bracket segment counts as singular only if it holds exactly one name or index selector with no blank space after `[` or before `]`. Blank space before a segment is allowed (`@.a [0]`). A `.name` segment is always singular.
- Alternatives: none; this follows the grammar.
- Should the spec pin this? no.

## C-11: Number literal cut-off in filters
- Spec reference: R16
- Situation: ambiguous
- What I chose: a number is scanned greedily as int, optional fraction, optional exponent. `1.` and `1e` stop at the `.` or `e`, which then fails to parse, so the query is invalid. Keywords are read as `[a-z][a-z0-9_]*`, so `nullx` and `true1` are not literals.
- Alternatives: none material.
- Should the spec pin this? no.

## C-12: Unknown function names and name syntax
- Spec reference: R20, DECISIONS 11
- Situation: ambiguous
- What I chose: any lowercase identifier followed immediately by `(` is read as a call. If it is not one of the five functions, the query is invalid. An uppercase or leading-underscore name never starts a call, so it fails to parse. Either way the result is `invalid_query`.
- Alternatives: none.
- Should the spec pin this? no.

## C-13: Stdout flushing
- Spec reference: R1.7
- Situation: ambiguous
- What I chose: output is written once per received stdin chunk (all complete lines in that chunk), and the last line is flushed at end of input. A response may therefore wait until the rest of its chunk has been processed.
- Alternatives: write after each line.
- Should the spec pin this? no.
