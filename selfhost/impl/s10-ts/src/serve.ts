// The driver (SPEC.md, Interface): one request per line on standard input, one response per
// line on standard output, in request order. Started as `node src/serve.ts` (REGEN.json).

import { createInterface } from "node:readline";
import { check, cases } from "./check.ts";
import { filesAreValid, isRelativePath } from "./files.ts";
import { isPlainObject, parseJson } from "./text.ts";

type Response = { id: string | null; result?: unknown; error?: string };

// Answers one request line (REQ-RQ-002). The checks run in the order the Errors list gives.
export async function answer(line: string): Promise<Response> {
  const p = parseJson(line);
  if (!p.ok || !isPlainObject(p.value)) return { id: null, error: "bad_request" };
  const req = p.value;
  const id = req.id;
  if (typeof id !== "string") return { id: null, error: "bad_request" };
  if (req.op !== "check" && req.op !== "cases") return { id, error: "unknown_op" };

  const input = req.input;
  if (!isPlainObject(input)) return { id, error: "bad_request" };
  if (!filesAreValid(input.files)) return { id, error: "bad_request" };
  const files = input.files;
  let entry: string | undefined;
  if (Object.prototype.hasOwnProperty.call(input, "entry")) {
    const e = input.entry;
    if (typeof e !== "string" || (e !== "." && !isRelativePath(e))) {
      return { id, error: "bad_request" };
    }
    entry = e;
  }

  try {
    const result = req.op === "check" ? await check(files, entry) : await cases(files, entry);
    return { id, result };
  } catch (err) {
    process.stderr.write(`${String(err instanceof Error ? err.stack : err)}\n`);
    return { id, error: "internal_error" };
  }
}

// Answers each line in turn; blank lines (spaces and tabs only) get no response.
async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (/^[ \t]*$/.test(line)) continue;
    const resp = await answer(line);
    process.stdout.write(`${JSON.stringify(resp)}\n`);
  }
}

// Run only when started as the driver, so that the tests can import `answer`.
if (process.argv[1] && process.argv[1].endsWith("serve.ts")) {
  void main();
}
