// The driver protocol: one request line in, one response line out (Interface, REQ-RQ-002).

import { checkRecord } from './checker.ts';
import { getOwn, hasOwn, isObj } from './json.ts';
import { judge } from './judge.ts';

function validName(n: string): boolean {
  if (n.includes('\\') || n.includes('\0')) return false;
  if (/^[A-Za-z]:/.test(n)) return false;
  return n.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
}

function reply(id: string | null, key: 'result' | 'error', value: unknown): string {
  return JSON.stringify({ id, [key]: value });
}

export function handleLine(line: string): string | null {
  if (/^[ \t]*$/.test(line)) return null;
  let req: unknown;
  try {
    req = JSON.parse(line);
  } catch {
    return reply(null, 'error', 'bad_request');
  }
  if (!isObj(req) || typeof getOwn(req, 'id') !== 'string') return reply(null, 'error', 'bad_request');
  const id = getOwn(req, 'id') as string;
  const op = getOwn(req, 'op');
  if (op !== 'check' && op !== 'cases' && op !== 'judge') return reply(id, 'error', 'unknown_op');
  const input = getOwn(req, 'input');
  if (!isObj(input)) return reply(id, 'error', 'bad_request');
  try {
    if (op === 'judge') {
      if (!hasOwn(input, 'case') || !hasOwn(input, 'answer')) return reply(id, 'error', 'bad_request');
      const v = judge(getOwn(input, 'case'), getOwn(input, 'answer'));
      if (!v) return reply(id, 'error', 'bad_request');
      return reply(id, 'result', v);
    }
    const filesIn = getOwn(input, 'files');
    if (!isObj(filesIn)) return reply(id, 'error', 'bad_request');
    const names = Object.keys(filesIn);
    if (names.length === 0) return reply(id, 'error', 'bad_request');
    const files = new Map<string, string>();
    for (const n of names) {
      const v = getOwn(filesIn, n);
      if (typeof v !== 'string' || !validName(n)) return reply(id, 'error', 'bad_request');
      files.set(n, v);
    }
    for (const n of names) {
      const parts = n.split('/');
      for (let i = 1; i < parts.length; i++) {
        if (files.has(parts.slice(0, i).join('/'))) return reply(id, 'error', 'bad_request');
      }
    }
    let entry: string | undefined;
    if (hasOwn(input, 'entry')) {
      const e = getOwn(input, 'entry');
      if (typeof e !== 'string' || (e !== '.' && !validName(e))) return reply(id, 'error', 'bad_request');
      entry = e;
    }
    const out = checkRecord(files, entry);
    if (op === 'check') return reply(id, 'result', { diagnostics: out.diagnostics, errors: out.errors, warnings: out.warnings });
    return reply(id, 'result', { errors: out.errors, cases: out.cases });
  } catch (e) {
    process.stderr.write(String((e as Error)?.stack ?? e) + '\n');
    return reply(id, 'error', 'internal_error');
  }
}
