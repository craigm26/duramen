// Handling one request line: validation and the three operations.
import { analyze, buildCases, formatDiag } from './check.ts';
import { judge, validJudgeInput } from './judge.ts';
import { has, isObject, validRelativePath } from './util.ts';

type Reply = { id: string | null; result?: any; error?: string };

export function handleLine(line: string): Reply {
  let req: any;
  try {
    req = JSON.parse(line);
  } catch {
    return { id: null, error: 'bad_request' };
  }
  if (!isObject(req) || typeof req.id !== 'string') return { id: null, error: 'bad_request' };
  const id: string = req.id;
  if (req.op !== 'check' && req.op !== 'cases' && req.op !== 'judge') return { id, error: 'unknown_op' };
  const input = req.input;
  if (!isObject(input)) return { id, error: 'bad_request' };
  if (req.op === 'judge') {
    if (!has(input, 'case') || !has(input, 'answer') || !validJudgeInput(input.case, input.answer, true)) {
      return { id, error: 'bad_request' };
    }
    return { id, result: judge(input.case, input.answer) };
  }
  const files = input.files;
  if (!isObject(files)) return { id, error: 'bad_request' };
  const names = Object.keys(files);
  if (names.length === 0) return { id, error: 'bad_request' };
  for (const nm of names) {
    if (typeof files[nm] !== 'string' || !validRelativePath(nm)) return { id, error: 'bad_request' };
  }
  const nameSet = new Set(names);
  for (const nm of names) {
    const parts = nm.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (nameSet.has(parts.slice(0, i).join('/'))) return { id, error: 'bad_request' };
    }
  }
  let entry: string | undefined;
  if (has(input, 'entry')) {
    if (typeof input.entry !== 'string' || (input.entry !== '.' && !validRelativePath(input.entry))) {
      return { id, error: 'bad_request' };
    }
    entry = input.entry;
  }
  let a;
  try {
    a = analyze(files, entry);
  } catch (e) {
    process.stderr.write(String((e as any)?.stack ?? e) + '\n');
    return { id, error: 'internal_error' };
  }
  if (req.op === 'check') {
    return { id, result: { diagnostics: a.diags.map(formatDiag), errors: a.errors, warnings: a.warnings } };
  }
  try {
    return { id, result: { errors: a.errors, cases: a.errors === 0 ? buildCases(a) : [] } };
  } catch (e) {
    process.stderr.write(String((e as any)?.stack ?? e) + '\n');
    return { id, error: 'internal_error' };
  }
}
