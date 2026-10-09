// Diagnostics: `<file>:<line>: <level> <code>`.

import { cmpUnits } from './json.ts';

export type Level = 'error' | 'warning' | 'info';

export interface Diag {
  file: string;
  line: number;
  level: Level;
  code: string;
}

const LEVELS: Level[] = ['error', 'warning', 'info'];

export function sortDiags(diags: Diag[]): Diag[] {
  return [...diags].sort(
    (a, b) =>
      cmpUnits(a.file, b.file) ||
      a.line - b.line ||
      cmpUnits(a.code, b.code) ||
      LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level),
  );
}

export function formatDiag(d: Diag): string {
  return `${d.file}:${d.line}: ${d.level} ${d.code}`;
}
