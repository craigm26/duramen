// One request line in, one response out (the driver protocol, REQ-RQ-001, REQ-RQ-002).

import { buildCases, checkRecord, countLevel } from './check.ts';
import { formatDiag } from './diag.ts';
import { hasOwn, isPlainObject } from './json.ts';
import type { JsonObject } from './json.ts';
import { judge, validJudgeInput } from './judge.ts';

/** A relative path: parts separated by `/`, none empty, `.` or `..` (REQ-RQ-001). */
export function isRelativePath(name: string): boolean {
  if (name === '' || name.includes('\\') || name.includes('\0') || /^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
}

function validRecordInput(input: JsonObject): boolean {
  const files = input.files;
  if (!hasOwn(input, 'files') || !isPlainObject(files)) return false;
  const names = Object.keys(files);
  if (names.length === 0) return false;
  if (!names.every((n) => typeof files[n] === 'string' && isRelativePath(n))) return false;
  const set = new Set(names);
  for (const n of names) {
    const parts = n.split('/');
    for (let i = 1; i < parts.length; i++) if (set.has(parts.slice(0, i).join('/'))) return false;
  }
  if (hasOwn(input, 'entry')) {
    const entry = input.entry;
    if (typeof entry !== 'string' || (entry !== '.' && !isRelativePath(entry))) return false;
  }
  return true;
}

const OPS = new Set(['check', 'cases', 'judge']);

export async function handleLine(line: string): Promise<JsonObject> {
  let req: unknown;
  try {
    req = JSON.parse(line);
  } catch {
    return { id: null, error: 'bad_request' };
  }
  if (!isPlainObject(req) || typeof req.id !== 'string' || !hasOwn(req, 'id')) return { id: null, error: 'bad_request' };
  const id = req.id;
  const op = req.op;
  if (typeof op !== 'string' || !OPS.has(op)) return { id, error: 'unknown_op' };
  const input = req.input;
  if (!hasOwn(req, 'input') || !isPlainObject(input)) return { id, error: 'bad_request' };
  if (op === 'judge') {
    if (!validJudgeInput(input)) return { id, error: 'bad_request' };
    return { id, result: judge(input) };
  }
  if (!validRecordInput(input)) return { id, error: 'bad_request' };
  const filesObj = input.files as JsonObject;
  const files = new Map(Object.keys(filesObj).map((k) => [k, filesObj[k] as string]));
  const entry = hasOwn(input, 'entry') ? (input.entry as string) : '.';
  const outcome = await checkRecord(files, entry);
  const errors = countLevel(outcome.diagnostics, 'error');
  if (op === 'check') {
    return {
      id,
      result: {
        diagnostics: outcome.diagnostics.map(formatDiag),
        errors,
        warnings: countLevel(outcome.diagnostics, 'warning'),
      },
    };
  }
  return { id, result: { errors, cases: errors === 0 ? buildCases(outcome) : [] } };
}
