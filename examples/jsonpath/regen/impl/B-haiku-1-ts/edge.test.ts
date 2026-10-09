// Edge cases the spec leaves to the implementation: large I-Regexp quantifiers, Unicode categories
// the runtime knows, deep nesting, and regular expressions taken from the document.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleLine } from './protocol.ts';

function run(query: string, doc: string): unknown {
  const line = `{"id":"e","op":"query","input":{"query":${JSON.stringify(query)},"document":${doc}}}`;
  return JSON.parse(handleLine(line));
}

test('I-Regexp: a valid range quantifier with a huge bound still matches (R27, decision 8)', () => {
  assert.deepStrictEqual(run('$[?match(@, "a{1,99999999999999999999}")]', '["a","b"]'), {
    id: 'e',
    result: { values: ['a'], paths: ['$[0]'] },
  });
});

test('I-Regexp: Unicode general category Cn (unassigned) is available (R28.6)', () => {
  assert.deepStrictEqual(run('$[?search(@, "\\\\p{Cn}")]', '["\\u0378","a"]'), {
    id: 'e',
    result: { values: ['͸'], paths: ['$[0]'] },
  });
});

test('I-Regexp: a regular expression from the document is used, and an invalid one is false (R24)', () => {
  assert.deepStrictEqual(run('$[?match(@.v, @.p)]', '[{"v":"aaa","p":"a+"},{"v":"aaa","p":"a{2}"},{"v":"a","p":"a{2,1}"}]'), {
    id: 'e',
    result: { values: [{ v: 'aaa', p: 'a+' }], paths: ['$[0]'] },
  });
});

test('string literal \\u escapes inside filters are decoded (R7)', () => {
  assert.deepStrictEqual(run('$[?@ == "\\u0041"]', '["A","\\u0041","B"]'), {
    id: 'e',
    result: { values: ['A', 'A'], paths: ['$[0]', '$[1]'] },
  });
});

test('deep nesting is evaluated (descendant segment over 400 levels)', () => {
  const depth = 400;
  const doc = '['.repeat(depth) + '1' + ']'.repeat(depth);
  const response = JSON.parse(handleLine(`{"id":"d","op":"query","input":{"query":"$..[0]","document":${doc}}}`)) as {
    result: { values: unknown[] };
  };
  assert.equal(response.result.values.length, depth);
  assert.deepStrictEqual(response.result.values[depth - 1], 1);
});

test('documents nested far beyond the call stack are parsed, written and compared (no overflow error)', () => {
  const depth = 50000;
  const doc = '['.repeat(depth) + '1' + ']'.repeat(depth);
  assert.equal(
    handleLine(`{"id":"d","op":"query","input":{"query":"$","document":${doc}}}`),
    `{"id":"d","result":{"values":[${doc}],"paths":["$"]}}`,
  );
  assert.equal(
    handleLine(`{"id":"e","op":"query","input":{"query":"$[?@ == $[0]]","document":[${doc}]}}`),
    `{"id":"e","result":{"values":[${doc}],"paths":["$[0]"]}}`,
  );
  // One result at the bottom of the document: the walk visits every level, the output stays small.
  assert.equal(
    handleLine(`{"id":"f","op":"query","input":{"query":"$..[?@ == 1]","document":${doc}}}`),
    `{"id":"f","result":{"values":[1],"paths":["$${'[0]'.repeat(depth)}"]}}`,
  );
});

test('a query nested beyond the parser stack is answered, not a crash', () => {
  const q = '$[?' + '('.repeat(20000) + '@' + ')'.repeat(20000) + ']';
  const response = JSON.parse(handleLine(`{"id":"q","op":"query","input":{"query":${JSON.stringify(q)},"document":[1]}}`)) as {
    id: string;
  };
  assert.equal(response.id, 'q');
});
