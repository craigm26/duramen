## C-1: Invalid UTF-8 and duplicate keys in requests
- Spec reference: OPEN-IF-005
- Situation: missing
- What I chose: stdin is decoded as UTF-8 with replacement characters; for duplicate member names the last one wins (Python json).
- Alternatives: answer `bad_request` for undecodable lines.
- Should the spec pin this? no, it is deliberately open.

## C-2: Lines are split on LF only
- Spec reference: Driver protocol
- Situation: ambiguous
- What I chose: split on LF, strip a trailing CR, skip lines that are empty or white space only. Unicode line separators such as U+2028 do not split lines.
- Alternatives: `str.splitlines()`, which would break JSON strings containing U+2028.
- Should the spec pin this? no, "one JSON object per line" with LF endings is enough.

## C-3: Non-standard JSON tokens are rejected
- Spec reference: REQ-IF-006, REQ-IF-007
- Situation: missing
- What I chose: bare `NaN`, `Infinity` and `-Infinity` tokens, which Python accepts by default, give `bad_request` with `id` null. Only the quoted strings are non-finite values.
- Alternatives: accept them as numbers.
- Should the spec pin this? unsure, since a test could send them.

## C-4: Numbers outside binary64 in requests
- Spec reference: OPEN-CJ-001
- Situation: missing
- What I chose: `1e400` is read as Infinity. As a numeric input it behaves as a non-finite number. Inside `canonical` a non-finite number is written as `null`.
- Alternatives: `bad_request`.
- Should the spec pin this? no, it is open.

## C-5: Which input is reported when `bad_request` has several causes
- Spec reference: Errors, step 3
- Situation: ambiguous
- What I chose: all step-3 failures give the same code, so their order cannot be observed. A non-object `input`, then `clock`, then the fields are checked in that order.
- Alternatives: none observable.
- Should the spec pin this? no.

## C-6: `canonical` with `clock` or other members
- Spec reference: REQ-CJ-005
- Situation: ambiguous
- What I chose: `canonical` ignores `clock` and does not require it. A missing `value` member is `bad_request`.
- Alternatives: treat a missing `value` as `null`.
- Should the spec pin this? yes, the spec says `value` is any JSON value but not whether it is required.

## C-7: Overflow and non-finite intermediate results
- Spec reference: OPEN-WB-001, OPEN-FL-001
- Situation: missing
- What I chose: results are computed as is. If `flagC` overflows to an infinite °F value, the child audit is the `invalid_input:wetBulbF` record, the result is `null`, and the summary uses `invalid` as the flag name. A non-finite number inside a result is serialized as `null`.
- Alternatives: report `invalid_input:wetBulbC`.
- Should the spec pin this? no, it is open.

## C-8: Response encoding
- Spec reference: Driver protocol
- Situation: missing
- What I chose: responses use the same canonical serializer as audits, so keys are sorted and non-ASCII text is written raw as UTF-8. Lone surrogates in an `id` are escaped.
- Alternatives: `json.dumps` with `ensure_ascii`.
- Should the spec pin this? no, results are compared as parsed JSON.

## C-9: Integer-valued JSON numbers
- Spec reference: REQ-IF-006
- Situation: ambiguous
- What I chose: every JSON number, integers included, is parsed straight to a float, so very long integers and `-0` follow binary64 rules (`-0` is written as `0`).
- Alternatives: keep Python ints.
- Should the spec pin this? no, REQ-IF-006 already covers it.

## C-10: `id` check and `op` check
- Spec reference: Errors, steps 1-2
- Situation: ambiguous
- What I chose: a non-string `id` gives `id: null` with `bad_request`. An `op` that is not a string, or is missing, gives `unknown_op`, even when `input` is also bad.
- Alternatives: none; this follows the numbered list.
- Should the spec pin this? no.
