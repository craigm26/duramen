// Reading a record: files -> lines -> statements -> clauses -> a model, with the P diagnostics
// found on the way (REQ-RC-*, REQ-SY-*).

import { compareUtf16, finiteNumber, hasOwn, holdsBigNumber, isPlainObject, parseJson, setOwn } from './util.ts';

export type Diag = { file: string; line: number; level: 'error' | 'warning' | 'info'; code: string };

export type Expect = {
  line: number;
  path: string;
  kind: 'eq' | 'approx' | 'oracle';
  value?: any;
  tol?: number;
};

export type Item = {
  file: string;
  line: number;
  kind: 'example' | 'row';
  raw: boolean;
  rawLine?: string;
  op?: string;
  inputText?: string; // the input as written, when the example gave one
  inputObj?: any; // the input as an object, when input lines were used
  hasInputLines: boolean;
  request?: any;
  omit: Set<string>;
  expects: Expect[];
  expectsError: boolean;
  inputKeys?: string[]; // for table rows
};

export type Req = {
  file: string;
  line: number;
  id: string;
  platform: string;
  textLine?: number;
  textLines?: string[];
  decisions: string[];
  items: Item[];
  hasStatic: boolean;
};

export type Op = {
  file: string;
  line: number;
  name: string;
  fields: Map<string, boolean>; // name -> optional
  resultText?: string;
  tolerances: Map<string, number>;
  audit: boolean;
  request?: any;
};

export type Decision = {
  file: string;
  line: number;
  id: string;
  source?: string;
  status?: string;
  textLines?: string[];
  rejected: string[];
};

export type Model = {
  recordName: string;
  recordDir: string;
  files: string[];
  spec?: { file: string; line: number; request?: any; textLines?: string[] };
  oracle?: { file: string; line: number; command: string };
  ops: Op[];
  errorCodes: { code: string; line: number; file: string; cond: string[] }[];
  reqs: Req[];
  opens: { file: string; line: number; id: string; textLines?: string[]; exampleLines: number[] }[];
  decisions: Decision[];
  sections: { file: string; line: number; textLines?: string[] }[];
  notes: { file: string; line: number; textLines?: string[] }[];
};

type Ln = { n: number; indent: number; text: string; blank: boolean };
type Clause = { kw: string; rest: string; line: number; lines: Ln[] };
type Stmt = { kw: string; rest: string; line: number; clauses: Clause[]; known: boolean };

const FROM_RE =
  /^input\s+(\S(?:[\s\S]*\S)?)\s+from\s+("(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")$/;

const CORE = new Set(['duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note']);
const OTHER = new Set(['type', 'edge', 'edgedef', 'property', 'evidence']);

function splitWord(text: string): [string, string] {
  const m = /^(\S+)\s*([\s\S]*)$/.exec(text);
  return m ? [m[1], m[2]] : ['', ''];
}

// ---------------------------------------------------------------- resolving the record

export function resolveRecord(
  files: Record<string, string>,
  entry: string | undefined,
): { recordName: string; recordDir: string; names: string[]; entryFile: boolean } | undefined {
  const keys = Object.keys(files);
  const name = entry === undefined || entry === '.' ? '.' : entry;
  if (name !== '.' && hasOwn(files, name)) {
    const slash = name.lastIndexOf('/');
    return { recordName: name, recordDir: slash < 0 ? '' : name.slice(0, slash), names: [name], entryFile: true };
  }
  const prefix = name === '.' ? '' : name + '/';
  const names: string[] = [];
  for (const k of keys) {
    if (!k.startsWith(prefix)) continue;
    const rel = k.slice(prefix.length);
    const parts = rel.split('/');
    const last = parts.length - 1;
    let skip = false;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.startsWith('.')) skip = true;
      if (i < last && (p === 'build' || p === 'node_modules')) skip = true;
    }
    if (skip || !rel.endsWith('.duramen')) continue;
    names.push(k);
  }
  if (names.length === 0) return undefined;
  names.sort((a, b) => compareUtf16(a.slice(prefix.length), b.slice(prefix.length)));
  return { recordName: name, recordDir: name === '.' ? '' : name, names, entryFile: false };
}

