import path from 'node:path';
import { absent, compare, json, number, object, own } from './values.ts';

export type Location = { file: string; line: number };
export type Diagnostic = Location & { code: string; level: 'error' | 'warning' | 'info' };
type Line = Location & { text: string; indent: number; blank: boolean };
type Clause = Location & { key: string; rest: string; body: Line[] };
export type Check = Location & { path: string; kind: 'eq' | 'approx'; value?: any; tol?: number; from?: 'oracle' };
export type Example = Location & {
  op: string; raw?: string; rawMode: boolean; input: any; inputText?: string; modified: boolean;
  checks: Check[]; request?: Record<string, any>; omit: string[]; id?: string; lineText?: string;
  solo?: boolean; response?: any;
};
export type Statement = Location & {
  kind: string; rest: string; id: string; title?: string; text?: string; textLine?: Location;
  source?: string; status?: string; result?: string; platform: string; decisions: string[];
  examples: Example[]; rejected: string[]; fields: Map<string, boolean>; tolerances: Record<string, number>;
  audit: boolean; request?: Record<string, any>; clauses: Clause[]; openTests: Location[];
};
export type RecordData = {
  files: Record<string, string>; entry: string; folder: string; diagnostics: Diagnostic[];
  statements: Statement[]; spec?: Statement; oracle?: Statement; errors?: Statement;
  conditions: { code: string; text: string; loc: Location }[];
};
const words = (s: string): string[] => s.split(/[\s,]+/).filter(Boolean);
const splitHead = (s: string): [string, string] => {
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(s);
  return m ? [m[1], m[2] ?? ''] : ['', ''];
};
export function diagnostic(r: RecordData, loc: Location, code: string, level: Diagnostic['level'] = 'error'): void {
  r.diagnostics.push({ file: loc.file, line: loc.line, code, level });
}
function quoted(r: RecordData, loc: Location, text: string): string | undefined {
  const value = json(text);
  if (typeof value !== 'string') { diagnostic(r, loc, 'P004'); return; }
  return value;
}
function request(r: RecordData, loc: Location, text: string): Record<string, any> | undefined {
  const value = json(text);
  if (!object(value)) { diagnostic(r, loc, 'P009'); return; }
  if (['id', 'op', 'input'].some(k => own(value, k))) { diagnostic(r, loc, 'P051'); return; }
  return value;
}
function fields(text: string): string[] {
  const result: string[] = [];
  let depth = 0, quote = false, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === '"') quote = false; }
    else if (c === '"') quote = true;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) { result.push(text.slice(start, i).trim()); start = i + 1; }
  }
  result.push(text.slice(start).trim());
  return result;
}
export function inputPath(text: string): string[] | undefined {
  let i = 0;
  const parts: string[] = [];
  while (i < text.length) {
    if (text[i] === '"') {
      const start = i++;
      let closed = false;
      while (i < text.length) {
        if (text[i] === '\\') i += 2;
        else if (text[i++] === '"') { closed = true; break; }
      }
      const value = closed ? json(text.slice(start, i)) : absent;
      if (typeof value !== 'string') return;
      parts.push(value);
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(text.slice(i));
      if (!m) return;
      parts.push(m[0]); i += m[0].length;
    }
    if (i === text.length) return parts;
    if (text[i++] !== '.' || i === text.length) return;
  }
}
function fromLine(text: string): { path: string; file?: string } {
  const m = /^([\s\S]*\S)\s+from\s+("[\s\S]*")$/.exec(text);
  if (m) {
    const file = json(m[2]);
    if (typeof file === 'string') return { path: m[1], file };
  }
  return { path: text };
}
function setInput(r: RecordData, e: Example, line: Line, info: { path: string; file?: string }, content: string): void {
  const parts = inputPath(info.path);
  if (!parts) { diagnostic(r, line, 'P049'); return; }
  if (info.file !== undefined) {
    const name = path.posix.normalize(path.posix.dirname(e.file) + '/' + info.file);
    if (!own(r.files, name) || (r.folder !== '.' && !name.startsWith(r.folder + '/'))) {
      diagnostic(r, line, 'P048'); return;
    }
    content = r.files[name];
  }
  let value = e.input;
  for (const part of parts.slice(0, -1)) {
    if (!own(value, part)) Object.defineProperty(value, part, { value: {}, enumerable: true, writable: true, configurable: true });
    if (!object(value[part])) { diagnostic(r, line, 'P049'); return; }
    value = value[part];
  }
  if (info.file === undefined && content === '') { diagnostic(r, line, 'P049'); return; }
  Object.defineProperty(value, parts.at(-1)!, { value: content, enumerable: true, writable: true, configurable: true });
  e.modified = true;
}
function expectation(r: RecordData, line: Location, text: string): Check | undefined {
  const m = /^([^\s=≈~]+)\s*([=≈~])\s*([\s\S]*)$/.exec(text);
  if (!m) { diagnostic(r, line, 'P011'); return; }
  if (m[2] === '=') {
    if (m[3] === '?') return { ...line, path: m[1], kind: 'eq', from: 'oracle' };
    const value = json(m[3]);
    if (value === absent) { diagnostic(r, line, 'P009'); return; }
    return { ...line, path: m[1], kind: 'eq', value };
  }
  const n = /^([\s\S]*?)\s*(?:±|\+-)\s*([\s\S]*)$/.exec(m[3]);
  const value = n ? number(n[1].trim()) : absent;
  const tol = n ? number(n[2].trim()) : absent;
  if (value === absent || tol === absent || tol < 0) { diagnostic(r, line, 'P010'); return; }
  return { ...line, path: m[1], kind: 'approx', value, tol };
}
function example(r: RecordData, c: Clause): Example | undefined {
  const [op, tail] = splitHead(c.rest);
  const e: Example = { file: c.file, line: c.line, op, rawMode: op === 'raw', input: {}, modified: false, checks: [], omit: [] };
  let valid = true;
  if (!op) { diagnostic(r, c, 'P012'); valid = false; }
  else if (e.rawMode) {
    if (tail.startsWith("'") && tail.endsWith("'") && tail.length >= 2) e.raw = tail.slice(1, -1);
    else e.raw = quoted(r, c, tail);
    if (e.raw === undefined) valid = false;
    else if (/[\r\n]/.test(e.raw)) { diagnostic(r, c, 'P026'); valid = false; }
  } else if (tail) {
    const value = json(tail);
    if (value === absent) { diagnostic(r, c, 'P009'); valid = false; }
    else if (!object(value)) { diagnostic(r, c, 'P012'); valid = false; }
    else { e.input = value; e.inputText = tail; }
  }
  for (let i = 0; i < c.body.length; i++) {
    const line = c.body[i];
    if (line.blank || line.text.trimStart().startsWith('#')) continue;
    if (line.indent !== 4) { diagnostic(r, line, 'P006'); continue; }
    const [key, rest] = splitHead(line.text.slice(4));
    if (key === 'input') {
      const info = fromLine(rest);
      let content = '';
      if (info.file === undefined) {
        const texts: string[] = [];
        while (i + 1 < c.body.length && (c.body[i + 1].blank || c.body[i + 1].indent >= 6)) {
          const next = c.body[++i]; texts.push(next.blank ? '' : next.text.slice(6));
        }
        while (texts.at(-1) === '') texts.pop();
        content = texts.length ? texts.join('\n') + '\n' : '';
      }
      if (e.rawMode) diagnostic(r, line, 'P022');
      else setInput(r, e, line, info, content);
    } else if (key === 'expect') {
      const check = expectation(r, line, rest); if (check) e.checks.push(check);
    } else if (key === 'request' || key === 'omit') {
      if (e.rawMode) { diagnostic(r, line, 'P022'); continue; }
      if (key === 'request') {
        if (e.request !== undefined) diagnostic(r, line, 'P052');
        else e.request = request(r, line, rest);
      } else {
        const names = words(rest);
        if (!names.length) diagnostic(r, line, 'P011');
        e.omit.push(...names);
      }
    } else diagnostic(r, line, 'P011');
  }
  return valid ? e : undefined;
}
function cells(text: string): string[] {
  const result: string[] = []; let cell = '';
  const source = text.slice(1);
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\' && source[i + 1] === '|') { cell += '|'; i++; }
    else if (source[i] === '|') { result.push(cell.trim()); cell = ''; }
    else cell += source[i];
  }
  if (!source.endsWith('|') || source.endsWith('\\|')) result.push(cell.trim());
  return result;
}
function table(r: RecordData, c: Clause): Example[] {
  const rows: { line: Line; cells: string[] }[] = [];
  for (const line of c.body) {
    if (line.blank || line.text.trimStart().startsWith('#')) continue;
    const text = line.text.trimStart();
    if (line.indent < 4 || !text.startsWith('|')) { diagnostic(r, line, 'P006'); continue; }
    if (text.endsWith('|') && /^[|:\-\s]+$/.test(text)) continue;
    rows.push({ line, cells: cells(text) });
  }
  if (!/^\S+$/.test(c.rest) || rows.length < 2) { diagnostic(r, c, 'P013'); return []; }
  const cols: { name: string; expected: boolean; tol?: number }[] = [];
  const names = new Set<string>();
  for (const cell of rows[0].cells) {
    const m = /^([^\s±]+?)(?=\+-|\s|±|$)([\s\S]*)$/.exec(cell);
    const name = m?.[1] ?? '', rest = m?.[2].trim() ?? '';
    const expected = /^(result|audit|error|id)(\.|$)/.test(name);
    const tolerance = /^(?:±|\+-)\s*([\s\S]*)$/.exec(rest);
    if (!name || (!expected && !/^[A-Za-z0-9_-]+$/.test(name)) || (rest && !tolerance) || names.has(name)) {
      diagnostic(r, rows[0].line, 'P013'); return [];
    }
    names.add(name);
    let tol: number | undefined;
    if (tolerance) {
      const n = number(tolerance[1]);
      if (!expected || n === absent || n < 0) diagnostic(r, rows[0].line, 'P010');
      else tol = n;
    }
    cols.push({ name, expected, tol });
  }
  const result: Example[] = [];
  for (const row of rows.slice(1)) {
    if (row.cells.length !== cols.length) { diagnostic(r, row.line, 'P014'); continue; }
    const e: Example = { file: c.file, line: row.line.line, op: c.rest, rawMode: false, input: {}, modified: false, checks: [], omit: [] };
    const input: string[] = [];
    row.cells.forEach((cell, i) => {
      if (!cell) return;
      const col = cols[i];
      if (col.expected && cell === '?') { e.checks.push({ file: c.file, line: e.line, path: col.name, kind: 'eq', from: 'oracle' }); return; }
      const value = col.tol === undefined ? json(cell) : number(cell);
      if (value === absent) { diagnostic(r, row.line, col.tol === undefined ? 'P009' : 'P010'); return; }
      if (col.expected) e.checks.push({ file: c.file, line: e.line, path: col.name, kind: col.tol === undefined ? 'eq' : 'approx', value, ...(col.tol === undefined ? {} : { tol: col.tol }) });
      else { Object.defineProperty(e.input, col.name, { value, enumerable: true, writable: true, configurable: true }); input.push(JSON.stringify(col.name) + ':' + cell); }
    });
    e.inputText = '{' + input.join(',') + '}'; result.push(e);
  }
  return result;
}
const allowed: Record<string, string[]> = {
  duramen: [], spec: ['title', 'text', 'contract', 'request'], oracle: ['source'],
  section: ['text'], op: ['input', 'result', 'tolerance', 'audit', 'request', 'returns'],
  req: ['text', 'decision', 'on', 'example', 'table', 'static'], open: ['text', 'example', 'table'],
  decision: ['source', 'status', 'text', 'rejected'], note: ['text'], errors: [],
};
const once: Record<string, string[]> = {
  spec: ['title', 'contract', 'request', 'text'], op: ['result', 'audit', 'request'], req: ['text', 'on'],
  decision: ['source', 'status', 'text'], section: ['text'], open: ['text'], note: ['text'],
};
function readStatement(r: RecordData, s: Statement): void {
  if (s.kind === 'spec' && !/^\S+\s+\S+$/.test(s.rest)) diagnostic(r, s, 'P021');
  if (s.kind === 'oracle' && !s.rest) diagnostic(r, s, 'P028');
  if (s.kind === 'op' && !/^\S+$/.test(s.rest)) diagnostic(r, s, 'P031');
  if ((s.kind === 'errors' || s.kind === 'note') && s.rest) diagnostic(r, s, 'P050');
  if (['section', 'req', 'open', 'decision'].includes(s.kind)) {
    const [id, title] = splitHead(s.rest); s.id = id;
    if (title.length < 2 || !title.startsWith('"') || !title.endsWith('"')) diagnostic(r, s, 'P005');
    else s.title = quoted(r, s, title);
  }
  const seen = new Set<string>();
  for (const c of s.clauses) {
    if (s.kind !== 'errors' && !allowed[s.kind]?.includes(c.key)) { diagnostic(r, c, 'P015'); continue; }
    if (once[s.kind]?.includes(c.key)) {
      if (seen.has(c.key)) { diagnostic(r, c, 'P052'); continue; }
      seen.add(c.key);
    }
    if (s.kind === 'errors') {
      const [when, condition] = splitHead(c.rest);
      if (when !== 'when' || !condition) diagnostic(r, c, 'P019');
      const texts = [condition];
      for (const line of c.body) {
        if (!line.blank && line.indent < 4) diagnostic(r, line, 'P006');
        else texts.push(line.blank ? '' : line.text.slice(4));
      }
      if (s === r.errors) r.conditions.push({ code: c.key, text: texts.join('\n'), loc: c });
      continue;
    }
    if (c.key === 'text') {
      if (c.rest) diagnostic(r, c, 'P008');
      const texts: string[] = [];
      for (const line of c.body) {
        if (!line.blank && line.indent < 4) diagnostic(r, line, 'P008');
        else texts.push(line.blank ? '' : line.text.slice(4));
      }
      while (texts[0] === '') texts.shift(); while (texts.at(-1) === '') texts.pop();
      s.text = texts.join('\n'); s.textLine = c;
      continue;
    }
    if (c.key === 'example' || c.key === 'table') {
      if (s.kind === 'open') { s.openTests.push(c); continue; }
      if (c.key === 'table') s.examples.push(...table(r, c));
      else { const e = example(r, c); if (e) s.examples.push(e); }
      continue;
    }
    for (const line of c.body) if (!line.blank && !line.text.trimStart().startsWith('#')) diagnostic(r, line, 'P006');
    if (c.key === 'title') s.title = quoted(r, c, c.rest);
    else if (c.key === 'request') s.request = request(r, c, c.rest);
    else if (c.key === 'source' || c.key === 'status' || c.key === 'result') s[c.key] = c.rest;
    else if (c.key === 'rejected') { const value = quoted(r, c, c.rest); if (value !== undefined) s.rejected.push(value); }
    else if (c.key === 'decision') s.decisions.push(...words(c.rest));
    else if (c.key === 'on') {
      if (!['any', 'posix', 'windows'].includes(c.rest)) diagnostic(r, c, 'P033'); else s.platform = c.rest;
    } else if (c.key === 'audit') {
      if (c.rest && c.rest !== 'text') diagnostic(r, c, 'P050'); else s.audit = true;
    } else if (c.key === 'input') {
      for (const field of fields(c.rest)) {
        const m = /^([A-Za-z0-9_-]+)(\?)?\s+\S[\s\S]*$/.exec(field);
        if (!m) diagnostic(r, c, 'P017');
        else if (s.fields.has(m[1])) diagnostic(r, c, 'P052');
        else s.fields.set(m[1], Boolean(m[2]));
      }
    } else if (c.key === 'tolerance') {
      const [p, tail] = splitHead(c.rest), n = number(tail);
      if (!p || n === absent || n < 0) diagnostic(r, c, 'P018');
      else if (own(s.tolerances, p)) diagnostic(r, c, 'P052');
      else Object.defineProperty(s.tolerances, p, { value: n, enumerable: true });
    }
  }
}
export function parse(files: Record<string, string>, entry = '.'): RecordData {
  const fileEntry = own(files, entry);
  const folder = fileEntry ? path.posix.dirname(entry) : entry;
  const r: RecordData = { files, entry, folder, diagnostics: [], statements: [], conditions: [] };
  const prefix = entry === '.' ? '' : entry + '/';
  const names = fileEntry ? [entry] : Object.keys(files).filter(name => {
    if (!name.startsWith(prefix) || !name.endsWith('.duramen')) return false;
    const parts = name.slice(prefix.length).split('/');
    return !parts.some((p, i) => p.startsWith('.') || (i < parts.length - 1 && ['build', 'node_modules'].includes(p)));
  }).sort(compare);
  if (!names.length) { diagnostic(r, { file: entry, line: 1 }, 'P046'); return r; }
  const versions = new Set<string>();
  for (const file of names) {
    let current: Statement | undefined, clause: Clause | undefined, versionSeen = false;
    const local: Statement[] = [];
    const rawLines = files[file].replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    rawLines.forEach((raw, index) => {
      const text = raw.trimEnd(), loc = { file, line: index + 1 };
      if (!text) { if (clause) clause.body.push({ ...loc, text: '', indent: 0, blank: true }); return; }
      const leading = /^\s*/.exec(text)![0];
      if (/[^ ]/.test(leading)) { diagnostic(r, loc, 'P001'); return; }
      const indent = leading.length;
      if (indent === 0) {
        if (text.startsWith('#')) return;
        const [kind, rest] = splitHead(text);
        clause = undefined;
        current = { ...loc, kind, rest, id: splitHead(rest)[0], platform: 'any', decisions: [], examples: [], rejected: [], fields: new Map(), tolerances: {}, audit: false, clauses: [], openTests: [] };
        local.push(current);
        if (!own(allowed, kind) && !['type', 'edge', 'edgedef', 'property', 'evidence'].includes(kind)) diagnostic(r, loc, 'P002');
        if (kind === 'duramen') {
          if (versionSeen || !['0.1', '0.2'].includes(rest)) diagnostic(r, loc, 'P023');
          else versions.add(rest);
          versionSeen = true;
        }
        if (['spec', 'oracle', 'errors'].includes(kind)) {
          const key = kind as 'spec' | 'oracle' | 'errors';
          if (r[key]) diagnostic(r, loc, kind === 'errors' ? 'P032' : 'P044');
          else r[key] = current;
        }
      } else {
        if (!current) { diagnostic(r, loc, 'P003'); return; }
        if (!own(allowed, current.kind)) return;
        if (indent === 1) { diagnostic(r, loc, 'P007'); return; }
        if (indent === 2) {
          if (text.slice(2).startsWith('#')) return;
          const [key, rest] = splitHead(text.slice(2));
          clause = { ...loc, key, rest, body: [] }; current.clauses.push(clause);
        } else if (!clause) diagnostic(r, loc, 'P006');
        else clause.body.push({ ...loc, text, indent, blank: false });
      }
    });
    if (!versionSeen) diagnostic(r, { file, line: 1 }, 'P020');
    r.statements.push(...local.filter(s => own(allowed, s.kind)));
  }
  if (!r.spec) diagnostic(r, { file: entry, line: 1 }, 'P021');
  if (versions.size > 1) diagnostic(r, { file: entry, line: 1 }, 'P047');
  for (const s of r.statements) readStatement(r, s);
  return r;
}
