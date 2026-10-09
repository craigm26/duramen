function formatDiagnostic(file, line, level, code) {
  return `${file}:${line}: ${level} ${code}`;
}

function compareDiagnostics(a, b) {
  if (a.file !== b.file) {
    return a.file.localeCompare(b.file, undefined, { numeric: false });
  }
  if (a.line !== b.line) return a.line - b.line;
  if (a.code !== b.code) {
    return a.code.localeCompare(b.code, undefined, { numeric: false });
  }
  const levelOrder = { error: 0, warning: 1, info: 2 };
  return levelOrder[a.level] - levelOrder[b.level];
}

export { formatDiagnostic, compareDiagnostics };
