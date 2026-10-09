# jsonpath: specification

This program evaluates JSONPath queries as RFC 9535 defines them. The interface below says how it is run and judged; the specification after it says what it does.

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

---

# jsonpath — Specification

This document specifies `jsonpath`, a program that evaluates JSONPath queries (the query
language standardized as RFC 9535, with regular expressions in the I-Regexp format of RFC 9485)
against JSON documents. The program is driven through the interface fixed in `protocol.md`
(requests and responses as JSON lines, the `query` operation, and the error codes
`bad_request`, `unknown_op` and `invalid_query`). This specification describes everything
behind that interface. It is self-contained: an implementer needs only this document and
`protocol.md`.

Choices that the standards leave open, and that this specification fixes, are listed in
`DECISIONS-B.md`; they are also stated normatively here.

---

## 0. Conventions

### 0.1 Requirement language

Each requirement is numbered (`R1`, `R2`, …) and stated with **SHALL**. "SHALL" is mandatory.
"SHOULD" is a strong recommendation that is not checked. Text marked *Note* or *Guidance* is
explanatory and not normative.

### 0.2 Scenario notation

Every requirement is followed by scenarios. A scenario has the form

> **WHEN** query `Q` is evaluated on document `D` **THEN** values `V`, paths `P`

meaning: a request `{"id": …, "op": "query", "input": {"query": Q, "document": D}}` receives the
response `{"id": …, "result": {"values": V, "paths": P}}`. Or

> **WHEN** query `Q` … **THEN** `invalid_query`

meaning: the response is `{"id": …, "error": "invalid_query"}`. When no document is given for
an `invalid_query` scenario, the outcome is the same for every document.

