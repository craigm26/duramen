// Reads an `example` clause: its first line, and the lines under it (REQ-SY-010, REQ-SY-011).

import { firstWord, isPlainObject, parseJson } from "./text.ts";
import { assignPath } from "./jsonpath.ts";
import { report } from "./diags.ts";
import { parentOf, resolveInside } from "./files.ts";
import type { Clause } from "./structure.ts";
import type { Example, Expect, ReadCtx } from "./model.ts";

// The first line of an example. `rawForm` is true for `example raw` even when the line is
// malformed: the lines under it are then read as a raw example's (REQ-SY-010).
type Head = {
  raw: string | null;
  rawForm: boolean;
  // True when the first line has a problem, so the example is dropped (REQ-SY-010).
  dropped: boolean;
  op: string | null;
  inputText: string | null;
  inputObj: Record<string, unknown> | null;
};

// An `input` line whose text is still being read (REQ-SY-011).
type Block = {
  line: number;
  path: string[] | null;
  skip: boolean;
  lines: string[];
};

// Reads the example clause `clause` of requirement `req`. Returns null for a dropped example:
// one whose first line has a problem. Its lines are read all the same.
export function readExample(clause: Clause, req: string, ctx: ReadCtx): Example | null {
  const head = readHead(clause.rest, clause.line, ctx);
  const dropped = head === null || head.dropped;
  const rawForm = head?.rawForm ?? false;
  const raw = head?.raw ?? null;
  const obj: Record<string, unknown> = head?.inputObj ? head.inputObj : {};
  let usedInputLine = false;
  let request: Record<string, unknown> | null = null;
  let requestRead = false;
  const omit: string[] = [];
  const expects: Expect[] = [];
  let block: Block | null = null;

  const finish = (): void => {
    if (!block) return;
    const b = block;
    block = null;
    if (b.skip || b.path === null) return;
    while (b.lines.length > 0 && b.lines[b.lines.length - 1] === "") b.lines.pop();
    if (b.lines.length === 0) {
      report(ctx.diags, ctx.file, b.line, "P049");
      return;
    }
    const text = b.lines.map((l) => l + "\n").join("");
    applyInput(b.path, text, b.line);
  };

  const applyInput = (path: string[], value: unknown, line: number): void => {
    if (dropped) return;
    if (assignPath(obj, path, value)) {
      usedInputLine = true;
    } else {
      report(ctx.diags, ctx.file, line, "P049");
    }
  };

  for (const bl of clause.lines) {
    if (block && bl.blank) {
      block.lines.push("");
      continue;
    }
    if (block && bl.indent >= 6) {
      if (!block.skip) block.lines.push(bl.raw.slice(6));
      continue;
    }
    finish();
    if (bl.blank) continue;
    const text = bl.raw.trim();
    if (text.startsWith("#")) continue;
    if (bl.indent !== 4) {
      report(ctx.diags, ctx.file, bl.no, "P006");
      continue;
    }
    const w = firstWord(text);
    if (w.word === "expect") {
      const e = readExpect(w.after, bl.no, ctx);
      if (e) expects.push(e);
    } else if (w.word === "request") {
      if (rawForm) {
        report(ctx.diags, ctx.file, bl.no, "P022");
      } else if (requestRead) {
        report(ctx.diags, ctx.file, bl.no, "P052");
      } else {
        const r = readRequest(w.after, bl.no, ctx);
        if (r) {
          request = r;
          requestRead = true;
        }
      }
    } else if (w.word === "omit") {
      if (rawForm) {
        report(ctx.diags, ctx.file, bl.no, "P022");
      } else {
        const names = w.after.split(/[\s,]+/).filter((n) => n !== "");
        if (names.length === 0) report(ctx.diags, ctx.file, bl.no, "P011");
        omit.push(...names);
      }
    } else if (w.word === "input") {
      block = readInputLine(w.after, bl.no, rawForm, ctx, applyInput);
    } else {
      report(ctx.diags, ctx.file, bl.no, "P011");
    }
  }
  finish();

  if (dropped || head === null) return null;
  const inputText = usedInputLine ? JSON.stringify(obj) : head.inputText;
  return {
    req,
    file: ctx.file,
    line: clause.line,
    table: false,
    raw,
    op: head.op,
    inputText: raw !== null ? null : inputText,
    inputKeys: raw !== null ? [] : Object.keys(obj),
    request,
    omit,
    expects,
  };
}

