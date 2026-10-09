// Helpers for the tests: send a request through the driver's answer function, and the
// echo oracle of the examples (fixtures/echo.mjs).

import { readFileSync } from "node:fs";
import { answer } from "./serve.ts";

export const ECHO: string = readFileSync(new URL("../fixtures/echo.mjs", import.meta.url), "utf8");

// The files of a record that uses the echo oracle.
export function withEcho(files: Record<string, string>): Record<string, string> {
  return { ...files, "echo.mjs": ECHO };
}

// One request through the driver, answered as a line. Returns the response object.
export async function send(op: string, input: unknown, id = "t"): Promise<Record<string, unknown>> {
  const resp = await answer(JSON.stringify({ id, op, input }));
  return resp as unknown as Record<string, unknown>;
}

// `check` of a record: its diagnostics, as the driver writes them.
export async function checkOf(
  files: Record<string, string>,
  entry?: string,
): Promise<{ diagnostics: string[]; errors: number; warnings: number }> {
  const input: Record<string, unknown> = { files };
  if (entry !== undefined) input.entry = entry;
  const r = await send("check", input);
  return r.result as { diagnostics: string[]; errors: number; warnings: number };
}

export async function diagsOf(files: Record<string, string>, entry?: string): Promise<string[]> {
  return (await checkOf(files, entry)).diagnostics;
}

// `cases` of a record: the response's result.
export async function casesOf(
  files: Record<string, string>,
  entry?: string,
): Promise<{ errors: number; cases: Record<string, unknown>[] }> {
  const input: Record<string, unknown> = { files };
  if (entry !== undefined) input.entry = entry;
  const r = await send("cases", input);
  return r.result as { errors: number; cases: Record<string, unknown>[] };
}

// A record with the echo oracle at the root, and the given `.duramen` text as s.duramen.
export function oneFile(text: string): Record<string, string> {
  return withEcho({ "s.duramen": text });
}