// ---------------------------------------------------------------- reading

export function readRecord(
  files: Record<string, string>,
  entry: string | undefined,
): { diags: Diag[]; model?: Model } {
  const diags: Diag[] = [];
  const resolved = resolveRecord(files, entry);
  if (!resolved) {
    const nm = entry === undefined ? '.' : entry;
    return { diags: [{ file: nm, line: 1, level: 'error', code: 'P046' }] };
  }
  const model: Model = {
    recordName: resolved.recordName,
    recordDir: resolved.recordDir,
    files: resolved.names,
    ops: [],
    errorCodes: [],
    reqs: [],
    opens: [],
    decisions: [],
    sections: [],
    notes: [],
  };
  const counts = { spec: 0, oracle: 0, errors: 0 };
  const versions = new Set<string>();

  for (const file of resolved.names) {
    readFile(file, files[file], files, model, counts, versions, diags);
  }
  if (counts.spec === 0) diags.push({ file: resolved.recordName, line: 1, level: 'error', code: 'P021' });
  if (versions.size > 1) diags.push({ file: resolved.recordName, line: 1, level: 'error', code: 'P047' });
  return { diags, model };
}

function lex(file: string, text: string, diags: Diag[]): Ln[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const out: Ln[] = [];
  const raw = text.split(/\r\n|\n|\r/);
  for (let i = 0; i < raw.length; i++) {
    const n = i + 1;
    const trimmed = raw[i].trimEnd();
    if (trimmed === '') {
      out.push({ n, indent: 0, text: '', blank: true });
      continue;
    }
    const lead = /^\s*/.exec(trimmed)![0];
    if (/[^ ]/.test(lead)) {
      diags.push({ file, line: n, level: 'error', code: 'P001' });
      continue;
    }
    out.push({ n, indent: lead.length, text: trimmed.slice(lead.length), blank: false });
  }
  return out;
}

