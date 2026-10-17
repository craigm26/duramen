import { compare, dict, json, number, object, own } from './values.ts';

export type Location = { file: string; line: number };
export type Diagnostic = Location & { code: string; level: 'error' | 'warning' | 'info' };
type Line = Location & { text: string; indent: number };
type Clause = Line & { key: string; rest: string; body: Line[] };
export type Statement = Location & {
  kind: string; rest: string; id?: string; text?: string; textLine?: number;
  clauses: Clause[]; examples: Example[]; fields: Map<string, boolean>;
  tolerances: Record<string, number>; citations: string[]; rejected: string[];
  request?: any; platform: string; result?: string; audit?: boolean;
  source?: string; status?: string;
};
export type Expectation = Location & { path: string; kind: 'eq' | 'approx'; value?: any; tol?: number; from?: 'oracle' };
export type Example = Location & {
  op: string; raw?: string; isRaw: boolean; input?: any; inputText?: string;
  inputLines: boolean; checks: Expectation[]; request?: any; omit: Set<string>;
  id?: string; requestLine?: string; solo?: boolean; answer?: any;
};
export type RecordModel = {
  files: Record<string, string>; entry: string; folder: string; diagnostics: Diagnostic[];
  statements: Statement[]; spec?: Statement; oracle?: Statement; errors?: Statement;
  errorCodes: Set<string>;
};
const word = (text: string): [string, string] => {
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  return match ? [match[1], match[2] ?? ''] : ['', ''];
};
const core = new Set(['duramen','spec','oracle','section','op','errors','req','open','decision','note']);
const restKinds = new Set(['type','edge','edgedef','property','evidence']);
const allowed: Record<string, string[]> = {
  duramen: [], spec: ['title','text','contract','request'], oracle: ['source'],
  section: ['text'], op: ['input','result','tolerance','audit','request','returns'],
  errors: [], req: ['text','decision','on','example','table','static'],
  open: ['text','example','table'], decision: ['source','status','text','rejected'], note: ['text']
};
const once: Record<string, string[]> = {
  spec: ['title','contract','request','text'], op: ['result','audit','request'],
  req: ['text','on'], decision: ['source','status','text'], section: ['text'], open: ['text'], note: ['text']
};
export function add(r: RecordModel, where: Location, code: string, level: Diagnostic['level'] = 'error'): void {
  r.diagnostics.push({ file: where.file, line: where.line, code, level });
}
function quoted(r: RecordModel, at: Location, text: string): string | undefined {
  try { const v = json(text); if (typeof v === 'string') return v; } catch {}
  add(r, at, 'P004');
}
function request(r: RecordModel, at: Location, text: string): any {
  let value;
  try { value = json(text); if (!object(value)) throw new Error(); }
  catch { add(r, at, 'P009'); return undefined; }
  if (['id','op','input'].some(k => own(value, k))) { add(r, at, 'P051'); return undefined; }
  return value;
}
function splitFields(text: string): string[] {
  const parts: string[] = [];
  let start = 0, depth = 0, quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === '"') quote = false; }
    else if (c === '"') quote = true;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c) && depth > 0) depth--;
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(text.slice(start).trim());
  return parts;
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
      if (!closed) return;
      try { parts.push(JSON.parse(text.slice(start, i))); } catch { return; }
    } else {
      const m = /^[a-zA-Z0-9_-]+/.exec(text.slice(i));
      if (!m) return;
      parts.push(m[0]); i += m[0].length;
    }
    if (i === text.length) return parts;
    if (text[i++] !== '.' || i === text.length) return;
  }
}
function resolveFrom(r: RecordModel, file: string, name: string): string | undefined {
  const parts = file.split('/').slice(0,-1);
  const root = r.folder ? r.folder.split('/') : [];
  for (const part of name.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (parts.length <= root.length) return; parts.pop(); }
    else parts.push(part);
  }
  const resolved = parts.join('/');
  if (root.some((part, i) => parts[i] !== part) || !own(r.files, resolved)) return;
  return resolved;
}
function expectation(r: RecordModel, at: Line, text: string): Expectation | undefined {
  const m = /^([^\s=≈~]+)\s*([=≈~])([\s\S]*)$/.exec(text);
  if (!m) { add(r, at, 'P011'); return; }
  const e: Expectation = { file: at.file, line: at.line, path: m[1], kind: 'eq' };
  const value = m[3].trim();
  if (m[2] === '=') {
    if (value === '?') e.from = 'oracle';
    else { try { e.value = json(value); } catch { add(r, at, 'P009'); return; } }
  } else {
    const nums = /^([\s\S]*?)(?:±|\+-)([\s\S]*)$/.exec(value);
    const v = nums ? number(nums[1].trim()) : undefined;
    const tol = nums ? number(nums[2].trim()) : undefined;
    if (v === undefined || tol === undefined || tol < 0) { add(r, at, 'P010'); return; }
    e.kind = 'approx'; e.value = v; e.tol = tol;
  }
  return e;
}
function readInput(r: RecordModel, e: Example, line: Line, text: string, block: Line[]): void {
  e.inputLines = true;
  const from = /^([\s\S]*?)\s+from\s+("[\s\S]*")$/.exec(text);
  const path = inputPath(from ? from[1].trim() : text);
  if (!path) { add(r, line, 'P049'); return; }
  let value: string;
  if (from) {
    let name;
    try { name = json(from[2]); if (typeof name !== 'string') throw new Error(); }
    catch { add(r, line, 'P049'); return; }
    const file = resolveFrom(r, line.file, name);
    if (file === undefined) { add(r, line, 'P048'); return; }
    value = r.files[file];
  } else {
    const lines = block.map(l => l.text ? l.text.slice(6) : '');
    while (lines.length && lines[lines.length-1] === '') lines.pop();
    value = lines.length ? lines.join('\n') + '\n' : '';
  }
  if (!object(e.input)) e.input = dict();
  let target = e.input;
  for (const key of path.slice(0,-1)) {
    if (!own(target, key)) Object.defineProperty(target, key, {value: dict(), writable: true, enumerable: true, configurable: true});
    if (!object(target[key])) { add(r, line, 'P049'); return; }
    target = target[key];
  }
  if (!from && !value) { add(r, line, 'P049'); return; }
  Object.defineProperty(target, path[path.length-1], {value, writable: true, enumerable: true, configurable: true});
}
function readExample(r: RecordModel, c: Clause): Example | undefined {
  const [op, inputText] = word(c.rest);
  const e: Example = {file: c.file, line: c.line, op, isRaw: op === 'raw', inputLines: false, checks: [], omit: new Set()};
  let valid = true;
  if (!op) { add(r, c, 'P012'); valid = false; }
  else if (e.isRaw) {
    let raw;
    if (inputText.length >= 2 && inputText.startsWith("'") && inputText.endsWith("'")) raw = inputText.slice(1,-1);
    else raw = quoted(r, c, inputText);
    if (raw === undefined) valid = false;
    else if (/[\r\n]/.test(raw)) { add(r, c, 'P026'); valid = false; }
    else e.raw = raw;
  } else if (inputText) {
    try {
      const value = json(inputText);
      if (!object(value)) { add(r, c, 'P012'); valid = false; }
      else { e.input = value; e.inputText = inputText; }
    } catch { add(r, c, 'P009'); valid = false; }
  }
  for (let i = 0; i < c.body.length; i++) {
    const l = c.body[i];
    if (!l.text || l.text.trimStart().startsWith('#')) continue;
    if (l.indent !== 4) { add(r, l, 'P006'); continue; }
    const [kind, text] = word(l.text.slice(4));
    let block: Line[] = [];
    if (kind === 'input') {
      const isFrom = /\s+from\s+"[\s\S]*"$/.test(text);
      if (!isFrom) {
        let end = i + 1;
        while (end < c.body.length && (!c.body[end].text || c.body[end].indent >= 6)) end++;
        block = c.body.slice(i+1, end); i = end-1;
      }
    }
    if (e.isRaw && ['input','request','omit'].includes(kind)) { add(r, l, 'P022'); continue; }
    if (kind === 'expect') { const check = expectation(r, l, text); if (check) e.checks.push(check); }
    else if (kind === 'request') {
      if (e.request !== undefined) add(r, l, 'P052');
      else e.request = request(r, l, text);
    } else if (kind === 'omit') {
      const names = text.split(/[,\s]+/).filter(Boolean);
      if (!names.length) add(r, l, 'P011');
      names.forEach(n => e.omit.add(n));
    } else if (kind === 'input') readInput(r, e, l, text, block);
    else add(r, l, 'P011');
  }
  return valid ? e : undefined;
}
function cells(text: string): string[] {
  const result: string[] = [];
  let cell = '';
  for (let i = 1; i < text.length; i++) {
    if (text[i] === '\\' && text[i+1] === '|') { cell += '|'; i++; }
    else if (text[i] === '|') { result.push(cell.trim()); cell = ''; }
    else cell += text[i];
  }
  if (!text.endsWith('|') || /\\\|$/.test(text)) result.push(cell.trim());
  return result;
}
function readTable(r: RecordModel, c: Clause): Example[] {
  const rows: { at: Line; cells: string[] }[] = [];
  for (const l of c.body) {
    if (!l.text || l.text.trimStart().startsWith('#')) continue;
    if (l.indent < 4 || !l.text.trimStart().startsWith('|')) { add(r, l, 'P006'); continue; }
    const text = l.text.trimStart();
    if (/^\|[-:|\s]*\|$/.test(text) || text === '|') continue;
    rows.push({at:l, cells:cells(text)});
  }
  if (!/^\S+$/.test(c.rest) || rows.length < 2) { add(r, c, 'P013'); return []; }
  const header = rows[0];
  const columns: {name: string; output: boolean; tol?: number}[] = [];
  const names = new Set<string>();
  for (const cell of header.cells) {
    const match = /^([^\s±]+?)(?:(?:\s*(?:±|\+-)\s*)([\s\S]*))?$/.exec(cell);
    // The first '+-' begins a tolerance even when no whitespace precedes it.
    let name = match?.[1] ?? '', tolText = match?.[2];
    if (name.includes('+-')) { const at = name.indexOf('+-'); tolText = name.slice(at+2); name = name.slice(0,at); }
    const output = /^(result|audit|error|id)(\.|$)/.test(name);
    if (!match || (!output && !/^[a-zA-Z0-9_-]+$/.test(name)) || names.has(name)) { add(r, header.at, 'P013'); return []; }
    names.add(name);
    let tol;
    if (tolText !== undefined) {
      tol = number(tolText.trim());
      if (!output || tol === undefined || tol < 0) { add(r, header.at, 'P010'); tol = undefined; }
    }
    columns.push({ name, output, tol });
  }
  const examples: Example[] = [];
  for (const row of rows.slice(1)) {
    if (row.cells.length !== columns.length) { add(r, row.at, 'P014'); continue; }
    const e: Example = {file:c.file, line:row.at.line, op:c.rest, isRaw:false, input:dict(), inputLines:false, checks:[], omit:new Set()};
    const inputs: string[] = [];
    for (let i = 0; i < columns.length; i++) {
      const cell = row.cells[i], col = columns[i];
      if (!cell) continue;
      if (col.output && cell === '?') { e.checks.push({file:c.file,line:row.at.line,path:col.name,kind:'eq',from:'oracle'}); continue; }
      let value;
      if (col.tol !== undefined) {
        value = number(cell);
        if (value === undefined) { add(r, row.at, 'P010'); continue; }
      } else { try { value = json(cell); } catch { add(r, row.at, 'P009'); continue; } }
      if (col.output) e.checks.push({file:c.file,line:row.at.line,path:col.name,kind:col.tol === undefined ? 'eq' : 'approx',value,...(col.tol === undefined ? {} : {tol:col.tol})});
      else {
        Object.defineProperty(e.input, col.name, {value, writable:true, enumerable:true, configurable:true});
        inputs.push(JSON.stringify(col.name) + ':' + cell);
      }
    }
    e.inputText = '{' + inputs.join(',') + '}';
    examples.push(e);
  }
  return examples;
}
function parseStatement(r: RecordModel, first: Line, body: Line[]): Statement {
  const [kind, rest] = word(first.text);
  const s: Statement = {file:first.file,line:first.line,kind,rest,clauses:[],examples:[],fields:new Map(),tolerances:dict(),citations:[],rejected:[],platform:'any'};
  if (!core.has(kind)) { if (!restKinds.has(kind)) add(r, s, 'P002'); return s; }
  if (kind === 'spec' && !/^\S+\s+\S+$/.test(rest)) add(r, s, 'P021');
  if (kind === 'oracle' && !rest) add(r, s, 'P028');
  if (kind === 'op') { if (!/^\S+$/.test(rest)) add(r, s, 'P031'); s.id = word(rest)[0]; }
  if ((kind === 'errors' || kind === 'note') && rest) add(r, s, 'P050');
  if (['req','open','section','decision'].includes(kind)) {
    const [id, title] = word(rest); s.id = id;
    if (title.length < 2 || !title.startsWith('"') || !title.endsWith('"')) add(r, s, 'P005');
    else quoted(r, s, title);
  }
  let clause: Clause | undefined;
  for (const l of body) {
    if (!l.text) { if (clause) clause.body.push(l); continue; }
    if (l.indent === 1) { add(r, l, 'P007'); continue; }
    if (l.indent === 2) {
      const [key, rest] = word(l.text.slice(2));
      clause = {...l,key,rest,body:[]}; s.clauses.push(clause);
    } else if (clause) clause.body.push(l);
    else add(r, l, 'P006');
  }
  const seen = new Set<string>();
  for (const c of s.clauses) {
    if (kind !== 'errors' && !allowed[kind].includes(c.key)) { add(r, c, 'P015'); continue; }
    if (once[kind]?.includes(c.key)) {
      if (seen.has(c.key)) { add(r, c, 'P052'); continue; }
      seen.add(c.key);
    }
    if (kind === 'open' && (c.key === 'example' || c.key === 'table')) continue;
    if (kind === 'errors') {
      const [when, condition] = word(c.rest);
      if (when !== 'when' || !condition) add(r, c, 'P019');
      const lines = [condition];
      for (const l of c.body) {
        if (l.text && l.indent < 4) add(r, l, 'P006');
        else lines.push(l.text ? l.text.slice(4) : '');
      }
      // Preserve each condition separately, including repeated codes.
      (c as any).condition = lines.join('\n');
      continue;
    }
    if (c.key === 'text') {
      if (c.rest) add(r, c, 'P008');
      const lines: string[] = [];
      for (const l of c.body) {
        if (l.text && l.indent < 4) add(r, l, 'P008');
        else lines.push(l.text ? l.text.slice(4) : '');
      }
      while (lines.length && !lines[0]) lines.shift();
      while (lines.length && !lines[lines.length-1]) lines.pop();
      s.text = lines.join('\n'); s.textLine = c.line;
      continue;
    }
    if (c.key === 'example') { const e = readExample(r, c); if (e) s.examples.push(e); continue; }
    if (c.key === 'table') { s.examples.push(...readTable(r, c)); continue; }
    for (const l of c.body) if (l.text && !l.text.trimStart().startsWith('#')) add(r, l, 'P006');
    if (c.key === 'title' || c.key === 'rejected') { const value = quoted(r, c, c.rest); if (c.key === 'rejected' && value !== undefined) s.rejected.push(value); }
    else if (c.key === 'request') s.request = request(r, c, c.rest);
    else if (c.key === 'on') { if (!['any','posix','windows'].includes(c.rest)) add(r, c, 'P033'); else s.platform = c.rest; }
    else if (c.key === 'decision') s.citations.push(...c.rest.split(/[,\s]+/).filter(Boolean));
    else if (c.key === 'source') s.source = c.rest;
    else if (c.key === 'status') s.status = c.rest;
    else if (c.key === 'result') s.result = c.rest;
    else if (c.key === 'audit') { if (c.rest !== '' && c.rest !== 'text') add(r, c, 'P050'); s.audit = true; }
    else if (c.key === 'input') {
      for (const field of splitFields(c.rest)) {
        const m = /^([a-zA-Z0-9_-]+)(\?)?\s+\S[\s\S]*$/.exec(field);
        if (!m) add(r, c, 'P017');
        else if (s.fields.has(m[1])) add(r, c, 'P052');
        else s.fields.set(m[1], !!m[2]);
      }
    } else if (c.key === 'tolerance') {
      const [path, text] = word(c.rest); const tol = number(text);
      if (!path || tol === undefined || tol < 0) add(r, c, 'P018');
      else if (own(s.tolerances, path)) add(r, c, 'P052');
      else s.tolerances[path] = tol;
    }
  }
  return s;
}
export function parseRecord(files: Record<string,string>, entry = '.'): RecordModel {
  const isFile = own(files, entry);
  const folder = isFile ? entry.split('/').slice(0,-1).join('/') : entry === '.' ? '' : entry;
  const r: RecordModel = {files,entry,folder,diagnostics:[],statements:[],errorCodes:new Set()};
  const prefix = folder ? folder + '/' : '';
  const names = isFile ? [entry] : Object.keys(files).filter(name => {
    if (!name.startsWith(prefix)) return false;
    const parts = name.slice(prefix.length).split('/');
    return name.endsWith('.duramen') && !parts.some((part,i) => part.startsWith('.') || (i < parts.length-1 && ['build','node_modules'].includes(part)));
  }).sort(compare);
  if (!names.length) { add(r, {file:entry,line:1}, 'P046'); return r; }
  const versions = new Set<string>();
  for (const file of names) {
    let first: Line | undefined, body: Line[] = [], versionSeen = false;
    function finish(): void {
      if (!first) return;
      const s = parseStatement(r, first, body);
      r.statements.push(s);
      if (s.kind === 'duramen') {
        if (versionSeen || !['0.1','0.2'].includes(s.rest)) add(r, s, 'P023');
        else versions.add(s.rest);
        versionSeen = true;
      } else if (['spec','oracle','errors'].includes(s.kind)) {
        const key = s.kind as 'spec' | 'oracle' | 'errors';
        if (r[key]) add(r, s, key === 'errors' ? 'P032' : 'P044');
        else r[key] = s;
      }
    }
    const text = files[file].replace(/^\uFEFF/, '');
    text.split(/\r\n|\r|\n/).forEach((raw, index) => {
      const text = raw.trimEnd();
      const indent = /^ */.exec(text)![0].length;
      const l: Line = {file,line:index+1,text,indent};
      if (!text) { if (first) body.push(l); return; }
      if (/[^ ]/.test(/^\s*/.exec(text)![0])) { add(r, l, 'P001'); return; }
      if (indent === 0 && text.startsWith('#')) return;
      if (indent === 2 && text.trimStart().startsWith('#') && first) return;
      if (indent === 0) { finish(); first = l; body = []; }
      else if (!first) add(r, l, 'P003');
      else body.push(l);
    });
    finish();
    if (!versionSeen) add(r, {file,line:1}, 'P020');
  }
  if (!r.spec) add(r, {file:entry,line:1}, 'P021');
  if (versions.size > 1) add(r, {file:entry,line:1}, 'P047');
  r.errors?.clauses.forEach(c => r.errorCodes.add(c.key));
  return r;
}
