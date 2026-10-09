// One request line in, one response line out (Driver protocol, Errors, REQ-RQ-001, REQ-RQ-002).

import { checkRecord } from './check.ts';
import type { Diag } from './model.ts';
import { loadRecord } from './record.ts';
import { buildCases } from './suite.ts';
import { judge, validJudgeInput } from './judge.ts';
import { cmpStr, hasOwn, isObject } from './util.ts';
import type { Obj } from './util.ts';

function validName(name: string): boolean {
  if (name.includes('\\') || name.includes('\0') || /^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
}

interface RecordInput {
  files: Map<string, string>;
  entry: string | undefined;
}

function recordInput(input: Obj): RecordInput | null {
  const f = input.files;
  if (!isObject(f)) return null;
  const names = Object.keys(f);
  if (names.length === 0) return null;
  const files = new Map<string, string>();
  for (const n of names) {
    const v = f[n];
    if (typeof v !== 'string' || !validName(n)) return null;
    files.set(n, v);
  }
  for (const n of names) {
    let i = n.indexOf('/');
    while (i >= 0) {
      if (files.has(n.slice(0, i))) return null;
      i = n.indexOf('/', i + 1);
    }
  }
  let entry: string | undefined;
  if (hasOwn(input, 'entry')) {
    const e = input.entry;
    if (typeof e !== 'string' || (e !== '.' && !validName(e))) return null;
    entry = e;
  }
  return { files, entry };
}

const LEVELS = ['error', 'warning', 'info'];

export function diagnose(ri: RecordInput): { diags: Diag[]; run: ReturnType<typeof checkRecord> | null; rec: ReturnType<typeof loadRecord>['rec'] } {
  const { rec, diags } = loadRecord(ri.files, ri.entry);
  let run: ReturnType<typeof checkRecord> | null = null;
  let all = diags;
  if (diags.length === 0) {
    run = checkRecord(rec);
    all = run.diags;
  }
  all = [...all].sort(
    (a, b) =>
      cmpStr(a.file, b.file) ||
      a.line - b.line ||
      cmpStr(a.code, b.code) ||
      LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level),
  );
  return { diags: all, run, rec };
}

const text = (d: Diag): string => `${d.file}:${d.line}: ${d.level} ${d.code}`;

function handle(op: string, input: Obj): { result: Obj } | { error: string } {
  if (op === 'judge') {
    if (!validJudgeInput(input)) return { error: 'bad_request' };
    return { result: judge(input) };
  }
  const ri = recordInput(input);
  if (!ri) return { error: 'bad_request' };
  const { diags, run, rec } = diagnose(ri);
  const errors = diags.filter((d) => d.level === 'error').length;
  if (op === 'check') {
    return {
      result: { diagnostics: diags.map(text), errors, warnings: diags.filter((d) => d.level === 'warning').length },
    };
  }
  const cases = errors === 0 && run ? buildCases(rec, run.responses, run.ops) : [];
  return { result: { errors, cases } };
}

// Returns the response line, or null for a blank line.
export function handleLine(line: string): string | null {
  if (line.endsWith('\r')) line = line.slice(0, -1);
  if (/^[ \t]*$/.test(line)) return null;
  let req: unknown;
  try {
    req = JSON.parse(line);
  } catch {
    return JSON.stringify({ id: null, error: 'bad_request' });
  }
  if (!isObject(req) || typeof req.id !== 'string') return JSON.stringify({ id: null, error: 'bad_request' });
  const id = req.id;
  if (req.op !== 'check' && req.op !== 'cases' && req.op !== 'judge') {
    return JSON.stringify({ id, error: 'unknown_op' });
  }
  if (!isObject(req.input)) return JSON.stringify({ id, error: 'bad_request' });
  try {
    return JSON.stringify({ id, ...handle(req.op, req.input) });
  } catch (e) {
    process.stderr.write(`internal error: ${e instanceof Error ? e.stack : String(e)}\n`);
    return JSON.stringify({ id, error: 'internal_error' });
  }
}
