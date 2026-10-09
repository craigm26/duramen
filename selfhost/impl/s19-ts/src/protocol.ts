// One request line in, one response object out (Interface, REQ-RQ-001, REQ-RQ-002).

import { checkRecord, formatDiag } from './check.ts';
import { hasOwn, isObject } from './json.ts';
import type { Obj } from './json.ts';
import { judge, validJudgeInput } from './judge.ts';

/** A relative path (REQ-RQ-001). */
export function isRelativePath(name: string): boolean {
  if (name.includes('\\') || name.includes('\0')) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
}

function validRecordInput(input: Obj): boolean {
  const files = input.files;
  if (!isObject(files)) return false;
  const names = Object.keys(files);
  if (names.length === 0) return false;
  for (const n of names) {
    if (typeof files[n] !== 'string' || !isRelativePath(n)) return false;
  }
  const set = new Set(names);
  for (const n of names) {
    const parts = n.split('/');
    for (let i = 1; i < parts.length; i++) if (set.has(parts.slice(0, i).join('/'))) return false;
  }
  if (hasOwn(input, 'entry')) {
    const e = input.entry;
    if (typeof e !== 'string' || (e !== '.' && !isRelativePath(e))) return false;
  }
  return true;
}

export async function handleLine(line: string): Promise<Obj> {
  let req: unknown;
  try {
    req = JSON.parse(line);
  } catch {
    return { id: null, error: 'bad_request' };
  }
  if (!isObject(req) || typeof req.id !== 'string' || !hasOwn(req, 'id')) return { id: null, error: 'bad_request' };
  const id = req.id;
  const op = req.op;
  if (op !== 'check' && op !== 'cases' && op !== 'judge') return { id, error: 'unknown_op' };
  const input = req.input;
  if (!isObject(input)) return { id, error: 'bad_request' };
  try {
    if (op === 'judge') {
      if (!validJudgeInput(input)) return { id, error: 'bad_request' };
      return { id, result: judge(input) };
    }
    if (!validRecordInput(input)) return { id, error: 'bad_request' };
    const outcome = await checkRecord({ files: input.files as Obj, entry: input.entry as string | undefined });
    const errors = outcome.diags.filter((d) => d.level === 'error').length;
    if (op === 'check') {
      const warnings = outcome.diags.filter((d) => d.level === 'warning').length;
      return { id, result: { diagnostics: outcome.diags.map(formatDiag), errors, warnings } };
    }
    return { id, result: { errors, cases: outcome.cases } };
  } catch (e) {
    process.stderr.write(`duramen-core: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    return { id, error: 'internal_error' };
  }
}
