// Which files make a record (REQ-RC-001, REQ-RC-002).

import type { RecordModel } from './model.ts';
import { compareUnits, hasOwn } from './util.ts';

/** Answers the record named by `entry`, or undefined when it has no files (P046). */
export function resolveRecord(files: Record<string, string>, entry: string): RecordModel | undefined {
  let folder: string;
  let list: string[];
  if (entry !== '.' && hasOwn(files, entry)) {
    folder = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : '';
    list = [entry];
  } else {
    folder = entry === '.' ? '' : entry;
    const prefix = folder === '' ? '' : folder + '/';
    list = Object.keys(files).filter((name) => {
      if (!name.startsWith(prefix)) return false;
      const parts = name.slice(prefix.length).split('/');
      if (parts.some((p) => p.startsWith('.'))) return false;
      if (parts.slice(0, -1).some((p) => p === 'build' || p === 'node_modules')) return false;
      return parts[parts.length - 1].endsWith('.duramen');
    });
    // Names share the folder's prefix, so they sort as their names relative to it do.
    list.sort(compareUnits);
  }
  if (list.length === 0) return undefined;
  return {
    name: entry,
    folder,
    files: list,
    ops: [],
    codes: [],
    reqs: [],
    opens: [],
    decisions: [],
    prose: [],
    openExamples: [],
  };
}
