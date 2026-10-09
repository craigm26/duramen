// Reading a record: lines, statements and clauses, and the P diagnostics (REQ-SY-001 to
// REQ-SY-013, REQ-RC-003, REQ-RC-004).

import { hasOwn, isObject, parseJson, parseNumber, parseTolerance, setOwn } from './json.ts';
import type { Obj } from './json.ts';
import type { Diag, Example, Expectation, Model, Op, Req } from './model.ts';

interface Line {
  n: number;
  indent: number;
  text: string;
  blank: boolean;
}

interface Clause {
  kw: string;
  rest: string;
  line: number;
  sub: Line[];
}

interface Stmt {
  kw: string;
  rest: string;
  line: number;
  clauses: Clause[];
}

const CORE = new Set(['duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note']);
const REST_OF_LANGUAGE = new Set(['type', 'edge', 'edgedef', 'property', 'evidence']);
const VERSIONS = new Set(['0.1', '0.2']);

const TAKES: Record<string, string[]> = {
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
  section: ['text'],
  open: ['text'],
  note: ['text'],
};

export function splitWord(s: string): { word: string; rest: string } {
  const m = /^(\S*)\s*([\s\S]*)$/.exec(s)!;
  return { word: m[1], rest: m[2] };
}

export function fileLines(text: string): string[] {
  if (text.startsWith('﻿')) text = text.slice(1);
  return text.split(/\r\n|\r|\n/);
}

export function dirname(name: string): string {
  const i = name.lastIndexOf('/');
  return i < 0 ? '' : name.slice(0, i);
}

export interface RecordInput {
  /** Every file of the request. */
  files: Obj;
  /** The record's files, in record order. */
  names: string[];
  /** The record's name, for record-level diagnostics. */
  name: string;
  /** The folder of the record ('' for the folder that holds all the files). */
  folder: string;
}

class Reader {
  diags: Diag[] = [];
  model: Model = {
    spec: null,
    oracle: null,
    ops: [],
    reqs: [],
    opens: [],
    openExamples: [],
    decisions: [],
    codes: [],
    prose: [],
  };
  rec: RecordInput;
  file = '';
  seenSpec = false;
  seenOracle = false;
  seenErrors = false;
  versions = new Set<string>();

  constructor(rec: RecordInput) {
    this.rec = rec;
  }

  p(line: number, code: string): void {
    this.diags.push({ file: this.file, line, level: 'error', code });
  }

  read(): void {
    for (const name of this.rec.names) {
      this.file = name;
      const text = this.rec.files[name] as string;
      const stmts = this.structure(text);
      let duramens = 0;
      for (const s of stmts) {
        if (s.kw === 'duramen') {
          duramens++;
          if (duramens > 1 || !VERSIONS.has(s.rest)) this.p(s.line, 'P023');
          else this.versions.add(s.rest);
        }
        this.statement(s);
      }
      if (duramens === 0) this.p(1, 'P020');
    }
    this.file = this.rec.name;
    if (!this.seenSpec) this.p(1, 'P021');
    if (this.versions.size > 1) this.p(1, 'P047');
  }

  structure(text: string): Stmt[] {
    const stmts: Stmt[] = [];
    let cur: Stmt | null = null;
    let ignoring = false;
    let clause: Clause | null = null;
    const lines = fileLines(text);
    for (let i = 0; i < lines.length; i++) {
      const n = i + 1;
      const t = lines[i].replace(/\s+$/, '');
      if (t === '') {
        if (cur && !ignoring && clause) clause.sub.push({ n, indent: 0, text: '', blank: true });
        continue;
      }
      const lead = /^\s*/.exec(t)![0];
      if (/[^ ]/.test(lead)) {
        this.p(n, 'P001');
        continue;
      }
      const indent = lead.length;
      const content = t.slice(indent);
      if (indent === 0) {
        if (content.startsWith('#')) continue;
        const { word, rest } = splitWord(content);
        clause = null;
        cur = { kw: word, rest, line: n, clauses: [] };
        ignoring = !CORE.has(word);
        if (!ignoring) stmts.push(cur);
        else if (!REST_OF_LANGUAGE.has(word)) this.p(n, 'P002');
        continue;
      }
      if (!cur) {
        this.p(n, 'P003');
        continue;
      }
      if (ignoring) continue;
      if (indent === 1) {
        this.p(n, 'P007');
        continue;
      }
      if (indent === 2) {
        if (content.startsWith('#')) continue;
        const { word, rest } = splitWord(content);
        clause = { kw: word, rest, line: n, sub: [] };
        cur.clauses.push(clause);
        continue;
      }
      if (!clause) {
        this.p(n, 'P006');
        continue;
      }
      clause.sub.push({ n, indent, text: content, blank: false });
    }
    return stmts;
  }

