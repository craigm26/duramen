// Reading a record: files -> model + P diagnostics.

export type Level = 'error' | 'warning' | 'info';
export interface Diag { file: string; line: number; level: Level; code: string }

export interface Expect {
  line: number;
  path: string;
  kind: 'eq' | 'approx' | 'oracle';
  value?: unknown;
  tol?: number;
}
export interface Example {
  kind: 'example' | 'raw' | 'row';
  line: number;
  op: string;
  rawLine?: string;
  inputText?: string;
  request?: Record<string, unknown>;
  omit: string[];
  expects: Expect[];
}
export interface TextVal { line: number; lines: string[] }
export interface ReqS {
  id: string; file: string; line: number; platform: string;
  text?: TextVal; decisions: string[]; items: Example[];
}
export interface DecS {
  id: string; file: string; line: number; source?: string; status?: string;
}
export interface OpS {
  name: string; file: string; line: number;
  fields: { name: string; optional: boolean }[];
  audit: boolean; tolerances: Record<string, number>;
  request?: Record<string, unknown>;
}
export interface OpenS { id: string; file: string; line: number; itemLines: number[] }
export interface Obl { file: string; line: number; lines: string[]; level: 'error' | 'warning' }
export interface SpecS { file: string; line: number; request?: Record<string, unknown> }
export interface OracleS { file: string; line: number; command: string }
export interface ErrCode { code: string; line: number }
export interface ErrListS { file: string; line: number; codes: ErrCode[] }

export interface Model {
  specs: SpecS[];
  oracles: OracleS[];
  errorLists: ErrListS[];
  ops: OpS[];
  reqs: ReqS[];
  decs: DecS[];
  opens: OpenS[];
  obls: Obl[];
}

interface BLine { n: number; indent: number; content: string; blank: boolean }
interface Clause { kw: string; rest: string; line: number; lines: BLine[] }

const NUM = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const NUMSRC = '-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';
const APPROX = new RegExp(`^(${NUMSRC})\\s*(?:±|\\+-)\\s*(${NUMSRC})$`);

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
export const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export function setOwn(o: Record<string, unknown>, k: string, v: unknown) {
  Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
}

const CORE = new Set(['duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note']);
const LATER = new Set(['type', 'edge', 'edgedef', 'property', 'evidence']);
const ALLOWED: Record<string, string[]> = {
  duramen: [],
  spec: ['title', 'text', 'contract', 'request'],
  oracle: ['source'],
  section: ['text'],
  op: ['input', 'result', 'tolerance', 'audit', 'request'],
  req: ['text', 'decision', 'on', 'example', 'table'],
  open: ['text', 'example', 'table'],
  decision: ['source', 'status', 'text', 'rejected'],
  note: ['text'],
};
const ONCE: Record<string, string[]> = {
  spec: ['title', 'contract', 'request', 'text'],
  op: ['result', 'audit', 'request'],
  req: ['text', 'on'],
  decision: ['source', 'status', 'text'],
  section: ['text'], open: ['text'], note: ['text'],
};

export interface ReadResult {
  model: Model;
  diags: Diag[];
  versions: (string | null)[]; // per file: first valid version
}

export function readRecord(
  files: Record<string, string>,
  names: string[],
  recordFolder: string,
  recordName: string,
): ReadResult {
  const diags: Diag[] = [];
  const model: Model = { specs: [], oracles: [], errorLists: [], ops: [], reqs: [], decs: [], opens: [], obls: [] };
  const versions: (string | null)[] = [];

  for (const file of names) {
    const add = (line: number, code: string, level: Level = 'error') => { diags.push({ file, line, level, code }); };
    const lines = splitLines(files[file], add);
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    let sawDuramen = false;
    let fileVersion: string | null = null;

    // group lines into statements
    type Stmt = { kw: string; rest: string; line: number; body: BLine[] };
    const stmts: Stmt[] = [];
    let cur: Stmt | null = null;
    for (const L of lines) {
      if (L.blank) { if (cur) cur.body.push(L); continue; }
      if (L.indent === 0) {
        if (L.content.startsWith('#')) continue;
        const m = L.content.match(/^(\S+)\s*([\s\S]*)$/)!;
        cur = { kw: m[1], rest: m[2], line: L.n, body: [] };
        stmts.push(cur);
        continue;
      }
      if (!cur) { add(L.n, 'P003'); continue; }
      cur.body.push(L);
    }

    const ctx = { file, dir, add, files, recordFolder, model };
    for (const s of stmts) {
      if (!CORE.has(s.kw)) {
        if (!LATER.has(s.kw)) add(s.line, 'P002');
        continue;
      }
      readStatement(ctx, s);
      if (s.kw === 'duramen') {
        if (!sawDuramen) {
          sawDuramen = true;
          const w = s.rest.split(/\s+/).filter(Boolean);
          if (w.length === 1 && (w[0] === '0.1' || w[0] === '0.2')) fileVersion = w[0];
          else add(s.line, 'P023');
        } else add(s.line, 'P023');
      }
    }
    if (!sawDuramen) add(1, 'P020');
    versions.push(fileVersion);
  }

  const distinct = new Set(versions.filter((v) => v !== null));
  if (distinct.size > 1) diags.push({ file: recordName, line: 1, level: 'error', code: 'P047' });
  if (model.specs.length === 0) diags.push({ file: recordName, line: 1, level: 'error', code: 'P021' });
  model.specs.slice(1).forEach((s) => diags.push({ file: s.file, line: s.line, level: 'error', code: 'P044' }));
  model.oracles.slice(1).forEach((s) => diags.push({ file: s.file, line: s.line, level: 'error', code: 'P044' }));
  model.errorLists.slice(1).forEach((s) => diags.push({ file: s.file, line: s.line, level: 'error', code: 'P032' }));
  return { model, diags, versions };
}

