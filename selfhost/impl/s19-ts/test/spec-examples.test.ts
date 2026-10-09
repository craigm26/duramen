// Every example in SPEC.md, run through the request handler, grouped by requirement.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleLine } from '../src/protocol.ts';
import { at, specExamples } from './spec-examples.ts';
import type { SpecExample } from './spec-examples.ts';

const examples = specExamples();
const byItem = new Map<string, SpecExample[]>();
for (const e of examples) {
  if (!byItem.has(e.item)) byItem.set(e.item, []);
  byItem.get(e.item)!.push(e);
}

describe('SPEC.md examples', { concurrency: 8 }, () => {
  it('finds the examples of every requirement', () => {
    assert.ok(examples.length > 200, `only ${examples.length} examples`);
    for (const id of [
      'REQ-RQ-001', 'REQ-RQ-002', 'REQ-RC-001', 'REQ-RC-002', 'REQ-RC-003', 'REQ-RC-004', 'REQ-RC-005',
      'REQ-RC-006', 'REQ-SY-001', 'REQ-SY-002', 'REQ-SY-003', 'REQ-SY-004', 'REQ-SY-005', 'REQ-SY-006',
      'REQ-SY-007', 'REQ-SY-008', 'REQ-SY-009', 'REQ-SY-010', 'REQ-SY-011', 'REQ-SY-012', 'REQ-SY-013',
      'REQ-CK-001', 'REQ-CK-002', 'REQ-CK-003', 'REQ-CK-004', 'REQ-CK-005', 'REQ-CK-006', 'REQ-CK-007',
      'REQ-CK-008', 'REQ-CK-009', 'REQ-OR-001', 'REQ-OR-002', 'REQ-OR-003', 'REQ-OR-004', 'REQ-OR-005',
      'REQ-OR-006', 'REQ-OR-007', 'REQ-OR-008', 'REQ-SU-001', 'REQ-SU-002', 'REQ-SU-003', 'REQ-SU-004',
      'REQ-SU-005', 'REQ-JU-001', 'REQ-JU-002', 'REQ-JU-003', 'REQ-JU-004',
    ]) {
      assert.ok(byItem.has(id), `no example for ${id}`);
    }
  });

  for (const [item, list] of byItem) {
    describe(item, { concurrency: 8 }, () => {
      for (const e of list) {
        it(`SPEC.md line ${e.at}`, async () => {
          // As the driver writes it: results are compared as parsed JSON.
          const response = JSON.parse(JSON.stringify(await handleLine(e.line)));
          for (const x of e.expect) {
            assert.deepEqual(at(response, x.path), x.value, `${x.path} of ${JSON.stringify(response)}`);
          }
        });
      }
    });
  }
});
