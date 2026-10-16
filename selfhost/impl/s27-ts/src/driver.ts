// The driver: one JSON request per line in, one JSON response per line out (Driver protocol).

import { respond } from './protocol.ts';

function main() {
  let pending: Buffer[] = [];
  const emit = (buf: Buffer) => {
    const out = respond(buf.toString('utf8'));
    if (out !== undefined) process.stdout.write(out + '\n');
  };
  process.stdin.on('data', (chunk: Buffer) => {
    let start = 0;
    for (let i = chunk.indexOf(10, start); i >= 0; i = chunk.indexOf(10, start)) {
      pending.push(chunk.subarray(start, i));
      emit(Buffer.concat(pending));
      pending = [];
      start = i + 1;
    }
    if (start < chunk.length) pending.push(chunk.subarray(start));
  });
  process.stdin.on('end', () => {
    if (pending.length) emit(Buffer.concat(pending));
  });
}

main();
