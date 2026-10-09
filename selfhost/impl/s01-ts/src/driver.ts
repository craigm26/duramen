import { handleLine } from './handle.ts';

let buf = '';

function processLine(line: string): string {
  if (/^[ \t]*$/.test(line)) return '';
  return JSON.stringify(handleLine(line)) + '\n';
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buf += chunk;
  let out = '';
  let i: number;
  while ((i = buf.indexOf('\n')) >= 0) {
    out += processLine(buf.slice(0, i));
    buf = buf.slice(i + 1);
  }
  if (out) process.stdout.write(out);
});
process.stdin.on('end', () => {
  const out = processLine(buf);
  buf = '';
  if (out) process.stdout.write(out);
});
