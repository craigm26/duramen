// Starting the oracle (REQ-OR-002, REQ-OR-004).

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** How long one run of the oracle may take before it is stopped (OPEN-RQ-001). */
export const ORACLE_TIMEOUT_MS = 60_000;

/**
 * Splits an oracle command into words at spaces and tabs, with `"…"` and `'…'` quoting;
 * undefined when a quote is not closed.
 */
export function splitCommand(cmd: string): string[] | undefined {
  const out: string[] = [];
  let cur = '';
  let inWord = false;
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote === '"') {
      if (ch === '\\' && cmd[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quote = undefined;
      else cur += ch;
    } else if (quote === "'") {
      if (ch === "'") quote = undefined;
      else cur += ch;
    } else if (ch === ' ' || ch === '\t') {
      if (inWord) out.push(cur);
      cur = '';
      inWord = false;
    } else {
      inWord = true;
      if (ch === '"' || ch === "'") quote = ch;
      else cur += ch;
    }
  }
  if (quote) return undefined;
  if (inWord) out.push(cur);
  return out;
}

export interface Run {
  /** Output lines that are not white space only. */
  lines: string[];
  /** The oracle could not be started, exited with a status other than 0, or was stopped. */
  failed: boolean;
}

export function runOracle(argv: string[] | undefined, cwd: string, input: string): Promise<Run> {
  return new Promise((resolve) => {
    if (!argv || argv.length === 0) {
      resolve({ lines: [], failed: true });
      return;
    }
    const chunks: Buffer[] = [];
    let done = false;
    let timedOut = false;
    const finish = (failed: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const out = Buffer.concat(chunks).toString('utf8');
      resolve({ lines: out.split('\n').filter((l) => !/^\s*$/.test(l)), failed });
    };
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, stdio: ['pipe', 'pipe', 'ignore'], shell: false });
    } catch {
      resolve({ lines: [], failed: true });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, ORACLE_TIMEOUT_MS);
    child.stdout.on('data', (b: Buffer) => chunks.push(b));
    child.on('error', () => finish(true));
    child.on('close', (code, signal) => finish(timedOut || code !== 0 || signal !== null));
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(input, 'utf8'));
  });
}

/** Writes the request's files into a fresh folder, for the oracle to run in. */
export function materialize(files: Map<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'duramen-'));
  for (const [name, text] of files) {
    const target = join(root, ...name.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text, 'utf8');
  }
  return root;
}

export function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}
