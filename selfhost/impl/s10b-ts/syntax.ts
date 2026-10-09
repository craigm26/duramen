export function parseStatement(line) {
  if (!line || line.trim() === '' || line.trim().startsWith('#')) {
    return null;
  }

  const words = line.trim().split(/\s+/);
  if (words.length === 0) return null;

  return { keyword: words[0], rest: words.slice(1), fullLine: line.trim() };
}

export function parseQuotedString(text) {
  if (!text.startsWith('"') || !text.endsWith('"')) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') {
      return parsed;
    }
  } catch {
  }

  return null;
}

export function splitOnComma(text) {
  const parts = [];
  let current = '';
  let inQuotes = false;
  let inBrackets = 0;
  let inBraces = 0;
  let inParens = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"' && (i === 0 || text[i - 1] !== '\\')) {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (char === '[') inBrackets++;
      else if (char === ']') inBrackets--;
      else if (char === '{') inBraces++;
      else if (char === '}') inBraces--;
      else if (char === '(') inParens++;
      else if (char === ')') inParens--;
      else if (char === ',' && inBrackets === 0 && inBraces === 0 && inParens === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
    }

    current += char;
  }

  if (current) {
    parts.push(current.trim());
  }

  return parts;
}

export function isJSON(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function parseJSON(text) {
  try {
    return { value: JSON.parse(text), error: null };
  } catch (err) {
    return { value: null, error: err.message };
  }
}
