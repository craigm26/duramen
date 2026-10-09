import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import { handleLine } from '../src/handle.ts';
import { deepEqual } from '../src/util.ts';

// Every example of SPEC.md (extracted by tools/extract-examples.ts), grouped by requirement.
interface Case { req: string; name: string; line: string; expect: [string, unknown][] }
const cases: Case[] = JSON.parse(fs.readFileSync(new URL('./spec-examples.json', import.meta.url), 'utf8'));
const echo = fs.readFileSync(new URL('../fixtures/echo.mjs', import.meta.url), 'utf8');

function at(v: unknown, path: string): unknown {
  let cur: any = v;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

for (const c of cases) {
  test(`${c.name}`, () => {
    const line = c.line.includes('@echo') ? JSON.stringify(withEcho(JSON.parse(c.line))) : c.line;
    const resp = handleLine(line);
    for (const [path, want] of c.expect) {
      const got = at(resp, path);
      assert.ok(deepEqual(got, want), `${c.name}: ${path}\n got  ${JSON.stringify(got)}\n want ${JSON.stringify(want)}`);
    }
  });
}

function withEcho(req: any): any {
  const files = req.input.files;
  for (const k of Object.keys(files)) if (files[k] === '@echo') files[k] = echo;
  return req;
}
