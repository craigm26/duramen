import { readFileSync } from 'node:fs';
import { handleLine } from '../src/protocol.ts';

export const ECHO = readFileSync(new URL('../fixtures/echo.mjs', import.meta.url), 'utf8');

export type Files = Record<string, string>;

export function request(op: string, input: unknown): any {
  return JSON.parse(handleLine(JSON.stringify({ id: 'x', op, input }))!);
}

export function check(files: Files, entry?: string): string[] {
  const input: Record<string, unknown> = { files };
  if (entry !== undefined) input.entry = entry;
  return request('check', input).result.diagnostics;
}

export function cases(files: Files, entry?: string): any {
  const input: Record<string, unknown> = { files };
  if (entry !== undefined) input.entry = entry;
  return request('cases', input).result;
}

/** A one-file record `s.duramen` with the standard header. */
export function rec(body: string, extra: Files = {}): Files {
  return { 's.duramen': `duramen 0.1\nspec s 1\n${body}`, ...extra };
}

export const WITH_ECHO = { 'echo.mjs': ECHO };
export const ORACLE = 'oracle node echo.mjs\nop f\n  input x? json\n';
