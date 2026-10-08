# heat-engine: specification

- Program: `heat-engine`
- Document version: 1.2.0-slice
- Contract version: `0.2.0`
- Generated from `heat.duramen` by duramen 0.2.0. Edit the source, not this file.

*Wet-bulb temperature and heat flags, with byte-exact audit records*

`heat-engine` is a small calculation library for outdoor heat-stress decisions. This slice
covers wet-bulb temperature from air temperature and relative humidity (Stull 2011), from
°C or °F, and the U.S. Marine Corps heat flag (MCO 6200.1E) for a wet-bulb temperature in °F
or °C. Every computing operation returns its result together with an **audit record**: what
was computed, from which inputs and constants, under which citation, and when. Audit
records are compared byte for byte, so their serialized form is part of the contract.
"Number" means an IEEE 754 binary64 value (a JavaScript `number`, a Python `float`).

Conventions: MUST and MUST NOT appear only in requirements (`REQ-`) and in the shared
definitions under Edges, and every requirement has at least one check in the suite. Every
example was checked against the specification's own model (its oracle) when this file was
generated; where an example states no value, the value shown is the model's.
Evidence (`EV-`) is data from outside this specification, such as published values or another implementation's results; the model agrees with every row, except rows a decision waives, and the suite checks the rows.
A property (`PROP-`) holds for every input it describes; the suite checks it on generated inputs, and so must an implementation.
Some requirements are checked on the implementation folder itself rather than through the driver; each says how.
`OPEN-` items are deliberately unspecified and never tested. An order that matters (such as
which error wins) is stated once, in a numbered list. An object written in this document
lists its members in no particular order; text produced as canonical JSON orders them as its
edge says.

---

## Interface

### Driver protocol

An implementation is judged only through its driver: the program named by `driver` in the
implementation folder's `REGEN.json` (a command string, or an object whose keys are Node.js
`process.platform` values plus `default`). The command is split on single spaces and started
without a shell, in the implementation folder.

- Requests arrive on standard input, one JSON object per line:
  `{"id": <string>, "op": <string>, "input": <object>}`, plus any members named below.
- For each line that is not blank the driver writes exactly one JSON object, as one line, to
  standard output, in request order, with the request's `id`. Blank lines (empty, or only
  spaces and tabs) get no response; whether other white space makes a line blank is open.
- A response holds `id` and `result` (plus `audit` for operations that have one), or `id` and
  `error`, and nothing else.
- Standard output is UTF-8. Every line ends with LF (0x0A) and contains no CR (0x0D). Nothing
  else is written to standard output; standard error is free.
- After end of input and the last response, the driver exits with status 0.

Requests also carry `clock` (every operation except `canonical`).

### Types

Types named in this document (`number` is a JSON number, read as an IEEE 754 binary64 value; `{a: t, b?: t}` is an object with exactly these members, `b` optional, and `...` allows others; `t[]` is an array; `|` is either):

- `num` = `number | "NaN" | "Infinity" | "-Infinity"`
- `wetBulbResult` = `{wetBulbC: number, wetBulbF: number, clampedRhPct?: number} | null`
- `flag` = `"white" | "green" | "yellow" | "red" | "black"`
- `flagResult` = `{flag: flag, flagDartLabel: "low" | "moderate" | "high" | "extreme" | "critical"} | null`
- `command` = `string | {default: string, ...}`

### Properties

A property (`PROP-`) is checked on generated cases. Each case draws a value for every variable
(`x in lo .. hi` is a number in that closed range, `one of` a value from the list), sends the
requests in order as ordinary driver requests (a request may use an earlier response), and
requires every expectation to be true. In the expectations, a call's name stands for its whole
response object (`a.result.x` reads member `x` of the response's `result`; `o[k]` reads
member or element `k`; `a.audit` is the audit text); `==` and `!=` compare JSON values (object
member order does not matter; numbers compare exactly); `+ - * /` are IEEE 754 binary64
arithmetic; `and`, `or`, `not` and `c ? x : y` are as usual; and
- `contains(s, t)` whether string `s` contains `t` (or array `s` contains the value `t`)
- `has(o, "m")` whether object `o` has member `m`
- `parse(s)` the JSON value the text `s` holds

### Operations

| op | input fields (required unless marked optional) | result | audit |
|---|---|---|---|
| `canonical` | `value` (any) | `string`; the canonical JSON text of `value`, as a string | no |
| `wetBulb` | `tempC` (num), `rhPercent` (num) | `wetBulbResult`; `wetBulbC`, `wetBulbF`, and `clampedRhPct` when RH was clamped (REQ-WB-001) | yes |
| `wetBulbF` | `tempF` (num), `rhPercent` (num) | `wetBulbResult`; as `wetBulb` (REQ-WB-005) | yes |
| `flagF` | `wetBulbF` (num) | `flagResult`; `flag` and `flagDartLabel` (REQ-FL-001) | yes |
| `flagC` | `wetBulbC` (num) | `flagResult`; as `flagF` (REQ-FL-004) | yes |

Results are compared as parsed JSON: member order does not matter, and numbers compare exactly except for `wetBulb` and `wetBulbF`, `result.wetBulbC` within ± 0.00001 and `result.wetBulbF` within ± 0.000018001.
The `audit` text is compared byte for byte.

