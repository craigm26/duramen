// Replays every example of SPEC.md (extracted by tools/extract-examples.ts) through the driver.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { drive } from './helpers.ts';
import { lookup } from '../src/util.ts';

interface Example {
  name: string;
  request: { id: string; op: string; input: unknown };
  assertions: { path: string; value: unknown }[];
}

const examples: Example[] = JSON.parse(readFileSync(new URL('./spec-examples.json', import.meta.url), 'utf8'));

// one driver process for all of them: also checks responses come in request order
const responses = await drive(examples.map((e) => e.request));

test('the extracted examples are all there', () => {
  assert.ok(examples.length >= 150, `only ${examples.length} examples`);
  assert.equal(responses.length, examples.length);
});

examples.forEach((e, i) => {
  test(e.name, () => {
    const r = JSON.parse(responses[i]);
    assert.equal(r.id, e.request.id);
    for (const a of e.assertions) {
      const got = lookup(r, a.path);
      assert.ok(got.found, `no value at ${a.path} in ${responses[i]}`);
      assert.deepEqual(got.value, a.value, `${a.path} in ${responses[i]}`);
    }
  });
});
