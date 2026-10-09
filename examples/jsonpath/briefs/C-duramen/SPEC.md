# jsonpath: specification

- Program: `jsonpath`
- Document version: 1.0.0
- Generated from `jsonpath.duramen` by duramen 0.2.0. Edit the source, not this file.

*JSONPath queries (RFC 9535): segments, selectors, filters, functions and normalized paths*

`jsonpath` evaluates a JSONPath query, as RFC 9535 defines it, against a JSON value (the
*document*, RFC 9535's "query argument"), and returns the nodes the query selects: their
values, and their locations as Normalized Paths. A query that is not well formed and valid
is reported as an error and never evaluated.

Terms are RFC 9535's. A *node* is a value together with its location in the document; the
*children* of an array are its elements, and those of an object its member values (member
names are not nodes); the *descendants* of a node are its children, their children, and so
on. A *nodelist* is a list of nodes, possibly empty, possibly holding a node more than once.
A query is `$` followed by *segments*; each segment holds one or more *selectors*; each
segment is applied to every node of the nodelist the previous one produced, in order.

A *code point* here is a Unicode scalar value: a query, a member name and a string are
sequences of code points, not of UTF-16 code units or bytes. *Blank space* is the four
characters space (U+0020), horizontal tab (U+0009), line feed (U+000A) and carriage return
(U+000D), and nothing else.

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

### Types

Types named in this document (`number` is a JSON number, read as an IEEE 754 binary64 value; `{a: t, b?: t}` is an object with exactly these members, `b` optional, and `...` allows others; `t[]` is an array; `|` is either):

- `sampleScalar` = `0 | 1 | 2 | -1 | 1.5 | "a" | "b" | "ab" | "" | "é" | "😀" | true | false | null`
- `sampleLeaf` = `sampleScalar | sampleScalar[] | {}`
- `sampleInner` = `sampleLeaf | sampleLeaf[] | {a?: sampleLeaf, b?: sampleLeaf, "'"?: sampleLeaf, "a b"?: sampleLeaf, "\n"?: sampleLeaf, "😀"?: sampleLeaf, "10"?: sampleLeaf, "9"?: sampleLeaf}`
- `sampleDocument` = `sampleInner[] | {a?: sampleInner, b?: sampleInner, "'"?: sampleInner, "\\"?: sampleInner, "\u000b"?: sampleInner, "é"?: sampleInner, "😀"?: sampleInner, "\uffff"?: sampleInner, "10"?: sampleInner, "9"?: sampleInner, "x"?: sampleInner}`

### Properties

A property (`PROP-`) is checked on generated cases. Each case draws a value for every variable
(`x in lo .. hi` is a number in that closed range, `one of` a value from the list), sends the
requests in order as ordinary driver requests (a request may use an earlier response), and
requires every expectation to be true. In the expectations, a call's name stands for its whole
response object (`a.result.x` reads member `x` of the response's `result`; `o[k]` reads
member or element `k`; `a.audit` is the audit text); `==` and `!=` compare JSON values (object
member order does not matter; numbers compare exactly); `+ - * /` are IEEE 754 binary64
arithmetic; `and`, `or`, `not` and `c ? x : y` are as usual; and
- `len(x)` length of a string (UTF-16 code units), array or object

### Operations

| op | input fields (required unless marked optional) | result | audit |
|---|---|---|---|
| `query` | `query` (string), `document` (any) | `{values: any[], paths: string[]}`; `values`, the values of the nodes the query selects, in the order of the nodelist, and `paths`, the normalized path of each of those nodes, in the same order | no |

Results are compared as parsed JSON: member order does not matter, and numbers compare exactly.

### Errors

A request that cannot be handled gets `{"id": <id>, "error": <code>}`. The checks run in this
order, and the first that applies decides the response:

1. `bad_request` when the line is not a JSON object, or `id` is missing or not a string (the response then has `"id": null`)
2. `unknown_op` when `op` is missing, not a string, or not `query`
3. `bad_request` when `input` is missing or not an object, `input.query` is missing or not a string, or `input.document` is missing
4. `invalid_query` when `input.query` is not a well-formed and valid JSONPath query

---

## Requests

**REQ-RQ-001.** *Requests that cannot be handled.*

A request line that cannot be handled MUST get exactly `{"id": <id>, "error": <code>}`,
with the code given by the numbered list under Errors, and the driver MUST then go on to
the next line.

Examples:
- the request line `{not json` ⟶ `id` = `null`; `error` = `"bad_request"`
- the request line `[1]` ⟶ `id` = `null`; `error` = `"bad_request"`
- the request line `{"op":"query","input":{"query":"$","document":1}}` ⟶ `id` = `null`; `error` = `"bad_request"`
- the request line `{"id":7,"op":"query","input":{"query":"$","document":1}}` ⟶ `id` = `null`; `error` = `"bad_request"`
- `query {"query": "$", "document": 1}` (no `op` member) ⟶ `error` = `"unknown_op"`
- the request line `{"id":"r1","op":"select","input":{"query":"$","document":1}}` ⟶ `error` = `"unknown_op"`
- `query` (no `input` member) ⟶ `error` = `"bad_request"`
- the request line `{"id":"r1","op":"query","input":[]}` ⟶ `error` = `"bad_request"`

| document | query | error |
|---|---|---|
| `1` |  | `"bad_request"` |
| `1` | `5` | `"bad_request"` |
| `1` | `null` | `"bad_request"` |
|  | `"$"` | `"bad_request"` |
| `1` | `"$["` | `"invalid_query"` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-RQ-002.** *The result.*

For a query that is well formed and valid, the driver MUST respond
`{"id": <id>, "result": {"values": [...], "paths": [...]}}`. `values` holds the value of
each node of the nodelist the query selects, in the nodelist's order, and `paths` the
Normalized Path of each of those nodes (REQ-NP-001), in the same order, so the two arrays
have the same length. A node selected more than once appears that many times in both. An
empty nodelist is a result like any other: both arrays empty.

Decisions: D-005.

Examples:
- `query {"query": "$", "document": {"k": "v"}}` ⟶ `result` = `{"paths":["$"],"values":[{"k":"v"}]}`
- `query {"query": "$.x", "document": {"k": "v"}}` ⟶ `result` = `{"paths":[],"values":[]}`
- `query {"query": "$[0,0]", "document": ["a"]}` ⟶ `result` = `{"paths":["$[0]","$[0]"],"values":["a","a"]}`

**REQ-RQ-003.** *Any JSON value is a document.*

`input.document` is the document: any JSON value, an object, an array, a string, a number,
`true`, `false` or `null`. A member of the request or of `input` that this document does
not name MUST be ignored.

Examples:
- the request line `{"id":"r1","op":"query","trace":true,"input":{"query":"$.a","document":{"a":1},"flags":"x"}}` ⟶ `result` = `{"paths":["$['a']"],"values":[1]}`

| query | document | result.values | result.paths |
|---|---|---|---|
| `"$"` | `null` | `[null]` | `["$"]` |
| `"$"` | `false` | `[false]` | `["$"]` |
| `"$"` | `"abc"` | `["abc"]` | `["$"]` |
| `"$"` | `1.5` | `[1.5]` | `["$"]` |
| `"$"` | `[]` | `[[]]` | `["$"]` |
| `"$.*"` | `1` | `[]` | `[]` |
| `"$[0]"` | `"abc"` | `[]` | `[]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-RQ-004.** *Queries that are not well formed and valid.*

A query that is not well formed (it does not follow the grammar of the SY section) or not
valid (an integer out of range, REQ-SY-004, or a function expression that is not well
typed, REQ-SY-011) MUST get the error `invalid_query`, whatever the document: whether a
query is well formed and valid never depends on the document. A query that is well formed
and valid MUST NOT get an error, whatever the document: where it finds nothing to select,
it selects nothing.

| query | document | error | result.values |
|---|---|---|---|
| `"$["` | `null` | `"invalid_query"` |  |
| `"$[?length(@.*) < 3]"` | `[]` | `"invalid_query"` |  |
| `"$.a[?length(@.*) < 3]"` | `{"b": 1}` | `"invalid_query"` |  |
| `"$.a.b.c[5]['x']"` | `{"a": 1}` |  | `[]` |
| `"$[?@.a < 'b']"` | `[1, [2], {"a": null}]` |  | `[]` |
| `"$..[?@[-1] == 1]"` | `"text"` |  | `[]` |

(Rows are `query` requests. An empty cell states nothing.)

---

## Well-formed and valid queries

These requirements restate the grammar of RFC 9535 (its Appendix A collects it). A query
that does not follow it is not well formed and gets `invalid_query` (REQ-RQ-004). The
examples give each query with a document; for the ones that are well formed and valid, the
result shows what they select.

**REQ-SY-001.** *The root identifier and blank space.*

A query MUST begin with `$`, with nothing before it, blank space included. After `$` come
zero or more segments (REQ-SY-002 to REQ-SY-006). Blank space MAY come before each segment,
and nowhere else at this level: not after the last segment, and not between a `.` or `..`
and what follows it. No other character is blank space: not form feed, NO-BREAK SPACE
(U+00A0), LINE SEPARATOR (U+2028) nor any other. `@` begins a query only inside a filter
(REQ-SY-007).

| query | document | result.values | error |
|---|---|---|---|
| `"$"` | `{"a": 1}` | `[{"a":1}]` |  |
| `"$ .a"` | `{"a": 1}` | `[1]` |  |
| `"$\t.a"` | `{"a": 1}` | `[1]` |  |
| `"$\n['a']"` | `{"a": 1}` | `[1]` |  |
| `"$\r\n.a \r\n.b"` | `{"a": {"b": 2}}` | `[2]` |  |
| `""` | `1` |  | `"invalid_query"` |
| `" $"` | `1` |  | `"invalid_query"` |
| `"$ "` | `1` |  | `"invalid_query"` |
| `"$\n"` | `1` |  | `"invalid_query"` |
| `"$.a "` | `{"a": 1}` |  | `"invalid_query"` |
| `"$\u000c.a"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$\u00a0.a"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$\u2028.a"` | `{"a": 1}` |  | `"invalid_query"` |
| `"@"` | `1` |  | `"invalid_query"` |
| `"@.a"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$$"` | `1` |  | `"invalid_query"` |
| `"a"` | `1` |  | `"invalid_query"` |
| `"$a"` | `{"a": 1}` |  | `"invalid_query"` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-SY-002.** *Dot notation.*

`.name` is shorthand for `['name']`, and `..name` for `..['name']`; `.*` is shorthand for
`[*]`, and `..*` for `..[*]`. A name written this way MUST begin with an ASCII letter
(`A`-`Z`, `a`-`z`), `_`, or a code point from U+0080 up, and go on with those or the ASCII
digits `0`-`9`. Nothing else may follow a `.` or a `..`: not blank space, a digit, `$`,
`-`, a quote, DEL (U+007F), or nothing at all; and a single `.` is not followed by `[`.
`..` on its own is not a segment. Words such as `true` and `null` are names here like any
other.

| query | document | result.values | error |
|---|---|---|---|
| `"$.a"` | `{"a": 1}` | `[1]` |  |
| `"$._"` | `{"_": 1}` | `[1]` |  |
| `"$._a1"` | `{"_a1": 1}` | `[1]` |  |
| `"$.A"` | `{"A": 1, "a": 2}` | `[1]` |  |
| `"$.é"` | `{"é": 1}` | `[1]` |  |
| `"$.\u0080x"` | `{"\u0080x": 1}` | `[1]` |  |
| `"$.😀"` | `{"😀": 1}` | `[1]` |  |
| `"$.a1b2"` | `{"a1b2": 1}` | `[1]` |  |
| `"$.true"` | `{"true": 1}` | `[1]` |  |
| `"$.null"` | `{"null": 1}` | `[1]` |  |
| `"$.a.b"` | `{"a": {"b": 1}}` | `[1]` |  |
| `"$..a"` | `{"x": {"a": 1}}` | `[1]` |  |
| `"$.*"` | `{"a": 1}` | `[1]` |  |
| `"$..*"` | `{"a": [1]}` | `[[1],1]` |  |
| `"$..['a']"` | `{"a": 1}` | `[1]` |  |
| `"$.Z"` | `{"Z": 1}` | `[1]` |  |
| `"$.z"` | `{"z": 1}` | `[1]` |  |
| `"$.a0z9"` | `{"a0z9": 1}` | `[1]` |  |
| `"$."` | `{"a": 1}` |  | `"invalid_query"` |
| `"$.."` | `{"a": 1}` |  | `"invalid_query"` |
| `"$..."` | `{"a": 1}` |  | `"invalid_query"` |
| `"$...a"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$.1"` | `{"1": 1}` |  | `"invalid_query"` |
| `"$.1a"` | `{"1a": 1}` |  | `"invalid_query"` |
| `"$.$"` | `{"$": 1}` |  | `"invalid_query"` |
| `"$.-a"` | `{"-a": 1}` |  | `"invalid_query"` |
| `"$.a-b"` | `{"a-b": 1}` |  | `"invalid_query"` |
| `"$. a"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$.. a"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$.\ta"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$.'a'"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$.[0]"` | `[1]` |  | `"invalid_query"` |
| `"$.\u007f"` | `{"\u007f": 1}` |  | `"invalid_query"` |
| `"$.a b"` | `{"a b": 1}` |  | `"invalid_query"` |
| `"$.@a"` | `{"@a": 1}` |  | `"invalid_query"` |
| `"$.ˋa"` | `{"ˋa": 1}` |  | `"invalid_query"` |
| `"$.{a"` | `{"{a": 1}` |  | `"invalid_query"` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-SY-003.** *String literals.*

A member name in brackets is a string literal: code points between single quotes `'...'`
or between double quotes `"..."`. Inside it, every code point from U+0020 up stands for
itself, except the backslash `\` and the delimiting quote; the other quote stands for
itself. The escapes are `\b` (U+0008), `\t` (U+0009), `\n` (U+000A), `\f` (U+000C), `\r`
(U+000D), `\/` (`/`), `\\` (`\`), `\'` inside single quotes only, `\"` inside double quotes
only, and `\u` followed by exactly four hexadecimal digits (`0`-`9`, `A`-`F` in either case;
the `u` lower case), which stands for that code point. A code point beyond U+FFFF is
escaped as a high surrogate escape (`\uD800` to `\uDBFF`) followed at once by a low one
(`\uDC00` to `\uDFFF`). A string literal MUST be rejected (`invalid_query`) when it holds a
code point below U+0020 as itself, any other escape, a `\u` with fewer than four
hexadecimal digits, a surrogate escape that is not part of such a pair, or no closing
quote. String literals in filters (REQ-SY-008) are written the same way.

| query | document | result.values | error |
|---|---|---|---|
| `"$['a']"` | `{"a": 1, "b": 2}` | `[1]` |  |
| `"$[\"a\"]"` | `{"a": 1, "b": 2}` | `[1]` |  |
| `"$['\\'']"` | `{"'": 2}` | `[2]` |  |
| `"$[\"'\"]"` | `{"'": 2}` | `[2]` |  |
| `"$['\"']"` | `{"\"": 3}` | `[3]` |  |
| `"$[\"\\\"\"]"` | `{"\"": 3}` | `[3]` |  |
| `"$['\\\\']"` | `{"\\": 4}` | `[4]` |  |
| `"$['\\/']"` | `{"/": 5}` | `[5]` |  |
| `"$['/']"` | `{"/": 5}` | `[5]` |  |
| `"$['\\n']"` | `{"\n": 6}` | `[6]` |  |
| `"$['\\u000A']"` | `{"\n": 6}` | `[6]` |  |
| `"$['\\u000a']"` | `{"\n": 6}` | `[6]` |  |
| `"$['\\u00e9']"` | `{"é": 7}` | `[7]` |  |
| `"$['\\u00E9']"` | `{"é": 7}` | `[7]` |  |
| `"$['é']"` | `{"é": 7}` | `[7]` |  |
| `"$['\\uD83D\\uDE00']"` | `{"😀": 8}` | `[8]` |  |
| `"$['\\ud83d\\ude00']"` | `{"😀": 8}` | `[8]` |  |
| `"$['😀']"` | `{"😀": 8}` | `[8]` |  |
| `"$['\\u000b']"` | `{"\u000b": 9}` | `[9]` |  |
| `"$['a b']"` | `{"a b": 10}` | `[10]` |  |
| `"$['\u007f']"` | `{"\u007f": 11}` | `[11]` |  |
| `"$['\u2028']"` | `{"\u2028": 12}` | `[12]` |  |
| `"$['']"` | `{"": 13}` | `[13]` |  |
| `"$['\\b\\f\\r\\t']"` | `{"\b\f\r\t": 14}` | `[14]` |  |
| `"$['\\uD800\\uDC00']"` | `{"\ud800\udc00": 15}` | `[15]` |  |
| `"$['\\uDBFF\\uDFFF']"` | `{"\udbff\udfff": 16}` | `[16]` |  |
| `"$['\\uD7FF']"` | `{"\ud7ff": 17}` | `[17]` |  |
| `"$['\\uE000']"` | `{"\ue000": 18}` | `[18]` |  |
| `"$['\\u002F']"` | `{"/": 19}` | `[19]` |  |
| `"$['\\u002f']"` | `{"/": 19}` | `[19]` |  |
| `"$['\\\"']"` | `{"\"": 3}` |  | `"invalid_query"` |
| `"$[\"\\'\"]"` | `{"'": 2}` |  | `"invalid_query"` |
| `"$['\\q']"` | `{"q": 1}` |  | `"invalid_query"` |
| `"$['\\x41']"` | `{"A": 1}` |  | `"invalid_query"` |
| `"$['\\U0041']"` | `{"A": 1}` |  | `"invalid_query"` |
| `"$['\\u004']"` | `{"\u0004": 1}` |  | `"invalid_query"` |
| `"$['\\uD83D']"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['\\uDE00']"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['\\uD83Dx']"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['\\uD83D\\u0041']"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['\\uDBFF']"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['\\uDC00']"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['\\uDFFF']"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['\\uD800\\uDBFF']"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['\n']"` | `{"\n": 6}` |  | `"invalid_query"` |
| `"$['\t']"` | `{"\t": 1}` |  | `"invalid_query"` |
| `"$['\u0000']"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['\u001f']"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['a"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['a\"]"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['a'"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$[a]"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['a'b']"` | `{"a": 1}` |  | `"invalid_query"` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-SY-004.** *Index selectors and integers.*

An index is written `0`, or an optional `-` followed by a digit `1`-`9` and any further
digits: no leading zeros (`01`), no `-0`, no `+`, no fraction, no exponent. Its value MUST
lie in the range of exact integers of I-JSON, -(2^53)+1 to (2^53)-1, that is
-9007199254740991 to 9007199254740991; outside that range the query is not valid. The
integers of a slice are written and bounded the same way (REQ-SY-005).

Decisions: D-002.

| query | document | result.values | error |
|---|---|---|---|
| `"$[1]"` | `["a", "b"]` | `["b"]` |  |
| `"$[0]"` | `["a"]` | `["a"]` |  |
| `"$[-1]"` | `["a", "b"]` | `["b"]` |  |
| `"$[ 1 ]"` | `["a", "b"]` | `["b"]` |  |
| `"$[9007199254740991]"` | `["a"]` | `[]` |  |
| `"$[-9007199254740991]"` | `["a"]` | `[]` |  |
| `"$[01]"` | `["a"]` |  | `"invalid_query"` |
| `"$[-0]"` | `["a"]` |  | `"invalid_query"` |
| `"$[+1]"` | `["a"]` |  | `"invalid_query"` |
| `"$[1.0]"` | `["a"]` |  | `"invalid_query"` |
| `"$[1e1]"` | `["a"]` |  | `"invalid_query"` |
| `"$[0x1]"` | `["a"]` |  | `"invalid_query"` |
| `"$[9007199254740992]"` | `["a"]` |  | `"invalid_query"` |
| `"$[-9007199254740992]"` | `["a"]` |  | `"invalid_query"` |
| `"$[99999999999999999999]"` | `["a"]` |  | `"invalid_query"` |
| `"$[1 1]"` | `["a"]` |  | `"invalid_query"` |
| `"$[-]"` | `["a"]` |  | `"invalid_query"` |
| `"$[- 1]"` | `["a"]` |  | `"invalid_query"` |
| `"$[]"` | `["a"]` |  | `"invalid_query"` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-SY-005.** *Slice selectors.*

A slice is written `start:end:step`. Each of the three is optional: `start` before the
first colon, `end` after it, and `step` after a second colon, which MAY be left out when
`step` is. Each is an integer, written and bounded as REQ-SY-004 says. Blank space MAY come
before and after each colon. A third colon is not well formed.

Decisions: D-002.

| query | document | result.values | error |
|---|---|---|---|
| `"$[:]"` | `["a", "b", "c"]` | `["a","b","c"]` |  |
| `"$[::]"` | `["a", "b", "c"]` | `["a","b","c"]` |  |
| `"$[1:]"` | `["a", "b", "c"]` | `["b","c"]` |  |
| `"$[:2]"` | `["a", "b", "c"]` | `["a","b"]` |  |
| `"$[::2]"` | `["a", "b", "c"]` | `["a","c"]` |  |
| `"$[ 1 : 2 : 1 ]"` | `["a", "b", "c"]` | `["b"]` |  |
| `"$[1: :1]"` | `["a", "b", "c"]` | `["b","c"]` |  |
| `"$[::-1]"` | `["a", "b", "c"]` | `["c","b","a"]` |  |
| `"$[:9007199254740991]"` | `["a", "b", "c"]` | `["a","b","c"]` |  |
| `"$[-9007199254740991:]"` | `["a", "b", "c"]` | `["a","b","c"]` |  |
| `"$[1:2:3:4]"` | `["a", "b", "c"]` |  | `"invalid_query"` |
| `"$[-0:]"` | `["a", "b", "c"]` |  | `"invalid_query"` |
| `"$[:-0]"` | `["a", "b", "c"]` |  | `"invalid_query"` |
| `"$[::-0]"` | `["a", "b", "c"]` |  | `"invalid_query"` |
| `"$[01:]"` | `["a", "b", "c"]` |  | `"invalid_query"` |
| `"$[:9007199254740992]"` | `["a", "b", "c"]` |  | `"invalid_query"` |
| `"$[::9007199254740992]"` | `["a", "b", "c"]` |  | `"invalid_query"` |
| `"$[1.0:]"` | `["a", "b", "c"]` |  | `"invalid_query"` |
| `"$[1 2:]"` | `["a", "b", "c"]` |  | `"invalid_query"` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-SY-006.** *Bracketed selections.*

A bracketed selection is `[`, one or more selectors separated by commas, and `]`, with
blank space allowed after `[`, before and after each comma, and before `]`. A selector is a
string literal (a name selector, REQ-SY-003), `*` (a wildcard), an index (REQ-SY-004), a
slice (REQ-SY-005), or a filter (`?` and a logical expression, REQ-SY-007). An empty
selection, an empty selector between commas, a trailing comma, and two selectors without a
comma between them are not well formed.

| query | document | result.values | error |
|---|---|---|---|
| `"$['a','b']"` | `{"a": 1, "b": 2}` | `[1,2]` |  |
| `"$[ 'a' , 'b' ]"` | `{"a": 1, "b": 2}` | `[1,2]` |  |
| `"$[\n'b',\t'a'\r]"` | `{"a": 1, "b": 2}` | `[2,1]` |  |
| `"$[*,'a']"` | `{"a": 1, "b": 2}` | `[1,2,1]` |  |
| `"$[?@ == 2, 'a']"` | `{"a": 1, "b": 2}` | `[2,1]` |  |
| `"$[ ]"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$[,'a']"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['a',]"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['a',,'b']"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['a''b']"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['a' 'b']"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$[['a']]"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$['a']]"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$[**]"` | `{"a": 1}` |  | `"invalid_query"` |
| `"$[*a]"` | `{"a": 1}` |  | `"invalid_query"` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-SY-007.** *Filter expressions.*

A filter is `?`, optional blank space, and a logical expression. A logical expression is
one or more conjunctions joined by `||`; a conjunction is one or more basic expressions
joined by `&&`; blank space MAY come before and after `||` and `&&`. A basic expression is
one of:

1. a parenthesized logical expression, `(` and `)` around it, with blank space allowed
   inside them at both ends, and optionally `!` before it (blank space allowed between);
2. a test: a query that begins with `@` or `$` (segments as REQ-SY-001 to REQ-SY-006 say),
   or a function expression (REQ-SY-010), optionally with `!` before it (blank space
   allowed between);
3. a comparison: a comparable, a comparison operator, and a comparable, with blank space
   allowed before and after the operator. The operators are `==`, `!=`, `<`, `<=`, `>` and
   `>=`. A comparable is a literal (REQ-SY-008), a singular query (REQ-SY-009), or a
   function expression.

Nothing else is well formed. In particular, a literal on its own is not a test (`?true`,
`?1`); `!` applies only to a test or a parenthesized expression, so `!@.a == 1` and `!!@.a`
are not well formed; comparisons do not chain (`1 < 2 < 3`); and `&`, `|`, `and`, `or`,
`=`, `===`, `<>` and `=<` are not operators.

| query | document | result.values | error |
|---|---|---|---|
| `"$[?@]"` | `[1, 2, {"a": 1}]` | `[1,2,{"a":1}]` |  |
| `"$[? @]"` | `[1, 2, {"a": 1}]` | `[1,2,{"a":1}]` |  |
| `"$[?@ ]"` | `[1, 2, {"a": 1}]` | `[1,2,{"a":1}]` |  |
| `"$[?(@)]"` | `[1, 2, {"a": 1}]` | `[1,2,{"a":1}]` |  |
| `"$[?( @ )]"` | `[1, 2, {"a": 1}]` | `[1,2,{"a":1}]` |  |
| `"$[?!@.a]"` | `[1, 2, {"a": 1}]` | `[1,2]` |  |
| `"$[?! @.a]"` | `[1, 2, {"a": 1}]` | `[1,2]` |  |
| `"$[?!(@.a)]"` | `[1, 2, {"a": 1}]` | `[1,2]` |  |
| `"$[?! ( @.a )]"` | `[1, 2, {"a": 1}]` | `[1,2]` |  |
| `"$[?!(!@.a)]"` | `[1, 2, {"a": 1}]` | `[{"a":1}]` |  |
| `"$[?@ == 1]"` | `[1, 2, {"a": 1}]` | `[1]` |  |
| `"$[?@==1]"` | `[1, 2, {"a": 1}]` | `[1]` |  |
| `"$[?1 == @]"` | `[1, 2, {"a": 1}]` | `[1]` |  |
| `"$[?@ > 1 && @ < 3]"` | `[1, 2, {"a": 1}]` | `[2]` |  |
| `"$[?@ == 1 \|\| @.a]"` | `[1, 2, {"a": 1}]` | `[1,{"a":1}]` |  |
| `"$[?(@ == 1)]"` | `[1, 2, {"a": 1}]` | `[1]` |  |
| `"$[?1 == 1]"` | `[1, 2, {"a": 1}]` | `[1,2,{"a":1}]` |  |
| `"$[?]"` | `[1]` |  | `"invalid_query"` |
| `"$[? ]"` | `[1]` |  | `"invalid_query"` |
| `"$[?()]"` | `[1]` |  | `"invalid_query"` |
| `"$[?true]"` | `[1]` |  | `"invalid_query"` |
| `"$[?false]"` | `[1]` |  | `"invalid_query"` |
| `"$[?null]"` | `[1]` |  | `"invalid_query"` |
| `"$[?1]"` | `[1]` |  | `"invalid_query"` |
| `"$[?'a']"` | `[1]` |  | `"invalid_query"` |
| `"$[?!@.a == 1]"` | `[1]` |  | `"invalid_query"` |
| `"$[?!!@.a]"` | `[1]` |  | `"invalid_query"` |
| `"$[?!1]"` | `[1]` |  | `"invalid_query"` |
| `"$[?1 < 2 < 3]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ & @]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ \| @]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ and @]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ or @]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ = 1]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ === 1]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ <> 1]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ =< 1]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ => 1]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ !== 1]"` | `[1]` |  | `"invalid_query"` |
| `"$[?(@]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@)]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ == ]"` | `[1]` |  | `"invalid_query"` |
| `"$[?== 1]"` | `[1]` |  | `"invalid_query"` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-SY-008.** *Literals.*

A literal is a number, a string literal (as in REQ-SY-003), `true`, `false` or `null`. A
number is an integer part (`0`, `-0`, or an optional `-` followed by a digit `1`-`9` and any
further digits), then optionally a fraction (`.` and one or more digits), then optionally an
exponent (`e` or `E`, an optional `+` or `-`, one or more digits). Its value is the number
it writes. `true`, `false` and `null` are lower case only. Anything else is not a literal:
`01`, `1.`, `.5`, `+1`, `1e`, `0x10`, `1_000`, `Infinity`, `NaN`, `True`, `NULL`, `nul`.
A number literal is not checked against the I-JSON range of REQ-SY-004 (decision D-002).

Decisions: D-002.

| query | document | result.values | error |
|---|---|---|---|
| `"$[?@ == -0]"` | `[0, 1, 100, -1.5, 0.001, true, null, "x"]` | `[0]` |  |
| `"$[?@ == 0.0]"` | `[0, 1, 100, -1.5, 0.001, true, null, "x"]` | `[0]` |  |
| `"$[?@ == -0.0]"` | `[0, 1, 100, -1.5, 0.001, true, null, "x"]` | `[0]` |  |
| `"$[?@ == 1e2]"` | `[0, 1, 100, -1.5, 0.001, true, null, "x"]` | `[100]` |  |
| `"$[?@ == 1E2]"` | `[0, 1, 100, -1.5, 0.001, true, null, "x"]` | `[100]` |  |
| `"$[?@ == 1e+2]"` | `[0, 1, 100, -1.5, 0.001, true, null, "x"]` | `[100]` |  |
| `"$[?@ == 100.0e0]"` | `[0, 1, 100, -1.5, 0.001, true, null, "x"]` | `[100]` |  |
| `"$[?@ == -1.5]"` | `[0, 1, 100, -1.5, 0.001, true, null, "x"]` | `[-1.5]` |  |
| `"$[?@ == -15e-1]"` | `[0, 1, 100, -1.5, 0.001, true, null, "x"]` | `[-1.5]` |  |
| `"$[?@ == 1e-3]"` | `[0, 1, 100, -1.5, 0.001, true, null, "x"]` | `[0.001]` |  |
| `"$[?@ == true]"` | `[0, 1, 100, -1.5, 0.001, true, null, "x"]` | `[true]` |  |
| `"$[?@ == null]"` | `[0, 1, 100, -1.5, 0.001, true, null, "x"]` | `[null]` |  |
| `"$[?@ == 'x']"` | `[0, 1, 100, -1.5, 0.001, true, null, "x"]` | `["x"]` |  |
| `"$[?@ == \"x\"]"` | `[0, 1, 100, -1.5, 0.001, true, null, "x"]` | `["x"]` |  |
| `"$[?@ == 9007199254740993]"` | `["a"]` | `[]` |  |
| `"$[?@ == 1e400]"` | `["a"]` | `[]` |  |
| `"$[?@ == 01]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ == 1.]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ == .5]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ == +1]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ == 1e]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ == 1e+]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ == 0x10]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ == 1_000]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ == Infinity]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ == NaN]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ == True]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ == NULL]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ == nul]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ == -]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ == --1]"` | `[1]` |  | `"invalid_query"` |
| `"$[?@ == 'x]"` | `[1]` |  | `"invalid_query"` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-SY-009.** *Singular queries.*

Where a comparison needs a value, its query MUST be a singular query: `@` or `$` followed by
zero or more segments, each of them `.name` (REQ-SY-002), `[` and a string literal and `]`,
or `[` and an index and `]`, with blank space allowed before each segment but not inside
its brackets. A query that is not singular in this sense is not well formed as a
comparable, even if it can select at most one node in any document: a wildcard, a slice, a
descendant segment, a filter, more than one selector in a bracket, or blank space inside a
bracket each makes a query non-singular. A singular query selects at most one node, and
the value of that node is what is compared (REQ-FI-003).

Decisions: D-003.

| query | document | result.values | error |
|---|---|---|---|
| `"$[?@.a == 1]"` | `[{"a": 1, "b": [5, 6]}]` | `[{"a":1,"b":[5,6]}]` |  |
| `"$[?@['a'] == 1]"` | `[{"a": 1, "b": [5, 6]}]` | `[{"a":1,"b":[5,6]}]` |  |
| `"$[?@[\"a\"] == 1]"` | `[{"a": 1, "b": [5, 6]}]` | `[{"a":1,"b":[5,6]}]` |  |
| `"$[?@.b[1] == 6]"` | `[{"a": 1, "b": [5, 6]}]` | `[{"a":1,"b":[5,6]}]` |  |
| `"$[?@.b[-1] == 6]"` | `[{"a": 1, "b": [5, 6]}]` | `[{"a":1,"b":[5,6]}]` |  |
| `"$[?@ .b [0] == 5]"` | `[{"a": 1, "b": [5, 6]}]` | `[{"a":1,"b":[5,6]}]` |  |
| `"$[?$[0].a == 1]"` | `[{"a": 1, "b": [5, 6]}]` | `[{"a":1,"b":[5,6]}]` |  |
| `"$[?@ == $[0]]"` | `[{"a": 1, "b": [5, 6]}]` | `[{"a":1,"b":[5,6]}]` |  |
| `"$[?@[ 'a' ] == 1]"` | `[{"a": 1}]` |  | `"invalid_query"` |
| `"$[?@['a' ] == 1]"` | `[{"a": 1}]` |  | `"invalid_query"` |
| `"$[?@[ 0] == 1]"` | `[[1]]` |  | `"invalid_query"` |
| `"$[?@.* == 1]"` | `[{"a": 1}]` |  | `"invalid_query"` |
| `"$[?@[*] == 1]"` | `[[1]]` |  | `"invalid_query"` |
| `"$[?@[0,1] == 1]"` | `[[1]]` |  | `"invalid_query"` |
| `"$[?@['a','b'] == 1]"` | `[{"a": 1}]` |  | `"invalid_query"` |
| `"$[?@[0:1] == 1]"` | `[[1]]` |  | `"invalid_query"` |
| `"$[?@..a == 1]"` | `[{"a": 1}]` |  | `"invalid_query"` |
| `"$[?@[?@] == 1]"` | `[[1]]` |  | `"invalid_query"` |
| `"$[?1 == @..a]"` | `[{"a": 1}]` |  | `"invalid_query"` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-SY-010.** *Function expressions.*

A function expression is a function name followed at once by `(`, then zero or more
arguments separated by commas, then `)`; blank space MAY come after `(`, before and after
each comma, and before `)`. A function name is a lower-case ASCII letter followed by any
number of lower-case ASCII letters, ASCII digits and `_`. An argument is a literal, a query,
a logical expression or another function expression. The functions are `length`, `count`,
`match`, `search` and `value` (FN section), taking one, one, two, two and one arguments; a
query that names any other function, or gives a function another number of arguments, is
not valid.

Decisions: D-004.

| query | document | result.values | error |
|---|---|---|---|
| `"$[?length(@) == 2]"` | `["ab", [1, 2]]` | `["ab",[1,2]]` |  |
| `"$[?length( @ ) == 2]"` | `["ab", [1, 2]]` | `["ab",[1,2]]` |  |
| `"$[?length(\n@\n) == 2]"` | `["ab", [1, 2]]` | `["ab",[1,2]]` |  |
| `"$[?match(@ , 'a.')]"` | `["ab", [1, 2]]` | `["ab"]` |  |
| `"$[?search( @,'b' )]"` | `["ab", [1, 2]]` | `["ab"]` |  |
| `"$[?length (@) == 2]"` | `["ab"]` |  | `"invalid_query"` |
| `"$[?Length(@) == 2]"` | `["ab"]` |  | `"invalid_query"` |
| `"$[?LENGTH(@) == 2]"` | `["ab"]` |  | `"invalid_query"` |
| `"$[?len(@) == 2]"` | `["ab"]` |  | `"invalid_query"` |
| `"$[?foo(@)]"` | `["ab"]` |  | `"invalid_query"` |
| `"$[?constructor(@)]"` | `["ab"]` |  | `"invalid_query"` |
| `"$[?length() == 2]"` | `["ab"]` |  | `"invalid_query"` |
| `"$[?length(@, @) == 2]"` | `["ab"]` |  | `"invalid_query"` |
| `"$[?count() == 1]"` | `["ab"]` |  | `"invalid_query"` |
| `"$[?match(@)]"` | `["ab"]` |  | `"invalid_query"` |
| `"$[?match(@, 'a', 'b')]"` | `["ab"]` |  | `"invalid_query"` |
| `"$[?value() == 1]"` | `["ab"]` |  | `"invalid_query"` |
| `"$[?length(@ == 2]"` | `["ab"]` |  | `"invalid_query"` |
| `"$[?length@ == 2]"` | `["ab"]` |  | `"invalid_query"` |
| `"$[?_length(@) == 2]"` | `["ab"]` |  | `"invalid_query"` |
| `"$[?length(@,) == 2]"` | `["ab"]` |  | `"invalid_query"` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-SY-011.** *Well-typed function expressions.*

Every function expression in a query MUST be well typed (RFC 9535, section 2.4.3). Each
function has declared types: `length` takes a value and gives a value; `count` takes a
nodelist and gives a value; `match` and `search` take two values and give a logical
result; `value` takes a nodelist and gives a value. Then:

1. As a test (on its own, or after `!`), a function expression MUST give a logical result,
   as `match` and `search` do; `length`, `count` and `value` are not tests.
2. As a comparable, a function expression MUST give a value, as `length`, `count` and
   `value` do; `match` and `search` are not comparables.
3. Where a value is expected, an argument MUST be a literal, a singular query
   (REQ-SY-009), or a function expression that gives a value.
4. Where a nodelist is expected, an argument MUST be a query: any query, singular or not,
   not inside parentheses.

A logical expression (a comparison, `!`, `&&`, `||`, or anything in parentheses) is never
an argument of these five functions.

| query | document | result.values | error |
|---|---|---|---|
| `"$[?length(@.a) == 1]"` | `[{"a": "x", "b": [1, 2]}]` | `[{"a":"x","b":[1,2]}]` |  |
| `"$[?length('abc') == 3]"` | `[{"a": "x", "b": [1, 2]}]` | `[{"a":"x","b":[1,2]}]` |  |
| `"$[?length(true) == length(1)]"` | `[{"a": "x", "b": [1, 2]}]` | `[{"a":"x","b":[1,2]}]` |  |
| `"$[?length(count(@.*)) == length(1)]"` | `[{"a": "x", "b": [1, 2]}]` | `[{"a":"x","b":[1,2]}]` |  |
| `"$[?length(value(@.b)) == 2]"` | `[{"a": "x", "b": [1, 2]}]` | `[{"a":"x","b":[1,2]}]` |  |
| `"$[?count(@.*) == 2]"` | `[{"a": "x", "b": [1, 2]}]` | `[{"a":"x","b":[1,2]}]` |  |
| `"$[?count(@) == 1]"` | `[{"a": "x", "b": [1, 2]}]` | `[{"a":"x","b":[1,2]}]` |  |
| `"$[?count(@..*) == 4]"` | `[{"a": "x", "b": [1, 2]}]` | `[{"a":"x","b":[1,2]}]` |  |
| `"$[?count($..*) == 5]"` | `[{"a": "x", "b": [1, 2]}]` | `[{"a":"x","b":[1,2]}]` |  |
| `"$[?match(@.a, 'x')]"` | `[{"a": "x", "b": [1, 2]}]` | `[{"a":"x","b":[1,2]}]` |  |
| `"$[?match('x', @.a)]"` | `[{"a": "x", "b": [1, 2]}]` | `[{"a":"x","b":[1,2]}]` |  |
| `"$[?search(@.a, @.a)]"` | `[{"a": "x", "b": [1, 2]}]` | `[{"a":"x","b":[1,2]}]` |  |
| `"$[?match(length(@.b), '2')]"` | `[{"a": "x", "b": [1, 2]}]` | `[]` |  |
| `"$[?value(@..a) == 'x']"` | `[{"a": "x", "b": [1, 2]}]` | `[{"a":"x","b":[1,2]}]` |  |
| `"$[?value(@.*) == 'x']"` | `[{"a": "x", "b": [1, 2]}]` | `[]` |  |
| `"$[?length(@)]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?count(@.*)]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?value(@.a)]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?!length(@)]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?match(@.a, 'x') == true]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?search(@.a, 'x') != false]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?length(@.*) == 2]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?length(@..a) == 1]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?length(@[0,1]) == 1]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?length(match(@.a, 'x')) == 1]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?length(@.a == 'x') == 1]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?length(!@.a) == 1]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?count(1) == 1]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?count('a') == 1]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?count(length(@)) == 1]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?count(value(@.b)) == 1]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?count(@.a == 'x') == 1]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?count((@.a)) == 1]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?value(1) == 1]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?value(count(@.*)) == 2]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?match(@.*, 'x')]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?match(@.a, @.*)]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?match(@.a == 'x', 'x')]"` | `[{"a": "x"}]` |  | `"invalid_query"` |
| `"$[?length(@.a) == count(1)]"` | `[{"a": "x"}]` |  | `"invalid_query"` |

(Rows are `query` requests. An empty cell states nothing.)

---

## Segments and selectors

A query's nodelist starts as the document's root node (REQ-SE-001). Each segment is applied
to each node of the nodelist so far, in order, and the nodelists it produces for them are
concatenated, in the same order, into the next nodelist. A segment that finds nothing to
select for a node produces an empty nodelist for it, never an error; once a nodelist is
empty, the query's result is empty.

**REQ-SE-001.** *The root.* `$` produces a nodelist of one node: the document itself, at the Normalized Path `$`.

Examples:
- `query {"query": "$", "document": [1, {"a": 2}]}` ⟶ `result` = `{"paths":["$"],"values":[[1,{"a":2}]]}`

**EV-EV-RFC.** *The examples of RFC 9535.* Evidence of kind `published`. The RFC marks some of these results as one of several allowed orders ("Alternative result",
"Non-deterministic ordering"). The rows whose order is not the one decision D-001 picks are
waived; each of them has a row of the same query in D-001's order, or an example that gives
it.

The suite checks all 43 rows, and checks the 9 waived rows against this specification instead (D-001). The first 8:

| query | document | result.values | result.paths |
|---|---|---|---|
| `"$"` | `{"k":"v"}` | `[{"k":"v"}]` | `["$"]` |
| `"$.o['j j']"` | `{"'":{"@":2},"o":{"j j":{"k.k":3}}}` | `[{"k.k":3}]` | `["$['o']['j j']"]` |
| `"$.o['j j']['k.k']"` | `{"'":{"@":2},"o":{"j j":{"k.k":3}}}` | `[3]` | `["$['o']['j j']['k.k']"]` |
| `"$.o[\"j j\"][\"k.k\"]"` | `{"'":{"@":2},"o":{"j j":{"k.k":3}}}` | `[3]` | `["$['o']['j j']['k.k']"]` |
| `"$[\"'\"][\"@\"]"` | `{"'":{"@":2},"o":{"j j":{"k.k":3}}}` | `[2]` | `["$['\\'']['@']"]` |
| `"$.o[*]"` | `{"a":[5,3],"o":{"j":1,"k":2}}` | `[1,2]` | `["$['o']['j']","$['o']['k']"]` |
| `"$.a[*]"` | `{"a":[5,3],"o":{"j":1,"k":2}}` | `[5,3]` | `["$['a'][0]","$['a'][1]"]` |
| `"$[1]"` | `["a","b"]` | `["b"]` | `["$[1]"]` |

(Rows are `query` requests.)

**REQ-SE-002.** *Name selectors.*

A name selector selects, from an object, the value of the member whose name is its string;
it selects nothing from an object without such a member, and nothing from an array or a
primitive value. Two names are the same when they are the same sequence of code points: no
case folding, no Unicode normalization. Only the document's own members count: a name such
as `constructor` or `toString` finds nothing unless the document has a member of that name.

| query | document | result.values | result.paths |
|---|---|---|---|
| `"$.a"` | `{"a": 1}` | `[1]` | `["$['a']"]` |
| `"$.A"` | `{"a": 1}` | `[]` | `[]` |
| `"$['a']"` | `["a"]` | `[]` | `[]` |
| `"$['0']"` | `["x"]` | `[]` | `[]` |
| `"$['0']"` | `{"0": "x"}` | `["x"]` | `["$['0']"]` |
| `"$.a"` | `"a"` | `[]` | `[]` |
| `"$['é']"` | `{"e\u0301": 1}` | `[]` | `[]` |
| `"$['e\u0301']"` | `{"e\u0301": 1, "é": 2}` | `[1]` | `["$['é']"]` |
| `"$['']"` | `{"": 1}` | `[1]` | `["$['']"]` |
| `"$.constructor"` | `{}` | `[]` | `[]` |
| `"$.toString"` | `{"a": 1}` | `[]` | `[]` |
| `"$.__proto__"` | `{"__proto__": 1}` | `[1]` | `["$['__proto__']"]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-SE-003.** *Wildcard selectors.*

A wildcard selects all the children of a node: the elements of an array, in order, and the
member values of an object, in the order of their names (REQ-SE-008). It selects nothing
from a primitive value.

Decisions: D-001.

| query | document | result.values | result.paths |
|---|---|---|---|
| `"$[*]"` | `[3, 1, 2]` | `[3,1,2]` | `["$[0]","$[1]","$[2]"]` |
| `"$.*"` | `{"b": 1, "a": 2}` | `[2,1]` | `["$['a']","$['b']"]` |
| `"$.*"` | `5` | `[]` | `[]` |
| `"$.*"` | `"ab"` | `[]` | `[]` |
| `"$[*]"` | `[]` | `[]` | `[]` |
| `"$[*]"` | `{}` | `[]` | `[]` |
| `"$.*.*"` | `{"x": [1, 2], "y": {"z": 3}}` | `[1,2,3]` | `["$['x'][0]","$['x'][1]","$['y']['z']"]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-SE-004.** *Index selectors.*

An index selector selects from an array the element at that index, counting from 0. A
negative index counts from the end: the array's length is added to it, so `-1` is the last
element. An index that is outside the array, after this, selects nothing; so does an index
applied to an object or to a primitive value (a string is not an array of characters).

| query | document | result.values | result.paths |
|---|---|---|---|
| `"$[0]"` | `["a", "b"]` | `["a"]` | `["$[0]"]` |
| `"$[-1]"` | `["a", "b"]` | `["b"]` | `["$[1]"]` |
| `"$[2]"` | `["a", "b"]` | `[]` | `[]` |
| `"$[-3]"` | `["a", "b"]` | `[]` | `[]` |
| `"$[0]"` | `{"0": "a"}` | `[]` | `[]` |
| `"$[0]"` | `"ab"` | `[]` | `[]` |
| `"$[0][1]"` | `[[1, 2]]` | `[2]` | `["$[0][1]"]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-SE-005.** *Slice selectors.*

A slice selects elements of an array, in the array's order or in reverse, and nothing from
an object or a primitive value. Let `len` be the array's length. `step` defaults to 1, and
when `step` is 0 nothing is selected. When `step` is positive, `start` defaults to 0 and
`end` to `len`; when it is negative, `start` defaults to `len - 1` and `end` to `-len - 1`.
A negative `start` or `end` has `len` added to it. Then:

- for a positive `step`, `lower = min(max(start, 0), len)` and
  `upper = min(max(end, 0), len)`, and the elements at `lower`, `lower + step`,
  `lower + 2 * step` and so on, while the index is below `upper`, are selected, in that
  order;
- for a negative `step`, `upper = min(max(start, -1), len - 1)` and
  `lower = min(max(end, -1), len - 1)`, and the elements at `upper`, `upper + step` and so
  on, while the index is above `lower`, are selected, in that order.

Examples:
- `query {"query": "$[5:1:-2]", "document": ["a", "b", "c", "d", "e", "f", "g"]}` ⟶ `result.paths` = `["$[5]","$[3]"]`

| query | document | result.values |
|---|---|---|
| `"$[1:3]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["b","c"]` |
| `"$[5:]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["f","g"]` |
| `"$[:2]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["a","b"]` |
| `"$[-2:]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["f","g"]` |
| `"$[:-5]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["a","b"]` |
| `"$[1:5:2]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["b","d"]` |
| `"$[5:1:-2]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["f","d"]` |
| `"$[::-1]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["g","f","e","d","c","b","a"]` |
| `"$[::3]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["a","d","g"]` |
| `"$[::-3]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["g","d","a"]` |
| `"$[1:1]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `[]` |
| `"$[3:1]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `[]` |
| `"$[3:1:-1]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["d","c"]` |
| `"$[0:7:0]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `[]` |
| `"$[::0]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `[]` |
| `"$[10:]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `[]` |
| `"$[-10:2]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["a","b"]` |
| `"$[:100]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["a","b","c","d","e","f","g"]` |
| `"$[-1:-10:-1]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["g","f","e","d","c","b","a"]` |
| `"$[6:-8:-2]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["g","e","c","a"]` |
| `"$[:0]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `[]` |
| `"$[:-7]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `[]` |
| `"$[-10::-1]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `[]` |
| `"$[10::-1]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["g","f","e","d","c","b","a"]` |
| `"$[7:0:-1]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["g","f","e","d","c","b"]` |
| `"$[-9007199254740991:9007199254740991:9007199254740991]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["a"]` |
| `"$[0:2]"` | `{"0": 1, "1": 2}` | `[]` |
| `"$[:]"` | `"abc"` | `[]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-SE-006.** *Child segments.*

A bracketed selection applies each of its selectors, in the order written, to each node of
its input, and concatenates their results; a node that more than one selector selects
appears once for each. The results for the input's nodes are concatenated in the order of
the input nodelist.

| query | document | result.values | result.paths |
|---|---|---|---|
| `"$[0, 3]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["a","d"]` | `["$[0]","$[3]"]` |
| `"$[3, 0]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["d","a"]` | `["$[3]","$[0]"]` |
| `"$[0:2, 5]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["a","b","f"]` | `["$[0]","$[1]","$[5]"]` |
| `"$[0, 0]"` | `["a", "b", "c", "d", "e", "f", "g"]` | `["a","a"]` | `["$[0]","$[0]"]` |
| `"$[*, 0]"` | `["a", "b"]` | `["a","b","a"]` | `["$[0]","$[1]","$[0]"]` |
| `"$['b', 'a']"` | `{"a": 1, "b": 2}` | `[2,1]` | `["$['b']","$['a']"]` |
| `"$['a', 0]"` | `{"a": 1}` | `[1]` | `["$['a']"]` |
| `"$['a', 0]"` | `[5]` | `[5]` | `["$[0]"]` |
| `"$[*][0]"` | `[[1, 2], [3], [], 4]` | `[1,3]` | `["$[0][0]","$[1][0]"]` |
| `"$[1, 0][0]"` | `[["a"], ["b"]]` | `["b","a"]` | `["$[1][0]","$[0][0]"]` |

(Rows are `query` requests. An empty cell states nothing.)

**PROP-SE-P1.** *Two selectors in one segment give both results.*

- For `d` in `sampleDocument`:
  - `a` is the response to `query {"query": "$..[*]", "document": d}`
  - `b` is the response to `query {"query": "$..[*, *]", "document": d}`
  - then `len(b.result.values) == 2 * len(a.result.values)`
- The suite checks this on 200 generated cases.

**REQ-SE-007.** *Descendant segments.*

A descendant segment `..[<selectors>]` visits its input node and then all of its
descendants, each node before its own descendants, the elements of an array in order and
the members of an object in the order of their names (REQ-SE-008), and applies the
bracketed selection to each visited node in turn, the input node first. The results are
concatenated in that order, and then, as for any segment, in the order of the input
nodelist. `..name` is `..['name']` and `..*` is `..[*]`.

Decisions: D-001.

| query | document | result.values | result.paths |
|---|---|---|---|
| `"$..j"` | `{"o": {"j": 1, "k": 2}, "a": [5, 3, [{"j": 4}, {"k": 6}]]}` | `[4,1]` | `["$['a'][2][0]['j']","$['o']['j']"]` |
| `"$..[0]"` | `{"o": {"j": 1, "k": 2}, "a": [5, 3, [{"j": 4}, {"k": 6}]]}` | `[5,{"j":4}]` | `["$['a'][0]","$['a'][2][0]"]` |
| `"$..*"` | `{"o": {"j": 1, "k": 2}, "a": [5, 3, [{"j": 4}, {"k": 6}]]}` | `[[5,3,[{"j":4},{"k":6}]],{"j":1,"k":2},5,3,[{"j":4},{"k":6}],{"j":4},{"k":6},4,6,1,2]` | `["$['a']","$['o']","$['a'][0]","$['a'][1]","$['a'][2]","$['a'][2][0]","$['a'][2][1]","$['a'][2][0]['j']","$['a'][2][1]['k']","$['o']['j']","$['o']['k']"]` |
| `"$..o"` | `{"o": {"j": 1, "k": 2}, "a": [5, 3, [{"j": 4}, {"k": 6}]]}` | `[{"j":1,"k":2}]` | `["$['o']"]` |
| `"$.o..[*, *]"` | `{"o": {"j": 1, "k": 2}, "a": [5, 3, [{"j": 4}, {"k": 6}]]}` | `[1,2,1,2]` | `["$['o']['j']","$['o']['k']","$['o']['j']","$['o']['k']"]` |
| `"$.a..[0, 1]"` | `{"o": {"j": 1, "k": 2}, "a": [5, 3, [{"j": 4}, {"k": 6}]]}` | `[5,3,{"j":4},{"k":6}]` | `["$['a'][0]","$['a'][1]","$['a'][2][0]","$['a'][2][1]"]` |
| `"$..a"` | `{"a": {"a": 1}}` | `[{"a":1},1]` | `["$['a']","$['a']['a']"]` |
| `"$..*"` | `1` | `[]` | `[]` |
| `"$..*"` | `[]` | `[]` | `[]` |
| `"$..[*]"` | `[[[1]]]` | `[[[1]],[1],1]` | `["$[0]","$[0][0]","$[0][0][0]"]` |
| `"$..['a','b']"` | `{"b": {"a": 1}, "a": 2}` | `[2,{"a":1},1]` | `["$['a']","$['b']","$['b']['a']"]` |
| `"$..[?@ > 1]"` | `[1, [2, 3]]` | `[2,3]` | `["$[1][0]","$[1][1]"]` |

(Rows are `query` requests. An empty cell states nothing.)

**PROP-NP-P1.** *A Normalized Path selects exactly its node.*

- For `d` in `sampleDocument`, `k` in `int 0 .. 5`:
  - `a` is the response to `query {"query": ["$..*", "$.*", "$..[*]", "$..[0]", "$..[-1]", "$..['a']"][k], "document": d}`
  - `b` is the response to `query {"query": len(a.result.paths) > 0 ? a.result.paths[0] : "$", "document": d}`
  - `c` is the response to `query {"query": len(a.result.paths) > 0 ? a.result.paths[len(a.result.paths) - 1] : "$", "document": d}`
  - then `len(a.result.paths) == 0 or (b.result.values == [a.result.values[0]] and b.result.paths == [a.result.paths[0]] and c.result.paths == [a.result.paths[len(a.result.paths) - 1]])`
- The suite checks this on 300 generated cases.

**REQ-SE-008.** *Object members in name order.*

Wherever the members of an object are taken one after another (by a wildcard, a filter, or
a descendant segment), they MUST be taken in ascending order of their names, comparing
names code point by code point as REQ-FI-005 compares strings: at the first place two names
differ, the smaller code point comes first, and a name that is a prefix of another comes
before it. This is one of the orders RFC 9535 allows, picked so that every implementation
gives the same order. The elements of an array always keep the array's order.

Decisions: D-001.

| query | document | result.values | result.paths |
|---|---|---|---|
| `"$.*"` | `{"b": 1, "a": 2, "B": 3}` | `[3,2,1]` | `["$['B']","$['a']","$['b']"]` |
| `"$.*"` | `{"10": 1, "9": 2, "1": 3}` | `[3,1,2]` | `["$['1']","$['10']","$['9']"]` |
| `"$.*"` | `{"ab": 1, "a": 2, "": 3}` | `[3,2,1]` | `["$['']","$['a']","$['ab']"]` |
| `"$.*"` | `{"😀": 1, "\uffff": 2, "é": 3, "z": 4}` | `[4,3,2,1]` | `["$['z']","$['é']","$['￿']","$['😀']"]` |
| `"$[?@ > 0]"` | `{"b": 1, "a": 2}` | `[2,1]` | `["$['a']","$['b']"]` |
| `"$..*"` | `{"b": {"y": 1, "x": 2}, "a": [3]}` | `[[3],{"x":2,"y":1},3,2,1]` | `["$['a']","$['b']","$['a'][0]","$['b']['x']","$['b']['y']"]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-SE-009.** *null is a value.*

`null` is a value like any other: a member whose value is `null` exists and is selected,
and an element that is `null` is an element. It never stands for a missing member.

| query | document | result.values | result.paths |
|---|---|---|---|
| `"$.a"` | `{"a": null}` | `[null]` | `["$['a']"]` |
| `"$[?@.a == null]"` | `[{"a": null}, {}]` | `[{"a":null}]` | `["$[0]"]` |
| `"$[?@.a]"` | `[{"a": null}, {}]` | `[{"a":null}]` | `["$[0]"]` |
| `"$[*]"` | `[null, null]` | `[null,null]` | `["$[0]","$[1]"]` |

(Rows are `query` requests. An empty cell states nothing.)

---

## Filters

In the examples below that use the document `{"obj": {"x": "y"}, "arr": [2, 3]}` (the one
RFC 9535 uses for its comparison examples), the filter's expression does not depend on the
current node, so the query selects both of the document's children (`[2, 3]` and then
`{"x": "y"}`, in name order) when the expression is true, and nothing when it is false.

**REQ-FI-001.** *Filter selectors.*

A filter selector selects from an array each element, and from an object each member value
(in name order, REQ-SE-008), for which its logical expression is true, with that element or
member value as the current node; from a primitive value it selects nothing. Inside the
filter, a query that begins with `@` starts from the current node, and one that begins with
`$` from the document's root, however deeply filters are nested; in a filter nested inside
another, `@` is the current node of the innermost one.

| query | document | result.values | result.paths |
|---|---|---|---|
| `"$[?@ > 1]"` | `[1, 2, 3]` | `[2,3]` | `["$[1]","$[2]"]` |
| `"$[?@ > 1]"` | `{"a": 1, "b": 2, "c": 3}` | `[2,3]` | `["$['b']","$['c']"]` |
| `"$[?@ > 1]"` | `5` | `[]` | `[]` |
| `"$[?@.x == $.x]"` | `{"x": 1, "y": {"x": 1}, "z": {"x": 2}}` | `[{"x":1}]` | `["$['y']"]` |
| `"$[?@[?@ == 1]]"` | `[[1, 2], [3]]` | `[[1,2]]` | `["$[0]"]` |
| `"$..[?@.k]"` | `{"k": 1, "a": [{"k": 2}]}` | `[{"k":2}]` | `["$['a'][0]"]` |

(Rows are `query` requests. An empty cell states nothing.)

**PROP-FI-P1.** *A filter and its negation divide the children between them.*

- For `d` in `sampleDocument`, `k` in `int 0 .. 5`:
  - `a` is the response to `query {"query": ["$[?@.a]", "$[?@ > 1]", "$[?@ == 'a' || @.b]", "$[?length(@) == 1]", "$[?match(@, 'a.*')]", "$[?@[0]]"][k], "document": d}`
  - `b` is the response to `query {"query": ["$[?!@.a]", "$[?!(@ > 1)]", "$[?!(@ == 'a' || @.b)]", "$[?!(length(@) == 1)]", "$[?!match(@, 'a.*')]", "$[?!@[0]]"][k], "document": d}`
  - `c` is the response to `query {"query": "$[*]", "document": d}`
  - then `len(a.result.values) + len(b.result.values) == len(c.result.values)`
- The suite checks this on 300 generated cases.

**REQ-FI-002.** *Existence tests.*

A query used as a test is true when it selects at least one node, whatever that node's
value (`null` and `false` included), and false when it selects none; `!` before it makes
it the opposite. Any query can be tested, singular or not. To test a value, compare it
(REQ-FI-004).

| query | document | result.values | result.paths |
|---|---|---|---|
| `"$[?@.a]"` | `[{"a": null}, {"a": false}, {"b": 1}, 1]` | `[{"a":null},{"a":false}]` | `["$[0]","$[1]"]` |
| `"$[?!@.a]"` | `[{"a": null}, {"a": false}, {"b": 1}, 1]` | `[{"b":1},1]` | `["$[2]","$[3]"]` |
| `"$[?@.*]"` | `[[], [0], {}, {"a": 0}, "ab"]` | `[[0],{"a":0}]` | `["$[1]","$[3]"]` |
| `"$[?@..x]"` | `[{"y": {"x": null}}, {"y": 1}]` | `[{"y":{"x":null}}]` | `["$[0]"]` |
| `"$[?$.flag]"` | `{"flag": false, "a": 1}` | `[1,false]` | `["$['a']","$['flag']"]` |
| `"$[?@]"` | `[null, false, 0]` | `[null,false,0]` | `["$[0]","$[1]","$[2]"]` |
| `"$[?@.a == false]"` | `[{"a": null}, {"a": false}]` | `[{"a":false}]` | `["$[1]"]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-FI-003.** *Comparisons with nothing to compare.*

A comparable has no value when it is a singular query that selects no node, or a function
expression whose result is Nothing (REQ-FN-001, REQ-FN-003). When either side of a
comparison has no value, `==` is true if and only if the other side has no value either,
and `<` is false. `!=`, `<=`, `>` and `>=` follow from these (REQ-FI-006). Having no value
is not the same as having the value `null`.

| query | document | result.values |
|---|---|---|
| `"$[?$.absent1 == $.absent2]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |
| `"$[?$.absent1 <= $.absent2]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |
| `"$[?$.absent == 'g']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |
| `"$[?$.absent1 != $.absent2]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |
| `"$[?$.absent != 'g']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |
| `"$[?$.absent < 'g']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |
| `"$[?$.absent >= 'g']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |
| `"$[?$.absent == null]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |
| `"$[?$.absent == length(1)]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |
| `"$[?length(1) == length(true)]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |
| `"$[?length(1) < length(2)]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-FI-004.** *Equality.*

`==` is true when both sides have values and the values are equal: two numbers equal as
numbers (`1`, `1.0` and `1e0` are equal, and so are `0` and `-0`); two strings with the same
code points; two `true`, two `false`, or two `null`; two arrays of the same length whose
elements are equal, position by position; two objects with the same member names whose
values are equal, name by name, in whatever order the members come. Values of different
kinds are never equal: not `1` and `"1"`, `0` and `false`, `null` and `false`, `[1]` and
`1`.

| query | document | result.values | result.paths |
|---|---|---|---|
| `"$[?13 == '13']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |  |
| `"$[?$.obj == $.arr]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |  |
| `"$[?$.obj != $.arr]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |  |
| `"$[?$.obj == $.obj]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |  |
| `"$[?$.obj != $.obj]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |  |
| `"$[?$.arr == $.arr]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |  |
| `"$[?$.arr != $.arr]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |  |
| `"$[?$.obj == 17]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |  |
| `"$[?$.obj != 17]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |  |
| `"$[?@ == 1]"` | `[1, 1.0, 1e0, "1", true, [1], {"a": 1}]` | `[1,1,1]` | `["$[0]","$[1]","$[2]"]` |
| `"$[?@ == 0]"` | `[0, -0, false, null, "0", 0.0]` | `[0,0,0]` | `["$[0]","$[1]","$[5]"]` |
| `"$[?@ == false]"` | `[false, 0, null, ""]` | `[false]` | `["$[0]"]` |
| `"$[?@ == null]"` | `[null, false, 0, ""]` | `[null]` | `["$[0]"]` |
| `"$[?@ == 'é']"` | `["é", "e\u0301"]` | `["é"]` | `["$[0]"]` |
| `"$[?@ == $.x]"` | `{"x": [1, {"a": 2}], "y": [1, {"a": 2}], "z": [{"a": 2}, 1]}` | `[[1,{"a":2}],[1,{"a":2}]]` | `["$['x']","$['y']"]` |
| `"$[?@ == $.x]"` | `{"x": {"a": 1, "b": [true]}, "y": {"b": [true], "a": 1}, "z": {"a": 1}}` | `[{"a":1,"b":[true]},{"a":1,"b":[true]}]` | `["$['x']","$['y']"]` |
| `"$[?@ == $.x]"` | `{"x": [], "y": {}, "z": []}` | `[[],[]]` | `["$['x']","$['z']"]` |
| `"$[?@ == $.x]"` | `{"x": {}, "y": 0, "z": "", "w": []}` | `[{}]` | `["$['x']"]` |
| `"$[?@ == $.x]"` | `{"x": [], "y": 0, "z": "", "w": {}}` | `[[]]` | `["$['x']"]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-FI-005.** *Less than.*

`<` is true only when both sides have values that are both numbers or both strings, and the
first is less than the second: numbers in their numeric order; strings code point by code
point from the start, so that at the first place they differ the smaller code point makes
the smaller string, and a string that is a proper prefix of another is the smaller (the
empty string is less than any other). Code points are compared as numbers, not UTF-16 code
units: U+FFFF is less than U+1F600. `true`, `false`, `null`, arrays and objects are never
less than anything, and nothing is less than them.

| query | document | result.values | result.paths |
|---|---|---|---|
| `"$[?1 < 2]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |  |
| `"$[?2 < 1]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |  |
| `"$[?-1 < 0]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |  |
| `"$[?1.5 < 2]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |  |
| `"$[?1e1 < 9]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |  |
| `"$[?'a' < 'b']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |  |
| `"$[?'' < 'a']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |  |
| `"$[?'a' < 'ab']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |  |
| `"$[?'ab' < 'b']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |  |
| `"$[?'B' < 'a']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |  |
| `"$[?'z' < 'é']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |  |
| `"$[?'\uffff' < '😀']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |  |
| `"$[?'😀' < '\uffff']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |  |
| `"$[?1 < '2']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |  |
| `"$[?'1' < 2]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |  |
| `"$[?false < true]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |  |
| `"$[?null < 1]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |  |
| `"$[?$.arr < $.arr]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |  |
| `"$[?$.obj < $.arr]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |  |
| `"$[?1 < $.arr]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |  |
| `"$[?@ < 'b']"` | `["a", "B", "b", "ba", "", "é", 1]` | `["a","B",""]` | `["$[0]","$[1]","$[4]"]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-FI-006.** *Not equal, less or equal, greater, greater or equal.*

For any two sides `a` and `b`, with values or without: `a != b` is true when `a == b` is
false; `a <= b` when `a < b` or `a == b` is true; `a > b` when `b < a` is true; and
`a >= b` when `b < a` or `a == b` is true.

| query | document | result.values |
|---|---|---|
| `"$[?1 <= 2]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |
| `"$[?1 > 2]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |
| `"$[?'a' <= 'b']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |
| `"$[?'a' > 'b']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |
| `"$[?$.obj <= $.arr]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |
| `"$[?$.obj <= $.obj]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |
| `"$[?$.arr <= $.arr]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |
| `"$[?1 <= $.arr]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |
| `"$[?1 >= $.arr]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |
| `"$[?1 > $.arr]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |
| `"$[?true <= true]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |
| `"$[?true > true]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[]` |
| `"$[?true >= true]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |
| `"$[?null <= null]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |
| `"$[?1 != '1']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |
| `"$[?2 >= 1]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |
| `"$[?1 >= 1.0]"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |
| `"$[?'b' > 'a']"` | `{"obj": {"x": "y"}, "arr": [2, 3]}` | `[[2,3],{"x":"y"}]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-FI-007.** *Logical operators.*

`&&` is true when the expressions on both sides are; `||` when either is; `!` makes a test or
a parenthesized expression the opposite. `&&` binds more tightly than `||`, so
`a || b && c` means `a || (b && c)`; parentheses group. The result never depends on the
order in which the parts are evaluated.

| query | document | result.values |
|---|---|---|
| `"$[?@ < 2 \|\| @ > 3]"` | `[1, 2, 3, 4]` | `[1,4]` |
| `"$[?@ > 1 && @ < 4]"` | `[1, 2, 3, 4]` | `[2,3]` |
| `"$[?@ == 1 \|\| @ == 2 && @ == 3]"` | `[1, 2, 3, 4]` | `[1]` |
| `"$[?(@ == 1 \|\| @ == 2) && @ == 2]"` | `[1, 2, 3, 4]` | `[2]` |
| `"$[?!(@ == 1 \|\| @ == 2)]"` | `[1, 2, 3, 4]` | `[3,4]` |
| `"$[?!(@ == 1) && !(@ == 4)]"` | `[1, 2, 3, 4]` | `[2,3]` |
| `"$[?@ > 0 && @ < 10 && @ != 3]"` | `[1, 2, 3, 4]` | `[1,2,4]` |
| `"$[?@ == 4 \|\| @ == 3 \|\| @ == 9]"` | `[1, 2, 3, 4]` | `[3,4]` |
| `"$[?@==1\|\|@==2]"` | `[1, 2, 3, 4]` | `[1,2]` |
| `"$[?@>1&&@<4]"` | `[1, 2, 3, 4]` | `[2,3]` |

(Rows are `query` requests. An empty cell states nothing.)

---

## Functions

**REQ-FN-001.** *length().*

`length(v)` is the number of code points of a string (not of UTF-16 code units, and not of
bytes), the number of elements of an array, or the number of members of an object. For any
other value, and when its argument has no value, it is Nothing.

| query | document | result.values |
|---|---|---|
| `"$[?length(@) == 1]"` | `["a", "😀", "é", "e\u0301", "", [1, [2, 3]], {"a": 1, "b": 2}, 1, true, null]` | `["a","😀","é"]` |
| `"$[?length(@) == 2]"` | `["a", "😀", "é", "e\u0301", "", [1, [2, 3]], {"a": 1, "b": 2}, 1, true, null]` | `["é",[1,[2,3]],{"a":1,"b":2}]` |
| `"$[?length(@) == 0]"` | `["a", "😀", "é", "e\u0301", "", [1, [2, 3]], {"a": 1, "b": 2}, 1, true, null]` | `[""]` |
| `"$[?length(@) == length(@.x)]"` | `["a", "😀", "é", "e\u0301", "", [1, [2, 3]], {"a": 1, "b": 2}, 1, true, null]` | `[1,true,null]` |
| `"$[?length(@.x) == 0]"` | `["a", "😀", "é", "e\u0301", "", [1, [2, 3]], {"a": 1, "b": 2}, 1, true, null]` | `[]` |
| `"$[?length('😀😀') == 2]"` | `[7]` | `[7]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-FN-002.** *count().* `count(nodes)` is the number of nodes in its nodelist, a node selected twice counted twice.

| query | document | result.values |
|---|---|---|
| `"$[?count(@.*) == 2]"` | `[[1, 2], [3], [], {"a": 1, "b": 2}, 5]` | `[[1,2],{"a":1,"b":2}]` |
| `"$[?count(@.*) == 0]"` | `[[1, 2], [3], [], {"a": 1, "b": 2}, 5]` | `[[],5]` |
| `"$[?count(@) == 1]"` | `[[1, 2], [3], [], {"a": 1, "b": 2}, 5]` | `[[1,2],[3],[],{"a":1,"b":2},5]` |
| `"$[?count(@[0, 0]) == 2]"` | `[[1, 2], [3], [], {"a": 1, "b": 2}, 5]` | `[[1,2],[3]]` |
| `"$[?count(@..*) == 2]"` | `[[1, 2], [3], [], {"a": 1, "b": 2}, 5]` | `[[1,2],{"a":1,"b":2}]` |
| `"$[?count($[*]) == 5]"` | `[[1, 2], [3], [], {"a": 1, "b": 2}, 5]` | `[[1,2],[3],[],{"a":1,"b":2},5]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-FN-003.** *value().*

`value(nodes)` is the value of the only node of its nodelist; when the nodelist is empty or
holds more than one node, it is Nothing.

| query | document | result.values |
|---|---|---|
| `"$[?value(@..c) == 'red']"` | `[{"c": "red"}, {"a": {"c": "red"}}, {"c": "red", "d": {"c": "blue"}}, {}]` | `[{"c":"red"},{"a":{"c":"red"}}]` |
| `"$[?value(@.*) == 'red']"` | `[{"c": "red"}, {"a": {"c": "red"}}, {"c": "red", "d": {"c": "blue"}}, {}]` | `[{"c":"red"}]` |
| `"$[?value(@.x) == value(@.y)]"` | `[{"c": "red"}, {"a": {"c": "red"}}, {"c": "red", "d": {"c": "blue"}}, {}]` | `[{"c":"red"},{"a":{"c":"red"}},{"c":"red","d":{"c":"blue"}},{}]` |
| `"$[?value(@..c) != 'red']"` | `[{"c": "red"}, {"a": {"c": "red"}}, {"c": "red", "d": {"c": "blue"}}, {}]` | `[{"c":"red","d":{"c":"blue"}},{}]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-FN-004.** *match().*

`match(s, re)` is true when `s` is a string, `re` is a string that is an I-Regexp (RX
section), and the whole of `s` matches `re`. Otherwise it is false, never an error: a first
argument that is not a string or has no value, a second that is not a string, or a string
that is not an I-Regexp, all make it false.

| query | document | result.values |
|---|---|---|
| `"$[?match(@, 'a.c')]"` | `["abc", "abcd", "xabc", "ab\nc", 1, null]` | `["abc"]` |
| `"$[?match(@, 'a.*')]"` | `["abc", "abcd", "xabc", "ab\nc", 1, null]` | `["abc","abcd"]` |
| `"$[?match(@, '[')]"` | `["abc", "abcd", "xabc", "ab\nc", 1, null]` | `[]` |
| `"$[?!match(@, '[')]"` | `["abc", "abcd", "xabc", "ab\nc", 1, null]` | `["abc","abcd","xabc","ab\nc",1,null]` |
| `"$[?match(@, 1)]"` | `["abc", "abcd", "xabc", "ab\nc", 1, null]` | `[]` |
| `"$[?match(1, '1')]"` | `["abc", "abcd", "xabc", "ab\nc", 1, null]` | `[]` |
| `"$[?match(@.x, '.*')]"` | `["abc", "abcd", "xabc", "ab\nc", 1, null]` | `[]` |
| `"$[?match(@, 'abc\|xabc')]"` | `["abc", "abcd", "xabc", "ab\nc", 1, null]` | `["abc","xabc"]` |
| `"$[?match(@.date, '1974-05-..')]"` | `[{"date": "1974-05-01"}, {"date": "1974-05-1"}, {"date": "1974-05-01x"}]` | `[{"date":"1974-05-01"}]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-FN-005.** *search().*

`search(s, re)` is true when `s` is a string, `re` is a string that is an I-Regexp, and some
substring of `s` (the empty one included) matches `re`. Otherwise it is false, as for
`match()`.

| query | document | result.values |
|---|---|---|
| `"$[?search(@, 'b')]"` | `["abc", "xyz", "", "a\nb", "x^ay", 1]` | `["abc","a\nb"]` |
| `"$[?search(@, '^a')]"` | `["abc", "xyz", "", "a\nb", "x^ay", 1]` | `["x^ay"]` |
| `"$[?search(@, '')]"` | `["abc", "xyz", "", "a\nb", "x^ay", 1]` | `["abc","xyz","","a\nb","x^ay"]` |
| `"$[?search(@, 'a.b')]"` | `["abc", "xyz", "", "a\nb", "x^ay", 1]` | `[]` |
| `"$[?search(@, 'b\|z')]"` | `["abc", "xyz", "", "a\nb", "x^ay", 1]` | `["abc","xyz","a\nb"]` |
| `"$[?search(@, '[')]"` | `["abc", "xyz", "", "a\nb", "x^ay", 1]` | `[]` |

(Rows are `query` requests. An empty cell states nothing.)

---

## Regular expressions (I-Regexp)

The second argument of `match()` and `search()` is an I-Regexp, RFC 9485's interoperable
regular expression format. In the examples, each pattern is written inside a JSONPath
string literal, so a backslash in the pattern is written `\\` in the query, and the query
is in turn a JSON string in the request.

**REQ-RX-001.** *What an I-Regexp is.*

A string is an I-Regexp when it follows this grammar (RFC 9485, section 3) in full, and not
otherwise; a pattern that is not an I-Regexp makes `match()` and `search()` false
(REQ-FN-004, REQ-FN-005):

```
i-regexp = branch *( "|" branch )
branch = *piece
piece = atom [ quantifier ]
quantifier = ( "*" / "+" / "?" ) / range-quantifier
range-quantifier = "{" QuantExact [ "," [ QuantExact ] ] "}"
QuantExact = 1*%x30-39 ; '0'-'9'
atom = NormalChar / charClass / ( "(" i-regexp ")" )
NormalChar = ( %x00-27 / "," / "-" / %x2F-3E / %x40-5A / %x5E-7A / %x7E-D7FF / %xE000-10FFFF )
charClass = "." / SingleCharEsc / charClassEsc / charClassExpr
SingleCharEsc = "\" ( %x28-2B / "-" / "." / "?" / %x5B-5E / %s"n" / %s"r" / %s"t" / %x7B-7D )
charClassEsc = catEsc / complEsc
charClassExpr = "[" [ "^" ] ( "-" / CCE1 ) *CCE1 [ "-" ] "]"
CCE1 = ( CCchar [ "-" CCchar ] ) / charClassEsc
CCchar = ( %x00-2C / %x2E-5A / %x5E-D7FF / %xE000-10FFFF ) / SingleCharEsc
catEsc = %s"\p{" charProp "}"
complEsc = %s"\P{" charProp "}"
```

with `charProp` one of the category names of REQ-RX-004, and `[^]` excluded. So: `^` and
`$` are ordinary characters, not anchors; there are no multi-character escapes (`\d`, `\w`,
`\s`, `\i`, `\c` and their upper-case forms), no backreferences, no lookaround, no lazy
quantifiers (`*?`), and no `(?...)` groups; `]`, `{` and `}` are not ordinary characters;
the empty string and empty branches are I-Regexps.

| query | document | result.values |
|---|---|---|
| `"$[?match(@, 'a')]"` | `["a", "b"]` | `["a"]` |
| `"$[?match(@, '')]"` | `["", "a"]` | `[""]` |
| `"$[?match(@, 'a\|')]"` | `["a", "", "b"]` | `["a",""]` |
| `"$[?match(@, '()')]"` | `["", "a"]` | `[""]` |
| `"$[?match(@, '(a\|b)c')]"` | `["ac", "bc", "c"]` | `["ac","bc"]` |
| `"$[?match(@, ',-/>@Z^z~')]"` | `[",-/>@Z^z~", "x"]` | `[",-/>@Z^z~"]` |
| `"$[?match(@, \"'\")]"` | `["'", "a"]` | `["'"]` |
| `"$[?match(@, '\\\\d')]"` | `["1", "d"]` | `[]` |
| `"$[?match(@, '\\\\w')]"` | `["a"]` | `[]` |
| `"$[?match(@, '\\\\s')]"` | `[" "]` | `[]` |
| `"$[?match(@, 'a*?')]"` | `["a", ""]` | `[]` |
| `"$[?match(@, '(?:a)')]"` | `["a"]` | `[]` |
| `"$[?match(@, 'a]')]"` | `["a]"]` | `[]` |
| `"$[?match(@, 'a\\\\]')]"` | `["a]"]` | `["a]"]` |
| `"$[?match(@, 'a{')]"` | `["a{"]` | `[]` |
| `"$[?match(@, 'a}')]"` | `["a}"]` | `[]` |
| `"$[?match(@, '[]')]"` | `["]", ""]` | `[]` |
| `"$[?match(@, '[^]')]"` | `["^", "a"]` | `[]` |
| `"$[?match(@, '*a')]"` | `["a", "*a"]` | `[]` |
| `"$[?match(@, 'a**')]"` | `["aa"]` | `[]` |
| `"$[?match(@, '(a')]"` | `["a", "(a"]` | `[]` |
| `"$[?match(@, 'a)')]"` | `["a", "a)"]` | `[]` |
| `"$[?match(@, '\\\\')]"` | `["\\"]` | `[]` |
| `"$[?match(@, '\\\\1')]"` | `["1"]` | `[]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-RX-002.** *Matching.*

`match()` succeeds when the whole string matches the I-Regexp, and `search()` when some
substring does. Matching works on code points and is case-sensitive. `.` matches any one
code point except line feed (U+000A) and carriage return (U+000D): it matches U+2028, U+0085,
and a code point beyond U+FFFF, as one. `^` and `$` match themselves. Alternatives apply to
the whole of the I-Regexp, or of the group they are in: `match(s, 'a|bc')` is true for `a`
and `bc` and false for `abc`.

| query | document | result.values |
|---|---|---|
| `"$[?match(@, '.')]"` | `["\n", "\r", "\u2028", "\u0085", "😀", "ab", ""]` | `[" ","","😀"]` |
| `"$[?match(@, '..')]"` | `["😀", "ab"]` | `["ab"]` |
| `"$[?match(@, '^a')]"` | `["^a", "a"]` | `["^a"]` |
| `"$[?match(@, 'a$')]"` | `["a$", "a"]` | `["a$"]` |
| `"$[?match(@, 'a')]"` | `["A", "a"]` | `["a"]` |
| `"$[?search(@, 'b')]"` | `["abc", "B"]` | `["abc"]` |
| `"$[?match(@, 'b')]"` | `["abc", "b"]` | `["b"]` |
| `"$[?match(@, 'a\|bc')]"` | `["a", "bc", "abc"]` | `["a","bc"]` |
| `"$[?search(@, 'a\|bc')]"` | `["xa", "xbcx", "b"]` | `["xa","xbcx"]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-RX-003.** *Character classes.*

`[...]` matches one code point from a set: single characters, ranges `x-y` (every code point
from `x` to `y` inclusive), and `\p{...}` or `\P{...}` (REQ-RX-004); `[^...]` matches one
code point that is not in the set (line feed included). A `-` right after `[` or `[^`, or
right before `]`, stands for itself; elsewhere it makes a range, and a `-` that would follow
a range or start a second one makes the string not an I-Regexp. Inside a class, `.`, `$`,
`(`, `)`, `*`, `+`, `?`, `{`, `}`, `|` and a `^` that is not first stand for themselves;
`[`, `]`, `\` and a `-` used as a character elsewhere need a backslash.

| query | document | result.values |
|---|---|---|
| `"$[?match(@, '[a-c]+')]"` | `["abc", "abd", ""]` | `["abc"]` |
| `"$[?match(@, '[^a]')]"` | `["a", "b", "😀", "\n"]` | `["b","😀","\n"]` |
| `"$[?match(@, '[-a]')]"` | `["-", "a", "b"]` | `["-","a"]` |
| `"$[?match(@, '[a-]')]"` | `["-", "a", "b"]` | `["-","a"]` |
| `"$[?match(@, '[^-]')]"` | `["-", "a"]` | `["a"]` |
| `"$[?match(@, '[a^]')]"` | `["^", "a", "b"]` | `["^","a"]` |
| `"$[?match(@, '[.]')]"` | `[".", "a"]` | `["."]` |
| `"$[?match(@, '[$]')]"` | `["$", "a"]` | `["$"]` |
| `"$[?match(@, '[\\\\]]')]"` | `["]", "\\"]` | `["]"]` |
| `"$[?match(@, '[\\\\\\\\]')]"` | `["\\", "a"]` | `["\\"]` |
| `"$[?match(@, '[\\\\-a]')]"` | `["-", "a", "b"]` | `["-","a"]` |
| `"$[?match(@, '[a-c-e]')]"` | `["a", "-"]` | `[]` |
| `"$[?match(@, '[\\\\n]')]"` | `["\n", "n"]` | `["\n"]` |
| `"$[?match(@, '[😀-😂]')]"` | `["😁", "a"]` | `["😁"]` |
| `"$[?match(@, '[a')]"` | `["a"]` | `[]` |
| `"$[?match(@, '[\\\\P{L}]')]"` | `["a", "1"]` | `["1"]` |
| `"$[?match(@, '[,.Z^]+')]"` | `[",.Z^", "a"]` | `[",.Z^"]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-RX-004.** *Unicode character categories.*

`\p{X}` matches one code point whose Unicode General Category is `X`, and `\P{X}` one whose
category is not `X`, for `X` one of `L`, `Lu`, `Ll`, `Lt`, `Lm`, `Lo`, `M`, `Mn`, `Mc`,
`Me`, `N`, `Nd`, `Nl`, `No`, `P`, `Pc`, `Pd`, `Ps`, `Pe`, `Pi`, `Pf`, `Po`, `Z`, `Zs`, `Zl`,
`Zp`, `S`, `Sm`, `Sc`, `Sk`, `So`, `C`, `Cc`, `Cf`, `Co` and `Cn`. A one-letter name covers
every category that begins with that letter. Any other name (`IsBasicLatin`, `Greek`,
`lu`, `Cs`), and a `\p` or `\P` without `{...}`, makes the string not an I-Regexp. Both forms
MAY also be used inside a character class.

| query | document | result.values |
|---|---|---|
| `"$[?match(@, '\\\\p{Lu}')]"` | `["A", "a", "É", "1", "ǅ"]` | `["A","É"]` |
| `"$[?match(@, '\\\\p{Lt}')]"` | `["ǅ", "A"]` | `["ǅ"]` |
| `"$[?match(@, '\\\\p{L}+')]"` | `["abc", "ab1", "é😀", "日本"]` | `["abc","日本"]` |
| `"$[?match(@, '\\\\p{Nd}+')]"` | `["123", "١٢٣", "12a", "Ⅻ"]` | `["123","١٢٣"]` |
| `"$[?match(@, '\\\\p{N}')]"` | `["1", "Ⅻ", "½", "a"]` | `["1","Ⅻ","½"]` |
| `"$[?match(@, '\\\\P{L}')]"` | `["a", "1", " ", "😀"]` | `["1"," ","😀"]` |
| `"$[?match(@, '\\\\p{So}')]"` | `["😀", "a"]` | `["😀"]` |
| `"$[?match(@, '\\\\p{Zs}')]"` | `[" ", "\u00a0", "\t"]` | `[" "," "]` |
| `"$[?match(@, '\\\\p{Cc}')]"` | `["\t", "\u0085", "a"]` | `["\t",""]` |
| `"$[?match(@, '[\\\\p{Lu}0-9]+')]"` | `["A1", "a1"]` | `["A1"]` |
| `"$[?match(@, '[^\\\\p{L}]')]"` | `["a", "1"]` | `["1"]` |
| `"$[?match(@, '\\\\p{IsBasicLatin}')]"` | `["a"]` | `[]` |
| `"$[?match(@, '\\\\p{Greek}')]"` | `["α"]` | `[]` |
| `"$[?match(@, '\\\\p{lu}')]"` | `["A"]` | `[]` |
| `"$[?match(@, '\\\\p{Cs}')]"` | `["a"]` | `[]` |
| `"$[?match(@, '\\\\p{Lu')]"` | `["A"]` | `[]` |
| `"$[?match(@, '\\\\pL')]"` | `["A"]` | `[]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-RX-005.** *Escapes.*

Outside a character class, a backslash MUST be followed by `n` (line feed), `r` (carriage
return), `t` (tab), `p{...}` or `P{...}` (REQ-RX-004), or one of `( ) * + - . ? [ \ ] ^ { | }`,
which then stands for itself. Any other escape (`\d`, `\$`, `\/`, `\u0041`, `\x41`, `\b`,
`\1`, and so on) makes the string not an I-Regexp. Inside a class the same single-character
escapes are written the same way (REQ-RX-003).

| query | document | result.values |
|---|---|---|
| `"$[?match(@, 'a\\\\.b')]"` | `["a.b", "axb"]` | `["a.b"]` |
| `"$[?match(@, '\\\\-')]"` | `["-"]` | `["-"]` |
| `"$[?match(@, '\\\\^')]"` | `["^"]` | `["^"]` |
| `"$[?match(@, '\\\\{')]"` | `["{"]` | `["{"]` |
| `"$[?match(@, '\\\\t')]"` | `["\t", "t"]` | `["\t"]` |
| `"$[?match(@, '\\\\n')]"` | `["\n", "n"]` | `["\n"]` |
| `"$[?match(@, '\\\\\\\\')]"` | `["\\"]` | `["\\"]` |
| `"$[?match(@, '\\\\$')]"` | `["$"]` | `[]` |
| `"$[?match(@, '\\\\/')]"` | `["/"]` | `[]` |
| `"$[?match(@, '\\\\u0041')]"` | `["A"]` | `[]` |
| `"$[?match(@, '\\\\b')]"` | `["b"]` | `[]` |
| `"$[?match(@, '\\\\x41')]"` | `["A"]` | `[]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-RX-006.** *Quantifiers.*

A quantifier follows an atom (a character, a class, or a parenthesized group): `*` (zero or
more), `+` (one or more), `?` (zero or one), `{n}` (exactly n), `{n,}` (n or more) or
`{n,m}` (n to m), with n and m in decimal digits. An atom takes at most one quantifier:
`a**`, `a+?` and `a{2}{3}` are not I-Regexps, nor are `{,2}`, a quantifier with nothing
before it, or a `{` that does not complete a quantifier.

| query | document | result.values |
|---|---|---|
| `"$[?match(@, 'a{2}')]"` | `["a", "aa", "aaa"]` | `["aa"]` |
| `"$[?match(@, 'a{2,}')]"` | `["a", "aa", "aaa"]` | `["aa","aaa"]` |
| `"$[?match(@, 'a{1,2}')]"` | `["", "a", "aa", "aaa"]` | `["a","aa"]` |
| `"$[?match(@, 'a{0}')]"` | `["", "a"]` | `[""]` |
| `"$[?match(@, 'a{02}')]"` | `["aa"]` | `["aa"]` |
| `"$[?match(@, '(ab)*')]"` | `["", "ab", "abab", "aba"]` | `["","ab","abab"]` |
| `"$[?match(@, '[ab]+')]"` | `["abba", "abc"]` | `["abba"]` |
| `"$[?match(@, 'a?b')]"` | `["b", "ab", "aab"]` | `["b","ab"]` |
| `"$[?match(@, 'a{,2}')]"` | `["a"]` | `[]` |
| `"$[?match(@, 'a{2}{3}')]"` | `["aaaaaa"]` | `[]` |
| `"$[?match(@, 'a+?')]"` | `["a"]` | `[]` |
| `"$[?match(@, '{2}')]"` | `[""]` | `[]` |
| `"$[?match(@, 'a{x}')]"` | `["a"]` | `[]` |
| `"$[?match(@, 'a{2')]"` | `["aa"]` | `[]` |

(Rows are `query` requests. An empty cell states nothing.)

---

## Normalized Paths

**REQ-NP-001.** *The form of a Normalized Path.*

A Normalized Path is `$` followed by one step in brackets for each level from the document
down to the node: `[<index>]` for an array element, the element's index (never negative) in
decimal without leading zeros, and `['<name>']` for a member value, its name in single
quotes, written as REQ-NP-002 says. Each node has exactly one Normalized Path, whatever
query selected it: a negative index in the query becomes the element's index, and a name
written with escapes or double quotes in the query is written as REQ-NP-002 says.

| query | document | result.paths |
|---|---|---|
| `"$.a"` | `{"a": 1}` | `["$['a']"]` |
| `"$[1]"` | `[0, 1]` | `["$[1]"]` |
| `"$[-3]"` | `[0, 1, 2, 3, 4]` | `["$[2]"]` |
| `"$.a.b[1:2]"` | `{"a": {"b": [0, 1, 2]}}` | `["$['a']['b'][1]"]` |
| `"$[\"\\u000B\"]"` | `{"\u000b": 1}` | `["$['\\u000b']"]` |
| `"$[\"\\u0061\"]"` | `{"a": 1}` | `["$['a']"]` |
| `"$[10]"` | `[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]` | `["$[10]"]` |
| `"$..x"` | `{"x": {"x": 1}}` | `["$['x']","$['x']['x']"]` |

(Rows are `query` requests. An empty cell states nothing.)

**REQ-NP-002.** *Names in Normalized Paths.*

In a Normalized Path, a member name is written between single quotes, with these code points
escaped, and only these: `'` as `\'`, `\` as `\\`, U+0008 as `\b`, U+0009 as `\t`, U+000A as
`\n`, U+000C as `\f`, U+000D as `\r`, and every other code point below U+0020 as `\u00`
followed by two lower-case hexadecimal digits (U+000B is `\u000b`). Every other code point
stands for itself: `"`, `/`, DEL (U+007F), U+0085, U+2028 and code points beyond U+FFFF
included.

| query | document | result.paths |
|---|---|---|
| `"$.*"` | `{"'": 1}` | `["$['\\'']"]` |
| `"$.*"` | `{"\\": 1}` | `["$['\\\\']"]` |
| `"$.*"` | `{"\"": 1}` | `["$['\"']"]` |
| `"$.*"` | `{"/": 1}` | `["$['/']"]` |
| `"$.*"` | `{"\b": 1}` | `["$['\\b']"]` |
| `"$.*"` | `{"\t": 1}` | `["$['\\t']"]` |
| `"$.*"` | `{"\n": 1}` | `["$['\\n']"]` |
| `"$.*"` | `{"\f": 1}` | `["$['\\f']"]` |
| `"$.*"` | `{"\r": 1}` | `["$['\\r']"]` |
| `"$.*"` | `{"\u0000": 1}` | `["$['\\u0000']"]` |
| `"$.*"` | `{"\u000b": 1}` | `["$['\\u000b']"]` |
| `"$.*"` | `{"\u001f": 1}` | `["$['\\u001f']"]` |
| `"$.*"` | `{"\u007f": 1}` | `["$['']"]` |
| `"$.*"` | `{"\u0085": 1}` | `["$['']"]` |
| `"$.*"` | `{"\u2028": 1}` | `["$[' ']"]` |
| `"$.*"` | `{"😀": 1}` | `["$['😀']"]` |
| `"$.*"` | `{"a'b\\c": 1}` | `["$['a\\'b\\\\c']"]` |
| `"$.*"` | `{"é": 1}` | `["$['é']"]` |

(Rows are `query` requests. An empty cell states nothing.)

---

## The implementation folder

These requirements are checked on the implementation folder, not through the driver.

**REQ-BU-001.** *REGEN.json.*

The implementation folder MUST contain `REGEN.json`, a JSON object with exactly the keys
`lang` (`"ts"` or `"py"`), `build`, `test` and `driver`. Each of `build`, `test` and
`driver` is a command string, or an object whose keys are Node.js `process.platform` values
(such as `"win32"`) plus a required `"default"`, each mapping to a command string. Commands
run in the implementation folder. `build` and `test` run through the platform shell; an
empty `build` means there is nothing to build. `driver` is split on single spaces and
started without a shell, so it MUST be plain space-separated words. The same REGEN.json
MUST work on Windows and on Linux.

Checked on the implementation folder:
- `REGEN.json` is JSON of type `{lang: "ts" | "py", build: string | {default: string, ...}, test: string | {default: string, ...}, driver: string | {default: string, ...}}`.

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

At most 3,000 non-blank lines of source in all: `.ts .mts .mjs .js` or `.py` files under
the implementation folder, not counting tests (`*.test.*`, `*_test.*`, `test_*.py`, and
anything under a `test/` or `tests/` folder).

Checked on the implementation folder:
- files matching `**/*.ts`, `**/*.mts`, `**/*.mjs`, `**/*.js`, `**/*.py`, excluding `**/*.test.*`, `**/*_test.*`, `**/test_*.py`, `**/test/**`, `**/tests/**`, hold at most 3000 non-blank lines in total.

**OPEN-OP-001.** *Duplicate member names.* A document object with two or more members of the same name (RFC 9535, section 1.3: the
behavior becomes unpredictable). (Open: implementations may differ; never tested.)

**OPEN-OP-002.** *Strings that are not sequences of Unicode scalar values.* A string or member name in the document, or a string in the query, that holds a lone
surrogate code point (JSON allows `\ud800` in its strings): how it compares, matches, is
counted by `length()`, or is written in a Normalized Path. (Open: implementations may differ; never tested.)

**OPEN-OP-003.** *Numbers that I-JSON does not expect to interoperate.* Integers beyond -9007199254740991 to 9007199254740991, and numbers with more precision or
range than an IEEE 754 binary64 value, in the document or as literals in a query: how they
compare (RFC 9535, section 2.3.5.2.2, leaves that to the implementation), and how they are
written in `values`. (Open: implementations may differ; never tested.)

**OPEN-OP-004.** *Resources.* Very large or deeply nested documents and queries, and very large quantifiers in an
I-Regexp: when an implementation runs out of time or memory, and what it then answers. (Open: implementations may differ; never tested.)

**OPEN-OP-005.** *Unicode versions.* Code points whose General Category differs between versions of Unicode, or that one
version does not assign, in `\p{...}` and `\P{...}`. (Open: implementations may differ; never tested.)

**OPEN-OP-006.** *Ranges and bounds in the wrong order.* A character class range whose first code point comes after its last (`[z-a]`), and a
quantifier `{n,m}` with n greater than m. RFC 9485 leaves their meaning to XSD: whether
such a string is an I-Regexp, and what it matches. (Open: implementations may differ; never tested.)

**OPEN-OP-007.** *Standard error and error text.* What the driver writes to standard error; any human-readable error text, which never
appears in a response. (Open: implementations may differ; never tested.)

**OPEN-OP-008.** *Odd request bytes.* Request bytes that are not valid UTF-8. (Open: implementations may differ; never tested.)