### Errors

A request that cannot be handled gets `{"id": <id>, "error": <code>}`. The checks run in this
order, and the first that applies decides the response:

1. `bad_request` when the line is not a JSON object, or `id` is missing or not a string (the response then has `"id": null`)
2. `unknown_op` when `op` is missing, not a string, or not one of the operations
3. `bad_request` when `input` is missing or not an object; `clock` is missing or not a string where the operation needs it; a required input field is missing; or an input field has the wrong JSON type (a number field holding `true` or `"80"`, for example)

## Edges

These definitions are shared across specifications and referenced by name.

### number-text/ecmascript: Number text (ECMAScript Number::toString)

A finite number `x` is written exactly as ECMAScript's `Number::toString(x)` (radix 10)
writes it:

1. If `x` is `+0` or `-0`, write `0`.
2. If `x < 0`, write `-` followed by the text of `-x`.
3. Otherwise let `s` be the shortest string of decimal digits (`k` digits, no trailing zeros
   unless `k = 1`) and `n` an integer such that `s × 10^(n−k)` is the number closest to `x`
   that rounds back to exactly `x`. When several such digit strings of the same length exist,
   take the one whose value is closest to `x`.
4. If `k ≤ n ≤ 21`: write `s` followed by `n − k` zeros.
5. If `0 < n ≤ 21`: write the first `n` digits of `s`, `.`, then the remaining `k − n` digits.
6. If `−6 < n ≤ 0`: write `0.`, then `−n` zeros, then `s`.
7. Otherwise write exponent form: the first digit of `s`; if `k > 1`, `.` and the remaining
   digits; then `e`, then `+` or `-` for the sign of `n − 1`, then `|n − 1|` in decimal.

This is not C `%g`, Python `repr` (`1e-07`) or Java `Double.toString`.

The suite checks this with 23 cases sent through `canonical` (`value`).

Decisions: D-002.

### fixed-text/ecmascript: Fixed-point text (ECMAScript Number.prototype.toFixed)

A finite number `x` "fixed to `f` places" is written as ECMAScript's
`Number.prototype.toFixed(f)` writes it:

1. If `|x| ≥ 1e21`, write the number text of `x` (edge number-text/ecmascript).
2. If `x < 0` (strictly), write `-` followed by the fixed text of `-x`. `-0` is written like `+0`.
3. Otherwise let `m` be the integer for which `m / 10^f − x` is closest to zero, using the
   **exact** binary value of `x`; on an exact tie take the larger `m`. Write `m` in decimal,
   left-padded with zeros to at least `f + 1` digits, with `.` before the last `f` digits.

Python's `format(x, '.1f')` rounds exact ties to even and so differs (`20.25` gives `20.2`).

Decisions: D-002.

### json/sorted-utf16: Canonical JSON, keys in UTF-16 order, lone surrogates escaped

The canonical JSON text of a value has no whitespace outside strings:

- `null`, `true`, `false` as those words; a finite number as its number text
  (edge number-text/ecmascript).
- A string as `"`, each UTF-16 code unit escaped as below, then `"`.
- An array as `[`, its elements in order separated by `,`, then `]`.
- An object as `{`, its members separated by `,`, then `}`; each member is the key as a
  string, `:`, then the value. Members are ordered by key, comparing keys as sequences of
  **UTF-16 code units** (not code points).

