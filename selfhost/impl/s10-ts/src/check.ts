// The two operations of the checker: `check`, which reports a record's diagnostics, and
// `cases`, which lists the suite generated from it (SPEC.md, Interface).

import { formatDiag, report, sortDiags, type Diag } from "./diags.ts";
import { recordFiles, type Files } from "./files.ts";
import { checkAnswers, checkRecord } from "./checks.ts";
import { runOracle } from "./oracle.ts";
import { itemsOf, type Item } from "./requests.ts";
import { readRecord } from "./read.ts";
import { buildCases, type Case } from "./cases.ts";
import type { Example, RecordModel } from "./model.ts";

export type Analysis = {
  diags: Diag[];
  model: RecordModel | null;
  items: Item[];
  answers: Map<Example, Record<string, unknown>>;
};

// Reads the record named by `entry` and runs its checks and its examples. When reading finds a
// P error, the checks do not run (REQ-RC-005).
export async function analyze(files: Files, entry: string | undefined): Promise<Analysis> {
  const diags: Diag[] = [];
  const rec = recordFiles(files, entry);
  if (rec === null) {
    report(diags, entry ?? ".", 1, "P046");
    return { diags, model: null, items: [], answers: new Map() };
  }
  const model = readRecord(rec, files, diags);
  if (diags.some((d) => d.level === "error" && d.code.startsWith("P"))) {
    return { diags, model: null, items: [], answers: new Map() };
  }
  checkRecord(model, diags);
  const items = itemsOf(model);
  const answers = await runOracle(model, items, files, diags);
  checkAnswers(model, items, answers, diags);
  return { diags, model, items, answers };
}

export function countLevel(diags: Diag[], level: Diag["level"]): number {
  return diags.filter((d) => d.level === level).length;
}

export async function check(files: Files, entry: string | undefined) {
  const a = await analyze(files, entry);
  const diagnostics = sortDiags(a.diags);
  return {
    diagnostics: diagnostics.map(formatDiag),
    errors: countLevel(a.diags, "error"),
    warnings: countLevel(a.diags, "warning"),
  };
}

export async function cases(files: Files, entry: string | undefined): Promise<{ errors: number; cases: Case[] }> {
  const a = await analyze(files, entry);
  const errors = countLevel(a.diags, "error");
  if (errors !== 0 || a.model === null) return { errors, cases: [] };
  return { errors, cases: buildCases(a.model, a.items, a.answers) };
}
