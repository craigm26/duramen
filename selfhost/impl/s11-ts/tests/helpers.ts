// Helpers for the tests: run the driver on request lines, and read values at paths.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(import.meta.dirname, '..');

const regen = JSON.parse(readFileSync(join(ROOT, 'REGEN.json'), 'utf8'));

export interface DriverRun {
  stdout: string;
  status: number | null;
  responses: unknown[];
}

/** Starts the driver named in REGEN.json, as a judge does, and feeds it the input. */
export function runDriver(input: string): Promise<DriverRun> {
  const words = (typeof regen.driver === 'string' ? regen.driver : regen.driver[process.platform] ?? regen.driver.default)
    .split(' ');
  return new Promise((resolve, reject) => {
    const child = spawn(words[0], words.slice(1), { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => { stdout += d; });
    child.on('error', reject);
    child.on('close', (status) => {
      const responses = stdout.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));
      resolve({ stdout, status, responses });
    });
    child.stdin.end(input);
  });
}

export function lines(...requests: unknown[]): string {
  return requests.map((r) => (typeof r === 'string' ? r : JSON.stringify(r)) + '\n').join('');
}

let n = 0;
export async function request(op: string, input: unknown): Promise<any> {
  const id = `r${++n}`;
  const run = await runDriver(lines({ id, op, input }));
  return run.responses[0];
}

/** Checks a record's files. */
export async function check(files: { [k: string]: string }, extra: object = {}): Promise<any> {
  return (await request('check', { files, ...extra })).result;
}

export async function cases(files: { [k: string]: string }, extra: object = {}): Promise<any> {
  return (await request('cases', { files, ...extra })).result;
}

export function at(value: unknown, path: string): unknown {
  let cur: any = value;
  for (const name of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, name)) return undefined;
    cur = cur[name];
  }
  return cur;
}

export const ECHO = readFileSync(join(ROOT, 'tests', 'fixtures', 'echo.mjs'), 'utf8');

/** A record's text from lines. */
export function text(...ls: string[]): string {
  return ls.map((l) => l + '\n').join('');
}
