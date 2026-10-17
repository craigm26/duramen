// Reading a record: files, lines, statements, clauses (REQ-RC-*, REQ-SY-*). Finds the P diagnostics
// and builds the model that the checker works on.

import { cmp, dirname, firstWord, hasOwn, isObj, NUM_RE, parseJson, setOwn } from './util.ts';

export interface Diag { file: string; line: number; level: 'error' | 'warning' | 'info'; code: string }

export interface Expect {
  path: string;
  kind: 'eq' | 'approx' | 'oracle';
  value?: any;
  tol?: number;
  line: number;
}

export interface Example {
  file: string;
  line: number;
  op: string | null;
  raw: string | null;
  inputText: string | null;
  inputObj: Record<string, any> | null;
  inputLines: boolean;
  table: boolean;
  request: Record<string, any> | null;
  omit: string[];
  expects: Expect[];
}

export interface Req {
  id: string;
  file: string;
  line: number;
  text: string | null;
  textLine: number;
  decisions: string[];
  platform: string;
  cases: Example[];
}

export interface OpDecl {
  name: string;
  file: string;
  line: number;
  fields: Map<string, boolean>; // name -> may be left out
  tolerances: Record<string, number>;
  audit: boolean;
  request: Record<string, any> | null;
}

export interface Decision {
  id: string;
  file: string;
  line: number;
  source: string;
  status: string | null;
}

export interface OblText { file: string; line: number; text: string; code: 'T004' | 'T014' }

export interface Model {
  spec: { file: string; line: number; request: Record<string, any> | null } | null;
  oracle: { file: string; line: number; cmd: string } | null;
  ops: OpDecl[];
  codes: string[];
  reqs: Req[];
  opens: { id: string; file: string; line: number; badClauses: { line: number }[] }[];
  decisions: Decision[];
  obl: OblText[];
}

interface Ln { n: number; indent: number; text: string; blank: boolean }
interface Stmt { kw: string; line: number; rest: string; body: Ln[] }
interface Clause { kw: string; line: number; rest: string; sub: Ln[] }

interface Cx {
  file: string;
  files: Record<string, string>;
  recordFolder: string;
  diags: Diag[];
  model: Model;
  counts: { spec: number; oracle: number; errors: number };
}

const CORE = ['duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note'];
const REST = ['type', 'edge', 'edgedef', 'property', 'evidence'];

function d(cx: Cx, line: number, code: string): void {
  cx.diags.push({ file: cx.file, line, level: 'error', code });
}

function lexFile(content: string, cx: Cx): Ln[] {
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const out: Ln[] = [];
  const raw = content.split(/\r\n|\n|\r/);
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i].trimEnd();
    const n = i + 1;
    if (s === '') {
      out.push({ n, indent: 0, text: '', blank: true });
      continue;
    }
    const lead = /^\s*/.exec(s)![0];
    if (/[^ ]/.test(lead)) {
      d(cx, n, 'P001');
      continue;
    }
    out.push({ n, indent: lead.length, text: s.slice(lead.length), blank: false });
  }
  return out;
}

function splitStatements(lines: Ln[], cx: Cx): Stmt[] {
  const out: Stmt[] = [];
  let cur: Stmt | null = null;
  for (const l of lines) {
    if (l.blank) {
      if (cur) cur.body.push(l);
      continue;
    }
    if (l.indent === 0) {
      if (l.text.startsWith('#')) continue;
      const [kw, rest] = firstWord(l.text);
      cur = { kw, line: l.n, rest, body: [] };
      out.push(cur);
      continue;
    }
    if (!cur) {
      d(cx, l.n, 'P003');
      continue;
    }
    cur.body.push(l);
  }
  return out;
}

