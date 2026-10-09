// The driver: requests on standard input (one JSON object per line), responses on
// standard output (one line each, in request order). Standard error is not used.

import { handleLine } from './protocol.ts';

let pending = '';

function emit(line: string): void {
  const reply = handleLine(line);
  if (reply !== null) process.stdout.write(reply + '\n');
}

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
