// Reading a file of a record into statements and clauses (REQ-SY-001 to REQ-SY-013).

import type { Diag, Example, FileModel, OpModel, RecordModel, ReqModel } from './model.ts';
import { hasOwn, isObject, isJsonNumber, parseJson, setOwn, splitWord } from './util.ts';
import type { Obj } from './util.ts';

export interface Line {
  n: number;
  indent: number;
  text: string;
  blank: boolean;
}

interface Clause {
  n: number;
  kw: string;
  rest: string;
  body: Line[];
}

interface Stmt {
  kind: string;
  n: number;
  rest: string;
  body: Line[];
}

export interface ReadCtx {
  files: Map<string, string>;
  recordFolder: string;
  diags: Diag[];
  rec: RecordModel;
  seen: { spec: number; oracle: number; errors: number };
}

const KNOWN = new Set([
  'duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note',
]);
const REST_OF_LANGUAGE = new Set(['type', 'edge', 'edgedef', 'property', 'evidence']);

type Handler = (c: Clause) => void;

export function readFile(file: string, text: string, ctx: ReadCtx): FileModel {
  const slash = file.lastIndexOf('/');
  const dirname = slash < 0 ? '' : file.slice(0, slash);
  const fm: FileModel = { file, dirname, duramenCount: 0, version: null };
  const d = (code: string, line: number): void => {
    ctx.diags.push({ file, line, level: 'error', code });
  };

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const raw = text.split(/\r\n|\r|\n/);
  const stmts: Stmt[] = [];
  let cur: Stmt | null = null;
  for (let i = 0; i < raw.length; i++) {
    const n = i + 1;
    const s = raw[i].trimEnd();
    if (s === '') {
      if (cur) cur.body.push({ n, indent: 0, text: '', blank: true });
      continue;
    }
    const lead = /^\s*/.exec(s)![0];
    if (/[^ ]/.test(lead)) {
      d('P001', n);
      continue;
    }
    const indent = lead.length;
    const content = s.slice(indent);
    if (indent === 0) {
      if (content[0] === '#') continue;
      const [kind, rest] = splitWord(content);
      cur = { kind, n, rest, body: [] };
      stmts.push(cur);
    } else if (!cur) {
      d('P003', n);
    } else {
      cur.body.push({ n, indent, text: content, blank: false });
    }
  }

  for (const st of stmts) readStatement(st, fm, ctx, d);
  return fm;
}

type D = (code: string, line: number) => void;

function scanClauses(st: Stmt, d: D): Clause[] {
  const out: Clause[] = [];
  let cur: Clause | null = null;
  for (const l of st.body) {
    if (l.blank) {
      if (cur) cur.body.push(l);
      continue;
    }
    if (l.indent === 1) {
      d('P007', l.n);
      continue;
    }
    if (l.indent === 2) {
      if (l.text[0] === '#') continue;
      const [kw, rest] = splitWord(l.text);
      cur = { n: l.n, kw, rest, body: [] };
      out.push(cur);
      continue;
    }
    if (!cur) {
      d('P006', l.n);
      continue;
    }
    cur.body.push(l);
  }
  return out;
}

function runClauses(clauses: Clause[], handlers: Map<string, Handler>, once: string[], d: D): void {
  const seen = new Set<string>();
  for (const c of clauses) {
    const h = handlers.get(c.kw);
    if (!h) {
      d('P015', c.n);
      continue;
    }
    if (once.includes(c.kw)) {
      if (seen.has(c.kw)) {
        d('P052', c.n);
        continue;
      }
      seen.add(c.kw);
    }
    h(c);
  }
}

// A clause that takes no lines of its own: anything under it but comments is P006.
function noBody(c: Clause, d: D): void {
  for (const l of c.body) if (!l.blank && l.text[0] !== '#') d('P006', l.n);
}

