// Which of the request's files make up the record (REQ-RC-001, REQ-RC-002).

import { cmpUnits } from './json.ts';

export interface Record {
  /** The record's name in diagnostics: `.`, a folder's name, or a file's. */
  name: string;
  /** The folder of the record, '' for the folder that holds all the files. */
  folder: string;
  /** Names of the record's files, in record order; empty when the record does not exist. */
  files: string[];
}

function excluded(relParts: string[]): boolean {
  const last = relParts.length - 1;
  return relParts.some(
    (p, i) => p.startsWith('.') || (i < last && (p === 'build' || p === 'node_modules')),
  );
}

export function assembleRecord(files: Map<string, string>, entry: string): Record {
  const names = [...files.keys()];
  if (entry !== '.' && files.has(entry)) {
    const slash = entry.lastIndexOf('/');
    return { name: entry, folder: slash < 0 ? '' : entry.slice(0, slash), files: [entry] };
  }
  const folder = entry === '.' ? '' : entry;
  const prefix = folder === '' ? '' : folder + '/';
  const chosen = names
    .filter((n) => n.startsWith(prefix))
    .filter((n) => n.endsWith('.duramen') && !excluded(n.slice(prefix.length).split('/')))
    .sort(cmpUnits);
  return { name: entry, folder, files: chosen };
}
