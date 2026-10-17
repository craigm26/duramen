import { handleLine } from './core.ts';

process.stdin.setEncoding('utf8');
let pending = '';
function respond(line: string): void {
  if (/^\s*$/.test(line)) return;
  process.stdout.write(JSON.stringify(handleLine(line)) + '\n');
}
for await (const chunk of process.stdin) {
  pending += chunk;
  let end;
  while ((end = pending.indexOf('\n')) !== -1) {
    respond(pending.slice(0, end));
    pending = pending.slice(end + 1);
  }
}
if (pending) respond(pending);
