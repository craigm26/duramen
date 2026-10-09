// Every example table of SPEC.md, run through the driver's request path. The rows are in
// test/fixtures/spec-examples.json, written by test/extract-spec-examples.ts from SPEC.md.

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert';
import { respondLine } from '../protocol.ts';

interface Example {
  section: string;
  line: number;
  request: Record<string, unknown>;
  expect: { error?: string; values?: unknown[]; paths?: string[] };
}

const examples: Example[] = JSON.parse(
  readFileSync(new URL('./fixtures/spec-examples.json', import.meta.url), 'utf8'),
);

// Rows where SPEC.md contradicts itself. They are reported as skipped, with the reason, and
// the choice that decides them is in CHOICES.md.
const CONTRADICTIONS: Record<string, string> = {
  '$.ˋa': 'C-1: the row expects invalid_query, but REQ-SY-002 allows U+02CB in a name',
};

for (const ex of examples) {
  const label = `${ex.section} (SPEC.md line ${ex.line}): ${JSON.stringify(ex.request)}`;
  const skip = CONTRADICTIONS[String(ex.request.query)];
  test(label, { skip }, () => {
    const line = respondLine(JSON.stringify({ id: 'row', op: 'query', input: ex.request }));
    assert.notStrictEqual(line, undefined);
    const response = JSON.parse(line as string) as { id: string; result?: { values: unknown[]; paths: string[] }; error?: string };
    assert.strictEqual(response.id, 'row');
    if (ex.expect.error !== undefined) {
      assert.deepStrictEqual(response, { id: 'row', error: ex.expect.error });
      return;
    }
    assert.strictEqual(response.error, undefined, `unexpected error ${response.error}`);
    if (ex.expect.values !== undefined) assert.deepStrictEqual(response.result?.values, ex.expect.values);
    if (ex.expect.paths !== undefined) assert.deepStrictEqual(response.result?.paths, ex.expect.paths);
  });
}
