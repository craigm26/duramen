// Replays every example of SPEC.md (extracted by tools/extract-examples.ts).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { respond } from '../src/protocol.ts';
import { deepEqual } from '../src/util.ts';

const here = dirname(fileURLToPath(import.meta.url));
const examples = JSON.parse(readFileSync(join(here, 'fixtures', 'spec-examples.json'), 'utf8'));

function at(value: any, path: string): any {
  let cur = value;
  for (const name of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(name in cur)) return undefined;
    cur = cur[name];
  }
  return cur;
}

for (const ex of examples) {
  test(`${ex.name}`, () => {
    let line: string;
    if (ex.line !== undefined) line = ex.line;
    else {
      const req: any = { id: 't1', op: ex.op };
      if (ex.noId) delete req.id;
      if (!ex.noInput) req.input = ex.input;
      line = JSON.stringify(req);
    }
    const out = respond(line);
    assert.ok(out !== undefined);
    const res = JSON.parse(out);
    for (const e of ex.expects) {
      const got = at(res, e.path);
      assert.ok(deepEqual(got, e.value), `${e.path}: expected ${JSON.stringify(e.value)}, got ${JSON.stringify(got)}`);
    }
  });
}
