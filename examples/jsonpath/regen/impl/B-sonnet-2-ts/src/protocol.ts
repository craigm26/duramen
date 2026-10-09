// One request line in, one response line out.

import { parseJson, stringify } from './json.ts';
import type { Value } from './json.ts';
import { parseQuery } from './parse.ts';
import { runQuery } from './eval.ts';

function err(id: string | null, code: string): string {
  return '{"id":' + JSON.stringify(id) + ',"error":"' + code + '"}';
}

export function isBlank(line: string): boolean {
  return /^[ \t\r]*$/.test(line);
}

export function handleLine(line: string): string {
  let req: Value;
  try {
    req = parseJson(line);
  } catch {
    return err(null, 'bad_request');
  }
  if (!(req instanceof Map)) return err(null, 'bad_request');
  const id = req.get('id');
  if (typeof id !== 'string') return err(null, 'bad_request');
  if (req.get('op') !== 'query') return err(id, 'unknown_op');
  const input = req.get('input');
  if (!(input instanceof Map)) return err(id, 'bad_request');
  const query = input.get('query');
  if (typeof query !== 'string' || !input.has('document')) return err(id, 'bad_request');
  const q = parseQuery(query);
  if (q === null) return err(id, 'invalid_query');
  const nodes = runQuery(q, input.get('document')!);
  const values = '[' + nodes.map((n) => stringify(n.value)).join(',') + ']';
  const paths = '[' + nodes.map((n) => JSON.stringify(n.path)).join(',') + ']';
  return '{"id":' + JSON.stringify(id) + ',"result":{"values":' + values + ',"paths":' + paths + '}}';
}
