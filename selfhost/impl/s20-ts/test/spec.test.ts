import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle } from '../src/handler.ts';

// The examples of SPEC.md, extracted by tools/extract-examples.mjs. Every requirement has at
// least one, so every MUST is exercised here; test/must.test.ts adds hand-written cases.
const examples = JSON.parse(readFileSync(new URL('./spec-examples.json', import.meta.url), 'utf8'));

function at(root: any, path: string): any {
  let cur = root;
  for (const n of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, n)) return undefined;
    cur = cur[n];
  }
  return cur;
}

for (const ex of examples) {
  test(ex.name, () => {
    const res = handle(JSON.stringify({ id: 'x', op: ex.op, input: ex.input }));
    for (const a of ex.expect) {
      assert.deepEqual(at(res, a.path), a.value, `${a.path} in ${JSON.stringify(res)}`);
    }
  });
}
