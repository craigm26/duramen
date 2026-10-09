import { isPlainObject } from './json.ts';
import { analyze } from './checker.ts';

function isRelativePath(name: string): boolean {
  if (name.includes('\\') || name.includes('\0') || /^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
}

function validate(input: unknown): { files: Record<string, string>; entry: string | undefined } | null {
  if (!isPlainObject(input)) return null;
  const files = input.files;
  if (!isPlainObject(files)) return null;
  const names = Object.keys(files);
  if (names.length === 0) return null;
  const set = new Set(names);
  for (const n of names) {
    if (typeof files[n] !== 'string' || !isRelativePath(n)) return null;
    const parts = n.split('/');
    for (let i = 1; i < parts.length; i++) if (set.has(parts.slice(0, i).join('/'))) return null;
  }
  const entry = input.entry;
  if (entry !== undefined && !(typeof entry === 'string' && (entry === '.' || isRelativePath(entry)))) return null;
  return { files: files as Record<string, string>, entry };
}

/** Answers one request line; null for a blank line. */
export function handleLine(line: string): string | null {
  if (/^[ \t]*$/.test(line)) return null;
  let req: unknown;
  try {
    req = JSON.parse(line);
  } catch {
    return JSON.stringify({ id: null, error: 'bad_request' });
  }
  if (!isPlainObject(req) || typeof req.id !== 'string') return JSON.stringify({ id: null, error: 'bad_request' });
  const id = req.id;
  if (req.op !== 'check' && req.op !== 'cases') return JSON.stringify({ id, error: 'unknown_op' });
  const v = validate(req.input);
  if (v === null) return JSON.stringify({ id, error: 'bad_request' });
  try {
    const a = analyze(v.files, v.entry);
    const errors = a.diags.filter((d) => d.level === 'error').length;
    if (req.op === 'check') {
      const warnings = a.diags.filter((d) => d.level === 'warning').length;
      const diagnostics = a.diags.map((d) => `${d.file}:${d.line}: ${d.level} ${d.code}`);
      return JSON.stringify({ id, result: { diagnostics, errors, warnings } });
    }
    return JSON.stringify({ id, result: { errors, cases: errors > 0 ? [] : (a.cases ?? []) } });
  } catch (e) {
    process.stderr.write(`internal error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    return JSON.stringify({ id, error: 'internal_error' });
  }
}
