// Reads a file into statements and their clauses (REQ-SY-001, REQ-SY-002, REQ-SY-003).
// The meaning of each statement and clause is decided by the reader (read.ts).

import { indentOf, isBlank, splitLines } from "./text.ts";
import { report, type Diag } from "./diags.ts";

// One line of a body, with its indent. Blank lines are kept (text clauses need them).
export type BodyLine = { no: number; indent: number; raw: string; blank: boolean };

export type Clause = { kw: string; rest: string; line: number; lines: BodyLine[] };

export type Statement = {
  kw: string;
  rest: string;
  line: number;
  // Clauses in the order written; empty for a statement whose body is ignored.
  clauses: Clause[];
  // True for a statement whose keyword is unknown, or belongs to the rest of the language
  // (OPEN-RC-001). Its body is ignored.
  ignored: boolean;
};

export type FileStructure = { name: string; statements: Statement[] };

// The statements of the core language (REQ-SY-002).
export const CORE_STATEMENTS = new Set([
  "duramen", "spec", "oracle", "section", "op", "errors", "req", "open", "decision", "note",
]);

// Statements that belong to the rest of the language (OPEN-RC-001). They are recognized and
// their bodies ignored, without a diagnostic.
export const OPEN_STATEMENTS = new Set(["type", "edge", "edgedef", "property", "evidence"]);

export function readStructure(name: string, source: string, diags: Diag[]): FileStructure {
  const statements: Statement[] = [];
  let cur: Statement | null = null;
  let clause: Clause | null = null;

  for (const line of splitLines(source)) {
    if (isBlank(line.text)) {
      if (cur && clause && !cur.ignored) clause.lines.push(blankBody(line.no));
      continue;
    }
    const { spaces, leadingBad, rest } = indentOf(line.text);
    if (leadingBad) {
      report(diags, name, line.no, "P001");
      continue;
    }

    if (spaces === 0) {
      if (rest.startsWith("#")) continue;
      const first = firstWordOf(rest);
      const ignored = !CORE_STATEMENTS.has(first.word);
      if (!CORE_STATEMENTS.has(first.word) && !OPEN_STATEMENTS.has(first.word)) {
        report(diags, name, line.no, "P002");
      }
      cur = { kw: first.word, rest: first.after, line: line.no, clauses: [], ignored: ignored || OPEN_STATEMENTS.has(first.word) };
      statements.push(cur);
      clause = null;
      continue;
    }

    if (!cur) {
      report(diags, name, line.no, "P003");
      continue;
    }
    if (cur.ignored) continue;

    if (spaces === 1) {
      report(diags, name, line.no, "P007");
      continue;
    }
    if (spaces === 2) {
      if (rest.startsWith("#")) continue;
      const first = firstWordOf(rest);
      clause = { kw: first.word, rest: first.after, line: line.no, lines: [] };
      cur.clauses.push(clause);
      continue;
    }
    // Three spaces or more belong to the latest clause (REQ-SY-003).
    if (!clause) {
      report(diags, name, line.no, "P006");
      continue;
    }
    clause.lines.push({ no: line.no, indent: spaces, raw: line.text, blank: false });
  }

  return { name, statements };
}

function blankBody(no: number): BodyLine {
  return { no, indent: 0, raw: "", blank: true };
}

// The first word of a text and the text after it, with the white space between removed.
function firstWordOf(text: string): { word: string; after: string } {
  const trimmed = text.replace(/^\s+/, "");
  const m = /^(\S*)\s*([\s\S]*)$/.exec(trimmed);
  return m ? { word: m[1], after: m[2].replace(/\s+$/, "") } : { word: "", after: "" };
}
