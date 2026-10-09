import { StringDecoder } from 'node:string_decoder';
import { handleLine } from './src/handle.ts';

const decoder = new StringDecoder('utf8');
let pending = '';

function answer(line: string): void {
  const out = handleLine(line);
  if (out !== null) process.stdout.write(out + '\n');
}

process.stdin.on('data', (chunk: Buffer) => {
  pending += decoder.write(chunk);
  let i = pending.indexOf('\n');
  while (i >= 0) {
    answer(pending.slice(0, i));
    pending = pending.slice(i + 1);
    i = pending.indexOf('\n');
  }
});

process.stdin.on('end', () => {
  pending += decoder.end();
  if (pending !== '') answer(pending);
  pending = '';
});