function readText(c: Clause, d: D): string {
  if (c.rest !== '') d('P008', c.n);
  const out: string[] = [];
  for (const l of c.body) {
    if (l.blank) out.push('');
    else if (l.indent < 4) d('P008', l.n);
    else out.push(' '.repeat(l.indent - 4) + l.text);
  }
  while (out.length > 0 && out[0] === '') out.shift();
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

function readQuoted(s: string): string | null {
  const p = parseJson(s);
  return p.ok && typeof p.value === 'string' ? p.value : null;
}

function readHeader(st: Stmt, d: D): string {
  const [id, title] = splitWord(st.rest);
  if (id === '' || title.length < 2 || title[0] !== '"' || title[title.length - 1] !== '"') {
    d('P005', st.n);
  } else if (readQuoted(title) === null) {
    d('P004', st.n);
  }
  return id;
}

// request <JSON object> (REQ-SY-004): P009 for JSON that is not an object, P051 for id, op, input.
function readRequest(rest: string, n: number, d: D): Obj | null {
  const p = parseJson(rest);
  if (!p.ok || p.big || !isObject(p.value)) {
    d('P009', n);
    return null;
  }
  if (hasOwn(p.value, 'id') || hasOwn(p.value, 'op') || hasOwn(p.value, 'input')) {
    d('P051', n);
    return null;
  }
  return p.value;
}

function readStatement(st: Stmt, fm: FileModel, ctx: ReadCtx, d: D): void {
  const rec = ctx.rec;
  const file = fm.file;
  if (!KNOWN.has(st.kind)) {
    if (!REST_OF_LANGUAGE.has(st.kind)) d('P002', st.n);
    return;
  }
  const clauses = scanClauses(st, d);
  const h = new Map<string, Handler>();

  switch (st.kind) {
    case 'duramen': {
      const valid = st.rest === '0.1' || st.rest === '0.2';
      if (fm.duramenCount === 0) {
        if (valid) fm.version = st.rest;
        else d('P023', st.n);
      } else {
        d('P023', st.n);
      }
      fm.duramenCount++;
      runClauses(clauses, h, [], d);
      break;
    }
    case 'spec': {
      const words = st.rest.split(/\s+/).filter((w) => w !== '');
      if (words.length !== 2) d('P021', st.n);
      const first = ctx.seen.spec++ === 0;
      if (!first) d('P044', st.n);
      let text: string | null = null;
      let request: Obj | null = null;
      h.set('title', (c) => {
        if (readQuoted(c.rest) === null) d('P004', c.n);
        noBody(c, d);
      });
      h.set('text', (c) => {
        text = readText(c, d);
      });
      h.set('contract', (c) => noBody(c, d));
      h.set('request', (c) => {
        request = readRequest(c.rest, c.n, d);
        noBody(c, d);
      });
      runClauses(clauses, h, ['title', 'contract', 'request', 'text'], d);
      if (first) rec.spec = { file, line: st.n, request, text };
      break;
    }
    case 'oracle': {
      if (st.rest === '') d('P028', st.n);
      const first = ctx.seen.oracle++ === 0;
      if (!first) d('P044', st.n);
      h.set('source', (c) => noBody(c, d));
      runClauses(clauses, h, [], d);
      if (first) rec.oracle = { file, line: st.n, command: st.rest };
      break;
    }
    case 'section': {
      readHeader(st, d);
      let text: string | null = null;
      h.set('text', (c) => {
        text = readText(c, d);
      });
      runClauses(clauses, h, ['text'], d);
      rec.sections.push({ file, line: st.n, text });
      break;
    }
    case 'note': {
      if (st.rest !== '') d('P050', st.n);
      let text: string | null = null;
      h.set('text', (c) => {
        text = readText(c, d);
      });
      runClauses(clauses, h, ['text'], d);
      rec.notes.push({ file, line: st.n, text });
      break;
    }
    case 'op':
      readOp(st, clauses, d, ctx, fm);
      break;
    case 'errors':
      readErrors(st, clauses, d, ctx, fm);
      break;
    case 'req':
      readReq(st, clauses, d, ctx, fm);
      break;
    case 'open': {
      const id = readHeader(st, d);
      let text: string | null = null;
      const tested: number[] = [];
      h.set('text', (c) => {
        text = readText(c, d);
      });
      h.set('example', (c) => tested.push(c.n));
      h.set('table', (c) => tested.push(c.n));
      runClauses(clauses, h, ['text'], d);
      rec.opens.push({ file, line: st.n, id, text, tested });
      break;
    }
    case 'decision': {
      const id = readHeader(st, d);
      const dec = { file, line: st.n, id, source: null as string | null, status: null as string | null, text: null as string | null, rejected: [] as string[] };
      h.set('source', (c) => {
        dec.source = c.rest;
        noBody(c, d);
      });
      h.set('status', (c) => {
        dec.status = c.rest;
        noBody(c, d);
      });
      h.set('text', (c) => {
        dec.text = readText(c, d);
      });
      h.set('rejected', (c) => {
        const alt = readQuoted(c.rest);
        if (alt === null) d('P004', c.n);
        else dec.rejected.push(alt);
        noBody(c, d);
      });
      runClauses(clauses, h, ['source', 'status', 'text'], d);
      rec.decisions.push(dec);
      break;
    }
  }
}

function splitFields(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && i + 1 < s.length) {
        cur += s[++i];
      } else if (ch === '"') {
        quote = false;
      }
      continue;
    }
    if (ch === '"') quote = true;
    else if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') {
      if (depth > 0) depth--;
    } else if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function readOp(st: Stmt, clauses: Clause[], d: D, ctx: ReadCtx, fm: FileModel): void {
  const words = st.rest.split(/\s+/).filter((w) => w !== '');
  const op: OpModel = {
    file: fm.file,
    line: st.n,
    name: words.length === 1 ? words[0] : null,
    fields: [],
    tolerances: new Map(),
    audit: false,
    request: null,
    result: null,
  };
  if (words.length !== 1) d('P031', st.n);
  const h = new Map<string, Handler>();
  const names = new Set<string>();
  h.set('input', (c) => {
    for (const raw of splitFields(c.rest)) {
      const f = raw.trim();
      const m = /^([A-Za-z0-9_-]+)(\?)?\s+(\S[\s\S]*)$/.exec(f);
      if (!m) {
        d('P017', c.n);
      } else if (names.has(m[1])) {
        d('P052', c.n);
      } else {
        names.add(m[1]);
        op.fields.push({ name: m[1], optional: m[2] === '?' });
      }
    }
    noBody(c, d);
  });
  h.set('result', (c) => {
    op.result = c.rest;
    noBody(c, d);
  });
  h.set('tolerance', (c) => {
    const [path, num] = splitWord(c.rest);
    const p = parseJson(num);
    if (path === '' || !p.ok || !isJsonNumber(p.value) || p.value < 0) d('P018', c.n);
    else if (op.tolerances.has(path)) d('P052', c.n);
    else op.tolerances.set(path, p.value);
    noBody(c, d);
  });
  h.set('audit', (c) => {
    if (c.rest !== '' && c.rest !== 'text') d('P050', c.n);
    else op.audit = true;
    noBody(c, d);
  });
  h.set('request', (c) => {
    op.request = readRequest(c.rest, c.n, d);
    noBody(c, d);
  });
  runClauses(clauses, h, ['result', 'audit', 'request'], d);
  ctx.rec.ops.push(op);
}

