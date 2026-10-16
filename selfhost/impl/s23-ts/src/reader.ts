// Reading a record's files: lines, statements, clauses (REQ-SY-*) into a model.

import { getOwn, hasOwn, isObj, parseJson, setOwn } from './json.ts';

export type Level = 'error' | 'warning' | 'info';
export interface Diag {
  file: string;
  line: number;
  level: Level;
  code: string;
}

export class Sink {
  list: Diag[] = [];
  add(file: string, line: number, code: string, level: Level = 'error'): void {
    this.list.push({ file, line, level, code });
  }
}

export interface Expect {
  line: number;
  path: string;
  kind: 'eq' | 'approx' | 'oracle';
  value?: unknown;
  tol?: number;
}

export interface Item {
  file: string;
  line: number;
  dir: string;
  op: string | null;
  raw: boolean;
  rawLine: string | null;
  inputText: string | null;
  inputObj: Record<string, unknown> | null;
  request: Record<string, unknown> | null;
  omit: Set<string>;
  expects: Expect[];
  dropped: boolean;
}

export interface OpModel {
  file: string;
  line: number;
  name: string;
  fields: Map<string, boolean>; // name -> optional
  tolerances: Record<string, number>;
  audit: boolean;
  request: Record<string, unknown> | null;
  result: string | null;
}

export interface ReqModel {
  file: string;
  line: number;
  id: string;
  platform: string;
  decisions: string[];
  text: { line: number; text: string } | null;
  items: Item[];
}

export interface DecisionModel {
  file: string;
  line: number;
  id: string;
  source: string | null;
  status: string | null;
}

export interface Oblig {
  file: string;
  line: number;
  code: 'T004' | 'T014';
  texts: string[];
}

export interface Model {
  spec: { file: string; line: number; request: Record<string, unknown> | null } | null;
  oracle: { file: string; line: number; cmd: string; dir: string } | null;
  errorsSeen: boolean;
  codes: string[];
  ops: OpModel[];
  reqs: ReqModel[];
  opens: { file: string; line: number; id: string }[];
  openClauses: { file: string; line: number }[];
  decisions: DecisionModel[];
  oblig: Oblig[];
  versions: Set<string>;
}

export function newModel(): Model {
  return {
    spec: null,
    oracle: null,
    errorsSeen: false,
    codes: [],
    ops: [],
    reqs: [],
    opens: [],
    openClauses: [],
    decisions: [],
    oblig: [],
    versions: new Set(),
  };
}

interface Child {
  blank: boolean;
  line: number;
  indent: number;
  content: string;
}
interface Clause {
  kw: string;
  rest: string;
  line: number;
  children: Child[];
}
interface Statement {
  kw: string;
  rest: string;
  line: number;
  known: boolean;
  clauses: Clause[];
}

const CORE = new Set(['duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note']);
const REST_OF_LANGUAGE = new Set(['type', 'edge', 'edgedef', 'property', 'evidence']);

function firstWord(s: string): string {
  const m = /^\S+/.exec(s);
  return m ? m[0] : '';
}

function splitKw(content: string): { kw: string; rest: string } {
  const kw = firstWord(content);
  return { kw, rest: content.slice(kw.length).trimStart() };
}

function lex(file: string, text: string, sink: Sink): Statement[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = text.split(/\r\n|\n|\r/);
  const stmts: Statement[] = [];
  let cur: Statement | null = null;
  let clause: Clause | null = null;
  for (let i = 0; i < rows.length; i++) {
    const n = i + 1;
    const r = rows[i].trimEnd();
    if (r === '') {
      if (clause) clause.children.push({ blank: true, line: n, indent: 0, content: '' });
      continue;
    }
    const lead = /^\s*/.exec(r)![0];
    if (/[^ ]/.test(lead)) {
      sink.add(file, n, 'P001');
      continue;
    }
    const indent = lead.length;
    const content = r.slice(indent);
    if (indent === 0) {
      if (content.startsWith('#')) continue;
      const { kw, rest } = splitKw(content);
      const known = CORE.has(kw) || REST_OF_LANGUAGE.has(kw);
      if (!known) sink.add(file, n, 'P002');
      cur = { kw, rest, line: n, known, clauses: [] };
      clause = null;
      stmts.push(cur);
      continue;
    }
    if (!cur) {
      sink.add(file, n, 'P003');
      continue;
    }
    if (!cur.known) continue;
    if (indent === 1) {
      sink.add(file, n, 'P007');
      continue;
    }
    if (indent === 2) {
      if (content.startsWith('#')) continue;
      const { kw, rest } = splitKw(content);
      clause = { kw, rest, line: n, children: [] };
      cur.clauses.push(clause);
      continue;
    }
    if (!clause) {
      sink.add(file, n, 'P006');
      continue;
    }
    clause.children.push({ blank: false, line: n, indent, content });
  }
  return stmts;
}

