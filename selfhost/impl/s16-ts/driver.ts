// The driver: JSON requests on standard input, one per line; one JSON response per line out.

import { handle } from './src/protocol.ts';

/** Blank: empty, or only spaces and tabs (a CR before the LF is allowed too). */
const BLANK = /^[ \t]*\r?$/;

let pending = '';
let queue: Promise<void> = Promise.resolve();

function enqueue(line: string): void {
  if (BLANK.test(line)) return;
  queue = queue.then(async () => {
    let out: unknown;
    try {
      out = await handle(line);
    } catch (e) {
      process.stderr.write(`internal error: ${(e as Error)?.stack ?? e}\n`);
      out = { id: null, error: 'internal_error' };
    }
    await new Promise<void>((resolve) => process.stdout.write(JSON.stringify(out) + '\n', () => resolve()));
  });
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  pending += chunk;
  let nl: number;
  while ((nl = pending.indexOf('\n')) >= 0) {
    enqueue(pending.slice(0, nl));
    pending = pending.slice(nl + 1);
  }
});
process.stdin.on('end', () => {
  if (pending !== '') enqueue(pending);
  pending = '';
  queue.then(() => {
    process.exitCode = 0;
  });
});
