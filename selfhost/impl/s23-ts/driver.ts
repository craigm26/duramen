// duramen-core driver: reads request lines on standard input, writes response lines.

import { StringDecoder } from 'node:string_decoder';
import { handleLine } from './src/server.ts';

const decoder = new StringDecoder('utf8');
let buf = '';

function emit(line: string): void {
  const out = handleLine(line);
  if (out !== null) process.stdout.write(out + '\n');
}

function feed(text: string): void {
  buf += text;
  let i: number;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    emit(line);
  }
}

process.stdin.on('data', (chunk: Buffer) => feed(decoder.write(chunk)));
process.stdin.on('end', () => {
  feed(decoder.end());
  if (buf !== '') {
    const rest = buf;
    buf = '';
    emit(rest);
  }
});
