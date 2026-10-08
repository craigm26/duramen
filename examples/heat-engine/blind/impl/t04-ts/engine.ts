import { canonical } from "./canonical.ts";
import { auditText, flagC, flagF, wetBulb, wetBulbFromF } from "./heat.ts";
import type { Outcome } from "./heat.ts";

type Spec = { fields: string[]; run: (n: number[], clock: string) => Outcome };

const OPS: Record<string, Spec> = {
  wetBulb: { fields: ["tempC", "rhPercent"], run: (n, c) => wetBulb(n[0], n[1], c) },
  wetBulbF: { fields: ["tempF", "rhPercent"], run: (n, c) => wetBulbFromF(n[0], n[1], c) },
  flagF: { fields: ["wetBulbF"], run: (n, c) => flagF(n[0], c) },
  flagC: { fields: ["wetBulbC"], run: (n, c) => flagC(n[0], c) },
};

const SPECIAL: Record<string, number> = { NaN: NaN, Infinity: Infinity, "-Infinity": -Infinity };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && Object.hasOwn(SPECIAL, v)) return SPECIAL[v];
  return undefined;
}

// Returns the response object for one non-blank request line.
export function handle(line: string): Record<string, unknown> {
  let req: unknown;
  try {
    req = JSON.parse(line);
  } catch {
    return { id: null, error: "bad_request" };
  }
  if (!isObject(req) || typeof req.id !== "string") return { id: null, error: "bad_request" };
  const id = req.id;
  const op = req.op;
  const isCanonical = op === "canonical";
  if (typeof op !== "string" || !(isCanonical || Object.hasOwn(OPS, op))) return { id, error: "unknown_op" };
  const input = req.input;
  if (!isObject(input)) return { id, error: "bad_request" };
  if (isCanonical) {
    if (!Object.hasOwn(input, "value")) return { id, error: "bad_request" };
    return { id, result: canonical(input.value) };
  }
  if (typeof req.clock !== "string") return { id, error: "bad_request" };
  const spec = OPS[op];
  const nums: number[] = [];
  for (const f of spec.fields) {
    const n = Object.hasOwn(input, f) ? num(input[f]) : undefined;
    if (n === undefined) return { id, error: "bad_request" };
    nums.push(n);
  }
  const out = spec.run(nums, req.clock);
  return { id, result: out.result, audit: auditText(out.audit) };
}

export function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}
