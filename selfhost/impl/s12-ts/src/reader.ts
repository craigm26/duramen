// Reading a record: files -> statements -> clauses -> a model, with P diagnostics.
import { has, hasHuge, isObject, parseJson, setMember, validRelativePath } from './util.ts';

export interface Diag { file: string; line: number; level: 'error' | 'warning' | 'info'; code: string }

interface Line { n: number; indent: number; text: string; blank: boolean }
interface Clause { kw: string; rest: string; n: number; lines: Line[] }
interface Stmt { kw: string; rest: string; n: number; clauses: Clause[] }

const CORE = new Set(['duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note']);
const REST_OF_LANGUAGE = new Set(['type', 'edge', 'edgedef', 'property', 'evidence']);

export interface Expect {
  n: number;
  path: string;
  kind: 'eq' | 'approx' | 'oracle';
  value?: any;
  tol?: number;
}

export interface Example {
  id: string;
  reqId: string;
  file: string;
  n: number;
  raw: boolean;
  rawLine: string;
  op: string;
  inputText: string | null;
  inputObj: any;
  request: any;
  omit: Set<string>;
  expects: Expect[];
  isRow: boolean;
  response?: any;
  responded?: boolean;
}

export interface TextBlock { n: number; lines: string[] }

export interface Model {
  recordName: string;
  recordFolder: string;
  fileNames: string[];
  spec: null | { file: string; n: number; text: TextBlock | null; request: any };
  oracle: null | { file: string; n: number; command: string };
  errorsSeen: boolean;
  errorCodes: string[];
  errorConds: { file: string; n: number; lines: string[] }[];
  ops: { name: string; file: string; n: number; fields: { name: string; optional: boolean }[]; result: string | null;
    tolerances: Record<string, number>; audit: boolean; request: any }[];
  reqs: { id: string; file: string; n: number; platform: string; text: TextBlock | null; decisions: string[];
    examples: Example[] }[];
  opens: { id: string; file: string; n: number; text: TextBlock | null; items: number[] }[];
  decisions: { id: string; file: string; n: number; source: string | null; status: string | null;
    text: TextBlock | null; rejected: string[] }[];
  sections: { file: string; n: number; text: TextBlock | null }[];
  notes: { file: string; n: number; text: TextBlock | null }[];
  versions: Set<string>;
}

export function dirOf(name: string): string {
  const i = name.lastIndexOf('/');
  return i < 0 ? '' : name.slice(0, i);
}

// Which files make up the record named by `entry`; null when it names nothing.
export function resolveRecord(files: Record<string, string>, entry: string | undefined):
  { name: string; folder: string; list: string[] } | { name: string; missing: true } {
  const names = Object.keys(files);
  const pick = (prefix: string): string[] => {
    const out: string[] = [];
    for (const nm of names) {
      if (!nm.startsWith(prefix)) continue;
      const parts = nm.slice(prefix.length).split('/');
      if (parts.some((p) => p.startsWith('.'))) continue;
      if (parts.slice(0, -1).some((p) => p === 'build' || p === 'node_modules')) continue;
      if (!parts[parts.length - 1].endsWith('.duramen')) continue;
      out.push(nm);
    }
    return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  };
  if (entry === undefined || entry === '.') {
    const list = pick('');
    return list.length ? { name: '.', folder: '', list } : { name: '.', missing: true };
  }
  if (has(files, entry)) return { name: entry, folder: dirOf(entry), list: [entry] };
  const list = pick(entry + '/');
  return list.length ? { name: entry, folder: entry, list } : { name: entry, missing: true };
}

class Reporter {
  diags: Diag[] = [];
  file = '';
  err(line: number, code: string) {
    this.diags.push({ file: this.file, line, level: 'error', code });
  }
}

function lexFile(text: string, rep: Reporter): Line[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const out: Line[] = [];
  const raws = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < raws.length; i++) {
    const n = i + 1;
    const t = raws[i].trimEnd();
    if (t === '') {
      out.push({ n, indent: 0, text: '', blank: true });
      continue;
    }
    let k = 0;
    while (t[k] === ' ') k++;
    const rest = t.slice(k);
    if (/^\s/.test(rest)) {
      rep.err(n, 'P001');
      continue;
    }
    out.push({ n, indent: k, text: rest, blank: false });
  }
  return out;
}

