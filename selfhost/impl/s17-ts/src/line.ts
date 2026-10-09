// Request lines (REQ-SU-003).

import type { Example, OpModel, RecordModel } from './model.ts';
import { setOwn } from './util.ts';
import type { Obj } from './util.ts';

export function buildLine(ex: Example, caseId: string, spec: RecordModel['spec'], op: OpModel | undefined): string {
  if (ex.raw) return ex.rawLine as string;
  const members: Obj = {};
  const base = op && op.request ? op.request : spec ? spec.request : null;
  for (const src of [base, ex.request]) {
    if (!src) continue;
    for (const k of Object.keys(src)) setOwn(members, k, src[k]);
  }
  const omit = new Set(ex.omit);
  const parts: string[] = [];
  if (!omit.has('id')) parts.push('"id":' + JSON.stringify(caseId));
  if (!omit.has('op')) parts.push('"op":' + JSON.stringify(ex.op));
  for (const k of Object.keys(members)) {
    if (!omit.has(k)) parts.push(JSON.stringify(k) + ':' + JSON.stringify(members[k]));
  }
  if (!omit.has('input')) {
    const text = ex.inputLines ? JSON.stringify(ex.input) : ex.jsonText;
    if (text !== null) parts.push('"input":' + text);
  }
  return '{' + parts.join(',') + '}';
}

export function isSolo(ex: Example): boolean {
  return ex.raw || ex.omit.includes('id');
}