Escaping, per UTF-16 code unit: `"` and `\` with a backslash; `0x08`, `0x0C`, `0x0A`,
`0x0D`, `0x09` as `\b`, `\f`, `\n`, `\r`, `\t`; any other unit below `0x20`, and any
surrogate that is not part of a valid pair, as `\u` and four **lowercase** hex digits;
everything else, including `/`, `0x7F` and U+2028, as itself. The text is UTF-8 encoded.

The suite checks this with 19 cases sent through `canonical` (`value`).

Decisions: D-021.

---

## Requests

**REQ-IF-004.** *The injected clock.*

Every request except `canonical` carries `clock`, a UTC timestamp in the exact form
`YYYY-MM-DDTHH:MM:SS.sssZ` (24 characters). It is the injected clock: every `computed_at`
in every audit record produced by the request MUST equal it exactly. An implementation
never reads the wall clock for an audit.

Examples:
- `flagF {"wetBulbF": 70}` (with `"clock": "1999-12-31T23:59:59.999Z"`) ⟶ `audit.computed_at` = `"1999-12-31T23:59:59.999Z"`
- `flagC {"wetBulbC": 30}` (with `"clock": "1999-12-31T23:59:59.999Z"`) ⟶ `audit.children.0.computed_at` = `"1999-12-31T23:59:59.999Z"`

**REQ-IF-006.** *Numbers in requests.*

Numeric input fields accept either a JSON number or one of the three strings `"NaN"`,
`"Infinity"`, `"-Infinity"`, which stand for the corresponding non-finite values. This is
how invalid numeric input reaches the operations. A JSON number in a request MUST be
treated as a binary64 value regardless of how it is written: `20`, `20.0` and `2e1` are
the same input and are written identically (`20`).

Decisions: D-007.

Examples:
- `wetBulb {"tempC": 2.0e1, "rhPercent": 50.000}` ⟶ `audit.result_summary` = `"T=20.0°C RH=50% → Tw=13.70°C"`
- `flagC {"wetBulbC": "-Infinity"}` ⟶ `result` = `null`; `audit.inputs` = `{"wetBulbC":"-Infinity"}`

**REQ-IF-007.** *Requests that cannot be handled.*

A request line that cannot be handled MUST get exactly `{"id": <id>, "error": <code>}`,
with the code given by the numbered list under Errors, and the driver MUST then continue
with the next line. Invalid values are not errors: a non-finite number or an unknown flag
name reaches the operation, which reports it in its result.

Decisions: D-019, D-024.

Examples:
- the request line `{not json` ⟶ `id` = `null`; `error` = `"bad_request"`
- the request line `[1,2]` ⟶ `id` = `null`; `error` = `"bad_request"`
- `flagF {"wetBulbF": 80}` (no `id` member) ⟶ `id` = `null`; `error` = `"bad_request"`
- `heatIndex {"tempC": 20}` ⟶ `error` = `"unknown_op"`
- `flagF {"wetBulbF": 80}` (no `op` member) ⟶ `error` = `"unknown_op"`
- `heatIndex` (no `input` or `clock` member) ⟶ `error` = `"unknown_op"`
- `flagF` (no `input` member) ⟶ `error` = `"bad_request"`
- `flagF {"wetBulbF": 80}` (no `clock` member) ⟶ `error` = `"bad_request"`
- `wetBulb {"tempC": 20}` ⟶ `error` = `"bad_request"`
- `flagF {"wetBulbF": true}` ⟶ `error` = `"bad_request"`
- `flagF {"wetBulbF": "80"}` ⟶ `error` = `"bad_request"`

**REQ-IF-008.** *Extra members.* Unknown extra members in a request or in `input` MUST be ignored.

Examples:
- the request line `{"id":"extra","op":"flagF","input":{"wetBulbF":86,"note":"x"},"clock":"2026-05-26T17:00:00.000Z","trace":true}` ⟶ `result` = `{"flag":"yellow","flagDartLabel":"high"}`

**OPEN-IF-001.** *Standard error.* What the driver writes to standard error. (Open: implementations may differ; never tested.)

**OPEN-IF-002.** *Error text.* Any human-readable error text; it never appears in a response. (Open: implementations may differ; never tested.)

**OPEN-IF-003.** *Malformed clocks.* Behavior for a `clock` string that is not in the exact 24-character form. (Open: implementations may differ; never tested.)

**OPEN-IF-005.** *Streaming and odd request bytes.* Whether responses are written as each request line arrives or only after end of input
(only order and completeness are pinned); handling of request bytes that are not valid
UTF-8; handling of duplicate member names in a request object. (Open: implementations may differ; never tested.)

---

## Canonical JSON

Audit records, result summaries and the `canonical` operation write numbers and JSON by the
edges in the Edges section: number text (number-text/ecmascript), fixed-point text
(fixed-text/ecmascript) and canonical JSON (json/sorted-utf16).

**REQ-CJ-005.** *The canonical operation.*

`canonical` takes `input.value`, any JSON value, `null` included, and MUST respond
`{"id": <id>, "result": <string>}`, where the string is the canonical JSON text of the
value (edge json/sorted-utf16). It has no `audit` member and needs no `clock`. JSON numbers
in `value` are binary64 values (REQ-IF-006); the special strings of REQ-IF-006 are **not**
interpreted here: they are ordinary strings. Without a `value` member the request is a
`bad_request`.

Decisions: D-017.

Examples:
- `canonical {"value": {"b": [1, 2.50, 1e21], "a": null}}` ⟶ `result` = `"{\"a\":null,\"b\":[1,2.5,1e+21]}"`
- `canonical {"value": {"y": "Infinity", "x": "NaN"}}` ⟶ `result` = `"{\"x\":\"NaN\",\"y\":\"Infinity\"}"`
- `canonical {"value": null}` ⟶ `result` = `"null"`
- `canonical {}` ⟶ `error` = `"bad_request"`

**PROP-CJ-P1.** *Canonical text is a fixed point and reads back as the value.*

- For `v` in any JSON value:
  - `a` is the response to `canonical {"value": v}`
  - `b` is the response to `canonical {"value": parse(a.result)}`
  - then `b.result == a.result` and `parse(a.result) == v`
- The suite checks this on 100 generated cases.

**OPEN-CJ-001.** *Numbers outside binary64.* JSON numbers outside the binary64 range (e.g. `1e400`), anywhere in a request: their
canonical text in `canonical`, and how operations treat them. (Open: implementations may differ; never tested.)

---

## Audit records

**REQ-AU-001.** *Audit members.*

Every audit record is a JSON object with these members, always present:

| member | value |
|---|---|
| `spec_version` | the string `"0.2.0"` |
| `function` | the operation's function name (given per operation) |
| `inputs` | an object of the inputs, as each operation specifies |
| `constants` | an object mapping constant names to numbers, as each operation specifies (possibly empty) |
| `citation` | a fixed string per operation |
| `result_summary` | a one-line human-readable string, as each operation specifies |
| `computed_at` | the request's `clock` (REQ-IF-004) |

`flagC` adds `children` (REQ-FL-005). No other members appear. In a response, `audit` is
this record written as canonical JSON (edge json/sorted-utf16) and carried as a JSON string.

Decisions: D-001, D-003.

Examples:
- `flagF {"wetBulbF": 85}` ⟶ `audit.spec_version` = `"0.2.0"`; `audit.function` = `"flagFromWetBulbF"`; `audit.computed_at` = `"2026-05-26T17:00:00.000Z"`

**PROP-AU-P1.** *Audits are canonical JSON text.*

- For `t` in `-20 .. 50`, `rh` in `0 .. 120`:
  - `a` is the response to `wetBulb {"tempC": t, "rhPercent": rh}`
  - `b` is the response to `flagC {"wetBulbC": a.result.wetBulbC}`
  - `ca` is the response to `canonical {"value": parse(a.audit)}`
  - `cb` is the response to `canonical {"value": parse(b.audit)}`
  - then `ca.result == a.audit` and `cb.result == b.audit`
- The suite checks this on 100 generated cases.

**REQ-AU-002.** *Non-finite inputs in audits.*

In `inputs`, a non-finite number MUST be written as the string `"NaN"`, `"Infinity"` or
`"-Infinity"` (not as `null`).

Decisions: D-007.

Examples:
- `wetBulb {"tempC": "Infinity", "rhPercent": "NaN"}` ⟶ `audit.inputs` = `{"rhPercent":"NaN","tempC":"Infinity"}`

---

## Wet-bulb temperature (Stull 2011)

Primary source: Stull, R. (2011), *Wet-Bulb Temperature from Relative Humidity and Air
Temperature*, J. Appl. Meteor. Climatol. 50(11):2267–2269, DOI 10.1175/JAMC-D-11-0143.1.

**REQ-WB-001.** *Wet-bulb temperature.*

For finite `tempC` (T, °C) and `rhPercent`, let `RH` be `rhPercent` clamped to the closed
range [5, 100] (below 5 becomes 5, above 100 becomes 100). Compute, in binary64,
evaluating exactly these terms in this order:

```
term1 = T * atan(0.151977 * sqrt(RH + 8.313659))
term2 = atan(T + RH)
term3 = atan(RH - 1.676331)
term4 = 0.00391838 * RH^1.5 * atan(0.023101 * RH)
wetBulbC = term1 + term2 - term3 + term4 + (-4.686035)
wetBulbF = (wetBulbC * 9) / 5 + 32
```

`RH^1.5` is the library power function with exponent 1.5. The result MUST be
`{"wetBulbC": wetBulbC, "wetBulbF": wetBulbF}`, plus `"clampedRhPct": RH` only when
`RH ≠ rhPercent`.

Decisions: D-009, D-018.

| tempC | rhPercent | result.wetBulbC | result.clampedRhPct |
|---|---|---|---|
| `20` | `50` | `13.69934` ± 0.00001 |  |
| `25` | `120` | `25.04558` ± 0.00001 | `100` |
| `30` | `2.5` | `10.77218` ± 0.00001 | `5` |
| `25` | `99.5` | `24.97823` ± 0.00001 |  |

(Rows are `wetBulb` requests. An empty cell states nothing.)

**EV-WB-FIXTURES.** *Wet-bulb values from an independent program.* Evidence of kind `computed`.

The suite checks all 38 rows. The first 8:

| tempC | rhPercent | result.wetBulbC | result.wetBulbF |
|---|---|---|---|
| `20` | `50` | `13.699342` ± 0.00001 | `56.658816` ± 0.000018001 |
| `20` | `80` | `17.529271` ± 0.00001 | `63.552687` ± 0.000018001 |
| `30` | `50` | `22.296834` ± 0.00001 | `72.134301` ± 0.000018001 |
| `30` | `80` | `27.129692` ± 0.00001 | `80.833445` ± 0.000018001 |
| `40` | `50` | `30.893929` ± 0.00001 | `87.609073` ± 0.000018001 |
| `40` | `20` | `22.703918` ± 0.00001 | `72.867053` ± 0.000018001 |
| `10` | `50` | `5.101255` ± 0.00001 | `41.182259` ± 0.000018001 |
| `10` | `80` | `7.928648` ± 0.00001 | `46.271566` ± 0.000018001 |

(Rows are `wetBulb` requests.)

**PROP-WB-P8.** *RH is clamped exactly when it is outside [5, 100].*

- For `t` in `-20 .. 50`, `rh` in one of `4.999999`, `5`, `5.000001`, `5.5`, `6`, `50`, `99.999999`, `100`, `100.000001`, `101`:
  - `a` is the response to `wetBulb {"tempC": t, "rhPercent": rh}`
  - then `has(a.result, "clampedRhPct") == (rh < 5 or rh > 100)`
- The suite checks this on 40 generated cases. Decisions: D-009.

**PROP-WB-P2.** *Humidity above 100 computes as 100.*

- For `t` in `-20 .. 50`, `rh` in `100.001 .. 1000`:
  - `a` is the response to `wetBulb {"tempC": t, "rhPercent": rh}`
  - `b` is the response to `wetBulb {"tempC": t, "rhPercent": 100}`
  - then `a.result.wetBulbC == b.result.wetBulbC and a.result.wetBulbF == b.result.wetBulbF` and `a.result.clampedRhPct == 100 and not has(b.result, "clampedRhPct")`
- The suite checks this on 100 generated cases. Decisions: D-009.

**PROP-WB-P3.** *Humidity below 5 computes as 5.*

- For `t` in `-20 .. 50`, `rh` in `-100 .. 4.999`:
  - `a` is the response to `wetBulb {"tempC": t, "rhPercent": rh}`
  - `b` is the response to `wetBulb {"tempC": t, "rhPercent": 5}`
  - then `a.result.wetBulbC == b.result.wetBulbC and a.result.clampedRhPct == 5`
- The suite checks this on 100 generated cases. Decisions: D-009.

**PROP-WB-P4.** *wetBulbF is the °F of wetBulbC.*

- For `t` in `-60 .. 60`, `rh` in `0 .. 120`:
  - `a` is the response to `wetBulb {"tempC": t, "rhPercent": rh}`
  - then `a.result.wetBulbF == (a.result.wetBulbC * 9) / 5 + 32`
- The suite checks this on 100 generated cases.

**PROP-WB-P5.** *From 5 °C up, more humidity gives a higher wet-bulb.* Stull's fit is not monotonic everywhere in its range: up to about 3 °C, more humidity can
give a lower result (at -20 °C, going from 5 % to 6 % RH lowers it by 0.37 °C). This
specification pins the formula, so that behavior is part of it; the property is stated
where the formula rises.

- For `t` in `5 .. 50`, `rh` in `5 .. 99`:
  - `a` is the response to `wetBulb {"tempC": t, "rhPercent": rh}`
  - `b` is the response to `wetBulb {"tempC": t, "rhPercent": rh + 1}`
  - then `b.result.wetBulbC > a.result.wetBulbC`
- The suite checks this on 100 generated cases.

**REQ-WB-002.** *No clamping of temperature.* Temperatures outside [-20, 50] °C still compute a result: `tempC` is never clamped.

| tempC | rhPercent | result.wetBulbC |
|---|---|---|
| `60` | `50` | `48.08736` ± 0.00001 |
| `-30` | `50` | `-29.31486` ± 0.00001 |

(Rows are `wetBulb` requests. An empty cell states nothing.)

**EV-WB-EXTENDED.** *Wet-bulb values outside Stull's range, from the same independent formula.* Evidence of kind `computed`. Added after `duramen mutate` showed that a change in the sixth decimal place of one of
the formula's constants went unnoticed: inside Stull's range it moves results by less than
the tolerance, and outside it nothing independent checked the values.

The suite checks all 22 rows. The first 8:

| tempC | rhPercent | result.wetBulbC | result.wetBulbF |
|---|---|---|---|
| `-60` | `10` | `-42.258361` ± 0.00001 | `-44.06505` ± 0.000018001 |
| `-60` | `50` | `-58.09395` ± 0.00001 | `-72.56911` ± 0.000018001 |
| `-60` | `90` | `-60.047323` ± 0.00001 | `-76.085181` ± 0.000018001 |
| `-40` | `10` | `-30.712228` ± 0.00001 | `-23.282011` ± 0.000018001 |
| `-40` | `50` | `-37.960282` ± 0.00001 | `-36.328507` ± 0.000018001 |
| `-40` | `90` | `-40.33579` ± 0.00001 | `-40.604422` ± 0.000018001 |
| `-25` | `10` | `-22.029374` ± 0.00001 | `-7.652873` ± 0.000018001 |
| `-25` | `50` | `-25.007032` ± 0.00001 | `-13.012657` ± 0.000018001 |

(Rows are `wetBulb` requests.)

**REQ-WB-003.** *Wet-bulb audit record.*

The audit record for a finite computation:

- `function`: `"calculateWetBulb"`; `citation`: `"Stull (2011) eq. 1"`.
- `inputs`: `{"tempC": tempC, "rhPercent": rhPercent}`, with the values as given (before
  clamping).
- `constants`: `stull_a` 0.151977, `stull_b` 8.313659, `stull_c` 1.676331, `stull_d`
  0.00391838, `stull_e` 0.023101, `stull_offset` -4.686035; when RH was clamped, also
  `rh_clamp_min` 5 and `rh_clamp_max` 100.
- `result_summary`: `T=<T>°C RH=<rh><markers> → Tw=<Tw>°C`, where
  - `<T>` is `tempC` fixed to 1 place (edge fixed-text/ecmascript);
  - `<rh>` is `<RH>%` when not clamped, or `<rhPercent>→<RH>%` when clamped, both as
    number text (edge number-text/ecmascript);
  - `<markers>` is empty, or ` (` + a comma-separated list + `)`: `rh_clamped` when
    clamped, then `out_of_validity_range` when `tempC < -20` or `tempC > 50`;
  - `<Tw>` is `wetBulbC` fixed to 2 places.

Decisions: D-001.

Examples:
- `wetBulb {"tempC": 25, "rhPercent": 120}` ⟶ `audit.inputs` = `{"rhPercent":120,"tempC":25}`; `audit.constants` = `{"rh_clamp_max":100,"rh_clamp_min":5,"stull_a":0.151977,"stull_b":8.313659,"stull_c":1.676331,"stull_d":0.00391838,"stull_e":0.023101,"stull_offset":-4.686035}`

| tempC | rhPercent | audit.result_summary |
|---|---|---|
| `20` | `50` | `"T=20.0°C RH=50% → Tw=13.70°C"` |
| `25` | `120` | `"T=25.0°C RH=120→100% (rh_clamped) → Tw=25.05°C"` |
| `60` | `2.5` | `"T=60.0°C RH=2.5→5% (rh_clamped,out_of_validity_range) → Tw=25.97°C"` |
| `20.25` | `50` | `"T=20.3°C RH=50% → Tw=13.91°C"` |
| `-0.04` | `50` | `"T=-0.0°C RH=50% → Tw=-3.53°C"` |

(Rows are `wetBulb` requests. An empty cell states nothing.)

**PROP-WB-P7.** *The validity marker, at and around -20 and 50.*

- For `t` in one of `-20`, `50`, `-20.000001`, `50.000001`, `-19.999999`, `49.999999`, `-60`, `60`, `0`, `rh` in `5 .. 100`:
  - `a` is the response to `wetBulb {"tempC": t, "rhPercent": rh}`
  - then `contains(parse(a.audit).result_summary, "out_of_validity_range") == (t < -20 or t > 50)`
- The suite checks this on 100 generated cases.

**PROP-WB-P6.** *The audit records the inputs as given.*

- For `t` in `-60 .. 60`, `rh` in `0 .. 120`:
  - `a` is the response to `wetBulb {"tempC": t, "rhPercent": rh}`
  - then `parse(a.audit).inputs == {"tempC": t, "rhPercent": rh}`
- The suite checks this on 100 generated cases.

**REQ-WB-004.** *Non-finite wet-bulb input.*

If `tempC` or `rhPercent` is not finite, the result MUST be `null` and the audit MUST have
`function` and `citation` as above, `inputs` with both values (REQ-AU-002), `constants`
`{}`, and `result_summary` `invalid_input:tempC` if `tempC` is not finite, otherwise
`invalid_input:rhPercent`.

Decisions: D-007, D-019.

| tempC | rhPercent | result | audit.result_summary |
|---|---|---|---|
| `"NaN"` | `50` | `null` | `"invalid_input:tempC"` |
| `20` | `"NaN"` | `null` | `"invalid_input:rhPercent"` |
| `"Infinity"` | `50` | `null` | `"invalid_input:tempC"` |
| `20` | `"-Infinity"` | `null` | `"invalid_input:rhPercent"` |
| `"NaN"` | `"NaN"` | `null` | `"invalid_input:tempC"` |

(Rows are `wetBulb` requests. An empty cell states nothing.)

**REQ-WB-005.** *Wet-bulb from °F.*

`wetBulbF` takes `tempF` and `rhPercent`, computes `tempC = ((tempF - 32) * 5) / 9` in
binary64 (this exact expression), and then MUST behave exactly as `wetBulb` with that
`tempC` and the same `rhPercent`. The result and the audit are those of `wetBulb`
(`function` is `"calculateWetBulb"`; `inputs` holds the converted `tempC`). The expression
applies to non-finite values too: NaN gives NaN, Infinity gives Infinity and -Infinity gives
-Infinity, so the result is `invalid_input:tempC` with that value in `inputs`.

Decisions: D-010, D-025.

Examples:
- `wetBulbF {"tempF": 68, "rhPercent": 50}` ⟶ `audit.result_summary` = `"T=20.0°C RH=50% → Tw=13.70°C"`; `audit.inputs` = `{"rhPercent":50,"tempC":20}`
- `wetBulbF {"tempF": 100, "rhPercent": 40}` ⟶ `audit.inputs` = `{"rhPercent":40,"tempC":37.77777777777778}`
- `wetBulbF {"tempF": 98.6, "rhPercent": 50}` ⟶ `audit.inputs` = `{"rhPercent":50,"tempC":37}`
- `wetBulbF {"tempF": "NaN", "rhPercent": 50}` ⟶ `result` = `null`; `audit.result_summary` = `"invalid_input:tempC"`
- `wetBulbF {"tempF": "Infinity", "rhPercent": 50}` ⟶ `result` = `null`; `audit.inputs` = `{"rhPercent":50,"tempC":"Infinity"}`
- `wetBulbF {"tempF": "-Infinity", "rhPercent": 50}` ⟶ `audit.inputs` = `{"rhPercent":50,"tempC":"-Infinity"}`

**PROP-WB-P1.** *wetBulbF is wetBulb on the converted temperature.*

- For `f` in `-100 .. 200`, `rh` in `0 .. 150`:
  - `a` is the response to `wetBulbF {"tempF": f, "rhPercent": rh}`
  - `b` is the response to `wetBulb {"tempC": (f - 32) * 5 / 9, "rhPercent": rh}`
  - then `a.result == b.result` and `a.audit == b.audit`
- The suite checks this on 100 generated cases. Decisions: D-010.

**OPEN-WB-001.** *Overflow.* Results when the computation overflows or loses all precision (inputs of enormous
magnitude); the result and summary for such inputs are unspecified. (Open: implementations may differ; never tested.)

**OPEN-WB-002.** *Extra precision.* Results more precise than the stated tolerance. (Open: implementations may differ; never tested.)

---

## Heat flags (MCO 6200.1E)

Primary source: U.S. Marine Corps Order 6200.1E, Marine Corps Heat Stress Program.

**REQ-FL-001.** *Flag from °F.*

For finite `wetBulbF` (`w` below), the result MUST be
`{"flag": <flag>, "flagDartLabel": <label>}` from this table. The bands are in °F with
inclusive lower bounds, and comparisons are on the binary64 value as given.

| flag | wet-bulb °F | label |
|---|---|---|
| `white` | `w < 80` | `low` |
| `green` | `80 ≤ w < 85` | `moderate` |
| `yellow` | `85 ≤ w < 88` | `high` |
| `red` | `88 ≤ w < 90` | `extreme` |
| `black` | `w ≥ 90` | `critical` |

Decisions: D-010.

| wetBulbF | result.flag | result.flagDartLabel |
|---|---|---|
| `79.99` | `"white"` | `"low"` |
| `80` | `"green"` | `"moderate"` |
| `84.99` | `"green"` | `"moderate"` |
| `85` | `"yellow"` | `"high"` |
| `88` | `"red"` | `"extreme"` |
| `89.99` | `"red"` | `"extreme"` |
| `90` | `"black"` | `"critical"` |

(Rows are `flagF` requests. An empty cell states nothing.)

**EV-FL-FIXTURES.** *Flag rows worked out from MCO 6200.1E's boundaries.* Evidence of kind `derived`.

The suite checks all 20 rows. The first 8:

| wetBulbF | result.flag | result.flagDartLabel |
|---|---|---|
| `40` | `"white"` | `"low"` |
| `60` | `"white"` | `"low"` |
| `79.99` | `"white"` | `"low"` |
| `80` | `"green"` | `"moderate"` |
| `80.01` | `"green"` | `"moderate"` |
| `82.5` | `"green"` | `"moderate"` |
| `84.99` | `"green"` | `"moderate"` |
| `85` | `"yellow"` | `"high"` |

(Rows are `flagF` requests.)

**PROP-FL-P2.** *Each flag has one label.*

- For `w` in `-60 .. 250`:
  - `a` is the response to `flagF {"wetBulbF": w}`
  - then `{"white": "low", "green": "moderate", "yellow": "high", "red": "extreme", "black": "critical"}[a.result.flag] == a.result.flagDartLabel`
- The suite checks this on 100 generated cases.

**PROP-FL-P3.** *A hotter wet-bulb never gives a milder flag.*

- For `w` in `-60 .. 250`, `dw` in `0 .. 15`:
  - `a` is the response to `flagF {"wetBulbF": w}`
  - `b` is the response to `flagF {"wetBulbF": w + dw}`
  - then `{"white": 0, "green": 1, "yellow": 2, "red": 3, "black": 4}[b.result.flag] >= {"white": 0, "green": 1, "yellow": 2, "red": 3, "black": 4}[a.result.flag]`
- The suite checks this on 100 generated cases.

**REQ-FL-002.** *Flag audit record.*

The audit: `function` `"flagFromWetBulbF"`; `citation` `"USMC 6200.1E Table 3-1"`;
`inputs` `{"wetBulbF": wetBulbF}`; `constants`
`{"white_max":80,"green_max":85,"yellow_max":88,"red_max":90}`; `result_summary`
`wetBulbF=<w> → <flag>` with `<w>` as number text, followed by ` (out_of_observed_range)`
when `wetBulbF < -50` or `wetBulbF > 200`.

Decisions: D-001.

Examples:
- `flagF {"wetBulbF": 86.5}` ⟶ `audit.constants` = `{"green_max":85,"red_max":90,"white_max":80,"yellow_max":88}`; `audit.inputs` = `{"wetBulbF":86.5}`

| wetBulbF | audit.result_summary |
|---|---|
| `85` | `"wetBulbF=85 → yellow"` |
| `250` | `"wetBulbF=250 → black (out_of_observed_range)"` |
| `-60` | `"wetBulbF=-60 → white (out_of_observed_range)"` |
| `200` | `"wetBulbF=200 → black"` |

(Rows are `flagF` requests. An empty cell states nothing.)

**PROP-FL-P4.** *The observed-range marker, at and around -50 and 200.*

- For `w` in one of `-50`, `-50.000001`, `-49.999999`, `-50.5`, `200`, `200.000001`, `199.999999`, `200.5`, `0`:
  - `a` is the response to `flagF {"wetBulbF": w}`
  - then `contains(parse(a.audit).result_summary, "out_of_observed_range") == (w < -50 or w > 200)`
- The suite checks this on 30 generated cases.

**REQ-FL-003.** *Non-finite °F.*

For non-finite `wetBulbF` the result MUST be `null`; the audit has the same `function` and
`citation`, `inputs` per REQ-AU-002, `constants` `{}`, and `result_summary`
`invalid_input:wetBulbF`.

Decisions: D-007.

Examples:
- `flagF {"wetBulbF": "NaN"}` ⟶ `result` = `null`; `audit.result_summary` = `"invalid_input:wetBulbF"`; `audit.constants` = `{}`

**REQ-FL-004.** *Flag from °C.*

For finite `wetBulbC`, compute `wetBulbF = (wetBulbC * 9) / 5 + 32` in binary64, with
exactly this expression (not `wetBulbC * 1.8 + 32`, which rounds differently near the
boundaries), then classify as `flagF`. The result MUST be the `flagF` result.

Decisions: D-010.

| wetBulbC | result.flag |
|---|---|
| `26.66666666666666` | `"white"` |
| `30` | `"yellow"` |
| `29.444444444444443` | `"yellow"` |
| `29.444444443444443` | `"green"` |

(Rows are `flagC` requests. An empty cell states nothing.)

**PROP-FL-P1.** *flagC is flagF of the converted temperature.*

- For `c` in `-50 .. 60`:
  - `a` is the response to `flagC {"wetBulbC": c}`
  - `b` is the response to `flagF {"wetBulbF": (c * 9) / 5 + 32}`
  - then `a.result == b.result` and `parse(a.audit).children == [parse(b.audit)]`
- The suite checks this on 100 generated cases. Decisions: D-010.

**REQ-FL-005.** *°C flag audit record.*

The audit: `function` `"flagFromWetBulbC"`; `citation` `"USMC 6200.1E Table 3-1"`;
`inputs` `{"wetBulbC": wetBulbC}`; the same four `constants` as `flagF`; `result_summary`
`wetBulbC=<c> → wetBulbF=<f> → <flag>`, with `<c>` as number text and `<f>` fixed to 4
places; and `children`: an array of one element, the complete `flagF` audit record for the
converted value.

Decisions: D-001.

Examples:
- `flagC {"wetBulbC": 30}` ⟶ `audit.result_summary` = `"wetBulbC=30 → wetBulbF=86.0000 → yellow"`; `audit.children.0.result_summary` = `"wetBulbF=86 → yellow"`
- `flagC {"wetBulbC": 26.66666666666666}` ⟶ `audit.result_summary` = `"wetBulbC=26.66666666666666 → wetBulbF=80.0000 → white"`

**REQ-FL-006.** *Non-finite °C.*

For non-finite `wetBulbC` the result MUST be `null`; the audit has `function`
`"flagFromWetBulbC"`, the same `citation`, `inputs` per REQ-AU-002, `constants` `{}`,
`result_summary` `invalid_input:wetBulbC`, and no `children`.

Decisions: D-007.

Examples:
- `flagC {"wetBulbC": "NaN"}` ⟶ `result` = `null`; `audit.result_summary` = `"invalid_input:wetBulbC"`

**OPEN-FL-001.** *Overflow in the °C path.* `flagC` for a finite `wetBulbC` whose °F conversion overflows to a non-finite value (only
reachable near ±1.8e308). (Open: implementations may differ; never tested.)

---

## The implementation folder

These requirements are checked on the implementation folder, not through the driver.

**REQ-BU-001.** *REGEN.json.*

The implementation folder MUST contain `REGEN.json`, a JSON object with exactly the keys
`lang` (`"ts"` or `"py"`), `build`, `test` and `driver`. Each of `build`, `test` and
`driver` is a command string, or an object whose keys are Node.js `process.platform`
values (such as `"win32"`) plus a required `"default"`, each mapping to a command string.
Commands run in the implementation folder. `build` and `test` run through the platform
shell; an empty `build` means there is nothing to build, and build output, if any, goes in
`bin/`. `driver` is split on single spaces and started without a shell, so it MUST be plain
space-separated words. The same REGEN.json MUST work on Windows and on Linux.

Checked on the implementation folder:
- `REGEN.json` is JSON of type `{lang: "ts" | "py", build: command, test: command, driver: command}`.

**REQ-BU-002.** *Own tests.*

The implementation MUST have its own tests, including at least one for every MUST in this
document, and the command `REGEN.json` names as `test` MUST pass.

Checked on the implementation folder:
- the command REGEN.json names as `test` exits with status 0 within 300 s (run in the implementation folder, through the platform shell).

**REQ-BU-003.** *Runtime and dependencies.*

TypeScript MUST run on Node.js 22.18 or later directly by type stripping: erasable syntax
only, no build step, relative imports with the `.ts` extension. Python MUST run on 3.11 or
later. Only the language's standard library is used: nothing is installed, and a
`package.json`, if there is one, declares no dependencies.

Checked on the implementation folder:
- the implementation folder has nothing matching `node_modules`, `package-lock.json`, `requirements.txt`, `Pipfile`, `poetry.lock`.
- no file matching `package.json` has a line matching `"(dev|peer|optional)?[dD]ependencies"`.

**REQ-BU-004.** *Size.*

At most 800 non-blank lines of source in all: `.ts .mts .mjs .js` or `.py` files under the
implementation folder, not counting tests (`*.test.*`, `*_test.*`, `test_*.py`, and
anything under a `test/` or `tests/` folder).

Checked on the implementation folder:
- files matching `**/*.ts`, `**/*.mts`, `**/*.mjs`, `**/*.js`, `**/*.py`, excluding `**/*.test.*`, `**/*_test.*`, `**/test_*.py`, `**/test/**`, `**/tests/**`, hold at most 800 non-blank lines in total.