- **Queries** are shown as the *raw text of the query string*, i.e. the value of
  `input.query` after JSON decoding of the request. For example the query `$['a\'b']` contains
  the characters `$`, `[`, `'`, `a`, `\`, `'`, `b`, `'`, `]`; inside the JSON request line it
  would be written `"$['a\\'b']"`. When a query contains a character that cannot be shown (a raw
  control character, a lone surrogate), the scenario says so in words.
- **Documents**, **values** and **paths** are shown as JSON text. Because `paths` is a JSON
  array of strings, any backslash inside a normalized path appears doubled: the normalized path
  `$['\'']` is shown as `"$['\\'']"`.
- Values are compared as parsed JSON (member order inside objects does not matter, numbers by
  value), as `protocol.md` states. The *order of the elements of `values` and `paths` does
  matter*.
- A `values`/`paths` pair `[]`, `[]` means the query is valid and selected nothing.

### 0.3 Glossary

- **Value**: a JSON value — object, array, string, number, `true`, `false` or `null`.
  Objects and arrays are *structured*; the rest are *primitive*.
- **Member**: a name/value pair of an object. **Name**: the string of a member.
  **Element**: a value in an array. **Index**: zero-based integer position of an element.
- **Document** (query argument): the value `input.document` that the query is applied to.
- **Location**: the sequence of names and indices that leads from the document to a value
  (empty for the document itself).
- **Node**: a pair (value, location). The **root node** is the node of the whole document.
- **Children** of a node: for an array, the nodes of its elements; for an object, the nodes of
  its member values (never the names). Primitives have no children.
- **Descendants** of a node: its children, their children, and so on (transitive closure).
- **Nodelist**: an ordered list of nodes; the same node may occur more than once.
- **Normalized path**: the canonical string form of a location (R29).
- **Unicode scalar value** (here also "character"): a code point in U+0000–U+D7FF or
  U+E000–U+10FFFF (i.e. any code point except surrogates). Queries, member names and strings
  are sequences of characters; *lengths and orderings are always in characters, never in UTF-16
  code units or UTF-8 bytes*.
- **Nothing**: a special result meaning "no value"; distinct from every JSON value including
  `null`. It never appears in a response.
- **LogicalTrue / LogicalFalse**: the results of logical expressions; unrelated to the JSON
  values `true`/`false`.

---

## 1. Requests and responses

### R1. Request handling

The program SHALL implement the driver protocol of `protocol.md` exactly. In particular:

1. Each non-blank input line SHALL produce exactly one response line, in request order, and the
   program SHALL exit with status 0 after end of input. A line is *blank* when it is empty or
   consists only of spaces, tabs and carriage returns (U+0020, U+0009, U+000D); blank lines get no
   response. A carriage return at the end of a line SHALL be ignored (so CRLF line endings work).
   Any other line, including one made only of other white space, is processed as a request
   (and is then a `bad_request`).
2. The error checks SHALL be applied in exactly this order, the first that applies deciding the
   response:
   1. `bad_request` with `"id": null` — the line is not valid JSON, or is JSON but not an object,
      or `id` is missing or not a string;
   2. `unknown_op` — `op` is missing, not a string, or not the string `"query"`;
   3. `bad_request` — `input` is missing or not an object, or `input.query` is missing or not a
      string, or `input.document` is missing;
   4. `invalid_query` — `input.query` is not a well-formed and valid JSONPath query (R2–R28).
3. `input.document` SHALL be accepted whatever JSON value it is, including `null`, `false`,
   `0`, `""`, `[]` and `{}`; only its *absence* is an error.
4. Members of the request or of `input` other than those named above SHALL be ignored.
5. A response SHALL contain only `id` and `result`, or only `id` and `error`. `result` is
   `{"values": [...], "paths": [...]}`, both arrays of equal length, element *i* of `paths` being
   the normalized path of the node whose value is element *i* of `values`.
6. Whether a query is well formed and valid SHALL depend only on the query string, never on the
   document. A well-formed and valid query SHALL never produce an error, whatever the document:
   mismatches between query and data simply select fewer (possibly zero) nodes.
7. Output SHALL be UTF-8, one JSON object per line, each terminated by LF, with no CR, and
   nothing else on standard output. The program SHOULD flush standard output after each response.

Scenarios:

- **WHEN** the input line is `{"id":"r1","op":"query","input":{"query":"$.a","document":{"a":1}}}`
  **THEN** the output line is `{"id":"r1","result":{"values":[1],"paths":["$['a']"]}}`.
- **WHEN** the input line is `{"id":"r2","op":"query","input":{"query":"$","document":null}}`
  **THEN** the output is `{"id":"r2","result":{"values":[null],"paths":["$"]}}`.
- **WHEN** the input line is `{"id":"r3","op":"query","input":{"query":"$"}}`
  **THEN** the output is `{"id":"r3","error":"bad_request"}`.
- **WHEN** the input line is `{"id":"r4","op":"evaluate","input":{"query":"$","document":1}}`
  **THEN** the output is `{"id":"r4","error":"unknown_op"}`.
- **WHEN** the input line is `{"id":"r5"}` **THEN** the output is
  `{"id":"r5","error":"unknown_op"}` (the `op` check precedes the `input` check).
- **WHEN** the input line is `{"id":"r6","op":"nope","input":{"query":"$[","document":1}}`
  **THEN** the output is `{"id":"r6","error":"unknown_op"}`.
- **WHEN** the input line is `hello` **THEN** the output is `{"id":null,"error":"bad_request"}`.
- **WHEN** the input line is `[1,2]` **THEN** the output is `{"id":null,"error":"bad_request"}`.
- **WHEN** the input line is `{"id":7,"op":"query","input":{"query":"$","document":1}}`
  **THEN** the output is `{"id":null,"error":"bad_request"}`.
- **WHEN** the input line is `{"id":"r8","op":"query","input":{"query":42,"document":1}}`
  **THEN** the output is `{"id":"r8","error":"bad_request"}`.
- **WHEN** the input line is `{"id":"r9","op":"query","input":"$"}`
  **THEN** the output is `{"id":"r9","error":"bad_request"}`.
- **WHEN** the input line is `{"id":"r10","op":"query","input":{"query":"$[","document":{}}}`
  **THEN** the output is `{"id":"r10","error":"invalid_query"}`.
- **WHEN** the input line is `{"id":"r11","op":"query","input":{"query":"$.a","document":1,"extra":true},"x":0}`
  **THEN** the output is `{"id":"r11","result":{"values":[],"paths":[]}}`.
- **WHEN** the input consists of an empty line, a line of two spaces and a tab, and then
  `{"id":"r12","op":"query","input":{"query":"$","document":0}}`
  **THEN** exactly one line is written: `{"id":"r12","result":{"values":[0],"paths":["$"]}}`.
- **WHEN** the input is the line `{"id":"a","op":"query","input":{"query":"$","document":1}}`
  followed by `{"id":"b","op":"query","input":{"query":"$x","document":1}}`
  **THEN** the output is `{"id":"a","result":{"values":[1],"paths":["$"]}}` followed by
  `{"id":"b","error":"invalid_query"}`, and the program exits with status 0 at end of input.
- **WHEN** query `$.a.b.c` is evaluated on `[1,2]` **THEN** values `[]`, paths `[]` (no error).

---

## 2. Query syntax: general rules

The complete grammar is collected in Appendix A; it is normative. The requirements below
restate it piece by piece with its semantics. A query is **well formed** when it matches the
grammar rule `jsonpath-query` in its entirety, and **valid** when, in addition, all integers of
index and slice selectors are within range (R12) and every function expression is well typed
(R21). Every query that is not well formed and valid SHALL produce `invalid_query`.

### R2. Characters and blank space

1. The query SHALL be treated as a sequence of Unicode scalar values. A query containing a
   surrogate code point (U+D800–U+DFFF) that is not part of a valid pair — which can only arrive
   through a `\uD8xx`-style escape in the JSON request — SHALL be `invalid_query`. (A properly
   paired surrogate in the JSON request denotes one supplementary character and is fine.)
2. *Blank space* is exactly the four characters U+0020 space, U+0009 tab, U+000A line feed and
   U+000D carriage return. No other character (for example U+000C form feed, U+00A0 no-break space,
   U+2028) counts as blank space.
3. Blank space SHALL be accepted only where the grammar allows it (the rule `S`), namely:
   between segments (`$ .a`, `$ ['a']`, `$.a ..b`); inside brackets before and after each
   selector and around the commas (`$[ 'a' , 'b' ]`); inside slice selectors as allowed by the
   slice rule (R11); after `?` in a filter selector; around the logical operators `&&`, `||`,
   around comparison operators, after `!`, inside parentheses; inside function calls after `(`,
   before `)` and around commas. It SHALL NOT be accepted before the leading `$`, after the end
   of the query, between `.` or `..` and the name or `*` that follows, between a function name
   and its `(`, inside multi-character operators (`==`, `!=`, `<=`, `>=`, `&&`, `||`), inside
   numbers, or inside the brackets of a segment of a *singular query* used as a comparable or
   value-typed function argument (R17).

Scenarios:

- **WHEN** query `` (empty string) is evaluated **THEN** `invalid_query`.
- **WHEN** query ` $` (leading space) **THEN** `invalid_query`.
- **WHEN** query `$ ` (trailing space) **THEN** `invalid_query`.
- **WHEN** query `$ .a` is evaluated on `{"a":1}` **THEN** values `[1]`, paths `["$['a']"]`.
- **WHEN** query `$ ['a'] ['b']` is evaluated on `{"a":{"b":2}}` **THEN** values `[2]`, paths `["$['a']['b']"]`.
- **WHEN** the query is `$`, a line feed character, `.a` (i.e. the JSON request has `"$\n.a"`), evaluated on `{"a":1}` **THEN** values `[1]`, paths `["$['a']"]`.
- **WHEN** the query is `$`, a tab character, `['a']` evaluated on `{"a":1}` **THEN** values `[1]`, paths `["$['a']"]`.
- **WHEN** the query is `$`, a form feed character (U+000C), `.a` **THEN** `invalid_query`.
- **WHEN** the query is `$['a'`, a no-break space (U+00A0), `]` **THEN** `invalid_query`.
- **WHEN** query `$. a` **THEN** `invalid_query`.
- **WHEN** query `$.. a` **THEN** `invalid_query`.
- **WHEN** query `$ ..a` is evaluated on `{"a":1}` **THEN** values `[1]`, paths `["$['a']"]`.
- **WHEN** query `$[ 'a' , 'b' ]` is evaluated on `{"a":1,"b":2}` **THEN** values `[1,2]`, paths `["$['a']","$['b']"]`.
- **WHEN** the JSON request's query is `"$['\ud800']"` (a lone high surrogate inside the quotes) **THEN** `invalid_query`.
- **WHEN** the JSON request's query is `"$['\ud83d\ude00']"` (the query is `$['😀']`) evaluated on `{"😀":1}` **THEN** values `[1]`, paths `["$['😀']"]`.

### R3. Root identifier and query structure

1. A query SHALL consist of the root identifier `$` followed by zero or more segments
   (`jsonpath-query = "$" *(S segment)`). Nothing else may precede or follow.
2. `$` alone SHALL select the root node: the result is the document itself with path `$`.
3. Evaluation: the root identifier produces the nodelist containing only the root node. Each
   segment, in order, is applied to every node of the current nodelist in turn; the nodelists it
   produces for the individual input nodes are concatenated in the order of the input nodes, and
   the result is the input to the next segment. The nodelist after the last segment is the
   result. Nodes are never de-duplicated. If some segment yields an empty nodelist, the result
   is empty.
4. The current-node identifier `@` SHALL be accepted only inside filter expressions (R13);
   a query beginning with anything other than `$` is `invalid_query`.

Scenarios:

- **WHEN** query `$` is evaluated on `{"k":"v"}` **THEN** values `[{"k":"v"}]`, paths `["$"]`.
- **WHEN** query `$` is evaluated on `42` **THEN** values `[42]`, paths `["$"]`.
- **WHEN** query `@` **THEN** `invalid_query`.
- **WHEN** query `@.a` **THEN** `invalid_query`.
- **WHEN** query `a` **THEN** `invalid_query`.
- **WHEN** query `$$` **THEN** `invalid_query`.
- **WHEN** query `$a` **THEN** `invalid_query`.
- **WHEN** query `$.a[*].b` is evaluated on `{"a":[{"b":0},{"b":1},{"c":2}]}` **THEN** values `[0,1]`, paths `["$['a'][0]['b']","$['a'][1]['b']"]`.
- **WHEN** query `$[*][*]` is evaluated on `[[1,2],[3],4]` **THEN** values `[1,2,3]`, paths `["$[0][0]","$[0][1]","$[1][0]"]`.
- **WHEN** query `$[0,0][0]` is evaluated on `[[7]]` **THEN** values `[7,7]`, paths `["$[0][0]","$[0][0]"]`.
- **WHEN** query `$.x[0]` is evaluated on `{"y":[1]}` **THEN** values `[]`, paths `[]`.

---

## 3. Segments

### R4. Child segments

1. A child segment SHALL be either a *bracketed selection* `[` selector (`,` selector)* `]` with
   at least one selector (blank space allowed after `[`, before `]`, and around each comma), or
   the shorthand `.*` (equivalent to `[*]`), or the shorthand `.name` (equivalent to `['name']`,
   R5).
2. Applied to one input node, a child segment SHALL produce the concatenation of the nodelists
   produced by each of its selectors, in the order in which the selectors are written. A node
   selected by several selectors appears once per selection.
3. Each selector may be any of: name selector (R8), wildcard (R9), index (R10), slice (R11),
   filter (R14). Kinds may be mixed in one segment.
4. `[]`, a trailing comma, a leading comma, two consecutive commas, an unclosed bracket, a lone
   `.`, and `.` followed by `[` SHALL be `invalid_query`.

Scenarios:

- **WHEN** query `$['a','b']` is evaluated on `{"a":1,"b":2}` **THEN** values `[1,2]`, paths `["$['a']","$['b']"]`.
- **WHEN** query `$['b','a','b']` is evaluated on `{"a":1,"b":2}` **THEN** values `[2,1,2]`, paths `["$['b']","$['a']","$['b']"]`.
- **WHEN** query `$[0, 3]` is evaluated on `["a","b","c","d","e","f","g"]` **THEN** values `["a","d"]`, paths `["$[0]","$[3]"]`.
- **WHEN** query `$[0:2, 5]` is evaluated on `["a","b","c","d","e","f","g"]` **THEN** values `["a","b","f"]`, paths `["$[0]","$[1]","$[5]"]`.
- **WHEN** query `$[0, 0]` is evaluated on `["a","b","c","d","e","f","g"]` **THEN** values `["a","a"]`, paths `["$[0]","$[0]"]`.
- **WHEN** query `$[0, 'a', 1:3, *]` is evaluated on `["x","y","z"]` **THEN** values `["x","y","z","x","y","z"]`, paths `["$[0]","$[1]","$[2]","$[0]","$[1]","$[2]"]`.
- **WHEN** query `$[?@ > 1, 0]` is evaluated on `[1,2,3]` **THEN** values `[2,3,1]`, paths `["$[1]","$[2]","$[0]"]`.
- **WHEN** query `$['a', 0]` is evaluated on `{"a":1}` **THEN** values `[1]`, paths `["$['a']"]`.
- **WHEN** query `$.*` is evaluated on `{"a":1,"b":[2]}` **THEN** values `[1,[2]]`, paths `["$['a']","$['b']"]`.
- **WHEN** query `$[]` **THEN** `invalid_query`.
- **WHEN** query `$['a',]` **THEN** `invalid_query`.
- **WHEN** query `$[,'a']` **THEN** `invalid_query`.
- **WHEN** query `$['a',,'b']` **THEN** `invalid_query`.
- **WHEN** query `$['a'` **THEN** `invalid_query`.
- **WHEN** query `$['a']]` **THEN** `invalid_query`.
- **WHEN** query `$.` **THEN** `invalid_query`.
- **WHEN** query `$.['a']` **THEN** `invalid_query`.
- **WHEN** query `$.**` **THEN** `invalid_query`.
- **WHEN** query `$[**]` **THEN** `invalid_query`.

### R5. Member-name shorthand

1. `.name` and `..name` SHALL accept a name whose first character is an ASCII letter `A`–`Z`,
   `a`–`z`, the underscore `_`, or any character U+0080 or above (excluding surrogates), and whose
   following characters are any of those or an ASCII digit `0`–`9`. The name is taken literally
   (no escapes). The longest such run of characters is the name.
2. `.name` SHALL be equivalent to `['name']` and `..name` to `..['name']`. Names that are
   keywords elsewhere (`true`, `false`, `null`, function names) are ordinary names here.
3. A shorthand name starting with a digit, or containing characters outside the allowed set
   (such as `-`, `$`, `@`, `'`, `\`, space, or U+007F), SHALL make the query `invalid_query`
   unless the remaining text happens to form further valid segments.

Scenarios:

- **WHEN** query `$.a` is evaluated on `{"a":1}` **THEN** values `[1]`, paths `["$['a']"]`.
- **WHEN** query `$._foo1` is evaluated on `{"_foo1":"x"}` **THEN** values `["x"]`, paths `["$['_foo1']"]`.
- **WHEN** query `$.ü` is evaluated on `{"ü":1}` **THEN** values `[1]`, paths `["$['ü']"]`.
- **WHEN** query `$.日本` is evaluated on `{"日本":2}` **THEN** values `[2]`, paths `["$['日本']"]`.
- **WHEN** query `$.a😀` is evaluated on `{"a😀":3}` **THEN** values `[3]`, paths `["$['a😀']"]`.
- **WHEN** query `$.null` is evaluated on `{"null":1}` **THEN** values `[1]`, paths `["$['null']"]`.
- **WHEN** query `$.length` is evaluated on `{"length":5}` **THEN** values `[5]`, paths `["$['length']"]`.
- **WHEN** query `$.foo.bar` is evaluated on `{"foo.bar":1,"foo":{"bar":2}}` **THEN** values `[2]`, paths `["$['foo']['bar']"]`.
- **WHEN** query `$.1` **THEN** `invalid_query`.
- **WHEN** query `$.a-b` **THEN** `invalid_query`.
- **WHEN** query `$.a b` **THEN** `invalid_query`.
- **WHEN** query `$.$a` **THEN** `invalid_query`.
- **WHEN** query `$.'a'` **THEN** `invalid_query`.
- **WHEN** query `$.\u0061` (a backslash in the query text) **THEN** `invalid_query`.

### R6. Descendant segments

1. A descendant segment SHALL be `..` immediately followed (no blank space) by a bracketed
   selection, by `*`, or by a shorthand name. `..*` is equivalent to `..[*]` and `..name` to
   `..['name']`. `..` on its own, `...`, and `..` followed by anything else SHALL be
   `invalid_query`.
2. Semantics: for one input node, the segment visits the input node itself and all of its
   descendants in **pre-order**: a node is visited before its descendants; the children of an
   array are visited in index order; the children of an object are visited in document order
   (R30); each child's whole subtree is visited before the next child. Let the visited nodes be
   D1 (the input node), D2, …, Dn. The result for the input node is R1 ⧺ R2 ⧺ … ⧺ Rn, where Ri is
   the result of applying the bracketed selection as a *child segment* to Di (R4). The results
   for all input nodes are concatenated in input order.
3. Consequently the selectors are applied to each visited node in turn (not "all nodes for
   selector 1, then all nodes for selector 2").

Scenarios (unless stated, the document is
`{"o":{"j":1,"k":2},"a":[5,3,[{"j":4},{"k":6}]]}`):

- **WHEN** query `$..j` **THEN** values `[1,4]`, paths `["$['o']['j']","$['a'][2][0]['j']"]`.
- **WHEN** query `$..[0]` **THEN** values `[5,{"j":4}]`, paths `["$['a'][0]","$['a'][2][0]"]`.
- **WHEN** query `$..*` **THEN** values `[{"j":1,"k":2},[5,3,[{"j":4},{"k":6}]],1,2,5,3,[{"j":4},{"k":6}],{"j":4},{"k":6},4,6]`, paths `["$['o']","$['a']","$['o']['j']","$['o']['k']","$['a'][0]","$['a'][1]","$['a'][2]","$['a'][2][0]","$['a'][2][1]","$['a'][2][0]['j']","$['a'][2][1]['k']"]`.
- **WHEN** query `$..[*]` **THEN** the same values and paths as `$..*`.
- **WHEN** query `$..o` **THEN** values `[{"j":1,"k":2}]`, paths `["$['o']"]`.
- **WHEN** query `$.o..[*, *]` **THEN** values `[1,2,1,2]`, paths `["$['o']['j']","$['o']['k']","$['o']['j']","$['o']['k']"]`.
- **WHEN** query `$.a..[0, 1]` **THEN** values `[5,3,{"j":4},{"k":6}]`, paths `["$['a'][0]","$['a'][1]","$['a'][2][0]","$['a'][2][1]"]`.
- **WHEN** query `$..['j','k']` **THEN** values `[1,2,4,6]`, paths `["$['o']['j']","$['o']['k']","$['a'][2][0]['j']","$['a'][2][1]['k']"]`.
- **WHEN** query `$..a` is evaluated on `{"a":{"a":1}}` **THEN** values `[{"a":1},1]`, paths `["$['a']","$['a']['a']"]`.
- **WHEN** query `$..[?@ > 1]` is evaluated on `{"x":[1,2,{"y":3}],"z":5}` **THEN** values `[5,2,3]`, paths `["$['z']","$['x'][1]","$['x'][2]['y']"]`.
- **WHEN** query `$..*` is evaluated on `5` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$..*` is evaluated on `[]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$..` **THEN** `invalid_query`.
- **WHEN** query `$...a` **THEN** `invalid_query`.
- **WHEN** query `$..1` **THEN** `invalid_query`.
- **WHEN** query `$..[1]` is evaluated on `[[0,1],2]` **THEN** values `[2,1]`, paths `["$[1]","$[0][1]"]`.

---

## 4. Selectors

### R7. String literals

String literals are used by name selectors (R8) and as literals in filter expressions (R16).

1. A string literal SHALL be delimited by double quotes `"…"` or single quotes `'…'`.
2. Between the delimiters, the following SHALL be accepted:
   - any character in U+0020–U+10FFFF other than the backslash `\`, the delimiting quote
     character, and surrogates — taken literally. (The *other* quote character may appear
     unescaped.)
   - the escapes `\b` (U+0008), `\f` (U+000C), `\n` (U+000A), `\r` (U+000D), `\t` (U+0009),
     `\/` (U+002F), `\\` (U+005C);
   - in a double-quoted literal `\"` (U+0022); in a single-quoted literal `\'` (U+0027);
   - `\uXXXX` with exactly four hexadecimal digits (`0-9`, `a-f`, `A-F`; the `u` must be
     lowercase) denoting a non-surrogate code point (not D800–DFFF), or a pair
     `\uXXXX\uYYYY` where XXXX is a high surrogate (D800–DBFF) and YYYY a low surrogate
     (DC00–DFFF), denoting the supplementary character
     `0x10000 + (XXXX − 0xD800) × 0x400 + (YYYY − 0xDC00)`.
3. Everything else SHALL be `invalid_query`, in particular: a raw character U+0000–U+001F
   inside the literal; `\'` inside a double-quoted literal; `\"` inside a single-quoted
   literal; any other escape letter (`\a`, `\x41`, `\U0041`, `\0`, `\ ` …); `\u` with fewer
   than four hex digits; a lone high surrogate escape, a high surrogate escape not immediately
   followed by a low surrogate escape, or a lone low surrogate escape; an unterminated literal.
4. The value of the literal is the sequence of characters obtained by removing the delimiters
   and replacing each escape by the character it denotes. No Unicode normalization is applied.

Scenarios:

- **WHEN** query `$["a"]` is evaluated on `{"a":1}` **THEN** values `[1]`, paths `["$['a']"]`.
- **WHEN** query `$['\u0061']` is evaluated on `{"a":1}` **THEN** values `[1]`, paths `["$['a']"]`.
- **WHEN** query `$["\u00E9"]` is evaluated on `{"é":1}` **THEN** values `[1]`, paths `["$['é']"]`.
- **WHEN** query `$["\u00e9"]` is evaluated on `{"é":1}` **THEN** values `[1]`, paths `["$['é']"]`.
- **WHEN** query `$["\uD83D\uDE00"]` is evaluated on `{"😀":1}` **THEN** values `[1]`, paths `["$['😀']"]`.
- **WHEN** query `$['\ud83d\ude00']` is evaluated on `{"😀":1}` **THEN** values `[1]`, paths `["$['😀']"]`.
- **WHEN** query `$['\t']` is evaluated on `{"\t":1}` **THEN** values `[1]`, paths `["$['\\t']"]`.
- **WHEN** query `$['a\/b']` is evaluated on `{"a/b":1}` **THEN** values `[1]`, paths `["$['a/b']"]`.
- **WHEN** query `$['a\\b']` (two backslashes in the query text) is evaluated on `{"a\\b":1}` **THEN** values `[1]`, paths `["$['a\\\\b']"]`.
- **WHEN** query `$["a'b"]` is evaluated on `{"a'b":1}` **THEN** values `[1]`, paths `["$['a\\'b']"]`.
- **WHEN** query `$['a\'b']` is evaluated on `{"a'b":1}` **THEN** values `[1]`, paths `["$['a\\'b']"]`.
- **WHEN** query `$['a"b']` is evaluated on `{"a\"b":1}` **THEN** values `[1]`, paths `["$['a\"b']"]`.
- **WHEN** query `$["a\"b"]` is evaluated on `{"a\"b":1}` **THEN** values `[1]`, paths `["$['a\"b']"]`.
- **WHEN** query `$['']` is evaluated on `{"":1}` **THEN** values `[1]`, paths `["$['']"]`.
- **WHEN** query `$["\'"]` **THEN** `invalid_query`.
- **WHEN** query `$['\"']` **THEN** `invalid_query`.
- **WHEN** query `$['\a']` **THEN** `invalid_query`.
- **WHEN** query `$['\U0061']` **THEN** `invalid_query`.
- **WHEN** query `$['\u006']` **THEN** `invalid_query`.
- **WHEN** query `$['\uD800']` **THEN** `invalid_query`.
- **WHEN** query `$['\uDC00']` **THEN** `invalid_query`.
- **WHEN** query `$['\uD800\u0041']` **THEN** `invalid_query`.
- **WHEN** query `$['\uD800x']` **THEN** `invalid_query`.
- **WHEN** the query is `$['a`, a raw tab character (U+0009), `b']` (JSON request `"$['a\tb']"`) **THEN** `invalid_query`.
- **WHEN** the query is `$['a`, a raw line feed, `b']` **THEN** `invalid_query`.
- **WHEN** query `$['abc` **THEN** `invalid_query`.
- **WHEN** query `$['a''b']` **THEN** `invalid_query`.
- **WHEN** query `$[a]` **THEN** `invalid_query`.

### R8. Name selector

1. A name selector is a string literal (R7) inside a bracketed selection. Its value M is the
   member name.
2. Applied to an object, it SHALL select the value of the member whose name equals M, if any.
   Names are equal if and only if they are identical sequences of characters (no
   normalization, case-sensitive). Applied to any non-object, it SHALL select nothing.

Scenarios (unless stated, document `{"o":{"j j":{"k.k":3}},"'":{"@":2}}`):

- **WHEN** query `$.o['j j']` **THEN** values `[{"k.k":3}]`, paths `["$['o']['j j']"]`.
- **WHEN** query `$.o['j j']['k.k']` **THEN** values `[3]`, paths `["$['o']['j j']['k.k']"]`.
- **WHEN** query `$.o["j j"]["k.k"]` **THEN** values `[3]`, paths `["$['o']['j j']['k.k']"]`.
- **WHEN** query `$["'"]["@"]` **THEN** values `[2]`, paths `["$['\\'']['@']"]`.
- **WHEN** query `$['O']` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$['0']` is evaluated on `["x"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$['a']` is evaluated on `"a"` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$['é']` (é is U+00E9) is evaluated on `{"e\u0301":1}` **THEN** values `[]`, paths `[]`.

### R9. Wildcard selector

1. The wildcard selector `*` SHALL select all children of an object (member values, in document
   order, R30) or of an array (elements, in index order). It SHALL select nothing from a
   primitive value.

Scenarios (unless stated, document `{"o":{"j":1,"k":2},"a":[5,3]}`):

- **WHEN** query `$[*]` **THEN** values `[{"j":1,"k":2},[5,3]]`, paths `["$['o']","$['a']"]`.
- **WHEN** query `$.o[*]` **THEN** values `[1,2]`, paths `["$['o']['j']","$['o']['k']"]`.
- **WHEN** query `$.o[*, *]` **THEN** values `[1,2,1,2]`, paths `["$['o']['j']","$['o']['k']","$['o']['j']","$['o']['k']"]`.
- **WHEN** query `$.a[*]` **THEN** values `[5,3]`, paths `["$['a'][0]","$['a'][1]"]`.
- **WHEN** query `$.a.*` **THEN** values `[5,3]`, paths `["$['a'][0]","$['a'][1]"]`.
- **WHEN** query `$[*]` is evaluated on `"abc"` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[*]` is evaluated on `{}` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[*]` is evaluated on `[]` **THEN** values `[]`, paths `[]`.

### R10. Index selector

1. An index selector is an integer written as `0` or as an optional `-` followed by a digit
   `1`–`9` and further digits: no leading zeros, no `+`, no `-0`, no fraction or exponent, no
   blank space between `-` and the digits. Its value SHALL lie in the range of R12.
2. Applied to an array of length `len`, a non-negative index `i` SHALL select the element at
   position `i` if `i < len`; a negative index `i` SHALL select the element at position
   `len + i` if that is `≥ 0`. Otherwise nothing is selected (not an error). Applied to a
   non-array, it SHALL select nothing.

Scenarios (unless stated, document `["a","b"]`):

- **WHEN** query `$[1]` **THEN** values `["b"]`, paths `["$[1]"]`.
- **WHEN** query `$[0]` **THEN** values `["a"]`, paths `["$[0]"]`.
- **WHEN** query `$[-2]` **THEN** values `["a"]`, paths `["$[0]"]`.
- **WHEN** query `$[-1]` **THEN** values `["b"]`, paths `["$[1]"]`.
- **WHEN** query `$[2]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[-3]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[ 1 ]` **THEN** values `["b"]`, paths `["$[1]"]`.
- **WHEN** query `$[0]` is evaluated on `{"0":1}` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[0]` is evaluated on `"abc"` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[9007199254740991]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[-9007199254740991]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[01]` **THEN** `invalid_query`.
- **WHEN** query `$[-0]` **THEN** `invalid_query`.
- **WHEN** query `$[+1]` **THEN** `invalid_query`.
- **WHEN** query `$[1.0]` **THEN** `invalid_query`.
- **WHEN** query `$[1e2]` **THEN** `invalid_query`.
- **WHEN** query `$[- 1]` **THEN** `invalid_query`.
- **WHEN** query `$[0x1]` **THEN** `invalid_query`.
- **WHEN** query `$.0` **THEN** `invalid_query`.

### R11. Array slice selector

1. Syntax: `[start S] ":" S [end S] [":" [S step]]` where `start`, `end`, `step` are integers
   written as in R10, each optional, and S is optional blank space. The first colon is
   mandatory; the second colon may be omitted (then step is absent). Examples of well-formed
   slices: `1:3`, `:`, `::`, `5:`, `:2`, `::2`, `1:2:`, `1 : 2 : 3`, `-1::-1`. Values SHALL lie
   in the range of R12.
2. Semantics, for an array of length `len` (applied to a non-array a slice selects nothing):
   - `step` defaults to 1. If `step = 0`, nothing is selected.
   - If `step > 0`: `start` defaults to 0 and `end` to `len`. If `step < 0`: `start` defaults to
     `len − 1` and `end` to `−len − 1`.
   - Normalize: `norm(i) = i` if `i ≥ 0`, else `len + i`.
   - If `step > 0`: `lower = min(max(norm(start), 0), len)`, `upper = min(max(norm(end), 0), len)`;
     select indices `lower, lower+step, …` while `< upper`, in that order.
   - If `step < 0`: `upper = min(max(norm(start), −1), len − 1)`,
     `lower = min(max(norm(end), −1), len − 1)`; select indices `upper, upper+step, …` while
     `> lower`, in that order (i.e. descending).
3. Integer arithmetic SHALL be exact for all values allowed by R12 (in JavaScript/TypeScript,
   ordinary numbers suffice because all intermediate values stay within ±2^54 before the loop
   ends; do not loop element by element over huge ranges).

Scenarios (unless stated, document `["a","b","c","d","e","f","g"]`, length 7):

- **WHEN** query `$[1:3]` **THEN** values `["b","c"]`, paths `["$[1]","$[2]"]`.
- **WHEN** query `$[5:]` **THEN** values `["f","g"]`, paths `["$[5]","$[6]"]`.
- **WHEN** query `$[1:5:2]` **THEN** values `["b","d"]`, paths `["$[1]","$[3]"]`.
- **WHEN** query `$[5:1:-2]` **THEN** values `["f","d"]`, paths `["$[5]","$[3]"]`.
- **WHEN** query `$[::-1]` **THEN** values `["g","f","e","d","c","b","a"]`, paths `["$[6]","$[5]","$[4]","$[3]","$[2]","$[1]","$[0]"]`.
- **WHEN** query `$[:]` **THEN** values `["a","b","c","d","e","f","g"]`, paths `["$[0]","$[1]","$[2]","$[3]","$[4]","$[5]","$[6]"]`.
- **WHEN** query `$[::]` **THEN** the same as `$[:]`.
- **WHEN** query `$[1:2:]` **THEN** values `["b"]`, paths `["$[1]"]`.
- **WHEN** query `$[::2]` **THEN** values `["a","c","e","g"]`, paths `["$[0]","$[2]","$[4]","$[6]"]`.
- **WHEN** query `$[-2:]` **THEN** values `["f","g"]`, paths `["$[5]","$[6]"]`.
- **WHEN** query `$[:-2]` **THEN** values `["a","b","c","d","e"]`, paths `["$[0]","$[1]","$[2]","$[3]","$[4]"]`.
- **WHEN** query `$[-1:-3:-1]` **THEN** values `["g","f"]`, paths `["$[6]","$[5]"]`.
- **WHEN** query `$[3::-1]` **THEN** values `["d","c","b","a"]`, paths `["$[3]","$[2]","$[1]","$[0]"]`.
- **WHEN** query `$[:2:-1]` **THEN** values `["g","f","e","d"]`, paths `["$[6]","$[5]","$[4]","$[3]"]`.
- **WHEN** query `$[2:-10:-1]` **THEN** values `["c","b","a"]`, paths `["$[2]","$[1]","$[0]"]`.
- **WHEN** query `$[-10:2]` **THEN** values `["a","b"]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[0:0]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[3:1]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[::0]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[10:20]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[1 : 2 : 1]` **THEN** values `["b"]`, paths `["$[1]"]`.
- **WHEN** query `$[::9007199254740991]` **THEN** values `["a"]`, paths `["$[0]"]`.
- **WHEN** query `$[::-9007199254740991]` **THEN** values `["g"]`, paths `["$[6]"]`.
- **WHEN** query `$[-9007199254740991:9007199254740991]` **THEN** values `["a","b","c","d","e","f","g"]`, paths `["$[0]","$[1]","$[2]","$[3]","$[4]","$[5]","$[6]"]`.
- **WHEN** query `$[1:3]` is evaluated on `{"a":1}` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[1:3]` is evaluated on `"abcdef"` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[1:2:3:4]` **THEN** `invalid_query`.
- **WHEN** query `$[:-0]` **THEN** `invalid_query`.
- **WHEN** query `$[01:2]` **THEN** `invalid_query`.
- **WHEN** query `$[1:2:0.5]` **THEN** `invalid_query`.

### R12. Integer range

1. Every integer of an index selector and every `start`, `end` and `step` of a slice selector —
   wherever it occurs, including inside filter queries — SHALL lie in
   [−(2^53)+1, (2^53)−1] = [−9007199254740991, 9007199254740991]; otherwise the query SHALL be
   `invalid_query`. The check is on the written integer, independent of the document.
2. This range does not apply to number literals in filter expressions (R16) nor to I-Regexp
   quantifiers (R27).

Scenarios:

- **WHEN** query `$[9007199254740992]` **THEN** `invalid_query`.
- **WHEN** query `$[-9007199254740992]` **THEN** `invalid_query`.
- **WHEN** query `$[0:9007199254740992]` **THEN** `invalid_query`.
- **WHEN** query `$[-9007199254740992:]` **THEN** `invalid_query`.
- **WHEN** query `$[::-9007199254740992]` **THEN** `invalid_query`.
- **WHEN** query `$[99999999999999999999999]` **THEN** `invalid_query`.
- **WHEN** query `$[?@[9007199254740992]]` **THEN** `invalid_query`.
- **WHEN** query `$[?@ == 9007199254740992]` is evaluated on `[1]` **THEN** values `[]`, paths `[]` (a number literal, not an index: valid).

---

## 5. Filter selectors

### R13. Filter syntax

1. A filter selector SHALL be `?`, optional blank space, then a *logical expression*:

   ```
   logical-expr  = or-expr
   or-expr       = and-expr *(S "||" S and-expr)
   and-expr      = basic-expr *(S "&&" S basic-expr)
   basic-expr    = paren-expr / comparison-expr / test-expr
   paren-expr    = ["!" S] "(" S logical-expr S ")"
   test-expr     = ["!" S] (filter-query / function-expr)
   filter-query  = ("@" / "$") segments          ; relative or absolute query
   comparison-expr = comparable S comparison-op S comparable
   comparable    = literal / singular-query / function-expr
   comparison-op = "==" / "!=" / "<=" / ">=" / "<" / ">"
   ```

2. Precedence, highest first: grouping `( … )` and function calls; `!`; comparisons; `&&`; `||`.
   `&&` and `||` are left-associative (and associative anyway).
3. `!` SHALL apply only to a parenthesized expression or to a test expression (a query or a
   function call). It cannot be doubled (`!!@.a` is ill-formed; write `!(!@.a)`), and it cannot
   be applied to a comparison without parentheses (`!@.a == 1` is ill-formed; write
   `!(@.a == 1)`).
4. A comparison has exactly one operator: `a == b == c` is ill-formed. A literal alone is not a
   logical expression (`$[?true]`, `$[?1]`, `$[?'a']`, `$[?null]` are ill-formed).
5. `@` refers to the current node of the innermost enclosing filter; `$` to the document root.
   Inside a filter, queries may use every kind of segment and selector, including nested filters.
6. A filter-query used as a test or function argument may be any query; a query used as a
   *comparable* must be a singular query (R17).
7. Any construct not described here (`=`, `===`, `<>`, `=<`, `&`, `|`, `and`, `or`, `not`,
   uppercase `True`, array or object literals, arithmetic) SHALL be `invalid_query`.

Scenarios (unless stated, document `[{"a":1,"b":2},{"a":2},{"b":3}]`):

- **WHEN** query `$[?@.a]` **THEN** values `[{"a":1,"b":2},{"a":2}]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[? @.a ]` **THEN** values `[{"a":1,"b":2},{"a":2}]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?(@.a)]` **THEN** values `[{"a":1,"b":2},{"a":2}]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?((@.a))]` **THEN** values `[{"a":1,"b":2},{"a":2}]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?@.a==1]` **THEN** values `[{"a":1,"b":2}]`, paths `["$[0]"]`.
- **WHEN** query `$[?@.a   ==   1]` **THEN** values `[{"a":1,"b":2}]`, paths `["$[0]"]`.
- **WHEN** query `$[?1 == @.a]` **THEN** values `[{"a":1,"b":2}]`, paths `["$[0]"]`.
- **WHEN** query `$[?!@.a]` **THEN** values `[{"b":3}]`, paths `["$[2]"]`.
- **WHEN** query `$[?! @.a]` **THEN** values `[{"b":3}]`, paths `["$[2]"]`.
- **WHEN** query `$[?!(@.a == 1)]` **THEN** values `[{"a":2},{"b":3}]`, paths `["$[1]","$[2]"]`.
- **WHEN** query `$[?!(!@.a)]` **THEN** values `[{"a":1,"b":2},{"a":2}]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?@.a&&@.b]` **THEN** values `[{"a":1,"b":2}]`, paths `["$[0]"]`.
- **WHEN** query `$[?@.a == 2 || @.b == 3]` **THEN** values `[{"a":2},{"b":3}]`, paths `["$[1]","$[2]"]`.
- **WHEN** the query is `$[?@.a`, line feed, `==`, line feed, `1]` **THEN** values `[{"a":1,"b":2}]`, paths `["$[0]"]`.
- **WHEN** query `$[?@.a].b` **THEN** values `[2]`, paths `["$[0]['b']"]`.
- **WHEN** query `$[?]` **THEN** `invalid_query`.
- **WHEN** query `$[@.a]` **THEN** `invalid_query`.
- **WHEN** query `$[?@.a ==]` **THEN** `invalid_query`.
- **WHEN** query `$[?== 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@.a = 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@.a === 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@.a <> 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@.a =< 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@.a = = 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@.a == 1 == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?!!@.a]` **THEN** `invalid_query`.
- **WHEN** query `$[?!@.a == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?(@.a) == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@.a & @.b]` **THEN** `invalid_query`.
- **WHEN** query `$[?@.a | @.b]` **THEN** `invalid_query`.
- **WHEN** query `$[?@.a and @.b]` **THEN** `invalid_query`.
- **WHEN** query `$[?(@.a]` **THEN** `invalid_query`.
- **WHEN** query `$[?@.a)]` **THEN** `invalid_query`.
- **WHEN** query `$[?()]` **THEN** `invalid_query`.
- **WHEN** query `$[?true]` **THEN** `invalid_query`.
- **WHEN** query `$[?false]` **THEN** `invalid_query`.
- **WHEN** query `$[?null]` **THEN** `invalid_query`.
- **WHEN** query `$[?1]` **THEN** `invalid_query`.
- **WHEN** query `$[?'a']` **THEN** `invalid_query`.
- **WHEN** query `$[?@ == [1]]` **THEN** `invalid_query`.
- **WHEN** query `$[?@ == {}]` **THEN** `invalid_query`.
- **WHEN** query `$[?@.a + 1 == 2]` **THEN** `invalid_query`.
- **WHEN** query `$[?@.a == True]` **THEN** `invalid_query`.

### R14. Filter semantics

1. Applied to an array, a filter selector SHALL evaluate its logical expression once per element,
   with that element's node as the current node `@`, and select the elements for which the result
   is LogicalTrue, in index order. Applied to an object, likewise for each member value, in
   document order (R30). Applied to a primitive, it selects nothing.
2. Queries inside the expression starting with `@` are evaluated with the current node as their
   root; their locations (irrelevant to the result) are relative. Queries starting with `$` are
   evaluated against the whole document.
3. Evaluation has no side effects; implementations may short-circuit `&&`/`||` or not.
4. Evaluation of a filter never raises an error.

Scenarios (unless stated, document
`{"a":[3,5,1,2,4,6,{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}],"o":{"p":1,"q":2,"r":3,"s":5,"t":{"u":6}},"e":"f"}`):

- **WHEN** query `$.a[?@.b == 'kilo']` **THEN** values `[{"b":"kilo"}]`, paths `["$['a'][9]"]`.
- **WHEN** query `$.a[?(@.b == 'kilo')]` **THEN** values `[{"b":"kilo"}]`, paths `["$['a'][9]"]`.
- **WHEN** query `$.a[?@>3.5]` **THEN** values `[5,4,6]`, paths `["$['a'][1]","$['a'][4]","$['a'][5]"]`.
- **WHEN** query `$.a[?@.b]` **THEN** values `[{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}]`, paths `["$['a'][6]","$['a'][7]","$['a'][8]","$['a'][9]"]`.
- **WHEN** query `$[?@.*]` **THEN** values `[[3,5,1,2,4,6,{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}],{"p":1,"q":2,"r":3,"s":5,"t":{"u":6}}]`, paths `["$['a']","$['o']"]`.
- **WHEN** query `$[?@[?@.b]]` **THEN** values `[[3,5,1,2,4,6,{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}]]`, paths `["$['a']"]`.
- **WHEN** query `$.o[?@<3, ?@<3]` **THEN** values `[1,2,1,2]`, paths `["$['o']['p']","$['o']['q']","$['o']['p']","$['o']['q']"]`.
- **WHEN** query `$.a[?@<2 || @.b == "k"]` **THEN** values `[1,{"b":"k"}]`, paths `["$['a'][2]","$['a'][7]"]`.
- **WHEN** query `$.a[?match(@.b, "[jk]")]` **THEN** values `[{"b":"j"},{"b":"k"}]`, paths `["$['a'][6]","$['a'][7]"]`.
- **WHEN** query `$.a[?search(@.b, "[jk]")]` **THEN** values `[{"b":"j"},{"b":"k"},{"b":"kilo"}]`, paths `["$['a'][6]","$['a'][7]","$['a'][9]"]`.
- **WHEN** query `$.o[?@>1 && @<4]` **THEN** values `[2,3]`, paths `["$['o']['q']","$['o']['r']"]`.
- **WHEN** query `$.o[?@.u || @.x]` **THEN** values `[{"u":6}]`, paths `["$['o']['t']"]`.
- **WHEN** query `$.a[?@.b == $.x]` **THEN** values `[3,5,1,2,4,6]`, paths `["$['a'][0]","$['a'][1]","$['a'][2]","$['a'][3]","$['a'][4]","$['a'][5]"]`.
- **WHEN** query `$.a[?@ == @]` **THEN** values `[3,5,1,2,4,6,{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}]`, paths `["$['a'][0]","$['a'][1]","$['a'][2]","$['a'][3]","$['a'][4]","$['a'][5]","$['a'][6]","$['a'][7]","$['a'][8]","$['a'][9]"]`.
- **WHEN** query `$[?@ == 1]` is evaluated on `1` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?@ > 1]` is evaluated on `{"x":1,"y":2,"z":3}` **THEN** values `[2,3]`, paths `["$['y']","$['z']"]`.
- **WHEN** query `$.a[?@ == $.n]` is evaluated on `{"a":[1,2,3],"n":2}` **THEN** values `[2]`, paths `["$['a'][1]"]`.
- **WHEN** query `$[?$.flag]` is evaluated on `{"flag":false,"v":1}` **THEN** values `[false,1]`, paths `["$['flag']","$['v']"]`.
- **WHEN** query `$[?@[?@ > 2]]` is evaluated on `[[1,2],[3]]` **THEN** values `[[3]]`, paths `["$[1]"]`.
- **WHEN** query `$[?@.a < @.b]` is evaluated on `[{"a":"x","b":1},{"a":[1],"b":[2]}]` **THEN** values `[]`, paths `[]`.

### R15. Existence tests

1. A query used by itself as a test SHALL yield LogicalTrue if it selects at least one node and
   LogicalFalse otherwise — regardless of the selected values (a selected `null` or `false` counts).
   Any query (singular or not, relative or absolute) may be tested.
2. `!query` SHALL yield the negation.

Scenarios:

- **WHEN** query `$[?@]` is evaluated on `[0,false,null,"",[],{}]` **THEN** values `[0,false,null,"",[],{}]`, paths `["$[0]","$[1]","$[2]","$[3]","$[4]","$[5]"]`.
- **WHEN** query `$[?@.a]` is evaluated on `[{"a":false},{"a":null},{}]` **THEN** values `[{"a":false},{"a":null}]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?!@.a]` is evaluated on `[{"a":false},{"a":null},{}]` **THEN** values `[{}]`, paths `["$[2]"]`.
- **WHEN** query `$[?@..x]` is evaluated on `[{"y":{"x":1}},{"y":2}]` **THEN** values `[{"y":{"x":1}}]`, paths `["$[0]"]`.
- **WHEN** query `$[?@[1:]]` is evaluated on `[[1],[1,2],"ab"]` **THEN** values `[[1,2]]`, paths `["$[1]"]`.

### R16. Literals

1. Literals SHALL be: numbers, string literals (R7), `true`, `false`, `null` (lowercase only).
2. Number syntax: optional `-`, then `0` or a digit `1`–`9` followed by digits; then an optional
   fraction `.` followed by one or more digits; then an optional exponent `e` or `E`, an
   optional `+` or `-`, and one or more digits. `-0` is allowed (it equals 0). Not allowed:
   leading zeros (`01`), a leading `+`, a bare `.5`, a trailing `1.`, an empty exponent `1e`,
   hexadecimal, `NaN`, `Infinity`.
3. A number literal denotes its mathematical value; it is not range-checked (R12 does not apply).
   An implementation SHALL convert it to an IEEE 754 binary64 number (round to nearest) for
   comparisons (see R18.5); literals whose magnitude overflows become ±infinity, which compare
   as such. This is never an error.

Scenarios:

- **WHEN** query `$[?@ == 1e2]` is evaluated on `[100,100.0,"100",1]` **THEN** values `[100,100.0]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?@ == 1E+2]` is evaluated on `[100]` **THEN** values `[100]`, paths `["$[0]"]`.
- **WHEN** query `$[?@ == 1.5e-1]` is evaluated on `[0.15,1.5]` **THEN** values `[0.15]`, paths `["$[0]"]`.
- **WHEN** query `$[?@ < -0.5]` is evaluated on `[-1,-0.5,0]` **THEN** values `[-1]`, paths `["$[0]"]`.
- **WHEN** query `$[?@ == -0]` is evaluated on `[0,-0,0.0,1]` **THEN** values `[0,-0,0.0]`, paths `["$[0]","$[1]","$[2]"]`.
- **WHEN** query `$[?@ == -0.0]` is evaluated on `[0]` **THEN** values `[0]`, paths `["$[0]"]`.
- **WHEN** query `$[?@ == "a"]` is evaluated on `["a","b"]` **THEN** values `["a"]`, paths `["$[0]"]`.
- **WHEN** query `$[?@ == 'it\'s']` is evaluated on `["it's"]` **THEN** values `["it's"]`, paths `["$[0]"]`.
- **WHEN** query `$[?@ == true]` is evaluated on `[true,"true",1]` **THEN** values `[true]`, paths `["$[0]"]`.
- **WHEN** query `$[?@ == false]` is evaluated on `[false,0,null]` **THEN** values `[false]`, paths `["$[0]"]`.
- **WHEN** query `$[?@ == null]` is evaluated on `[null,0,false,""]` **THEN** values `[null]`, paths `["$[0]"]`.
- **WHEN** query `$[?@ < 1e400]` is evaluated on `[1]` **THEN** values `[1]`, paths `["$[0]"]`.
- **WHEN** query `$[?@ == 01]` **THEN** `invalid_query`.
- **WHEN** query `$[?@ == +1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@ == .5]` **THEN** `invalid_query`.
- **WHEN** query `$[?@ == 1.]` **THEN** `invalid_query`.
- **WHEN** query `$[?@ == 1e]` **THEN** `invalid_query`.
- **WHEN** query `$[?@ == 1.5e+]` **THEN** `invalid_query`.
- **WHEN** query `$[?@ == - 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@ == NaN]` **THEN** `invalid_query`.
- **WHEN** query `$[?@ == Null]` **THEN** `invalid_query`.
- **WHEN** query `$[?@ == "abc]` **THEN** `invalid_query`.

### R17. Singular queries and comparables

1. A *singular query* is `@` or `$` followed by zero or more singular segments, each optionally
   preceded by blank space, where a singular segment is exactly one of:
   - `[` *string-literal* `]` — **no blank space inside the brackets**;
   - `.` *shorthand-name*;
   - `[` *index* `]` — an integer as in R10, **no blank space inside the brackets**.

   Wildcards, slices, filters, descendant segments, and brackets with more than one selector
   make a query non-singular, even if it would select at most one node for a given document.
2. A *comparable* SHALL be a literal, a singular query, or a function expression whose declared
   result type is ValueType (R21). Any other query as an operand of a comparison SHALL be
   `invalid_query`.
3. Value of a comparable: a literal denotes its value; a singular query denotes the value of the
   node it selects, or *Nothing* if it selects no node; a function denotes its result (a value or
   Nothing).

Scenarios:

- **WHEN** query `$[?@ == 2]` is evaluated on `[1,2]` **THEN** values `[2]`, paths `["$[1]"]`.
- **WHEN** query `$[?@[0] == 2]` is evaluated on `[[2],[3],2]` **THEN** values `[[2]]`, paths `["$[0]"]`.
- **WHEN** query `$[?@[-1] == 3]` is evaluated on `[[2,3],[3,2]]` **THEN** values `[[2,3]]`, paths `["$[0]"]`.
- **WHEN** query `$[?@['a'] == 1]` is evaluated on `[{"a":1},{"a":2}]` **THEN** values `[{"a":1}]`, paths `["$[0]"]`.
- **WHEN** query `$[?@.a.b == 1]` is evaluated on `[{"a":{"b":1}},{"a":1}]` **THEN** values `[{"a":{"b":1}}]`, paths `["$[0]"]`.
- **WHEN** query `$[?@.a [0] == 1]` is evaluated on `[{"a":[1]}]` **THEN** values `[{"a":[1]}]`, paths `["$[0]"]`.
- **WHEN** query `$[?@ == $]` is evaluated on `[1]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?$.k == @]` is evaluated on `{"k":1,"m":1,"n":2}` **THEN** values `[1,1]`, paths `["$['k']","$['m']"]`.
- **WHEN** query `$[?@.* == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@..a == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@[*] == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@[0:1] == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@['a','b'] == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@[0,1] == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@[?@ > 1] == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?$..a == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@[ 'a' ] == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@[ 0 ] == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?@[ 'a' ]]` is evaluated on `[{"a":1},{}]` **THEN** values `[{"a":1}]`, paths `["$[0]"]` (existence tests accept any query).

### R18. Comparison semantics

1. **Nothing / empty**: if either side is Nothing (an empty singular query or a function result of
   Nothing), `==` SHALL be true if and only if both sides are Nothing, and `<` SHALL be false.
2. **Equality** `a == b` (both values) SHALL be true if and only if:
   - both are numbers with equal numeric value (so `1 == 1.0 == 1e0`, `0 == -0`); or
   - both are strings consisting of identical character sequences; or
   - both are `true`, both `false`, or both `null`; or
   - both are arrays of equal length whose corresponding elements are equal (recursively); or
   - both are objects with the same set of member names whose values for each name are equal
     (recursively; member order is irrelevant).

   Values of different types are never equal (`1 == "1"`, `0 == false`, `null == false` are false).
3. **Ordering** `a < b` SHALL be true if and only if both are numbers and `a` is numerically less
   than `b`, or both are strings and `a` precedes `b` in the following order: the empty string
   precedes every non-empty string; two non-empty strings are ordered by their first characters'
   code points (*Unicode scalar values, not UTF-16 code units*), and if those are equal, by the
   remainders. In all other cases (booleans, null, arrays, objects, mixed types) `<` is false.
4. Derived operators: `a != b` ⇔ not `a == b`; `a <= b` ⇔ `a < b` or `a == b`;
   `a > b` ⇔ `b < a`; `a >= b` ⇔ `b < a` or `a == b`.
5. Numbers SHALL be compared by numeric value. Comparing the IEEE 754 binary64 values of both
   operands is the required method (document numbers converted with round-to-nearest, as
   standard JSON parsers do); results for numbers that cannot be represented exactly in binary64
   follow from that method.

Scenarios — comparison table. Each scenario evaluates `$[?C]` on the document
`{"obj":{"x":"y"},"arr":[2,3]}`. When C is true for every child the result is values
`[{"x":"y"},[2,3]]`, paths `["$['obj']","$['arr']"]` (written **ALL** below); when it is false
the result is values `[]`, paths `[]` (written **NONE**):

- **WHEN** C is `$.absent1 == $.absent2` **THEN** ALL.
- **WHEN** C is `$.absent1 <= $.absent2` **THEN** ALL.
- **WHEN** C is `$.absent == 'g'` **THEN** NONE.
- **WHEN** C is `$.absent1 != $.absent2` **THEN** NONE.
- **WHEN** C is `$.absent != 'g'` **THEN** ALL.
- **WHEN** C is `1 <= 2` **THEN** ALL.
- **WHEN** C is `1 > 2` **THEN** NONE.
- **WHEN** C is `13 == '13'` **THEN** NONE.
- **WHEN** C is `'a' <= 'b'` **THEN** ALL.
- **WHEN** C is `'a' > 'b'` **THEN** NONE.
- **WHEN** C is `$.obj == $.arr` **THEN** NONE.
- **WHEN** C is `$.obj != $.arr` **THEN** ALL.
- **WHEN** C is `$.obj == $.obj` **THEN** ALL.
- **WHEN** C is `$.obj != $.obj` **THEN** NONE.
- **WHEN** C is `$.arr == $.arr` **THEN** ALL.
- **WHEN** C is `$.arr != $.arr` **THEN** NONE.
- **WHEN** C is `$.obj == 17` **THEN** NONE.
- **WHEN** C is `$.obj != 17` **THEN** ALL.
- **WHEN** C is `$.obj <= $.arr` **THEN** NONE.
- **WHEN** C is `$.obj < $.arr` **THEN** NONE.
- **WHEN** C is `$.obj <= $.obj` **THEN** ALL.
- **WHEN** C is `$.arr <= $.arr` **THEN** ALL.
- **WHEN** C is `1 <= $.arr` **THEN** NONE.
- **WHEN** C is `1 >= $.arr` **THEN** NONE.
- **WHEN** C is `1 > $.arr` **THEN** NONE.
- **WHEN** C is `1 < $.arr` **THEN** NONE.
- **WHEN** C is `true <= true` **THEN** ALL.
- **WHEN** C is `true > true` **THEN** NONE.
- **WHEN** C is `null >= null` **THEN** ALL.
- **WHEN** C is `null < null` **THEN** NONE.
- **WHEN** C is `false < true` **THEN** NONE.
- **WHEN** C is `'ab' < 'abc'` **THEN** ALL.
- **WHEN** C is `'' < 'a'` **THEN** ALL.
- **WHEN** C is `'b' < 'abc'` **THEN** NONE.
- **WHEN** C is `'B' < 'a'` **THEN** ALL.
- **WHEN** C is `$.arr[0] == 2` **THEN** ALL.
- **WHEN** C is `$.arr[0] == 2.0` **THEN** ALL.

Further scenarios:

- **WHEN** query `$[?@ < 'b']` is evaluated on `["a","b","c","",1,"B"]` **THEN** values `["a","","B"]`, paths `["$[0]","$[3]","$[5]"]`.
- **WHEN** query `$[?@ > '\uE000']` is evaluated on `["😀","a","\uE000"]` **THEN** values `["😀"]`, paths `["$[0]"]` (U+1F600 is greater than U+E000 even though its first UTF-16 code unit, 0xD83D, is smaller).
- **WHEN** query `$[?@ >= 2]` is evaluated on `[1,2,3,"3",[3]]` **THEN** values `[2,3]`, paths `["$[1]","$[2]"]`.
- **WHEN** query `$[?@ <= true]` is evaluated on `[false,true]` **THEN** values `[true]`, paths `["$[1]"]`.
- **WHEN** query `$[?@ == '13']` is evaluated on `[13,"13"]` **THEN** values `["13"]`, paths `["$[1]"]`.
- **WHEN** query `$[?@.x == @.y]` is evaluated on `[{"x":[1,{"a":2}],"y":[1,{"a":2}]},{"x":{"a":1,"b":2},"y":{"b":2,"a":1}},{"x":[1,2],"y":[2,1]},{"x":{"a":1},"y":{"a":1,"b":2}},{"x":1,"y":1.0},{"x":"1","y":1}]` **THEN** values `[{"x":[1,{"a":2}],"y":[1,{"a":2}]},{"x":{"a":1,"b":2},"y":{"b":2,"a":1}},{"x":1,"y":1.0}]`, paths `["$[0]","$[1]","$[4]"]`.
- **WHEN** query `$[?@.x == @.y]` is evaluated on `[{}]` **THEN** values `[{}]`, paths `["$[0]"]`.
- **WHEN** query `$[?@.x != @.y]` is evaluated on `[{}]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?@.x < @.y]` is evaluated on `[{}]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?@.x != 1]` is evaluated on `[{},{"x":1},{"x":2}]` **THEN** values `[{},{"x":2}]`, paths `["$[0]","$[2]"]`.
- **WHEN** query `$[?@.x == null]` is evaluated on `[{},{"x":null}]` **THEN** values `[{"x":null}]`, paths `["$[1]"]`.
- **WHEN** query `$[?@.x >= @.x]` is evaluated on `[{"x":{}},{"x":[]},{},{"x":null}]` **THEN** values `[{"x":{}},{"x":[]},{},{"x":null}]`, paths `["$[0]","$[1]","$[2]","$[3]"]`.

### R19. Logical operators

1. `A && B` SHALL be LogicalTrue iff both are; `A || B` iff at least one is; `!A` iff A is
   LogicalFalse. `&&` binds tighter than `||`; parentheses group.

Scenarios (document `[{"a":1},{"b":1},{"b":1,"c":1}]`):

- **WHEN** query `$[?@.a || @.b && @.c]` **THEN** values `[{"a":1},{"b":1,"c":1}]`, paths `["$[0]","$[2]"]`.
- **WHEN** query `$[?(@.a || @.b) && @.c]` **THEN** values `[{"b":1,"c":1}]`, paths `["$[2]"]`.
- **WHEN** query `$[?@.c && @.b || @.a]` **THEN** values `[{"a":1},{"b":1,"c":1}]`, paths `["$[0]","$[2]"]`.
- **WHEN** query `$[?!(@.a || @.c)]` **THEN** values `[{"b":1}]`, paths `["$[1]"]`.
- **WHEN** query `$[?!@.a && !@.c]` **THEN** values `[{"b":1}]`, paths `["$[1]"]`.

---

## 6. Function extensions

### R20. Function expression syntax and names

1. A function expression SHALL be a function name immediately followed by `(` (no blank
   space), then zero or more comma-separated arguments (blank space allowed after `(`, before
   `)`, and around commas), then `)`. A function name is a lowercase ASCII letter followed by
   lowercase ASCII letters, digits or `_`.
2. Exactly five functions exist: `length`, `count`, `match`, `search`, `value`. Any other
   function name — even if syntactically a valid name — SHALL be `invalid_query`.
3. A call with the wrong number of arguments SHALL be `invalid_query`. Each of the five takes
   the number of arguments shown in R21.
4. A function argument is one of: a literal; a query (`@…` or `$…`); a function expression; or
   a logical expression (an expression containing `!`, `&&`, `||`, a comparison operator, or
   parentheses at its top level). An argument consisting solely of a query is a *query*
   argument; solely of a function expression, a *function* argument; solely of a literal, a
   *literal* argument. Function expressions may appear in filters only (they are not segments).

Scenarios:

- **WHEN** query `$[?length(@) == 1]` is evaluated on `["a","ab"]` **THEN** values `["a"]`, paths `["$[0]"]`.
- **WHEN** query `$[?length( @ ) == 1]` is evaluated on `["a","ab"]` **THEN** values `["a"]`, paths `["$[0]"]`.
- **WHEN** query `$[?length (@) == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?Length(@) == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?foo(@)]` **THEN** `invalid_query`.
- **WHEN** query `$[?bar(@.a) == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?_x(@)]` **THEN** `invalid_query`.
- **WHEN** query `$[?length() == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?length(@, @) == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?count() == 0]` **THEN** `invalid_query`.
- **WHEN** query `$[?match(@)]` **THEN** `invalid_query`.
- **WHEN** query `$[?search(@, 'a', 'b')]` **THEN** `invalid_query`.
- **WHEN** query `$[?value(@, @) == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?length(@ == 1]` **THEN** `invalid_query`.
- **WHEN** query `$.length(@)` **THEN** `invalid_query`.

### R21. Type system and well-typedness

1. Types: **ValueType** (a JSON value, or Nothing), **LogicalType** (LogicalTrue/LogicalFalse),
   **NodesType** (a nodelist).
2. Declared signatures:

   | function | parameters | result |
   |---|---|---|
   | `length` | ValueType | ValueType |
   | `count` | NodesType | ValueType |
   | `match` | ValueType, ValueType | LogicalType |
   | `search` | ValueType, ValueType | LogicalType |
   | `value` | NodesType | ValueType |

3. A query is valid only if every function expression in it is well typed. A function expression
   is well typed when (a) its result type suits its context and (b) each argument suits its
   parameter:
   - Context **test expression** (the function stands alone, possibly after `!`, as a logical
     operand): result type must be LogicalType or NodesType. (So `match`/`search` are allowed;
     `length`, `count`, `value` are not.) A NodesType result would be tested for non-emptiness.
   - Context **comparable**: result type must be ValueType (`length`, `count`, `value`).
   - Context **argument of another function**: the result type must satisfy the parameter rules
     below.
   - Parameter **ValueType** accepts: a literal; a *singular* query (R17), whose value is the
     selected node's value or Nothing if none is selected; a function whose result type is
     ValueType. It does not accept a non-singular query, a logical expression, or a function
     of result type LogicalType or NodesType.
   - Parameter **NodesType** accepts: any query (singular or not); a function whose result type
     is NodesType (none of the five has one). It does not accept literals, logical expressions,
     or ValueType/LogicalType functions.
   - Parameter **LogicalType** (none of the five has one; listed for completeness) accepts: a
     logical expression; a query or a NodesType function (converted: non-empty → LogicalTrue);
     a LogicalType function.
4. The type check SHALL be static (independent of the document) and its failure SHALL yield
   `invalid_query`.

Scenarios:

- **WHEN** query `$[?length(@) < 3]` is evaluated on `["ab","abc",[1,2],{"a":1},5,null]` **THEN** values `["ab",[1,2],{"a":1}]`, paths `["$[0]","$[2]","$[3]"]`.
- **WHEN** query `$[?length(@.*) < 3]` **THEN** `invalid_query`.
- **WHEN** query `$[?count(@.*) == 1]` is evaluated on `[[1],[1,2],{"a":1},3]` **THEN** values `[[1],{"a":1}]`, paths `["$[0]","$[2]"]`.
- **WHEN** query `$[?count(1) == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?count('a') == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?count(length(@)) == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?count(@.a == 1) == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?match(@.timezone, 'Europe/.*')]` is evaluated on `[{"timezone":"Europe/Paris"},{"timezone":"America/New_York"}]` **THEN** values `[{"timezone":"Europe/Paris"}]`, paths `["$[0]"]`.
- **WHEN** query `$[?match(@.timezone, 'Europe/.*') == true]` **THEN** `invalid_query`.
- **WHEN** query `$[?value(@..color) == "red"]` is evaluated on `[{"color":"red"}]` **THEN** values `[{"color":"red"}]`, paths `["$[0]"]`.
- **WHEN** query `$[?value(@..color)]` **THEN** `invalid_query`.
- **WHEN** query `$[?length(@)]` **THEN** `invalid_query`.
- **WHEN** query `$[?count(@)]` **THEN** `invalid_query`.
- **WHEN** query `$[?!length(@)]` **THEN** `invalid_query`.
- **WHEN** query `$[?!match(@, 'a')]` is evaluated on `["a","b",1]` **THEN** values `["b",1]`, paths `["$[1]","$[2]"]`.
- **WHEN** query `$[?length(match(@, 'a')) == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?length(@.a == 1) == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?length((@.a)) == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?match(@.*, 'a')]` **THEN** `invalid_query`.
- **WHEN** query `$[?match(@, @.*)]` **THEN** `invalid_query`.
- **WHEN** query `$[?match(@, 'a') && length(@) == 1]` is evaluated on `["a","aa",1]` **THEN** values `["a"]`, paths `["$[0]"]`.
- **WHEN** query `$[?count(value(@)) == 1]` **THEN** `invalid_query`.
- **WHEN** query `$[?length(value(@.*)) == 2]` is evaluated on `[["ab"],["ab","c"],[[1,2]]]` **THEN** values `[["ab"],[[1,2]]]`, paths `["$[0]","$[2]"]`.
- **WHEN** query `$[?match(length(@), '1')]` is evaluated on `["a"]` **THEN** values `[]`, paths `[]` (well typed; the first argument is a number, not a string).
- **WHEN** query `$[?length('ab') == 2]` is evaluated on `[7,8]` **THEN** values `[7,8]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?count(@) == count($)]` is evaluated on `[1]` **THEN** values `[1]`, paths `["$[0]"]`.
- **WHEN** query `$[?match('abc', 'a.c')]` is evaluated on `[1,2]` **THEN** values `[1,2]`, paths `["$[0]","$[1]"]`.

### R22. `length()`

`length(v)` SHALL return: for a string, the number of Unicode scalar values (characters) in
it; for an array, the number of elements; for an object, the number of members; for anything
else (number, `true`, `false`, `null`, or Nothing), Nothing.

Scenarios:

- **WHEN** query `$[?length(@) == 3]` is evaluated on `["abc",[1,2,3],{"a":1,"b":2,"c":3},3,"ab",null]` **THEN** values `["abc",[1,2,3],{"a":1,"b":2,"c":3}]`, paths `["$[0]","$[1]","$[2]"]`.
- **WHEN** query `$[?length(@) == 1]` is evaluated on `["😀","e\u0301"]` **THEN** values `["😀"]`, paths `["$[0]"]`.
- **WHEN** query `$[?length(@) == 0]` is evaluated on `["",[],{},0,null]` **THEN** values `["",[],{}]`, paths `["$[0]","$[1]","$[2]"]`.
- **WHEN** query `$[?length(@) == length(@)]` is evaluated on `[1,"ab",[1]]` **THEN** values `[1,"ab",[1]]`, paths `["$[0]","$[1]","$[2]"]` (for `1` both sides are Nothing, which compare equal).
- **WHEN** query `$[?length(@.a) >= 2]` is evaluated on `[{"a":"xy"},{"a":"x"},{"b":"xyz"},{"a":[1,2,3]}]` **THEN** values `[{"a":"xy"},{"a":[1,2,3]}]`, paths `["$[0]","$[3]"]`.
- **WHEN** query `$[?length(@) != 2]` is evaluated on `[true,"ab"]` **THEN** values `[true]`, paths `["$[0]"]`.
- **WHEN** query `$[?length(1) == 1]` is evaluated on `[1]` **THEN** values `[]`, paths `[]`.

### R23. `count()`

`count(nodes)` SHALL return the number of nodes in the nodelist (duplicates counted; values
irrelevant).

Scenarios:

- **WHEN** query `$[?count(@.*) == 2]` is evaluated on `[[1,2],{"a":1,"b":2},[1],"ab"]` **THEN** values `[[1,2],{"a":1,"b":2}]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?count(@[0,0]) == 2]` is evaluated on `[[5],[]]` **THEN** values `[[5]]`, paths `["$[0]"]`.
- **WHEN** query `$[?count(@) == 1]` is evaluated on `[1,null]` **THEN** values `[1,null]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?count(@..*) > 2]` is evaluated on `[{"a":[1,2]},{"a":1}]` **THEN** values `[{"a":[1,2]}]`, paths `["$[0]"]`.
- **WHEN** query `$[?count(@[?@ > 1]) == 2]` is evaluated on `[[1,2,3],[2],[0,5,6,7]]` **THEN** values `[[1,2,3]]`, paths `["$[0]"]`.
- **WHEN** query `$[?count(@.a) == 0]` is evaluated on `[{"a":null},{}]` **THEN** values `[{}]`, paths `["$[1]"]`.

### R24. `match()`

`match(s, r)` SHALL return LogicalTrue if `s` is a string, `r` is a string that is a valid
I-Regexp (R27), and the *entire* string `s` matches `r` (R28); otherwise LogicalFalse. An
invalid regular expression — whether written as a literal in the query or taken from the
document — is *not* a query error: the function simply returns LogicalFalse.

Scenarios:

- **WHEN** query `$[?match(@, 'a.c')]` is evaluated on `["abc","abcd","a\nc","xabc",1]` **THEN** values `["abc"]`, paths `["$[0]"]`.
- **WHEN** query `$[?match(@, '1')]` is evaluated on `[1,"1"]` **THEN** values `["1"]`, paths `["$[1]"]`.
- **WHEN** query `$[?match(@.s, @.p)]` is evaluated on `[{"s":"aaa","p":"a+"},{"s":"b","p":"a+"},{"s":"a","p":1},{"s":"a","p":"("},{"s":"a"}]` **THEN** values `[{"s":"aaa","p":"a+"}]`, paths `["$[0]"]`.
- **WHEN** query `$[?match(@, '(')]` is evaluated on `["("]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, '')]` is evaluated on `["","a"]` **THEN** values `[""]`, paths `["$[0]"]`.
- **WHEN** query `$[?match(@, 'a|bc')]` is evaluated on `["a","bc","abc","ac"]` **THEN** values `["a","bc"]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?match(@.date, '1974-05-..')]` is evaluated on `[{"date":"1974-05-13"},{"date":"1974-06-01"},{"date":"1974-05-1"}]` **THEN** values `[{"date":"1974-05-13"}]`, paths `["$[0]"]`.

### R25. `search()`

`search(s, r)` SHALL return LogicalTrue if `s` is a string, `r` is a string that is a valid
I-Regexp, and *some substring* of `s` (possibly empty, possibly all of `s`) matches `r`;
otherwise LogicalFalse. Invalid regular expressions give LogicalFalse, never an error.

Scenarios:

- **WHEN** query `$[?search(@, 'a.c')]` is evaluated on `["abc","abcd","a\nc","xabc",1]` **THEN** values `["abc","abcd","xabc"]`, paths `["$[0]","$[1]","$[3]"]`.
- **WHEN** query `$[?search(@.author, '[BR]ob')]` is evaluated on `[{"author":"Bob"},{"author":"Rob Roy"},{"author":"bob"},{"author":"Mr. Robinson"}]` **THEN** values `[{"author":"Bob"},{"author":"Rob Roy"},{"author":"Mr. Robinson"}]`, paths `["$[0]","$[1]","$[3]"]`.
- **WHEN** query `$[?search(@, 'a|bc')]` is evaluated on `["a","bc","abc","ac","x"]` **THEN** values `["a","bc","abc","ac"]`, paths `["$[0]","$[1]","$[2]","$[3]"]`.
- **WHEN** query `$[?search(@, '')]` is evaluated on `["","a",1]` **THEN** values `["","a"]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?search(@, 'x*')]` is evaluated on `["","abc"]` **THEN** values `["","abc"]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?search(@, '.')]` is evaluated on `["","\n","a"]` **THEN** values `["a"]`, paths `["$[2]"]`.
- **WHEN** query `$[?search(@, '[')]` is evaluated on `["["]` **THEN** values `[]`, paths `[]`.

### R26. `value()`

`value(nodes)` SHALL return the value of the single node if the nodelist has exactly one node,
and Nothing otherwise (empty or more than one node).

Scenarios:

- **WHEN** query `$[?value(@..color) == "red"]` is evaluated on `[{"color":"red"},{"x":{"color":"red"}},{"color":"red","y":{"color":"red"}},{"color":"blue"}]` **THEN** values `[{"color":"red"},{"x":{"color":"red"}}]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?value(@.*) == 1]` is evaluated on `[[1],[1,1],{"k":1},[]]` **THEN** values `[[1],{"k":1}]`, paths `["$[0]","$[2]"]`.
- **WHEN** query `$[?value(@.a) == value(@.b)]` is evaluated on `[{"a":1,"b":1},{"a":1},{}]` **THEN** values `[{"a":1,"b":1},{}]`, paths `["$[0]","$[2]"]`.

---

## 7. I-Regexp

### R27. I-Regexp syntax

The second argument of `match()`/`search()` is a regular expression in I-Regexp syntax. A
string is a valid I-Regexp if and only if it matches the following grammar in its entirety
(ABNF; characters are Unicode scalar values; quoted strings here are case-*sensitive*):

```
i-regexp      = branch *( "|" branch )
branch        = *piece
piece         = atom [ quantifier ]
quantifier    = "*" / "+" / "?" / range-quantifier
range-quantifier = "{" QuantExact [ "," [ QuantExact ] ] "}"
QuantExact    = 1*DIGIT                       ; 0-9, leading zeros allowed
atom          = NormalChar / charClass / ( "(" i-regexp ")" )
NormalChar    = any character EXCEPT  . \ ? * + { } ( ) [ ] |
charClass     = "." / SingleCharEsc / charClassEsc / charClassExpr
SingleCharEsc = "\" ( "(" / ")" / "*" / "+" / "-" / "." / "?" / "[" / "\" / "]" / "^"
                    / "n" / "r" / "t" / "{" / "|" / "}" )
charClassEsc  = catEsc / complEsc
catEsc        = "\p{" charProp "}"
complEsc      = "\P{" charProp "}"
charClassExpr = "[" [ "^" ] ( "-" / CCE1 ) *CCE1 [ "-" ] "]"
CCE1          = ( CCchar [ "-" CCchar ] ) / charClassEsc
CCchar        = any character EXCEPT  - [ \ ]     /  SingleCharEsc
charProp      = "L" ["l" / "m" / "o" / "t" / "u"]
              / "M" ["c" / "e" / "n"]
              / "N" ["d" / "l" / "o"]
              / "P" ["c" / "d" / "e" / "f" / "i" / "o" / "s"]
              / "Z" ["l" / "p" / "s"]
              / "S" ["c" / "k" / "m" / "o"]
              / "C" ["c" / "f" / "n" / "o"]
```

Additional rules, each of which makes the regexp invalid when violated:

1. `[^]` is invalid (it must not be read as a class containing `^`).
2. In a range quantifier `{n,m}`, `n ≤ m` is required (`{3,2}` is invalid).
3. In a class range `x-y`, the code point of `x` must be `≤` that of `y` (`[z-a]` is invalid).

Consequences an implementer must observe:

- `^` and `$` are ordinary characters (NormalChar), not anchors. `]`, `}` and `{` are *not*
  NormalChars and must be escaped to be matched literally (`\]`, `\}`, `\{`).
- Escapes are only those listed. In particular `\d`, `\D`, `\w`, `\W`, `\s`, `\S`, `\b`, `\B`,
  `\uXXXX`, `\x..`, `\$`, `\/`, `\0`, `\1` (back-references), `\i`, `\c` are invalid.
  `\p{…}`/`\P{…}` accept only the general-category names above (e.g. `\p{IsBasicLatin}`,
  `\p{Lx}`, `\p{l}`, `\p{L&}`, `\p{Latin}` are invalid).
- A quantifier needs a preceding atom and only one quantifier is allowed per atom: `*a`,
  `a**`, `a+?` (lazy), `a{2}{3}`, `a{,2}`, `a{}` are invalid. `(?:…)`, `(?=…)`, named groups
  are invalid (`?` cannot start a group's content).
- Inside `[…]`, `-` is literal only as the first item (after an optional `^`) or as the last
  item; `[`, `]`, `\` must be escaped; `^` is literal when not first. `[]`, `[a-c-e]`, `[--a]`
  are invalid; `[-a]`, `[a-]`, `[-]`, `[^-]`, `[a^]`, `[\[\]]` are valid.
- Empty branches and empty groups are valid: `a|`, `|`, `()`, and the empty regexp `` are valid.
- Raw control characters (including line feed and tab) are ordinary NormalChars.

Because the regexp is written inside a JSONPath string literal (R7), a regexp backslash must be
written as `\\` in the query text (and as `\\\\` inside the JSON request line). A single `\.`
in the query is an invalid *string literal* escape, so the *query* is invalid.

Scenarios (the regexp each query uses is given in parentheses):

- **WHEN** query `$[?match(@, 'a\\.b')]` (regexp `a\.b`) is evaluated on `["a.b","axb"]` **THEN** values `["a.b"]`, paths `["$[0]"]`.
- **WHEN** query `$[?match(@, 'a\.b')]` **THEN** `invalid_query` (`\.` is not a valid string-literal escape).
- **WHEN** query `$[?match(@, '\\d')]` (regexp `\d`) is evaluated on `["1"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, '\\w')]` is evaluated on `["a"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?search(@, '\\s')]` is evaluated on `["a b"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, '\\u0041')]` is evaluated on `["A"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, '\\$')]` is evaluated on `["$"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, 'a$')]` is evaluated on `["a","a$"]` **THEN** values `["a$"]`, paths `["$[1]"]`.
- **WHEN** query `$[?search(@, '^a')]` is evaluated on `["ab","^ab","b^a"]` **THEN** values `["^ab","b^a"]`, paths `["$[1]","$[2]"]`.
- **WHEN** query `$[?match(@, '[]')]` is evaluated on `["[]",""]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, '[^]')]` is evaluated on `["^","a"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, '[a-]')]` is evaluated on `["-","a","b"]` **THEN** values `["-","a"]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?match(@, '[-a]')]` is evaluated on `["-","a","b"]` **THEN** values `["-","a"]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?match(@, '[^^]')]` is evaluated on `["^","x"]` **THEN** values `["x"]`, paths `["$[1]"]`.
- **WHEN** query `$[?match(@, '[a-c-e]')]` is evaluated on `["a","-","e"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, '[z-a]')]` is evaluated on `["m"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, '[\\[\\]]')]` (regexp `[\[\]]`) is evaluated on `["[","]","a"]` **THEN** values `["[","]"]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?match(@, 'a]')]` is evaluated on `["a]"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, 'a\\]')]` (regexp `a\]`) is evaluated on `["a]"]` **THEN** values `["a]"]`, paths `["$[0]"]`.
- **WHEN** query `$[?match(@, 'a}')]` is evaluated on `["a}"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, 'a{')]` is evaluated on `["a{"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, 'a**')]` is evaluated on `["aa"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, 'a*?')]` is evaluated on `["aa"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, '(?:a)')]` is evaluated on `["a"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, '*a')]` is evaluated on `["a"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, '(a')]` is evaluated on `["a"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, 'a)')]` is evaluated on `["a"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, 'a{,2}')]` is evaluated on `["a"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, 'a{2,1}')]` is evaluated on `["a","aa"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, '\\p{IsBasicLatin}')]` is evaluated on `["a"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, '\\p{Lx}')]` is evaluated on `["a"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, '\\p{l}')]` is evaluated on `["a"]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$[?match(@, 'a\\-b')]` (regexp `a\-b`) is evaluated on `["a-b"]` **THEN** values `["a-b"]`, paths `["$[0]"]`.

### R28. I-Regexp semantics

A valid I-Regexp denotes a set of strings (sequences of characters), as follows:

1. `b1|b2|…|bn` denotes the union of the sets of its branches. A branch denotes the
   concatenations of strings from its pieces in order; an empty branch denotes `{""}`.
2. A piece with quantifier: `?` = 0 or 1 repetitions, `*` = 0 or more, `+` = 1 or more,
   `{n}` = exactly n, `{n,}` = n or more, `{n,m}` = n to m inclusive. Without a quantifier,
   exactly once.
3. `(r)` denotes the set of `r`; groups only group (no captures).
4. A NormalChar denotes itself. `\n` denotes U+000A, `\r` U+000D, `\t` U+0009; every other
   SingleCharEsc `\c` denotes the character `c`.
5. `.` denotes any single character except U+000A and U+000D.
6. `\p{X}` denotes any character whose Unicode General Category is X; for a one-letter X it is any
   of the categories starting with that letter (Appendix C). `\P{X}` denotes any character *not*
   in `\p{X}`. The Unicode character database of the implementation's runtime is used.
7. `[…]` denotes any single character in the union of its items (single characters, inclusive
   code-point ranges `x-y`, and `\p`/`\P` classes, and a literal `-` where allowed);
   `[^…]` denotes any single character *not* in that union (this includes line feed and
   carriage return).
8. Matching is case-sensitive and character-based (a supplementary character such as `😀` is one
   character). There are no anchors, flags, or multiline modes.
9. `match(s, r)` is true iff `s` is in the set denoted by `r`; `search(s, r)` is true iff some
   substring `s[i..j)` (0 ≤ i ≤ j ≤ length of `s`, in characters) is in that set.

Scenarios:

- **WHEN** query `$[?match(@, 'a.c')]` is evaluated on `["abc","a\nc","a\rc","abcd","a😀c"]` **THEN** values `["abc","a😀c"]`, paths `["$[0]","$[4]"]`.
- **WHEN** query `$[?match(@, '.')]` is evaluated on `["😀","ab",""]` **THEN** values `["😀"]`, paths `["$[0]"]`.
- **WHEN** query `$[?match(@, '[a-c]+')]` is evaluated on `["abc","abd","","cab"]` **THEN** values `["abc","cab"]`, paths `["$[0]","$[3]"]`.
- **WHEN** query `$[?match(@, '[^a-c]')]` is evaluated on `["a","d","\n","dd"]` **THEN** values `["d","\n"]`, paths `["$[1]","$[2]"]`.
- **WHEN** query `$[?match(@, 'a\\nb')]` (regexp `a\nb`) is evaluated on `["a\nb","anb"]` **THEN** values `["a\nb"]`, paths `["$[0]"]`.
- **WHEN** query `$[?match(@, 'a\nb')]` (string-literal escape; the regexp contains a raw line feed) is evaluated on `["a\nb","anb"]` **THEN** values `["a\nb"]`, paths `["$[0]"]`.
- **WHEN** query `$[?match(@, 'a\\tb')]` is evaluated on `["a\tb","atb"]` **THEN** values `["a\tb"]`, paths `["$[0]"]`.
- **WHEN** query `$[?match(@, 'A')]` is evaluated on `["a","A"]` **THEN** values `["A"]`, paths `["$[1]"]`.
- **WHEN** query `$[?match(@, '\\p{Lu}+')]` is evaluated on `["ABC","AbC","ÀÉ",""]` **THEN** values `["ABC","ÀÉ"]`, paths `["$[0]","$[2]"]`.
- **WHEN** query `$[?match(@, '\\P{L}+')]` is evaluated on `["a1","12"," !"]` **THEN** values `["12"," !"]`, paths `["$[1]","$[2]"]`.
- **WHEN** query `$[?match(@, '\\p{Nd}')]` is evaluated on `["3","٣","x","Ⅻ"]` **THEN** values `["3","٣"]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?match(@, '\\p{N}')]` is evaluated on `["3","٣","x","Ⅻ"]` **THEN** values `["3","٣","Ⅻ"]`, paths `["$[0]","$[1]","$[3]"]`.
- **WHEN** query `$[?match(@, '[\\p{Lu}0-9]+')]` is evaluated on `["A1","a1","Z9Z"]` **THEN** values `["A1","Z9Z"]`, paths `["$[0]","$[2]"]`.
- **WHEN** query `$[?match(@, '[^\\p{L}]')]` is evaluated on `["a","1"]` **THEN** values `["1"]`, paths `["$[1]"]`.
- **WHEN** query `$[?match(@, 'a{2}')]` is evaluated on `["a","aa","aaa"]` **THEN** values `["aa"]`, paths `["$[1]"]`.
- **WHEN** query `$[?match(@, 'a{2,}')]` is evaluated on `["a","aa","aaa"]` **THEN** values `["aa","aaa"]`, paths `["$[1]","$[2]"]`.
- **WHEN** query `$[?match(@, 'a{1,2}')]` is evaluated on `["a","aa","aaa"]` **THEN** values `["a","aa"]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?match(@, 'a{0}')]` is evaluated on `["","a"]` **THEN** values `[""]`, paths `["$[0]"]`.
- **WHEN** query `$[?match(@, 'ab?c')]` is evaluated on `["ac","abc","abbc"]` **THEN** values `["ac","abc"]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?match(@, '(ab)+')]` is evaluated on `["abab","aba",""]` **THEN** values `["abab"]`, paths `["$[0]"]`.
- **WHEN** query `$[?match(@, '()')]` is evaluated on `["","a"]` **THEN** values `[""]`, paths `["$[0]"]`.
- **WHEN** query `$[?match(@, 'a|')]` is evaluated on `["","a","b"]` **THEN** values `["","a"]`, paths `["$[0]","$[1]"]`.
- **WHEN** query `$[?match(@, 'x(a|b)*y')]` is evaluated on `["xy","xabbay","xacy"]` **THEN** values `["xy","xabbay"]`, paths `["$[0]","$[1]"]`.

---

## 8. Results

### R29. Normalized paths

1. Each node in the result SHALL be reported with its normalized path: `$` followed, for each
   step of its location from the root, by `[` *step* `]`, where an array index step is the
   non-negative decimal index without leading zeros (`[0]`, `[12]`) — never negative, whatever
   the query used — and a member-name step is the name enclosed in single quotes.
2. Inside the single quotes, each character of the name SHALL be written as follows:
   - U+0008 → `\b`; U+000C → `\f`; U+000A → `\n`; U+000D → `\r`; U+0009 → `\t`;
   - `'` (U+0027) → `\'`; `\` (U+005C) → `\\`;
   - every other character in U+0000–U+001F → `\u00` followed by two **lowercase** hexadecimal
     digits (e.g. U+000B → `\u000b`, U+001F → `\u001f`);
   - every other character (including `"`, `/`, U+007F, and all non-ASCII characters) → itself,
     unescaped.
