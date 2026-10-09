// The jsonpath driver: reads requests from standard input, one JSON object per line, and writes
// one response per non-blank line to standard output, in order (SPEC.md, Driver protocol).

import { respondLine } from './protocol.ts';

const decoder = new TextDecoder('utf-8');
let pending = '';

function emit(line: string): void {
  const response = respondLine(line);
  if (response !== undefined) process.stdout.write(`${response}\n`);
}

for await (const chunk of process.stdin) {
  pending += decoder.decode(chunk as Uint8Array, { stream: true });
  let newline = pending.indexOf('\n');
  while (newline !== -1) {
    emit(pending.slice(0, newline));
    pending = pending.slice(newline + 1);
    newline = pending.indexOf('\n');
  }
}
pending += decoder.decode();
emit(pending); // a last line without its LF