function splitClauses(body: Ln[], cx: Cx): Clause[] {
  const out: Clause[] = [];
  let cur: Clause | null = null;
  for (const l of body) {
    if (l.blank) {
      if (cur) cur.sub.push(l);
      continue;
    }
    if (l.indent === 1) {
      d(cx, l.n, 'P007');
      continue;
    }
    if (l.indent === 2) {
      if (l.text.startsWith('#')) continue;
      const [kw, rest] = firstWord(l.text);
      cur = { kw, line: l.n, rest, sub: [] };
      out.push(cur);
      continue;
    }
    if (!cur) {
      d(cx, l.n, 'P006');
      continue;
    }
    cur.sub.push(l);
  }
  return out;
}

function takeClauses(st: Stmt, cx: Cx, allowed: string[], once: string[]): Clause[] {
  const out: Clause[] = [];
  const seen = new Set<string>();
  for (const c of splitClauses(st.body, cx)) {
    if (!allowed.includes(c.kw)) {
      d(cx, c.line, 'P015');
      continue;
    }
    if (once.includes(c.kw)) {
      if (seen.has(c.kw)) {
        d(cx, c.line, 'P052');
        continue;
      }
      seen.add(c.kw);
    }
    out.push(c);
  }
  return out;
}

// Under a clause that takes no lines, anything but a blank line or a comment is P006.
function noSub(c: Clause, cx: Cx): void {
  for (const l of c.sub) if (!l.blank && !l.text.startsWith('#')) d(cx, l.n, 'P006');
}

// A text clause (REQ-SY-005): returns its text, or null.
function readText(c: Clause, cx: Cx): string {
  if (c.rest !== '') d(cx, c.line, 'P008');
  const lines: string[] = [];
  for (const l of c.sub) {
    if (l.blank) lines.push('');
    else if (l.indent === 3) d(cx, l.n, 'P008');
    else lines.push(' '.repeat(l.indent - 4) + l.text);
  }
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

function jsonString(rest: string): string | null {
  const p = parseJson(rest);
  return p.ok && typeof p.value === 'string' ? p.value : null;
}

// A `request` clause value (REQ-SY-004): returns the object, or null after reporting.
function readRequest(rest: string, line: number, cx: Cx): Record<string, any> | null {
  const p = parseJson(rest);
  if (!p.ok || p.big || !isObj(p.value)) {
    d(cx, line, 'P009');
    return null;
  }
  if (hasOwn(p.value, 'id') || hasOwn(p.value, 'op') || hasOwn(p.value, 'input')) {
    d(cx, line, 'P051');
    return null;
  }
  return p.value;
}

interface Head { id: string }

// `<keyword> <ID> "<title>"` (REQ-SY-006).
function readHead(st: Stmt, cx: Cx): Head {
  const [id, rest] = firstWord(st.rest);
  if (id === '' || rest.length < 2 || !rest.startsWith('"') || !rest.endsWith('"')) {
    d(cx, st.line, 'P005');
  } else if (jsonString(rest) === null) {
    d(cx, st.line, 'P004');
  }
  return { id };
}

function splitFields(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === '\\' && i + 1 < s.length) cur += s[++i];
      else if (ch === '"') q = false;
      continue;
    }
    if (ch === '"') q = true;
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