3. The root node's path is `$`.

Scenarios:

- **WHEN** query `$.a` is evaluated on `{"a":1}` **THEN** values `[1]`, paths `["$['a']"]`.
- **WHEN** query `$[1]` is evaluated on `[0,1]` **THEN** values `[1]`, paths `["$[1]"]`.
- **WHEN** query `$[-3]` is evaluated on `[0,1,2,3,4]` **THEN** values `[2]`, paths `["$[2]"]`.
- **WHEN** query `$.a.b[1:2]` is evaluated on `{"a":{"b":[0,1,2]}}` **THEN** values `[1]`, paths `["$['a']['b'][1]"]`.
- **WHEN** query `$["\u000B"]` is evaluated on `{"\u000b":1}` **THEN** values `[1]`, paths `["$['\\u000b']"]`.
- **WHEN** query `$["\u0061"]` is evaluated on `{"a":1}` **THEN** values `[1]`, paths `["$['a']"]`.
- **WHEN** query `$[12]` is evaluated on `[0,1,2,3,4,5,6,7,8,9,10,11,12]` **THEN** values `[12]`, paths `["$[12]"]`.
- **WHEN** query `$.*` is evaluated on `{"\b":1,"\f":2,"\n":3,"\r":4,"\t":5,"'":6,"\\":7,"\u0000":8,"\u001f":9,"\"":10,"/":11,"\u007f":12,"é":13,"\u000b":14,"\u000e":15}` **THEN** values `[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]`, paths `["$['\\b']","$['\\f']","$['\\n']","$['\\r']","$['\\t']","$['\\'']","$['\\\\']","$['\\u0000']","$['\\u001f']","$['\"']","$['/']","$['\u007f']","$['é']","$['\\u000b']","$['\\u000e']"]`.
- **WHEN** query `$..*` is evaluated on `{"a b":[{"c":1}]}` **THEN** values `[[{"c":1}],{"c":1},1]`, paths `["$['a b']","$['a b'][0]","$['a b'][0]['c']"]`.

