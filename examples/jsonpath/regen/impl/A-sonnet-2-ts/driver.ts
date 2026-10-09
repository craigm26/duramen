import { handleLine, isBlank } from './src/protocol.ts';

function process_(line: string): void {
  if (isBlank(line)) return;
  let out: string;
  try {
    out = handleLine(line);
  } catch {
    // e.g. stack exhaustion on extremely deep input
    out = '{"id":null,"error":"bad_request"}';
  }
  process.stdout.write(out + '\n');
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buf += chunk;
  let i: number;
  while ((i = buf.indexOf('\n')) >= 0) {
    process_(buf.slice(0, i));
    buf = buf.slice(i + 1);
  }
});
process.stdin.on('end', () => {
  if (buf !== '') process_(buf);
});
