# heat-engine: specification

- Program: `heat-engine`
- Document version: 1.0.2-slice
- Contract version: `0.2.0`
- Generated from `heat.tilth` by tilth 0.1.0. Edit the source, not this file.

*Wet-bulb temperature and heat flags, with byte-exact audit records*

`heat-engine` is a small calculation library for outdoor heat-stress decisions. This slice
covers wet-bulb temperature from air temperature and relative humidity (Stull 2011), from
°C or °F, and the U.S. Marine Corps heat flag (MCO 6200.1E) for a wet-bulb temperature in °F
or °C. Every computing operation returns its result together with an **audit record**: what
was computed, from which inputs and constants, under which citation, and when. Audit
records are compared byte for byte, so their serialized form is part of the contract.
"Number" means an IEEE 754 binary64 value (a JavaScript `number`, a Python `float`).

Conventions: MUST and MUST NOT appear only in requirements (`REQ-`) and in the shared
definitions under Edges, and every requirement has at least one example that the suite
checks. Every example was checked against the
specification's own model (its oracle) when this file was generated; where an example states
no value, the value shown is the model's. `OPEN-` items are deliberately unspecified and never
tested. An order that matters (such as which error wins) is stated once, in a numbered list.

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
  standard output, in request order, with the request's `id`. Blank lines (empty, or white
  space only) get no response.
- A response holds `id` and `result` (plus `audit` for operations that have one), or `id` and
  `error`, and nothing else.
- Standard output is UTF-8. Every line ends with LF (0x0A) and contains no CR (0x0D). Nothing
  else is written to standard output; standard error is free.
- After end of input and the last response, the driver exits with status 0.

Requests also carry `clock` (every operation except `canonical`).

### Operations

| op | input fields | result | audit |
|---|---|---|---|
| `canonical` | `value` (any) | the canonical JSON text of `value`, as a string | no |
| `wetBulb` | `tempC` (number), `rhPercent` (number) | `wetBulbC`, `wetBulbF`, and `clampedRhPct` when RH was clamped (REQ-WB-001) | yes |
| `wetBulbF` | `tempF` (number), `rhPercent` (number) | as `wetBulb` (REQ-WB-005) | yes |
| `flagF` | `wetBulbF` (number) | `flag` and `flagDartLabel` (REQ-FL-001) | yes |
| `flagC` | `wetBulbC` (number) | as `flagF` (REQ-FL-004) | yes |

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

**OPEN-IF-001.** *Standard error.* What the driver writes to standard error. (Open: implementations may differ; never tested.)

**OPEN-IF-002.** *Error text.* Any human-readable error text; it never appears in a response. (Open: implementations may differ; never tested.)

---

## Canonical JSON

Audit records, result summaries and the `canonical` operation write numbers and JSON by the
edges in the Edges section: number text (number-text/ecmascript), fixed-point text
(fixed-text/ecmascript) and canonical JSON (json/sorted-utf16).

**REQ-CJ-005.** *The canonical operation.*

`canonical` takes `input.value`, any JSON value, and MUST respond
`{"id": <id>, "result": <string>}`, where the string is the canonical JSON text of the
value (edge json/sorted-utf16). It has no `audit` member and needs no `clock`. JSON numbers
in `value` are binary64 values (REQ-IF-006); the special strings of REQ-IF-006 are **not**
interpreted here: they are ordinary strings.

Decisions: D-017.

Examples:
- `canonical {"value": {"b": [1, 2.50, 1e21], "a": null}}` ⟶ `result` = `"{\"a\":null,\"b\":[1,2.5,1e+21]}"`
- `canonical {"value": {"y": "Infinity", "x": "NaN"}}` ⟶ `result` = `"{\"x\":\"NaN\",\"y\":\"Infinity\"}"`

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

`flagC` adds `children` (REQ-FL-005). No other members appear.

Decisions: D-001.

Examples:
- `flagF {"wetBulbF": 85}` ⟶ `audit.spec_version` = `"0.2.0"`; `audit.function` = `"flagFromWetBulbF"`; `audit.computed_at` = `"2026-05-26T17:00:00.000Z"`

