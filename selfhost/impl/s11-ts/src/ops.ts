// The operations `check` and `cases`.

import { checkRecord } from './checker.ts';
import { resolveRecord, type Files } from './files.ts';
import { compareUnits, type Json } from './json.ts';
import type { Diagnostic, Example, Record } from './model.ts';
import { readRecord } from './reader.ts';
import { buildCases, type Outcome } from './suite.ts';

const LEVELS = { error: 0, warning: 1, info: 2 };

/** Orders diagnostics by file, line, code and level (REQ-RC-006). */
export function sortDiagnostics(diags: Diagnostic[]): Diagnostic[] {
  return [...diags].sort((a, b) =>
    compareUnits(a.file, b.file) || a.line - b.line || compareUnits(a.code, b.code) || LEVELS[a.level] - LEVELS[b.level]);
}

export function formatDiagnostic(d: Diagnostic): string {
  return `${d.file}:${d.line}: ${d.level} ${d.code}`;
}

interface Analysis {
  diags: Diagnostic[];
  record?: Record;
  outcomes: Map<Example, Outcome>;
}

async function analyze(files: Files, entry: string): Promise<Analysis> {
  const resolved = resolveRecord(files, entry);
  if (!resolved.ok) {
    return { diags: [{ file: resolved.name, line: 1, level: 'error', code: 'P046' }], outcomes: new Map() };
  }
  const { record, diags } = readRecord(files, resolved.name, resolved.folder, resolved.files);
  if (diags.some((d) => d.level === 'error' && d.code.startsWith('P'))) {
    return { diags: sortDiagnostics(diags), record, outcomes: new Map() };
  }
  const checked = await checkRecord(record, files);
  return { diags: sortDiagnostics([...diags, ...checked.diags]), record, outcomes: checked.outcomes };
}

const count = (diags: Diagnostic[], level: string) => diags.filter((d) => d.level === level).length;

export async function check(files: Files, entry: string): Promise<Json> {
  const { diags } = await analyze(files, entry);
  return { diagnostics: diags.map(formatDiagnostic), errors: count(diags, 'error'), warnings: count(diags, 'warning') };
}

export async function cases(files: Files, entry: string): Promise<Json> {
  const { diags, record, outcomes } = await analyze(files, entry);
  const errors = count(diags, 'error');
  return { errors, cases: errors === 0 && record ? buildCases(record, outcomes) : [] };
}
