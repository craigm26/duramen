// Assembling a record from the files of a request (REQ-RC-001 to REQ-RC-004).

import type { Diag, RecordModel } from './model.ts';
import { readFile } from './reader.ts';
import type { ReadCtx } from './reader.ts';

export interface Loaded {
  rec: RecordModel;
  diags: Diag[];
}

export function loadRecord(files: Map<string, string>, entry: string | undefined): Loaded {
  const name = entry === undefined ? '.' : entry;
  const diags: Diag[] = [];
  const rec: RecordModel = {
    name,
    folder: '',
    files,
    fileModels: [],
    spec: null,
    specTexts: [],
    oracle: null,
    errorsCodes: [],
    errorsClauses: [],
    errorsFile: '',
    ops: [],
    reqs: [],
    opens: [],
    decisions: [],
    sections: [],
    notes: [],
  };
  const missing = (): Loaded => {
    diags.push({ file: name, line: 1, level: 'error', code: 'P046' });
    return { rec, diags };
  };

  let selected: string[] = [];
  if (name !== '.' && files.has(name)) {
    selected = [name];
    const slash = name.lastIndexOf('/');
    rec.folder = slash < 0 ? '' : name.slice(0, slash);
  } else {
    const folder = name === '.' ? '' : name;
    const prefix = folder === '' ? '' : folder + '/';
    if (folder !== '' && ![...files.keys()].some((k) => k.startsWith(prefix))) return missing();
    rec.folder = folder;
    const rels: string[] = [];
    for (const k of files.keys()) {
      if (!k.startsWith(prefix)) continue;
      const rel = k.slice(prefix.length);
      const parts = rel.split('/');
      if (!rel.endsWith('.duramen')) continue;
      if (parts.some((p) => p.startsWith('.'))) continue;
      if (parts.slice(0, -1).some((p) => p === 'build' || p === 'node_modules')) continue;
      rels.push(rel);
    }
    rels.sort();
    if (rels.length === 0) return missing();
    selected = rels.map((r) => prefix + r);
  }

  const ctx: ReadCtx = {
    files,
    recordFolder: rec.folder,
    diags,
    rec,
    seen: { spec: 0, oracle: 0, errors: 0 },
  };
  for (const f of selected) {
    const fm = readFile(f, files.get(f) as string, ctx);
    rec.fileModels.push(fm);
    if (fm.duramenCount === 0) diags.push({ file: f, line: 1, level: 'error', code: 'P020' });
  }
  if (ctx.seen.spec === 0) diags.push({ file: name, line: 1, level: 'error', code: 'P021' });
  const versions = new Set(rec.fileModels.map((m) => m.version).filter((v) => v !== null));
  if (versions.size > 1) diags.push({ file: name, line: 1, level: 'error', code: 'P047' });
  return { rec, diags };
}
