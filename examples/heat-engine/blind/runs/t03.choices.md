## C-1: Number text for RH in clamped summaries
- Spec reference: REQ-WB-003
- Situation: ambiguous
- What I chose: `<rhPercent>` and `<RH>` are written with number text (`String(x)`), so `-0` becomes `0`.
- Alternatives: raw `${x}` (the same except for `-0`, which clamps to 5 anyway).
- Should the spec pin this? no, the spec already points at the number-text edge.

## C-2: Non-finite numbers inside `canonical` values
- Spec reference: edge json/sorted-utf16, OPEN-CJ-001
- Situation: missing
- What I chose: a JSON number beyond binary64 (e.g. `1e400`) parses to Infinity and is written as `null` by `canonical`. In operations it is treated as a non-finite input (`invalid_input`), and in audits it appears as `"Infinity"`.
- Alternatives: reject it with `bad_request`; clamp it to the largest finite value.
- Should the spec pin this? no, it is already OPEN.

## C-3: Blank-line definition
- Spec reference: Driver protocol
- Situation: ambiguous
- What I chose: a line is blank when `String.prototype.trim()` leaves it empty. That strips more than the JSON whitespace set (for example U+00A0). A trailing CR before LF on a request line is accepted as whitespace.
- Alternatives: only space, tab, CR.
- Should the spec pin this? unsure; "white space" is not defined.

## C-4: Output buffering
- Spec reference: OPEN-IF-005
- Situation: missing
- What I chose: read all of stdin, then write all responses at once at the end.
- Alternatives: stream each response as its line arrives.
- Should the spec pin this? no, it is already OPEN.

## C-5: Invalid UTF-8 and duplicate keys
- Spec reference: OPEN-IF-005
- Situation: missing
- What I chose: invalid bytes decode to U+FFFD. For duplicate member names the last one wins (`JSON.parse`).
- Alternatives: reject with `bad_request`.
- Should the spec pin this? no, it is already OPEN.

## C-6: `flagC` when the °F conversion overflows
- Spec reference: OPEN-FL-001
- Situation: missing
- What I chose: the infinite °F value goes through the child `flagF`, which returns a null result with an `invalid_input:wetBulbF` audit. The parent summary then ends in `invalid`, and the parent result is null.
- Alternatives: treat the input as `invalid_input:wetBulbC`.
- Should the spec pin this? no, it is already OPEN.

## C-7: Order of the `bad_request` sub-checks
- Spec reference: Errors, item 3
- Situation: ambiguous
- What I chose: every item-3 failure gives the same code, so order does not matter. A `canonical` request with no `value` member is `bad_request`, while `"value": null` is valid. A `canonical` request does not need or inspect `clock`.
- Alternatives: treat a missing `value` as null.
- Should the spec pin this? yes, "required input field" for `canonical` is only implied.

## C-8: Malformed clock content
- Spec reference: OPEN-IF-003
- Situation: missing
- What I chose: any string is accepted and echoed as `computed_at` without validation.
- Alternatives: `bad_request` for strings not matching the 24-character form.
- Should the spec pin this? no, it is already OPEN.

## C-9: Numbers that are not finite in results
- Spec reference: REQ-WB-001, OPEN-WB-001
- Situation: missing
- What I chose: for huge finite inputs that overflow the formula, the response is written through the canonical serializer, which writes non-finite numbers as `null`.
- Alternatives: an error, or string forms like `"Infinity"`.
- Should the spec pin this? no, it is already OPEN.
