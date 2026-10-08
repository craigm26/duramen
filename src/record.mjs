// A record is the durable part of a regenerative program: one .duramen file, or a folder of
// them. This module reads a record from disk: it parses every file, merges them into one syntax
// tree (each node remembers its file), attaches the edge library (lib/edges plus the record's
// own `edgedef`s), and reads the data files that evidence tables name. The parser stays pure;
// all file access is here.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, basename, extname } from 'node:path';
import { parse, VERSIONS } from './parse.mjs';

export const LIB_DIR = resolve(import.meta.dirname, '..', 'lib');
const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.regenerate']);

// The .duramen files of a folder, recursively, sorted by relative path (UTF-16 code units).
export function recordFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); }
      else if (e.isFile() && e.name.endsWith('.duramen')) out.push(p);
    }
  };
  walk(dir);
  return out.sort((a, b) => (relative(dir, a).replace(/\\/g, '/') < relative(dir, b).replace(/\\/g, '/') ? -1 : 1));
}

let libCache = null;
function library() {
  if (libCache) return libCache;
  const parts = [];
  let files = [];
  try { files = recordFiles(join(LIB_DIR, 'edges')); } catch { files = []; }
  for (const f of files) parts.push(parse(readFileSync(f, 'utf8'), f));
  libCache = parts;
  return parts;
}

// A small CSV reader (RFC 4180: quoted fields, doubled quotes, CRLF or LF). Returns
// { header, rows: [{ line, cells: {column: text} }] } or { error }.
export function readCSV(text) {
  const recs = [];
  let row = [], field = '', q = false, line = 1, rowLine = 1, i = 0;
  const s = text.replace(/^\ufeff/, '');
  for (; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else { if (c === '\n') line++; field += c; }
      continue;
    }
    if (c === '"' && field === '') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r' && s[i + 1] === '\n') continue;
    else if (c === '\n') { row.push(field); recs.push({ line: rowLine, row }); row = []; field = ''; line++; rowLine = line; }
    else field += c;
  }
  if (q) return { error: 'a quoted field is not closed' };
  if (field !== '' || row.length) { row.push(field); recs.push({ line: rowLine, row }); }
  const nonEmpty = recs.filter((r) => !(r.row.length === 1 && r.row[0] === ''));
  if (!nonEmpty.length) return { error: 'the file is empty' };
  const header = nonEmpty[0].row.map((h) => h.trim());
  const rows = [];
  for (const r of nonEmpty.slice(1)) {
    if (r.row.length !== header.length) return { error: `line ${r.line} has ${r.row.length} fields, the header has ${header.length}` };
    rows.push({ line: r.line, cells: Object.fromEntries(header.map((h, k) => [h, r.row[k]])) });
  }
  return { header, rows };
}

// Rows of a JSON Lines file (one object per line) as cells holding JSON text.
function readJSONL(text) {
  const rows = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].trim() === '') continue;
    let o;
    try { o = JSON.parse(lines[k]); } catch (e) { return { error: `line ${k + 1}: ${e.message}` }; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { error: `line ${k + 1}: not an object` };
    rows.push({ line: k + 1, cells: Object.fromEntries(Object.entries(o).map(([key, v]) => [key, typeof v === 'string' ? v : JSON.stringify(v)])), json: o });
  }
  return { header: [...new Set(rows.flatMap((r) => Object.keys(r.cells)))], rows };
}

// A cell as a JSON value: parsed as JSON when it is JSON (`20.00`, `true`, `"x"`), else the text
// itself, or always the text (`as string`). Returns { value, raw } (raw: the JSON text sent).
function cellValue(text, as) {
  const t = text.trim();
  if (as !== 'string') {
    try { const v = JSON.parse(t); return { value: v, raw: t }; } catch { /* a bare word */ }
  }
  return { value: text, raw: JSON.stringify(text) };
}

