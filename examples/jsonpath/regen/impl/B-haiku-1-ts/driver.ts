// The jsonpath driver: request lines on standard input, response lines on standard output.

import { StringDecoder } from 'node:string_decoder';
import { handleLine } from './protocol.ts';

const decoder = new StringDecoder('utf8');
let buf = '';

// Blank lines (only spaces, tabs and CRs) get no response. A trailing CR is ignored.
function emit(line: string): void {
  if (/^[ \t\r]*$/.test(line)) return;
  const text = line.endsWith('\r') ? line.slice(0, -1) : line;
  process.stdout.write(handleLine(text) + '\n');
}

function drain(final: boolean): void {
  let from = 0;
  let nl = buf.indexOf('\n', from);
  while (nl !== -1) {
    emit(buf.slice(from, nl));
    from = nl + 1;
    nl = buf.indexOf('\n', from);
  }
  buf = buf.slice(from);
  if (final && buf.length > 0) {
    emit(buf);
    buf = '';
  }
}

process.stdin.on('data', (chunk: Buffer) => {
  buf += decoder.write(chunk);
  drain(false);
});

process.stdin.on('end', () => {
  buf += decoder.end();
  drain(true);
});