function splitWord(s: string): [string, string] {
  const m = /^(\S+)\s*([^]*)$/.exec(s);
  return m ? [m[1], m[2]] : ['', ''];
}

function structure(lines: Line[], rep: Reporter): Stmt[] {
  const stmts: Stmt[] = [];
  let cur: Stmt | null = null;
  let clause: Clause | null = null;
  let ignoring = false;
  for (const L of lines) {
    if (L.blank) {
      if (clause && !ignoring) clause.lines.push(L);
      continue;
    }
    if (L.indent === 0) {
      if (L.text.startsWith('#')) continue;
      const [kw, rest] = splitWord(L.text);
      cur = { kw, rest, n: L.n, clauses: [] };
      stmts.push(cur);
      clause = null;
      ignoring = !CORE.has(kw) && !REST_OF_LANGUAGE.has(kw);
      continue;
    }
    if (!cur) {
      rep.err(L.n, 'P003');
      continue;
    }
    if (ignoring || REST_OF_LANGUAGE.has(cur.kw)) continue;
    if (L.indent === 1) {
      rep.err(L.n, 'P007');
      continue;
    }
    if (L.indent === 2) {
      if (L.text.startsWith('#')) continue;
      const [kw, rest] = splitWord(L.text);
      clause = { kw, rest, n: L.n, lines: [] };
      cur.clauses.push(clause);
      continue;
    }
    if (!clause) {
      rep.err(L.n, 'P006');
      continue;
    }
    clause.lines.push(L);
  }
  return stmts;
}

type Mode = 'once' | 'many';

function eachClause(st: Stmt, allowed: Record<string, Mode>, rep: Reporter, fn: (c: Clause) => void) {
  const seen = new Set<string>();
  for (const c of st.clauses) {
    if (!has(allowed, c.kw)) {
      rep.err(c.n, 'P015');
      continue;
    }
    if (allowed[c.kw] === 'once') {
      if (seen.has(c.kw)) {
        rep.err(c.n, 'P052');
        continue;
      }
      seen.add(c.kw);
    }
    fn(c);
  }
}

function noLines(c: Clause, rep: Reporter) {
  for (const L of c.lines) if (!L.blank && !L.text.startsWith('#')) rep.err(L.n, 'P006');
}

function textClause(c: Clause, rep: Reporter): TextBlock {
  if (c.rest !== '') rep.err(c.n, 'P008');
  const out: string[] = [];
  for (const L of c.lines) {
    if (L.blank) out.push('');
    else if (L.indent === 3) rep.err(L.n, 'P008');
    else out.push(' '.repeat(L.indent - 4) + L.text);
  }
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  return { n: c.n, lines: out };
}

function quoted(s: string): string | null {
  const p = parseJson(s);
  return p.ok && typeof p.value === 'string' ? p.value : null;
}

function idTitle(st: Stmt, rep: Reporter): string {
  if (st.rest === '') {
    rep.err(st.n, 'P005');
    return '';
  }
  const [id, title] = splitWord(st.rest);
  if (title.length < 2 || !title.startsWith('"') || !title.endsWith('"')) rep.err(st.n, 'P005');
  else if (quoted(title) === null) rep.err(st.n, 'P004');
  return id;
}

function requestObject(rest: string, n: number, rep: Reporter): any {
  const p = parseJson(rest);
  if (!p.ok || hasHuge(p.value) || !isObject(p.value)) {
    rep.err(n, 'P009');
    return null;
  }
  if (has(p.value, 'id') || has(p.value, 'op') || has(p.value, 'input')) {
    rep.err(n, 'P051');
    return null;
  }
  return p.value;
}

