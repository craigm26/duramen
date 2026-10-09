// The program's entry point: reads request lines from standard input and writes one response line
// per request to standard output, in order (SPEC Interface, driver protocol).

import { respond } from './protocol.ts';

function emit(line: string): void {
  const response = respond(line);
  if (response !== null) process.stdout.write(`${response}\n`);
}

async function main(): Promise<void> {
  process.stdin.setEncoding('utf8');
  let pending = '';
  for await (const chunk of process.stdin) {
    const lines = (pending + chunk).split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) emit(line);
  }
  emit(pending);
}

await main();