function splitLines(text: string, add: (line: number, code: string) => void): BLine[] {
  const raw = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const out: BLine[] = [];
  raw.forEach((r, i) => {
    const t = r.replace(/\s+$/, '');
    if (t === '') { out.push({ n: i + 1, indent: 0, content: '', blank: true }); return; }
    let indent = 0;
    while (t[indent] === ' ') indent++;
    const content = t.slice(indent);
    if (/^\s/.test(content)) { add(i + 1, 'P001'); return; }
    out.push({ n: i + 1, indent, content, blank: false });
  });
  return out;
}

interface Ctx {
  file: string; dir: string; add: (line: number, code: string, level?: Level) => void;
  files: Record<string, string>; recordFolder: string; model: Model;
}

function readStatement(ctx: Ctx, s: { kw: string; rest: string; line: number; body: BLine[] }) {
  const { add, model, file } = ctx;
  const kw = s.kw;
  const idTitle = (): string | undefined => {
    const m = s.rest.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    if (!m) { add(s.line, 'P005'); return undefined; }
    const t = m[2] ?? '';
    if (t.length < 2 || !t.startsWith('"') || !t.endsWith('"')) add(s.line, 'P005');
    else if (!isJsonString(t)) add(s.line, 'P004');
    return m[1];
  };

  // statement line
  let req: ReqS | undefined, dec: DecS | undefined, op: OpS | undefined, open: OpenS | undefined;
  let errList: ErrListS | undefined, spec: SpecS | undefined, oracle: OracleS | undefined;
  let textTarget: ((t: TextVal) => void) | undefined;
  let nonObl = false;
  switch (kw) {
    case 'duramen': break;
    case 'spec': {
      if (s.rest.split(/\s+/).filter(Boolean).length !== 2) add(s.line, 'P021');
      spec = { file, line: s.line };
      model.specs.push(spec);
      textTarget = (t) => model.obls.push({ file, line: s.line, lines: t.lines, level: 'error' });
      break;
    }
    case 'oracle': {
      if (s.rest === '') add(s.line, 'P028');
      oracle = { file, line: s.line, command: s.rest };
      model.oracles.push(oracle);
      break;
    }
    case 'section': {
      idTitle();
      textTarget = (t) => model.obls.push({ file, line: s.line, lines: t.lines, level: 'error' });
      break;
    }
    case 'note': {
      if (s.rest !== '') add(s.line, 'P050');
      textTarget = (t) => model.obls.push({ file, line: s.line, lines: t.lines, level: 'error' });
      break;
    }
    case 'op': {
      const w = s.rest.split(/\s+/).filter(Boolean);
      if (w.length !== 1) add(s.line, 'P031');
      op = { name: w.length === 1 ? w[0] : '', file, line: s.line, fields: [], audit: false, tolerances: {} };
      model.ops.push(op);
      break;
    }
    case 'errors': {
      if (s.rest !== '') add(s.line, 'P050');
      errList = { file, line: s.line, codes: [] };
      model.errorLists.push(errList);
      break;
    }
    case 'req': {
      const id = idTitle();
      req = { id: id ?? '', file, line: s.line, platform: 'any', decisions: [], items: [] };
      model.reqs.push(req);
      break;
    }
    case 'open': {
      const id = idTitle();
      open = { id: id ?? '', file, line: s.line, itemLines: [] };
      model.opens.push(open);
      textTarget = (t) => model.obls.push({ file, line: s.line, lines: t.lines, level: 'warning' });
      break;
    }
    case 'decision': {
      const id = idTitle();
      dec = { id: id ?? '', file, line: s.line };
      model.decs.push(dec);
      textTarget = (t) => model.obls.push({ file, line: s.line, lines: t.lines, level: 'error' });
      break;
    }
  }
  void nonObl;

  // collect clauses
  const clauses: Clause[] = [];
  let curC: Clause | null = null;
  for (const L of s.body) {
    if (L.blank) { if (curC) curC.lines.push(L); continue; }
    if (L.indent === 1) { add(L.n, 'P007'); continue; }
    if (L.indent === 2) {
      if (L.content.startsWith('#')) continue;
      const m = L.content.match(/^(\S+)\s*([\s\S]*)$/)!;
      curC = { kw: m[1], rest: m[2], line: L.n, lines: [] };
      clauses.push(curC);
      continue;
    }
    if (!curC) { add(L.n, 'P006'); continue; }
    curC.lines.push(L);
  }

  const seen = new Set<string>();
  const allowed = ALLOWED[kw];
  const once = ONCE[kw] ?? [];
  const noLines = (c: Clause) => {
    for (const L of c.lines) if (!L.blank && !L.content.startsWith('#')) add(L.n, 'P006');
  };
  const reqObj = (c: Clause): Record<string, unknown> | undefined => {
    const r = parseRequest(c.rest);
    if (r === 'P009' || r === 'P051') { add(c.line, r); return undefined; }
    return r;
  };

  for (const c of clauses) {
    if (kw === 'errors') { readErrorClause(ctx, errList!, c); continue; }
    if (!allowed.includes(c.kw)) { add(c.line, 'P015'); continue; }
    if (once.includes(c.kw) && seen.has(c.kw) && c.kw !== 'tolerance') { add(c.line, 'P052'); continue; }
    seen.add(c.kw);

    if (c.kw === 'text') {
      const t = readText(ctx, c);
      if (textTarget) textTarget(t);
      if (req) req.text = t;
      continue;
    }
    if ((c.kw === 'example' || c.kw === 'table') && open) { open.itemLines.push(c.line); continue; }
    if (c.kw === 'example') { readExample(ctx, req!, c); continue; }
    if (c.kw === 'table') { readTable(ctx, req!, c); continue; }

    noLines(c);
    switch (kw + ' ' + c.kw) {
      case 'spec title':
        if (!isJsonString(c.rest)) add(c.line, 'P004');
        break;
      case 'spec request': spec!.request = reqObj(c); break;
      case 'op request': op!.request = reqObj(c); break;
      case 'req decision':
        for (const d of c.rest.split(/[,\s]+/)) if (d !== '') req!.decisions.push(d);
        break;
      case 'req on':
        if (c.rest === 'any' || c.rest === 'posix' || c.rest === 'windows') req!.platform = c.rest;
        else add(c.line, 'P033');
        break;
      case 'decision source': dec!.source = c.rest; break;
      case 'decision status': dec!.status = c.rest; break;
      case 'decision rejected':
        if (!isJsonString(c.rest)) add(c.line, 'P004');
        else model.obls.push({ file, line: s.line, lines: [JSON.parse(c.rest)], level: 'error' });
        break;
      case 'op result':
        model.obls.push({ file, line: s.line, lines: [c.rest], level: 'error' });
        break;
      case 'op audit':
        if (c.rest === '' || c.rest === 'text') op!.audit = true;
        else add(c.line, 'P050');
        break;
      case 'op tolerance': {
        const w = c.rest.split(/\s+/).filter(Boolean);
        if (w.length >= 1 && hasOwn(op!.tolerances, w[0])) add(c.line, 'P052');
        else if (w.length === 2 && NUM.test(w[1]) && Number(w[1]) >= 0) setOwn(op!.tolerances, w[0], Number(w[1]));
        else add(c.line, 'P018');
        break;
      }
      case 'op input':
        for (const part of splitFields(c.rest)) {
          const f = part.trim();
          const m = f.match(/^([A-Za-z0-9_-]+)(\?)?\s+(\S[\s\S]*)$/);
          if (!m) { add(c.line, 'P017'); continue; }
          if (op!.fields.some((x) => x.name === m[1])) { add(c.line, 'P052'); continue; }
          op!.fields.push({ name: m[1], optional: m[2] === '?' });
        }
        break;
    }
  }
}

