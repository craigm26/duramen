import { analyse } from './check.ts';
import { hasOwn, isObject } from './common.ts';

export function validName(n: string): boolean {
  if (n.includes('\\') || n.includes('\0')) return false;
  if (/^[A-Za-z]:/.test(n)) return false;
  return n.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
}

// Answers one non-blank request line with the response object.
export function handle(line: string): Record<string, unknown> {
  let req: unknown;
  try {
    req = JSON.parse(line);
  } catch {
    return { id: null, error: 'bad_request' };
  }
  if (!isObject(req) || typeof req.id !== 'string') return { id: null, error: 'bad_request' };
  const id = req.id;
  if (req.op !== 'check' && req.op !== 'cases') return { id, error: 'unknown_op' };
  const input = req.input;
  if (!isObject(input)) return { id, error: 'bad_request' };
  const files = input.files;
  if (!isObject(files)) return { id, error: 'bad_request' };
  const names = Object.keys(files);
  if (names.length === 0) return { id, error: 'bad_request' };
  for (const n of names) {
    if (typeof files[n] !== 'string' || !validName(n)) return { id, error: 'bad_request' };
  }
  for (const n of names) {
    const parts = n.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (hasOwn(files, parts.slice(0, i).join('/'))) return { id, error: 'bad_request' };
    }
  }
  let entry: string | undefined;
  if (hasOwn(input, 'entry')) {
    const e = input.entry;
    if (typeof e !== 'string' || (e !== '.' && !validName(e))) return { id, error: 'bad_request' };
    entry = e;
  }
  try {
    const a = analyse(files as Record<string, string>, entry);
    const errors = a.diags.filter((d) => d.level === 'error').length;
    if (req.op === 'cases') return { id, result: { errors, cases: a.cases } };
    const warnings = a.diags.filter((d) => d.level === 'warning').length;
    return {
      id,
      result: {
        diagnostics: a.diags.map((d) => `${d.file}:${d.line}: ${d.level} ${d.code}`),
        errors,
        warnings,
      },
    };
  } catch (e) {
    process.stderr.write(`internal error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    return { id, error: 'internal_error' };
  }
}

export function serve(text: string): string {
  let out = '';
  for (const line of text.split('\n')) {
    if (/^[ \t]*$/.test(line)) continue;
    out += JSON.stringify(handle(line)) + '\n';
  }
  return out;
}
