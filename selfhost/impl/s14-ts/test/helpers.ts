import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Sends request lines (objects or raw strings) to a fresh driver; returns the output lines. */
export function drive(requests: (object | string)[], stdinOverride?: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/driver.ts'], { cwd: root, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`driver exited ${code}`));
      else resolve(out === '' ? [] : out.replace(/\n$/, '').split('\n'));
    });
    const text =
      stdinOverride ?? requests.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';
    child.stdin.end(text);
  });
}

export async function ask(op: string, input: unknown, id = 't'): Promise<Record<string, unknown>> {
  const [line] = await drive([{ id, op, input }]);
  return JSON.parse(line);
}

export async function diagnostics(files: Record<string, string>, entry?: string): Promise<string[]> {
  const input: Record<string, unknown> = { files };
  if (entry !== undefined) input.entry = entry;
  const r = (await ask('check', input)) as { result: { diagnostics: string[] } };
  return r.result.diagnostics;
}

export const HEAD = 'duramen 0.1\nspec s 1\n';
