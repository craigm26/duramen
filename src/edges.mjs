// The edge library. An edge is a precisely named piece of semantics that specs keep getting
// wrong in prose (number text, rounding, key order, string escaping). A spec imports an edge
// by name instead of describing it; the edge brings its normative text (rendered once into
// the builder's brief) and a conformance pack. When the spec binds the edge to an operation
// (`edge <name> via <op> <field>`), every pack item becomes a suite case, and `tilth check`
// first runs the pack against the spec's oracle.
//
// Pack items: { input: <raw JSON literal>, text: <expected output> } or
// { input, refuse: true } (the implementation must answer with an error).
// Inputs are raw JSON text so that spellings such as -0 and 1e21 reach the implementation.

const NUMBER_TEXT = `A finite number \`x\` is written exactly as ECMAScript's \`Number::toString(x)\` (radix 10)
writes it:

1. If \`x\` is \`+0\` or \`-0\`, write \`0\`.
2. If \`x < 0\`, write \`-\` followed by the text of \`-x\`.
3. Otherwise let \`s\` be the shortest string of decimal digits (\`k\` digits, no trailing zeros
   unless \`k = 1\`) and \`n\` an integer such that \`s × 10^(n−k)\` is the number closest to \`x\`
   that rounds back to exactly \`x\`. When several such digit strings of the same length exist,
   take the one whose value is closest to \`x\`.
4. If \`k ≤ n ≤ 21\`: write \`s\` followed by \`n − k\` zeros.
5. If \`0 < n ≤ 21\`: write the first \`n\` digits of \`s\`, \`.\`, then the remaining \`k − n\` digits.
6. If \`−6 < n ≤ 0\`: write \`0.\`, then \`−n\` zeros, then \`s\`.
7. Otherwise write exponent form: the first digit of \`s\`; if \`k > 1\`, \`.\` and the remaining
   digits; then \`e\`, then \`+\` or \`-\` for the sign of \`n − 1\`, then \`|n − 1|\` in decimal.

This is not C \`%g\`, Python \`repr\` (\`1e-07\`) or Java \`Double.toString\`.`;

const FIXED_TEXT = `A finite number \`x\` "fixed to \`f\` places" is written as ECMAScript's
\`Number.prototype.toFixed(f)\` writes it:

1. If \`|x| ≥ 1e21\`, write the number text of \`x\` (edge number-text/ecmascript).
2. If \`x < 0\` (strictly), write \`-\` followed by the fixed text of \`-x\`. \`-0\` is written like \`+0\`.
3. Otherwise let \`m\` be the integer for which \`m / 10^f − x\` is closest to zero, using the
   **exact** binary value of \`x\`; on an exact tie take the larger \`m\`. Write \`m\` in decimal,
   left-padded with zeros to at least \`f + 1\` digits, with \`.\` before the last \`f\` digits.

Python's \`format(x, '.1f')\` rounds exact ties to even and so differs (\`20.25\` gives \`20.2\`).`;

const JSON_SORTED = `The canonical JSON text of a value has no whitespace outside strings:

- \`null\`, \`true\`, \`false\` as those words; a finite number as its number text
  (edge number-text/ecmascript).
- A string as \`"\`, each UTF-16 code unit escaped as below, then \`"\`.
- An array as \`[\`, its elements in order separated by \`,\`, then \`]\`.
- An object as \`{\`, its members separated by \`,\`, then \`}\`; each member is the key as a
  string, \`:\`, then the value. Members are ordered by key, comparing keys as sequences of
  **UTF-16 code units** (not code points).

Escaping, per UTF-16 code unit: \`"\` and \`\\\` with a backslash; \`0x08\`, \`0x0C\`, \`0x0A\`,
\`0x0D\`, \`0x09\` as \`\\b\`, \`\\f\`, \`\\n\`, \`\\r\`, \`\\t\`; any other unit below \`0x20\`, and any
surrogate that is not part of a valid pair, as \`\\u\` and four **lowercase** hex digits;
everything else, including \`/\`, \`0x7F\` and U+2028, as itself. The text is UTF-8 encoded.`;

const JSON_CODEPOINT = `The rules of json/sorted-utf16, with two differences. Members are ordered by key comparing
keys as sequences of Unicode **code points** (a valid surrogate pair counts as the one code
point it encodes); this differs from UTF-16 order only for keys that mix characters above
U+FFFF with characters in U+E000–U+FFFF. And a string containing a surrogate code unit that is
not part of a valid pair is not a sequence of code points, so a value containing one has
**no** canonical form: the implementation MUST answer with an error instead.`;

const JSON_RFC8785 = `RFC 8785 (JSON Canonicalization Scheme) read strictly: the rules of json/sorted-utf16
(RFC 8785 also orders keys by UTF-16 code units and writes numbers as ECMAScript does), except
that RFC 8785 takes I-JSON input (RFC 7493), which excludes unpaired surrogates. So a value
containing a surrogate code unit that is not part of a valid pair has **no** canonical form, and
the implementation MUST answer with an error instead.`;

