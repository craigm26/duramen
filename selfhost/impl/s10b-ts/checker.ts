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

function validateDuramenSyntax(allLines) {
  const diagnostics = [];
  const fileMap = new Map();

  for (const line of allLines) {
    if (!fileMap.has(line.file)) {
      fileMap.set(line.file, []);
    }
    fileMap.get(line.file).push(line);
  }

  const sortedFiles = Array.from(fileMap.keys()).sort((a, b) => {
    const aCode = Array.from(a).map(c => c.charCodeAt(0));
    const bCode = Array.from(b).map(c => c.charCodeAt(0));

    for (let i = 0; i < Math.min(aCode.length, bCode.length); i++) {
      if (aCode[i] !== bCode[i]) {
        return aCode[i] - bCode[i];
      }
    }

    return aCode.length - bCode.length;
  });

  let globalHasSpec = false;
  let globalHasOracle = false;
  let globalHasErrors = false;

  for (const file of sortedFiles) {
    const fileLines = fileMap.get(file);
    const results = validateFileContent(file, fileLines);

    diagnostics.push(...results.diagnostics);

    if (results.hasSpec) {
      if (globalHasSpec) {
        for (const line of fileLines) {
          if (line.indent === 0 && line.content.split(/\s+/)[0] === 'spec') {
            diagnostics.push({
              file,
              line: line.lineNum,
              level: 'error',
              code: 'P044',
            });
            break;
          }
        }
      } else {
        globalHasSpec = true;
      }
    }

    if (results.hasOracle) {
      if (globalHasOracle) {
        for (const line of fileLines) {
          if (line.indent === 0 && line.content.split(/\s+/)[0] === 'oracle') {
            diagnostics.push({
              file,
              line: line.lineNum,
              level: 'error',
              code: 'P044',
            });
            break;
          }
        }
      } else {
        globalHasOracle = true;
      }
    }

    if (results.hasErrors) {
      if (globalHasErrors) {
        for (const line of fileLines) {
          if (line.indent === 0 && line.content.split(/\s+/)[0] === 'errors') {
            diagnostics.push({
              file,
              line: line.lineNum,
              level: 'error',
              code: 'P032',
            });
            break;
          }
        }
      } else {
        globalHasErrors = true;
      }
    }
  }

  if (!globalHasSpec && sortedFiles.length > 0) {
    diagnostics.push({
      file: sortedFiles[0] || '.',
      line: 1,
      level: 'error',
      code: 'P021',
    });
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
  let hasSpecLocal = false;
  let hasOracleLocal = false;
  let hasErrorsLocal = false;
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
        i++;
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
        if (!hasSpecLocal) {
          hasSpecLocal = true;
        } else {
          diagnostics.push({
            file,
            line: line.lineNum,
            level: 'error',
            code: 'P044',
          });
        }
      } else if (keyword === 'oracle') {
        if (!hasOracleLocal) {
          hasOracleLocal = true;
        } else {
          diagnostics.push({
            file,
            line: line.lineNum,
            level: 'error',
            code: 'P044',
          });
        }
      } else if (keyword === 'errors') {
        if (!hasErrorsLocal) {
          hasErrorsLocal = true;
        } else {
          diagnostics.push({
            file,
            line: line.lineNum,
            level: 'error',
            code: 'P032',
          });
        }
      }

      i++;
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

  return {
    diagnostics,
    hasSpec: hasSpecLocal,
    hasOracle: hasOracleLocal,
    hasErrors: hasErrorsLocal,
  };
}
