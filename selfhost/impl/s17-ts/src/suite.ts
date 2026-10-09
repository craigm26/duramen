// The suite generated from a record (REQ-SU-001 to REQ-SU-005).

import type { Example, OpModel, RecordModel } from './model.ts';
import { buildLine, isSolo } from './line.ts';
import { getPath, hasOwn } from './util.ts';
import type { Obj } from './util.ts';

export function buildCases(rec: RecordModel, responses: Map<Example, Obj | null>, ops: Map<string, OpModel>): Obj[] {
  const cases: Obj[] = [];
  for (const r of rec.reqs) {
    r.examples.forEach((ex, i) => {
      const id = `${r.id}#${i + 1}`;
      const op = ex.op !== null ? ops.get(ex.op) : undefined;
      const resp = responses.get(ex) as Obj;
      const checks = ex.expects.map((e): Obj => {
        if (e.kind === 'eq') return { path: e.path, kind: 'eq', value: e.value };
        if (e.kind === 'approx') return { path: e.path, kind: 'approx', value: e.value, tol: e.tol };
        return { path: e.path, kind: 'eq', value: getPath(resp, e.path).value, from: 'oracle' };
      });
      const tolerances: Obj = {};
      if (!ex.raw && op) for (const [p, v] of op.tolerances) tolerances[p] = v;
      const full: Obj = { members: Object.keys(resp).sort() };
      if (hasOwn(resp, 'error')) full.error = resp.error;
      if (hasOwn(resp, 'result')) full.result = resp.result;
      if (!ex.raw && op && op.audit && typeof resp.audit === 'string') full.audit = resp.audit;
      full.tolerances = tolerances;
      const c: Obj = {
        id,
        kind: 'example',
        reqs: ['REQ-' + r.id],
        platform: r.platform,
        line: buildLine(ex, id, rec.spec, op),
      };
      if (isSolo(ex)) c.solo = true;
      c.checks = checks;
      c.full = full;
      cases.push(c);
    });
  }
  return cases;
}