  statement(s: Stmt): void {
    switch (s.kw) {
      case 'duramen':
        break;
      case 'spec': {
        if (s.rest.split(/\s+/).filter((w) => w !== '').length !== 2) this.p(s.line, 'P021');
        if (this.seenSpec) this.p(s.line, 'P044');
        break;
      }
      case 'oracle':
        if (s.rest === '') this.p(s.line, 'P028');
        if (this.seenOracle) this.p(s.line, 'P044');
        break;
      case 'errors':
        if (s.rest !== '') this.p(s.line, 'P050');
        if (this.seenErrors) this.p(s.line, 'P032');
        return this.errors(s);
      case 'op':
        if (s.rest === '' || /\s/.test(s.rest)) this.p(s.line, 'P031');
        break;
      case 'note':
        if (s.rest !== '') this.p(s.line, 'P050');
        break;
      default:
        this.idAndTitle(s);
    }
    this.clauses(s);
  }

  idAndTitle(s: Stmt): string {
    const { word, rest } = splitWord(s.rest);
    if (word === '' || rest.length < 2 || !rest.startsWith('"') || !rest.endsWith('"')) {
      this.p(s.line, 'P005');
    } else {
      const t = parseJson(rest);
      if (!t.ok || typeof t.value !== 'string') this.p(s.line, 'P004');
    }
    return word;
  }

  /** P006 for every line under a clause that takes none. */
  noLines(c: Clause): void {
    for (const l of c.sub) if (!l.blank && !l.text.startsWith('#')) this.p(l.n, 'P006');
  }

  text(c: Clause): string[] {
    if (c.rest !== '') this.p(c.line, 'P008');
    const out: string[] = [];
    for (const l of c.sub) {
      if (l.blank) out.push('');
      else if (l.indent === 3) this.p(l.n, 'P008');
      else out.push(' '.repeat(l.indent - 4) + l.text);
    }
    while (out.length > 0 && out[0] === '') out.shift();
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    return out;
  }

  /** A `request` value (REQ-SY-004): an object that sets no id, op or input. */
  requestValue(text: string, line: number): Obj | null {
    const v = parseJson(text);
    if (!v.ok || !isObject(v.value)) {
      this.p(line, 'P009');
      return null;
    }
    if (hasOwn(v.value, 'id') || hasOwn(v.value, 'op') || hasOwn(v.value, 'input')) {
      this.p(line, 'P051');
      return null;
    }
    return v.value;
  }

  errors(s: Stmt): void {
    const first = !this.seenErrors;
    this.seenErrors = true;
    for (const c of s.clauses) {
      const { word, rest } = splitWord(c.rest);
      if (word !== 'when' || rest === '') this.p(c.line, 'P019');
      const lines = [rest];
      for (const l of c.sub) {
        if (l.blank) continue;
        if (l.indent === 3) this.p(l.n, 'P006');
        else lines.push(l.text);
      }
      if (first) this.model.codes.push(c.kw);
      this.model.prose.push({ file: this.file, line: c.line, lines, warning: false });
    }
  }

