import { handleLine, isBlank } from './src/protocol.ts';

const decoder = new TextDecoder();
let pending: Buffer[] = [];

function emit(bytes: Buffer, out: string[]): void {
  const line = decoder.decode(bytes);
  if (isBlank(line)) return;
  out.push(handleLine(line) + '\n');
}

function feed(chunk: Buffer, final: boolean): void {
  const out: string[] = [];
  let start = 0;
  for (;;) {
    const nl = chunk.indexOf(0x0a, start);
    if (nl < 0) break;
    pending.push(chunk.subarray(start, nl));
    emit(Buffer.concat(pending), out);
    pending = [];
    start = nl + 1;
  }
  pending.push(chunk.subarray(start));
  if (final) {
    emit(Buffer.concat(pending), out);
    pending = [];
  }
  if (out.length > 0) process.stdout.write(out.join(''));
}

process.stdin.on('data', (c: Buffer) => feed(c, false));
process.stdin.on('end', () => feed(Buffer.alloc(0), true));
