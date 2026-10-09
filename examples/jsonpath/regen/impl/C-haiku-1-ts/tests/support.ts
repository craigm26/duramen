// Shared helpers for the tests: they send requests through the same path the driver uses.

import { answerLine } from "../protocol.ts";

export interface Response {
  id: unknown;
  result?: { values: unknown[]; paths: string[] };
  error?: string;
}

// One query request, with the document given as a JavaScript value.
export function ask(query: string, document: unknown): Response {
  const line = JSON.stringify({ id: "t", op: "query", input: { query, document } });
  return JSON.parse(answerLine(line) as string) as Response;
}

// The values a query selects, failing the test when the query gets an error.
export function valuesOf(query: string, document: unknown): unknown[] {
  const r = ask(query, document);
  if (r.result === undefined) throw new Error(`${query} gave ${r.error}`);
  return r.result.values;
}

// The Normalized Paths a query selects, failing the test when the query gets an error.
export function pathsOf(query: string, document: unknown): string[] {
  const r = ask(query, document);
  if (r.result === undefined) throw new Error(`${query} gave ${r.error}`);
  return r.result.paths;
}

export function errorOf(query: string, document: unknown): string | undefined {
  return ask(query, document).error;
}