  clauses(s: Stmt): void {
    const takes = TAKES[s.kw];
    const once = ONCE[s.kw] ?? [];
    const seen = new Set<string>();
    const file = this.file;
    let op: Op | null = null;
    let req: Req | null = null;
    let decision: { id: string; source: string | null; status: string | null } | null = null;
    const fieldNames = new Set<string>();
    const tolerancePaths = new Set<string>();
    let specRequest: Obj | null = null;

    if (s.kw === 'op') {
      op = { name: s.rest, file, line: s.line, fields: [], tolerances: {}, audit: false, request: null };
      this.model.ops.push(op);
    } else if (s.kw === 'req') {
      const id = splitWord(s.rest).word;
      req = { id, file, line: s.line, platform: 'any', decisions: [], text: null, examples: [] };
      this.model.reqs.push(req);
    } else if (s.kw === 'open') {
      this.model.opens.push({ id: splitWord(s.rest).word, file, line: s.line });
    } else if (s.kw === 'decision') {
      decision = { id: splitWord(s.rest).word, source: null, status: null };
    }

    for (const c of s.clauses) {
      if (!takes.includes(c.kw)) {
        this.p(c.line, 'P015');
        continue;
      }
      if (once.includes(c.kw)) {
        if (seen.has(c.kw)) {
          this.p(c.line, 'P052');
          continue;
        }
        seen.add(c.kw);
      }
      const key = `${s.kw}.${c.kw}`;
      if (c.kw === 'text') {
        const lines = this.text(c);
        if (s.kw === 'req') req!.text = { line: c.line, lines };
        else this.model.prose.push({ file, line: s.line, lines, warning: s.kw === 'open' });
        continue;
      }
      if (key === 'req.example' || key === 'req.table') {
        const examples = c.kw === 'example' ? this.example(c) : this.table(c);
        req!.examples.push(...examples);
        continue;
      }
      if (key === 'open.example' || key === 'open.table') {
        this.model.openExamples.push({ file, line: c.line });
        continue;
      }
      this.noLines(c);
      switch (key) {
        case 'spec.title':
        case 'decision.rejected': {
          const t = parseJson(c.rest);
          if (!t.ok || typeof t.value !== 'string') this.p(c.line, 'P004');
          else if (key === 'decision.rejected') {
            this.model.prose.push({ file, line: s.line, lines: t.value.split(/\r\n|\r|\n/), warning: false });
          }
          break;
        }
        case 'spec.request':
          specRequest = this.requestValue(c.rest, c.line);
          break;
        case 'op.request':
          op!.request = this.requestValue(c.rest, c.line);
          break;
        case 'op.result':
          this.model.prose.push({ file, line: s.line, lines: [c.rest], warning: false });
          break;
        case 'op.audit':
          if (c.rest === '' || c.rest === 'text') op!.audit = true;
          else this.p(c.line, 'P050');
          break;
        case 'op.input':
          for (const f of splitFields(c.rest)) {
            const m = /^([A-Za-z0-9_-]+)(\??)\s+\S[\s\S]*$/.exec(f);
            if (!m) {
              this.p(c.line, 'P017');
            } else if (fieldNames.has(m[1])) {
              this.p(c.line, 'P052');
            } else {
              fieldNames.add(m[1]);
              op!.fields.push({ name: m[1], optional: m[2] === '?' });
            }
          }
          break;
        case 'op.tolerance': {
          const { word, rest } = splitWord(c.rest);
          const tol = parseTolerance(rest);
          if (word === '' || tol === null) this.p(c.line, 'P018');
          else if (tolerancePaths.has(word)) this.p(c.line, 'P052');
          else {
            tolerancePaths.add(word);
            setOwn(op!.tolerances, word, tol);
          }
          break;
        }
        case 'req.decision':
          req!.decisions.push(...c.rest.split(/[\s,]+/).filter((w) => w !== ''));
          break;
        case 'req.on':
          if (c.rest === 'any' || c.rest === 'posix' || c.rest === 'windows') req!.platform = c.rest;
          else this.p(c.line, 'P033');
          break;
        case 'decision.source':
          decision!.source = c.rest === '' ? null : c.rest;
          break;
        case 'decision.status':
          decision!.status = c.rest;
          break;
        default:
          // spec.contract, oracle.source: nothing to check.
          break;
      }
    }

    if (s.kw === 'spec' && !this.seenSpec) {
      this.seenSpec = true;
      this.model.spec = { file, line: s.line, request: specRequest };
    }
    if (s.kw === 'oracle' && !this.seenOracle) {
      this.seenOracle = true;
      this.model.oracle = { file, line: s.line, command: s.rest };
    }
    if (decision) this.model.decisions.push({ ...decision, file, line: s.line });
  }

