// One request line in, at most one response line out (SPEC.md, Driver protocol and Errors).

import { runQuery } from "./evaluate.ts";
import { parseQuery, QueryError } from "./parse.ts";
import { hasMember, isObject } from "./values.ts";

// The response line for one request line, without its LF; null for a blank line (no response).
export function answerLine(line: string): string | null {
  // A CR left at the end of a line is the first half of CRLF, not part of the request.
  const text = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (/^[ \t]*$/.test(text)) return null;
  return encode(respond(text));
}

// The response object for one request, following the order of checks in SPEC.md, Errors.
export function respond(text: string): Record<string, unknown> {
  let request: unknown;
  try {
    request = JSON.parse(text);
  } catch {
    return { id: null, error: "bad_request" };
  }
  if (!isObject(request) || typeof request.id !== "string") {
    return { id: null, error: "bad_request" };
  }
  const id = request.id;
  if (request.op !== "query") return { id, error: "unknown_op" };
  const input = request.input;
  if (!isObject(input) || typeof input.query !== "string" || !hasMember(input, "document")) {
    return { id, error: "bad_request" };
  }
  let query;
  try {
    query = parseQuery(input.query);
  } catch (e) {
    // A RangeError here means the query nests too deeply to parse; it is not usable either.
    if (e instanceof QueryError || e instanceof RangeError) return { id, error: "invalid_query" };
    throw e;
  }
  return { id, result: runQuery(query, input.document) };
}

// JSON on one line. U+0085, U+2028 and U+2029 are written as escapes: they are legal inside a
// JSON string, but some line splitters treat them as line ends.
function encode(response: Record<string, unknown>): string {
  const escaped = [0x85, 0x2028, 0x2029];
  let out = "";
  for (const c of JSON.stringify(response)) {
    const cp = c.codePointAt(0)!;
    out += escaped.includes(cp) ? "\\u" + cp.toString(16).padStart(4, "0") : c;
  }
  return out;
}
