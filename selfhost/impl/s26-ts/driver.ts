import { pathToFileURL } from 'node:url';
import { analyze, casesResult, checkResult } from './checker.ts';
import { judge, object, own, validJudge } from './values.ts';

export function relative(name: string): boolean {
  return name.length > 0 && !/[\\\0]/.test(name) && !/^[A-Za-z]:/.test(name) && name.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}
export function handle(request: any): any {
  if (!object(request) || typeof request.id !== 'string') return { id: null, error: 'bad_request' };
  const id = request.id, op = request.op, input = request.input;
  if (!['check', 'cases', 'judge'].includes(op)) return { id, error: 'unknown_op' };
  const bad = { id, error: 'bad_request' };
  if (!object(input)) return bad;
  if (op === 'judge') return validJudge(input) ? { id, result: judge(input.case, input.answer) } : bad;
  if (!object(input.files) || !Object.keys(input.files).length) return bad;
  const names = Object.keys(input.files);
  if (names.some(name => !relative(name) || typeof input.files[name] !== 'string')) return bad;
  const set = new Set(names);
  for (const name of names) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) if (set.has(parts.slice(0, i).join('/'))) return bad;
  }
  if (own(input, 'entry') && (typeof input.entry !== 'string' || input.entry !== '.' && !relative(input.entry))) return bad;
  try {
    const record = analyze(input.files, input.entry ?? '.');
    return { id, result: op === 'check' ? checkResult(record) : casesResult(record) };
  } catch (error) {
    console.error(error);
    return { id, error: 'internal_error' };
  }
}
export function handleLine(line: string): any | undefined {
  if (/^\s*$/.test(line)) return;
  let request: any;
  try { request = JSON.parse(line); } catch { return { id: null, error: 'bad_request' }; }
  return handle(request);
}
export async function serve(): Promise<void> {
  process.stdin.setEncoding('utf8');
  let pending = '';
  const respond = (line: string): void => {
    const response = handleLine(line);
    if (response !== undefined) process.stdout.write(JSON.stringify(response) + '\n');
  };
  for await (const chunk of process.stdin) {
    pending += chunk;
    let end: number;
    while ((end = pending.indexOf('\n')) !== -1) { respond(pending.slice(0, end)); pending = pending.slice(end + 1); }
  }
  if (pending) respond(pending);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await serve();
