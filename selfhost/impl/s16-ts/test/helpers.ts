// Test helpers: run the driver as REGEN.json names it, and read the examples of SPEC.md.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface DriverRun {
  stdout: string;
  status: number | null;
}

/** Starts the driver named in REGEN.json, as the judge would, and feeds it `input`. */
export function runDriver(input: string, env: Record<string, string> = {}): Promise<DriverRun> {
  const regen = JSON.parse(readFileSync(join(ROOT, 'REGEN.json'), 'utf8'));
  const cmd: string = typeof regen.driver === 'string' ? regen.driver : (regen.driver[process.platform] ?? regen.driver.default);
  const [prog, ...args] = cmd.split(' ');
  return new Promise((resolve, reject) => {
    const child = spawn(prog, args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => chunks.push(b));
    child.on('error', reject);
    child.on('close', (status) => resolve({ stdout: Buffer.concat(chunks).toString('utf8'), status }));
    child.stdin.end(input);
  });
}

/** Sends requests and answers the parsed responses, in order. */
export async function send(requests: unknown[], env: Record<string, string> = {}): Promise<any[]> {
  const run = await runDriver(requests.map((r) => JSON.stringify(r) + '\n').join(''), env);
  return run.stdout.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));
}

/** Reads a dotted path in a parsed response. */
export function at(value: any, path: string): any {
  let cur = value;
  for (const name of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, name)) return undefined;
    cur = cur[name];
  }
  return cur;
}

export interface SpecExample {
  title: string;
  /** The request line sent to the driver. */
  line: string;
  /** Paths in the response and the JSON values they hold. */
  expect: [string, unknown][];
}

function expectations(text: string): [string, unknown][] {
  const out: [string, unknown][] = [];
  const re = /`([^`]+)` = `(.*?)`(?=; `|$)/gs;
  for (const m of text.matchAll(re)) out.push([m[1], JSON.parse(m[2])]);
  return out;
}

/** Every example of SPEC.md, as a request and what its response holds. */
export function specExamples(): SpecExample[] {
  const lines = readFileSync(join(ROOT, 'SPEC.md'), 'utf8').split('\n');
  const fixtureStart = lines.indexOf('### `fixtures/echo.mjs`');
  const fence = lines.indexOf('```', fixtureStart);
  const fenceEnd = lines.indexOf('```', fence + 1);
  const echo = lines.slice(fence + 1, fenceEnd).join('\n') + '\n';

  const out: SpecExample[] = [];
  let req = '';
  let n = 0;
  for (let i = 0; i < fixtureStart; i++) {
    const line = lines[i];
    const head = /^\*\*((?:REQ|OPEN)-[A-Z]+-\d+)\.\*\*/.exec(line);
    if (head) req = head[1];

    const block = /^Example (\d+): `(\w+)` with input `(.*)` and these texts:$/s.exec(line);
    if (block) {
      const input = JSON.parse(block[3]);
      input.files = input.files ?? {};
      let j = i + 1;
      for (; j < fixtureStart && !lines[j].startsWith('⟶'); j++) {
        const named = /^`input\.files\.(".*")`:(.*)$/.exec(lines[j]);
        if (!named) continue;
        const name = JSON.parse(named[1]);
        if (named[2].includes('fixtures/echo.mjs')) input.files[name] = echo;
        else {
          const start = lines.indexOf('```', j) + 1;
          const end = lines.indexOf('```', start);
          input.files[name] = lines.slice(start, end).join('\n') + '\n';
          j = end;
        }
      }
      out.push({
        title: `${req} example ${block[1]}`,
        line: JSON.stringify({ id: `e${++n}`, op: block[2], input }),
        expect: expectations(lines[j].slice(2)),
      });
      i = j;
      continue;
    }

    const bullet = /^- (.*) ⟶ (.*)$/s.exec(line);
    if (bullet) {
      const id = `b${++n}`;
      const what = bullet[1];
      let request: string;
      let m: RegExpExecArray | null;
      if ((m = /^the request line `(.*)`$/.exec(what))) request = m[1];
      else if ((m = /^`(\w+)` \(no `input` member\)$/.exec(what))) request = JSON.stringify({ id, op: m[1] });
      else if ((m = /^`(\w+) (.*)` \(no `id` member\)$/.exec(what))) request = JSON.stringify({ op: m[1], input: JSON.parse(m[2]) });
      else if ((m = /^`(\w+) (.*)`$/.exec(what))) request = JSON.stringify({ id, op: m[1], input: JSON.parse(m[2]) });
      else throw new Error(`unread example line ${i + 1}: ${line}`);
      out.push({ title: `${req} line ${i + 1}`, line: request, expect: expectations(bullet[2]) });
      continue;
    }

    // Tables of judge requests: | case | answer | <path> ... |
    if (/^\| case \| answer \|/.test(line)) {
      const header = line.split('|').slice(1, -1).map((c) => c.trim());
      let j = i + 2;
      for (; lines[j].startsWith('|'); j++) {
        const cells = lines[j].split(' | ').map((c) => c.replace(/^\|? ?`?|`? ?\|?$/g, ''));
        const input = { case: JSON.parse(cells[0]), answer: JSON.parse(cells[1]) };
        const expect: [string, unknown][] = [];
        header.slice(2).forEach((path, k) => {
          const cell = cells[k + 2];
          if (cell !== '' && cell !== undefined) expect.push([path, JSON.parse(cell)]);
        });
        out.push({ title: `${req} table line ${j + 1}`, line: JSON.stringify({ id: `t${++n}`, op: 'judge', input }), expect });
      }
      i = j;
    }
  }
  return out;
}
