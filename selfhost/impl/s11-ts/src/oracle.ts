// Running the oracle as a driver (REQ-OR-002, REQ-OR-004).

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Files } from './files.ts';

/** How long one run of the oracle may take (OPEN-RQ-001). */
export const ORACLE_TIMEOUT_MS = 120_000;

/**
 * Splits a command into words at spaces and tabs. A word may be quoted with "…" (where \" is ")
 * or '…', parts join, and "" is an empty word. Undefined for a quote that is not closed.
 */
export function splitCommand(command: string): string[] | undefined {
  const words: string[] = [];
  let cur = '';
  let inWord = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === ' ' || ch === '\t') {
      if (inWord) words.push(cur);
      cur = '';
      inWord = false;
    } else if (ch === '"') {
      inWord = true;
      let j = i + 1;
      for (; j < command.length && command[j] !== '"'; j++) {
        if (command[j] === '\\' && command[j + 1] === '"') {
          cur += '"';
          j++;
        } else cur += command[j];
      }
      if (j >= command.length) return undefined;
      i = j;
    } else if (ch === "'") {
      inWord = true;
      const j = command.indexOf("'", i + 1);
      if (j < 0) return undefined;
      cur += command.slice(i + 1, j);
      i = j;
    } else {
      inWord = true;
      cur += ch;
    }
  }
  if (inWord) words.push(cur);
  return words;
}

export interface RunResult {
  /** False when the oracle could not be started, exited with a status other than 0, or was stopped. */
  ok: boolean;
  lines: string[];
}

/** Starts the command without a shell in cwd, writes the lines, and collects its output lines. */
export function runOracle(command: string, cwd: string, input: string[]): Promise<RunResult> {
  const words = splitCommand(command);
  if (words === undefined || words.length === 0) return Promise.resolve({ ok: false, lines: [] });
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok, lines: out.split('\n').map((l) => l.replace(/\r$/, '')) });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(words[0], words.slice(1), { cwd, stdio: ['pipe', 'pipe', 'ignore'], shell: false });
    } catch {
      finish(false);
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, ORACLE_TIMEOUT_MS);
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (d: string) => { out += d; });
    child.stdin!.on('error', () => {});
    child.on('error', () => finish(false));
    child.on('close', (code, signal) => finish(code === 0 && signal === null));
    child.stdin!.end(input.map((l) => l + '\n').join(''));
  });
}

/** Writes the files of a request to a new temporary folder, for the oracle to run in. */
export async function materialize(files: Files): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'duramen-'));
  for (const [name, text] of files) {
    const path = join(root, ...name.split('/'));
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, text, 'utf8');
  }
  return root;
}

export async function cleanup(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true }).catch(() => {});
}