function readErrors(st: Stmt, clauses: Clause[], d: D, ctx: ReadCtx, fm: FileModel): void {
  if (st.rest !== '') d('P050', st.n);
  const first = ctx.seen.errors++ === 0;
  if (!first) d('P032', st.n);
  for (const c of clauses) {
    const m = /^when(?:\s+([\s\S]+))?$/.exec(c.rest);
    const lines: string[] = [];
    if (!m || !m[1]) d('P019', c.n);
    else lines.push(m[1]);
    for (const l of c.body) {
      if (l.blank) continue;
      if (l.indent < 4) d('P006', l.n);
      else lines.push(' '.repeat(l.indent - 4) + l.text);
    }
    if (first) {
      ctx.rec.errorsCodes.push(c.kw);
      ctx.rec.errorsClauses.push({ line: c.n, code: c.kw, lines });
      ctx.rec.errorsFile = fm.file;
    }
  }
}

function readReq(st: Stmt, clauses: Clause[], d: D, ctx: ReadCtx, fm: FileModel): void {
  const id = readHeader(st, d);
  const req: ReqModel = {
    file: fm.file,
    line: st.n,
    id,
    text: null,
    textLine: 0,
    decisions: [],
    platform: 'any',
    examples: [],
  };
  const h = new Map<string, Handler>();
  h.set('text', (c) => {
    req.text = readText(c, d);
    req.textLine = c.n;
  });
  h.set('decision', (c) => {
    for (const w of c.rest.split(/[,\s]+/)) if (w !== '') req.decisions.push(w);
    noBody(c, d);
  });
  h.set('on', (c) => {
    if (c.rest === 'any' || c.rest === 'posix' || c.rest === 'windows') req.platform = c.rest;
    else d('P033', c.n);
    noBody(c, d);
  });
  h.set('example', (c) => req.examples.push(readExample(c, d, ctx, fm)));
  h.set('table', (c) => req.examples.push(...readTable(c, d, fm)));
  runClauses(clauses, h, ['text', 'on'], d);
  ctx.rec.reqs.push(req);
}

