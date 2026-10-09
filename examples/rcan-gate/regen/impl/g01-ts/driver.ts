import { createInterface } from "node:readline";
import { decide, validCommand, validState } from "./gate.ts";

export function handle(line: string): Record<string, unknown> {
  let req: any;
  try {
    req = JSON.parse(line);
  } catch {
    return { id: null, error: "bad_request" };
  }
  if (typeof req !== "object" || req === null || Array.isArray(req) || typeof req.id !== "string") {
    return { id: null, error: "bad_request" };
  }
  const id = req.id;
  if (req.op !== "decide") return { id, error: "unknown_op" };
  const input = req.input;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { id, error: "bad_request" };
  if (!validState(input.state) || !validCommand(input.command)) return { id, error: "bad_request" };
  return { id, result: decide(input.state, input.command) };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (/^[ \t]*$/.test(line)) return;
    process.stdout.write(JSON.stringify(handle(line)) + "\n");
  });
}
