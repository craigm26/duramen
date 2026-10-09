import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { isPlainObject } from './json.ts';

export const ORACLE_TIMEOUT_MS = 10000;

/** Splits a command at spaces and tabs; `"…"` and `'…'` hold spaces. */
export function splitCommand(s: string): string[] {
  const words: string[] = [];
  let cur = '';
  let inWord = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === ' ' || ch === '\t') {
      if (inWord) words.push(cur);
      cur = '';
      inWord = false;
    } else if (ch === '"') {
      inWord = true;
      for (i++; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === '\\' && s[i + 1] === '"') i++;
        cur += s[i];
      }
    } else if (ch === "'") {
      inWord = true;
      for (i++; i < s.length && s[i] !== "'"; i++) cur += s[i];
    } else {
      inWord = true;
      cur += ch;
    }
  }
  if (inWord) words.push(cur);
  return words;
}

export interface RunResult {
  stdout: string;
  failed: boolean;
}

export class Workspace {
  private root: string | null = null;
  private files: Record<string, string>;

  constructor(files: Record<string, string>) {
    this.files = files;
  }

  private ensure(): string {
    if (this.root === null) {
      this.root = mkdtempSync(join(tmpdir(), 'duramen-'));
      for (const [name, text] of Object.entries(this.files)) {
        const p = join(this.root, ...name.split('/'));
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, text);
      }
    }
    return this.root;
  }

  run(command: string, folder: string, input: string): RunResult {
    const words = splitCommand(command);
    if (words.length === 0) return { stdout: '', failed: true };
    const root = this.ensure();
    const cwd = folder === '' ? root : join(root, ...folder.split('/'));
    const r = spawnSync(words[0], words.slice(1), {
      cwd, input, encoding: 'utf8', timeout: ORACLE_TIMEOUT_MS, maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'ignore'],
    });
    const err = r.error as (Error & { code?: string }) | undefined;
    const failed = err ? err.code !== 'EPIPE' : r.status !== 0;
    return { stdout: typeof r.stdout === 'string' ? r.stdout : '', failed };
  }

  close(): void {
    if (this.root !== null) rmSync(this.root, { recursive: true, force: true });
    this.root = null;
  }
}

/** Responses by id, the first of two with one id winning. */
export function parseResponses(stdout: string): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const l of stdout.split('\n')) {
    if (l.trim() === '') continue;
    let v: unknown;
    try {
      v = JSON.parse(l);
    } catch {
      continue;
    }
    if (isPlainObject(v) && typeof v.id === 'string' && !out.has(v.id)) out.set(v.id, v);
  }
  return out;
}

/** The one response of a run for a single example, or null. */
export function parseSolo(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split('\n').filter((l) => l.trim() !== '');
  if (lines.length !== 1) return null;
  try {
    const v = JSON.parse(lines[0]);
    return isPlainObject(v) ? v : null;
  } catch {
    return null;
  }
}
