import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasNonFinite, isPlainObject } from './util.ts';

/** Splits an oracle command into words (REQ-OR-002); null when a quote is not closed. */
export function splitCommand(s: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  const n = s.length;
  const sep = (c: string) => c === ' ' || c === '\t';
  for (;;) {
    while (i < n && sep(s[i])) i++;
    if (i >= n) break;
    let w = '';
    while (i < n && !sep(s[i])) {
      const c = s[i];
      if (c === '"') {
        i++;
        for (;;) {
          if (i >= n) return null;
          if (s[i] === '\\' && s[i + 1] === '"') {
            w += '"';
            i += 2;
          } else if (s[i] === '"') {
            i++;
            break;
          } else w += s[i++];
        }
      } else if (c === "'") {
        i++;
        for (;;) {
          if (i >= n) return null;
          if (s[i] === "'") {
            i++;
            break;
          }
          w += s[i++];
        }
      } else {
        w += c;
        i++;
      }
    }
    out.push(w);
  }
  return out;
}

export interface Sandbox {
  root: string;
  cleanup: () => void;
}

export function makeSandbox(files: Record<string, string>): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'duramen-'));
  for (const [name, text] of Object.entries(files)) {
    try {
      const p = join(root, ...name.split('/'));
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, text);
    } catch {
      // a name the file system cannot hold (OPEN-RQ-003)
    }
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export interface RunResult {
  stdout: string;
  failed: boolean;
}

const TIMEOUT_MS = 20000;

export function runOracle(command: string, cwd: string, input: string): RunResult {
  const ws = splitCommand(command);
  if (ws === null || ws.length === 0) return { stdout: '', failed: true };
  const prog = ws[0] === 'node' ? process.execPath : ws[0];
  const r = spawnSync(prog, ws.slice(1), {
    cwd,
    input,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 1 << 28,
  });
  const stdout = typeof r.stdout === 'string' ? r.stdout : '';
  const failed = r.error !== undefined || r.status !== 0;
  return { stdout, failed };
}

type Obj = Record<string, unknown>;

function parseResponseLine(l: string): Obj | null {
  let v: unknown;
  try {
    v = JSON.parse(l);
  } catch {
    return null;
  }
  if (!isPlainObject(v) || hasNonFinite(v)) return null;
  return v;
}

/** Responses of a batch run, by `id` (the first of two wins). */
export function batchResponses(stdout: string): Map<string, Obj> {
  const m = new Map<string, Obj>();
  for (const l of stdout.split('\n')) {
    if (/^\s*$/.test(l)) continue;
    const o = parseResponseLine(l);
    if (o && typeof o.id === 'string' && !m.has(o.id)) m.set(o.id, o);
  }
  return m;
}

/** The one response of a run of a single request, or null. */
export function soloResponse(stdout: string): Obj | null {
  const ls = stdout.split('\n').filter((l) => !/^\s*$/.test(l));
  if (ls.length !== 1) return null;
  return parseResponseLine(ls[0]);
}