function isJsonString(t: string): boolean {
  try { return typeof JSON.parse(t) === 'string'; } catch { return false; }
}

function parseRequest(rest: string): Record<string, unknown> | 'P009' | 'P051' {
  let v: unknown;
  try { v = JSON.parse(rest); } catch { return 'P009'; }
  if (!isObj(v)) return 'P009';
  if (hasOwn(v, 'id') || hasOwn(v, 'op') || hasOwn(v, 'input')) return 'P051';
  return v;
}

function splitFields(rest: string): string[] {
  const parts: string[] = [];
  let cur = '', depth = 0, inq = false;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (inq) {
      cur += ch;
      if (ch === '\\' && i + 1 < rest.length) { cur += rest[++i]; } else if (ch === '"') inq = false;
    } else if (ch === '"') { inq = true; cur += ch; }
    else if (ch === '[' || ch === '{' || ch === '(') { depth++; cur += ch; }
    else if (ch === ']' || ch === '}' || ch === ')') { depth = Math.max(0, depth - 1); cur += ch; }
    else if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  parts.push(cur);
  return parts;
}

function readText(ctx: Ctx, c: Clause): TextVal {
  if (c.rest !== '') ctx.add(c.line, 'P008');
  const out: string[] = [];
  for (const L of c.lines) {
    if (L.blank) { out.push(''); continue; }
    if (L.indent === 3) { ctx.add(L.n, 'P008'); continue; }
    out.push(' '.repeat(L.indent - 4) + L.content);
  }
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  return { line: c.line, lines: out };
}

