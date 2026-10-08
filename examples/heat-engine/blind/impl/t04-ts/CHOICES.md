## C-1: Whitespace-only lines other than spaces/tabs
- Spec reference: Driver protocol (blank lines)
- Situation: ambiguous
- What I chose: only empty or space/tab lines are blank (no response). A line such as `\r` gets a `bad_request` with `id` null. A trailing `\r` after JSON (CRLF input) is accepted as JSON whitespace.
- Alternatives: treat all whitespace (including CR, form feed) as blank.
- Should the spec pin this? no, it is already marked open.

## C-2: Arrays as `input`
- Spec reference: Errors, step 3
- Situation: ambiguous
- What I chose: an array (or null) is "not an object", so `bad_request`.
- Alternatives: accept arrays as objects.
- Should the spec pin this? no, JSON's object type is clear enough.

## C-3: `canonical` with a non-object `input`
- Spec reference: REQ-CJ-005, Errors
- Situation: ambiguous
- What I chose: `input` must still be an object, and `value` must be a member of it (even if `null`). Otherwise `bad_request`. `clock` is not required and is ignored.
- Alternatives: none seriously.
- Should the spec pin this? no.

## C-4: Non-string `clock` on `canonical`
- Spec reference: Errors step 3
- Situation: ambiguous
- What I chose: `canonical` never looks at `clock`, so a bad one is ignored.
- Alternatives: reject it.
- Should the spec pin this? no.

## C-5: Malformed clocks
- Spec reference: OPEN-IF-003
- Situation: missing
- What I chose: any string is accepted and copied to `computed_at` unchanged.
- Alternatives: validate the 24-character form and return `bad_request`.
- Should the spec pin this? no, it is open on purpose.

## C-6: Overflow and out-of-range numbers
- Spec reference: OPEN-WB-001, OPEN-FL-001, OPEN-CJ-001
- Situation: missing
- What I chose: values like `1e400` parse to Infinity via `JSON.parse`. As a numeric input they are treated as non-finite (`invalid_input`, written `"Infinity"` in the audit). In `canonical` a non-finite number is written `null`. If the `flagC` conversion overflows, the child audit is `invalid_input:wetBulbF`, the result is `null`, and the parent summary uses the flag word `invalid_input`.
- Alternatives: reject with `bad_request`.
- Should the spec pin this? no.

## C-7: Duplicate keys and invalid UTF-8
- Spec reference: OPEN-IF-005
- Situation: missing
- What I chose: duplicate keys follow `JSON.parse` (last wins). Invalid UTF-8 is decoded by Node with U+FFFD replacement. Responses are written as each line arrives.
- Alternatives: reject.
- Should the spec pin this? no.

## C-8: Special strings count as numbers only in numeric fields
- Spec reference: REQ-IF-006
- Situation: ambiguous
- What I chose: only exactly `"NaN"`, `"Infinity"` and `"-Infinity"` are accepted, case-sensitive. Any other string is `bad_request`.
- Alternatives: accept `"+Infinity"` or `"nan"`.
- Should the spec pin this? no.

## C-9: Order of error checks inside step 3
- Spec reference: Errors, step 3
- Situation: ambiguous
- What I chose: all step 3 failures give the same code, so the order does not matter. A `canonical` request with a missing `value` is `bad_request` after the `input` check.
- Alternatives: none.
- Should the spec pin this? no.

## C-10: Serialization of the response line
- Spec reference: Driver protocol
- Situation: missing
- What I chose: the response is written with `JSON.stringify`, which gives one line with no CR/LF and lone surrogates escaped. Member order is `id`, `result`, `audit`. A `null` result is kept as `"result":null`.
- Alternatives: use the canonical serializer for the whole response.
- Should the spec pin this? no, results are compared as parsed JSON.
