// The driver: reads requests from standard input, one per line, and writes one
// response line for each non-blank request, in order (SPEC: Interface).

import { respond } from './protocol.ts';

let pending = '';

const emit = (line: string): void => {
  const out = respond(line);
  if (out !== null) process.stdout.write(`${out}\n`);
};

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  const lines = (pending + chunk).split('\n');
  pending = lines.pop() ?? '';
  for (const line of lines) emit(line);
});
process.stdin.on('end', () => {
  if (pending !== '') emit(pending);
  pending = '';
});
