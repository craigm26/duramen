## C-1: Whitespace-only lines
- Spec reference: REQ-IF-... / OPEN-IF-005 (Driver protocol)
- Situation: ambiguous
- What I chose: lines made only of spaces, tabs and CR are blank and get no response; lines are split on LF only.
- Alternatives: treat any Unicode whitespace as blank; split with str.splitlines.
- Should the spec pin this? no, the spec calls it open.

## C-2: Non-standard JSON literals
- Spec reference: REQ-IF-007
- Situation: missing
- What I chose: bare `NaN`, `Infinity`, `-Infinity` tokens in a request are not JSON, so the line is a `bad_request` with `id` null.
- Alternatives: accept them as Python's parser does by default.
- Should the spec pin this? unsure; a line like `NaN` is plausible test input.

## C-3: Numbers beyond binary64 and invalid UTF-8
- Spec reference: OPEN-CJ-001, OPEN-IF-005
- Situation: missing
- What I chose: `1e400` parses to infinity (so it behaves as a non-finite number in operations and prints as `null` in `canonical`); invalid UTF-8 bytes are replaced with U+FFFD; duplicate keys: last wins.
- Alternatives: reject with bad_request.
- Should the spec pin this? no, open items.

## C-4: Overflow in the flagC path
- Spec reference: OPEN-FL-001
- Situation: missing
- What I chose: if the °F conversion is non-finite, the child audit is an invalid_input audit, the result is null, and the summary shows `wetBulbF=Infinity` style text and flag `white`/`black` is not computed (summary uses "invalid").
- Alternatives: report invalid_input for the whole record.
- Should the spec pin this? no.

## C-5: Result/audit number output
- Spec reference: Driver protocol
- Situation: missing
- What I chose: response lines are written with the same canonical serializer (ECMAScript number text, sorted keys); a non-finite number can never be in a result.
- Alternatives: Python json.dumps.
- Should the spec pin this? no, results compare as parsed JSON.

## C-6: Integer-valued JSON numbers
- Spec reference: REQ-IF-006
- Situation: ambiguous
- What I chose: all JSON numbers parse as floats, so `20`, `20.0`, `2e1` are identical; booleans are rejected as numbers.
- Alternatives: none sensible.
- Should the spec pin this? no.

## C-7: wetBulbF with non-finite tempF
- Spec reference: REQ-WB-005
- Situation: ambiguous
- What I chose: `((tempF-32)*5)/9` is evaluated as is, so NaN/±Infinity propagate and the audit shows the string form of the converted tempC.
- Alternatives: audit the original tempF.
- Should the spec pin this? no, the spec says inputs holds the converted tempC.
