// Line-oriented JSON driver: one request per stdin line, one response per stdout line.
import { parseJson, stringify } from "./json.ts";
import type { Json } from "./json.ts";
import { parseQuery } from "./parse.ts";
import { evaluate, normalizedPath } from "./eval.ts";

export function handleLine(line: string): string | null {
  if (/^[ \t\r]*$/.test(line)) return null;
  const reply = (id: string | null, key: "result" | "error", val: Json): string =>
    stringify(new Map<string, Json>([["id", id], [key, val]]));

  let req: Json;
  try {
    req = parseJson(line);
  } catch {
    return reply(null, "error", "bad_request");
  }
  if (!(req instanceof Map)) return reply(null, "error", "bad_request");
  const id = req.get("id");
  if (typeof id !== "string") return reply(null, "error", "bad_request");
  if (req.get("op") !== "query") return reply(id, "error", "unknown_op");
  const input = req.get("input");
  if (!(input instanceof Map)) return reply(id, "error", "bad_request");
  const query = input.get("query");
  if (typeof query !== "string" || !input.has("document")) return reply(id, "error", "bad_request");
  let parsed;
  try {
    parsed = parseQuery(query);
  } catch {
    return reply(id, "error", "invalid_query");
  }
  const nodes = evaluate(parsed, input.get("document")!);
  return reply(
    id,
    "result",
    new Map<string, Json>([
      ["values", nodes.map((n) => n.v)],
      ["paths", nodes.map(normalizedPath)],
    ]),
  );
}

function main() {
  const dec = new TextDecoder("utf-8");
  let buf = "";
  const run = (line: string) => {
    const out = handleLine(line);
    if (out !== null) process.stdout.write(out + "\n");
  };
  process.stdout.on("error", () => {});
  process.stdin.on("data", (chunk: Buffer) => {
    buf += dec.decode(chunk, { stream: true });
    let k: number;
    while ((k = buf.indexOf("\n")) >= 0) {
      run(buf.slice(0, k));
      buf = buf.slice(k + 1);
    }
  });
  process.stdin.on("end", () => {
    buf += dec.decode();
    if (buf.length) run(buf);
  });
}

if (import.meta.main) main();
