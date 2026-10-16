import { object, own, readJSON } from './comparison.ts';
import { diagnostic } from './model.ts';
import type { Clause, Example, Line, RecordModel, Statement } from './model.ts';

const keywords = new Set(['duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note', 'type', 'edge', 'edgedef', 'property', 'evidence']);
const allowed: Record<string, string[]> = {
  duramen: [], spec: ['title', 'contract', 'request', 'text'], oracle: ['source'],
  op: ['input', 'result', 'tolerance', 'audit', 'request', 'returns'],
  req: ['text', 'decision', 'on', 'example', 'table', 'static'], open: ['text', 'example', 'table'],
  decision: ['source', 'status', 'text', 'rejected'], section: ['text'], note: ['text'],
};
const once: Record<string, string[]> = {
  spec: ['title', 'contract', 'request', 'text'], op: ['result', 'audit', 'request'], req: ['text', 'on'],
  decision: ['source', 'status', 'text'], section: ['text'], open: ['text'], note: ['text'],
};
export function words(text: string): string[] { return text.split(/[\s,]+/).filter(Boolean); }
function head(text: string): [string, string] {
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  return m ? [m[1], m[2] ?? ''] : ['', ''];
}
function trimBlank(lines: string[], start = true): string[] {
  while (lines.length && lines.at(-1)!.trim() === '') lines.pop();
  if (start) while (lines.length && lines[0].trim() === '') lines.shift();
  return lines;
}
function parseRequest(r: RecordModel, c: Line, text: string): any {
  let value;
  try { value = readJSON(text); } catch { diagnostic(r, c, 'P009'); return undefined; }
  if (!object(value)) { diagnostic(r, c, 'P009'); return undefined; }
  if (['id', 'op', 'input'].some(k => own(value, k))) { diagnostic(r, c, 'P051'); return undefined; }
  return value;
}
function jsonString(r: RecordModel, loc: Line | Statement, text: string): string | undefined {
  try { const v = JSON.parse(text); if (typeof v === 'string') return v; } catch {}
  diagnostic(r, loc, 'P004');
}

export function splitFields(text: string): string[] {
  const result: string[] = [];
  let start = 0, depth = 0, quote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === '\\') i++; else if (ch === '"') quote = false; }
    else if (ch === '"') quote = true;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) { result.push(text.slice(start, i).trim()); start = i + 1; }
  }
  result.push(text.slice(start).trim());
  return result;
}

function inputPath(text: string): string[] | undefined {
  const parts: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      const start = i++;
      let closed = false;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i++] === '"') { closed = true; break; }
      }
      if (!closed) return undefined;
      try { parts.push(JSON.parse(text.slice(start, i))); } catch { return undefined; }
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(text.slice(i));
      if (!m) return undefined;
      parts.push(m[0]); i += m[0].length;
    }
    if (i === text.length) return parts;
    if (text[i++] !== '.' || i === text.length) return undefined;
  }
  return undefined;
}

function fromForm(text: string): { path: string; name?: string } {
  const m = /^([\s\S]*\S)\s+from\s+("[\s\S]*")$/.exec(text);
  if (m) {
    try { const name = JSON.parse(m[2]); if (typeof name === 'string') return { path: m[1].trimEnd(), name }; } catch {}
  }
  return { path: text };
}
function fromText(r: RecordModel, file: string, name: string): string | undefined {
  const parts = file.split('/').slice(0, -1);
  for (const part of name.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (!parts.length) return undefined; parts.pop(); }
    else parts.push(part);
  }
  const target = parts.join('/');
  if (r.folder && !target.startsWith(r.folder + '/')) return undefined;
  return own(r.files, target) ? r.files[target] : undefined;
}

