import { runCheck } from './checker.ts';
import { judge, validJudgeInput } from './judge.ts';
import { hasOwn, isObj, validName } from './util.ts';

function validFiles(input: any): boolean {
  const files = input.files;
  if (!isObj(files)) return false;
  const names = Object.keys(files);
  if (names.length === 0) return false;
  const set = new Set(names);
  for (const n of names) {
    if (typeof files[n] !== 'string' || !validName(n)) return false;
    const parts = n.split('/');
    for (let i = 1; i < parts.length; i++) if (set.has(parts.slice(0, i).join('/'))) return false;
  }
  if (hasOwn(input, 'entry')) {
    const e = input.entry;
    if (typeof e !== 'string' || (e !== '.' && !validName(e))) return false;
  }
  return true;
}

// Answers one request line (not blank) with the response object.
export function handle(line: string): any {
  let req: any;
  try {
    req = JSON.parse(line);
  } catch {
    return { id: null, error: 'bad_request' };
  }
  if (!isObj(req) || typeof req.id !== 'string') return { id: null, error: 'bad_request' };
  const id = req.id;
  const op = req.op;
  if (op !== 'check' && op !== 'cases' && op !== 'judge') return { id, error: 'unknown_op' };
  const input = req.input;
  if (!isObj(input)) return { id, error: 'bad_request' };
  try {
    if (op === 'judge') {
      if (!validJudgeInput(input)) return { id, error: 'bad_request' };
      return { id, result: judge(input.case, input.answer) };
    }
    if (!validFiles(input)) return { id, error: 'bad_request' };
    const r = runCheck(input.files, hasOwn(input, 'entry') ? input.entry : undefined, op === 'cases');
    if (op === 'check') {
      const diagnostics = r.diags.map((d: any) => `${d.file}:${d.line}: ${d.level} ${d.code}`);
      return { id, result: { diagnostics, errors: r.errors, warnings: r.warnings } };
    }
    return { id, result: { errors: r.errors, cases: r.cases } };
  } catch (e) {
    process.stderr.write(String((e as any)?.stack ?? e) + '\n');
    return { id, error: 'internal_error' };
  }
}
