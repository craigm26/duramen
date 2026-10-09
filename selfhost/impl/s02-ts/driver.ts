import { handleLine } from './src/protocol.ts';

let buf = '';
const answer = (line: string) => {
  const out = handleLine(line);
  if (out !== null) process.stdout.write(out + '\n');
};

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buf += chunk;
  let i: number;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    answer(line);
  }
});
process.stdin.on('end', () => {
  if (buf !== '') answer(buf);
  buf = '';
});