function expectation(r: RecordModel, loc: Line, rest: string): any {
  const m = /^([^\s=≈~]+)\s*(=|≈|~)\s*([\s\S]*)$/.exec(rest);
  if (!m) { diagnostic(r, loc, 'P011'); return; }
  const [, path, operator, valueText] = m;
  if (operator === '=') {
    if (valueText === '?') return { file: loc.file, line: loc.line, path, kind: 'oracle' };
    try { return { file: loc.file, line: loc.line, path, kind: 'eq', value: readJSON(valueText) }; }
    catch { diagnostic(r, loc, 'P009'); return; }
  }
  const approx = /^([\s\S]*?)\s*(?:±|\+-)\s*([\s\S]*)$/.exec(valueText);
  if (approx) {
    try {
      const value = readJSON(approx[1]), tol = readJSON(approx[2]);
      if (typeof value === 'number' && typeof tol === 'number' && tol >= 0)
        return { file: loc.file, line: loc.line, path, kind: 'approx', value, tol };
    } catch {}
  }
  diagnostic(r, loc, 'P010');
}

function parseExample(r: RecordModel, c: Clause): Example | undefined {
  const [op, rest] = head(c.rest);
  const e: Example = { file: c.file, line: c.line, op, input: {}, inputLines: false, expectations: [], omit: new Set() };
  const raw = op === 'raw';
  let valid = true;
  if (!op) { diagnostic(r, c, 'P012'); valid = false; }
  else if (raw) {
    let text;
    if (rest.length >= 2 && rest.startsWith("'") && rest.endsWith("'")) text = rest.slice(1, -1);
    else text = jsonString(r, c, rest);
    if (text === undefined) valid = false;
    else if (/[\r\n]/.test(text)) { diagnostic(r, c, 'P026'); valid = false; }
    else e.raw = text;
  } else if (rest) {
    try {
      const value = readJSON(rest);
      if (!object(value)) { diagnostic(r, c, 'P012'); valid = false; }
      else { e.input = value; e.inputText = rest; }
    } catch { diagnostic(r, c, 'P009'); valid = false; }
  }
  for (let i = 0; i < c.body.length; i++) {
    const line = c.body[i];
    if (line.blank || line.text.trimStart().startsWith('#')) continue;
    if (line.indent !== 4) { diagnostic(r, line, 'P006'); continue; }
    const [key, rest] = head(line.text.slice(4));
    if (key === 'expect') {
      const exp = expectation(r, line, rest);
      if (exp) e.expectations.push(exp);
    } else if (key === 'request') {
      if (raw) diagnostic(r, line, 'P022');
      else if (e.request !== undefined) diagnostic(r, line, 'P052');
      else e.request = parseRequest(r, line, rest);
    } else if (key === 'omit') {
      if (raw) diagnostic(r, line, 'P022');
      else {
        const names = words(rest);
        if (!names.length) diagnostic(r, line, 'P011');
        names.forEach(n => e.omit.add(n));
      }
    } else if (key === 'input') {
      const form = fromForm(rest);
      let text: string | undefined;
      if (form.name === undefined) {
        const lines: string[] = [];
        while (i + 1 < c.body.length && (c.body[i + 1].blank || c.body[i + 1].indent >= 6)) {
          const next = c.body[++i];
          lines.push(next.blank ? '' : next.text.slice(6));
        }
        trimBlank(lines, false);
        if (lines.length) text = lines.join('\n') + '\n';
      }
      if (raw) { diagnostic(r, line, 'P022'); continue; }
      e.inputLines = true;
      const path = inputPath(form.path);
      if (!path) { diagnostic(r, line, 'P049'); continue; }
      if (form.name !== undefined) {
        text = fromText(r, line.file, form.name);
        if (text === undefined) { diagnostic(r, line, 'P048'); continue; }
      }
      let target = e.input, good = true;
      for (const part of path.slice(0, -1)) {
        if (!own(target, part)) Object.defineProperty(target, part, { value: {}, enumerable: true, writable: true, configurable: true });
        if (!object(target[part])) { good = false; break; }
        target = target[part];
      }
      if (!good || text === undefined) { diagnostic(r, line, 'P049'); continue; }
      Object.defineProperty(target, path.at(-1)!, { value: text, enumerable: true, writable: true, configurable: true });
    } else diagnostic(r, line, 'P011');
  }
  return valid ? e : undefined;
}

