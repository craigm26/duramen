// Line-oriented driver: one JSON request per line on stdin, one JSON response per line.

import { handleLine } from './handle.ts';

process.stdin.setEncoding('utf8');
let buf = '';
const emit = (line: string) => {
  const out = handleLine(line);
  if (out !== null) process.stdout.write(out + '\n');
};
process.stdin.on('data', (chunk: string) => {
  buf += chunk;
  let i: number;
  while ((i = buf.indexOf('\n')) >= 0) {
    emit(buf.slice(0, i));
    buf = buf.slice(i + 1);
  }
});
process.stdin.on('end', () => {
  if (buf.length > 0) emit(buf);
});