function readErrorClause(ctx: Ctx, list: ErrListS, c: Clause) {
  const m = c.rest.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  let ok = false;
  const code = c.kw;
  const w = [c.kw, ...c.rest.split(/\s+/).filter(Boolean)];
  if (w.length >= 3 && w[1] === 'when') ok = true;
  void m;
  if (!ok) ctx.add(c.line, 'P019'); else list.codes.push({ code, line: c.line });
  const cond: string[] = [];
  if (ok) cond.push(c.rest.replace(/^when\s*/, ''));
  for (const L of c.lines) {
    if (L.blank) continue;
    if (L.indent === 3) { ctx.add(L.n, 'P006'); continue; }
    cond.push(L.content);
  }
  if (ok) ctx.model.obls.push({ file: ctx.file, line: c.line, lines: cond, level: 'error' });
}

// ---- examples ----

function parsePath(s: string): string[] | null {
  const names: string[] = [];
  let i = 0;
  for (;;) {
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      if (j >= s.length) return null;
      let v: unknown;
      try { v = JSON.parse(s.slice(i, j + 1)); } catch { return null; }
      if (typeof v !== 'string') return null;
      names.push(v);
      i = j + 1;
    } else {
      const m = s.slice(i).match(/^[A-Za-z0-9_-]+/);
      if (!m) return null;
      names.push(m[0]);
      i += m[0].length;
    }
    if (i === s.length) return names;
    if (s[i] !== '.') return null;
    i++;
  }
}

function resolveFrom(ctx: Ctx, rel: string): string | null {
  const parts = (ctx.dir === '' ? [] : ctx.dir.split('/'));
  for (const p of rel.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') { if (parts.length === 0) return null; parts.pop(); } else parts.push(p);
  }
  const full = parts.join('/');
  const rf = ctx.recordFolder;
  if (rf !== '' && !(full === rf || full.startsWith(rf + '/'))) return null;
  return full;
}