### R30. Order of results

1. The result order SHALL be exactly the nodelist order defined by R3, R4, R6 and R14, with
   these choices for the cases the standard leaves open:
   - **Object children** (wildcard, filter, descendant visiting) SHALL be taken in the order
     in which the members appear in the document's JSON text.
   - Array children are always in index order; slices follow R11 (descending for negative step).
2. The order SHALL be deterministic: the same query on the same document always yields the
   same order, including for repeated selectors (`$.o[*, *]` repeats the same order).
3. *Guidance*: In JavaScript, `JSON.parse` reorders integer-like keys (`{"b":1,"1":2}` gets the key
   order `"1","b"`), so a TypeScript implementation needs its own JSON parser (e.g. building
   `Map`s) to preserve document order. Python's `json` preserves order.

Scenarios:

- **WHEN** query `$.*` is evaluated on `{"b":1,"a":2,"1":3}` **THEN** values `[1,2,3]`, paths `["$['b']","$['a']","$['1']"]`.
- **WHEN** query `$[?@ > 0]` is evaluated on `{"z":1,"10":2,"2":3}` **THEN** values `[1,2,3]`, paths `["$['z']","$['10']","$['2']"]`.
- **WHEN** query `$..*` is evaluated on `{"y":{"q":1},"x":2}` **THEN** values `[{"q":1},2,1]`, paths `["$['y']","$['x']","$['y']['q']"]`.

