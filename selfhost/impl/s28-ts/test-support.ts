import { checkRecord } from './checker.ts';
import { parseRecord } from './parser.ts';

export const preamble = 'duramen 0.1\nspec custom 1\n';
export const oracleSource = `import { readFileSync } from 'node:fs';
const requests = readFileSync(0, 'utf8').split('\\n').filter(Boolean);
let status = 0;
for (const text of requests) {
  let request;
  try { request = JSON.parse(text); } catch { console.log('{"error":"bad_json"}'); continue; }
  const input = request.input ?? {};
  if (input.exit) status = input.exit;
  if (input.silent) continue;
  if (input.say !== undefined) { process.stdout.write(input.say); continue; }
  console.log(JSON.stringify({id: request.id ?? null, ...(input.response ?? {result: input})}));
}
process.exitCode = status;
`;
export function read(body: string, extra: Record<string, string> = {}) {
  return parseRecord({ 'record.duramen': preamble + body, ...extra });
}
export function check(body: string, extra: Record<string, string> = {}) {
  return checkRecord({ 'record.duramen': preamble + body, 'model.mjs': oracleSource, ...extra });
}
export const codes = (r: { diagnostics: { code: string }[] }) => r.diagnostics.map(d => d.code);
export function checkedCodes(body: string): string[] { return codes(check(body).model); }
