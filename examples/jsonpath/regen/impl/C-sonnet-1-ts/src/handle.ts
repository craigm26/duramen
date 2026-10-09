// Handling of one request line.

import { runQuery } from './eval.ts';
import { parseQuery, QueryError } from './parse.ts';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

// The response line for a request line, or null for a blank line.
export function handleLine(line: string): string | null {
  if (/^[ \t]*$/.test(line)) return null;
  let req: unknown;
  try {
    req = JSON.parse(line);
  } catch {
    return JSON.stringify({ id: null, error: 'bad_request' });
  }
  if (!isObject(req) || typeof req.id !== 'string') {
    return JSON.stringify({ id: null, error: 'bad_request' });
  }
  const id = req.id;
  const err = (error: string) => JSON.stringify({ id, error });
  if (req.op !== 'query') return err('unknown_op');
  const input = req.input;
  if (!isObject(input) || typeof input.query !== 'string' || !Object.hasOwn(input, 'document')) {
    return err('bad_request');
  }
  try {
    const q = parseQuery(input.query);
    return JSON.stringify({ id, result: runQuery(q, input.document) });
  } catch (e) {
    if (e instanceof QueryError) return err('invalid_query');
    throw e;
  }
}