### R31. JSON values

1. `null` SHALL be an ordinary value: it can be selected, tested for existence, and compared;
   it does not mean "missing".
2. Values in `values` SHALL be the selected values themselves, structurally identical to the
   document (all members and elements, any depth). Numbers SHALL be reproduced with exactly the
   numeric value they have in the document text, including integers beyond 2^53 and numbers
   beyond binary64 precision or range (reproducing the original number text is the
   recommended way; JSON-equivalent spellings such as `1.0` vs `1` are acceptable).
3. **Duplicate member names** in a document object: the member SHALL take the value of its
   *last* occurrence and the position (for ordering) of its *first* occurrence; the object then
   has the name once.
4. Strings in the document are sequences of characters; JSON escapes in the document are
   decoded by the JSON parser as usual (including surrogate pairs).

Scenarios (document `{"a":null,"b":[null],"c":[{}],"null":1}` unless stated):

- **WHEN** query `$.a` **THEN** values `[null]`, paths `["$['a']"]`.
- **WHEN** query `$.a[0]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$.a.d` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$.b[0]` **THEN** values `[null]`, paths `["$['b'][0]"]`.
- **WHEN** query `$.b[*]` **THEN** values `[null]`, paths `["$['b'][0]"]`.
- **WHEN** query `$.b[?@]` **THEN** values `[null]`, paths `["$['b'][0]"]`.
- **WHEN** query `$.b[?@==null]` **THEN** values `[null]`, paths `["$['b'][0]"]`.
- **WHEN** query `$.c[?@.d==null]` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$.null` **THEN** values `[1]`, paths `["$['null']"]`.
- **WHEN** query `$[0]` is evaluated on `[12345678901234567890]` **THEN** values `[12345678901234567890]`, paths `["$[0]"]`.
- **WHEN** query `$[0]` is evaluated on `[1.5e3]` **THEN** values `[1500]`, paths `["$[0]"]`.
- **WHEN** query `$[0]` is evaluated on `[0.1]` **THEN** values `[0.1]`, paths `["$[0]"]`.
- **WHEN** query `$.*` is evaluated on `{"a":1,"b":2,"a":3}` **THEN** values `[3,2]`, paths `["$['a']","$['b']"]`.
- **WHEN** query `$.a` is evaluated on `{"a":1,"a":3}` **THEN** values `[3]`, paths `["$['a']"]`.
- **WHEN** query `$` is evaluated on `{"x":[1,{"y":[true,false,null,"s",-2.5]}]}` **THEN** values `[{"x":[1,{"y":[true,false,null,"s",-2.5]}]}]`, paths `["$"]`.