// ---- examples ----

function newExample(file: string, line: number): Example {
  return {
    file,
    line,
    raw: false,
    rawLine: null,
    op: null,
    jsonText: null,
    input: null,
    inputLines: false,
    inputKeys: [],
    request: null,
    omit: [],
    expects: [],
  };
}

function parsePath(s: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      if (j >= s.length) return null;
      const lit = readQuoted(s.slice(i, j + 1));
      if (lit === null) return null;
      out.push(lit);
      i = j + 1;
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(s.slice(i));
      if (!m) return null;
      out.push(m[0]);
      i += m[0].length;
    }
    if (i === s.length) return out;
    if (s[i] !== '.') return null;
    i++;
  }
}

function resolveFrom(name: string, ctx: ReadCtx, dirname: string): string | null {
  const parts = dirname === '' ? [] : dirname.split('/');
  for (const p of name.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(p);
    }
  }
  const full = parts.join('/');
  if (ctx.recordFolder !== '' && !full.startsWith(ctx.recordFolder + '/')) return null;
  return ctx.files.has(full) ? full : null;
}

function readExpect(rest: string, n: number, ex: Example, d: D): void {
  const m = /^([^\s=≈~]*)([\s\S]*)$/.exec(rest)!;
  const path = m[1];
  const after = m[2].trim();
  if (path === '') {
    d('P011', n);
  } else if (after.startsWith('=')) {
    const v = after.slice(1).trim();
    if (v === '?') {
      ex.expects.push({ line: n, path, kind: 'oracle' });
    } else {
      const p = parseJson(v);
      if (!p.ok || p.big) d('P009', n);
      else ex.expects.push({ line: n, path, kind: 'eq', value: p.value });
    }
  } else if (after.startsWith('≈') || after.startsWith('~')) {
    const body = after.slice(1);
    const a = body.indexOf('±');
    const b = body.indexOf('+-');
    let idx = -1;
    let len = 0;
    if (a >= 0 && (b < 0 || a < b)) {
      idx = a;
      len = 1;
    } else if (b >= 0) {
      idx = b;
      len = 2;
    }
    if (idx < 0) {
      d('P010', n);
      return;
    }
    const v = parseJson(body.slice(0, idx).trim());
    const t = parseJson(body.slice(idx + len).trim());
    if (!v.ok || !isJsonNumber(v.value) || !t.ok || !isJsonNumber(t.value) || t.value < 0) {
      d('P010', n);
      return;
    }
    ex.expects.push({ line: n, path, kind: 'approx', value: v.value, tol: t.value });
  } else {
    d('P011', n);
  }
}

