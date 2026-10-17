// Handling one request line (Driver protocol, Operations, Errors).

import { check } from './checker.ts';
import { judge, validJudgeInput } from './judge.ts';
import { cases } from './suite.ts';
import { hasOwn, isPlainObject } from './util.ts';

function validName(name: string): boolean {
  if (name.includes('\\') || name.includes('\0') || /^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
}

export function handle(req: any): any {
  if (!isPlainObject(req) || typeof req.id !== 'string') return { id: null, error: 'bad_request' };
  const id = req.id;
  if (req.op !== 'check' && req.op !== 'cases' && req.op !== 'judge') return { id, error: 'unknown_op' };
  const input = req.input;
  if (!isPlainObject(input)) return { id, error: 'bad_request' };
  try {
    if (req.op === 'judge') {
      if (!validJudgeInput(input.case, input.answer, hasOwn(input, 'answer'))) return { id, error: 'bad_request' };
      return { id, result: judge(input.case, input.answer) };
    }
    const files = input.files;
    if (!isPlainObject(files)) return { id, error: 'bad_request' };
    const names = Object.keys(files);
    if (names.length === 0) return { id, error: 'bad_request' };
    for (const n of names) if (typeof files[n] !== 'string' || !validName(n)) return { id, error: 'bad_request' };
    const set = new Set(names);
    for (const n of names) {
      const parts = n.split('/');
      for (let i = 1; i < parts.length; i++) if (set.has(parts.slice(0, i).join('/'))) return { id, error: 'bad_request' };
    }
    let entry: string | undefined;
    if (hasOwn(input, 'entry')) {
      if (typeof input.entry !== 'string' || (input.entry !== '.' && !validName(input.entry))) return { id, error: 'bad_request' };
      entry = input.entry;
    }
    return { id, result: req.op === 'check' ? check(files, entry) : cases(files, entry) };
  } catch (e) {
    process.stderr.write(String((e as any)?.stack ?? e) + '\n');
    return { id, error: 'internal_error' };
  }
}

export function respond(line: string): string | undefined {
  if (/^[ \t]*$/.test(line)) return undefined;
  let req: any;
  try {
    req = JSON.parse(line);
  } catch {
    req = undefined;
  }
  const out = handle(req);
  // U+2028 and U+2029 are escaped so that no reader splits the line there
  return JSON.stringify(out).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