export function splitFields(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      cur += c;
      if (c === '\\' && i + 1 < s.length) cur += s[++i];
      else if (c === '"') inQ = false;
      continue;
    }
    if (c === '"') inQ = true;
    else if (c === '[' || c === '{' || c === '(') depth++;
    else if ((c === ']' || c === '}' || c === ')') && depth > 0) depth--;
    else if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function isJsonNumber(t: string): number | null {
  const p = parseJson(t);
  return p.ok && typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : null;
}

function parsePathPrefix(s: string): { names: string[]; end: number } | null {
  const names: string[] = [];
  let i = 0;
  for (;;) {
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      if (j >= s.length) return null;
      const v = quoted(s.slice(i, j + 1));
      if (v === null) return null;
      names.push(v);
      i = j + 1;
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(s.slice(i));
      if (!m) return null;
      names.push(m[0]);
      i += m[0].length;
    }
    if (s[i] === '.') {
      i++;
      continue;
    }
    return { names, end: i };
  }
}

type InputLine = { kind: 'text'; path: string[] | null } | { kind: 'from'; path: string[]; file: string };

function parseInputRest(rest: string): InputLine {
  const pp = parsePathPrefix(rest);
  if (!pp) return { kind: 'text', path: null };
  const tail = rest.slice(pp.end);
  if (tail === '') return { kind: 'text', path: pp.names };
  const m = /^\s+from\s+("[^]*")$/.exec(tail);
  if (m) {
    const f = quoted(m[1]);
    if (f !== null) return { kind: 'from', path: pp.names, file: f };
  }
  return { kind: 'text', path: null };
}

function canSet(obj: any, path: string[]): boolean {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!has(cur, path[i])) return true;
    cur = cur[path[i]];
    if (!isObject(cur)) return false;
  }
  return true;
}

function setPath(obj: any, path: string[], value: any) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!has(cur, path[i])) setMember(cur, path[i], {});
    cur = cur[path[i]];
  }
  setMember(cur, path[path.length - 1], value);
}

interface FileCtx {
  name: string;
  files: Record<string, string>;
  recordFolder: string;
  rep: Reporter;
}

function resolveFrom(fc: FileCtx, name: string): string | null {
  const stack = dirOf(fc.name).split('/').filter((p) => p !== '');
  for (const part of name.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return null;
      stack.pop();
    } else stack.push(part);
  }
  const resolved = stack.join('/');
  if (!has(fc.files, resolved)) return null;
  if (fc.recordFolder !== '' && !resolved.startsWith(fc.recordFolder + '/')) return null;
  return resolved;
}

function parseApprox(body: string): { value: number; tol: number } | null {
  for (let i = 0; i < body.length; i++) {
    let len = 0;
    if (body[i] === '±') len = 1;
    else if (body.startsWith('+-', i)) len = 2;
    else continue;
    const a = isJsonNumber(body.slice(0, i).trim());
    const b = isJsonNumber(body.slice(i + len).trim());
    if (a !== null && b !== null && b >= 0) return { value: a, tol: b };
  }
  return null;
}