function readFile(
  file: string,
  text: string,
  files: Record<string, string>,
  model: Model,
  counts: { spec: number; oracle: number; errors: number },
  versions: Set<string>,
  diags: Diag[],
): void {
  const err = (line: number, code: string) => diags.push({ file, line, level: 'error', code });
  const lines = lex(file, text, diags);

  // ---- stage A: statements and clauses
  const stmts: Stmt[] = [];
  let cur: Stmt | null = null;
  let clause: Clause | null = null;
  for (const ln of lines) {
    if (ln.blank) {
      if (clause) clause.lines.push(ln);
      continue;
    }
    if (ln.indent === 0) {
      if (ln.text.startsWith('#')) continue;
      const [kw, rest] = splitWord(ln.text);
      const known = CORE.has(kw) || OTHER.has(kw);
      if (!known) err(ln.n, 'P002');
      cur = { kw, rest, line: ln.n, clauses: [], known };
      stmts.push(cur);
      clause = null;
      continue;
    }
    if (!cur) {
      err(ln.n, 'P003');
      continue;
    }
    if (!cur.known) continue;
    if (ln.indent === 1) {
      err(ln.n, 'P007');
      continue;
    }
    if (ln.indent === 2) {
      if (ln.text.startsWith('#')) continue;
      const [kw, rest] = splitWord(ln.text);
      clause = { kw, rest, line: ln.n, lines: [] };
      cur.clauses.push(clause);
      continue;
    }
    if (!clause) {
      err(ln.n, 'P006');
      continue;
    }
    clause.lines.push(ln);
  }

  // ---- stage B: statements
  let dur = 0;
  let fileVersion: string | null = null;

  const noLines = (c: Clause) => {
    for (const l of c.lines) if (!l.blank && !l.text.startsWith('#')) err(l.n, 'P006');
  };
  const readText = (c: Clause): string[] => {
    if (c.rest !== '') err(c.line, 'P008');
    const out: string[] = [];
    for (const l of c.lines) {
      if (l.blank) out.push('');
      else if (l.indent < 4) err(l.n, 'P008');
      else out.push(' '.repeat(l.indent - 4) + l.text);
    }
    while (out.length && out[0] === '') out.shift();
    while (out.length && out[out.length - 1] === '') out.pop();
    return out;
  };
  const readRequest = (c: Clause): any => {
    const p = parseJson(c.rest);
    if (!p.ok || holdsBigNumber(p.value) || !isPlainObject(p.value)) {
      err(c.line, 'P009');
      return undefined;
    }
    if (hasOwn(p.value, 'id') || hasOwn(p.value, 'op') || hasOwn(p.value, 'input')) {
      err(c.line, 'P051');
      return undefined;
    }
    return p.value;
  };
  const quoted = (line: number, text: string): string | undefined => {
    const p = parseJson(text);
    if (p.ok && typeof p.value === 'string') return p.value;
    err(line, 'P004');
    return undefined;
  };
  const idAndTitle = (s: Stmt): string => {
    const [id, title] = splitWord(s.rest);
    if (title.length < 2 || !title.startsWith('"') || !title.endsWith('"')) err(s.line, 'P005');
    else quoted(s.line, title);
    return id;
  };
  // Walks the clauses of a statement, reporting unknown and repeated ones.
  const clausesOf = (s: Stmt, allowed: string[], once: string[], handle: (c: Clause) => void) => {
    const seen = new Set<string>();
    for (const c of s.clauses) {
      if (!allowed.includes(c.kw)) {
        err(c.line, 'P015');
        continue;
      }
      if (once.includes(c.kw)) {
        if (seen.has(c.kw)) {
          err(c.line, 'P052');
          continue;
        }
        seen.add(c.kw);
      }
      handle(c);
    }
  };

  for (const s of stmts) {
    if (!s.known) continue;
    switch (s.kw) {
      case 'duramen': {
        dur++;
        if (dur === 1) {
          if (s.rest === '0.1' || s.rest === '0.2') fileVersion = s.rest;
          else err(s.line, 'P023');
        } else err(s.line, 'P023');
        clausesOf(s, [], [], () => {});
        break;
      }
      case 'spec': {
        counts.spec++;
        const words = s.rest.split(/\s+/).filter(Boolean);
        if (words.length !== 2) err(s.line, 'P021');
        if (counts.spec > 1) err(s.line, 'P044');
        const rec = counts.spec === 1 ? { file, line: s.line } : undefined;
        if (rec) model.spec = rec as any;
        clausesOf(s, ['title', 'text', 'contract', 'request'], ['title', 'contract', 'request', 'text'], (c) => {
          if (c.kw === 'title') {
            quoted(c.line, c.rest);
            noLines(c);
          } else if (c.kw === 'text') {
            const t = readText(c);
            if (rec) (rec as any).textLines = t;
          } else if (c.kw === 'request') {
            const r = readRequest(c);
            if (rec) (rec as any).request = r;
            noLines(c);
          } else noLines(c);
        });
        break;
      }
      case 'oracle': {
        counts.oracle++;
        if (s.rest === '') err(s.line, 'P028');
        if (counts.oracle > 1) err(s.line, 'P044');
        else model.oracle = { file, line: s.line, command: s.rest };
        clausesOf(s, ['source'], [], (c) => noLines(c));
        break;
      }
      case 'section':
      case 'note': {
        let rec: { file: string; line: number; textLines?: string[] };
        if (s.kw === 'section') {
          idAndTitle(s);
          rec = { file, line: s.line };
          model.sections.push(rec);
        } else {
          if (s.rest !== '') err(s.line, 'P050');
          rec = { file, line: s.line };
          model.notes.push(rec);
        }
        clausesOf(s, ['text'], ['text'], (c) => {
          rec.textLines = readText(c);
        });
        break;
      }
      case 'op': {
        readOp(s);
        break;
      }
      case 'errors': {
        counts.errors++;
        if (s.rest !== '') err(s.line, 'P050');
        if (counts.errors > 1) err(s.line, 'P032');
        for (const c of s.clauses) {
          const m = /^when(?:\s+([\s\S]*))?$/.exec(c.rest);
          const first = m && m[1] ? m[1].trim() : '';
          if (!m || first === '') err(c.line, 'P019');
          const cond: string[] = [];
          if (first !== '') cond.push(first);
          for (const l of c.lines) {
            if (l.blank) continue;
            if (l.indent < 4) err(l.n, 'P006');
            else cond.push(' '.repeat(l.indent - 4) + l.text);
          }
          if (counts.errors === 1) model.errorCodes.push({ code: c.kw, line: c.line, file, cond });
        }
        break;
      }
      case 'req':
        readReq(s);
        break;
      case 'open': {
        const id = idAndTitle(s);
        const rec = { file, line: s.line, id, textLines: undefined as string[] | undefined, exampleLines: [] as number[] };
        model.opens.push(rec);
        clausesOf(s, ['text', 'example', 'table'], ['text'], (c) => {
          if (c.kw === 'text') rec.textLines = readText(c);
          else rec.exampleLines.push(c.line);
        });
        break;
      }
      case 'decision': {
        const id = idAndTitle(s);
        const rec: Decision = { file, line: s.line, id, rejected: [] };
        model.decisions.push(rec);
        clausesOf(s, ['source', 'status', 'text', 'rejected'], ['source', 'status', 'text'], (c) => {
          if (c.kw === 'source') {
            rec.source = c.rest;
            noLines(c);
          } else if (c.kw === 'status') {
            rec.status = c.rest;
            noLines(c);
          } else if (c.kw === 'text') rec.textLines = readText(c);
          else {
            const v = quoted(c.line, c.rest);
            if (v !== undefined) rec.rejected.push(v);
            noLines(c);
          }
        });
        break;
      }
      default:
        break; // type, edge, edgedef, property, evidence: the rest of the language
    }
  }

  // ---- version bookkeeping (REQ-RC-003)
  if (dur === 0) err(1, 'P020');
  if (fileVersion) versions.add(fileVersion);

  // ================================================================ op
  function readOp(s: Stmt) {
    const words = s.rest.split(/\s+/).filter(Boolean);
    if (words.length !== 1) err(s.line, 'P031');
    const op: Op = {
      file,
      line: s.line,
      name: words.length === 1 ? words[0] : '',
      fields: new Map(),
      tolerances: new Map(),
      audit: false,
    };
    model.ops.push(op);
    clausesOf(s, ['input', 'result', 'tolerance', 'audit', 'request', 'returns'], ['result', 'audit', 'request'], (c) => {
      switch (c.kw) {
        case 'input': {
          for (const part of splitFields(c.rest)) {
            const f = part.trim();
            const m = /^([A-Za-z0-9_-]+)(\?)?\s+(\S[\s\S]*)$/.exec(f);
            if (!m) err(c.line, 'P017');
            else if (op.fields.has(m[1])) err(c.line, 'P052');
            else op.fields.set(m[1], m[2] === '?');
          }
          noLines(c);
          break;
        }
        case 'result':
          op.resultText = c.rest;
          noLines(c);
          break;
        case 'tolerance': {
          const [path, num] = splitWord(c.rest);
          const n = path === '' ? undefined : finiteNumber(num);
          if (n === undefined || n < 0) err(c.line, 'P018');
          else if (op.tolerances.has(path)) err(c.line, 'P052');
          else op.tolerances.set(path, n === 0 ? 0 : n);
          noLines(c);
          break;
        }
        case 'audit':
          if (c.rest !== '' && c.rest !== 'text') err(c.line, 'P050');
          else op.audit = true;
          noLines(c);
          break;
        case 'request':
          op.request = readRequest(c);
          noLines(c);
          break;
        default:
          break; // returns: the rest of the language
      }
    });
  }

  // ================================================================ req
  function readReq(s: Stmt) {
    const id = idAndTitle(s);
    const req: Req = { file, line: s.line, id, platform: 'any', decisions: [], items: [], hasStatic: false };
    model.reqs.push(req);
    clausesOf(s, ['text', 'decision', 'on', 'example', 'table', 'static'], ['text', 'on'], (c) => {
      switch (c.kw) {
        case 'text':
          req.textLine = c.line;
          req.textLines = readText(c);
          break;
        case 'decision':
          for (const d of c.rest.split(/[\s,]+/)) if (d) req.decisions.push(d);
          noLines(c);
          break;
        case 'on':
          if (c.rest === 'any' || c.rest === 'posix' || c.rest === 'windows') req.platform = c.rest;
          else err(c.line, 'P033');
          noLines(c);
          break;
        case 'example':
          readExample(c, req);
          break;
        case 'table':
          readTable(c, req);
          break;
        default:
          req.hasStatic = true;
      }
    });
  }

  // ================================================================ example
  function readExample(c: Clause, req: Req) {
    const item: Item = {
      file,
      line: c.line,
      kind: 'example',
      raw: false,
      hasInputLines: false,
      omit: new Set(),
      expects: [],
      expectsError: false,
    };
    let valid = true;
    let inputObj: any = {};
    if (c.rest === '') {
      err(c.line, 'P012');
      valid = false;
    } else {
      const [w, after] = splitWord(c.rest);
      if (w === 'raw') {
        item.raw = true;
        let line: string | undefined;
        if (after.startsWith('"')) {
          const p = parseJson(after);
          if (p.ok && typeof p.value === 'string') line = p.value;
        } else if (after.length >= 2 && after.startsWith("'") && after.endsWith("'")) {
          line = after.slice(1, -1);
        }
        if (line === undefined) {
          err(c.line, 'P004');
          valid = false;
        } else if (/[\r\n]/.test(line)) {
          err(c.line, 'P026');
          valid = false;
        } else item.rawLine = line;
      } else {
        item.op = w;
        if (after !== '') {
          const p = parseJson(after);
          if (!p.ok || holdsBigNumber(p.value)) {
            err(c.line, 'P009');
            valid = false;
          } else if (!isPlainObject(p.value)) {
            err(c.line, 'P012');
            valid = false;
          } else {
            item.inputText = after;
            inputObj = p.value;
          }
        }
      }
    }

    let requestRead = false;
    const ls = c.lines;
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      if (l.blank) continue;
      if (l.indent !== 4) {
        if (!l.text.startsWith('#')) err(l.n, 'P006');
        continue;
      }
      if (l.text.startsWith('#')) continue;
      const [w, rest] = splitWord(l.text);
      switch (w) {
        case 'expect':
          readExpect(l, rest, item);
          break;
        case 'request':
          if (item.raw) err(l.n, 'P022');
          else if (requestRead) err(l.n, 'P052');
          else {
            const r = readRequest({ kw: 'request', rest, line: l.n, lines: [] });
            if (r !== undefined) {
              requestRead = true;
              item.request = r;
            }
          }
          break;
        case 'omit': {
          if (item.raw) {
            err(l.n, 'P022');
            break;
          }
          const names = rest.split(/[\s,]+/).filter(Boolean);
          if (names.length === 0) err(l.n, 'P011');
          for (const nm of names) item.omit.add(nm);
          break;
        }
        case 'input': {
          const fromM = FROM_RE.exec(l.text);
          // the text block: following lines that are blank or indented six or more
          let j = i + 1;
          const block: Ln[] = [];
          if (!fromM) {
            while (j < ls.length && (ls[j].blank || ls[j].indent >= 6)) block.push(ls[j++]);
            i = j - 1;
          }
          if (item.raw) {
            err(l.n, 'P022');
            break;
          }
          readInputLine(l, rest, fromM, block, item, inputObj, (v) => {
            inputObj = v;
          });
          break;
        }
        default:
          err(l.n, 'P011');
      }
    }
    if (item.hasInputLines) item.inputObj = inputObj;
    if (valid) req.items.push(item);
  }

  function readInputLine(
    l: Ln,
    rest: string,
    fromM: RegExpExecArray | null,
    block: Ln[],
    item: Item,
    inputObj: any,
    setInput: (v: any) => void,
  ) {
    const pathText = fromM ? fromM[1] : rest;
    const names = parsePath(pathText);
    if (!names) {
      err(l.n, 'P049');
      return;
    }
    let value: string;
    if (fromM) {
      const name = JSON.parse(fromM[2]) as string;
      const text = resolveFrom(name, file, model.recordDir, files);
      if (text === undefined) {
        err(l.n, 'P048');
        return;
      }
      value = text;
    } else value = '';
    // the path must run through objects
    let cur = inputObj;
    for (let k = 0; k < names.length - 1; k++) {
      if (!hasOwn(cur, names[k])) cur = null;
      else if (isPlainObject(cur[names[k]])) cur = cur[names[k]];
      else {
        err(l.n, 'P049');
        return;
      }
      if (cur === null) break;
    }
    if (!fromM) {
      const out: string[] = [];
      for (const b of block) out.push(b.blank ? '' : ' '.repeat(b.indent - 6) + b.text);
      while (out.length && out[out.length - 1] === '') out.pop();
      if (out.length === 0) {
        err(l.n, 'P049');
        return;
      }
      value = out.join('\n') + '\n';
    }
    // apply
    cur = inputObj;
    for (let k = 0; k < names.length - 1; k++) {
      if (!hasOwn(cur, names[k])) setOwn(cur, names[k], {});
      cur = cur[names[k]];
    }
    setOwn(cur, names[names.length - 1], value);
    item.hasInputLines = true;
    setInput(inputObj);
  }

  function readExpect(l: Ln, rest: string, item: Item) {
    const path = /^[^\s=≈~]*/.exec(rest)![0];
    if (path === '') {
      err(l.n, 'P011');
      return;
    }
    const after = rest.slice(path.length).trimStart();
    const ex: Expect = { line: l.n, path, kind: 'eq' };
    if (after[0] === '=') {
      const v = after.slice(1).trim();
      if (v === '?') ex.kind = 'oracle';
      else {
        const p = parseJson(v);
        if (!p.ok || holdsBigNumber(p.value)) {
          err(l.n, 'P009');
          return;
        }
        ex.value = p.value;
      }
    } else if (after[0] === '≈' || after[0] === '~') {
      const m = /^(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s*(?:±|\+-)\s*(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)$/.exec(
        after.slice(1).trim(),
      );
      const a = m ? finiteNumber(m[1]) : undefined;
      const t = m ? finiteNumber(m[2]) : undefined;
      if (a === undefined || t === undefined || t < 0) {
        err(l.n, 'P010');
        return;
      }
      ex.kind = 'approx';
      ex.value = a;
      ex.tol = t === 0 ? 0 : t;
    } else {
      err(l.n, 'P011');
      return;
    }
    item.expects.push(ex);
    if (path === 'error') item.expectsError = true;
  }

  // ================================================================ table
  function readTable(c: Clause, req: Req) {
    const rows: Ln[] = [];
    for (const l of c.lines) {
      if (l.blank) continue;
      if (l.indent >= 4 && l.text.startsWith('|')) rows.push(l);
      else if (!l.text.startsWith('#')) err(l.n, 'P006');
    }
    const isSep = (t: string) => /^\|([|\-:\s]*\|)?$/.test(t);
    const data = rows.filter((r) => !isSep(r.text));
    const opWords = c.rest.split(/\s+/).filter(Boolean);
    if (opWords.length !== 1 || data.length < 2) {
      err(c.line, 'P013');
      return;
    }
    const opName = opWords[0];
    const header = data[0];
    type Col = { name: string; kind: 'input' | 'expect'; tol?: number };
    const cols: Col[] = [];
    const names = new Set<string>();
    let bad = false;
    for (const cell of splitCells(header.text)) {
      let i = 0;
      while (i < cell.length && !/\s/.test(cell[i]) && cell[i] !== '±' && !(cell[i] === '+' && cell[i + 1] === '-')) i++;
      const name = cell.slice(0, i);
      const after = cell.slice(i).trimStart();
      let tolText: string | undefined;
      let form = name !== '';
      if (after !== '') {
        if (after.startsWith('±')) tolText = after.slice(1).trim();
        else if (after.startsWith('+-')) tolText = after.slice(2).trim();
        else form = false;
      }
      const isExpect = /^(?:result|audit|error|id)(?:\.[\s\S]*)?$/.test(name);
      const isInput = !isExpect && /^[A-Za-z0-9_-]+$/.test(name);
      if (!form || (!isExpect && !isInput) || names.has(name)) {
        err(header.n, 'P013');
        bad = true;
        break;
      }
      names.add(name);
      const col: Col = { name, kind: isExpect ? 'expect' : 'input' };
      if (tolText !== undefined) {
        const t = finiteNumber(tolText);
        if (t === undefined || t < 0 || !isExpect) err(header.n, 'P010');
        else col.tol = t === 0 ? 0 : t;
      }
      cols.push(col);
    }
    if (bad) return;
    for (const row of data.slice(1)) {
      const cells = splitCells(row.text);
      if (cells.length !== cols.length) {
        err(row.n, 'P014');
        continue;
      }
      const item: Item = {
        file,
        line: row.n,
        kind: 'row',
        raw: false,
        op: opName,
        hasInputLines: false,
        omit: new Set(),
        expects: [],
        expectsError: false,
        inputKeys: [],
      };
      const fields: string[] = [];
      for (let i = 0; i < cols.length; i++) {
        const cell = cells[i];
        if (cell === '') continue;
        const col = cols[i];
        if (col.kind === 'input') {
          const p = parseJson(cell);
          if (!p.ok || holdsBigNumber(p.value)) err(row.n, 'P009');
          else {
            fields.push(`"${col.name}":${cell}`);
            item.inputKeys!.push(col.name);
          }
          continue;
        }
        const ex: Expect = { line: row.n, path: col.name, kind: 'eq' };
        if (cell === '?') ex.kind = 'oracle';
        else if (col.tol !== undefined) {
          const n = finiteNumber(cell);
          if (n === undefined) {
            err(row.n, 'P010');
            continue;
          }
          ex.kind = 'approx';
          ex.value = n;
          ex.tol = col.tol;
        } else {
          const p = parseJson(cell);
          if (!p.ok || holdsBigNumber(p.value)) {
            err(row.n, 'P009');
            continue;
          }
          ex.value = p.value;
        }
        item.expects.push(ex);
        if (col.name === 'error') item.expectsError = true;
      }
      item.inputText = '{' + fields.join(',') + '}';
      req.items.push(item);
    }
  }
}

