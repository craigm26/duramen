// Every example in SPEC.md, run through the request handler, grouped by requirement.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { handleLine } from '../src/handle.ts';
import { at, loadSpec } from './spec-examples.ts';

const root = new URL('..', import.meta.url);
const echo = readFileSync(new URL('fixtures/echo.mjs', root), 'utf8');
const { examples, echoInSpec } = loadSpec(new URL('SPEC.md', root).pathname, echo);

test('the echo fixture is the one SPEC.md shows', () => {
  assert.equal(echo, echoInSpec);
});

test('SPEC.md yields examples for every requirement', () => {
  const spec = readFileSync(new URL('SPEC.md', root), 'utf8');
  const reqs = [...spec.matchAll(/^\*\*(REQ-[A-Z]+-\d+)\.\*\*/gm)].map((m) => m[1]);
  assert.ok(reqs.length >= 40, `found ${reqs.length} requirements`);
  for (const r of reqs) assert.ok(examples.some((e) => e.where === r), `no example read for ${r}`);
});

const groups = new Map<string, typeof examples>();
for (const e of examples) {
  if (!groups.has(e.where)) groups.set(e.where, []);
  groups.get(e.where)!.push(e);
}

for (const [where, list] of groups) {
  describe(where, { concurrency: 4 }, () => {
    for (const e of list) {
      test(e.title, async () => {
        const response = JSON.parse(JSON.stringify(await handleLine(e.line)));
        for (const [path, want] of e.asserts) {
          assert.deepStrictEqual(at(response, path), want, `${path} of ${JSON.stringify(response)}`);
        }
      });
    }
  });
}
