// Every example in SPEC.md, sent through the driver, with the values the spec states.
// The examples carry the spec's MUSTs, so this covers each requirement by its own examples.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, at, runDriver, specExamples } from './helpers.ts';

const examples = specExamples();
const run = await runDriver(examples.map((e) => e.line + '\n').join(''));
const responses = run.stdout.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));

test('every example of the spec is read, and each gets one response', () => {
  const spec = readFileSync(join(ROOT, 'SPEC.md'), 'utf8').split('\n');
  let req = '';
  const blockTitles: string[] = [];
  for (const l of spec) {
    req = /^\*\*((?:REQ|OPEN)-[A-Z]+-\d+)\.\*\*/.exec(l)?.[1] ?? req;
    const m = /^Example (\d+): /.exec(l);
    if (m) blockTitles.push(`${req} example ${m[1]}`);
  }
  const read = new Set(examples.map((e) => e.title));
  assert.deepEqual(blockTitles.filter((t) => !read.has(t)), [], 'block examples not read');
  const blocks = blockTitles.length;
  const bullets = spec.filter((l) => /^- .* ⟶ /.test(l)).length;
  const rows = spec.filter((l) => /^\| `[[{]/.test(l)).length;
  assert.equal(examples.filter((e) => / example \d+$/.test(e.title)).length, blocks, 'block examples');
  assert.equal(examples.filter((e) => / line \d+$/.test(e.title) && !e.title.includes('table')).length, bullets, 'bullet examples');
  assert.equal(examples.filter((e) => e.title.includes('table')).length, rows, 'table rows');
  for (const e of examples) assert.ok(e.expect.length > 0, `${e.title} states nothing`);
  assert.equal(responses.length, examples.length);
  assert.equal(run.status, 0);
});

test('every requirement of the spec, and so every MUST, has at least one example here', () => {
  const spec = readFileSync(join(ROOT, 'SPEC.md'), 'utf8');
  const reqs = [...spec.matchAll(/^\*\*(REQ-[A-Z]+-\d+)\.\*\*/gm)].map((m) => m[1]);
  assert.ok(reqs.length >= 40);
  const covered = new Set(examples.map((e) => e.title.split(' ')[0]));
  assert.deepEqual(reqs.filter((r) => !covered.has(r)), []);
});

examples.forEach((ex, i) => {
  test(ex.title, () => {
    const resp = responses[i];
    for (const [path, value] of ex.expect) {
      assert.deepStrictEqual(at(resp, path), value, `${path} in ${JSON.stringify(resp)}`);
    }
  });
});