### R32. End-to-end example

The following scenarios use the document BOOKSTORE:

```json
{ "store": {
    "book": [
      { "category": "reference", "author": "Nigel Rees",
        "title": "Sayings of the Century", "price": 8.95 },
      { "category": "fiction", "author": "Evelyn Waugh",
        "title": "Sword of Honour", "price": 12.99 },
      { "category": "fiction", "author": "Herman Melville",
        "title": "Moby Dick", "isbn": "0-553-21311-3", "price": 8.99 },
      { "category": "fiction", "author": "J. R. R. Tolkien",
        "title": "The Lord of the Rings", "isbn": "0-395-19395-8", "price": 22.99 }
    ],
    "bicycle": { "color": "red", "price": 399 }
  }
}
```

Below, B0…B3 denote the four book objects exactly as in the document, BOOKS the array
`[B0,B1,B2,B3]`, BIKE the object `{"color":"red","price":399}` and STORE the value of `store`.

- **WHEN** query `$.store.book[*].author` **THEN** values `["Nigel Rees","Evelyn Waugh","Herman Melville","J. R. R. Tolkien"]`, paths `["$['store']['book'][0]['author']","$['store']['book'][1]['author']","$['store']['book'][2]['author']","$['store']['book'][3]['author']"]`.
- **WHEN** query `$..author` **THEN** the same values and paths as `$.store.book[*].author`.
- **WHEN** query `$.store.*` **THEN** values `[BOOKS, BIKE]`, paths `["$['store']['book']","$['store']['bicycle']"]`.
- **WHEN** query `$.store..price` **THEN** values `[8.95,12.99,8.99,22.99,399]`, paths `["$['store']['book'][0]['price']","$['store']['book'][1]['price']","$['store']['book'][2]['price']","$['store']['book'][3]['price']","$['store']['bicycle']['price']"]`.
- **WHEN** query `$..book[2]` **THEN** values `[{"category":"fiction","author":"Herman Melville","title":"Moby Dick","isbn":"0-553-21311-3","price":8.99}]`, paths `["$['store']['book'][2]"]`.
- **WHEN** query `$..book[2].author` **THEN** values `["Herman Melville"]`, paths `["$['store']['book'][2]['author']"]`.
- **WHEN** query `$..book[2].publisher` **THEN** values `[]`, paths `[]`.
- **WHEN** query `$..book[-1]` **THEN** values `[B3]`, paths `["$['store']['book'][3]"]`.
- **WHEN** query `$..book[0,1]` **THEN** values `[B0,B1]`, paths `["$['store']['book'][0]","$['store']['book'][1]"]`.
- **WHEN** query `$..book[:2]` **THEN** values `[B0,B1]`, paths `["$['store']['book'][0]","$['store']['book'][1]"]`.
- **WHEN** query `$..book[?@.isbn]` **THEN** values `[B2,B3]`, paths `["$['store']['book'][2]","$['store']['book'][3]"]`.
- **WHEN** query `$..book[?@.price<10]` **THEN** values `[B0,B2]`, paths `["$['store']['book'][0]","$['store']['book'][2]"]`.
- **WHEN** query `$..book[?@.price<10].title` **THEN** values `["Sayings of the Century","Moby Dick"]`, paths `["$['store']['book'][0]['title']","$['store']['book'][2]['title']"]`.
- **WHEN** query `$.store.book[?@.category == 'fiction' && @.price > 20].title` **THEN** values `["The Lord of the Rings"]`, paths `["$['store']['book'][3]['title']"]`.
- **WHEN** query `$..*` **THEN** values `[STORE, BOOKS, BIKE, B0, B1, B2, B3, "reference","Nigel Rees","Sayings of the Century",8.95, "fiction","Evelyn Waugh","Sword of Honour",12.99, "fiction","Herman Melville","Moby Dick","0-553-21311-3",8.99, "fiction","J. R. R. Tolkien","The Lord of the Rings","0-395-19395-8",22.99, "red",399]`, paths `["$['store']","$['store']['book']","$['store']['bicycle']","$['store']['book'][0]","$['store']['book'][1]","$['store']['book'][2]","$['store']['book'][3]","$['store']['book'][0]['category']","$['store']['book'][0]['author']","$['store']['book'][0]['title']","$['store']['book'][0]['price']","$['store']['book'][1]['category']","$['store']['book'][1]['author']","$['store']['book'][1]['title']","$['store']['book'][1]['price']","$['store']['book'][2]['category']","$['store']['book'][2]['author']","$['store']['book'][2]['title']","$['store']['book'][2]['isbn']","$['store']['book'][2]['price']","$['store']['book'][3]['category']","$['store']['book'][3]['author']","$['store']['book'][3]['title']","$['store']['book'][3]['isbn']","$['store']['book'][3]['price']","$['store']['bicycle']['color']","$['store']['bicycle']['price']"]` (27 nodes).
- **WHEN** query `$.store[?length(@) == 2]` **THEN** values `[BIKE]`, paths `["$['store']['bicycle']"]`.
- **WHEN** query `$.store.book[?count(@.isbn) == 0].author` **THEN** values `["Nigel Rees","Evelyn Waugh"]`, paths `["$['store']['book'][0]['author']","$['store']['book'][1]['author']"]`.
- **WHEN** query `$[?value(@..color) == "red"]` **THEN** values `[STORE]`, paths `["$['store']"]`.
- **WHEN** query `$.store.book[?search(@.author, 'R\\.')].title` **THEN** values `["The Lord of the Rings"]`, paths `["$['store']['book'][3]['title']"]`.

