// Every example in SPEC.md, run through the driver (one test per example, named by its requirement).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';
import { at, ROOT, runDriver, type DriverRun } from './helpers.ts';

interface SpecExample {
  req: string;
  name: string;
  line: string;
  expect: [string, unknown][];
}

const examples: SpecExample[] = JSON.parse(readFileSync(join(ROOT, 'tests', 'spec-examples.json'), 'utf8'));

describe('the examples of SPEC.md', () => {
  let run: DriverRun;
  before(async () => {
    run = await runDriver(examples.map((e) => e.line + '\n').join(''));
  });

  it('get one response each, and the driver exits with 0', () => {
    assert.equal(run.status, 0);
    assert.equal(run.responses.length, examples.length);
  });

  examples.forEach((ex, i) => {
    it(ex.name, () => {
      const resp = run.responses[i];
      for (const [path, value] of ex.expect) assert.deepEqual(at(resp, path), value, `${path} of ${JSON.stringify(resp)}`);
    });
  });
});
