// The driver protocol (SPEC: Interface). One request line in, one response line
// out, with the checks for errors run in the order the spec gives.

import { isObject, parseJson, stringify } from './json.ts';
import { compileQuery, InvalidQuery } from './query.ts';
import { evaluate, Overflow } from './evaluate.ts';

// The response for one input line, or null for a blank line.
export function respond(line: string): string | null {
  if (/^[ \t\r]*$/.test(line)) return null;
  let req: any;
  try {
    req = parseJson(line);
  } catch (e) {
    if (e instanceof RangeError) return reply(null, 'overflow');
    return reply(null, 'bad_request');
  }
  if (!isObject(req) || typeof req.id !== 'string') return reply(null, 'bad_request');
  const id: string = req.id;
  if (req.op !== 'query') return reply(id, 'unknown_op');
  const input = req.input;
  if (!isObject(input) || typeof input.query !== 'string' || !Object.hasOwn(input, 'document')) {
    return reply(id, 'bad_request');
  }
  try {
    return stringify({ id, result: evaluate(compileQuery(input.query), input.document) });
  } catch (e) {
    if (e instanceof InvalidQuery) return reply(id, 'invalid_query');
    if (e instanceof Overflow || e instanceof RangeError) return reply(id, 'overflow');
    throw e;
  }
}

function reply(id: string | null, error: string): string {
  return stringify({ id, error });
}