function parseExample(c: Clause, fc: FileCtx, reqId: string, num: number): Example {
  const rep = fc.rep;
  const ex: Example = {
    id: reqId + '#' + num, reqId, file: fc.name, n: c.n, raw: false, rawLine: '', op: '', inputText: null,
    inputObj: null, request: null, omit: new Set(), expects: [], isRow: false,
  };
  let work: any = null;
  let hasInputLines = false;
  const [opName, after] = splitWord(c.rest);
  if (c.rest === '') rep.err(c.n, 'P012');
  else if (opName === 'raw') {
    ex.raw = true;
    if (after.startsWith('"')) {
      const v = quoted(after);
      if (v === null) rep.err(c.n, 'P004');
      else if (/[\r\n]/.test(v)) rep.err(c.n, 'P026');
      else ex.rawLine = v;
    } else if (after.length >= 2 && after.startsWith("'") && after.endsWith("'")) {
      ex.rawLine = after.slice(1, -1);
    } else rep.err(c.n, 'P004');
  } else {
    ex.op = opName;
    if (after !== '') {
      const p = parseJson(after);
      if (!p.ok || hasHuge(p.value)) rep.err(c.n, 'P009');
      else if (!isObject(p.value)) rep.err(c.n, 'P012');
      else {
        ex.inputText = after;
        work = p.value;
      }
    }
  }
  let requestRead = false;
  let pending: { n: number; path: string[] | null; lines: string[] } | null = null;
  const flush = () => {
    if (!pending) return;
    const { n, path, lines } = pending;
    pending = null;
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (path === null) return;
    if (work === null) work = {};
    if (!canSet(work, path)) rep.err(n, 'P049');
    else if (lines.length === 0) rep.err(n, 'P049');
    else setPath(work, path, lines.join('\n') + '\n');
  };
  for (const L of c.lines) {
    if (pending) {
      if (L.blank) {
        pending.lines.push('');
        continue;
      }
      if (L.indent >= 6) {
        pending.lines.push(' '.repeat(L.indent - 6) + L.text);
        continue;
      }
      flush();
    }
    if (L.blank) continue;
    if (L.text.startsWith('#')) continue;
    if (L.indent !== 4) {
      rep.err(L.n, 'P006');
      continue;
    }
    const [kw, rest] = splitWord(L.text);
    if (kw === 'expect') {
      const m = /^([^\s=≈~]*)\s*([^]*)$/.exec(rest)!;
      const path = m[1];
      const tail = m[2];
      if (path === '') rep.err(L.n, 'P011');
      else if (tail.startsWith('=')) {
        const v = tail.slice(1).trim();
        if (v === '?') ex.expects.push({ n: L.n, path, kind: 'oracle' });
        else {
          const p = parseJson(v);
          if (!p.ok || hasHuge(p.value)) rep.err(L.n, 'P009');
          else ex.expects.push({ n: L.n, path, kind: 'eq', value: p.value });
        }
      } else if (tail.startsWith('≈') || tail.startsWith('~')) {
        const a = parseApprox(tail.slice(1));
        if (!a) rep.err(L.n, 'P010');
        else ex.expects.push({ n: L.n, path, kind: 'approx', value: a.value, tol: a.tol });
      } else rep.err(L.n, 'P011');
    } else if (kw === 'request') {
      if (ex.raw) rep.err(L.n, 'P022');
      else if (requestRead) rep.err(L.n, 'P052');
      else {
        const r = requestObject(rest, L.n, rep);
        if (r) {
          ex.request = r;
          requestRead = true;
        }
      }
    } else if (kw === 'omit') {
      if (ex.raw) rep.err(L.n, 'P022');
      else {
        const names = rest.split(/[,\s]+/).filter((s) => s !== '');
        if (names.length === 0) rep.err(L.n, 'P011');
        for (const nm of names) ex.omit.add(nm);
      }
    } else if (kw === 'input') {
      hasInputLines = true;
      const parsed = parseInputRest(rest);
      if (ex.raw) {
        rep.err(L.n, 'P022');
        if (parsed.kind === 'text') pending = { n: L.n, path: null, lines: [] };
        continue;
      }
      if (parsed.kind === 'text') {
        pending = { n: L.n, path: parsed.path, lines: [] };
        if (parsed.path === null) rep.err(L.n, 'P049');
        continue;
      }
      const f = resolveFrom(fc, parsed.file);
      if (f === null) {
        rep.err(L.n, 'P048');
        continue;
      }
      if (work === null) work = {};
      if (!canSet(work, parsed.path)) rep.err(L.n, 'P049');
      else setPath(work, parsed.path, fc.files[f]);
    } else rep.err(L.n, 'P011');
  }
  flush();
  if (!ex.raw) {
    if (work === null && hasInputLines) work = {};
    ex.inputObj = work;
    if (hasInputLines) ex.inputText = JSON.stringify(work);
  }
  return ex;
}

