import { createInterface } from 'node:readline';
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  console.log(JSON.stringify({ id: r.id, result: { sum: r.input.a + r.input.b } }));
}
