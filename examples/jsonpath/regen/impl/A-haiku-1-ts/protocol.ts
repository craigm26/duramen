// One request line in, at most one response line out (SPEC "Driver protocol" and "Errors").
// The checks run in the order the spec gives, and the first that applies decides.

import { JsonError, parseJson, serialize } from './json.ts';
import type { Json } from './json.ts';
import { parseQuery, QueryError } from './query.ts';
import { evaluate } from './evaluate.ts';

function failure(id: string | null, code: string): string {
  return `{"id":${id === null ? 'null' : JSON.stringify(id)},"error":"${code}"}`;
}

// Returns the response without its line feed, or null for a blank line.
export function handleLine(line: string): string | null {
  const text = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (/^[ \t]*$/.test(text)) return null;

  let req: Json;
  try {
    req = parseJson(text);
  } catch (e) {
    if (e instanceof JsonError) return failure(null, 'bad_request');
    throw e;
  }
  if (!(req instanceof Map) || typeof req.get('id') !== 'string') {
    return failure(null, 'bad_request');
  }
  const id = req.get('id') as string;

  if (req.get('op') !== 'query') return failure(id, 'unknown_op');

  const input = req.get('input');
  if (
    !(input instanceof Map) ||
    typeof input.get('query') !== 'string' ||
    !input.has('document')
  ) {
    return failure(id, 'bad_request');
  }

  let result: { values: Json[]; paths: string[] };
  try {
    result = evaluate(parseQuery(input.get('query') as string), input.get('document') as Json);
  } catch (e) {
    if (e instanceof QueryError) return failure(id, 'invalid_query');
    throw e;
  }
  const values = result.values.map((v) => serialize(v)).join(',');
  const paths = result.paths.map((p) => JSON.stringify(p)).join(',');
  return `{"id":${JSON.stringify(id)},"result":{"values":[${values}],"paths":[${paths}]}}`;
}