---

## Appendix A. Complete query grammar (normative)

ABNF (RFC 5234 notation). Characters are Unicode scalar values. In ABNF, a quoted string such as
`"e"` matches either case (`e` or `E`); `%x..` values are exact. Hence the hex digits of `\u`
escapes may be upper or lower case, the `e` of an exponent may be `e` or `E`, but `true`,
`false`, `null`, the `u` of `\u`, and function names are lowercase only.

```
jsonpath-query      = root-identifier segments
segments            = *(S segment)
B                   = %x20 / %x09 / %x0A / %x0D     ; space, tab, LF, CR
S                   = *B                             ; optional blank space
root-identifier     = "$"

selector            = name-selector / wildcard-selector / slice-selector /
                      index-selector / filter-selector

name-selector       = string-literal
string-literal      = %x22 *double-quoted %x22 /    ; "string"
                      %x27 *single-quoted %x27      ; 'string'
double-quoted       = unescaped / %x27 / ESC %x22 / ESC escapable
single-quoted       = unescaped / %x22 / ESC %x27 / ESC escapable
ESC                 = %x5C                          ; backslash
unescaped           = %x20-21 / %x23-26 / %x28-5B / %x5D-D7FF / %xE000-10FFFF
escapable           = %x62 / %x66 / %x6E / %x72 / %x74 /   ; b f n r t
                      "/" / "\" /
                      (%x75 hexchar)                       ; uXXXX
hexchar             = non-surrogate / (high-surrogate "\" %x75 low-surrogate)
non-surrogate       = ((DIGIT / "A"/"B"/"C" / "E"/"F") 3HEXDIG) / ("D" %x30-37 2HEXDIG)
high-surrogate      = "D" ("8"/"9"/"A"/"B") 2HEXDIG
low-surrogate       = "D" ("C"/"D"/"E"/"F") 2HEXDIG
HEXDIG              = DIGIT / "A" / "B" / "C" / "D" / "E" / "F"

wildcard-selector   = "*"
index-selector      = int
int                 = "0" / (["-"] DIGIT1 *DIGIT)
DIGIT1              = %x31-39
slice-selector      = [start S] ":" S [end S] [":" [S step ]]
start               = int
end                 = int
step                = int

filter-selector     = "?" S logical-expr
logical-expr        = logical-or-expr
logical-or-expr     = logical-and-expr *(S "||" S logical-and-expr)
logical-and-expr    = basic-expr *(S "&&" S basic-expr)
basic-expr          = paren-expr / comparison-expr / test-expr
paren-expr          = [logical-not-op S] "(" S logical-expr S ")"
logical-not-op      = "!"
test-expr           = [logical-not-op S] (filter-query / function-expr)
filter-query        = rel-query / jsonpath-query
rel-query           = current-node-identifier segments
current-node-identifier = "@"
comparison-expr     = comparable S comparison-op S comparable
literal             = number / string-literal / true / false / null
comparable          = literal / singular-query / function-expr
comparison-op       = "==" / "!=" / "<=" / ">=" / "<" / ">"
singular-query      = rel-singular-query / abs-singular-query
rel-singular-query  = current-node-identifier singular-query-segments
abs-singular-query  = root-identifier singular-query-segments
singular-query-segments = *(S (name-segment / index-segment))
name-segment        = ("[" name-selector "]") / ("." member-name-shorthand)
index-segment       = "[" index-selector "]"
number              = (int / "-0") [ frac ] [ exp ]
frac                = "." 1*DIGIT
exp                 = "e" [ "-" / "+" ] 1*DIGIT
true                = %x74.72.75.65
false               = %x66.61.6c.73.65
null                = %x6e.75.6c.6c

function-name       = function-name-first *function-name-char
function-name-first = LCALPHA
function-name-char  = function-name-first / "_" / DIGIT
LCALPHA             = %x61-7A
function-expr       = function-name "(" S [function-argument
                         *(S "," S function-argument)] S ")"
function-argument   = literal / filter-query / logical-expr / function-expr

segment             = child-segment / descendant-segment
child-segment       = bracketed-selection / ("." (wildcard-selector / member-name-shorthand))
bracketed-selection = "[" S selector *(S "," S selector) S "]"
member-name-shorthand = name-first *name-char
name-first          = ALPHA / "_" / %x80-D7FF / %xE000-10FFFF
name-char           = name-first / DIGIT
DIGIT               = %x30-39
ALPHA               = %x41-5A / %x61-7A
descendant-segment  = ".." (bracketed-selection / wildcard-selector / member-name-shorthand)
```

