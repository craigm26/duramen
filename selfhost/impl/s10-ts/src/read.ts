// Reads a record's files into the record model, and reports the problems of its form: the
// P codes (REQ-RC-003, REQ-RC-004, REQ-SY-004 to REQ-SY-012).

import { firstWord, parseJson } from "./text.ts";
import { report, type Diag } from "./diags.ts";
import { readStructure, type Clause, type Statement } from "./structure.ts";
import { readExample, readRequest, parseNumber } from "./examples.ts";
import { readTable } from "./table.ts";
import type { Files, RecordFiles } from "./files.ts";
import type {
  Decision,
  Note,
  Open,
  Operation,
  RecordModel,
  ReadCtx,
  Requirement,
  Section,
  Spec,
  Text,
} from "./model.ts";

const PLATFORMS = ["any", "posix", "windows"];
const VERSIONS = ["0.1", "0.2"];

// Reads the record `rec` (its files are members of `files`). Problems are added to `diags`.
export function readRecord(rec: RecordFiles, files: Files, diags: Diag[]): RecordModel {
  const model: RecordModel = {
    name: rec.name,
    folder: rec.folder,
    files,
    memberFiles: rec.members,
    specs: [],
    oracles: [],
    ops: [],
    reqs: [],
    opens: [],
    decisions: [],
    sections: [],
    notes: [],
    errorCodes: [],
    examples: [],
    reqIds: [],
    openIds: [],
  };
  const versions = new Set<string>();
  const counts = { spec: 0, oracle: 0, errors: 0 };

  for (const name of rec.members) {
    const ctx: ReadCtx = { file: name, recordFolder: rec.folder, files, diags };
    const structure = readStructure(name, files[name], diags);
    let duramenCount = 0;
    for (const st of structure.statements) {
      if (st.ignored) continue;
      switch (st.kw) {
        case "duramen": {
          if (duramenCount === 0) {
            if (VERSIONS.includes(st.rest)) versions.add(st.rest);
            else report(diags, name, st.line, "P023");
          } else {
            report(diags, name, st.line, "P023");
          }
          duramenCount++;
          noClauses(st, ctx);
          break;
        }
        case "spec":
          if (counts.spec++ > 0) report(diags, name, st.line, "P044");
          readSpec(st, model, ctx);
          break;
        case "oracle":
          if (counts.oracle++ > 0) report(diags, name, st.line, "P044");
          readOracle(st, model, ctx);
          break;
        case "errors":
          if (counts.errors++ > 0) report(diags, name, st.line, "P032");
          readErrors(st, model, ctx);
          break;
        case "op":
          readOp(st, model, ctx);
          break;
        case "req":
          readReq(st, model, ctx);
          break;
        case "open":
          readOpen(st, model, ctx);
          break;
        case "decision":
          readDecision(st, model, ctx);
          break;
        case "section":
          readSection(st, model, ctx);
          break;
        case "note":
          readNote(st, model, ctx);
          break;
      }
    }
    if (duramenCount === 0) report(diags, name, 1, "P020");
  }

  if (model.specs.length === 0) report(diags, rec.name, 1, "P021");
  if (versions.size > 1) report(diags, rec.name, 1, "P047");

  for (const r of model.reqs) model.examples.push(...r.examples);
  return model;
}

// A statement that takes no clauses: each clause is P015 and its lines are ignored.
function noClauses(st: Statement, ctx: ReadCtx): void {
  for (const c of st.clauses) report(ctx.diags, ctx.file, c.line, "P015");
}

// The first clause of its kind is read; a second is P052 and its lines are ignored (REQ-SY-003).
function first(seen: Set<string>, c: Clause, ctx: ReadCtx): boolean {
  if (seen.has(c.kw)) {
    report(ctx.diags, ctx.file, c.line, "P052");
    return false;
  }
  seen.add(c.kw);
  return true;
}

