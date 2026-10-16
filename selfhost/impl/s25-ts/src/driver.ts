// The driver: reads request lines from standard input and answers each on standard output.

import { handleLine } from './handle.ts';

let buffer = '';
let chain: Promise<void> = Promise.resolve();

function enqueue(line: string): void {
  if (/^[ \t]*$/.test(line)) return;
  chain = chain.then(async () => {
    const res = await handleLine(line);
    process.stdout.write(JSON.stringify(res) + '\n');
  });
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let i: number;
  while ((i = buffer.indexOf('\n')) >= 0) {
    enqueue(buffer.slice(0, i));
    buffer = buffer.slice(i + 1);
  }
});
process.stdin.on('end', () => {
  enqueue(buffer);
  buffer = '';
  chain.then(() => {
    process.exitCode = 0;
  });
});
