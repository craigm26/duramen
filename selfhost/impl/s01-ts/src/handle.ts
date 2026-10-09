import { analyze } from './checker.ts';
import { isObj } from './util.ts';

function validName(n: string): boolean {
  if (n.includes('\\') || n.includes('\0') || /^[A-Za-z]:/.test(n)) return false;
  return n.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
}

/** Handles one non-blank request line; returns the response object. */
export function handleLine(line: string): Record<string, unknown> {
  let req: unknown;
  try {
    req = JSON.parse(line);
  } catch {
    return { id: null, error: 'bad_request' };
  }
  if (!isObj(req) || typeof req.id !== 'string') return { id: null, error: 'bad_request' };
  const id = req.id;
  if (req.op !== 'check' && req.op !== 'cases') return { id, error: 'unknown_op' };
  const input = req.input;
  if (!isObj(input)) return { id, error: 'bad_request' };
  const files = input.files;
  if (!isObj(files)) return { id, error: 'bad_request' };
  const names = Object.keys(files);
  if (names.length === 0) return { id, error: 'bad_request' };
  for (const n of names) if (typeof files[n] !== 'string' || !validName(n)) return { id, error: 'bad_request' };
  const nameSet = new Set(names);
  for (const n of names) {
    const parts = n.split('/');
    for (let i = 1; i < parts.length; i++) if (nameSet.has(parts.slice(0, i).join('/'))) return { id, error: 'bad_request' };
  }
  let entry: string | undefined;
  if (Object.hasOwn(input, 'entry')) {
    const e = input.entry;
    if (typeof e !== 'string' || (e !== '.' && !validName(e))) return { id, error: 'bad_request' };
    entry = e;
  }
  try {
    const a = analyze(files as Record<string, string>, entry);
    if (req.op === 'check') {
      return { id, result: { diagnostics: a.diagnostics, errors: a.errors, warnings: a.warnings } };
    }
    return { id, result: { errors: a.errors, cases: a.errors > 0 ? [] : a.cases } };
  } catch (e) {
    process.stderr.write(`internal error: ${e instanceof Error ? e.stack : String(e)}\n`);
    return { id, error: 'internal_error' };
  }
}
