// Request handling: one input line in, one response line out (or null for blank lines).
import { JsonError, parseJson, stringify } from './json.ts';
import type { JValue } from './json.ts';
import { QueryError, parseQuery } from './query.ts';
import { evalSegments, normalizedPath } from './evaluate.ts';

export function runQuery(query: string, document: JValue): { values: JValue[]; paths: string[] } {
  const segs = parseQuery(query);
  const nodes = evalSegments(segs, { v: document, par: null, key: '' }, document);
  return { values: nodes.map((n) => n.v), paths: nodes.map(normalizedPath) };
}

const err = (id: string | null, code: string) => JSON.stringify({ id, error: code });

export function handleLine(line: string): string | null {
  if (/^[ \t\r]*$/.test(line)) return null;
  let req: JValue;
  try {
    req = parseJson(line);
  } catch (e) {
    if (e instanceof JsonError || e instanceof RangeError) return err(null, 'bad_request');
    throw e;
  }
  if (!(req instanceof Map)) return err(null, 'bad_request');
  const id = req.get('id');
  if (typeof id !== 'string') return err(null, 'bad_request');
  const op = req.get('op');
  if (typeof op !== 'string' || op !== 'query') return err(id, 'unknown_op');
  const input = req.get('input');
  if (!(input instanceof Map)) return err(id, 'bad_request');
  const query = input.get('query');
  if (typeof query !== 'string' || !input.has('document')) return err(id, 'bad_request');
  try {
    const r = runQuery(query, input.get('document')!);
    return (
      '{"id":' + JSON.stringify(id) + ',"result":{"values":' + stringify(r.values) +
      ',"paths":' + JSON.stringify(r.paths) + '}}'
    );
  } catch (e) {
    if (e instanceof QueryError) return err(id, 'invalid_query');
    if (e instanceof RangeError) return err(id, 'bad_request');
    throw e;
  }
}