export interface ReadCtx {
  model: Model;
  sink: Sink;
  files: Map<string, string>;
  recordFolder: string; // '.' or a folder name
  folderOf: (file: string) => string;
}

function jsonString(t: string): string | null {
  try {
    const v = JSON.parse(t);
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

function noChildren(file: string, c: Clause, sink: Sink): void {
  for (const ch of c.children) if (!ch.blank && !ch.content.startsWith('#')) sink.add(file, ch.line, 'P006');
}

function readText(file: string, c: Clause, sink: Sink): string {
  if (c.rest !== '') sink.add(file, c.line, 'P008');
  const lines: string[] = [];
  for (const ch of c.children) {
    if (ch.blank) lines.push('');
    else if (ch.indent < 4) sink.add(file, ch.line, 'P008');
    else lines.push(' '.repeat(ch.indent - 4) + ch.content);
  }
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

// Reads a `request <JSON object>` text: null when it got P009 or P051.
function readRequest(file: string, line: number, rest: string, sink: Sink): Record<string, unknown> | null {
  const p = parseJson(rest);
  if (!p.ok || !isObj(p.value)) {
    sink.add(file, line, 'P009');
    return null;
  }
  if (hasOwn(p.value, 'id') || hasOwn(p.value, 'op') || hasOwn(p.value, 'input')) {
    sink.add(file, line, 'P051');
    return null;
  }
  return p.value;
}

// Handles the clause-level rules shared by every statement: unknown clause, once-only clause.
function accept(file: string, c: Clause, allowed: string[], once: string[], seen: Set<string>, sink: Sink): boolean {
  if (!allowed.includes(c.kw)) {
    sink.add(file, c.line, 'P015');
    return false;
  }
  if (once.includes(c.kw)) {
    if (seen.has(c.kw)) {
      sink.add(file, c.line, 'P052');
      return false;
    }
    seen.add(c.kw);
  }
  return true;
}

function parseTitled(file: string, st: Statement, sink: Sink): string {
  const rest = st.rest;
  if (rest === '') {
    sink.add(file, st.line, 'P005');
    return '';
  }
  const m = /^(\S+)\s*([\s\S]*)$/.exec(rest)!;
  const t = m[2];
  if (t.length < 2 || !t.startsWith('"') || !t.endsWith('"')) sink.add(file, st.line, 'P005');
  else if (jsonString(t) === null) sink.add(file, st.line, 'P004');
  return m[1];
}

// Splits `input` fields at commas outside quotes and brackets (REQ-SY-007).
function splitFields(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      cur += ch;
      if (ch === '\\' && i + 1 < s.length) cur += s[++i];
      else if (ch === '"') inQ = false;
      continue;
    }
    if (ch === '"') inQ = true;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
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

export function readFile(ctx: ReadCtx, file: string, text: string): string | null {
  const { model, sink } = ctx;
  const stmts = lex(file, text, sink);
  const dir = ctx.folderOf(file);
  let version: string | null = null;
  let sawDuramen = false;

  for (const st of stmts) {
    if (!st.known) continue;
    const seen = new Set<string>();
    switch (st.kw) {
      case 'duramen': {
        for (const c of st.clauses) sink.add(file, c.line, 'P015');
        if (sawDuramen) {
          sink.add(file, st.line, 'P023');
        } else {
          sawDuramen = true;
          if (st.rest === '0.1' || st.rest === '0.2') version = st.rest;
          else sink.add(file, st.line, 'P023');
        }
        break;
      }
      case 'spec': {
        const first = !model.spec;
        const words = st.rest.split(/\s+/).filter((w) => w !== '');
        if (words.length !== 2) sink.add(file, st.line, 'P021');
        if (!first) sink.add(file, st.line, 'P044');
        let request: Record<string, unknown> | null = null;
        const obl: string[] = [];
        for (const c of st.clauses) {
          if (!accept(file, c, ['title', 'text', 'contract', 'request'], ['title', 'contract', 'request', 'text'], seen, sink)) continue;
          if (c.kw === 'text') obl.push(readText(file, c, sink));
          else {
            noChildren(file, c, sink);
            if (c.kw === 'title') {
              if (jsonString(c.rest) === null) sink.add(file, c.line, 'P004');
            } else if (c.kw === 'request') request = readRequest(file, c.line, c.rest, sink);
          }
        }
        if (first) {
          model.spec = { file, line: st.line, request };
          model.oblig.push({ file, line: st.line, code: 'T004', texts: obl });
        }
        break;
      }
      case 'oracle': {
        const first = !model.oracle;
        if (st.rest === '') sink.add(file, st.line, 'P028');
        if (!first) sink.add(file, st.line, 'P044');
        for (const c of st.clauses) {
          if (!accept(file, c, ['source'], [], seen, sink)) continue;
          noChildren(file, c, sink);
        }
        if (first) model.oracle = { file, line: st.line, cmd: st.rest, dir };
        break;
      }
      case 'section':
      case 'note':
      case 'open': {
        let id = '';
        if (st.kw === 'note') {
          if (st.rest !== '') sink.add(file, st.line, 'P050');
        } else id = parseTitled(file, st, sink);
        const texts: string[] = [];
        const allowed = st.kw === 'open' ? ['text', 'example', 'table'] : ['text'];
        for (const c of st.clauses) {
          if (!accept(file, c, allowed, ['text'], seen, sink)) continue;
          if (c.kw === 'text') texts.push(readText(file, c, sink));
          else model.openClauses.push({ file, line: c.line });
        }
        if (st.kw === 'open') model.opens.push({ file, line: st.line, id });
        if (st.kw !== 'open') model.oblig.push({ file, line: st.line, code: 'T004', texts });
        else model.oblig.push({ file, line: st.line, code: 'T014', texts });
        break;
      }
      case 'op':
        readOp(ctx, file, st, seen);
        break;
      case 'errors': {
        const first = !model.errorsSeen;
        if (st.rest !== '') sink.add(file, st.line, 'P050');
        if (!first) sink.add(file, st.line, 'P032');
        for (const c of st.clauses) {
          const m = /^when(?:\s+(\S[\s\S]*))?$/.exec(c.rest);
          if (!m || m[1] === undefined) sink.add(file, c.line, 'P019');
          const cond: string[] = [m && m[1] !== undefined ? m[1] : ''];
          for (const ch of c.children) {
            if (ch.blank) continue;
            if (ch.indent < 4) {
              sink.add(file, ch.line, 'P006');
              continue;
            }
            cond.push(' '.repeat(ch.indent - 4) + ch.content);
          }
          if (first) {
            model.codes.push(c.kw);
            model.oblig.push({ file, line: c.line, code: 'T004', texts: [cond.join('\n')] });
          }
        }
        if (first) model.errorsSeen = true;
        break;
      }
      case 'decision': {
        const id = parseTitled(file, st, sink);
        let source: string | null = null;
        let status: string | null = null;
        const texts: string[] = [];
        for (const c of st.clauses) {
          if (!accept(file, c, ['source', 'status', 'text', 'rejected'], ['source', 'status', 'text'], seen, sink)) continue;
          if (c.kw === 'text') {
            texts.push(readText(file, c, sink));
            continue;
          }
          noChildren(file, c, sink);
          if (c.kw === 'source') source = c.rest;
          else if (c.kw === 'status') status = c.rest;
          else {
            const s = jsonString(c.rest);
            if (s === null) sink.add(file, c.line, 'P004');
            else texts.push(s);
          }
        }
        model.decisions.push({ file, line: st.line, id, source, status });
        model.oblig.push({ file, line: st.line, code: 'T004', texts: texts.filter((t) => t !== undefined) });
        break;
      }
      case 'req':
        readReq(ctx, file, dir, st, seen);
        break;
      default:
        break; // the rest of the language (OPEN-RC-001)
    }
  }
  if (version) model.versions.add(version);
  if (!sawDuramen) sink.add(file, 1, 'P020');
  return version;
}

function readOp(ctx: ReadCtx, file: string, st: Statement, seen: Set<string>): void {
  const { model, sink } = ctx;
  const words = st.rest.split(/\s+/).filter((w) => w !== '');
  if (words.length !== 1) sink.add(file, st.line, 'P031');
  const op: OpModel = {
    file,
    line: st.line,
    name: words.length === 1 ? words[0] : '',
    fields: new Map(),
    tolerances: Object.create(null),
    audit: false,
    request: null,
    result: null,
  };
  for (const c of st.clauses) {
    if (!accept(file, c, ['input', 'result', 'tolerance', 'audit', 'request'], ['result', 'audit', 'request'], seen, sink)) continue;
    noChildren(file, c, sink);
    if (c.kw === 'input') {
      for (const raw of splitFields(c.rest)) {
        const f = raw.trim();
        const m = /^([A-Za-z0-9_-]+)(\?)?\s+\S[\s\S]*$/.exec(f);
        if (!m) {
          sink.add(file, c.line, 'P017');
          continue;
        }
        if (op.fields.has(m[1])) sink.add(file, c.line, 'P052');
        else op.fields.set(m[1], m[2] === '?');
      }
    } else if (c.kw === 'result') {
      op.result = c.rest;
    } else if (c.kw === 'tolerance') {
      const path = firstWord(c.rest);
      const num = c.rest.slice(path.length).trim();
      const p = path === '' ? { ok: false as const } : parseJson(num);
      if (!p.ok || typeof p.value !== 'number' || !(p.value >= 0)) {
        sink.add(file, c.line, 'P018');
        continue;
      }
      if (hasOwn(op.tolerances, path)) sink.add(file, c.line, 'P052');
      else setOwn(op.tolerances, path, p.value);
    } else if (c.kw === 'audit') {
      if (c.rest === '' || c.rest === 'text') op.audit = true;
      else sink.add(file, c.line, 'P050');
    } else if (c.kw === 'request') {
      op.request = readRequest(file, c.line, c.rest, sink);
    }
  }
  model.ops.push(op);
  if (op.result !== null) model.oblig.push({ file, line: st.line, code: 'T004', texts: [op.result] });
}

function readReq(ctx: ReadCtx, file: string, dir: string, st: Statement, seen: Set<string>): void {
  const { model, sink } = ctx;
  const id = parseTitled(file, st, sink);
  const req: ReqModel = { file, line: st.line, id, platform: 'any', decisions: [], text: null, items: [] };
  for (const c of st.clauses) {
    if (!accept(file, c, ['text', 'decision', 'on', 'example', 'table'], ['text', 'on'], seen, sink)) continue;
    switch (c.kw) {
      case 'text':
        req.text = { line: c.line, text: readText(file, c, sink) };
        break;
      case 'decision':
        noChildren(file, c, sink);
        for (const d of c.rest.split(/[,\s]+/)) if (d !== '') req.decisions.push(d);
        break;
      case 'on':
        noChildren(file, c, sink);
        if (c.rest === 'any' || c.rest === 'posix' || c.rest === 'windows') req.platform = c.rest;
        else sink.add(file, c.line, 'P033');
        break;
      case 'example':
        readExample(ctx, file, dir, c, req);
        break;
      case 'table':
        readTable(ctx, file, dir, c, req);
        break;
    }
  }
  model.reqs.push(req);
}

// ---------------------------------------------------------------- examples

function parsePath(s: string): string[] | null {
  const segs: string[] = [];
  let i = 0;
  if (s === '') return null;
  for (;;) {
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      if (j >= s.length) return null;
      const v = jsonString(s.slice(i, j + 1));
      if (v === null) return null;
      segs.push(v);
      i = j + 1;
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(s.slice(i));
      if (!m) return null;
      segs.push(m[0]);
      i += m[0].length;
    }
    if (i === s.length) return segs;
    if (s[i] !== '.') return null;
    i++;
  }
}

function findFrom(arg: string): { path: string; file: string } | null {
  const re = /\s+from\s*"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(arg))) {
    const start = m.index + m[0].length - 1;
    const f = jsonString(arg.slice(start));
    if (f !== null) return { path: arg.slice(0, m.index), file: f };
    re.lastIndex = m.index + 1;
  }
  return null;
}

// Resolves the name of a `from` file against the folder of the example's file (REQ-SY-011).
function resolveFrom(ctx: ReadCtx, dir: string, name: string): string | null {
  const stack = dir === '.' ? [] : dir.split('/');
  for (const part of name.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return null;
      stack.pop();
    } else stack.push(part);
  }
  const joined = stack.join('/');
  if (!ctx.files.has(joined)) return null;
  const rf = ctx.recordFolder;
  if (rf !== '.' && !joined.startsWith(rf + '/')) return null;
  return joined;
}