// Turn the rows of an evidence data file into examples, the same shape a req's table rows have.
function evidenceRows(ev, table, data, diag) {
  const out = [];
  const need = [...table.columns.map((c) => c.column), ...table.expects.flatMap((e) => [e.column, ...(e.kind === 'approx' && !Number.isFinite(Number(e.tol)) ? [e.tol] : [])]), ...(table.idColumn ? [table.idColumn] : [])];
  for (const col of need) if (!data.header.includes(col)) { diag('error', table, 'P045', `${table.file} has no column "${col}" (it has ${data.header.join(', ')})`); return []; }
  data.rows.forEach((r, k) => {
    const ex = { op: table.op, input: {}, raw: null, request: null, omit: [], expects: [], line: table.line, from: 'evidence', dataFile: table.file, dataLine: r.line, rowId: table.idColumn ? r.cells[table.idColumn] : `${basename(table.file)}:${r.line}` };
    const rawFields = [];
    for (const c of table.columns) {
      const cell = r.cells[c.column];
      if (cell === undefined || cell.trim() === '') continue;
      const { value, raw } = cellValue(cell, c.as);
      ex.input[c.field] = value;
      rawFields.push(`${JSON.stringify(c.field)}:${raw}`);
    }
    for (const e of table.expects) {
      const cell = r.cells[e.column];
      if (cell === undefined || cell.trim() === '') continue;
      const { value } = cellValue(cell, e.as);
      if (e.kind === 'approx') {
        const tol = Number.isFinite(Number(e.tol)) ? Number(e.tol) : Number(r.cells[e.tol]);
        if (typeof value !== 'number' || !Number.isFinite(tol) || tol < 0) { diag('error', table, 'P045', `${table.file} line ${r.line}: ${e.path} needs a number and a tolerance of 0 or more`); continue; }
        ex.expects.push({ path: e.path, kind: 'approx', value, tol, line: table.line });
      } else ex.expects.push({ path: e.path, kind: 'eq', value, line: table.line });
    }
    ex.raw = `{${rawFields.join(',')}}`;
    out.push(ex);
    void k;
  });
  return out;
}

// Load a record. Never throws for a problem in the record: problems are diagnostics.
//   { ast, diagnostics, files, root }
export function loadRecord(path, { useLibrary = true } = {}) {
  const diagnostics = [];
  const diag = (level, node, code, message, col = 1) => diagnostics.push({ level, file: node?.file ?? path, line: node?.line ?? 1, col: node?.col ?? col, code, message });
  let st;
  try { st = statSync(path); } catch (e) {
    diagnostics.push({ level: 'error', file: path, line: 1, col: 1, code: 'P046', message: `cannot read ${path}: ${e.code ?? e.message}` });
    return { ast: emptyAst(path), diagnostics, files: [], root: path };
  }
  const root = st.isDirectory() ? path : dirname(path);
  const files = st.isDirectory() ? recordFiles(path) : [path];
  if (!files.length) diagnostics.push({ level: 'error', file: path, line: 1, col: 1, code: 'P046', message: `${path} holds no .duramen files` });
  const parts = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch (e) { diagnostics.push({ level: 'error', file: f, line: 1, col: 1, code: 'P046', message: `cannot read ${f}: ${e.code ?? e.message}` }); continue; }
    const p = parse(text, f);
    parts.push(p);
    diagnostics.push(...p.diagnostics);
  }
  const ast = merge(parts, path, st.isDirectory(), diag);
  ast.root = root;
  // The edge library: lib/edges, then the record's own definitions.
  const defs = new Map();
  const families = new Map();
  const addDef = (def, fromLib) => {
    if (defs.has(def.name)) { diag('error', def, 'T033', `edge ${def.name} is defined twice (${fromLib ? 'the library' : 'here'} and ${defs.get(def.name).file}:${defs.get(def.name).line})`); return; }
    defs.set(def.name, { ...def, fromLib });
    for (const fam of def.family) families.set(fam, [...(families.get(fam) ?? []), def.name]);
  };
  if (useLibrary) for (const p of library()) for (const def of p.ast.edgedefs) addDef({ ...def, file: p.ast.file }, true);
  for (const def of ast.edgedefs) addDef(def, false);
  for (const fam of families.keys()) if (defs.has(fam)) diag('error', defs.get(fam), 'T033', `"${fam}" names both an edge and a family of edges`);
  ast.edgeLib = { defs, families };
  // Evidence data files, relative to the file that names them.
  for (const ev of ast.evidence) {
    ev.rows = [];
    let ordinal = 0; // inline rows are numbered 1, 2, ... across the evidence statement
    for (const t of ev.tables) {
      if (!t.file) { ev.rows.push(...t.rows.map((r) => ({ ...r, rowId: String(++ordinal), file: ev.file }))); continue; }
      const p = resolve(dirname(ev.file), t.file);
      let text;
      try { text = readFileSync(p, 'utf8'); } catch (e) { diag('error', { file: ev.file, line: t.line }, 'P045', `cannot read ${t.file}: ${e.code ?? e.message}`); continue; }
      const ext = extname(p).toLowerCase();
      const data = ext === '.jsonl' || ext === '.ndjson' ? readJSONL(text) : readCSV(text);
      if (data.error) { diag('error', { file: ev.file, line: t.line }, 'P045', `${t.file}: ${data.error}`); continue; }
      ev.rows.push(...evidenceRows(ev, { ...t, file: t.file }, data, (level, _t, code, message) => diag(level, { file: ev.file, line: t.line }, code, message)).map((r) => ({ ...r, file: ev.file })));
    }
  }
  return { ast, diagnostics, files, root };
}