**REQ-AU-002.** *Non-finite inputs in audits.*

In `inputs`, a non-finite number MUST be written as the string `"NaN"`, `"Infinity"` or
`"-Infinity"` (not as `null`).

Decisions: D-007.

Examples:
- `wetBulb {"tempC": "Infinity", "rhPercent": "NaN"}` ⟶ `audit.inputs` = `{"tempC":"Infinity","rhPercent":"NaN"}`

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

**REQ-WB-002.** *No clamping of temperature.* Temperatures outside [-20, 50] °C still compute a result: `tempC` is never clamped.

| tempC | rhPercent | result.wetBulbC |
|---|---|---|
| `60` | `50` | `48.08736` ± 0.00001 |
| `-30` | `50` | `-29.31486` ± 0.00001 |

(Rows are `wetBulb` requests. An empty cell states nothing.)

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
- `wetBulb {"tempC": 25, "rhPercent": 120}` ⟶ `audit.inputs` = `{"tempC":25,"rhPercent":120}`; `audit.constants` = `{"stull_a":0.151977,"stull_b":8.313659,"stull_c":1.676331,"stull_d":0.00391838,"stull_e":0.023101,"stull_offset":-4.686035,"rh_clamp_min":5,"rh_clamp_max":100}`

| tempC | rhPercent | audit.result_summary |
|---|---|---|
| `20` | `50` | `"T=20.0°C RH=50% → Tw=13.70°C"` |
| `25` | `120` | `"T=25.0°C RH=120→100% (rh_clamped) → Tw=25.05°C"` |
| `60` | `2.5` | `"T=60.0°C RH=2.5→5% (rh_clamped,out_of_validity_range) → Tw=25.97°C"` |
| `20.25` | `50` | `"T=20.3°C RH=50% → Tw=13.91°C"` |
| `-0.04` | `50` | `"T=-0.0°C RH=50% → Tw=-3.53°C"` |

(Rows are `wetBulb` requests. An empty cell states nothing.)

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
(`function` is `"calculateWetBulb"`; `inputs` holds the converted `tempC`). A non-finite
`tempF` gives a non-finite `tempC` and so `invalid_input:tempC`.

Decisions: D-010.

Examples:
- `wetBulbF {"tempF": 68, "rhPercent": 50}` ⟶ `audit.result_summary` = `"T=20.0°C RH=50% → Tw=13.70°C"`; `audit.inputs` = `{"tempC":20,"rhPercent":50}`
- `wetBulbF {"tempF": 100, "rhPercent": 40}` ⟶ `audit.inputs` = `{"tempC":37.77777777777778,"rhPercent":40}`
- `wetBulbF {"tempF": 98.6, "rhPercent": 50}` ⟶ `audit.inputs` = `{"tempC":37,"rhPercent":50}`
- `wetBulbF {"tempF": "NaN", "rhPercent": 50}` ⟶ `result` = `null`; `audit.result_summary` = `"invalid_input:tempC"`

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

**REQ-FL-002.** *Flag audit record.*

The audit: `function` `"flagFromWetBulbF"`; `citation` `"USMC 6200.1E Table 3-1"`;
`inputs` `{"wetBulbF": wetBulbF}`; `constants`
`{"white_max":80,"green_max":85,"yellow_max":88,"red_max":90}`; `result_summary`
`wetBulbF=<w> → <flag>` with `<w>` as number text, followed by ` (out_of_observed_range)`
when `wetBulbF < -50` or `wetBulbF > 200`.

Decisions: D-001.

| wetBulbF | audit.result_summary |
|---|---|
| `85` | `"wetBulbF=85 → yellow"` |
| `250` | `"wetBulbF=250 → black (out_of_observed_range)"` |
| `-60` | `"wetBulbF=-60 → white (out_of_observed_range)"` |
| `200` | `"wetBulbF=200 → black"` |

(Rows are `flagF` requests. An empty cell states nothing.)

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
