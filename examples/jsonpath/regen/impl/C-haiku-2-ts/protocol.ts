// The driver protocol of SPEC.md (Driver protocol and Errors): one request per line in, one
// response per non-blank line out, the checks run in the order the Errors section gives.

import { InvalidQuery, parseQuery } from './parse.ts';
import type { Json } from './parse.ts';
import { evaluateQuery, isObject, normalizedPath } from './evaluate.ts';

// The response for one request line, as one line of JSON; undefined for a blank line.
export function respondLine(raw: string): string | undefined {
  // A CR at the end belongs to a CRLF line ending, not to the request.
  const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
  if (/^[ \t]*$/.test(line)) return undefined;
  return JSON.stringify(respond(line));
}

function respond(line: string): Record<string, unknown> {
  let request: unknown;
  try {
    request = JSON.parse(line);
  } catch {
    return failure(null, 'bad_request');
  }
  if (!isObject(request) || typeof request.id !== 'string') return failure(null, 'bad_request');
  const id = request.id;
  if (request.op !== 'query') return failure(id, 'unknown_op');
  const input = request.input;
  if (!isObject(input) || typeof input.query !== 'string' || !Object.hasOwn(input, 'document')) {
    return failure(id, 'bad_request');
  }
  let query;
  try {
    query = parseQuery(input.query);
  } catch (error) {
    if (error instanceof InvalidQuery) return failure(id, 'invalid_query');
    throw error;
  }
  const nodes = evaluateQuery(query, input.document as Json);
  return {
    id,
    result: {
      values: nodes.map((node) => node.value),
      paths: nodes.map((node) => normalizedPath(node.path)),
    },
  };
}

function failure(id: string | null, error: string): Record<string, unknown> {
  return { id, error };
}
