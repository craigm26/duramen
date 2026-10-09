// The driver: JSON requests on standard input, one response line each on standard output.

import { handleLine } from './handle.ts';

const BLANK = /^[ \t]*$/;

async function respond(line: string): Promise<void> {
  let response: unknown;
  try {
    response = await handleLine(line);
  } catch (err) {
    let id: unknown = null;
    try {
      const req = JSON.parse(line);
      if (typeof req?.id === 'string') id = req.id;
    } catch {
      // the id stays null
    }
    process.stderr.write(`duramen-core: internal error: ${(err as Error)?.stack ?? err}\n`);
    response = { id, error: 'internal_error' };
  }
  await new Promise<void>((resolve) => process.stdout.write(JSON.stringify(response) + '\n', () => resolve()));
}

async function main(): Promise<void> {
  const decoder = new TextDecoder('utf-8');
  let pending = '';
  for await (const chunk of process.stdin) {
    pending += decoder.decode(chunk as Buffer, { stream: true });
    let nl: number;
    while ((nl = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, nl).replace(/\r$/, '');
      pending = pending.slice(nl + 1);
      if (!BLANK.test(line)) await respond(line);
    }
  }
  pending += decoder.decode();
  const last = pending.replace(/\r$/, '');
  if (last !== '' && !BLANK.test(last)) await respond(last);
}

main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`duramen-core: ${(err as Error)?.stack ?? err}\n`);
    process.exit(0);
  },
);
