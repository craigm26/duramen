// Running examples through the oracle (REQ-OR-002 to REQ-OR-008, REQ-SU-003).

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { allExamples, expectsError, firstOps } from './checks.ts';
import type { Diag, Example, RecordModel } from './model.ts';
import { ecmaOrder, hasNonFinite, hasOwn, isObject, jsonEqual, parseJson, readPath, type JsonObject } from './util.ts';

/** How long one run of the oracle may take (OPEN-RQ-001); the environment may shorten it. */
const ORACLE_TIMEOUT_MS = Number(process.env.DURAMEN_ORACLE_TIMEOUT_MS) || 60_000;

export function caseId(ex: Example): string {
  return `${ex.req.id}#${ex.n}`;
}

/** An example that is raw or leaves out `id` is sent alone (REQ-OR-002). */
export function isSolo(ex: Example): boolean {
  return ex.raw || ex.omit.includes('id');
}

/** The request line of an example (REQ-SU-003). */
export function requestLine(ex: Example, rec: RecordModel): string {
  if (ex.raw) return ex.rawLine!;
  const op = firstOps(rec).get(ex.op!);
  const base = op?.request ?? rec.specRequest ?? {};
  const members = new Map<string, unknown>();
  for (const k of Object.keys(base)) members.set(k, base[k]);
  if (ex.request) for (const k of Object.keys(ex.request)) members.set(k, ex.request[k]);
  const omit = new Set(ex.omit);
  const parts: string[] = [];
  if (!omit.has('id')) parts.push('"id":' + JSON.stringify(caseId(ex)));
  if (!omit.has('op')) parts.push('"op":' + JSON.stringify(ex.op));
  for (const k of ecmaOrder([...members.keys()])) {
    if (!omit.has(k)) parts.push(JSON.stringify(k) + ':' + JSON.stringify(members.get(k)));
  }
  if (ex.hasInput && !omit.has('input')) {
    parts.push('"input":' + (ex.inputLines ? JSON.stringify(ex.input) : ex.inputText!));
  }
  return '{' + parts.join(',') + '}';
}

/** Splits an oracle command into words (REQ-OR-002); undefined when a quote is not closed. */
export function splitCommand(s: string): string[] | undefined {
  const out: string[] = [];
  let cur = '';
  let inWord = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ' || ch === '\t') {
      if (inWord) out.push(cur);
      cur = '';
      inWord = false;
      i++;
      continue;
    }
    inWord = true;
    if (ch === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && s[i + 1] === '"') {
          cur += '"';
          i += 2;
        } else cur += s[i++];
      }
      if (i >= s.length) return undefined;
      i++;
    } else if (ch === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) return undefined;
      cur += s.slice(i + 1, j);
      i = j + 1;
    } else {
      cur += ch;
      i++;
    }
  }
  if (inWord) out.push(cur);
  return out;
}

interface Run {
  failed: boolean;
  /** The lines the oracle wrote, without lines of white space only. */
  lines: string[];
}

function runOnce(argv: string[] | undefined, cwd: string, input: string): Promise<Run> {
  return new Promise((resolve) => {
    if (!argv || argv.length === 0) {
      resolve({ failed: true, lines: [] });
      return;
    }
    const chunks: Buffer[] = [];
    let failed = false;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const text = Buffer.concat(chunks).toString('utf8');
      resolve({ failed, lines: text.split('\n').filter((l) => !/^\s*$/.test(l)) });
    };
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      resolve({ failed: true, lines: [] });
      return;
    }
    const timer = setTimeout(() => {
      failed = true;
      child.kill('SIGKILL');
      // A process the oracle started may hold its output open; stop waiting for it.
      setTimeout(finish, 1000).unref();
    }, ORACLE_TIMEOUT_MS);
    child.on('error', () => {
      failed = true;
      finish();
    });
    child.stdout.on('data', (b: Buffer) => chunks.push(b));
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('close', (code, signal) => {
      if (code !== 0 || signal !== null) failed = true;
      finish();
    });
    child.stdin.end(input);
  });
}

/** A response line: a JSON object holding no number too large to be finite. */
function response(line: string): JsonObject | undefined {
  const v = parseJson(line);
  if (!v || !isObject(v.value) || hasNonFinite(v.value)) return undefined;
  return v.value;
}

function writeFiles(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'duramen-'));
  for (const name of Object.keys(files)) {
    try {
      const target = join(root, ...name.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, files[name], 'utf8');
    } catch {
      // Names a file system cannot hold are open (OPEN-RQ-003).
    }
  }
  return root;
}

/**
 * Runs the examples of a record through its oracle and reports where they disagree.
 * Answers each run example's response.
 */
export async function runExamples(
  rec: RecordModel,
  files: Record<string, string>,
  diags: Diag[],
): Promise<Map<Example, JsonObject>> {
  const responses = new Map<Example, JsonObject>();
  const oracle = rec.oracle;
  if (!oracle) return responses;
  const ops = firstOps(rec);
  const run = allExamples(rec).filter((ex) => ex.raw || expectsError(ex) || ops.has(ex.op!));
  if (run.length === 0) return responses;

  const root = writeFiles(files);
  try {
    const cwd = join(root, ...oracle.file.split('/').slice(0, -1));
    const argv = splitCommand(oracle.command);
    const batch = run.filter((ex) => !isSolo(ex));
    const solos = run.filter(isSolo);
    const jobs: Promise<void>[] = [];
    if (batch.length > 0) {
      const input = batch.map((ex) => requestLine(ex, rec) + '\n').join('');
      jobs.push(
        runOnce(argv, cwd, input).then((r) => {
          if (r.failed) diags.push({ file: oracle.file, line: oracle.line, level: 'error', code: 'T020' });
          const byId = new Map<string, JsonObject>();
          for (const line of r.lines) {
            const resp = response(line);
            if (resp && typeof resp.id === 'string' && !byId.has(resp.id)) byId.set(resp.id, resp);
          }
          for (const ex of batch) {
            const resp = byId.get(caseId(ex));
            if (resp) responses.set(ex, resp);
          }
        }),
      );
    }
    for (const ex of solos) {
      jobs.push(
        runOnce(argv, cwd, requestLine(ex, rec) + '\n').then((r) => {
          if (r.failed) diags.push({ file: ex.file, line: ex.line, level: 'error', code: 'T020' });
          const resp = r.lines.length === 1 ? response(r.lines[0]) : undefined;
          if (resp) responses.set(ex, resp);
        }),
      );
    }
    await Promise.all(jobs);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  for (const ex of run) {
    const resp = responses.get(ex);
    const d = (line: number, code: string, level: 'error' | 'warning' = 'error') =>
      diags.push({ file: ex.file, line, level, code });
    if (!resp) {
      d(ex.line, 'T021');
      continue;
    }
    if (hasOwn(resp, 'oracle_error')) {
      d(ex.line, 'T022');
      continue;
    }
    for (const e of ex.expects) {
      const got = readPath(resp, e.path);
      if (e.kind === 'oracle') {
        if (!got) d(e.line, 'T025');
      } else if (e.kind === 'eq') {
        if (!got || !jsonEqual(got.value, e.value)) d(e.line, 'T002');
      } else if (!got || typeof got.value !== 'number' || !(Math.abs(got.value - (e.value as number)) <= e.tol!)) {
        d(e.line, 'T002');
      }
    }
    if (ex.expects.length === 0 && hasOwn(resp, 'error')) d(ex.line, 'T024', 'warning');
  }
  return responses;
}