function parseNumberText(t: string): number | null {
  const p = parseJson(t.trim());
  if (!p.ok || typeof p.value !== 'number') return null;
  return p.value;
}

function parseExpect(file: string, line: number, arg: string, sink: Sink): Expect | null {
  const s = arg.trimStart();
  const pm = /^[^\s=≈~]+/.exec(s);
  if (!pm) {
    sink.add(file, line, 'P011');
    return null;
  }
  const path = pm[0];
  const after = s.slice(path.length).trimStart();
  if (after === '') {
    sink.add(file, line, 'P011');
    return null;
  }
  const c = after[0];
  if (c === '=') {
    const val = after.slice(1).trim();
    if (val === '?') return { line, path, kind: 'oracle' };
    const p = parseJson(val);
    if (!p.ok) {
      sink.add(file, line, 'P009');
      return null;
    }
    return { line, path, kind: 'eq', value: p.value };
  }
  if (c === '≈' || c === '~') {
    const body = after.slice(1);
    const i1 = body.indexOf('±');
    const i2 = body.indexOf('+-');
    let idx = -1;
    let len = 0;
    if (i1 >= 0 && (i2 < 0 || i1 < i2)) {
      idx = i1;
      len = 1;
    } else if (i2 >= 0) {
      idx = i2;
      len = 2;
    }
    if (idx < 0) {
      sink.add(file, line, 'P010');
      return null;
    }
    const v = parseNumberText(body.slice(0, idx));
    const t = parseNumberText(body.slice(idx + len));
    if (v === null || t === null || !(t >= 0)) {
      sink.add(file, line, 'P010');
      return null;
    }
    return { line, path, kind: 'approx', value: v, tol: t };
  }
  sink.add(file, line, 'P011');
  return null;
}