function rowCells(text: string): string[] {
  const cells: string[] = [];
  let cell = '';
  for (let i = 1; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') { cell += '|'; i++; }
    else if (text[i] === '|') { cells.push(cell.trim()); cell = ''; }
    else cell += text[i];
  }
  if (!text.endsWith('|') || text.endsWith('\\|')) cells.push(cell.trim());
  return cells;
}
function parseTable(r: RecordModel, c: Clause): Example[] {
  const rows: Line[] = [];
  for (const line of c.body) {
    if (line.blank || line.text.trimStart().startsWith('#')) continue;
    if (line.indent < 4 || !line.text.trimStart().startsWith('|')) { diagnostic(r, line, 'P006'); continue; }
    if (/^\|[|\-:\s]*\|$/.test(line.text.trim()) || line.text.trim() === '|') continue;
    rows.push(line);
  }
  if (!/^\S+$/.test(c.rest) || rows.length < 2) { diagnostic(r, c, 'P013'); return []; }
  const header = rows[0], names = new Set<string>();
  const columns: { name: string; expectation: boolean; tol?: number }[] = [];
  for (const cell of rowCells(header.text.trimStart())) {
    const m = /^([^\s±]+?)(?:\s*(?:±|\+-)\s*([\s\S]*))?$/.exec(cell);
    // '+-' also terminates a name without white space.
    if (!m || m[1].includes('+-')) { diagnostic(r, header, 'P013'); return []; }
    const name = m[1], exp = /^(result|audit|error|id)(?:\.|$)/.test(name);
    if ((!exp && !/^[A-Za-z0-9_-]+$/.test(name)) || names.has(name)) { diagnostic(r, header, 'P013'); return []; }
    names.add(name);
    const col: { name: string; expectation: boolean; tol?: number } = { name, expectation: exp };
    if (m[2] !== undefined) {
      let tol;
      try { tol = readJSON(m[2]); } catch {}
      if (!exp || typeof tol !== 'number' || tol < 0) diagnostic(r, header, 'P010');
      else col.tol = tol;
    }
    columns.push(col);
  }
  const examples: Example[] = [];
  for (const row of rows.slice(1)) {
    const cells = rowCells(row.text.trimStart());
    if (cells.length !== columns.length) { diagnostic(r, row, 'P014'); continue; }
    const e: Example = { file: row.file, line: row.line, op: c.rest, input: {}, inputLines: false, expectations: [], omit: new Set() };
    const inputParts: string[] = [];
    cells.forEach((cell, i) => {
      if (!cell) return;
      const col = columns[i];
      if (col.expectation && cell === '?') { e.expectations.push({ ...row, path: col.name, kind: 'oracle' }); return; }
      let value;
      try { value = readJSON(cell); } catch { diagnostic(r, row, col.tol === undefined ? 'P009' : 'P010'); return; }
      if (col.tol !== undefined && typeof value !== 'number') { diagnostic(r, row, 'P010'); return; }
      if (col.expectation) e.expectations.push({ file: row.file, line: row.line, path: col.name, kind: col.tol === undefined ? 'eq' : 'approx', value, ...(col.tol === undefined ? {} : { tol: col.tol }) });
      else { Object.defineProperty(e.input, col.name, { value, enumerable: true, writable: true, configurable: true }); inputParts.push(JSON.stringify(col.name) + ':' + cell); }
    });
    e.inputText = '{' + inputParts.join(',') + '}';
    examples.push(e);
  }
  return examples;
}