function emptyAst(path) {
  return { file: path, version: null, spec: null, oracle: null, types: [], edges: [], edgedefs: [], errors: [], ops: [], items: [], decisions: [], properties: [], evidence: [], edgeLib: { defs: new Map(), families: new Map() } };
}

function merge(parts, path, isDir, diag) {
  const ast = emptyAst(path);
  const versions = new Set();
  for (const { ast: a } of parts) {
    const tag = (x) => Object.assign(x, { file: x.file ?? a.file });
    if (a.version) versions.add(a.version);
    if (a.spec) {
      if (ast.spec) diag('error', { file: a.file, line: a.spec.line }, 'P044', `a second spec statement (the first is in ${ast.spec.file}:${ast.spec.line})`);
      else ast.spec = tag(a.spec);
    }
    if (a.oracle) {
      if (ast.oracle) diag('error', { file: a.file, line: a.oracle.line }, 'P044', `a second oracle (the first is in ${ast.oracle.file}:${ast.oracle.line})`);
      else ast.oracle = tag(a.oracle);
    }
    if (a.errors.length) {
      if (ast.errors.length) diag('error', { file: a.file, line: a.errors[0].line }, 'P032', `errors is declared once (it is also in ${ast.errors[0].file})`);
      else ast.errors = a.errors.map(tag);
    }
    for (const k of ['types', 'edges', 'edgedefs', 'ops', 'items', 'decisions', 'properties', 'evidence']) ast[k].push(...a[k].map(tag));
    for (const r of a.items) if (r.type === 'req') { r.examples.forEach((ex) => tag(ex)); r.statics.forEach((s) => tag(s)); }
    for (const ev of a.evidence) ev.tables.forEach((t) => t.rows?.forEach((r) => tag(r)));
    for (const op of a.ops) op.inputs.forEach((i) => tag(i));
  }
  if (versions.size > 1) diag('error', { file: path, line: 1 }, 'P047', `the files of this record use different versions: ${[...versions].join(', ')}`);
  ast.version = versions.size === 1 ? [...versions][0] : versions.size ? [...versions].sort().at(-1) : null;
  if (!ast.spec) diag('error', { file: isDir ? path : parts[0]?.ast.file ?? path, line: 1 }, 'P021', 'missing "spec <name> <version>"');
  if (ast.version && !VERSIONS.includes(ast.version)) ast.version = null;
  ast.file = isDir ? path : parts[0]?.ast.file ?? path;
  return ast;
}

// Version comparison for features that 0.1 files do not have.
export const atLeast = (ast, v) => (ast.version ?? '0.1') >= v;