function readOp(st: Stmt, cx: Cx): void {
  const words = st.rest.split(/\s+/).filter((w) => w !== '');
  if (words.length !== 1) d(cx, st.line, 'P031');
  const op: OpDecl = {
    name: words[0] ?? '',
    file: cx.file,
    line: st.line,
    fields: new Map(),
    tolerances: {},
    audit: false,
    request: null,
  };
  for (const c of takeClauses(st, cx, ['input', 'result', 'tolerance', 'audit', 'request'], ['result', 'audit', 'request'])) {
    noSub(c, cx);
    if (c.kw === 'input') {
      for (const f of splitFields(c.rest)) {
        const m = /^([A-Za-z0-9_-]+)(\?)?\s+(\S[\s\S]*)$/.exec(f.trim());
        if (!m) {
          d(cx, c.line, 'P017');
        } else if (op.fields.has(m[1])) {
          d(cx, c.line, 'P052');
        } else {
          op.fields.set(m[1], m[2] === '?');
        }
      }
    } else if (c.kw === 'result') {
      cx.model.obl.push({ file: cx.file, line: st.line, text: c.rest, code: 'T004' });
    } else if (c.kw === 'tolerance') {
      const [path, num] = firstWord(c.rest);
      const n = Number(num);
      if (path === '' || !NUM_RE.test(num) || !Number.isFinite(n) || n < 0) d(cx, c.line, 'P018');
      else if (hasOwn(op.tolerances, path)) d(cx, c.line, 'P052');
      else setOwn(op.tolerances, path, n === 0 ? 0 : n);
    } else if (c.kw === 'audit') {
      if (c.rest !== '' && c.rest !== 'text') d(cx, c.line, 'P050');
      else op.audit = true;
    } else if (c.kw === 'request') {
      op.request = readRequest(c.rest, c.line, cx);
    }
  }
  cx.model.ops.push(op);
}

function readErrors(st: Stmt, cx: Cx): void {
  cx.counts.errors++;
  const adopt = cx.counts.errors === 1;
  if (!adopt) d(cx, st.line, 'P032');
  if (st.rest !== '') d(cx, st.line, 'P050');
  for (const c of splitClauses(st.body, cx)) {
    const [w, cond] = firstWord(c.rest);
    if (w !== 'when' || cond === '') d(cx, c.line, 'P019');
    const lines = [cond];
    for (const l of c.sub) {
      if (l.blank) lines.push('');
      else if (l.indent === 3) d(cx, l.n, 'P006');
      else lines.push(' '.repeat(l.indent - 4) + l.text);
    }
    if (adopt) {
      cx.model.codes.push(c.kw);
      cx.model.obl.push({ file: cx.file, line: c.line, text: lines.join('\n'), code: 'T004' });
    }
  }
}

function readDecision(st: Stmt, cx: Cx): void {
  const h = readHead(st, cx);
  const dec: Decision = { id: h.id, file: cx.file, line: st.line, source: '', status: null };
  for (const c of takeClauses(st, cx, ['source', 'status', 'text', 'rejected'], ['source', 'status', 'text'])) {
    if (c.kw === 'text') {
      cx.model.obl.push({ file: cx.file, line: st.line, text: readText(c, cx), code: 'T004' });
      continue;
    }
    noSub(c, cx);
    if (c.kw === 'source') dec.source = c.rest;
    else if (c.kw === 'status') dec.status = c.rest;
    else {
      const s = jsonString(c.rest);
      if (s === null) d(cx, c.line, 'P004');
      else cx.model.obl.push({ file: cx.file, line: st.line, text: s, code: 'T004' });
    }
  }
  cx.model.decisions.push(dec);
}

