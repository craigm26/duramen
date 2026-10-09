import { readFileSync } from 'node:fs';
import { handleLine } from '../src/handle.ts';

export const ECHO = readFileSync(new URL('../fixtures/echo.mjs', import.meta.url), 'utf8');

/** Joins lines into a file text. */
export function t(...lines: string[]): string {
  return lines.join('\n') + '\n';
}

export function req(op: string, input: unknown): any {
  return handleLine(JSON.stringify({ id: 'x', op, input }));
}

export function diags(files: Record<string, string>, entry?: string): string[] {
  const input: Record<string, unknown> = { files };
  if (entry !== undefined) input.entry = entry;
  const r = req('check', input);
  if (r.error) throw new Error(r.error);
  return r.result.diagnostics;
}

export function check(files: Record<string, string>, entry?: string): any {
  const input: Record<string, unknown> = { files };
  if (entry !== undefined) input.entry = entry;
  return req('check', input).result;
}

export function cases(files: Record<string, string>): any {
  return req('cases', { files }).result;
}
