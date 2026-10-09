function isValidRelativePath(name) {
  if (name.length === 0) return false;
  if (name === '.' || name === '..') return false;
  if (name.includes('\\')) return false;
  if (name.includes('\0')) return false;
  if (/^[a-zA-Z]:/.test(name)) return false;

  const parts = name.split('/');
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') return false;
  }

  return true;
}

export function readFiles(input) {
  const diagnostics = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('bad_request: input must be an object');
  }

  if (!('files' in input)) {
    throw new Error('bad_request: missing files');
  }

  const files = input.files;

  if (typeof files !== 'object' || files === null || Array.isArray(files)) {
    throw new Error('bad_request: files must be an object');
  }

  const filesMap = new Map();
  const filesObj = files;

  if (Object.keys(filesObj).length === 0) {
    throw new Error('bad_request: files is empty');
  }

  const folderPaths = new Set();

  for (const [name, content] of Object.entries(filesObj)) {
    if (!isValidRelativePath(name)) {
      throw new Error('bad_request: invalid path ' + name);
    }

    if (typeof content !== 'string') {
      throw new Error('bad_request: file content must be string');
    }

    filesMap.set(name, content);

    const parts = name.split('/');
    let current = '';
    for (let i = 0; i < parts.length - 1; i++) {
      if (current === '') {
        current = parts[i];
      } else {
        current += '/' + parts[i];
      }
      folderPaths.add(current);
    }
  }

  for (const name of filesMap.keys()) {
    if (folderPaths.has(name)) {
      throw new Error('bad_request: file and folder conflict');
    }
  }

  let entry = '.';

  if ('entry' in input) {
    const entryVal = input.entry;

    if (typeof entryVal !== 'string') {
      throw new Error('bad_request: entry must be string');
    }

    if (entryVal === '') {
      throw new Error('bad_request: entry cannot be empty');
    }

    if (entryVal !== '.') {
      if (!isValidRelativePath(entryVal)) {
        throw new Error('bad_request: invalid entry');
      }
      entry = entryVal;
    }
  }

  return { files: filesMap, entry, diagnostics };
}
