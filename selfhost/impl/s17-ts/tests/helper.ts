import { readFileSync } from 'node:fs';
import { handleLine } from '../src/handle.ts';

export const ECHO = readFileSync(new URL('../fixtures/echo.mjs', import.meta.url), 'utf8');

// A template tag: raw text, without the first newline.
export function t(strings: TemplateStringsArray, ...values: unknown[]): string {
  const s = String.raw(strings, ...values);
  return s.startsWith('\n') ? s.slice(1) : s;
}

export function call(op: string, input?: unknown): any {
  const req: any = { id: 'x', op };
  if (input !== undefined) req.input = input;
  const out = handleLine(JSON.stringify(req));
  return JSON.parse(out as string);
}

export function check(files: Record<string, string>, entry?: string): any {
  const input: any = { files };
  if (entry !== undefined) input.entry = entry;
  return call('check', input);
}

export function diags(files: Record<string, string>, entry?: string): string[] {
  return check(files, entry).result.diagnostics;
}

export function cases(files: Record<string, string>, entry?: string): any {
  const input: any = { files };
  if (entry !== undefined) input.entry = entry;
  return call('cases', input).result;
}

export function one(text: string, extra: Record<string, string> = {}): string[] {
  return diags({ 's.duramen': text, ...extra });
}
