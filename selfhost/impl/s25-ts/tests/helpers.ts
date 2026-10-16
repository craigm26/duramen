import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { handleLine } from '../src/handle.ts';

export const ECHO = readFileSync(new URL('../fixtures/echo.mjs', import.meta.url), 'utf8');

// Lines of a file, ending with a line break.
export const t = (...lines: string[]): string => lines.join('\n') + '\n';

export async function call(op: string, input: unknown, id = '1'): Promise<any> {
  return handleLine(JSON.stringify({ id, op, input }));
}

export async function diags(files: Record<string, string>, entry?: string): Promise<string[]> {
  const input: any = { files };
  if (entry !== undefined) input.entry = entry;
  const r = await call('check', input);
  assert.ok(r.result, JSON.stringify(r));
  return r.result.diagnostics;
}

export async function cases(files: Record<string, string>, entry?: string): Promise<any> {
  const input: any = { files };
  if (entry !== undefined) input.entry = entry;
  const r = await call('cases', input);
  assert.ok(r.result, JSON.stringify(r));
  return r.result;
}

// check: the files give exactly these diagnostics.
export async function expectDiags(files: Record<string, string>, expected: string[], entry?: string): Promise<void> {
  assert.deepStrictEqual(await diags(files, entry), expected);
}

// A one-file record s.duramen with the echo oracle next to it.
export const withEcho = (s: string, extra: Record<string, string> = {}): Record<string, string> => ({
  's.duramen': s,
  'echo.mjs': ECHO,
  ...extra,
});

export const H = ['duramen 0.1', 'spec s 1'];