const numberPack = [
  ['5', '5'], ['1.5', '1.5'], ['0.30000000000000004', '0.30000000000000004'],
  ['1e20', '100000000000000000000'], ['1e21', '1e+21'], ['-1e21', '-1e+21'],
  ['1e-6', '0.000001'], ['1e-7', '1e-7'], ['2e-7', '2e-7'], ['-1.5e-7', '-1.5e-7'],
  ['1.23e-18', '1.23e-18'], ['123e-20', '1.23e-18'], ['-0', '0'], ['100', '100'], ['1e2', '100'],
  ['123456789012345680000', '123456789012345680000'], ['1.7976931348623157e308', '1.7976931348623157e+308'],
  ['5e-324', '5e-324'], ['1e-323', '1e-323'], ['0.000001234', '0.000001234'],
  ['9007199254740993', '9007199254740992'], ['0.1', '0.1'], ['4.35', '4.35'],
].map(([input, text]) => ({ input, text }));

// Canonical JSON items shared by the JSON edges; `lone` marks values with an unpaired
// surrogate, and the second item is the one where UTF-16 order and code-point order differ.
const jsonItems = [
  ['{"b":1,"a":2}', '{"a":2,"b":1}'],
  ['{"｡":1,"😀":2}', '{"😀":2,"｡":1}'], // UTF-16 order differs from code point order
  ['{"10":1,"9":2,"":3}', '{"":3,"10":1,"9":2}'], // index-like names are not special
  ['{"b\\u0000":1,"b":2}', '{"b":2,"b\\u0000":1}'],
  ['{"a":{"c":[{}],"b":[]}}', '{"a":{"b":[],"c":[{}]}}'],
  ['{"a":null}', '{"a":null}'],
  ['[1,2.50,1e21]', '[1,2.5,1e+21]'],
  ['[-0,0.000001,1e-7]', '[0,0.000001,1e-7]'],
  ['"a\\u0000b"', '"a\\u0000b"'],
  ['"\\u001F"', '"\\u001f"'],
  ['"\\u2028"', '" "'],
  ['"\\u007f"', '"\u007f"'],
  ['"\\/"', '"/"'],
  ['"\\u00e9"', '"é"'],
  ['"\\ud83d\\ude00"', '"😀"'],
  ['null', 'null'],
  ['true', 'true'],
  ['"\\ud800"', '"\\ud800"', 'lone'],
  ['"\\ude00\\ud83d"', '"\\ude00\\ud83d"', 'lone'],
];

export const EDGES = {
  'number-text/ecmascript': { title: 'Number text (ECMAScript Number::toString)', text: NUMBER_TEXT, pack: numberPack },
  'fixed-text/ecmascript': { title: 'Fixed-point text (ECMAScript Number.prototype.toFixed)', text: FIXED_TEXT, pack: [] },
  'json/sorted-utf16': {
    title: 'Canonical JSON, keys in UTF-16 order, lone surrogates escaped',
    text: JSON_SORTED,
    pack: jsonItems.map(([input, text]) => ({ input, text })),
  },
  'json/sorted-codepoint': {
    title: 'Canonical JSON, keys in code-point order, lone surrogates refused',
    text: JSON_CODEPOINT,
    pack: jsonItems.map(([input, text, lone], k) => (lone ? { input, refuse: true } : { input, text: k === 1 ? '{"｡":1,"😀":2}' : text })),
  },
  'json/rfc8785': {
    title: 'Canonical JSON per RFC 8785, read strictly (lone surrogates refused)',
    text: JSON_RFC8785,
    pack: jsonItems.map(([input, text, lone]) => (lone ? { input, refuse: true } : { input, text })),
  },
};

// Two edges bound to the same op and field are two claims about the same output. Where their
// packs share an input and expect different things, a spec cannot hold both.
export function packConflicts(a, b) {
  const out = [];
  for (const x of EDGES[a]?.pack ?? []) {
    const y = (EDGES[b]?.pack ?? []).find((i) => i.input === x.input);
    if (!y) continue;
    const say = (i) => (i.refuse ? 'an error' : JSON.stringify(i.text));
    if (!!x.refuse !== !!y.refuse || x.text !== y.text) out.push({ input: x.input, a: say(x), b: say(y) });
  }
  return out;
}

// Names that are ambiguous on purpose: a spec must say which variant it means.
export const AMBIGUOUS = {
  'canonical-json': ['json/sorted-utf16', 'json/sorted-codepoint', 'json/rfc8785'],
  json: ['json/sorted-utf16', 'json/sorted-codepoint', 'json/rfc8785'],
  'number-text': ['number-text/ecmascript'],
};