// A dotted path of words and quoted strings (REQ-SY-011); null when it is of another form.
function parsePath(s: string): string[] | null {
  const segs: string[] = [];
  let i = 0;
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

const FROM_RE =
  /^input\s+(\S(?:[\s\S]*\S)?)\s+from\s+("(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")$/;

function resolveFrom(cx: Cx, name: string): string | null {
  const stack = cx.file.split('/').slice(0, -1);
  for (const part of name.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  const key = stack.join('/');
  if (key === '' || !hasOwn(cx.files, key)) return null;
  const f = cx.recordFolder;
  if (f !== '' && !key.startsWith(f + '/')) return null;
  return key;
}

function readExpect(rest: string, l: Ln, ex: Example, cx: Cx): void {
  const m = /^([^\s=≈~]*)\s*([\s\S]*)$/.exec(rest)!;
  const path = m[1];
  const r = m[2];
  if (path === '') return d(cx, l.n, 'P011');
  if (r.startsWith('=')) {
    const v = r.slice(1).trim();
    if (v === '?') {
      ex.expects.push({ path, kind: 'oracle', line: l.n });
      return;
    }
    const p = parseJson(v);
    if (!p.ok || p.big) return d(cx, l.n, 'P009');
    ex.expects.push({ path, kind: 'eq', value: p.value, line: l.n });
  } else if (r.startsWith('≈') || r.startsWith('~')) {
    const nm = /^(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(?:±|\+-)\s*(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.exec(
      r.slice(1).trim(),
    );
    if (!nm) return d(cx, l.n, 'P010');
    const v = Number(nm[1]);
    const t = Number(nm[2]);
    if (!Number.isFinite(v) || !Number.isFinite(t) || t < 0) return d(cx, l.n, 'P010');
    ex.expects.push({ path, kind: 'approx', value: v, tol: t === 0 ? 0 : t, line: l.n });
  } else {
    d(cx, l.n, 'P011');
  }
}

function readExample(c: Clause, cx: Cx): Example | null {
  const ex: Example = {
    file: cx.file, line: c.line, op: null, raw: null, inputText: null, inputObj: null,
    inputLines: false, table: false, request: null, omit: [], expects: [],
  };
  let isRaw = false;
  let dropped = false;
  let inputObj: Record<string, any> = {};
  const [w, rest] = firstWord(c.rest);
  if (w === '') {
    d(cx, c.line, 'P012');
    dropped = true;
  } else if (w === 'raw') {
    isRaw = true;
    let line: string | null = null;
    if (rest.startsWith('"')) line = jsonString(rest);
    else if (rest.length >= 2 && rest.startsWith("'") && rest.endsWith("'")) line = rest.slice(1, -1);
    if (line === null) {
      d(cx, c.line, 'P004');
      dropped = true;
    } else if (/[\r\n]/.test(line)) {
      d(cx, c.line, 'P026');
      dropped = true;
    } else {
      ex.raw = line;
    }
  } else {
    ex.op = w;
    if (rest !== '') {
      const p = parseJson(rest);
      if (!p.ok || p.big) {
        d(cx, c.line, 'P009');
        dropped = true;
      } else if (!isObj(p.value)) {
        d(cx, c.line, 'P012');
        dropped = true;
      } else {
        ex.inputText = rest;
        inputObj = p.value;
      }
    }
  }
  let requestRead = false;
  const sub = c.sub;
  let i = 0;
  while (i < sub.length) {
    const l = sub[i];
    i++;
    if (l.blank || l.text.startsWith('#')) continue;
    if (l.indent !== 4) {
      d(cx, l.n, 'P006');
      continue;
    }
    const [kw, rest2] = firstWord(l.text);
    if (kw === 'expect') {
      readExpect(rest2, l, ex, cx);
    } else if (kw === 'request') {
      if (isRaw) d(cx, l.n, 'P022');
      else if (requestRead) d(cx, l.n, 'P052');
      else {
        const r = readRequest(rest2, l.n, cx);
        if (r) {
          ex.request = r;
          requestRead = true;
        }
      }
    } else if (kw === 'omit') {
      if (isRaw) {
        d(cx, l.n, 'P022');
        continue;
      }
      const names = rest2.split(/[,\s]+/).filter((x) => x !== '');
      if (names.length === 0) d(cx, l.n, 'P011');
      else ex.omit.push(...names);
    } else if (kw === 'input') {
      const fm = FROM_RE.exec(l.text);
      let text = '';
      let hasText = false;
      if (!fm) {
        const tl: Ln[] = [];
        while (i < sub.length && (sub[i].blank || sub[i].indent >= 6)) tl.push(sub[i++]);
        while (tl.length && tl[tl.length - 1].blank) tl.pop();
        hasText = tl.length > 0;
        text = tl.map((x) => (x.blank ? '' : ' '.repeat(x.indent - 6) + x.text) + '\n').join('');
      }
      if (isRaw) {
        d(cx, l.n, 'P022');
        continue;
      }
      const segs = parsePath(fm ? fm[1] : rest2);
      if (!segs) {
        d(cx, l.n, 'P049');
        continue;
      }
      if (fm) {
        const key = resolveFrom(cx, JSON.parse(fm[2]));
        if (key === null) {
          d(cx, l.n, 'P048');
          continue;
        }
        text = cx.files[key];
        hasText = true;
      }
      let cur: Record<string, any> = inputObj;
      let bad = false;
      for (const s of segs.slice(0, -1)) {
        if (!hasOwn(cur, s)) break;
        if (!isObj(cur[s])) {
          bad = true;
          break;
        }
        cur = cur[s];
      }
      if (bad || !hasText) {
        d(cx, l.n, 'P049');
        continue;
      }
      cur = inputObj;
      for (const s of segs.slice(0, -1)) {
        if (!hasOwn(cur, s)) setOwn(cur, s, {});
        cur = cur[s];
      }
      setOwn(cur, segs[segs.length - 1], text);
      ex.inputLines = true;
    } else {
      d(cx, l.n, 'P011');
    }
  }
  if (dropped) return null;
  if (ex.inputLines) ex.inputObj = inputObj;
  return ex;
}

interface Col { name: string; expect: boolean; tol?: number }

function splitCells(text: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let i = 1;
  let closed = false;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
      closed = i === text.length - 1;
    } else {
      cur += ch;
    }
  }
  if (!closed) cells.push(cur.trim());
  return cells;
}

function readTable(c: Clause, cx: Cx): Example[] {
  const rows: { n: number; text: string }[] = [];
  for (const l of c.sub) {
    if (l.blank || l.text.startsWith('#')) continue;
    if (l.text.startsWith('|') && l.indent >= 4) rows.push({ n: l.n, text: l.text });
    else d(cx, l.n, 'P006');
  }
  const data = rows.filter((r) => !/^\|(?:[|:\s-]*\|)?$/.test(r.text));
  const ops = c.rest.split(/\s+/).filter((w) => w !== '');
  if (ops.length !== 1 || data.length < 2) {
    d(cx, c.line, 'P013');
    return [];
  }
  const head = data[0];
  const cols: Col[] = [];
  const names = new Set<string>();
  for (const cell of splitCells(head.text)) {
    let idx = 0;
    while (idx < cell.length && !/\s/.test(cell[idx]) && cell[idx] !== '±' && !cell.startsWith('+-', idx)) idx++;
    const name = cell.slice(0, idx);
    let tolStr: string | null = null;
    let t = cell.slice(idx).trimStart();
    let form = true;
    if (t !== '') {
      if (t.startsWith('±')) tolStr = t.slice(1).trim();
      else if (t.startsWith('+-')) tolStr = t.slice(2).trim();
      else form = false;
    }
    const isExpect = /^(?:result|audit|error|id)(?:\.[\s\S]*)?$/.test(name);
    if (!form || !(isExpect || /^[A-Za-z0-9_-]+$/.test(name)) || names.has(name)) {
      d(cx, head.n, 'P013');
      return [];
    }
    names.add(name);
    const col: Col = { name, expect: isExpect };
    if (tolStr !== null) {
      const n = Number(tolStr);
      if (!isExpect || !NUM_RE.test(tolStr) || !Number.isFinite(n) || n < 0) d(cx, head.n, 'P010');
      else col.tol = n === 0 ? 0 : n;
    }
    cols.push(col);
  }
  const out: Example[] = [];
  for (const row of data.slice(1)) {
    const cells = splitCells(row.text);
    if (cells.length !== cols.length) {
      d(cx, row.n, 'P014');
      continue;
    }
    const ex: Example = {
      file: cx.file, line: row.n, op: ops[0], raw: null, inputText: null, inputObj: null,
      inputLines: false, table: true, request: null, omit: [], expects: [],
    };
    const parts: string[] = [];
    cols.forEach((col, k) => {
      const cell = cells[k];
      if (cell === '') return;
      if (!col.expect) {
        const p = parseJson(cell);
        if (!p.ok || p.big) d(cx, row.n, 'P009');
        else parts.push(JSON.stringify(col.name) + ':' + cell);
      } else if (cell === '?') {
        ex.expects.push({ path: col.name, kind: 'oracle', line: row.n });
      } else if (col.tol !== undefined) {
        const n = Number(cell);
        if (!NUM_RE.test(cell) || !Number.isFinite(n)) d(cx, row.n, 'P010');
        else ex.expects.push({ path: col.name, kind: 'approx', value: n, tol: col.tol, line: row.n });
      } else {
        const p = parseJson(cell);
        if (!p.ok || p.big) d(cx, row.n, 'P009');
        else ex.expects.push({ path: col.name, kind: 'eq', value: p.value, line: row.n });
      }
    });
    ex.inputText = '{' + parts.join(',') + '}';
    out.push(ex);
  }
  return out;
}

function readReq(st: Stmt, cx: Cx): void {
  const h = readHead(st, cx);
  const req: Req = {
    id: h.id, file: cx.file, line: st.line, text: null, textLine: 0, decisions: [], platform: 'any', cases: [],
  };
  for (const c of takeClauses(st, cx, ['text', 'decision', 'on', 'example', 'table'], ['text', 'on'])) {
    if (c.kw === 'text') {
      req.text = readText(c, cx);
      req.textLine = c.line;
    } else if (c.kw === 'example') {
      const ex = readExample(c, cx);
      if (ex) req.cases.push(ex);
    } else if (c.kw === 'table') {
      req.cases.push(...readTable(c, cx));
    } else {
      noSub(c, cx);
      if (c.kw === 'decision') {
        for (const id of c.rest.split(/[,\s]+/)) if (id !== '' && !req.decisions.includes(id)) req.decisions.push(id);
      } else if (c.rest === 'any' || c.rest === 'posix' || c.rest === 'windows') {
        req.platform = c.rest;
      } else {
        d(cx, c.line, 'P033');
      }
    }
  }
  cx.model.reqs.push(req);
}

function readStatement(st: Stmt, cx: Cx, file: { versions: string[]; duramen: number }): void {
  switch (st.kw) {
    case 'duramen': {
      file.duramen++;
      if (file.duramen === 1 && (st.rest === '0.1' || st.rest === '0.2')) file.versions.push(st.rest);
      else d(cx, st.line, 'P023');
      for (const c of splitClauses(st.body, cx)) d(cx, c.line, 'P015');
      break;
    }
    case 'spec': {
      cx.counts.spec++;
      if (cx.counts.spec > 1) d(cx, st.line, 'P044');
      if (st.rest.split(/\s+/).filter((w) => w !== '').length !== 2) d(cx, st.line, 'P021');
      let request: Record<string, any> | null = null;
      for (const c of takeClauses(st, cx, ['title', 'text', 'contract', 'request'], ['title', 'text', 'contract', 'request'])) {
        if (c.kw === 'text') {
          const t = readText(c, cx);
          if (cx.counts.spec === 1) cx.model.obl.push({ file: cx.file, line: st.line, text: t, code: 'T004' });
          continue;
        }
        noSub(c, cx);
        if (c.kw === 'title' && jsonString(c.rest) === null) d(cx, c.line, 'P004');
        else if (c.kw === 'request') request = readRequest(c.rest, c.line, cx);
      }
      if (cx.counts.spec === 1) cx.model.spec = { file: cx.file, line: st.line, request };
      break;
    }
    case 'oracle': {
      cx.counts.oracle++;
      if (cx.counts.oracle > 1) d(cx, st.line, 'P044');
      if (st.rest === '') d(cx, st.line, 'P028');
      for (const c of takeClauses(st, cx, ['source'], [])) noSub(c, cx);
      if (cx.counts.oracle === 1 && st.rest !== '') cx.model.oracle = { file: cx.file, line: st.line, cmd: st.rest };
      break;
    }
    case 'section': {
      readHead(st, cx);
      for (const c of takeClauses(st, cx, ['text'], ['text'])) {
        cx.model.obl.push({ file: cx.file, line: st.line, text: readText(c, cx), code: 'T004' });
      }
      break;
    }
    case 'note': {
      if (st.rest !== '') d(cx, st.line, 'P050');
      for (const c of takeClauses(st, cx, ['text'], ['text'])) {
        cx.model.obl.push({ file: cx.file, line: st.line, text: readText(c, cx), code: 'T004' });
      }
      break;
    }
    case 'open': {
      const h = readHead(st, cx);
      const op = { id: h.id, file: cx.file, line: st.line, badClauses: [] as { line: number }[] };
      for (const c of takeClauses(st, cx, ['text', 'example', 'table'], ['text'])) {
        if (c.kw === 'text') cx.model.obl.push({ file: cx.file, line: st.line, text: readText(c, cx), code: 'T014' });
        else op.badClauses.push({ line: c.line });
      }
      cx.model.opens.push(op);
      break;
    }
    case 'op':
      readOp(st, cx);
      break;
    case 'errors':
      readErrors(st, cx);
      break;
    case 'req':
      readReq(st, cx);
      break;
    case 'decision':
      readDecision(st, cx);
      break;
    default:
      if (!REST.includes(st.kw)) d(cx, st.line, 'P002');
  }
}

export interface ReadResult {
  diags: Diag[];
  model: Model;
  hasError: boolean;
  /** the record's files in order, with their folder */
  recordFolder: string;
}

export function readRecord(files: Record<string, string>, entry: string | undefined): ReadResult {
  const model: Model = { spec: null, oracle: null, ops: [], codes: [], reqs: [], opens: [], decisions: [], obl: [] };
  const diags: Diag[] = [];
  let names: string[];
  let recordName: string;
  let recordFolder: string;
  const all = Object.keys(files);
  if (entry !== undefined && entry !== '.' && hasOwn(files, entry)) {
    names = [entry];
    recordName = entry;
    recordFolder = dirname(entry);
  } else {
    const prefix = entry === undefined || entry === '.' ? '' : entry + '/';
    recordName = entry === undefined ? '.' : entry;
    recordFolder = prefix === '' ? '' : entry!;
    names = all.filter((k) => {
      if (!k.startsWith(prefix)) return false;
      const parts = k.slice(prefix.length).split('/');
      if (parts.some((p) => p.startsWith('.'))) return false;
      if (parts.slice(0, -1).some((p) => p === 'build' || p === 'node_modules')) return false;
      return parts[parts.length - 1].endsWith('.duramen');
    });
    if (names.length === 0) {
      diags.push({ file: recordName, line: 1, level: 'error', code: 'P046' });
      return { diags, model, hasError: true, recordFolder };
    }
  }
  const skip = recordFolder === '' ? 0 : recordFolder.length + 1;
  names.sort((a, b) => cmp(a.slice(skip), b.slice(skip)));
  const counts = { spec: 0, oracle: 0, errors: 0 };
  const versions = new Set<string>();
  for (const name of names) {
    const cx: Cx = { file: name, files, recordFolder, diags, model, counts };
    const lines = lexFile(files[name], cx);
    const file = { versions: [] as string[], duramen: 0 };
    for (const st of splitStatements(lines, cx)) readStatement(st, cx, file);
    if (file.duramen === 0) diags.push({ file: name, line: 1, level: 'error', code: 'P020' });
    for (const v of file.versions) versions.add(v);
  }
  if (!model.spec && counts.spec === 0) diags.push({ file: recordName, line: 1, level: 'error', code: 'P021' });
  if (versions.size > 1) diags.push({ file: recordName, line: 1, level: 'error', code: 'P047' });
  return { diags, model, hasError: diags.some((x) => x.level === 'error'), recordFolder };
}
