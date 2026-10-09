import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleLine } from '../src/service.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const ECHO = readFileSync(join(here, '..', 'fixtures', 'echo.mjs'), 'utf8');

export function s(...lines: string[]): string {
  return lines.join('\n') + '\n';
}

export function request(op: string, input: any): any {
  return handleLine(JSON.stringify({ id: 'q', op, input }));
}

export function check(files: Record<string, string>, entry?: string): any {
  const input: any = { files };
  if (entry !== undefined) input.entry = entry;
  return request('check', input).result;
}

export function diags(files: Record<string, string>, entry?: string): string[] {
  return check(files, entry).diagnostics;
}

export function one(text: string, extra: Record<string, string> = {}): string[] {
  return diags({ 's.duramen': text, ...extra });
}

export function withEcho(text: string, extra: Record<string, string> = {}): string[] {
  return diags({ 's.duramen': text, 'echo.mjs': ECHO, ...extra });
}

export function cases(files: Record<string, string>, entry?: string): any {
  const input: any = { files };
  if (entry !== undefined) input.entry = entry;
  return request('cases', input).result;
}

export function judge(c: any, answer: any): any {
  return request('judge', { case: c, answer });
}
