// Runs the oracle of a record on its examples (REQ-OR-002, REQ-OR-004, REQ-OR-005).

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { report, type Diag } from "./diags.ts";
import { isRun, requestLine, type Item } from "./requests.ts";
import { parseJson, isPlainObject } from "./text.ts";
import type { Example, RecordModel } from "./model.ts";
import type { Files } from "./files.ts";

// How long one run of the oracle may take (OPEN-RQ-001 leaves this open). A run that takes
// longer is stopped, and is reported as T020.
export const ORACLE_TIMEOUT_MS = 10000;

// Splits the oracle command into words at spaces and tabs; a word may be quoted to hold
// spaces (REQ-OR-002). Returns null when a quote is not closed.
export function splitCommand(s: string): string[] | null {
  const words: string[] = [];
  let cur = "";
  let inWord = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t") {
      if (inWord) {
        words.push(cur);
        cur = "";
        inWord = false;
      }
      i++;
      continue;
    }
    inWord = true;
    if (ch === '"') {
      i++;
      let closed = false;
      while (i < s.length) {
        if (s[i] === "\\" && s[i + 1] === '"') {
          cur += '"';
          i += 2;
        } else if (s[i] === '"') {
          closed = true;
          i++;
          break;
        } else {
          cur += s[i];
          i++;
        }
      }
      if (!closed) return null;
      continue;
    }
    if (ch === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) return null;
      cur += s.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    cur += ch;
    i++;
  }
  if (inWord) words.push(cur);
  return words;
}

type RunResult = { started: boolean; stdout: string; ok: boolean };

// Starts the command without a shell in `cwd`, writes `input` to it and reads its output.
function run(words: string[], cwd: string, input: string): Promise<RunResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    const finish = (r: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = spawn(words[0], words.slice(1), { cwd, stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      child.kill();
      finish({ started: true, stdout, ok: false });
    }, ORACLE_TIMEOUT_MS);
    child.on("error", () => finish({ started: false, stdout: "", ok: false }));
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stdin.on("error", () => {});
    child.on("close", (code, signal) => {
      finish({ started: true, stdout, ok: code === 0 && signal === null });
    });
    child.stdin.end(input);
  });
}

// The responses of a run: lines of standard output, without the empty ones.
function linesOf(stdout: string): string[] {
  return stdout.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim() !== "");
}

// A response is a JSON object without a number too large to be finite (REQ-OR-002).
function responseOf(line: string): Record<string, unknown> | null {
  const p = parseJson(line);
  if (!p.ok || p.bigNumber || !isPlainObject(p.value)) return null;
  return p.value;
}

// Runs the oracle on the examples that are run (REQ-OR-002) and returns each one's response,
// by example. An example without a response is absent from the map (T021 is the caller's).
export async function runOracle(
  model: RecordModel,
  items: Item[],
  files: Files,
  diags: Diag[],
): Promise<Map<Example, Record<string, unknown>>> {
  const answers = new Map<Example, Record<string, unknown>>();
  const oracle = model.oracles[0];
  if (!oracle) return answers;
  const runSet = items.filter((it) => isRun(model, it.ex));
  if (runSet.length === 0) return answers;

  const words = splitCommand(oracle.command);
  const batch = runSet.filter((it) => !it.solo);
  const solo = runSet.filter((it) => it.solo);

  const root = await mkdtemp(join(tmpdir(), "duramen-oracle-"));
  try {
    for (const name of Object.keys(files)) {
      const path = join(root, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, files[name], "utf8");
    }
    const cwd = join(root, dirname(oracle.file) === "." ? "" : dirname(oracle.file));
    await mkdir(cwd, { recursive: true });

    if (batch.length > 0) {
      const lines = batch.map((it) => requestLine(it, model));
      const r = words && words.length > 0
        ? await run(words, cwd, lines.map((l) => l + "\n").join(""))
        : { started: false, stdout: "", ok: false };
      if (!r.started || !r.ok) report(diags, oracle.file, oracle.line, "T020");
      const byId = new Map<string, Record<string, unknown>>();
      for (const line of linesOf(r.stdout)) {
        const obj = responseOf(line);
        if (obj && typeof obj.id === "string" && !byId.has(obj.id)) byId.set(obj.id, obj);
      }
      for (const it of batch) {
        const resp = byId.get(it.id);
        if (resp) answers.set(it.ex, resp);
      }
    }

    for (const it of solo) {
      const line = requestLine(it, model);
      const r = words && words.length > 0
        ? await run(words, cwd, line + "\n")
        : { started: false, stdout: "", ok: false };
      if (!r.started || !r.ok) report(diags, it.ex.file, it.ex.line, "T020");
      const out = linesOf(r.stdout);
      if (out.length === 1) {
        const resp = responseOf(out[0]);
        if (resp) answers.set(it.ex, resp);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  return answers;
}
