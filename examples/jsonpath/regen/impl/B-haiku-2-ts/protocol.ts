// The driver protocol (SPEC Interface and R1): one request line in, at most one response line out.

import { JsonSyntaxError, jsonText, parseJson } from './json.ts';
import type { Json } from './json.ts';
import { InvalidQuery, compileQuery } from './query.ts';
import { runQuery } from './eval.ts';

// Returns the response line for one input line, or null when the line is blank (R1.1).
export function respond(line: string): string | null {
  if (/^[ \t\r]*$/.test(line)) return null;
  // R1.1: a carriage return at the end of a line is ignored.
  const text = line.endsWith('\r') ? line.slice(0, -1) : line;
  const request = parseRequest(text);
  if (request === null) return error(null, 'bad_request');
  const id = request.get('id');
  if (typeof id !== 'string') return error(null, 'bad_request');

  const op = request.get('op');
  if (typeof op !== 'string' || op !== 'query') return error(id, 'unknown_op');

  const input = request.get('input');
  if (!(input instanceof Map)) return error(id, 'bad_request');
  const queryText = input.get('query');
  if (typeof queryText !== 'string' || !input.has('document')) return error(id, 'bad_request');

  let found;
  try {
    found = runQuery(compileQuery(queryText), input.get('document') as Json);
  } catch (failure) {
    if (failure instanceof InvalidQuery) return error(id, 'invalid_query');
    throw failure;
  }
  const values = found.map((node) => jsonText(node.value)).join(',');
  const paths = found.map((node) => JSON.stringify(node.path)).join(',');
  return `{"id":${JSON.stringify(id)},"result":{"values":[${values}],"paths":[${paths}]}}`;
}

// The request as a JSON object, or null when the line is not one.
function parseRequest(text: string): Map<string, Json> | null {
  let value: Json;
  try {
    value = parseJson(text);
  } catch (failure) {
    if (failure instanceof JsonSyntaxError) return null;
    throw failure;
  }
  return value instanceof Map ? value : null;
}

function error(id: string | null, code: string): string {
  return `{"id":${id === null ? 'null' : JSON.stringify(id)},"error":"${code}"}`;
}