function splitCells(text: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let endedWithPipe = false;
  for (let i = 1; i < text.length; i++) {
    const ch = text[i];
    endedWithPipe = false;
    if (ch === '\\' && text[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cur);
      cur = '';
      endedWithPipe = true;
    } else cur += ch;
  }
  if (!endedWithPipe) cells.push(cur);
  return cells.map((c) => c.trim());
}

// Fields are separated by commas outside double quotes and brackets (REQ-SY-007).
function splitFields(s: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let inQ = false;
  let depth = 0;
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
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

// A path of an input line: names separated by dots, each a word or a JSON string.
function parsePath(s: string): string[] | undefined {
  const names: string[] = [];
  let i = 0;
  const WORD = /[A-Za-z0-9_-]/;
  while (true) {
    if (s[i] === '"') {
      const m = /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(s.slice(i));
      if (!m) return undefined;
      names.push(JSON.parse(m[0]));
      i += m[0].length;
    } else {
      const start = i;
      while (i < s.length && WORD.test(s[i])) i++;
      if (i === start) return undefined;
      names.push(s.slice(start, i));
    }
    if (i === s.length) return names;
    if (s[i] !== '.') return undefined;
    i++;
  }
}

// The text of the file a `from` name stands for, or undefined (REQ-SY-011).
function resolveFrom(
  name: string,
  fromFile: string,
  recordDir: string,
  files: Record<string, string>,
): string | undefined {
  const slash = fromFile.lastIndexOf('/');
  const parts = slash < 0 ? [] : fromFile.slice(0, slash).split('/');
  for (const p of name.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else parts.push(p);
  }
  const path = parts.join('/');
  if (path === '' || !hasOwn(files, path)) return undefined;
  if (recordDir !== '' && !path.startsWith(recordDir + '/')) return undefined;
  return files[path];
}