function readExample(c: Clause, d: D, ctx: ReadCtx, fm: FileModel): Example {
  const ex = newExample(fm.file, c.n);
  let base: Obj = {};
  let hasJson = false;
  const [word, after] = splitWord(c.rest);
  if (c.rest === '') {
    d('P012', c.n);
  } else if (word === 'raw') {
    ex.raw = true;
    if (after.startsWith('"')) {
      const s = readQuoted(after);
      if (s === null) d('P004', c.n);
      else if (/[\r\n]/.test(s)) d('P026', c.n);
      else ex.rawLine = s;
    } else if (after.length >= 2 && after[0] === "'" && after[after.length - 1] === "'") {
      ex.rawLine = after.slice(1, -1);
    } else {
      d('P004', c.n);
    }
  } else {
    ex.op = word;
    if (after !== '') {
      const p = parseJson(after);
      if (!p.ok || p.big) d('P009', c.n);
      else if (!isObject(p.value)) d('P012', c.n);
      else {
        ex.jsonText = after;
        base = p.value;
        hasJson = true;
      }
    }
  }

  let requestRead = false;
  const body = c.body;
  let i = 0;
  while (i < body.length) {
    const l = body[i];
    i++;
    if (l.blank || l.text[0] === '#') continue;
    if (l.indent !== 4) {
      d('P006', l.n);
      continue;
    }
    const [kw, rest] = splitWord(l.text);
    if (kw === 'expect') {
      readExpect(rest, l.n, ex, d);
    } else if (kw === 'request') {
      if (ex.raw) d('P022', l.n);
      else if (requestRead) d('P052', l.n);
      else {
        const r = readRequest(rest, l.n, d);
        if (r) {
          ex.request = r;
          requestRead = true;
        }
      }
    } else if (kw === 'omit') {
      if (ex.raw) {
        d('P022', l.n);
      } else {
        const names = rest.split(/[,\s]+/).filter((w) => w !== '');
        if (names.length === 0) d('P011', l.n);
        else ex.omit.push(...names);
      }
    } else if (kw === 'input') {
      const fromForm = /^([\s\S]*?)\s+from\s+("[\s\S]*")$/.exec(rest);
      const fromName = fromForm ? readQuoted(fromForm[2]) : null;
      let text: string[] | null = null;
      if (fromName === null) {
        text = [];
        while (i < body.length && (body[i].blank || body[i].indent >= 6)) {
          text.push(body[i].blank ? '' : ' '.repeat(body[i].indent - 6) + body[i].text);
          i++;
        }
        while (text.length > 0 && text[text.length - 1] === '') text.pop();
      }
      if (ex.raw) {
        d('P022', l.n);
        continue;
      }
      const path = parsePath(fromForm && fromName !== null ? fromForm[1] : rest);
      if (path === null) {
        d('P049', l.n);
        continue;
      }
      let value: string;
      if (fromName !== null) {
        const full = resolveFrom(fromName, ctx, fm.dirname);
        if (full === null) {
          d('P048', l.n);
          continue;
        }
        value = ctx.files.get(full)!;
      } else {
        value = '';
      }
      // Walk the existing members first, so that a failure changes nothing.
      let cur: Obj = base;
      let ok = true;
      for (let k = 0; k < path.length - 1; k++) {
        if (!hasOwn(cur, path[k])) break;
        const nx = cur[path[k]];
        if (!isObject(nx)) {
          ok = false;
          break;
        }
        cur = nx;
      }
      if (!ok) {
        d('P049', l.n);
        continue;
      }
      if (fromName === null) {
        if (text!.length === 0) {
          d('P049', l.n);
          continue;
        }
        value = text!.map((t) => t + '\n').join('');
      }
      cur = base;
      for (let k = 0; k < path.length - 1; k++) {
        if (!hasOwn(cur, path[k])) setOwn(cur, path[k], {});
        cur = cur[path[k]] as Obj;
      }
      setOwn(cur, path[path.length - 1], value);
      ex.inputLines = true;
      ex.input = base;
    } else {
      d('P011', l.n);
    }
  }
  if (ex.inputLines) {
    ex.input = base;
    ex.inputKeys = Object.keys(base);
  } else if (hasJson) {
    ex.inputKeys = Object.keys(base);
  }
  return ex;
}