  /** REQ-SY-010 and REQ-SY-011. */
  example(c: Clause): Example[] {
    let dropped = false;
    let raw = false;
    let rawLine: string | null = null;
    let op: string | null = null;
    let inputText: string | null = null;
    let input: Obj | undefined;
    if (c.rest === '') {
      this.p(c.line, 'P012');
      dropped = true;
    } else {
      const { word, rest } = splitWord(c.rest);
      op = word;
      if (word === 'raw') {
        raw = true;
        op = null;
        if (rest.startsWith('"')) {
          const v = parseJson(rest);
          if (v.ok && typeof v.value === 'string') rawLine = v.value;
        } else if (rest.length >= 2 && rest.startsWith("'") && rest.endsWith("'")) {
          rawLine = rest.slice(1, -1);
        }
        if (rawLine === null) this.p(c.line, 'P004');
        else if (/[\r\n]/.test(rawLine)) {
          this.p(c.line, 'P026');
          rawLine = null;
        }
        if (rawLine === null) dropped = true;
      } else if (rest !== '') {
        const v = parseJson(rest);
        if (!v.ok) {
          this.p(c.line, 'P009');
          dropped = true;
        } else if (!isObject(v.value)) {
          this.p(c.line, 'P012');
          dropped = true;
        } else {
          inputText = rest;
          input = v.value;
        }
      }
    }

    const work: Obj = input ? (JSON.parse(inputText!) as Obj) : {};
    let hasInputLines = false;
    let request: Obj | null = null;
    let requestRead = false;
    const omit = new Set<string>();
    const expects: Expectation[] = [];
    const sub = c.sub;
    let i = 0;
    while (i < sub.length) {
      const l = sub[i++];
      if (l.blank || l.text.startsWith('#')) continue;
      if (l.indent !== 4) {
        this.p(l.n, 'P006');
        continue;
      }
      const { word, rest } = splitWord(l.text);
      if (word === 'expect') {
        const e = this.expect(rest, l.n);
        if (e) expects.push(e);
      } else if (word === 'request') {
        if (raw) this.p(l.n, 'P022');
        else if (requestRead) this.p(l.n, 'P052');
        else {
          request = this.requestValue(rest, l.n);
          if (request) requestRead = true;
        }
      } else if (word === 'omit') {
        const names = rest.split(/[\s,]+/).filter((w) => w !== '');
        if (raw) this.p(l.n, 'P022');
        else if (names.length === 0) this.p(l.n, 'P011');
        else for (const n of names) omit.add(n);
      } else if (word === 'input') {
        const from = /^(?:([\s\S]*?)\s+)?from\s*("(?:[^"\\]|\\[\s\S])*")$/.exec(rest);
        let fromName: string | null = null;
        let pathText = rest;
        if (from) {
          const q = parseJson(from[2]);
          if (q.ok && typeof q.value === 'string') {
            fromName = q.value;
            pathText = from[1] ?? '';
          }
        }
        const textLines: string[] = [];
        if (fromName === null) {
          while (i < sub.length && (sub[i].blank || sub[i].indent >= 6)) {
            const t = sub[i++];
            textLines.push(t.blank ? '' : ' '.repeat(t.indent - 6) + t.text);
          }
          while (textLines.length > 0 && textLines[textLines.length - 1] === '') textLines.pop();
        }
        if (raw) {
          this.p(l.n, 'P022');
          continue;
        }
        const path = parseInputPath(pathText);
        if (!path) {
          this.p(l.n, 'P049');
          continue;
        }
        let value: string;
        if (fromName !== null) {
          const target = this.resolveFrom(fromName);
          if (target === null) {
            this.p(l.n, 'P048');
            continue;
          }
          value = this.rec.files[target] as string;
        } else {
          value = textLines.map((t) => t + '\n').join('');
        }
        if (!throughObjects(work, path)) {
          this.p(l.n, 'P049');
          continue;
        }
        if (fromName === null && textLines.length === 0) {
          this.p(l.n, 'P049');
          continue;
        }
        put(work, path, value);
        hasInputLines = true;
      } else {
        this.p(l.n, 'P011');
      }
    }
    if (dropped) return [];
    return [
      {
        file: this.file,
        line: c.line,
        op,
        rawLine,
        inputText,
        input: hasInputLines || input ? work : undefined,
        hasInputLines,
        request,
        omit,
        expects,
      },
    ];
  }

  expect(rest: string, line: number): Expectation | null {
    const path = /^[^\s=≈~]*/.exec(rest)![0];
    const after = rest.slice(path.length).trimStart();
    if (path === '') {
      this.p(line, 'P011');
      return null;
    }
    if (after.startsWith('=')) {
      const v = after.slice(1).trim();
      if (v === '?') return { line, path, kind: 'oracle' };
      const j = parseJson(v);
      if (!j.ok) {
        this.p(line, 'P009');
        return null;
      }
      return { line, path, kind: 'eq', value: j.value };
    }
    if (after.startsWith('≈') || after.startsWith('~')) {
      const a = parseApprox(after.slice(1));
      if (!a) {
        this.p(line, 'P010');
        return null;
      }
      return { line, path, kind: 'approx', value: a.value, tol: a.tol };
    }
    this.p(line, 'P011');
    return null;
  }

  /** The request file a `from` name reads, or null when it is none of the record's folder (P048). */
  resolveFrom(name: string): string | null {
    const parts = dirname(this.file).split('/').filter((p) => p !== '');
    for (const p of name.split('/')) {
      if (p === '' || p === '.') continue;
      if (p === '..') {
        if (parts.length === 0) return null;
        parts.pop();
      } else parts.push(p);
    }
    const target = parts.join('/');
    if (!hasOwn(this.rec.files, target)) return null;
    const folder = this.rec.folder;
    if (folder !== '' && !target.startsWith(folder + '/')) return null;
    return target;
  }

  /** REQ-SY-012. */
  table(c: Clause): Example[] {
    const rows: Line[] = [];
    for (const l of c.sub) {
      if (l.blank) continue;
      if (l.text.startsWith('|')) {
        if (l.indent >= 4) rows.push(l);
        else this.p(l.n, 'P006');
      } else if (!l.text.startsWith('#')) this.p(l.n, 'P006');
    }
    const op = c.rest;
    const body = rows.filter((r) => !isSeparator(r.text));
    if (op === '' || /\s/.test(op) || body.length < 2) {
      this.p(c.line, 'P013');
      return [];
    }
    const header = body[0];
    const columns: { name: string; field: boolean; tol: number | null }[] = [];
    for (const cell of splitRow(header.text)) {
      const col = headerCell(cell);
      if (!col || columns.some((k) => k.name === col.name)) {
        this.p(header.n, 'P013');
        return [];
      }
      let tol: number | null = null;
      if (col.tol !== null) {
        const t = parseTolerance(col.tol);
        if (col.field || t === null) this.p(header.n, 'P010');
        else tol = t;
      }
      columns.push({ name: col.name, field: col.field, tol });
    }
    const out: Example[] = [];
    for (const row of body.slice(1)) {
      const cells = splitRow(row.text);
      if (cells.length !== columns.length) {
        this.p(row.n, 'P014');
        continue;
      }
      let ok = true;
      const inputs: string[] = [];
      const expects: Expectation[] = [];
      cells.forEach((cell, j) => {
        if (cell === '') return;
        const col = columns[j];
        if (col.field) {
          if (!parseJson(cell).ok) {
            this.p(row.n, 'P009');
            ok = false;
          } else inputs.push(`"${col.name}":${cell}`);
        } else if (cell === '?') {
          expects.push({ line: row.n, path: col.name, kind: 'oracle' });
        } else if (col.tol !== null) {
          const n = parseNumber(cell);
          if (n === null) {
            this.p(row.n, 'P010');
            ok = false;
          } else expects.push({ line: row.n, path: col.name, kind: 'approx', value: n, tol: col.tol });
        } else {
          const v = parseJson(cell);
          if (!v.ok) {
            this.p(row.n, 'P009');
            ok = false;
          } else expects.push({ line: row.n, path: col.name, kind: 'eq', value: v.value });
        }
      });
      if (!ok) continue;
      const inputText = `{${inputs.join(',')}}`;
      out.push({
        file: this.file,
        line: row.n,
        op,
        rawLine: null,
        inputText,
        input: JSON.parse(inputText) as Obj,
        hasInputLines: false,
        request: null,
        omit: new Set(),
        expects,
      });
    }
    return out;
  }
}

