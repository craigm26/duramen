// One request line in, one response line out (SPEC "Driver protocol" and R1).

import { parseJson, toJson } from './json.ts';
import type { JVal } from './json.ts';
import { evaluate, pathOf } from './eval.ts';
import { parseQuery, QueryError } from './query.ts';

function error(id: string | null, code: string): string {
  return `{"id":${JSON.stringify(id)},"error":"${code}"}`;
}

// Handles one request line (without its line feed) and returns the response line.
export function handleLine(line: string): string {
  let req: JVal;
  try {
    req = parseJson(line);
  } catch {
    return error(null, 'bad_request');
  }
  if (!(req instanceof Map)) return error(null, 'bad_request');
  const id = req.get('id');
  if (typeof id !== 'string') return error(null, 'bad_request');
  if (req.get('op') !== 'query') return error(id, 'unknown_op');
  const input = req.get('input');
  if (!(input instanceof Map)) return error(id, 'bad_request');
  const query = input.get('query');
  if (typeof query !== 'string' || !input.has('document')) return error(id, 'bad_request');
  let parsed;
  try {
    parsed = parseQuery(query);
  } catch (e) {
    // A query nested too deeply for the parser's recursion cannot be handled: invalid_query.
    if (e instanceof QueryError || e instanceof RangeError) return error(id, 'invalid_query');
    throw e;
  }
  const nodes = evaluate(parsed, input.get('document') as JVal);
  const values = nodes.map((n) => toJson(n.v)).join(',');
  const paths = nodes.map((n) => JSON.stringify(pathOf(n))).join(',');
  return `{"id":${JSON.stringify(id)},"result":{"values":[${values}],"paths":[${paths}]}}`;
}
