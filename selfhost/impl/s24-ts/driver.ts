import { handleLine } from './service.ts';

// Split explicitly: U+2028 and U+2029 belong to JSON strings, never to framing.
process.stdin.setEncoding('utf8');
let pending = '';
for await (const chunk of process.stdin) {
  pending += chunk;
  let end;
  while ((end = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0,end); pending = pending.slice(end+1);
    if (!line.trim()) continue;
    process.stdout.write(JSON.stringify(await handleLine(line)) + '\n');
  }
}
if (pending.trim()) process.stdout.write(JSON.stringify(await handleLine(pending)) + '\n');
