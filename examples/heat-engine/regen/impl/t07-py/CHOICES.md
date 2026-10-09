## C-1: Bare NaN/Infinity literals in a request
- Spec reference: REQ-IF-006, Errors 1
- Situation: missing
- What I chose: A bare `NaN`, `Infinity` or `-Infinity` token (not a string) is not JSON, so the whole line is `bad_request` with `id` null.
- Alternatives: Accept Python's extension and treat them as non-finite numbers.
- Should the spec pin this? no, the line is not valid JSON and the spec already says so implicitly.

## C-2: Numbers beyond binary64 (OPEN-CJ-001)
- Spec reference: OPEN-CJ-001
- Situation: ambiguous
- What I chose: `1e400` parses to Infinity. In `canonical` it is written as `null`; in operations it is treated as a non-finite input.
- Alternatives: `bad_request`; or write `"Infinity"`.
- Should the spec pin this? no, it is declared open.

## C-3: Blank lines and line endings
- Spec reference: Driver protocol, OPEN-IF-005
- Situation: ambiguous
- What I chose: Input is split on LF only. A line holding only spaces and tabs gets no response. A line with other whitespace (e.g. a lone CR) is not blank and gets `bad_request` unless it parses; a trailing CR after valid JSON is JSON whitespace and is accepted.
- Alternatives: Treat any whitespace-only line as blank.
- Should the spec pin this? no, declared open.

## C-4: Invalid UTF-8 and duplicate keys
- Spec reference: OPEN-IF-005
- Situation: missing
- What I chose: Invalid bytes are decoded with U+FFFD replacement; for duplicate member names the last one wins.
- Alternatives: Reject the line as `bad_request`.
- Should the spec pin this? no, declared open.

## C-5: Response encoding
- Spec reference: Driver protocol
- Situation: ambiguous
- What I chose: Responses are written as ASCII-only JSON (non-ASCII escaped as `\uXXXX`), which is valid UTF-8 and reads back to the same value, and handles lone surrogates in ids.
- Alternatives: Raw UTF-8 output, which cannot carry lone surrogates.
- Should the spec pin this? no, the parsed value is what is compared.

## C-6: Overflow in flagC
- Spec reference: OPEN-FL-001
- Situation: ambiguous
- What I chose: If the finite `wetBulbC` converts to a non-finite °F, the result is `null` with summary `invalid_input:wetBulbC`, constants `{}` and no children.
- Alternatives: Include a child audit saying `invalid_input:wetBulbF`.
- Should the spec pin this? no, declared open.

## C-7: Audit inputs for wetBulbF with non-finite tempF
- Spec reference: REQ-WB-005
- Situation: ambiguous
- What I chose: The non-finite `tempF` yields `tempC` NaN, so `inputs.tempC` is `"NaN"` (even if `tempF` was an infinity).
- Alternatives: Keep the sign, e.g. `"Infinity"`, by computing the arithmetic on the infinity (which gives the infinity again).
- Should the spec pin this? yes, because the spec says "a non-finite tempF gives a non-finite tempC" but not which one; the arithmetic would give ±Infinity for an infinite tempF, and I chose NaN.

## C-8: Check order for canonical
- Spec reference: Errors 3, REQ-CJ-005
- Situation: ambiguous
- What I chose: `canonical` needs `input` to be an object and `input.value` to be present; `clock` is neither required nor checked for it.
- Alternatives: Allow a non-object `input` for canonical.
- Should the spec pin this? no.

## C-9: Test and driver commands
- Spec reference: REQ-BU-001
- Situation: ambiguous
- What I chose: `py -3` on win32 and `python3` elsewhere, for both `test` and `driver`; `test` uses `unittest discover -s .` with the default `test*.py` pattern, to avoid shell quoting differences between platforms.
- Alternatives: A single command string.
- Should the spec pin this? no.
