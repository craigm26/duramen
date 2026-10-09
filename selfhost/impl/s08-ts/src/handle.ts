import { type Obj, hasOwn, isPlainObject } from './util.ts';
import { analyze, formatDiag, sortDiags } from './analyze.ts';

export function validName(name: string): boolean {
  if (name.includes('\\') || name.includes('\0') || /^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
}

// Handles one non-blank request line; returns the response object.
export function handleLine(line: string): Obj {
  let req: unknown;
  try { req = JSON.parse(line); } catch { return { id: null, error: 'bad_request' }; }
  if (!isPlainObject(req) || typeof req.id !== 'string') return { id: null, error: 'bad_request' };
  const id = req.id;
  if (req.op !== 'check' && req.op !== 'cases') return { id, error: 'unknown_op' };
  const input = req.input;
  if (!isPlainObject(input)) return { id, error: 'bad_request' };
  const files = input.files;
  if (!isPlainObject(files)) return { id, error: 'bad_request' };
  const names = Object.keys(files);
  if (names.length === 0) return { id, error: 'bad_request' };
  const set = new Set(names);
  for (const n of names) {
    if (typeof files[n] !== 'string' || !validName(n)) return { id, error: 'bad_request' };
    for (let i = n.indexOf('/'); i >= 0; i = n.indexOf('/', i + 1)) {
      if (set.has(n.slice(0, i))) return { id, error: 'bad_request' };
    }
  }
  let entry: string | undefined;
  if (hasOwn(input, 'entry')) {
    const e = input.entry;
    if (typeof e !== 'string' || (e !== '.' && !validName(e))) return { id, error: 'bad_request' };
    entry = e;
  }
  try {
    const a = analyze(files as Record<string, string>, entry, req.op === 'cases');
    const diags = sortDiags(a.diags);
    const errors = diags.filter((d) => d.level === 'error').length;
    if (req.op === 'check') {
      const warnings = diags.filter((d) => d.level === 'warning').length;
      return { id, result: { diagnostics: diags.map(formatDiag), errors, warnings } };
    }
    return { id, result: { errors, cases: errors === 0 ? a.cases ?? [] : [] } };
  } catch (e) {
    process.stderr.write(`internal error: ${e instanceof Error ? e.stack : String(e)}\n`);
    return { id, error: 'internal_error' };
  }
}
