// One request line in, one response out (Interface: Driver protocol, Operations, Errors).

import { cases, check } from './check.ts';
import { judge, validJudgeInput } from './judge.ts';
import { hasOwn, isObject, parseJson, type JsonObject } from './util.ts';

type Response = { id: string | null; result?: unknown; error?: string };

/** A relative path, as REQ-RQ-001 defines one. */
export function isRelativePath(name: string): boolean {
  if (name === '' || name.includes('\\') || name.includes('\0') || /^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
}

function validFiles(input: JsonObject): boolean {
  const files = input.files;
  if (!isObject(files)) return false;
  const names = Object.keys(files);
  if (names.length === 0) return false;
  const folders = new Set<string>();
  for (const name of names) {
    if (typeof files[name] !== 'string' || !isRelativePath(name)) return false;
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  if (names.some((n) => folders.has(n))) return false;
  if (hasOwn(input, 'entry')) {
    const e = input.entry;
    if (typeof e !== 'string' || (e !== '.' && !isRelativePath(e))) return false;
  }
  return true;
}

export async function handle(line: string): Promise<Response> {
  const parsed = parseJson(line);
  if (!parsed || !isObject(parsed.value) || typeof parsed.value.id !== 'string') {
    return { id: null, error: 'bad_request' };
  }
  const req = parsed.value;
  const id = req.id as string;
  const op = req.op;
  if (op !== 'check' && op !== 'cases' && op !== 'judge') return { id, error: 'unknown_op' };
  const input = req.input;
  if (!isObject(input)) return { id, error: 'bad_request' };
  if (op === 'judge') {
    if (!validJudgeInput(input)) return { id, error: 'bad_request' };
    return { id, result: judge(input) };
  }
  if (!validFiles(input)) return { id, error: 'bad_request' };
  const files = input.files as Record<string, string>;
  const entry = input.entry as string | undefined;
  try {
    return { id, result: op === 'check' ? await check(files, entry) : await cases(files, entry) };
  } catch (e) {
    process.stderr.write(`internal error on request ${JSON.stringify(id)}: ${(e as Error)?.stack ?? e}\n`);
    return { id, error: 'internal_error' };
  }
}
