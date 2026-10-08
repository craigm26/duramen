// Line-oriented JSON driver; see SPEC.md "Driver protocol".
import { canonical } from "./canon.ts";
import { auditText, flagC, flagF, wetBulb, wetBulbFromF } from "./engine.ts";
import type { Outcome } from "./engine.ts";

const SPECIAL: Record<string, number> = { NaN: NaN, Infinity: Infinity, "-Infinity": -Infinity };

class Bad extends Error {}

function num(input: Record<string, unknown>, name: string): number {
  const v = Object.prototype.hasOwnProperty.call(input, name) ? input[name] : undefined;
  if (typeof v === "number") return v;
  if (typeof v === "string" && Object.prototype.hasOwnProperty.call(SPECIAL, v)) return SPECIAL[v];
  throw new Bad();
}

const OPS: Record<string, (i: Record<string, unknown>, clock: string) => Outcome> = {
  wetBulb: (i, c) => wetBulb(num(i, "tempC"), num(i, "rhPercent"), c),
  wetBulbF: (i, c) => wetBulbFromF(num(i, "tempF"), num(i, "rhPercent"), c),
  flagF: (i, c) => flagF(num(i, "wetBulbF"), c),
  flagC: (i, c) => flagC(num(i, "wetBulbC"), c),
};

export function handle(line: string): string {
  let req: unknown;
  try {
    req = JSON.parse(line);
  } catch {
    return canonical({ id: null, error: "bad_request" });
  }
  if (typeof req !== "object" || req === null || Array.isArray(req)) {
    return canonical({ id: null, error: "bad_request" });
  }
  const r = req as Record<string, unknown>;
  if (typeof r.id !== "string") return canonical({ id: null, error: "bad_request" });
  const id = r.id;
  const fail = (error: string) => canonical({ id, error });
  const isCanon = r.op === "canonical";
  if (typeof r.op !== "string" || !(isCanon || Object.prototype.hasOwnProperty.call(OPS, r.op))) {
    return fail("unknown_op");
  }
  const input = r.input;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return fail("bad_request");
  const inp = input as Record<string, unknown>;
  if (isCanon) {
    if (!Object.prototype.hasOwnProperty.call(inp, "value")) return fail("bad_request");
    return canonical({ id, result: canonical(inp.value) });
  }
  if (typeof r.clock !== "string") return fail("bad_request");
  try {
    const out = OPS[r.op](inp, r.clock);
    return canonical({ id, result: out.result, audit: auditText(out.audit) });
  } catch (e) {
    if (e instanceof Bad) return fail("bad_request");
    throw e;
  }
}

async function main() {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    out.push(handle(line) + "\n");
  }
  process.stdout.write(out.join(""));
}

if (import.meta.main) await main();
