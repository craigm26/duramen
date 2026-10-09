// The driver: JSON requests on standard input, one per line; one JSON response per line out, in order.

import { handleLine, isBlank } from './src/protocol.ts';

const pending: string[] = [];
let buffer = '';
let ended = false;
let working = false;

async function work(): Promise<void> {
  if (working) return;
  working = true;
  while (pending.length > 0) {
    const line = pending.shift()!;
    if (isBlank(line)) continue;
    const response = await handleLine(line);
    process.stdout.write(JSON.stringify(response) + '\n');
  }
  working = false;
  if (ended) process.exitCode = 0;
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let i: number;
  while ((i = buffer.indexOf('\n')) >= 0) {
    pending.push(buffer.slice(0, i).replace(/\r$/, ''));
    buffer = buffer.slice(i + 1);
  }
  void work();
});
process.stdin.on('end', () => {
  ended = true;
  if (buffer !== '') pending.push(buffer.replace(/\r$/, ''));
  buffer = '';
  void work();
});
