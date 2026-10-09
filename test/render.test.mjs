// The brief shows what the record says. A code span holding a backtick used to be written with
// U+02CB in its place, which made an example of the jsonpath record say that `$.ˋa` is invalid
// (CONFIDENCE-2.md, claim 7); a span now takes a longer fence instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.mjs';
import { renderSpec } from '../src/render.mjs';

test('render: a backtick in an example is shown as itself, in a fence longer than any run inside', () => {
  const { ast, diagnostics } = parse(`duramen 0.1
spec s 1
op f
  input q string
req A "a"
  example f {"q": "$.\`a"}
    expect error = "e"
  example f {"q": "x\`\`y\`"}
    expect error = "e"
  example f {"q": " a "}
    expect error = "e"
`, 's.duramen');
  assert.deepEqual(diagnostics, []);
  const md = renderSpec(ast, null);
  assert.doesNotMatch(md, /ˋ/);
  assert.ok(md.includes('- `` f {"q": "$.`a"} `` ⟶'), 'one backtick: a fence of two, padded');
  assert.ok(md.includes('- ``` f {"q": "x``y`"} ``` ⟶'), 'a run of two: a fence of three');
  assert.ok(md.includes('- `f {"q": " a "}` ⟶'), 'no backtick: one, unpadded');
});