// ---- tables ----

interface Col {
  name: string;
  expect: boolean;
  tol: number | null;
}

function splitCells(text: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let ended = true;
  for (let i = 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '|') {
      cur += '|';
      i++;
      ended = false;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
      ended = true;
    } else {
      cur += ch;
      ended = false;
    }
  }
  if (!ended) cells.push(cur.trim());
  return cells;
}

function readTable(c: Clause, d: D, fm: FileModel): Example[] {
  const rows: { n: number; text: string }[] = [];
  for (const l of c.body) {
    if (l.blank || l.text[0] === '#') continue;
    if (l.indent >= 4 && l.text[0] === '|') {
      const t = l.text;
      if (t.endsWith('|') && /^[|:\-\s]*$/.test(t)) continue;
      rows.push({ n: l.n, text: t });
    } else {
      d('P006', l.n);
    }
  }
  const ops = c.rest.split(/\s+/).filter((w) => w !== '');
  if (ops.length !== 1 || rows.length < 2) {
    d('P013', c.n);
    return [];
  }
  const op = ops[0];
  const header = rows[0];
  const cols: Col[] = [];
  const names = new Set<string>();
  for (const cell of splitCells(header.text)) {
    const idx = cell.search(/\s|±|\+-/);
    const name = idx < 0 ? cell : cell.slice(0, idx);
    const tail = idx < 0 ? '' : cell.slice(idx).trim();
    let tolText: string | null = null;
    let form = name !== '';
    if (tail.startsWith('±')) tolText = tail.slice(1).trim();
    else if (tail.startsWith('+-')) tolText = tail.slice(2).trim();
    else if (tail !== '') form = false;
    const expect = /^(result|audit|error|id)(\..*)?$/s.test(name);
    if (!expect && !/^[A-Za-z0-9_-]+$/.test(name)) form = false;
    if (!form || names.has(name)) {
      d('P013', header.n);
      break;
    }
    names.add(name);
    let tol: number | null = null;
    if (tolText !== null) {
      const p = parseJson(tolText);
      if (!expect || !p.ok || !isJsonNumber(p.value) || p.value < 0) d('P010', header.n);
      else tol = p.value;
    }
    cols.push({ name, expect, tol });
  }
  if (cols.length !== splitCells(header.text).length) return [];

  const out: Example[] = [];
  for (const row of rows.slice(1)) {
    const cells = splitCells(row.text);
    if (cells.length !== cols.length) {
      d('P014', row.n);
      continue;
    }
    const ex = newExample(fm.file, row.n);
    ex.op = op;
    const parts: string[] = [];
    cols.forEach((col, i) => {
      const cell = cells[i];
      if (cell === '') return;
      if (!col.expect) {
        const p = parseJson(cell);
        if (!p.ok || p.big) d('P009', row.n);
        else {
          parts.push(`"${col.name}":${cell}`);
          ex.inputKeys.push(col.name);
        }
      } else if (cell === '?') {
        ex.expects.push({ line: row.n, path: col.name, kind: 'oracle' });
      } else if (col.tol !== null) {
        const p = parseJson(cell);
        if (!p.ok || !isJsonNumber(p.value)) d('P010', row.n);
        else ex.expects.push({ line: row.n, path: col.name, kind: 'approx', value: p.value, tol: col.tol });
      } else {
        const p = parseJson(cell);
        if (!p.ok || p.big) d('P009', row.n);
        else ex.expects.push({ line: row.n, path: col.name, kind: 'eq', value: p.value });
      }
    });
    ex.jsonText = '{' + parts.join(',') + '}';
    out.push(ex);
  }
  return out;
}
