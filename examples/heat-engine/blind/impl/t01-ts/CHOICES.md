## C-1: Audit key order is sorted, not listed order
- Spec reference: REQ-AU-001, REQ-WB-003
- Situation: ambiguous
- What I chose: the audit string is canonical JSON, so keys (including `constants`) are sorted by UTF-16 order, not in the order the spec lists them (e.g. `rh_clamp_max` comes before `stull_a`).
- Alternatives: keep the spec's listed order inside `constants`.
- Should the spec pin this? yes, the REQ-WB-003 example lists constants in non-sorted order, which looks like it contradicts the canonical edge.

## C-2: Non-finite numbers inside `canonical`
- Spec reference: OPEN-CJ-001
- Situation: missing
- What I chose: JSON numbers beyond binary64 (e.g. `1e400`) parse to Infinity and are written as `null`.
- Alternatives: error, or write the string "Infinity".
- Should the spec pin this? no, it is already open.

## C-3: `canonical` without `value`
- Spec reference: REQ-CJ-005
- Situation: missing
- What I chose: a missing `input.value` is `bad_request`.
- Alternatives: treat as null.
- Should the spec pin this? unsure; a one-line rule would do.

## C-4: Request line handling
- Spec reference: OPEN-IF-005
- Situation: missing
- What I chose: all of stdin is read, split on LF only, then answered in order; a trailing CR is ordinary JSON whitespace. Invalid UTF-8 is replaced by U+FFFD; duplicate member names: last wins (JSON.parse).
- Alternatives: streaming per line.
- Should the spec pin this? no, deliberately open.

## C-5: Overflow in the °C flag path
- Spec reference: OPEN-FL-001
- Situation: missing
- What I chose: if the converted °F is non-finite, the result is `null` and the summary ends with `invalid_input:wetBulbF`; the child audit is the invalid `flagF` audit.
- Alternatives: treat as invalid_input:wetBulbC.
- Should the spec pin this? no, it is already open.

## C-6: Inherited property names as fields
- Spec reference: REQ-IF-007
- Situation: missing
- What I chose: only own properties count as present input fields and operations (so `op: "toString"` is `unknown_op`).
- Alternatives: none sensible.
- Should the spec pin this? no.

## C-7: Error check for `canonical` input
- Spec reference: Errors list
- Situation: ambiguous
- What I chose: `canonical` still needs `input` to be an object (then `value`); `clock` is not required for it.
- Alternatives: accept any input shape.
- Should the spec pin this? no, the list already implies it.
