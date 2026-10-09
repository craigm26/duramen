// Driver: reads JSON requests (one per line) on stdin, writes one JSON response per line.
import { parse, run, QueryError } from './jsonpath.ts';
import type { Json } from './jsonpath.ts';

export function handle(line: string): string {
  let req: unknown;
  try {
    req = JSON.parse(line);
  } catch {
    return JSON.stringify({ id: null, error: 'bad_request' });
  }
  if (typeof req !== 'object' || req === null || Array.isArray(req)) {
    return JSON.stringify({ id: null, error: 'bad_request' });
  }
  const r = req as Record<string, unknown>;
  if (typeof r.id !== 'string') return JSON.stringify({ id: null, error: 'bad_request' });
  const id = r.id;
  if (r.op !== 'query') return JSON.stringify({ id, error: 'unknown_op' });
  const input = r.input as Record<string, unknown> | null | undefined;
  if (typeof input !== 'object' || input === null || Array.isArray(input) ||
    typeof input.query !== 'string' || !Object.hasOwn(input, 'document')) {
    return JSON.stringify({ id, error: 'bad_request' });
  }
  try {
    const q = parse(input.query);
    return JSON.stringify({ id, result: run(q, input.document as Json) });
  } catch (e) {
    if (e instanceof QueryError) return JSON.stringify({ id, error: 'invalid_query' });
    throw e;
  }
}

function respond(line: string): string {
  if (/^[ \t]*$/.test(line)) return '';
  return handle(line) + '\n';
}

const decoder = new TextDecoder('utf-8');
let pending = '';
process.stdin.on('data', (chunk: Buffer) => {
  pending += decoder.decode(chunk, { stream: true });
  const lines = pending.split('\n');
  pending = lines.pop()!;
  let out = '';
  for (const l of lines) out += respond(l);
  if (out) process.stdout.write(out);
});
process.stdin.on('end', () => {
  pending += decoder.decode();
  const out = respond(pending);
  if (out) process.stdout.write(out);
});
