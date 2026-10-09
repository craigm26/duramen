import { handleLine } from './jsonpath.ts';

let buf = '';

function process_(lines: string[]): void {
  let out = '';
  for (const l of lines) {
    let r: string | null;
    try {
      r = handleLine(l);
    } catch {
      r = '{"id":null,"error":"bad_request"}';
    }
    if (r !== null) out += r + '\n';
  }
  if (out) process.stdout.write(out);
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop()!;
  process_(lines);
});
process.stdin.on('end', () => {
  if (buf.length > 0) process_([buf]);
});
