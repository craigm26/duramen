// Diagnostics: one record of a problem at a file and line (SPEC.md, Interface).

export type Level = "error" | "warning" | "info";

export type Diag = { file: string; line: number; level: Level; code: string };

// The warnings of the core language. Every other code is an error. T028 is given its level
// where it is reported (REQ-CK-009).
const WARNING_CODES = new Set(["T011", "T012", "T013", "T014", "T024"]);

export function report(out: Diag[], file: string, line: number, code: string, level?: Level): void {
  const lv: Level = level ?? (WARNING_CODES.has(code) ? "warning" : "error");
  out.push({ file, line, level: lv, code });
}

export function formatDiag(d: Diag): string {
  return `${d.file}:${d.line}: ${d.level} ${d.code}`;
}

// Diagnostics in the order REQ-RC-006 gives: file name, line, code, then level.
export function sortDiags(diags: Diag[]): Diag[] {
  const rank: Record<Level, number> = { error: 0, warning: 1, info: 2 };
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return diags.slice().sort((a, b) => {
    return (
      cmp(a.file, b.file) ||
      a.line - b.line ||
      cmp(a.code, b.code) ||
      rank[a.level] - rank[b.level]
    );
  });
}
