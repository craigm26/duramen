// Running the oracle (REQ-OR-002, REQ-OR-004).

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isObject, parseJson } from './json.ts';
import type { Obj } from './json.ts';

/** How long one run of the oracle may take (OPEN-RQ-001). */
export const ORACLE_TIMEOUT_MS = 60_000;

/**
 * Splits an oracle command into words at spaces and tabs, with `"…"` and `'…'` quotes;
 * null when a quote is not closed.
 */
export function splitCommand(cmd: string): string[] | null {
  const words: string[] = [];
  let cur = '';
  let inWord = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === ' ' || ch === '\t') {
      if (inWord) words.push(cur);
      cur = '';
      inWord = false;
    } else if (ch === '"') {
      inWord = true;
      let j = i + 1;
      for (; j < cmd.length && cmd[j] !== '"'; j++) {
        if (cmd[j] === '\\' && cmd[j + 1] === '"') {
          cur += '"';
          j++;
        } else cur += cmd[j];
      }
      if (j >= cmd.length) return null;
      i = j;
    } else if (ch === "'") {
      inWord = true;
      const j = cmd.indexOf("'", i + 1);
      if (j < 0) return null;
      cur += cmd.slice(i + 1, j);
      i = j;
    } else {
      inWord = true;
      cur += ch;
    }
  }
  if (inWord) words.push(cur);
  return words;
}

/** Writes the request's files into a fresh folder, for the oracle to run in. */
export function materialize(files: Obj): string {
  const root = mkdtempSync(join(tmpdir(), 'duramen-'));
  for (const name of Object.keys(files)) {
    try {
      const path = join(root, ...name.split('/'));
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, files[name] as string, 'utf8');
    } catch {
      // A name the file system cannot hold (OPEN-RQ-003).
    }
  }
  return root;
}

export function cleanup(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Nothing to do.
  }
}

export interface Run {
  /** The lines of its output that are not white space only. */
  lines: string[];
  failed: boolean;
}

export function runOracle(argv: string[] | null, cwd: string, input: string): Promise<Run> {
  return new Promise((resolve) => {
    if (argv === null || argv.length === 0 || argv[0] === '') {
      resolve({ lines: [], failed: true });
      return;
    }
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, stdio: ['pipe', 'pipe', 'ignore'], shell: false });
    } catch {
      resolve({ lines: [], failed: true });
      return;
    }
    const chunks: Buffer[] = [];
    let failed = false;
    let done = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill('SIGKILL');
    }, ORACLE_TIMEOUT_MS);
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const out = Buffer.concat(chunks).toString('utf8');
      resolve({ lines: out.split('\n').filter((l) => !/^\s*$/.test(l)), failed });
    };
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', () => {
      failed = true;
      finish();
    });
    child.on('close', (code, signal) => {
      if (code !== 0 || signal !== null) failed = true;
      finish();
    });
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(input, 'utf8'));
  });
}

/** A response line: a JSON object holding no number too large to be finite, or null. */
export function responseOf(line: string): Obj | null {
  const v = parseJson(line);
  return v.ok && isObject(v.value) ? v.value : null;
}