/** Splits an `input` clause into fields at commas outside quotes and brackets (REQ-SY-007). */
export function splitFields(s: string): string[] {
  const out: string[] = [];
  // How many of each opener are still open; a closer with none open is an ordinary character.
  const open: Record<string, number> = { '(': 0, '[': 0, '{': 0 };
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  let quoted = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      cur += ch;
      if (ch === '\\' && i + 1 < s.length) cur += s[++i];
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch in open) open[ch]++;
    else if (ch in pairs) {
      if (open[pairs[ch]] > 0) open[pairs[ch]]--;
    } else if (ch === ',' && open['('] + open['['] + open['{'] === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseApprox(s: string): { value: number; tol: number } | null {
  const a = s.indexOf('±');
  const b = s.indexOf('+-');
  let at: number;
  let len: number;
  if (a < 0 && b < 0) return null;
  if (b < 0 || (a >= 0 && a < b)) {
    at = a;
    len = 1;
  } else {
    at = b;
    len = 2;
  }
  const value = parseNumber(s.slice(0, at).trim());
  const tol = parseTolerance(s.slice(at + len).trim());
  if (value === null || tol === null) return null;
  return { value, tol };
}

/** An input path (REQ-SY-011): words or quoted strings separated by dots, or null. */
export function parseInputPath(s: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    let m: RegExpExecArray | null;
    const tail = s.slice(i);
    if ((m = /^[A-Za-z0-9_-]+/.exec(tail))) {
      out.push(m[0]);
    } else if ((m = /^"(?:[^"\\]|\\[\s\S])*"/.exec(tail))) {
      const v = parseJson(m[0]);
      if (!v.ok || typeof v.value !== 'string') return null;
      out.push(v.value);
    } else return null;
    i += m[0].length;
    if (i === s.length) return out;
    if (s[i] !== '.') return null;
    i++;
  }
}

