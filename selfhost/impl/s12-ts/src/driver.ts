// The driver: one JSON request per line on stdin, one JSON response per line on stdout.
import { StringDecoder } from 'node:string_decoder';
import { handleLine } from './service.ts';

function respond(line: string) {
  if (/^[ \t]*$/.test(line)) return;
  let reply;
  try {
    reply = handleLine(line);
  } catch (e) {
    process.stderr.write(String((e as any)?.stack ?? e) + '\n');
    reply = { id: null, error: 'internal_error' };
  }
  process.stdout.write(JSON.stringify(reply) + '\n');
}

const decoder = new StringDecoder('utf8');
let buffer = '';
process.stdin.on('data', (chunk: Buffer) => {
  buffer += decoder.write(chunk);
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    respond(line);
  }
});
process.stdin.on('end', () => {
  buffer += decoder.end();
  if (buffer !== '') respond(buffer);
  buffer = '';
});
