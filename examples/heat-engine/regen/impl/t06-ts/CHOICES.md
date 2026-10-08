## C-1: Whitespace-only lines
- Spec reference: REQ-IF-007 / Driver protocol
- Situation: ambiguous
- What I chose: lines made only of spaces, tabs and CR are blank and get no response; any other line is parsed (a line with e.g. only a form feed gets `bad_request`).
- Alternatives: treat only spaces/tabs as blank (a lone CR would then give an error); treat all Unicode whitespace as blank.
- Should the spec pin this? no, it is declared open; CRLF input being tolerated is the useful part.

## C-2: Non-finite numbers inside `canonical`
- Spec reference: OPEN-CJ-001
- Situation: missing
- What I chose: a number that reads as non-finite (e.g. `1e400`) is written as `null` by the canonical serializer; operations treat it as the matching non-finite value (so `invalid_input`).
- Alternatives: `bad_request`; write `"Infinity"`.
- Should the spec pin this? no, already open.

## C-3: Order of checks inside error step 3
- Spec reference: Errors, item 3
- Situation: ambiguous
- What I chose: `input` object, then `clock` (non-canonical ops), then fields in declared order; all give the same code, so the order is invisible.
- Alternatives: any other order.
- Should the spec pin this? no, the code is identical.

## C-4: `input` as an array, `null` id and similar
- Spec reference: Errors items 1 and 3
- Situation: ambiguous
- What I chose: arrays and `null` are not objects, so `input: []` is `bad_request`; `id: null` or a non-string id gives `"id": null` with `bad_request`. For `canonical`, `value` must be an own member.
- Alternatives: none reasonable.
- Should the spec pin this? no.

## C-5: flagC child when the converted value overflows
- Spec reference: OPEN-FL-001
- Situation: missing
- What I chose: the child is the `invalid_input:wetBulbF` audit, result `null`, and the parent summary ends in `invalid_input:wetBulbF`.
- Alternatives: parent `invalid_input:wetBulbC`.
- Should the spec pin this? no, already open.

## C-6: Unknown op with a non-object input
- Spec reference: Errors items 2 and 3
- Situation: ambiguous
- What I chose: `canonical` is checked for `input`, but never for `clock`; an unknown op always wins over bad input (follows the numbered list).
- Alternatives: none.
- Should the spec pin this? no, it is pinned by the list.

## C-7: Test command
- Spec reference: REQ-BU-001
- Situation: missing
- What I chose: `test` is `node --test`, relying on Node 22.18's default discovery of `*.test.ts`; a `package.json` with `"type": "module"` and no dependencies is included.
- Alternatives: an explicit glob (not portable to Windows shells).
- Should the spec pin this? no.
