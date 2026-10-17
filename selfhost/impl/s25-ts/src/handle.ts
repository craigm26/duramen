// One request line in, one response out (the driver protocol and REQ-RQ-002).

import { analyze } from './check.ts';
import { BadRequest, judge } from './judge.ts';
import { hasOwn, isObj, validName } from './util.ts';

function validFiles(files: unknown): files is Record<string, string> {
  if (!isObj(files)) return false;
  const names = Object.keys(files);
  if (names.length === 0) return false;
  for (const n of names) {
    if (typeof files[n] !== 'string' || !validName(n)) return false;
  }
  const set = new Set(names);
  for (const n of names) {
    const parts = n.split('/');
    for (let i = 1; i < parts.length; i++) if (set.has(parts.slice(0, i).join('/'))) return false;
  }
  return true;
}

export async function handleLine(line: string): Promise<Record<string, unknown>> {
  let req: any;
  try {
    req = JSON.parse(line);
  } catch {
    return { id: null, error: 'bad_request' };
  }
  if (!isObj(req) || typeof req.id !== 'string') return { id: null, error: 'bad_request' };
  const id: string = req.id;
  const op = req.op;
  if (op !== 'check' && op !== 'cases' && op !== 'judge') return { id, error: 'unknown_op' };
  const input = req.input;
  if (!isObj(input)) return { id, error: 'bad_request' };
  try {
    if (op === 'judge') return { id, result: judge(input) };
    if (!validFiles(input.files)) return { id, error: 'bad_request' };
    let entry: string | undefined;
    if (hasOwn(input, 'entry')) {
      if (typeof input.entry !== 'string' || (input.entry !== '.' && !validName(input.entry))) {
        return { id, error: 'bad_request' };
      }
      entry = input.entry;
    }
    const out = await analyze(input.files, entry);
    if (op === 'check') {
      const diagnostics = out.diagnostics.map((x) => `${x.file}:${x.line}: ${x.level} ${x.code}`);
      return { id, result: { diagnostics, errors: out.errors, warnings: out.warnings } };
    }
    return { id, result: { errors: out.errors, cases: out.errors > 0 ? [] : out.cases } };
  } catch (e) {
    if (e instanceof BadRequest) return { id, error: 'bad_request' };
    process.stderr.write(String((e as Error)?.stack ?? e) + '\n');
    return { id, error: 'internal_error' };
  }
}