function parseClauses(r: RecordModel, s: Statement, body: Line[]): void {
  let clause: Clause | undefined;
  for (const line of body) {
    if (line.blank) { clause?.body.push(line); continue; }
    if (line.indent === 1) { diagnostic(r, line, 'P007'); continue; }
    if (line.indent === 2) {
      if (line.text.slice(2).startsWith('#')) continue;
      const [key, rest] = head(line.text.slice(2));
      clause = { ...line, key, rest, body: [] };
      s.clauses.push(clause);
    } else if (clause) clause.body.push(line);
    else diagnostic(r, line, 'P006');
  }
  const seen = new Set<string>();
  for (const c of s.clauses) {
    if (s.key === 'errors') {
      const m = /^(\S+)\s+when\s+([\s\S]+)$/.exec(c.text.slice(2));
      if (!m) diagnostic(r, c, 'P019');
      const extra: string[] = [];
      for (const line of c.body) {
        if (!line.blank && line.indent < 4) diagnostic(r, line, 'P006');
        else extra.push(line.blank ? '' : line.text.slice(4));
      }
      s.conditions.push({ file: c.file, line: c.line, code: c.key, text: [m?.[2] ?? '', ...extra].join('\n') });
      continue;
    }
    if (!allowed[s.key]?.includes(c.key)) { diagnostic(r, c, 'P015'); continue; }
    if (once[s.key]?.includes(c.key)) {
      if (seen.has(c.key)) { diagnostic(r, c, 'P052'); continue; }
      seen.add(c.key);
    }
    if (s.key === 'open' && (c.key === 'example' || c.key === 'table')) continue;
    if (!['text', 'example', 'table'].includes(c.key)) {
      c.body.forEach(line => { if (!line.blank && !line.text.trimStart().startsWith('#')) diagnostic(r, line, 'P006'); });
    }
    if (c.key === 'text') {
      if (c.rest) diagnostic(r, c, 'P008');
      const text: string[] = [];
      c.body.forEach(line => {
        if (!line.blank && line.indent < 4) diagnostic(r, line, 'P008');
        else text.push(line.blank ? '' : line.text.slice(4));
      });
      s.text = trimBlank(text).join('\n'); s.textLine = c.line;
    } else if (c.key === 'title') s.title = jsonString(r, c, c.rest);
    else if (c.key === 'request') s.request = parseRequest(r, c, c.rest);
    else if (c.key === 'input') {
      for (const field of splitFields(c.rest)) {
        const m = /^([A-Za-z0-9_-]+)(\?)?\s+([\s\S]+)$/.exec(field);
        if (!m) diagnostic(r, c, 'P017');
        else if (s.fields.has(m[1])) diagnostic(r, c, 'P052');
        else s.fields.set(m[1], !!m[2]);
      }
    } else if (c.key === 'tolerance') {
      const [path, rest] = head(c.rest);
      let tol;
      try { tol = readJSON(rest); } catch {}
      if (!path || typeof tol !== 'number' || tol < 0) diagnostic(r, c, 'P018');
      else if (s.tolerances.has(path)) diagnostic(r, c, 'P052');
      else s.tolerances.set(path, tol);
    } else if (c.key === 'audit') {
      if (c.rest !== '' && c.rest !== 'text') diagnostic(r, c, 'P050');
      s.audit = true;
    } else if (c.key === 'result') s.result = c.rest;
    else if (c.key === 'on') {
      if (!['any', 'posix', 'windows'].includes(c.rest)) diagnostic(r, c, 'P033');
      else s.platform = c.rest;
    } else if (c.key === 'decision') words(c.rest).forEach(id => s.citations.add(id));
    else if (c.key === 'source') s.source = c.rest;
    else if (c.key === 'status') s.status = c.rest;
    else if (c.key === 'rejected') { const text = jsonString(r, c, c.rest); if (text !== undefined) s.rejected.push(text); }
    else if (c.key === 'example') { const e = parseExample(r, c); if (e) s.examples.push(e); }
    else if (c.key === 'table') s.examples.push(...parseTable(r, c));
  }
}

