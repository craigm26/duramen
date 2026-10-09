// Request handling for the line protocol.
import { canonical } from "./canon.ts";
import { auditText, flagC, flagF, wetBulb, wetBulbFromF } from "./engine.ts";
import type { Outcome } from "./engine.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const has = (o: Obj, k: string) => Object.prototype.hasOwnProperty.call(o, k);

// REQ-IF-006: a number, or one of three strings; undefined for anything else.
function num(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (v === "NaN") return NaN;
  if (v === "Infinity") return Infinity;
  if (v === "-Infinity") return -Infinity;
  return undefined;
}

const OPS: Record<string, { fields: string[]; run: (n: number[], clock: string) => Outcome }> = {
  wetBulb: { fields: ["tempC", "rhPercent"], run: (n, c) => wetBulb(n[0], n[1], c) },
  wetBulbF: { fields: ["tempF", "rhPercent"], run: (n, c) => wetBulbFromF(n[0], n[1], c) },
  flagF: { fields: ["wetBulbF"], run: (n, c) => flagF(n[0], c) },
  flagC: { fields: ["wetBulbC"], run: (n, c) => flagC(n[0], c) },
};

export function handleLine(line: string): string {
  const reply = (o: unknown) => JSON.stringify(o);
  let req: unknown;
  try {
    req = JSON.parse(line);
  } catch {
    return reply({ id: null, error: "bad_request" });
  }
  if (!isObj(req) || typeof req.id !== "string") return reply({ id: null, error: "bad_request" });
  const id = req.id;
  const err = (error: string) => reply({ id, error });
  const op = req.op;
  if (typeof op !== "string" || (op !== "canonical" && !has(OPS, op))) return err("unknown_op");
  if (!isObj(req.input)) return err("bad_request");
  const input = req.input;
  if (op === "canonical") {
    if (!has(input, "value")) return err("bad_request");
    return reply({ id, result: canonical(input.value) });
  }
  if (typeof req.clock !== "string") return err("bad_request");
  const spec = OPS[op];
  const nums: number[] = [];
  for (const f of spec.fields) {
    const n = has(input, f) ? num(input[f]) : undefined;
    if (n === undefined) return err("bad_request");
    nums.push(n);
  }
  const out = spec.run(nums, req.clock);
  return reply({ id, result: out.result, audit: auditText(out.audit) });
}

export function handleInput(text: string): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (/^[ \t\r]*$/.test(line)) continue;
    out.push(handleLine(line) + "\n");
  }
  return out.join("");
}
