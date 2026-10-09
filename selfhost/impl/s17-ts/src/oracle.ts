// Running the oracle (REQ-OR-002, REQ-OR-004).

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { isObject, parseJson } from './util.ts';
import type { Obj } from './util.ts';

export const ORACLE_TIMEOUT_MS = 10000;

// Splits a command into words at spaces and tabs; null when a quote is not closed.
export function splitCommand(cmd: string): string[] | null {
  const words: string[] = [];
  let cur = '';
  let inWord = false;
  let i = 0;
  while (i < cmd.length) {
    const ch = cmd[i];
    if (ch === ' ' || ch === '\t') {
      if (inWord) words.push(cur);
      cur = '';
      inWord = false;
      i++;
      continue;
    }
    inWord = true;
    if (ch === '"') {
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
        } else {
          cur += cmd[i++];
        }
      }
      if (!closed) return null;
    } else if (ch === "'") {
      const j = cmd.indexOf("'", i + 1);
      if (j < 0) return null;
      cur += cmd.slice(i + 1, j);
      i = j + 1;
    } else {
      cur += ch;
      i++;
    }
  }
  if (inWord) words.push(cur);
  return words;
}

export interface RunResult {
  lines: string[];
  failed: boolean;
}

export function runOracle(command: string, cwd: string, requests: string[]): RunResult {
  const words = splitCommand(command);
  if (!words || words.length === 0) return { lines: [], failed: true };
  const program = words[0] === 'node' ? process.execPath : words[0];
  let r;
  try {
    r = spawnSync(program, words.slice(1), {
      cwd,
      input: Buffer.from(requests.join('\n') + '\n', 'utf8'),
      timeout: ORACLE_TIMEOUT_MS,
      maxBuffer: 1 << 28,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch {
    return { lines: [], failed: true };
  }
  const out = r.stdout ? r.stdout.toString('utf8') : '';
  const lines = out.split('\n').filter((l) => l.trim() !== '');
  return { lines, failed: r.error !== undefined || r.status !== 0 };
}

function asResponse(line: string): Obj | null {
  const p = parseJson(line);
  return p.ok && !p.big && isObject(p.value) ? p.value : null;
}

// A batch run: responses are matched to their examples by id, the first of an id winning.
export function responsesById(lines: string[]): Map<string, Obj> {
  const m = new Map<string, Obj>();
  for (const l of lines) {
    const r = asResponse(l);
    if (r && typeof r.id === 'string' && !m.has(r.id)) m.set(r.id, r);
  }
  return m;
}

// A run of one request alone: its response is the one line, whatever its id.
export function soloResponse(lines: string[]): Obj | null {
  return lines.length === 1 ? asResponse(lines[0]) : null;
}

export function materialize(files: Map<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'duramen-'));
  for (const [name, text] of files) {
    const p = join(root, name);
    try {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text, 'utf8');
    } catch {
      // names a file system cannot hold are open (OPEN-RQ-003)
    }
  }
  return root;
}

export function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}
