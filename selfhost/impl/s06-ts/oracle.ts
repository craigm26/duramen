import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname, isObject } from './common.ts';

const TIMEOUT_MS = 20000;

// Splits an oracle command into words (REQ-OR-002); null when a quote is not closed.
export function splitCommand(cmd: string): string[] | null {
  const words: string[] = [];
  let cur = '';
  let has = false;
  let i = 0;
  while (i < cmd.length) {
    const ch = cmd[i];
    if (ch === ' ' || ch === '\t') {
      if (has) words.push(cur);
      cur = '';
      has = false;
      i++;
    } else if (ch === '"') {
      has = true;
      i++;
      let closed = false;
      while (i < cmd.length) {
        if (cmd[i] === '\\' && cmd[i + 1] === '"') {
          cur += '"';
          i += 2;
        } else if (cmd[i] === '"') {
          closed = true;
          i++;
          break;
        } else cur += cmd[i++];
      }
      if (!closed) return null;
    } else if (ch === "'") {
      has = true;
      const end = cmd.indexOf("'", i + 1);
      if (end < 0) return null;
      cur += cmd.slice(i + 1, end);
      i = end + 1;
    } else {
      has = true;
      cur += ch;
      i++;
    }
  }
  if (has) words.push(cur);
  return words;
}

export interface RunResult {
  failed: boolean;
  lines: string[];
}

export class OracleRunner {
  files: Record<string, string>;
  cwdFile: string;
  command: string;
  tmp: string | null = null;

  constructor(files: Record<string, string>, oracleFile: string, command: string) {
    this.files = files;
    this.cwdFile = oracleFile;
    this.command = command;
  }

  private materialize(): string {
    if (this.tmp !== null) return this.tmp;
    const dir = mkdtempSync(join(tmpdir(), 'duramen-'));
    for (const [name, text] of Object.entries(this.files)) {
      try {
        const p = join(dir, ...name.split('/'));
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, text);
      } catch {
        // a name this file system cannot hold (OPEN-RQ-003)
      }
    }
    this.tmp = dir;
    return dir;
  }

  cleanup(): void {
    if (this.tmp !== null) {
      try {
        rmSync(this.tmp, { recursive: true, force: true });
      } catch {
        // ignore
      }
      this.tmp = null;
    }
  }

  run(input: string): RunResult {
    const words = splitCommand(this.command);
    if (!words || words.length === 0) return { failed: true, lines: [] };
    const dir = this.materialize();
    const cwd = join(dir, ...dirname(this.cwdFile).split('/').filter(Boolean));
    const exe = words[0] === 'node' ? process.execPath : words[0];
    const r = spawnSync(exe, words.slice(1), {
      cwd,
      input,
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      maxBuffer: 1 << 30,
      shell: false,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const err = r.error as (Error & { code?: string }) | undefined;
    const failed = (err !== undefined && err.code !== 'EPIPE') || r.status !== 0 || r.signal !== null;
    const out = typeof r.stdout === 'string' ? r.stdout : '';
    const lines = out.split('\n').filter((l) => l.trim() !== '');
    return { failed, lines };
  }
}

export function parseResponse(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line);
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
}
