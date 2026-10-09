# Choices

## C-1: Numbers outside binary64
- Spec reference: OPEN-OP-001
- Situation: ambiguous
- What I chose: a non-finite number (`1e400` parses to Infinity) where a number is required is a `bad_request`. Elsewhere (unnamed members) it is passed on and serialised as `null` by JSON.stringify.
- Alternatives: accept Infinity and compare normally.
- Should the spec pin this? no, it is declared open.

## C-2: Whitespace-only lines
- Spec reference: Driver protocol
- Situation: ambiguous
- What I chose: only lines of spaces and tabs are blank. A line with other whitespace (e.g. a lone CR, form feed) is parsed, fails, and gets `{"id":null,"error":"bad_request"}`. Lines ending in CRLF are handled (readline strips the CR).
- Alternatives: treat every whitespace-only line as blank.
- Should the spec pin this? no, it says it is open.

## C-3: Which scope counts for STOP/RESUME in the LoA step
- Spec reference: REQ-GT-007, REQ-GT-006
- Situation: ambiguous
- What I chose: STOP/RESUME have scope `control`, ESTOP_CLEAR has scope `safety`, so ESTOP_CLEAR needs max(minLoaControl, minLoaSafety). A move whose scope lowercases to `safety` does too.
- Alternatives: apply minLoaSafety to all safety-kind commands.
- Should the spec pin this? no, REQ-GT-006/007 plus examples already imply it.

## C-4: Next state for validation of unnamed members and key order
- Spec reference: REQ-GT-001, REQ-RQ-004
- Situation: missing
- What I chose: the next state is a shallow copy of the given state with `estopped`, `stopped` and `seen` set. Entries of `seen` are kept as the caller gave them (extra members included), and the new entry is `{id, expires}`. Member order of the output is not significant.
- Alternatives: rebuild entries with only `id` and `expires`.
- Should the spec pin this? no, an example (`"from":"lan"`) already pins it.

## C-5: Joint and gate lookup by own property
- Spec reference: REQ-GT-009, REQ-GT-011, D-006
- Situation: ambiguous
- What I chose: `limits`, `gates` use `Object.hasOwn`; `__proto__` arrives as an own member from JSON.parse, so a limit named `__proto__` works. Role and scope tables are `Map`s.
- Alternatives: null-prototype objects.
- Should the spec pin this? no, examples pin it.

## C-6: Validation covers every entry of limits and gates, including unused ones
- Spec reference: REQ-RQ-002
- Situation: ambiguous
- What I chose: any malformed limit, gate or seen entry makes the whole request `bad_request`, even if the command never uses it. A gate `min` is valid at 0 and 1.
- Alternatives: validate lazily.
- Should the spec pin this? no, "a member that is present MUST have the form given" implies it.

## C-7: Command members of the wrong kind
- Spec reference: REQ-RQ-004
- Situation: ambiguous
- What I chose: for a `status` or `safety` command, `scope`, `targets`, `speed` and `confidence` are never inspected, even if malformed (ignored). Same for `event` on moves.
- Alternatives: validate them when present.
- Should the spec pin this? no.

## C-8: `input.state` / `input.command` arrays
- Spec reference: Errors list, item 3
- Situation: missing
- What I chose: an array is not an object, so it is a `bad_request`; `null` too.
- Alternatives: none sensible.
- Should the spec pin this? no.

## C-9: Test-run command and package.json
- Spec reference: REQ-BU-001, REQ-BU-003
- Situation: missing
- What I chose: `test` is `node --test`; a `package.json` with `"type": "module"` and a test script, no dependencies. `build` is empty.
- Alternatives: no package.json (but `npm test` needs one).
- Should the spec pin this? no.
