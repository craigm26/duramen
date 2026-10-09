import { handleLine } from './src/handle.ts';

let buffer = '';

function process1(line: string): void {
  if (/^[ \t]*$/.test(line)) return;
  process.stdout.write(JSON.stringify(handleLine(line)) + '\n');
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let i: number;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    process1(line.endsWith('\r') ? line.slice(0, -1) : line);
  }
});
process.stdin.on('end', () => {
  if (buffer !== '') process1(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer);
  buffer = '';
});
