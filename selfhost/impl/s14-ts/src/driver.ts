import { pathToFileURL } from 'node:url';
import { analyze, buildCases, formatDiag } from './checker.ts';
import { judge, validateCase } from './judge.ts';
import { hasOwn, isPlainObject } from './util.ts';

type Obj = Record<string, unknown>;

function validName(name: string): boolean {
  if (name.includes('\\') || name.includes('\0') || /^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
}

function validFiles(files: unknown): files is Record<string, string> {
  if (!isPlainObject(files)) return false;
  const names = Object.keys(files);
  if (names.length === 0) return false;
  for (const n of names) {
    if (typeof files[n] !== 'string' || !validName(n)) return false;
  }
  for (const n of names) {
    const parts = n.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (hasOwn(files, parts.slice(0, i).join('/'))) return false;
    }
  }
  return true;
}

export function handle(line: string): Obj {
  let req: unknown;
  try {
    req = JSON.parse(line);
  } catch {
    return { id: null, error: 'bad_request' };
  }
  if (!isPlainObject(req) || typeof req.id !== 'string') return { id: null, error: 'bad_request' };
  const id = req.id;
  const op = req.op;
  if (op !== 'check' && op !== 'cases' && op !== 'judge') return { id, error: 'unknown_op' };
  const input = req.input;
  if (!isPlainObject(input)) return { id, error: 'bad_request' };
  try {
    if (op === 'judge') {
      if (!hasOwn(input, 'case') || !hasOwn(input, 'answer')) return { id, error: 'bad_request' };
      const c = validateCase(input.case);
      const answer = input.answer;
      if (c === null || !(answer === null || isPlainObject(answer))) return { id, error: 'bad_request' };
      const failed = judge(c, answer);
      return { id, result: failed.length === 0 ? { pass: true } : { pass: false, failed } };
    }
    if (!validFiles(input.files)) return { id, error: 'bad_request' };
    let entry: string | undefined;
    if (hasOwn(input, 'entry')) {
      if (typeof input.entry !== 'string' || (input.entry !== '.' && !validName(input.entry))) {
        return { id, error: 'bad_request' };
      }
      entry = input.entry;
    }
    const a = analyze(input.files, entry);
    if (op === 'check') {
      return {
        id,
        result: { diagnostics: a.diags.map(formatDiag), errors: a.errors, warnings: a.warnings },
      };
    }
    return { id, result: { errors: a.errors, cases: a.errors === 0 ? buildCases(a) : [] } };
  } catch (e) {
    process.stderr.write(`internal error: ${e instanceof Error ? e.stack : String(e)}\n`);
    return { id, error: 'internal_error' };
  }
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const out: string[] = [];
  for (const line of lines) {
    if (/^[ \t\r]*$/.test(line)) continue;
    out.push(JSON.stringify(handle(line)) + '\n');
  }
  await new Promise<void>((resolve) => process.stdout.write(out.join(''), () => resolve()));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