function readHead(rest: string, line: number, ctx: ReadCtx): Head {
  const dropped: Head = { raw: null, rawForm: false, op: null, inputText: null, inputObj: null, dropped: true };
  if (rest === "") {
    report(ctx.diags, ctx.file, line, "P012");
    return dropped;
  }
  const w = firstWord(rest);
  if (w.word === "raw") {
    const after = w.after;
    const rawDropped: Head = { ...dropped, rawForm: true };
    if (after.startsWith('"')) {
      const p = parseJson(after);
      if (p.ok && typeof p.value === "string") {
        if (/[\r\n]/.test(p.value)) {
          report(ctx.diags, ctx.file, line, "P026");
          return rawDropped;
        }
        return { raw: p.value, rawForm: true, op: null, inputText: null, inputObj: null, dropped: false };
      }
      report(ctx.diags, ctx.file, line, "P004");
      return rawDropped;
    }
    if (after.length >= 2 && after.startsWith("'") && after.endsWith("'")) {
      return { raw: after.slice(1, -1), rawForm: true, op: null, inputText: null, inputObj: null, dropped: false };
    }
    report(ctx.diags, ctx.file, line, "P004");
    return rawDropped;
  }
  if (w.after === "") {
    return { raw: null, rawForm: false, op: w.word, inputText: null, inputObj: null, dropped: false };
  }
  const p = parseJson(w.after);
  if (!p.ok || p.bigNumber) {
    report(ctx.diags, ctx.file, line, "P009");
    return dropped;
  }
  if (!isPlainObject(p.value)) {
    report(ctx.diags, ctx.file, line, "P012");
    return dropped;
  }
  return { raw: null, rawForm: false, op: w.word, inputText: w.after, inputObj: p.value, dropped: false };
}

// `expect <path> = <JSON>`, `expect <path> ≈ <number> ± <tolerance>` and `expect <path> = ?`
// (REQ-SY-010). `after` is the text after the word `expect`.
function readExpect(after: string, line: number, ctx: ReadCtx): Expect | null {
  const m = /^([^\s=≈~]*)\s*([\s\S]*)$/.exec(after.trim());
  const path = m ? m[1] : "";
  const tail = m ? m[2] : "";
  if (path === "") {
    report(ctx.diags, ctx.file, line, "P011");
    return null;
  }
  if (tail.startsWith("=")) {
    const v = tail.slice(1).trim();
    if (v === "?") return { kind: "oracle", path, line };
    const p = parseJson(v);
    if (!p.ok || p.bigNumber) {
      report(ctx.diags, ctx.file, line, "P009");
      return null;
    }
    return { kind: "eq", path, value: p.value, line };
  }
  if (tail.startsWith("≈") || tail.startsWith("~")) {
    const mm = /^(.*?)\s*(±|\+-)\s*(.*)$/.exec(tail.slice(1).trim());
    const value = mm ? parseNumber(mm[1]) : null;
    const tol = mm ? parseNumber(mm[3]) : null;
    if (value === null || tol === null || tol < 0) {
      report(ctx.diags, ctx.file, line, "P010");
      return null;
    }
    return { kind: "approx", path, value, tol, line };
  }
  report(ctx.diags, ctx.file, line, "P011");
  return null;
}

// A JSON number that is finite, or null (REQ-SY-013).
export function parseNumber(text: string): number | null {
  const p = parseJson(text);
  if (!p.ok || p.bigNumber || typeof p.value !== "number") return null;
  return p.value;
}

// `request <JSON object>` (REQ-SY-004, REQ-SY-010). Returns the object when it is read.
export function readRequest(text: string, line: number, ctx: ReadCtx): Record<string, unknown> | null {
  const p = parseJson(text);
  if (!p.ok || p.bigNumber || !isPlainObject(p.value)) {
    report(ctx.diags, ctx.file, line, "P009");
    return null;
  }
  const obj = p.value;
  if (["id", "op", "input"].some((k) => Object.prototype.hasOwnProperty.call(obj, k))) {
    report(ctx.diags, ctx.file, line, "P051");
    return null;
  }
  return obj;
}

// `input <path>` and `input <path> from "<file>"` (REQ-SY-011). Returns the block that takes
// the text under the line, or null for the form that reads a file.
function readInputLine(
  after: string,
  line: number,
  raw: boolean,
  ctx: ReadCtx,
  applyInput: (path: string[], value: unknown, line: number) => void,
): Block | null {
  if (raw) {
    report(ctx.diags, ctx.file, line, "P022");
    return { line, path: null, skip: true, lines: [] };
  }
  const from = /^(.*?)\s+from\s+("(?:[^"\\]|\\.)*")$/.exec(after);
  if (from) {
    const path = parseInputPath(from[1]);
    const name = parseJson(from[2]);
    if (path === null || !name.ok || typeof name.value !== "string") {
      report(ctx.diags, ctx.file, line, "P049");
      return null;
    }
    const full = resolveInside(parentOf(ctx.file), name.value, ctx.recordFolder);
    const text = full === null ? undefined : ctx.files[full];
    if (text === undefined) {
      report(ctx.diags, ctx.file, line, "P048");
      return null;
    }
    applyInput(path, text, line);
    return null;
  }
  const path = parseInputPath(after);
  if (path === null) report(ctx.diags, ctx.file, line, "P049");
  return { line, path, skip: false, lines: [] };
}

// A path for an input: names separated by dots, each a word or a quoted string (REQ-SY-011).
export function parseInputPath(s: string): string[] | null {
  const names: string[] = [];
  let i = 0;
  for (;;) {
    if (s[i] === '"') {
      const m = /^"(?:[^"\\]|\\.)*"/.exec(s.slice(i));
      if (!m) return null;
      const p = parseJson(m[0]);
      if (!p.ok || typeof p.value !== "string") return null;
      names.push(p.value);
      i += m[0].length;
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(s.slice(i));
      if (!m) return null;
      names.push(m[0]);
      i += m[0].length;
    }
    if (i === s.length) return names;
    if (s[i] !== ".") return null;
    i++;
  }
}
