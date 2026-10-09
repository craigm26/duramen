function isWhitespace(char) {
  const code = char.charCodeAt(0);
  return (
    code === 0x0009 || code === 0x000A || code === 0x000B || code === 0x000C || code === 0x000D ||
    code === 0x0020 || code === 0x00A0 || code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200A) ||
    code === 0x2028 || code === 0x2029 || code === 0x202F || code === 0x205F || code === 0x3000 ||
    code === 0xFEFF
  );
}

export function parseFiles(files, entry) {
  const lines = [];
  const diagnostics = [];

  const filesToRead = getFilesToRead(files, entry);

  if (filesToRead.length === 0) {
    diagnostics.push({
      file: entry === '.' ? '.' : entry,
      line: 1,
      level: 'error',
      code: 'P046',
    });
    return { lines, diagnostics };
  }

  for (const file of filesToRead) {
    const content = files.get(file) || '';
    const fileLines = parseFileContent(file, content);

    for (const line of fileLines.lines) {
      lines.push(line);
    }

    diagnostics.push(...fileLines.diagnostics);
  }

  return { lines, diagnostics };
}

function getFilesToRead(files, entry) {
  const result = [];

  if (entry === '.') {
    for (const name of files.keys()) {
      if (name.endsWith('.duramen') && !isIgnored(name)) {
        result.push(name);
      }
    }
  } else if (entry.endsWith('.duramen')) {
    if (files.has(entry)) {
      result.push(entry);
    }
  } else {
    const prefix = entry + '/';
    for (const name of files.keys()) {
      if (name.startsWith(prefix) && name.endsWith('.duramen') && !isIgnored(name)) {
        result.push(name);
      }
    }
  }

  return result.sort((a, b) => {
    const aCode = Array.from(a).map(c => c.charCodeAt(0));
    const bCode = Array.from(b).map(c => c.charCodeAt(0));

    for (let i = 0; i < Math.min(aCode.length, bCode.length); i++) {
      if (aCode[i] !== bCode[i]) {
        return aCode[i] - bCode[i];
      }
    }

    return aCode.length - bCode.length;
  });
}

function isIgnored(name) {
  const parts = name.split('/');
  for (const part of parts) {
    if (part.startsWith('.')) return true;
    if (part === 'build' || part === 'node_modules') return true;
  }
  return false;
}

function parseFileContent(file, content) {
  const lines = [];
  const diagnostics = [];

  let text = content;
  if (text.startsWith('﻿')) {
    text = text.slice(1);
  }

  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const rawLines = text.split('\n');

  for (let i = 0; i < rawLines.length; i++) {
    const lineNum = i + 1;
    const rawLine = rawLines[i];

    const trimmedEnd = rawLine.replace(/\s+$/, '');

    let indent = 0;
    let hasTabError = false;

    for (const char of rawLine) {
      if (char === ' ') {
        indent++;
      } else if (isWhitespace(char) && char !== ' ') {
        hasTabError = true;
        break;
      } else {
        break;
      }
    }

    if (hasTabError) {
      diagnostics.push({
        file,
        line: lineNum,
        level: 'error',
        code: 'P001',
      });
      continue;
    }

    const lineContent = trimmedEnd.slice(indent);

    if (trimmedEnd.trim() === '') {
      lines.push({ file, lineNum, content: '', indent: 0 });
    } else {
      lines.push({ file, lineNum, content: lineContent, indent });
    }
  }

  return { lines, diagnostics };
}