function readExample(ctx: Ctx, req: ReqS, c: Clause) {
  const { add } = ctx;
  let dropped = false;
  let raw = false;
  let op = '';
  let rawLine: string | undefined;
  let inputText: string | undefined;
  let obj: Record<string, unknown> | undefined;
  if (c.rest === '') { add(c.line, 'P012'); dropped = true; }
  else {
    const m = c.rest.match(/^(\S+)\s*([\s\S]*)$/)!;
    if (m[1] === 'raw') {
      raw = true; op = 'raw';
      const arg = m[2];
      if (arg[0] === '"') {
        let v: unknown;
        try { v = JSON.parse(arg); } catch { v = undefined; }
        if (typeof v !== 'string') { add(c.line, 'P004'); dropped = true; }
        else if (/[\r\n]/.test(v)) { add(c.line, 'P026'); dropped = true; }
        else rawLine = v;
      } else if (arg[0] === "'" && arg.length >= 2 && arg.endsWith("'")) {
        rawLine = arg.slice(1, -1);
        if (/[\r\n]/.test(rawLine)) { add(c.line, 'P026'); dropped = true; }
      } else { add(c.line, 'P004'); dropped = true; }
    } else {
      op = m[1];
      if (m[2] !== '') {
        let v: unknown, bad = false;
        try { v = JSON.parse(m[2]); } catch { bad = true; }
        if (bad) { add(c.line, 'P009'); dropped = true; }
        else if (!isObj(v)) { add(c.line, 'P012'); dropped = true; }
        else { obj = v; inputText = m[2]; }
      }
    }
  }

  const ex: Example = { kind: raw ? 'raw' : 'example', line: c.line, op, rawLine, omit: [], expects: [] };
  let scratch: Record<string, unknown> = {};
  let touched = false;
  let reqRead = false;
  const L = c.lines;
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    if (l.blank || l.content.startsWith('#')) continue;
    if (l.indent !== 4) { add(l.n, 'P006'); continue; }
    const m = l.content.match(/^(\S+)\s*([\s\S]*)$/)!;
    const kw = m[1], rest = m[2];
    if (kw === 'expect') { readExpect(ctx, ex, l.n, rest); continue; }
    if (kw === 'omit') {
      if (raw) { add(l.n, 'P022'); continue; }
      const names = rest.split(/[,\s]+/).filter(Boolean);
      if (names.length === 0) add(l.n, 'P011'); else ex.omit.push(...names);
      continue;
    }
    if (kw === 'request') {
      if (raw) { add(l.n, 'P022'); continue; }
      if (reqRead) { add(l.n, 'P052'); continue; }
      const r = parseRequest(rest);
      if (r === 'P009' || r === 'P051') add(l.n, r); else { ex.request = r; reqRead = true; }
      continue;
    }
    if (kw === 'input') {
      // from-form?
      let fromFile: string | null = null, pathText = rest;
      const re = /\s+from\s+(?=")/g;
      let mm: RegExpExecArray | null;
      while ((mm = re.exec(rest))) {
        const q = rest.slice(mm.index + mm[0].length);
        if (isJsonString(q) && mm.index > 0) { fromFile = JSON.parse(q); pathText = rest.slice(0, mm.index); break; }
      }
      let text: string | null = null;
      if (fromFile === null) {
        let j = i + 1;
        const tl: string[] = [];
        while (j < L.length && (L[j].blank || L[j].indent >= 6)) {
          tl.push(L[j].blank ? '' : ' '.repeat(L[j].indent - 6) + L[j].content);
          j++;
        }
        i = j - 1;
        while (tl.length && tl[tl.length - 1] === '') tl.pop();
        if (tl.length) text = tl.map((x) => x + '\n').join('');
      }
      if (raw) { add(l.n, 'P022'); continue; }
      const names = parsePath(pathText);
      if (names === null) { add(l.n, 'P049'); continue; }
      let value: string;
      if (fromFile !== null) {
        const full = resolveFrom(ctx, fromFile);
        if (full === null || !hasOwn(ctx.files, full)) { add(l.n, 'P048'); continue; }
        value = ctx.files[full];
      } else {
        if (text === null) { add(l.n, 'P049'); continue; }
        value = text;
      }
      if (!obj && !dropped) { obj = {}; }
      const root = obj ?? scratch;
      let curO = root, fail = false;
      for (const nm of names.slice(0, -1)) {
        if (hasOwn(curO, nm)) {
          const v = curO[nm];
          if (!isObj(v)) { fail = true; break; }
          curO = v;
        } else { const n2 = {}; setOwn(curO, nm, n2); curO = n2; }
      }
      if (fail) { add(l.n, 'P049'); continue; }
      setOwn(curO, names[names.length - 1], value);
      touched = true;
      continue;
    }
    add(l.n, 'P011');
  }
  void scratch; scratch = {};
  if (dropped) return;
  if (touched && obj) inputText = JSON.stringify(obj);
  ex.inputText = inputText;
  req.items.push(ex);
}

