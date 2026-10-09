import { readFiles } from './reader.ts';
import { parseFiles } from './parser.ts';
import { formatDiagnostic, compareDiagnostics } from './types.ts';

export function checkRecord(input) {
  const diagnostics = [];

  try {
    const { files, entry } = readFiles(input);

    const parsed = parseFiles(files, entry);
    diagnostics.push(...parsed.diagnostics);

    if (diagnostics.some(d => d.level === 'error')) {
      diagnostics.sort(compareDiagnostics);
      return {
        diagnostics: diagnostics.map(d => formatDiagnostic(d.file, d.line, d.level, d.code)),
        errors: diagnostics.filter(d => d.level === 'error').length,
        warnings: diagnostics.filter(d => d.level === 'warning').length,
      };
    }

    const syntaxDiags = validateDuramenSyntax(parsed.lines);
    diagnostics.push(...syntaxDiags);

  } catch (err) {
    if (err instanceof Error && err.message.startsWith('bad_request:')) {
      throw err;
    }
    throw err;
  }

  diagnostics.sort(compareDiagnostics);

  return {
    diagnostics: diagnostics.map(d => formatDiagnostic(d.file, d.line, d.level, d.code)),
    errors: diagnostics.filter(d => d.level === 'error').length,
    warnings: diagnostics.filter(d => d.level === 'warning').length,
  };
}

function validateDuramenSyntax(lines) {
  const diagnostics = [];
  const fileMap = new Map();

  for (const line of lines) {
    if (!fileMap.has(line.file)) {
      fileMap.set(line.file, []);
    }
    fileMap.get(line.file).push(line);
  }

  for (const [file, fileLines] of fileMap) {
    const fileDiags = validateFileContent(file, fileLines);
    diagnostics.push(...fileDiags);
  }

  return diagnostics;
}

const KEYWORDS = new Set([
  'duramen', 'spec', 'oracle', 'section', 'op', 'errors',
  'req', 'open', 'decision', 'note', 'type', 'edge', 'edgedef',
  'property', 'evidence'
]);

function validateFileContent(file, lines) {
  const diagnostics = [];
  let i = 0;
  let hasSeenDuramen = false;
  let hasDuramen = false;
  let hasSpec = false;
  let hasOracle = false;
  let hasErrors = false;
  let seenFirstStatement = false;

  while (i < lines.length) {
    const line = lines[i];

    if (line.indent === 0) {
      if (line.content === '' || line.content.startsWith('#')) {
        i++;
        continue;
      }

      seenFirstStatement = true;
      const words = line.content.split(/\s+/);
      const keyword = words[0];

      if (!KEYWORDS.has(keyword)) {
        diagnostics.push({
          file,
          line: line.lineNum,
          level: 'error',
          code: 'P002',
        });
        i += countBodyLines(lines, i) + 1;
        continue;
      }

      if (keyword === 'duramen') {
        if (!hasSeenDuramen) {
          hasSeenDuramen = true;
          hasDuramen = true;

          const versionPart = line.content.slice(keyword.length).trim();
          if (versionPart === '' || !/^\d+(\.\d+)?/.test(versionPart)) {
            diagnostics.push({
              file,
              line: line.lineNum,
              level: 'error',
              code: 'P023',
            });
          } else if (!['0.1', '0.2'].includes(versionPart.split(/\s/)[0])) {
            diagnostics.push({
              file,
              line: line.lineNum,
              level: 'error',
              code: 'P023',
            });
          }
        } else {
          diagnostics.push({
            file,
            line: line.lineNum,
            level: 'error',
            code: 'P023',
          });
        }
      } else if (keyword === 'spec') {
        if (hasSpec) {
          diagnostics.push({
            file,
            line: line.lineNum,
            level: 'error',
            code: 'P044',
          });
        } else {
          hasSpec = true;
        }
      } else if (keyword === 'oracle') {
        if (hasOracle) {
          diagnostics.push({
            file,
            line: line.lineNum,
            level: 'error',
            code: 'P044',
          });
        } else {
          hasOracle = true;
        }
      } else if (keyword === 'errors') {
        if (hasErrors) {
          diagnostics.push({
            file,
            line: line.lineNum,
            level: 'error',
            code: 'P032',
          });
        } else {
          hasErrors = true;
        }
      }

      i += countBodyLines(lines, i) + 1;
    } else {
      if (!seenFirstStatement) {
        diagnostics.push({
          file,
          line: line.lineNum,
          level: 'error',
          code: 'P003',
        });
      } else if (line.indent === 1) {
        diagnostics.push({
          file,
          line: line.lineNum,
          level: 'error',
          code: 'P007',
        });
      }
      i++;
    }
  }

  if (!hasDuramen) {
    diagnostics.push({
      file,
      line: 1,
      level: 'error',
      code: 'P020',
    });
  }

  return diagnostics;
}

function countBodyLines(lines, startIdx) {
  let count = 0;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].indent === 0) {
      break;
    }
    count++;
  }
  return count;
}
