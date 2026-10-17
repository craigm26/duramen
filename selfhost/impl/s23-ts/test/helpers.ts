import { readFileSync } from 'node:fs';
import { handleLine } from '../src/server.ts';

export const ECHO = readFileSync(new URL('../fixtures/echo.mjs', import.meta.url), 'utf8');

export function call(op: string, input?: unknown): any {
  const req: Record<string, unknown> = { id: 'x', op };
  if (input !== undefined) req.input = input;
  return JSON.parse(handleLine(JSON.stringify(req))!);
}

export function raw(line: string): any {
  const out = handleLine(line);
  return out === null ? null : JSON.parse(out);
}

export function diags(files: Record<string, string>, entry?: string): string[] {
  const input: Record<string, unknown> = { files };
  if (entry !== undefined) input.entry = entry;
  const r = call('check', input);
  if (r.error) throw new Error('error ' + r.error);
  return r.result.diagnostics;
}

export function withEcho(files: Record<string, string>): Record<string, string> {
  return { ...files, 'echo.mjs': ECHO };
}

// a record with the echo oracle and one operation `f`
export function rec(body: string, head = 'op f\n  input x? json, y? json, answer? json\n'): Record<string, string> {
  return withEcho({ 's.duramen': `duramen 0.1\nspec s 1\noracle node echo.mjs\n${head}${body}` });
}

export function cases(files: Record<string, string>, entry?: string): any {
  const input: Record<string, unknown> = { files };
  if (entry !== undefined) input.entry = entry;
  return call('cases', input).result;
}
