// Driver protocol: one request line in, one response line out.
import { parseJson, stringify } from './json.ts';
import { parseQuery, QueryError } from './parse.ts';
import { evaluate } from './eval.ts';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

function respond(id: unknown, body: Record<string, unknown>): string {
  return stringify({ id, ...body });
}

// Returns the response line (without LF) for one non-blank request line.
export function handleLine(line: string): string {
  let req: unknown;
  try {
    req = parseJson(line);
  } catch {
    return respond(null, { error: 'bad_request' });
  }
  if (!isPlainObject(req)) return respond(null, { error: 'bad_request' });
  const id = req.id;
  if (typeof id !== 'string') return respond(null, { error: 'bad_request' });
  if (req.op !== 'query') return respond(id, { error: 'unknown_op' });
  const input = req.input;
  if (!isPlainObject(input) || typeof input.query !== 'string' || !Object.hasOwn(input, 'document')) {
    return respond(id, { error: 'bad_request' });
  }
  let q;
  try {
    q = parseQuery(input.query);
  } catch (e) {
    if (e instanceof QueryError) return respond(id, { error: 'invalid_query' });
    throw e;
  }
  const nodes = evaluate(q, input.document);
  return respond(id, { result: { values: nodes.map((n) => n.v), paths: nodes.map((n) => n.p) } });
}
