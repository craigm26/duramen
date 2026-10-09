// Shared helpers for the test files: build request lines and check responses against scenarios.

import assert from 'node:assert';
import { respond } from './protocol.ts';

// Writes scenario text exactly as the spec shows it (backslashes are not escapes).
export const r = String.raw;

export function request(query: string, document: string, id = 't'): string {
  return `{"id":${JSON.stringify(id)},"op":"query","input":{"query":${JSON.stringify(query)},"document":${document}}}`;
}

export function run(query: string, document: string): unknown {
  const line = respond(request(query, document));
  assert.notEqual(line, null);
  return JSON.parse(line as string);
}

// values and paths are JSON text, as the spec writes them.
export function assertResult(query: string, document: string, values: string, paths: string): void {
  assert.deepStrictEqual(
    run(query, document),
    { id: 't', result: { values: JSON.parse(values), paths: JSON.parse(paths) } },
    `${query} on ${document}`,
  );
}

export function assertInvalid(query: string, document = '{}'): void {
  assert.deepStrictEqual(run(query, document), { id: 't', error: 'invalid_query' }, query);
}