Validity conditions on top of the grammar: R12 (integer range) and R21 (well-typedness,
including that only the five known functions exist with their arities).

Normalized paths (output only):

```
normalized-path      = "$" *(normal-index-segment)
normal-index-segment = "[" normal-selector "]"
normal-selector      = normal-name-selector / normal-index-selector
normal-name-selector = %x27 *normal-single-quoted %x27
normal-single-quoted = normal-unescaped / ESC normal-escapable
normal-unescaped     = %x20-26 / %x28-5B / %x5D-D7FF / %xE000-10FFFF
normal-escapable     = %x62 / %x66 / %x6E / %x72 / %x74 / "'" / "\" /
                       (%x75 normal-hexchar)
normal-hexchar       = "0" "0" ( ("0" %x30-37) / ("0" %x62) / ("0" %x65-66) /
                                 ("1" normal-HEXDIG) )
normal-HEXDIG        = DIGIT / %x61-66                ; lowercase a-f only
normal-index-selector = "0" / (DIGIT1 *DIGIT)
```

## Appendix B. Parsing guidance (non-normative)

- Write a character-level recursive-descent parser over code points (in TypeScript iterate with
  `codePointAt`/`Array.from`; in Python, `str` is already code points). A separate tokenizer is
  awkward because blank-space rules differ by context.
- `segments = *(S segment)`: after optional blank space, if the next character does not start a
  segment (`[`, `.`), *restore the position to before the blank space* — the blank space may
  belong to an enclosing rule (e.g. before `==`, `&&`, `)`, `,` or `]`).
- Parse a filter `basic-expr` as: if `!` → skip S → `(` gives a negated paren-expr, otherwise a
  query or function call gives a negated test; nothing may follow but `&&`, `||`, `)` or the end.
  If `(` → paren-expr. Otherwise parse a *primary* (literal, `@`/`$` query, or function call);
  then, after S, if a comparison operator follows, it is a comparison: check that both primaries
  are comparables (literal, singular query, or ValueType function). If none follows, the primary
  must be a query or a LogicalType/NodesType function.
- Record for each parsed query whether it is singular per R17 (all segments are `['name']`,
  `.name` or `[index]` with no blank space inside the brackets).
- Function arguments: parse a full logical expression; classify it as literal / query / function /
  logical-expr (a bare literal is allowed only as an argument or comparable). Then type-check.
- Parse integers as arbitrary-precision (Python `int`, TypeScript `BigInt` or digit-count checks)
  before the range check of R12, then convert to ordinary numbers.
- Comparisons of strings: compare code point by code point (in TypeScript, not `<` on strings,
  which compares UTF-16 code units).

## Appendix C. Unicode general categories for `\p{…}` (normative for R28)

| name | meaning | members |
|---|---|---|
| `L` | Letter | `Lu Ll Lt Lm Lo` |
| `M` | Mark | `Mn Mc Me` |
| `N` | Number | `Nd Nl No` |
| `P` | Punctuation | `Pc Pd Ps Pe Pi Pf Po` |
| `Z` | Separator | `Zs Zl Zp` |
| `S` | Symbol | `Sm Sc Sk So` |
| `C` | Other | `Cc Cf Cs Co Cn` (`Cn` = unassigned; surrogates never occur in strings) |

Two-letter names denote the single category. Python: `unicodedata.category(ch)` returns the
two-letter category. TypeScript: `RegExp` with the `u` flag supports `\p{Lu}`, `\p{L}`, etc.

## Appendix D. I-Regexp implementation guidance (non-normative)

- Parse and validate the regexp with the grammar of R27 first (this also yields the
  "invalid → LogicalFalse" behaviour). Cache compiled regexps by pattern string.
- Translation to a host engine is acceptable if done from the parsed form:
  - TypeScript: build a `RegExp` with flag `u`. Emit each literal character as `\u{HEX}`;
    `.` as `[^\n\r]`; classes as `[...]` with escaped members (`\u{HEX}`), `\p{X}` / `\P{X}` as is;
    groups as `(?:…)`; quantifiers as is. For `match` wrap as `^(?:…)$`; for `search` use
    the pattern unanchored with `.test()`.
  - Python: `re` has no `\p{…}`; expand categories into explicit code-point ranges computed once
    with `unicodedata` (scan U+0000–U+10FFFF, skipping surrogates, and cache per category), emit
    literal characters with `re.escape` or `\U%08x`, `.` as `[^\n\r]`; use `re.fullmatch` for
    `match` and `re.search` for `search`. Alternatively implement a small backtracking or NFA
    matcher directly on the parsed form.
- `^` and `$` in the I-Regexp are literals and must be escaped when emitted to a host engine.
