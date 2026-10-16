// The suite: one case per example and table row (REQ-SU-*).

import { analyze, isSolo, requestLine } from './checker.ts';
import { hasOwn, resolvePath, setOwn } from './util.ts';

export function cases(files: Record<string, string>, entry: string | undefined) {
  const a = analyze(files, entry);
  if (a.errors > 0 || !a.model || !a.runs) return { errors: a.errors, cases: [] as any[] };
  const model = a.model;
  const out: any[] = [];
  for (const req of model.reqs) {
    req.items.forEach((item, i) => {
      const id = `${req.id}#${i + 1}`;
      const run = a.runs!.get(item);
      const response = run?.response;
      const c: any = {
        id,
        kind: 'example',
        reqs: ['REQ-' + req.id],
        platform: req.platform,
        line: requestLine(model, id, item),
      };
      if (isSolo(item)) c.solo = true;
      c.checks = item.expects.map((ex) => {
        if (ex.kind === 'oracle') {
          const got = resolvePath(response, ex.path);
          return { path: ex.path, kind: 'eq', value: got.value, from: 'oracle' };
        }
        if (ex.kind === 'approx') return { path: ex.path, kind: 'approx', value: ex.value, tol: ex.tol };
        return { path: ex.path, kind: 'eq', value: ex.value };
      });
      const op = item.raw ? undefined : model.ops.find((o) => o.name === item.op);
      const full: any = { members: Object.keys(response).sort() };
      if (hasOwn(response, 'error')) full.error = response.error;
      if (hasOwn(response, 'result')) full.result = response.result;
      if (op && op.audit && typeof response.audit === 'string') full.audit = response.audit;
      const tolerances: any = {};
      if (op) for (const [k, v] of op.tolerances) setOwn(tolerances, k, v);
      full.tolerances = tolerances;
      c.full = full;
      out.push(c);
    });
  }
  return { errors: 0, cases: out };
}