// A clause that takes no lines: a line under it that is neither blank nor a comment is P006.
function noLines(c: Clause, ctx: ReadCtx): void {
  for (const bl of c.lines) {
    if (!bl.blank && !bl.raw.trimStart().startsWith("#")) report(ctx.diags, ctx.file, bl.no, "P006");
  }
}

// The text of a text clause (REQ-SY-005): its lines, indented four spaces or more.
function textOf(c: Clause, ctx: ReadCtx): Text {
  if (c.rest !== "") report(ctx.diags, ctx.file, c.line, "P008");
  const lines: string[] = [];
  for (const bl of c.lines) {
    if (bl.blank) {
      lines.push("");
    } else if (bl.indent === 3) {
      report(ctx.diags, ctx.file, bl.no, "P008");
    } else {
      lines.push(bl.raw.slice(4));
    }
  }
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return { line: c.line, lines };
}

// The ID and quoted title of `req`, `open`, `decision` and `section` (REQ-SY-006).
function idAndTitle(rest: string, line: number, ctx: ReadCtx): { id: string; title: string | null } {
  const m = /^(\S*)\s*([\s\S]*)$/.exec(rest);
  const id = m ? m[1] : "";
  const title = m ? m[2] : "";
  if (id === "" || title.length < 2 || !title.startsWith('"') || !title.endsWith('"')) {
    report(ctx.diags, ctx.file, line, "P005");
    return { id, title: null };
  }
  const p = parseJson(title);
  if (!p.ok || typeof p.value !== "string") {
    report(ctx.diags, ctx.file, line, "P004");
    return { id, title: null };
  }
  return { id, title: p.value };
}

function readSpec(st: Statement, model: RecordModel, ctx: ReadCtx): void {
  const parts = st.rest.split(/\s+/).filter((p) => p !== "");
  if (parts.length !== 2) report(ctx.diags, ctx.file, st.line, "P021");
  const spec: Spec = {
    file: ctx.file,
    line: st.line,
    name: parts[0] ?? "",
    title: null,
    text: null,
    request: null,
  };
  const seen = new Set<string>();
  for (const c of st.clauses) {
    if (c.kw === "title") {
      if (!first(seen, c, ctx)) continue;
      noLines(c, ctx);
      const p = parseJson(c.rest);
      if (p.ok && typeof p.value === "string") spec.title = p.value;
      else report(ctx.diags, ctx.file, c.line, "P004");
    } else if (c.kw === "text") {
      if (first(seen, c, ctx)) spec.text = textOf(c, ctx);
    } else if (c.kw === "contract") {
      if (first(seen, c, ctx)) noLines(c, ctx);
    } else if (c.kw === "request") {
      if (!first(seen, c, ctx)) continue;
      noLines(c, ctx);
      const r = readRequest(c.rest, c.line, ctx);
      if (r) spec.request = r;
    } else {
      report(ctx.diags, ctx.file, c.line, "P015");
    }
  }
  model.specs.push(spec);
}

function readOracle(st: Statement, model: RecordModel, ctx: ReadCtx): void {
  if (st.rest === "") report(ctx.diags, ctx.file, st.line, "P028");
  model.oracles.push({ file: ctx.file, line: st.line, command: st.rest });
  for (const c of st.clauses) {
    if (c.kw === "source") {
      noLines(c, ctx);
    } else {
      report(ctx.diags, ctx.file, c.line, "P015");
    }
  }
}

// Each clause of an errors list is `<code> when <condition>` (REQ-SY-008).
function readErrors(st: Statement, model: RecordModel, ctx: ReadCtx): void {
  if (st.rest !== "") report(ctx.diags, ctx.file, st.line, "P050");
  for (const c of st.clauses) {
    const w = firstWord(c.rest);
    const condition: string[] = [];
    if (w.word !== "when" || w.after === "") {
      report(ctx.diags, ctx.file, c.line, "P019");
    } else {
      condition.push(w.after);
    }
    for (const bl of c.lines) {
      if (bl.blank) continue;
      if (bl.indent === 3) {
        report(ctx.diags, ctx.file, bl.no, "P006");
        continue;
      }
      condition.push(bl.raw.trim());
    }
    model.errorCodes.push({
      code: c.kw,
      file: ctx.file,
      line: c.line,
      condition: { line: c.line, lines: condition },
    });
  }
}

