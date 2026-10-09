// The files of a request, read as the whole content of a folder (REQ-RQ-001, REQ-RC-001).

import { compareUnits } from './json.ts';

export type Files = Map<string, string>;

/** A relative path: parts separated by `/`, none empty, `.` or `..`, no backslash or NUL, no drive. */
export function isRelativePath(name: string): boolean {
  if (name === '' || name.includes('\\') || name.includes('\0')) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
}

/** The folder a name is in, '' for the top. */
export function dirname(name: string): string {
  const i = name.lastIndexOf('/');
  return i < 0 ? '' : name.slice(0, i);
}

export function isFolder(files: Files, name: string): boolean {
  if (name === '') return true;
  const prefix = name + '/';
  for (const f of files.keys()) if (f.startsWith(prefix)) return true;
  return false;
}

export type Resolved =
  | { ok: true; name: string; folder: string; files: string[] }
  | { ok: false; name: string };

/** The record an entry names; entry '' is the folder that holds all the files. */
export function resolveRecord(files: Files, entry: string): Resolved {
  const name = entry === '' ? '.' : entry;
  if (entry !== '' && files.has(entry)) {
    return { ok: true, name, folder: dirname(entry), files: [entry] };
  }
  if (!isFolder(files, entry)) return { ok: false, name };
  const prefix = entry === '' ? '' : entry + '/';
  const found: string[] = [];
  for (const f of files.keys()) {
    if (!f.startsWith(prefix)) continue;
    const parts = f.slice(prefix.length).split('/');
    const last = parts[parts.length - 1];
    if (!last.endsWith('.duramen')) continue;
    if (parts.some((p) => p.startsWith('.'))) continue;
    if (parts.slice(0, -1).some((p) => p === 'build' || p === 'node_modules')) continue;
    found.push(f);
  }
  if (found.length === 0) return { ok: false, name };
  found.sort((a, b) => compareUnits(a.slice(prefix.length), b.slice(prefix.length)));
  return { ok: true, name, folder: entry, files: found };
}

/**
 * The name a record file reads, relative to the folder of the file it is named in,
 * or undefined when it leaves the top folder.
 */
export function resolveRelative(dir: string, rel: string): string | undefined {
  if (rel.startsWith('/')) return undefined;
  const parts = dir === '' ? [] : dir.split('/');
  for (const p of rel.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else parts.push(p);
  }
  return parts.join('/');
}

export function isInside(folder: string, name: string): boolean {
  return folder === '' || name.startsWith(folder + '/');
}
