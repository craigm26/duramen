// The driver: JSON requests on standard input, one per line; one JSON response per line out.

import { handleLine } from './protocol.ts';

let pending: Buffer = Buffer.alloc(0);
let chain: Promise<void> = Promise.resolve();

function enqueue(bytes: Buffer): void {
  let text = bytes.toString('utf8');
  if (text.endsWith('\r')) text = text.slice(0, -1);
  if (/^[ \t]*$/.test(text)) return;
  chain = chain.then(async () => {
    const response = await handleLine(text);
    process.stdout.write(JSON.stringify(response) + '\n');
  });
}

process.stdin.on('data', (chunk: Buffer) => {
  pending = Buffer.concat([pending, chunk]);
  let at: number;
  while ((at = pending.indexOf(0x0a)) >= 0) {
    enqueue(pending.subarray(0, at));
    pending = pending.subarray(at + 1);
  }
});

process.stdin.on('end', () => {
  if (pending.length > 0) enqueue(pending);
  pending = Buffer.alloc(0);
  chain.then(() => {
    process.exitCode = 0;
  });
});
