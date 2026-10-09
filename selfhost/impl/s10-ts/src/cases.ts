// The suite a record generates: one case per example and table row (REQ-SU-002, REQ-SU-004,
// REQ-SU-005).

import { compareUtf16 } from "./text.ts";
import { valueAt } from "./checks.ts";
import { declaredOp, requestLine, type Item } from "./requests.ts";
import type { Example, RecordModel } from "./model.ts";

export type Check =
  | { path: string; kind: "eq"; value: unknown }
  | { path: string; kind: "approx"; value: number; tol: number }
  | { path: string; kind: "eq"; value: unknown; from: "oracle" };

export type Case = {
  id: string;
  kind: "example";
  reqs: string[];
  platform: string;
  line: string;
  solo?: true;
  checks: Check[];
  full: Record<string, unknown>;
};

// Builds the cases of a record without errors. `answers` holds the response of each example.
export function buildCases(
  model: RecordModel,
  items: Item[],
  answers: Map<Example, Record<string, unknown>>,
): Case[] {
  const cases: Case[] = [];
  for (const it of items) {
    const ex = it.ex;
    const resp = answers.get(ex) ?? {};
    const checks: Check[] = [];
    for (const e of ex.expects) {
      if (e.kind === "eq") {
        checks.push({ path: e.path, kind: "eq", value: e.value });
      } else if (e.kind === "approx") {
        checks.push({ path: e.path, kind: "approx", value: e.value, tol: e.tol });
      } else {
        const v = valueAt(resp, e.path);
        checks.push({ path: e.path, kind: "eq", value: v.value, from: "oracle" });
      }
    }
    cases.push({
      id: it.id,
      kind: "example",
      reqs: [`REQ-${ex.req}`],
      platform: it.platform,
      line: requestLine(it, model),
      ...(it.solo ? { solo: true as const } : {}),
      checks,
      full: fullOf(model, ex, resp),
    });
  }
  return cases;
}

// The whole answer of the oracle to a request (REQ-SU-005).
function fullOf(model: RecordModel, ex: Example, resp: Record<string, unknown>): Record<string, unknown> {
  const op = declaredOp(model, ex.op);
  const full: Record<string, unknown> = {
    members: Object.keys(resp).sort(compareUtf16),
  };
  if (Object.prototype.hasOwnProperty.call(resp, "error")) full.error = resp.error;
  if (Object.prototype.hasOwnProperty.call(resp, "result")) full.result = resp.result;
  if (op && op.audit && typeof resp.audit === "string") full.audit = resp.audit;
  const tolerances: Record<string, number> = {};
  if (op) for (const t of op.tolerances) tolerances[t.path] = t.value;
  full.tolerances = tolerances;
  return full;
}
