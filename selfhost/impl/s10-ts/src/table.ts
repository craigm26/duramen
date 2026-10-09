// Reads a `table <op>` clause: its rows are examples of the operation (REQ-SY-012).

import { parseJson } from "./text.ts";
import { report } from "./diags.ts";
import { parseNumber } from "./examples.ts";
import type { Example, Expect, ReadCtx } from "./model.ts";
import type { Clause } from "./structure.ts";

type Column =
  | { kind: "input"; name: string }
  | { kind: "expect"; path: string; tol: number | null };

// Reads the table `clause` of requirement `req`. Returns one example per row (a row with the
// wrong number of cells is reported and is not an example).
export function readTable(clause: Clause, req: string, ctx: ReadCtx): Example[] {
  const rows: { no: number; cells: string[] }[] = [];
  for (const bl of clause.lines) {
    if (bl.blank) continue;
    const text = bl.raw.trim();
    if (text.startsWith("#")) continue;
    if (bl.indent >= 4 && text.startsWith("|")) {
      if (!isSeparator(text)) rows.push({ no: bl.no, cells: cellsOf(text) });
    } else {
      report(ctx.diags, ctx.file, bl.no, "P006");
    }
  }

  const op = clause.rest;
  if (op === "" || /\s/.test(op)) {
    report(ctx.diags, ctx.file, clause.line, "P013");
    return [];
  }
  if (rows.length < 2) {
    report(ctx.diags, ctx.file, clause.line, "P013");
    return [];
  }

  const columns = readHeader(rows[0].cells, rows[0].no, ctx);
  if (columns === null) return [];

  const examples: Example[] = [];
  for (const row of rows.slice(1)) {
    if (row.cells.length !== columns.length) {
      report(ctx.diags, ctx.file, row.no, "P014");
      continue;
    }
    const ex = readRow(row.no, row.cells, columns, req, op, ctx);
    if (ex) examples.push(ex);
  }
  return examples;
}

// A row of only |, -, : and spaces is a separator (REQ-SY-012).
function isSeparator(text: string): boolean {
  return /^\|[|:\- ]*$/.test(text) && text.endsWith("|");
}

// The cells of a row: the texts between its | characters, where \| is a | inside a cell.
function cellsOf(text: string): string[] {
  let s = text.slice(1);
  if (/(^|[^\\])\|$/.test(s)) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}

// Reads the header from the left (REQ-SY-012). Returns null when the table is not checked
// further.
function readHeader(cells: string[], line: number, ctx: ReadCtx): Column[] | null {
  const columns: Column[] = [];
  const names = new Set<string>();
  for (const cell of cells) {
    const tm = /^(.*?)\s*(±|\+-)\s*(.*)$/.exec(cell);
    const name = tm ? tm[1].trim() : cell;
    const tolText = tm ? tm[3].trim() : null;
    const isExpect = /^(result|audit|error|id)(\..*)?$/.test(name);
    const isInput = /^[A-Za-z0-9_-]+$/.test(name) && !isExpect;
    if ((!isExpect && !isInput) || names.has(name)) {
      report(ctx.diags, ctx.file, line, "P013");
      return null;
    }
    names.add(name);
    if (isInput) {
      if (tolText !== null) report(ctx.diags, ctx.file, line, "P010");
      columns.push({ kind: "input", name });
    } else {
      let tol: number | null = null;
      if (tolText !== null) {
        tol = parseNumber(tolText);
        if (tol === null || tol < 0) {
          report(ctx.diags, ctx.file, line, "P010");
          tol = null;
        }
      }
      columns.push({ kind: "expect", path: name, tol });
    }
  }
  return columns;
}

// One row as an example. Returns null when a cell has a problem (already reported).
function readRow(
  line: number,
  cells: string[],
  columns: Column[],
  req: string,
  op: string,
  ctx: ReadCtx,
): Example | null {
  const inputParts: string[] = [];
  const inputKeys: string[] = [];
  const expects: Expect[] = [];
  let ok = true;
  columns.forEach((col, j) => {
    const cell = cells[j];
    if (cell === "") return;
    if (col.kind === "input") {
      const p = parseJson(cell);
      if (!p.ok || p.bigNumber) {
        report(ctx.diags, ctx.file, line, "P009");
        ok = false;
        return;
      }
      inputParts.push(`"${col.name}":${cell}`);
      inputKeys.push(col.name);
      return;
    }
    if (cell === "?") {
      expects.push({ kind: "oracle", path: col.path, line });
    } else if (col.tol !== null) {
      const n = parseNumber(cell);
      if (n === null) {
        report(ctx.diags, ctx.file, line, "P010");
        ok = false;
        return;
      }
      expects.push({ kind: "approx", path: col.path, value: n, tol: col.tol, line });
    } else {
      const p = parseJson(cell);
      if (!p.ok || p.bigNumber) {
        report(ctx.diags, ctx.file, line, "P009");
        ok = false;
        return;
      }
      expects.push({ kind: "eq", path: col.path, value: p.value, line });
    }
  });
  if (!ok) return null;
  return {
    req,
    file: ctx.file,
    line,
    table: true,
    raw: null,
    op,
    inputText: `{${inputParts.join(",")}}`,
    inputKeys,
    request: null,
    omit: [],
    expects,
  };
}