// Splits `input` fields on commas outside quotes, brackets, braces and parentheses.
export function splitFields(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let inQuote = false;
  for (const ch of s) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (!inQuote && "([{".includes(ch)) {
      depth++;
    } else if (!inQuote && ")]}".includes(ch)) {
      depth = Math.max(0, depth - 1);
    } else if (ch === "," && !inQuote && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function readOp(st: Statement, model: RecordModel, ctx: ReadCtx): void {
  const valid = st.rest !== "" && !/\s/.test(st.rest);
  if (!valid) report(ctx.diags, ctx.file, st.line, "P031");
  const op: Operation = {
    name: valid ? st.rest : "",
    file: ctx.file,
    line: st.line,
    inputs: [],
    result: null,
    audit: false,
    request: null,
    tolerances: [],
  };
  const seen = new Set<string>();
  const tolerancePaths = new Set<string>();
  for (const c of st.clauses) {
    if (c.kw === "input") {
      for (const part of splitFields(c.rest)) {
        const m = /^([A-Za-z0-9_-]+)(\?)?\s+(\S.*)$/.exec(part.trim());
        if (!m) {
          report(ctx.diags, ctx.file, c.line, "P017");
          continue;
        }
        if (op.inputs.some((f) => f.name === m[1])) {
          report(ctx.diags, ctx.file, c.line, "P052");
          continue;
        }
        op.inputs.push({ name: m[1], optional: m[2] === "?", line: c.line });
      }
      noLines(c, ctx);
    } else if (c.kw === "result") {
      if (!first(seen, c, ctx)) continue;
      noLines(c, ctx);
      op.result = { line: c.line, lines: c.rest === "" ? [] : [c.rest] };
    } else if (c.kw === "tolerance") {
      // A tolerance that is not valid does not count as the one for its path (REQ-SY-007).
      const w = firstWord(c.rest);
      if (tolerancePaths.has(w.word)) {
        report(ctx.diags, ctx.file, c.line, "P052");
        continue;
      }
      noLines(c, ctx);
      const value = parseNumber(w.after);
      if (value === null || value < 0 || w.word === "") {
        report(ctx.diags, ctx.file, c.line, "P018");
      } else {
        tolerancePaths.add(w.word);
        op.tolerances.push({ path: w.word, value, line: c.line });
      }
    } else if (c.kw === "audit") {
      if (!first(seen, c, ctx)) continue;
      noLines(c, ctx);
      if (c.rest !== "" && c.rest !== "text") report(ctx.diags, ctx.file, c.line, "P050");
      op.audit = true;
    } else if (c.kw === "request") {
      if (!first(seen, c, ctx)) continue;
      noLines(c, ctx);
      op.request = readRequest(c.rest, c.line, ctx);
    } else {
      report(ctx.diags, ctx.file, c.line, "P015");
    }
  }
  if (valid) model.ops.push(op);
}

function readReq(st: Statement, model: RecordModel, ctx: ReadCtx): void {
  const { id } = idAndTitle(st.rest, st.line, ctx);
  const req: Requirement = {
    id,
    file: ctx.file,
    line: st.line,
    platform: "any",
    text: null,
    decisions: [],
    examples: [],
    tableLines: [],
  };
  const seen = new Set<string>();
  for (const c of st.clauses) {
    if (c.kw === "text") {
      if (first(seen, c, ctx)) req.text = textOf(c, ctx);
    } else if (c.kw === "decision") {
      noLines(c, ctx);
      for (const d of c.rest.split(/[\s,]+/)) {
        if (d !== "") req.decisions.push({ id: d, line: c.line });
      }
    } else if (c.kw === "on") {
      if (!first(seen, c, ctx)) continue;
      noLines(c, ctx);
      if (PLATFORMS.includes(c.rest)) req.platform = c.rest as Requirement["platform"];
      else report(ctx.diags, ctx.file, c.line, "P033");
    } else if (c.kw === "example") {
      const ex = readExample(c, id, ctx);
      if (ex) req.examples.push(ex);
    } else if (c.kw === "table") {
      req.examples.push(...readTable(c, id, ctx));
      req.tableLines.push(c.line);
    } else {
      report(ctx.diags, ctx.file, c.line, "P015");
    }
  }
  model.reqs.push(req);
  model.reqIds.push({ id, file: ctx.file, line: st.line });
}

function readOpen(st: Statement, model: RecordModel, ctx: ReadCtx): void {
  const { id } = idAndTitle(st.rest, st.line, ctx);
  const open: Open = { id, file: ctx.file, line: st.line, text: null, reportedClauses: [] };
  const seen = new Set<string>();
  for (const c of st.clauses) {
    if (c.kw === "text") {
      if (first(seen, c, ctx)) open.text = textOf(c, ctx);
    } else if (c.kw === "example" || c.kw === "table") {
      // Open items are not tested: these clauses are reported and not read (REQ-CK-007).
      open.reportedClauses.push(c.line);
    } else {
      report(ctx.diags, ctx.file, c.line, "P015");
    }
  }
  model.opens.push(open);
  model.openIds.push({ id, file: ctx.file, line: st.line });
}

function readDecision(st: Statement, model: RecordModel, ctx: ReadCtx): void {
  const { id } = idAndTitle(st.rest, st.line, ctx);
  const dec: Decision = {
    id,
    file: ctx.file,
    line: st.line,
    status: null,
    source: null,
    text: null,
    rejected: [],
  };
  const seen = new Set<string>();
  for (const c of st.clauses) {
    if (c.kw === "source") {
      if (!first(seen, c, ctx)) continue;
      noLines(c, ctx);
      dec.source = c.rest;
    } else if (c.kw === "status") {
      if (!first(seen, c, ctx)) continue;
      noLines(c, ctx);
      dec.status = { text: c.rest };
    } else if (c.kw === "text") {
      if (first(seen, c, ctx)) dec.text = textOf(c, ctx);
    } else if (c.kw === "rejected") {
      noLines(c, ctx);
      const p = parseJson(c.rest);
      if (p.ok && typeof p.value === "string") dec.rejected.push({ text: p.value, line: c.line });
      else report(ctx.diags, ctx.file, c.line, "P004");
    } else {
      report(ctx.diags, ctx.file, c.line, "P015");
    }
  }
  model.decisions.push(dec);
}

function readSection(st: Statement, model: RecordModel, ctx: ReadCtx): void {
  const { id } = idAndTitle(st.rest, st.line, ctx);
  const section: Section = { id, file: ctx.file, line: st.line, text: null };
  const seen = new Set<string>();
  for (const c of st.clauses) {
    if (c.kw === "text") {
      if (first(seen, c, ctx)) section.text = textOf(c, ctx);
    } else {
      report(ctx.diags, ctx.file, c.line, "P015");
    }
  }
  model.sections.push(section);
}

function readNote(st: Statement, model: RecordModel, ctx: ReadCtx): void {
  if (st.rest !== "") report(ctx.diags, ctx.file, st.line, "P050");
  const note: Note = { file: ctx.file, line: st.line, text: null };
  const seen = new Set<string>();
  for (const c of st.clauses) {
    if (c.kw === "text") {
      if (first(seen, c, ctx)) note.text = textOf(c, ctx);
    } else {
      report(ctx.diags, ctx.file, c.line, "P015");
    }
  }
  model.notes.push(note);
}
