// One request line in, one response out (Interface, REQ-RQ-001, REQ-RQ-002).

import { isRelativePath, type Files } from './files.ts';
import { isObject, type Json } from './json.ts';
import { cases, check } from './ops.ts';

export type Response = { id: string | null; result: Json } | { id: string | null; error: string };

type Valid = { ok: true; files: Files; entry: string } | { ok: false };

function validateInput(input: unknown): Valid {
  if (!isObject(input)) return { ok: false };
  const files = input.files;
  if (!Object.hasOwn(input, 'files') || !isObject(files)) return { ok: false };
  const names = Object.keys(files);
  if (names.length === 0) return { ok: false };
  const map: Files = new Map();
  for (const name of names) {
    const text = files[name];
    if (typeof text !== 'string' || !isRelativePath(name)) return { ok: false };
    map.set(name, text);
  }
  for (const name of names) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) if (map.has(parts.slice(0, i).join('/'))) return { ok: false };
  }
  let entry = '';
  if (Object.hasOwn(input, 'entry')) {
    const e = input.entry;
    if (typeof e !== 'string' || (e !== '.' && !isRelativePath(e))) return { ok: false };
    entry = e === '.' ? '' : e;
  }
  return { ok: true, files: map, entry };
}

export async function handleLine(line: string): Promise<Response> {
  let req: unknown;
  try {
    req = JSON.parse(line);
  } catch {
    return { id: null, error: 'bad_request' };
  }
  if (!isObject(req) || typeof req.id !== 'string' || !Object.hasOwn(req, 'id')) return { id: null, error: 'bad_request' };
  const id = req.id;
  if (req.op !== 'check' && req.op !== 'cases') return { id, error: 'unknown_op' };
  const v = validateInput(req.input);
  if (!v.ok) return { id, error: 'bad_request' };
  try {
    const result = req.op === 'check' ? await check(v.files, v.entry) : await cases(v.files, v.entry);
    return { id, result };
  } catch (e) {
    process.stderr.write(`internal error on request ${JSON.stringify(id)}: ${(e as Error)?.stack ?? e}\n`);
    return { id, error: 'internal_error' };
  }
}

/** Whether a request line gets no response: empty, or only spaces and tabs. */
export function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}
