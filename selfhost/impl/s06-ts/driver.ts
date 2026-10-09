import { serve } from './serve.ts';

const chunks: Buffer[] = [];
process.stdin.on('data', (c: Buffer) => chunks.push(c));
process.stdin.on('end', () => {
  process.stdout.write(serve(Buffer.concat(chunks).toString('utf8')));
});
