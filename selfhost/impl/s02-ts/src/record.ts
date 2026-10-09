export interface Selection {
  /** The name diagnostics about the record as a whole are written under. */
  name: string;
  /** Files of the record, in reading order. */
  files: string[];
  /** The folder of the record ('' for the root). */
  folder: string;
  missing: boolean;
}

function dirname(name: string): string {
  const i = name.lastIndexOf('/');
  return i < 0 ? '' : name.slice(0, i);
}

export function selectRecord(names: string[], entry: string | undefined): Selection {
  if (entry !== undefined && entry !== '.' && names.includes(entry)) {
    return { name: entry, files: [entry], folder: dirname(entry), missing: false };
  }
  const folder = entry === undefined || entry === '.' ? '' : entry;
  const label = folder === '' ? '.' : folder;
  const prefix = folder === '' ? '' : folder + '/';
  const rels: string[] = [];
  for (const n of names) {
    if (!n.startsWith(prefix)) continue;
    const rel = n.slice(prefix.length);
    if (!rel.endsWith('.duramen')) continue;
    const parts = rel.split('/');
    if (parts.some((p) => p.startsWith('.'))) continue;
    if (parts.slice(0, -1).some((p) => p === 'build' || p === 'node_modules')) continue;
    rels.push(rel);
  }
  rels.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { name: label, files: rels.map((r) => prefix + r), folder, missing: rels.length === 0 };
}