export function parseRecord(files: Record<string, string>, entry = '.'): RecordModel {
  const isFile = own(files, entry);
  const folder = isFile ? entry.split('/').slice(0, -1).join('/') : entry === '.' ? '' : entry;
  const r: RecordModel = { name: entry, folder, files, statements: [], diagnostics: [] };
  const prefix = folder ? folder + '/' : '';
  const selected = isFile ? [entry] : Object.keys(files).filter(file => {
    if (!file.startsWith(prefix) || !file.endsWith('.duramen')) return false;
    const parts = file.slice(prefix.length).split('/');
    return parts.every((part, i) => !part.startsWith('.') && (i === parts.length - 1 || !['build', 'node_modules'].includes(part)));
  }).sort();
  if (!selected.length) { diagnostic(r, { file: entry, line: 1 }, 'P046'); return r; }
  const versions = new Set<string>();
  for (const file of selected) {
    const text = files[file].replace(/^\uFEFF/, '');
    let current: Statement | undefined, body: Line[] = [], seenVersion = false;
    const finish = () => { if (current && keywords.has(current.key)) parseClauses(r, current, body); body = []; };
    const lines = text.split(/\r\n|\r|\n/);
    lines.forEach((raw, i) => {
      const text = raw.trimEnd(), blank = text.trim() === '';
      const line: Line = { file, line: i + 1, text, indent: text.length - text.trimStart().length, blank };
      if (blank) { if (current) body.push(line); return; }
      if (/[^ ]/.test(text.slice(0, line.indent))) { diagnostic(r, line, 'P001'); return; }
      if (line.indent === 0 && text.startsWith('#')) return;
      if (line.indent !== 0) {
        if (!current) diagnostic(r, line, 'P003');
        else body.push(line);
        return;
      }
      finish();
      const [key, rest] = head(text);
      current = { file, line: i + 1, key, rest, id: '', clauses: [], fields: new Map(), tolerances: new Map(), platform: 'any', examples: [], citations: new Set(), rejected: [], conditions: [] };
      if (!keywords.has(key)) { diagnostic(r, line, 'P002'); return; }
      r.statements.push(current);
      if (key === 'duramen') {
        if (seenVersion || !['0.1', '0.2'].includes(rest)) diagnostic(r, line, 'P023');
        else versions.add(rest);
        seenVersion = true;
      } else if (key === 'spec') {
        if (!/^\S+\s+\S+$/.test(rest)) diagnostic(r, line, 'P021');
        if (r.spec) diagnostic(r, line, 'P044'); else r.spec = current;
      } else if (key === 'oracle') {
        if (!rest) diagnostic(r, line, 'P028');
        current.command = rest;
        if (r.oracle) diagnostic(r, line, 'P044'); else r.oracle = current;
      } else if (key === 'errors') {
        if (rest) diagnostic(r, line, 'P050');
        if (r.errors) diagnostic(r, line, 'P032'); else r.errors = current;
      } else if (key === 'op') {
        if (!/^\S+$/.test(rest)) diagnostic(r, line, 'P031');
        current.id = rest;
      } else if (['req', 'open', 'decision', 'section'].includes(key)) {
        const [id, title] = head(rest); current.id = id;
        if (title.length < 2 || !title.startsWith('"') || !title.endsWith('"')) diagnostic(r, line, 'P005');
        else current.title = jsonString(r, line, title);
      } else if (key === 'note' && rest) diagnostic(r, line, 'P050');
    });
    finish();
    if (!seenVersion) diagnostic(r, { file, line: 1 }, 'P020');
  }
  if (!r.spec) diagnostic(r, { file: entry, line: 1 }, 'P021');
  if (versions.size > 1) diagnostic(r, { file: entry, line: 1 }, 'P047');
  return r;
}
