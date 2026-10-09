// The examples of a record as requests: their IDs, and the request line each one sends
// (REQ-SU-002, REQ-SU-003).

import { defineMember } from "./jsonpath.ts";
import type { Example, RecordModel } from "./model.ts";

// One example, with the ID of its case.
export type Item = {
  ex: Example;
  id: string;
  platform: "any" | "posix" | "windows";
  // True when the example is sent alone (REQ-OR-002): a raw example, or one that omits `id`.
  solo: boolean;
};

// The examples of the record in record order, numbered within each requirement (REQ-SU-002).
export function itemsOf(model: RecordModel): Item[] {
  const out: Item[] = [];
  for (const req of model.reqs) {
    req.examples.forEach((ex, i) => {
      out.push({
        ex,
        id: `${req.id}#${i + 1}`,
        platform: req.platform,
        solo: ex.raw !== null || ex.omit.includes("id"),
      });
    });
  }
  return out;
}

// The first declared operation with this name, or null.
export function declaredOp(model: RecordModel, name: string | null) {
  if (name === null) return null;
  return model.ops.find((o) => o.name === name) ?? null;
}

// True when the oracle runs the example (REQ-OR-002): it asks a declared operation, expects
// an error, or is raw.
export function isRun(model: RecordModel, ex: Example): boolean {
  if (ex.raw !== null) return true;
  if (ex.expects.some((e) => e.path === "error")) return true;
  return declaredOp(model, ex.op) !== null;
}

// The request line of an example (REQ-SU-003). A raw example's line is as written. The
// members are the operation's request (or the spec's when it has none), with the example's
// own on top, then the omitted ones left out; `id`, `op` and `input` come first and last.
export function requestLine(item: Item, model: RecordModel): string {
  const ex = item.ex;
  if (ex.raw !== null) return ex.raw;
  const op = declaredOp(model, ex.op);
  const spec = model.specs[0];
  const base: Record<string, unknown> = (op && op.request) || (spec && spec.request) || {};
  const members: Record<string, unknown> = {};
  for (const k of Object.keys(base)) defineMember(members, k, base[k]);
  const own = ex.request ?? {};
  for (const k of Object.keys(own)) defineMember(members, k, own[k]);
  for (const k of ex.omit) {
    if (Object.prototype.hasOwnProperty.call(members, k)) delete members[k];
  }
  const parts: string[] = [];
  if (!ex.omit.includes("id")) parts.push(`"id":${JSON.stringify(item.id)}`);
  if (!ex.omit.includes("op") && ex.op !== null) parts.push(`"op":${JSON.stringify(ex.op)}`);
  for (const k of Object.keys(members)) {
    parts.push(`${JSON.stringify(k)}:${JSON.stringify(members[k])}`);
  }
  if (ex.inputText !== null && !ex.omit.includes("input")) {
    parts.push(`"input":${ex.inputText}`);
  }
  return `{${parts.join(",")}}`;
}