function throughObjects(root: Obj, path: string[]): boolean {
  let cur: Obj = root;
  for (const k of path.slice(0, -1)) {
    if (!hasOwn(cur, k)) return true;
    const v = cur[k];
    if (!isObject(v)) return false;
    cur = v;
  }
  return true;
}

function put(root: Obj, path: string[], value: string): void {
  let cur: Obj = root;
  for (const k of path.slice(0, -1)) {
    if (!hasOwn(cur, k)) setOwn(cur, k, {});
    cur = cur[k] as Obj;
  }
  setOwn(cur, path[path.length - 1], value);
}

export function isSeparator(row: string): boolean {
  return /^\|(?:[\s|:-]*\|)?$/.test(row);
}

/** The cells of a table row: `\|` is a `|` in a cell, and the closing `|` may be left out. */
export function splitRow(row: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let endsWithBar = false;
  for (let i = 1; i < row.length; i++) {
    const ch = row[i];
    endsWithBar = false;
    if (ch === '\\' && row[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cur);
      cur = '';
      endsWithBar = true;
    } else cur += ch;
  }
  if (!endsWithBar) cells.push(cur);
  return cells.map((c) => c.trim());
}

const EXPECTATION_PATH = /^(?:result|audit|error|id)(?:\.[\s\S]*)?$/;

function headerCell(cell: string): { name: string; field: boolean; tol: string | null } | null {
  const ends = [cell.search(/\s/), cell.indexOf('±'), cell.indexOf('+-')].filter((x) => x >= 0);
  const at = ends.length > 0 ? Math.min(...ends) : cell.length;
  const name = cell.slice(0, at);
  const after = cell.slice(at).trimStart();
  let tol: string | null = null;
  if (after.startsWith('±')) tol = after.slice(1).trim();
  else if (after.startsWith('+-')) tol = after.slice(2).trim();
  else if (after !== '') return null;
  if (name === '') return null;
  if (EXPECTATION_PATH.test(name)) return { name, field: false, tol };
  if (/^[A-Za-z0-9_-]+$/.test(name)) return { name, field: true, tol };
  return null;
}

export function readRecord(rec: RecordInput): { diags: Diag[]; model: Model } {
  const r = new Reader(rec);
  r.read();
  return { diags: r.diags, model: r.model };
}
