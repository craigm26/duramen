import { handle } from './src/handler.ts';

function respond(line: string): void {
  if (/^[ \t]*$/.test(line)) return;
  process.stdout.write(JSON.stringify(handle(line)) + '\n');
}

const decoder = new TextDecoder('utf-8');
let pending = '';
for await (const chunk of process.stdin) {
  pending += decoder.decode(chunk, { stream: true });
  let i: number;
  while ((i = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, i);
    pending = pending.slice(i + 1);
    respond(line);
  }
}
pending += decoder.decode();
if (pending !== '') respond(pending);
