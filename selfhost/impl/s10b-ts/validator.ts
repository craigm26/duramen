import { parseStatement, isJSON, parseJSON } from './syntax.ts';

const KEYWORDS = new Set([
  'duramen', 'spec', 'oracle', 'section', 'op', 'errors',
  'req', 'open', 'decision', 'note', 'type', 'edge', 'edgedef',
  'property', 'evidence'
]);

const SPEC_KEYWORDS = new Set([
  'title', 'text', 'contract', 'request', 'source', 'status', 'rejected'
]);

export function validateSyntax(lines) {
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

function validateFileContent(file, lines) {
  const diagnostics = [];
  let i = 0;
  let hasSeenDuramen = false;
  let hasDuramen = false;
  let hasSpec = false;
  let hasOracle = false;
  let hasErrors = false;

  while (i < lines.length) {
    const line = lines[i];

    if (line.indent === 0) {
      if (line.content === '' || line.content.startsWith('#')) {
        i++;
        continue;
      }

      const parsed = parseStatement(line.content);
      if (!parsed) {
        i++;
        continue;
      }

      const { keyword } = parsed;

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