function readExample(ctx: ReadCtx, file: string, dir: string, c: Clause, req: ReqModel): void {
  const { sink } = ctx;
  const item: Item = {
    file,
    line: c.line,
    dir,
    op: null,
    raw: false,
    rawLine: null,
    inputText: null,
    inputObj: null,
    request: null,
    omit: new Set(),
    expects: [],
    dropped: false,
  };
  let base: Record<string, unknown> | null = null;
  const rest = c.rest;
  if (rest === '') {
    sink.add(file, c.line, 'P012');
    item.dropped = true;
  } else if (firstWord(rest) === 'raw') {
    item.raw = true;
    const arg = rest.slice(3).trim();
    let line: string | null = null;
    if (arg.startsWith('"')) line = jsonString(arg);
    else if (arg.length >= 2 && arg.startsWith("'") && arg.endsWith("'")) line = arg.slice(1, -1);
    if (line === null) {
      sink.add(file, c.line, 'P004');
      item.dropped = true;
    } else if (/[\r\n]/.test(line)) {
      sink.add(file, c.line, 'P026');
      item.dropped = true;
    } else item.rawLine = line;
  } else {
    item.op = firstWord(rest);
    const arg = rest.slice(item.op.length).trim();
    if (arg !== '') {
      let v: unknown;
      let ok = true;
      try {
        v = JSON.parse(arg);
      } catch {
        ok = false;
      }
      if (!ok || parseJson(arg).ok === false) {
        sink.add(file, c.line, 'P009');
        item.dropped = true;
      } else if (!isObj(v)) {
        sink.add(file, c.line, 'P012');
        item.dropped = true;
      } else {
        item.inputText = arg;
        base = v;
      }
    }
  }

  let requestRead = false;
  let hasInputLines = false;
  let work: Record<string, unknown> | null = null; // input object being built by input lines
  const kids = c.children;
  let i = 0;

  const consumeText = (): string[] => {
    const lines: string[] = [];
    while (i < kids.length) {
      const k = kids[i];
      if (k.blank) lines.push('');
      else if (k.indent >= 6) lines.push(' '.repeat(k.indent - 6) + k.content);
      else break;
      i++;
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  };

  while (i < kids.length) {
    const k = kids[i];
    i++;
    if (k.blank || k.content.startsWith('#')) continue;
    if (k.indent !== 4) {
      sink.add(file, k.line, 'P006');
      continue;
    }
    const { kw, rest: arg } = splitKw(k.content);
    if (kw === 'expect') {
      const e = parseExpect(file, k.line, arg, sink);
      if (e) item.expects.push(e);
    } else if (kw === 'request') {
      if (item.raw) sink.add(file, k.line, 'P022');
      else if (requestRead) sink.add(file, k.line, 'P052');
      else {
        const r = readRequest(file, k.line, arg, sink);
        if (r) {
          requestRead = true;
          item.request = r;
        }
      }
    } else if (kw === 'omit') {
      if (item.raw) sink.add(file, k.line, 'P022');
      else {
        const names = arg.split(/[,\s]+/).filter((n) => n !== '');
        if (names.length === 0) sink.add(file, k.line, 'P011');
        for (const n of names) item.omit.add(n);
      }
    } else if (kw === 'input') {
      const from = findFrom(arg);
      if (item.raw) {
        sink.add(file, k.line, 'P022');
        if (!from) consumeText();
        continue;
      }
      const segs = parsePath(from ? from.path : arg);
      let text: string | null = null;
      if (!from) {
        const lines = consumeText();
        if (lines.length) text = lines.join('\n') + '\n';
      }
      if (!segs) {
        sink.add(file, k.line, 'P049');
        continue;
      }
      if (from) {
        const resolved = resolveFrom(ctx, dir, from.file);
        if (resolved === null) {
          sink.add(file, k.line, 'P048');
          continue;
        }
        text = ctx.files.get(resolved)!;
      }
      if (!work) {
        work = base ? base : {};
        hasInputLines = true;
      }
      // check the path first (without creating anything), then set
      let probe: Record<string, unknown> | null = work;
      let bad = false;
      for (let s = 0; s < segs.length - 1 && probe; s++) {
        if (hasOwn(probe, segs[s])) {
          const v = getOwn(probe, segs[s]);
          if (isObj(v)) probe = v;
          else {
            bad = true;
            break;
          }
        } else probe = null;
      }
      if (bad || text === null) {
        sink.add(file, k.line, 'P049');
        continue;
      }
      let cur: Record<string, unknown> = work;
      for (let s = 0; s < segs.length - 1; s++) {
        const v = hasOwn(cur, segs[s]) ? getOwn(cur, segs[s]) : undefined;
        if (isObj(v)) cur = v;
        else {
          const n = {};
          setOwn(cur, segs[s], n);
          cur = n;
        }
      }
      setOwn(cur, segs[segs.length - 1], text);
    } else {
      sink.add(file, k.line, 'P011');
    }
  }
  if (hasInputLines) item.inputObj = work;
  req.items.push(item);
}

// ---------------------------------------------------------------- tables

function splitRow(content: string): string[] {
  const cells: string[] = [];
  let buf = '';
  for (let i = 1; i < content.length; i++) {
    const ch = content[i];
    if (ch === '\\' && content[i + 1] === '|') {
      buf += '|';
      i++;
    } else if (ch === '|') {
      cells.push(buf.trim());
      buf = '';
    } else buf += ch;
  }
  if (buf.trim() !== '') cells.push(buf.trim());
  return cells;
}

interface Column {
  name: string;
  field: boolean;
  tol: number | null;
}

function readTable(ctx: ReadCtx, file: string, dir: string, c: Clause, req: ReqModel): void {
  const { sink } = ctx;
  const rows: { line: number; content: string }[] = [];
  for (const ch of c.children) {
    if (ch.blank || ch.content.startsWith('#')) continue;
    if (ch.indent >= 4 && ch.content.startsWith('|')) rows.push({ line: ch.line, content: ch.content });
    else sink.add(file, ch.line, 'P006');
  }
  const isSep = (s: string) => s.startsWith('|') && s.endsWith('|') && /^[|\-:\s]*$/.test(s);
  const data = rows.filter((r) => !isSep(r.content));
  const opWords = c.rest.split(/\s+/).filter((w) => w !== '');
  if (opWords.length !== 1 || data.length < 2) {
    sink.add(file, c.line, 'P013');
    return;
  }
  const op = opWords[0];
  const header = data[0];
  const cols: Column[] = [];
  const names = new Set<string>();
  for (const cell of splitRow(header.content)) {
    let i = 0;
    while (i < cell.length && !/\s/.test(cell[i]) && cell[i] !== '±' && !cell.startsWith('+-', i)) i++;
    const name = cell.slice(0, i);
    const rest = cell.slice(i).trimStart();
    let tolText: string | null = null;
    let form = name !== '';
    if (rest !== '') {
      if (rest.startsWith('±')) tolText = rest.slice(1).trim();
      else if (rest.startsWith('+-')) tolText = rest.slice(2).trim();
      else form = false;
    }
    const isExp = /^(result|audit|error|id)(\.|$)/.test(name);
    const isField = !isExp && /^[A-Za-z0-9_-]+$/.test(name);
    if (!form || (!isExp && !isField) || names.has(name)) {
      sink.add(file, header.line, 'P013');
      return;
    }
    names.add(name);
    let tol: number | null = null;
    if (tolText !== null) {
      const n = parseNumberText(tolText);
      if (isField || n === null || !(n >= 0)) sink.add(file, header.line, 'P010');
      else tol = n;
    }
    cols.push({ name, field: isField, tol });
  }
  for (const row of data.slice(1)) {
    const cells = splitRow(row.content);
    if (cells.length !== cols.length) {
      sink.add(file, row.line, 'P014');
      continue;
    }
    const item: Item = {
      file,
      line: row.line,
      dir,
      op,
      raw: false,
      rawLine: null,
      inputText: null,
      inputObj: null,
      request: null,
      omit: new Set(),
      expects: [],
      dropped: false,
    };
    const parts: string[] = [];
    cols.forEach((col, ci) => {
      const cell = cells[ci];
      if (cell === '') return;
      if (col.field) {
        if (!parseJson(cell).ok) sink.add(file, row.line, 'P009');
        parts.push(JSON.stringify(col.name) + ':' + cell);
      } else if (cell === '?') {
        item.expects.push({ line: row.line, path: col.name, kind: 'oracle' });
      } else if (col.tol !== null) {
        const n = parseNumberText(cell);
        if (n === null) sink.add(file, row.line, 'P010');
        else item.expects.push({ line: row.line, path: col.name, kind: 'approx', value: n, tol: col.tol });
      } else {
        const p = parseJson(cell);
        if (!p.ok) sink.add(file, row.line, 'P009');
        else item.expects.push({ line: row.line, path: col.name, kind: 'eq', value: p.value });
      }
    });
    item.inputText = '{' + parts.join(',') + '}';
    req.items.push(item);
  }
}
