## C-1: Lines with white space other than spaces and tabs
- Spec reference: Driver protocol (blank lines)
- Situation: ambiguous
- What I chose: a line of only spaces, tabs and CR gets no response (a trailing CR from CRLF input is stripped, so a CRLF blank line is blank). Any other line, such as one holding a form feed, is parsed and gets `bad_request` with `id` null.
- Alternatives: treat all Unicode white space as blank.
- Should the spec pin this? no, it is already marked open.

## C-2: Numbers beyond binary64, NaN and Infinity
- Spec reference: OPEN-OP-001, REQ-RQ-005
- Situation: missing
- What I chose: every number is read as a float. A number that overflows to infinity (`1e400`), and the literals `NaN`/`Infinity`, make the whole line a `bad_request` with `id` null, wherever they appear.
- Alternatives: accept them in members the gate ignores.
- Should the spec pin this? no, it is open and never tested.

## C-3: Integral numbers in output
- Spec reference: REQ-RQ-005
- Situation: missing
- What I chose: all numbers are held as floats, so `1000` comes out as `1000.0`. Results are compared as parsed JSON, so it is the same number.
- Alternatives: print integral floats as integers.
- Should the spec pin this? no.

## C-4: `id` validity for `unknown_op` and an invalid `op` with a bad id
- Spec reference: Errors list
- Situation: ambiguous
- What I chose: check 1 (id is a string, line is an object) runs first and answers with `"id": null`; only then `op`. An empty-string `id` is a valid string.
- Alternatives: require a non-empty request id.
- Should the spec pin this? no.

## C-5: Loa for STOP and RESUME
- Spec reference: REQ-GT-007, D-005
- Situation: ambiguous
- What I chose: STOP and RESUME are in scope `control`, so they need `minLoaControl` only. ESTOP_CLEAR is in scope `safety` and needs the greater of the two minimums, as for a move with scope `safety`.
- Alternatives: STOP/RESUME needing `minLoaSafety` as safety events.
- Should the spec pin this? no, REQ-GT-006 and REQ-GT-007 together imply it.

## C-6: Validation of unused command members
- Spec reference: REQ-RQ-003, REQ-RQ-004
- Situation: ambiguous
- What I chose: a member that the command's kind does not take (e.g. `targets` on a status query, `scope` on a safety command) is ignored entirely and not validated. `loa`, `tier` and `confidence`-style members that the command does take are validated whenever present.
- Alternatives: validate them whatever the kind.
- Should the spec pin this? no, REQ-RQ-004 already says so.

## C-7: Checking state before command
- Spec reference: Errors, step 3
- Situation: missing
- What I chose: both are checked fully before any decision; the error is the same `bad_request` either way, so order is invisible.
- Alternatives: none that differ observably.
- Should the spec pin this? no.

## C-8: Entry `expires` comparison with replay-set filtering
- Spec reference: REQ-GT-004
- Situation: ambiguous
- What I chose: an entry is dropped when `expires <= now`, applied on every path (including stale, future, ESTOP) so that the next state's `seen` is always the pruned set, as the examples show.
- Alternatives: leave `seen` untouched on early exits.
- Should the spec pin this? no, the examples do.

## C-9: Gate and limit lookup use own keys of dictionaries
- Spec reference: REQ-GT-009, REQ-GT-011, D-006
- Situation: missing
- What I chose: Python dicts hold only the parsed names, so `__proto__` and `toString` are ordinary names and nothing inherited can be found.
- Alternatives: none needed.
- Should the spec pin this? no.

## C-10: Window larger than 10 for safety
- Spec reference: REQ-GT-004
- Situation: ambiguous
- What I chose: the new entry for a safety command expires at `now + w` with the capped `w` (as the example with STOP at `1010` shows).
- Alternatives: use the uncapped window for expiry.
- Should the spec pin this? no, the examples do.