function readExpect(ctx: Ctx, ex: Example, line: number, rest: string) {
  const { add } = ctx;
  const pm = rest.match(/^[^\s=≈~]+/);
  if (!pm) { add(line, 'P011'); return; }
  const path = pm[0];
  const s2 = rest.slice(path.length).replace(/^\s+/, '');
  if (s2 === '') { add(line, 'P011'); return; }
  const op = s2[0];
  const arg = s2.slice(1).trim();
  if (op === '=') {
    if (arg === '?') { ex.expects.push({ line, path, kind: 'oracle' }); return; }
    let v: unknown;
    try { v = JSON.parse(arg); } catch { add(line, 'P009'); return; }
    ex.expects.push({ line, path, kind: 'eq', value: v });
  } else if (op === '≈' || op === '~') {
    const m = arg.match(APPROX);
    if (!m || Number(m[2]) < 0) { add(line, 'P010'); return; }
    ex.expects.push({ line, path, kind: 'approx', value: Number(m[1]), tol: Number(m[2]) });
  } else add(line, 'P011');
}

// ---- tables ----

function splitCells(content: string): string[] {
  const s = content.slice(1);
  const out: string[] = [];
  let cur = '', lastSep = false;
  for (let i = 0; i < s.length; i++) {
    lastSep = false;
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; }
    else if (s[i] === '|') { out.push(cur); cur = ''; lastSep = true; }
    else cur += s[i];
  }
  if (!lastSep) out.push(cur);
  return out.map((x) => x.trim());
}

interface Col { name: string; input: boolean; tol?: number }

function readTable(ctx: Ctx, req: ReqS, c: Clause) {
  const { add } = ctx;
  const rows: { line: number; content: string }[] = [];
  for (const L of c.lines) {
    if (L.blank || L.content.startsWith('#')) continue;
    if (L.indent >= 4 && L.content.startsWith('|')) rows.push({ line: L.n, content: L.content });
    else add(L.n, 'P006');
  }
  const data = rows.filter((r) => !(r.content.endsWith('|') && /^\|[|\-: ]*$/.test(r.content)));
  const opw = c.rest.split(/\s+/).filter(Boolean);
  if (opw.length !== 1 || data.length < 2) { add(c.line, 'P013'); return; }
  const op = opw[0];
  const hdr = data[0];
  const hcells = splitCells(hdr.content);
  const cols: Col[] = [];
  const parsed = hcells.map((cell) => {
    const i1 = cell.indexOf('±'), i2 = cell.indexOf('+-');
    let idx = -1, len = 0;
    if (i1 >= 0 && (i2 < 0 || i1 < i2)) { idx = i1; len = 1; } else if (i2 >= 0) { idx = i2; len = 2; }
    const name = (idx >= 0 ? cell.slice(0, idx) : cell).trim();
    const tolText = idx >= 0 ? cell.slice(idx + len).trim() : undefined;
    return { name, tolText };
  });
  for (const p of parsed) {
    if (!/^(?:result|audit|error|id)(?:\..*)?$/.test(p.name) && !/^[A-Za-z0-9_-]+$/.test(p.name)) { add(hdr.line, 'P013'); return; }
  }
  for (const p of parsed) {
    const isExp = /^(?:result|audit|error|id)(?:\..*)?$/.test(p.name);
    const col: Col = { name: p.name, input: !isExp };
    if (p.tolText !== undefined) {
      if (isExp && NUM.test(p.tolText) && Number(p.tolText) >= 0) col.tol = Number(p.tolText);
      else add(hdr.line, 'P010');
    }
    cols.push(col);
  }
  for (const r of data.slice(1)) {
    const cells = splitCells(r.content);
    if (cells.length !== cols.length) { add(r.line, 'P014'); continue; }
    const parts: string[] = [];
    const expects: Expect[] = [];
    let bad = false;
    cols.forEach((col, i) => {
      const cell = cells[i];
      if (cell === '') return;
      if (col.input) {
        try { JSON.parse(cell); } catch { add(r.line, 'P009'); bad = true; return; }
        parts.push(`${JSON.stringify(col.name)}:${cell}`);
      } else if (cell === '?') {
        expects.push({ line: r.line, path: col.name, kind: 'oracle' });
      } else if (col.tol !== undefined) {
        if (!NUM.test(cell)) { add(r.line, 'P010'); bad = true; return; }
        expects.push({ line: r.line, path: col.name, kind: 'approx', value: Number(cell), tol: col.tol });
      } else {
        let v: unknown;
        try { v = JSON.parse(cell); } catch { add(r.line, 'P009'); bad = true; return; }
        expects.push({ line: r.line, path: col.name, kind: 'eq', value: v });
      }
    });
    if (bad) continue;
    req.items.push({ kind: 'row', line: r.line, op, inputText: `{${parts.join(',')}}`, omit: [], expects });
  }
}