function splitRow(text: string): string[] {
  let t = text.slice(1);
  const cells: string[] = [];
  let cur = '';
  let closed = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    closed = false;
    if (c === '\\' && t[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (c === '|') {
      cells.push(cur);
      cur = '';
      closed = true;
    } else cur += c;
  }
  if (!closed) cells.push(cur);
  return cells.map((s) => s.trim());
}

interface Col { name: string; expect: boolean; tol?: number }

function parseTable(c: Clause, fc: FileCtx, reqId: string, startNum: number): Example[] {
  const rep = fc.rep;
  const opWords = c.rest.split(/\s+/).filter((s) => s !== '');
  const rows: { n: number; text: string }[] = [];
  for (const L of c.lines) {
    if (L.blank || L.text.startsWith('#')) continue;
    if (!L.text.startsWith('|') || L.indent < 4) {
      rep.err(L.n, 'P006');
      continue;
    }
    if (L.text.endsWith('|') && /^[|:\-\s]*$/.test(L.text)) continue;
    rows.push({ n: L.n, text: L.text });
  }
  if (opWords.length !== 1 || rows.length < 2) {
    rep.err(c.n, 'P013');
    return [];
  }
  const header = splitRow(rows[0].text);
  const cols: Col[] = [];
  const names = new Set<string>();
  for (const cell of header) {
    let i = 0;
    while (i < cell.length && !/\s/.test(cell[i]) && cell[i] !== '±' && !cell.startsWith('+-', i)) i++;
    const name = cell.slice(0, i);
    const r = cell.slice(i).trimStart();
    let tolText: string | null = null;
    let form = name !== '';
    if (r !== '') {
      if (r.startsWith('±')) tolText = r.slice(1).trim();
      else if (r.startsWith('+-')) tolText = r.slice(2).trim();
      else form = false;
    }
    const isExpect = /^(result|audit|error|id)(\.[^]*)?$/.test(name);
    if (form && !isExpect && !/^[A-Za-z0-9_-]+$/.test(name)) form = false;
    if (!form || names.has(name)) {
      rep.err(rows[0].n, 'P013');
      return [];
    }
    names.add(name);
    const col: Col = { name, expect: isExpect };
    if (tolText !== null) {
      const t = isExpect ? isJsonNumber(tolText) : null;
      if (t === null || t < 0) rep.err(rows[0].n, 'P010');
      else col.tol = t;
    }
    cols.push(col);
  }
  const out: Example[] = [];
  let num = startNum;
  for (const row of rows.slice(1)) {
    const cells = splitRow(row.text);
    if (cells.length !== cols.length) {
      rep.err(row.n, 'P014');
      continue;
    }
    const ex: Example = {
      id: reqId + '#' + num++, reqId, file: fc.name, n: row.n, raw: false, rawLine: '', op: opWords[0],
      inputText: null, inputObj: {}, request: null, omit: new Set(), expects: [], isRow: true,
    };
    const inputParts: string[] = [];
    cols.forEach((col, i) => {
      const cell = cells[i];
      if (cell === '') return;
      if (!col.expect) {
        const p = parseJson(cell);
        if (!p.ok || hasHuge(p.value)) rep.err(row.n, 'P009');
        else {
          inputParts.push(JSON.stringify(col.name) + ':' + cell);
          setMember(ex.inputObj, col.name, p.value);
        }
      } else if (cell === '?') ex.expects.push({ n: row.n, path: col.name, kind: 'oracle' });
      else if (col.tol !== undefined) {
        const v = isJsonNumber(cell);
        if (v === null) rep.err(row.n, 'P010');
        else ex.expects.push({ n: row.n, path: col.name, kind: 'approx', value: v, tol: col.tol });
      } else {
        const p = parseJson(cell);
        if (!p.ok || hasHuge(p.value)) rep.err(row.n, 'P009');
        else ex.expects.push({ n: row.n, path: col.name, kind: 'eq', value: p.value });
      }
    });
    ex.inputText = '{' + inputParts.join(',') + '}';
    out.push(ex);
  }
  return out;
}

export interface ReadResult { diags: Diag[]; model: Model }

export function readRecord(files: Record<string, string>, entry: string | undefined): ReadResult {
  const rep = new Reporter();
  const rec = resolveRecord(files, entry);
  const model: Model = {
    recordName: rec.name, recordFolder: 'folder' in rec ? rec.folder : '', fileNames: [], spec: null, oracle: null,
    errorsSeen: false, errorCodes: [], errorConds: [], ops: [], reqs: [], opens: [], decisions: [], sections: [],
    notes: [], versions: new Set(),
  };
  if ('missing' in rec) {
    rep.file = rec.name;
    rep.err(1, 'P046');
    return { diags: rep.diags, model };
  }
  model.fileNames = rec.list;
  let specSeen = false;
  let oracleSeen = false;
  for (const name of rec.list) {
    rep.file = name;
    const fc: FileCtx = { name, files, recordFolder: rec.folder, rep };
    const stmts = structure(lexFile(files[name], rep), rep);
    let dur = false;
    let version: string | null = null;
    for (const st of stmts) {
      switch (st.kw) {
        case 'duramen': {
          if (dur) rep.err(st.n, 'P023');
          else {
            dur = true;
            if (st.rest === '0.1' || st.rest === '0.2') version = st.rest;
            else rep.err(st.n, 'P023');
          }
          eachClause(st, {}, rep, () => {});
          break;
        }
        case 'spec': {
          const first = !specSeen;
          if (!first) rep.err(st.n, 'P044');
          specSeen = true;
          if (st.rest.split(/\s+/).filter((s) => s !== '').length !== 2) rep.err(st.n, 'P021');
          const sp = { file: name, n: st.n, text: null as TextBlock | null, request: null as any };
          eachClause(st, { title: 'once', text: 'once', contract: 'once', request: 'once' }, rep, (c) => {
            if (c.kw === 'title') {
              if (quoted(c.rest) === null) rep.err(c.n, 'P004');
              noLines(c, rep);
            } else if (c.kw === 'text') sp.text = textClause(c, rep);
            else if (c.kw === 'request') {
              sp.request = requestObject(c.rest, c.n, rep);
              noLines(c, rep);
            } else noLines(c, rep);
          });
          if (first) model.spec = sp;
          break;
        }
        case 'oracle': {
          const first = !oracleSeen;
          if (!first) rep.err(st.n, 'P044');
          oracleSeen = true;
          if (st.rest === '') rep.err(st.n, 'P028');
          eachClause(st, { source: 'many' }, rep, (c) => noLines(c, rep));
          if (first && st.rest !== '') model.oracle = { file: name, n: st.n, command: st.rest };
          break;
        }
        case 'section': {
          idTitle(st, rep);
          let text: TextBlock | null = null;
          eachClause(st, { text: 'once' }, rep, (c) => {
            text = textClause(c, rep);
          });
          model.sections.push({ file: name, n: st.n, text });
          break;
        }
        case 'note': {
          if (st.rest !== '') rep.err(st.n, 'P050');
          let text: TextBlock | null = null;
          eachClause(st, { text: 'once' }, rep, (c) => {
            text = textClause(c, rep);
          });
          model.notes.push({ file: name, n: st.n, text });
          break;
        }
        case 'errors': {
          const first = !model.errorsSeen;
          if (!first) rep.err(st.n, 'P032');
          model.errorsSeen = true;
          if (st.rest !== '') rep.err(st.n, 'P050');
          for (const c of st.clauses) {
            const m = /^when(?:\s+([^]*))?$/.exec(c.rest);
            const firstLine = m && m[1] !== undefined ? m[1].trim() : '';
            if (!m || firstLine === '') rep.err(c.n, 'P019');
            const cond: string[] = [firstLine];
            for (const L of c.lines) {
              if (L.blank) continue;
              if (L.indent === 3) rep.err(L.n, 'P006');
              else cond.push(' '.repeat(L.indent - 4) + L.text);
            }
            if (first && m && firstLine !== '') {
              model.errorCodes.push(c.kw);
              model.errorConds.push({ file: name, n: c.n, lines: cond });
            }
          }
          break;
        }
        case 'op': {
          const words = st.rest.split(/\s+/).filter((s) => s !== '');
          if (words.length !== 1) rep.err(st.n, 'P031');
          const op = { name: words[0] ?? '', file: name, n: st.n, fields: [] as { name: string; optional: boolean }[],
            result: null as string | null, tolerances: {} as Record<string, number>, audit: false, request: null as any };
          eachClause(st, { input: 'many', result: 'once', tolerance: 'many', audit: 'once', request: 'once',
            returns: 'many' }, rep, (c) => {
            if (c.kw === 'returns') return;
            if (c.kw === 'input') {
              for (const raw of splitFields(c.rest)) {
                const f = raw.trim();
                const m = /^([A-Za-z0-9_-]+)(\?)?\s+(\S[^]*)$/.exec(f);
                if (!m) rep.err(c.n, 'P017');
                else if (op.fields.some((x) => x.name === m[1])) rep.err(c.n, 'P052');
                else op.fields.push({ name: m[1], optional: m[2] === '?' });
              }
            } else if (c.kw === 'result') op.result = c.rest;
            else if (c.kw === 'tolerance') {
              const [path, numText] = splitWord(c.rest);
              const v = path === '' ? null : isJsonNumber(numText);
              if (v === null || v < 0) rep.err(c.n, 'P018');
              else if (has(op.tolerances, path)) rep.err(c.n, 'P052');
              else setMember(op.tolerances, path, v === 0 ? 0 : v);
            } else if (c.kw === 'audit') {
              if (c.rest !== '' && c.rest !== 'text') rep.err(c.n, 'P050');
              op.audit = true;
            } else if (c.kw === 'request') op.request = requestObject(c.rest, c.n, rep);
            noLines(c, rep);
          });
          model.ops.push(op);
          break;
        }
        case 'req': {
          const id = idTitle(st, rep);
          const req = { id, file: name, n: st.n, platform: 'any', text: null as TextBlock | null,
            decisions: [] as string[], examples: [] as Example[] };
          eachClause(st, { text: 'once', decision: 'many', on: 'once', example: 'many', table: 'many',
            static: 'many' }, rep, (c) => {
            if (c.kw === 'text') req.text = textClause(c, rep);
            else if (c.kw === 'decision') {
              req.decisions.push(...c.rest.split(/[,\s]+/).filter((s) => s !== ''));
              noLines(c, rep);
            } else if (c.kw === 'on') {
              if (c.rest === 'any' || c.rest === 'posix' || c.rest === 'windows') req.platform = c.rest;
              else rep.err(c.n, 'P033');
              noLines(c, rep);
            } else if (c.kw === 'example') req.examples.push(parseExample(c, fc, id, req.examples.length + 1));
            else if (c.kw === 'table') req.examples.push(...parseTable(c, fc, id, req.examples.length + 1));
          });
          model.reqs.push(req);
          break;
        }
        case 'open': {
          const id = idTitle(st, rep);
          const open = { id, file: name, n: st.n, text: null as TextBlock | null, items: [] as number[] };
          eachClause(st, { text: 'once', example: 'many', table: 'many' }, rep, (c) => {
            if (c.kw === 'text') open.text = textClause(c, rep);
            else open.items.push(c.n);
          });
          model.opens.push(open);
          break;
        }
        case 'decision': {
          const id = idTitle(st, rep);
          const d = { id, file: name, n: st.n, source: null as string | null, status: null as string | null,
            text: null as TextBlock | null, rejected: [] as string[] };
          eachClause(st, { source: 'once', status: 'once', text: 'once', rejected: 'many' }, rep, (c) => {
            if (c.kw === 'text') d.text = textClause(c, rep);
            else {
              if (c.kw === 'source') d.source = c.rest;
              else if (c.kw === 'status') d.status = c.rest;
              else {
                const v = quoted(c.rest);
                if (v === null) rep.err(c.n, 'P004');
                else d.rejected.push(v);
              }
              noLines(c, rep);
            }
          });
          model.decisions.push(d);
          break;
        }
        case 'type': case 'edge': case 'edgedef': case 'property': case 'evidence':
          break;
        default:
          rep.err(st.n, 'P002');
      }
    }
    if (!dur) rep.err(1, 'P020');
    if (version) model.versions.add(version);
  }
  rep.file = rec.name;
  if (!specSeen) rep.err(1, 'P021');
  if (model.versions.size > 1) rep.err(1, 'P047');
  return { diags: rep.diags, model };
}

export { validRelativePath };
