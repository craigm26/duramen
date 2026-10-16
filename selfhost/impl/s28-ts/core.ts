import { judge, object, own, validJudge } from './comparison.ts';
import { checkRecord } from './checker.ts';

export function relativePath(name: string): boolean {
  return !!name && !/[\\\0]/.test(name) && !/^[A-Za-z]:/.test(name) && name.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}
export function handle(request: any): any {
  if (!object(request) || typeof request.id !== 'string') return { id: null, error: 'bad_request' };
  const id = request.id, op = request.op;
  if (!['check', 'cases', 'judge'].includes(op)) return { id, error: 'unknown_op' };
  const input = request.input;
  const bad = () => ({ id, error: 'bad_request' });
  if (!object(input)) return bad();
  if (op === 'judge') {
    if (!validJudge(input)) return bad();
    return { id, result: judge(input.case, input.answer) };
  }
  if (!object(input.files) || !Object.keys(input.files).length) return bad();
  const names = Object.keys(input.files);
  if (names.some(name => !relativePath(name) || typeof input.files[name] !== 'string')) return bad();
  const nameSet = new Set(names);
  if (names.some(name => { const parts = name.split('/'); parts.pop(); while (parts.length) { if (nameSet.has(parts.join('/'))) return true; parts.pop(); } return false; })) return bad();
  if (own(input, 'entry') && (typeof input.entry !== 'string' || (input.entry !== '.' && !relativePath(input.entry)))) return bad();
  const checked = checkRecord(input.files, input.entry ?? '.');
  return { id, result: op === 'check' ? checked.result : { errors: checked.result.errors, cases: checked.cases } };
}
export function handleLine(line: string): any {
  let request;
  try { request = JSON.parse(line); } catch { return { id: null, error: 'bad_request' }; }
  try { return handle(request); }
  catch (error) { console.error(error); return { id: typeof request?.id === 'string' ? request.id : null, error: 'internal_error' }; }
}
