# rcan-gate: a second domain

[`gate.duramen`](gate.duramen) specifies a command gate for a robot that speaks RCAN, the robot
communication protocol at [rcan.dev](https://rcan.dev): whether the robot may carry out a
command. It is a pure function. The gate's state and one command go in; a decision (`execute`,
`refuse` or `hold`), the reason for it and the next state come out. The caller keeps the state
and sets the clock. The rules are RCAN's:

- an emergency stop (ESTOP) is never blocked;
- a command must be fresh, within a window capped at 10 seconds for safety messages, and a
  message ID works once;
- each scope needs a lowest role, and each command a lowest level of assurance (LoA) of its
  sender's identity;
- a stopped or e-stopped robot does not move;
- joint positions stay within their limits and speed under a maximum;
- a command a model produced with too little confidence is blocked, or held for a person.

The record was written for claim 5 of [`CONFIDENCE.md`](../../CONFIDENCE.md): a second domain,
outside duramen's own, rebuilt blind and judged. It has 20 requirements, 197 examples, 4
properties, 12 decisions and 4 open items. [`oracle.mjs`](oracle.mjs) is its reference model,
written to the record, behind the driver [`driver.mjs`](driver.mjs).

```
node bin/duramen.mjs check examples/rcan-gate/gate.duramen
node bin/duramen.mjs regen examples/rcan-gate/gate.duramen --lang ts --runs examples/rcan-gate/regen --run-id g01 --leak-terms examples/rcan-gate/leak-terms.json
node bin/duramen.mjs run examples/rcan-gate/gate.duramen --impl examples/rcan-gate/regen/impl/g01-ts
node bin/duramen.mjs agree examples/rcan-gate/gate.duramen --impl examples/rcan-gate/regen/impl/g01-ts --impl examples/rcan-gate/regen/impl/g02-py --oracle --samples 2000 --seed 1
node bin/duramen.mjs mutate examples/rcan-gate/gate.duramen
```

## Results

| | |
|---|---|
| Blind builds, from the brief only | [g01](regen/g01-ts.md) (TypeScript, 158 lines) and [g02](regen/g02-py.md) (Python, 179 lines), by `claude-sonnet-5-5`, 2.3 minutes each |
| The suite | both **209/209** (197 examples, 4 properties, 5 static checks, 3 protocol cases) |
| `duramen agree`, the two builds and the oracle | **6,000 of 6,000** generated requests answered alike (three seeds of 2,000) |
| `duramen mutate` on the oracle | 148 mutants: 138 caught, 10 that change no answer, all shown equivalent below |
| Choices recorded by the builders | 19: no `pin`, no `clarify`; 4 in the gaps the record leaves open, 12 already pinned, 3 quirks |

Each build's audit counts one violation: a command naming `/tmp/x`, which the sandbox refused,
so nothing ran outside the work folder.

On two corners the record leaves open, the answers differ. With `1e400` in a member nobody
names, g01 and the oracle echo it as `null`, and g02 refuses the line (OPEN-OP-001). A line
holding white space other than spaces and tabs, such as a form feed, both builds refuse as
`bad_request`, and the oracle skips as blank (the driver protocol leaves this open).

### The mutants that change no answer

Each changes no answer to any request any check makes, and none could change one:

- **The role levels** (`GUEST` 1 to 0, `CONTRIBUTOR` 2.5 to 2.6, `ADMIN` 3 to 4, `M2M_PEER` 4 to 3,
  `M2M_TRUSTED` 6 to 7). The gate only compares levels, so only their order and their ties
  matter. These keep the order. The two that make a tie, `ADMIN` with `M2M_PEER`, change nothing,
  because no scope needs `M2M_PEER`.
- **`isNum`'s `&&` to `||`.** That admits non-finite numbers, and JSON has none; a number too
  large for binary64 is OPEN-OP-001.
- **The default window, 30 to 31 or 29, in the safety branch.** That branch uses the smaller of
  the window and 10, which is 10 for any default of 10 or more.
- **The defaults of `minLoaControl` and `minLoaSafety`, 1 to 0.** A command's level of assurance
  is 1, 2 or 3, so a minimum of 0 refuses nothing that a minimum of 1 does.

A further sweep outside `duramen mutate` made 102 more mutants. It swapped each string literal
for another of its family (roles, decisions, reasons, events, tiers, `onFail` values, kinds) and
deleted each line that returns early from `decide`. 96 were caught. The 6 survivors change the
label `stateProblem` or `commandProblem` returns for a malformed member, which only ever becomes
`bad_request`.

### What generated agreement cannot see

The draw types give round times (1000, 995, 1005.5), and on round times `now - timestamp > w`
and `timestamp < now - w` agree. Rewriting the freshness check that way passed 2,000 generated
requests. The suite catches it: REQ-RQ-005's examples use times where the two differ in binary64
(`now` 1006.1, `timestamp` 1006, `window` 0.1). Writing an expiry of `timestamp + w` for
`now + w` changed 686 of the 2,000 answers.

## What writing it found in RCAN's own sources

Every one of these is a decision in the record, with its sources:

- **rcan-ts looks scopes up on a plain object** (`src/identity.ts`, `validateRoleForScope`, at
  b563fb5). A scope named `constructor` or `__proto__` therefore finds an inherited member. It is
  refused for every role, `M2M_TRUSTED` included, where its own rule says an unknown scope needs
  `OPERATOR`. The same lookup on joint names would let a joint named `toString` through with no
  limits. The gate follows the stated rule (D-006).
- **The confidence boundary.** Both SDKs, and the safety document, let a confidence equal to the
  minimum pass. One line of the v1.2 changelog says it is rejected. The gate follows the SDKs
  (D-011).
- **`min_loa_for_control`** is "for control-scope commands" in the identity document's prose.
  Its pseudocode applies it to every message, and its matrix recommends LoA 1 for status
  queries. The gate applies it to everything that acts (D-009).
- **A token from a root registry with no `loa`** has no default in the document; the gate takes
  1 (D-010).
- **Clearing an emergency stop.** rcan-ts says hardware clears it. The safety document describes
  an authenticated `ESTOP_CLEAR` command. The gate has `ESTOP_CLEAR`, in the `safety` scope
  (D-005).

## `op … draw`

`duramen agree` draws requests from an operation's input types. Here those are the honest
domain: any number for `now`, any object for `limits`. Drawn from them, almost every request
would be stale or malformed. duramen 0.2 therefore gained `op … draw <field> <type>`, the type
`agree` draws a field from instead. It is not shown in the brief and does not limit what a
request may hold. The types the properties are checked on, named `sample…`, are shown, with a
note that says what they are.
