// Request lines and the cases of the suite (REQ-SU-001 to REQ-SU-005).

import { compareUnits, hasMember, isObject, parseLoose, setMember, type Json } from './json.ts';
import type { Example, Expectation, Op, Record } from './model.ts';

export interface Outcome {
  response?: { [k: string]: Json };
  /** The oracle's values for `?` expectations. */
  values: Map<Expectation, Json>;
}

export function isSolo(ex: Example): boolean {
  return ex.raw || ex.omit.includes('id');
}

export function expectsError(ex: Example): boolean {
  return ex.expects.some((e) => e.path === 'error');
}

/** The operation a case is about: the example's, or for a raw example, the `op` of its line. */
export function opOf(ex: Example, record: Record): Op | undefined {
  let name = ex.op;
  if (ex.raw) {
    const p = parseLoose(ex.rawLine ?? '');
    name = p.ok && isObject(p.value) && typeof p.value.op === 'string' ? p.value.op : undefined;
  }
  return name === undefined ? undefined : record.ops.find((o) => o.name === name);
}

/** The request line of an example (REQ-SU-003). */
export function requestLine(ex: Example, record: Record): string {
  if (ex.raw) return ex.rawLine!;
  const op = record.ops.find((o) => o.name === ex.op);
  const members: { [k: string]: Json } = Object.create(null);
  const base = op?.hasRequest ? op.request : record.specs[0]?.request;
  for (const src of [base, ex.request]) {
    if (src) for (const k of Object.keys(src)) setMember(members, k, src[k]);
  }
  const omit = new Set(ex.omit);
  const parts: string[] = [];
  if (!omit.has('id')) parts.push(`"id":${JSON.stringify(ex.id)}`);
  if (!omit.has('op')) parts.push(`"op":${JSON.stringify(ex.op)}`);
  for (const k of Object.keys(members)) {
    if (!omit.has(k)) parts.push(`${JSON.stringify(k)}:${JSON.stringify(members[k])}`);
  }
  if (!omit.has('input')) {
    if (ex.hasInputLines) parts.push(`"input":${JSON.stringify(ex.inputValue)}`);
    else if (ex.inputText !== undefined) parts.push(`"input":${ex.inputText}`);
  }
  return `{${parts.join(',')}}`;
}

export function buildCases(record: Record, outcomes: Map<Example, Outcome>): Json[] {
  const cases: Json[] = [];
  for (const req of record.reqs) {
    for (const ex of req.examples) {
      const out = outcomes.get(ex);
      const resp = out?.response ?? {};
      const op = opOf(ex, record);
      const checks: Json[] = ex.expects.map((e): Json => {
        if (e.kind === 'approx') return { path: e.path, kind: 'approx', value: e.value!, tol: e.tol! };
        if (e.kind === 'oracle') return { path: e.path, kind: 'eq', value: out?.values.get(e) ?? null, from: 'oracle' };
        return { path: e.path, kind: 'eq', value: e.value! };
      });
      const full: { [k: string]: Json } = { members: Object.keys(resp).sort(compareUnits) };
      if (hasMember(resp, 'error')) full.error = resp.error;
      if (hasMember(resp, 'result')) full.result = resp.result;
      if (op?.audit && hasMember(resp, 'audit')) full.audit = resp.audit;
      const tolerances: { [k: string]: Json } = {};
      for (const [path, n] of op?.tolerances ?? []) setMember(tolerances, path, n);
      full.tolerances = tolerances;
      const c: { [k: string]: Json } = {
        id: ex.id!,
        kind: 'example',
        reqs: [`REQ-${req.id}`],
        platform: req.platform,
        line: requestLine(ex, record),
      };
      if (isSolo(ex)) c.solo = true;
      c.checks = checks;
      c.full = full;
      cases.push(c);
    }
  }
  return cases;
}
