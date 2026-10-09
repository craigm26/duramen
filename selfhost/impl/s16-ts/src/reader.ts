// Reading the files of a record (REQ-RC-003, REQ-RC-004, REQ-SY-001 to REQ-SY-013).

import type { Diag, Example, Expectation, Op, Req, RecordModel } from './model.ts';
import {
  JSON_NUMBER,
  hasNonFinite,
  hasOwn,
  isObject,
  parseJson,
  parseNumber,
  setMember,
  splitWord,
  words,
  type Json,
  type JsonObject,
} from './util.ts';

interface Line {
  num: number;
  indent: number;
  /** The line after its indent, without white space at its end. */
  text: string;
  blank: boolean;
}

interface Clause {
  line: number;
  kw: string;
  rest: string;
  /** Blank lines and lines indented three or more, up to the next clause or statement. */
  sub: Line[];
}

interface Stmt {
  line: number;
  kw: string;
  rest: string;
  clauses: Clause[];
  ignored: boolean;
}

const VERSIONS = new Set(['0.1', '0.2']);
const CORE = new Set(['duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note']);
const REST_OF_LANGUAGE = new Set(['type', 'edge', 'edgedef', 'property', 'evidence']);
const EXPECTATION_PATH = /^(?:result|audit|error|id)(?:\.[^]*)?$/;
const NAME = /^[A-Za-z0-9_-]+$/;
const PLATFORMS = new Set(['any', 'posix', 'windows']);

type Handler = (c: Clause) => void;

export class Reader {
  readonly rec: RecordModel;
  readonly diags: Diag[];
  readonly allFiles: Record<string, string>;
  private file = '';
  private sawErrors = false;
  private versions = new Set<string>();

  constructor(rec: RecordModel, allFiles: Record<string, string>, diags: Diag[]) {
    this.rec = rec;
    this.allFiles = allFiles;
    this.diags = diags;
  }

  private p(line: number, code: string): void {
    this.diags.push({ file: this.file, line, level: 'error', code });
  }

  /** Reads every file of the record, then the problems of the record as a whole. */
  readAll(): void {
    for (const f of this.rec.files) this.readFile(f, this.allFiles[f]);
    if (!this.rec.spec) this.diags.push({ file: this.rec.name, line: 1, level: 'error', code: 'P021' });
    if (this.versions.size > 1) this.diags.push({ file: this.rec.name, line: 1, level: 'error', code: 'P047' });
  }

  private lines(content: string): Line[] {
    const text = content.startsWith('﻿') ? content.slice(1) : content;
    const out: Line[] = [];
    text.split(/\r\n|\r|\n/).forEach((raw, i) => {
      // trimEnd removes exactly what ECMAScript's \s matches, without backtracking.
      const trimmed = raw.trimEnd();
      if (trimmed === '') {
        out.push({ num: i + 1, indent: 0, text: '', blank: true });
        return;
      }
      const lead = /^\s*/.exec(trimmed)![0];
      if (/[^ ]/.test(lead)) {
        this.p(i + 1, 'P001');
        return;
      }
      out.push({ num: i + 1, indent: lead.length, text: trimmed.slice(lead.length), blank: false });
    });
    return out;
  }

  private statements(lines: Line[]): Stmt[] {
    const stmts: Stmt[] = [];
    let stmt: Stmt | undefined;
    let clause: Clause | undefined;
    for (const l of lines) {
      if (l.blank) {
        if (clause) clause.sub.push(l);
        continue;
      }
      if (l.indent === 0) {
        if (l.text.startsWith('#')) continue;
        const [kw, rest] = splitWord(l.text);
        const known = CORE.has(kw) || REST_OF_LANGUAGE.has(kw);
        if (!known) this.p(l.num, 'P002');
        stmt = { line: l.num, kw, rest, clauses: [], ignored: !CORE.has(kw) };
        stmts.push(stmt);
        clause = undefined;
        continue;
      }
      if (!stmt) {
        this.p(l.num, 'P003');
        continue;
      }
      if (stmt.ignored) continue;
      if (l.indent === 1) {
        this.p(l.num, 'P007');
        continue;
      }
      if (l.indent === 2) {
        if (l.text.startsWith('#')) continue;
        const [kw, rest] = splitWord(l.text);
        clause = { line: l.num, kw, rest, sub: [] };
        stmt.clauses.push(clause);
        continue;
      }
      if (!clause) {
        this.p(l.num, 'P006');
        continue;
      }
      clause.sub.push(l);
    }
    return stmts;
  }

  private readFile(name: string, content: string): void {
    this.file = name;
    let sawDuramen = false;
    for (const s of this.statements(this.lines(content))) {
      if (s.ignored) continue;
      switch (s.kw) {
        case 'duramen':
          if (sawDuramen) this.p(s.line, 'P023');
          else {
            sawDuramen = true;
            if (VERSIONS.has(s.rest)) this.versions.add(s.rest);
            else this.p(s.line, 'P023');
          }
          this.clauses(s, {}, []);
          break;
        case 'spec':
          this.spec(s);
          break;
        case 'oracle':
          this.oracle(s);
          break;
        case 'op':
          this.op(s);
          break;
        case 'errors':
          this.errors(s);
          break;
        case 'req':
          this.req(s);
          break;
        case 'open':
          this.open(s);
          break;
        case 'decision':
          this.decision(s);
          break;
        case 'section':
          this.titled(s);
          this.clauses(s, { text: (c) => this.prose(s.line, this.text(c), 'T004') }, ['text']);
          break;
        case 'note':
          if (s.rest !== '') this.p(s.line, 'P050');
          this.clauses(s, { text: (c) => this.prose(s.line, this.text(c), 'T004') }, ['text']);
          break;
      }
    }
    if (!sawDuramen) this.p(1, 'P020');
  }

  private clauses(s: Stmt, handlers: Record<string, Handler>, once: string[]): void {
    const seen = new Set<string>();
    for (const c of s.clauses) {
      if (!hasOwn(handlers, c.kw)) {
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
      handlers[c.kw](c);
    }
  }

  /** A clause that takes no lines of its own. */
  private noLines(c: Clause): void {
    for (const l of c.sub) if (!l.blank && !l.text.startsWith('#')) this.p(l.num, 'P006');
  }

  /** A `text` clause (REQ-SY-005). */
  private text(c: Clause): string[] {
    if (c.rest !== '') this.p(c.line, 'P008');
    const out: string[] = [];
    for (const l of c.sub) {
      if (l.blank) out.push('');
      else if (l.indent === 3) this.p(l.num, 'P008');
      else out.push(' '.repeat(l.indent - 4) + l.text);
    }
    while (out.length && out[0] === '') out.shift();
    while (out.length && out[out.length - 1] === '') out.pop();
    return out;
  }

  private prose(line: number, lines: string[], code: 'T004' | 'T014'): void {
    this.rec.prose.push({ file: this.file, line, lines, code });
  }

  private quoted(c: Clause): string | undefined {
    const v = parseJson(c.rest);
    if (!v || typeof v.value !== 'string') {
      this.p(c.line, 'P004');
      return undefined;
    }
    return v.value;
  }

  /** `<ID> "<title>"` of section, req, open and decision; answers the ID. */
  private titled(s: Stmt): string {
    const [id, title] = splitWord(s.rest);
    if (title.length < 2 || !title.startsWith('"') || !title.endsWith('"')) this.p(s.line, 'P005');
    else {
      const v = parseJson(title);
      if (!v || typeof v.value !== 'string') this.p(s.line, 'P004');
    }
    return id;
  }

  /** A `request <JSON object>` clause or line; answers the members, or undefined. */
  private requestMembers(text: string, line: number): JsonObject | undefined {
    const v = parseJson(text);
    if (!v || hasNonFinite(v.value) || !isObject(v.value)) {
      this.p(line, 'P009');
      return undefined;
    }
    if (hasOwn(v.value, 'id') || hasOwn(v.value, 'op') || hasOwn(v.value, 'input')) {
      this.p(line, 'P051');
      return undefined;
    }
    return v.value;
  }

  private spec(s: Stmt): void {
    if (words(s.rest).length !== 2) this.p(s.line, 'P021');
    const first = !this.rec.spec;
    if (first) this.rec.spec = { file: this.file, line: s.line };
    else this.p(s.line, 'P044');
    this.clauses(
      s,
      {
        title: (c) => {
          this.quoted(c);
          this.noLines(c);
        },
        text: (c) => this.prose(s.line, this.text(c), 'T004'),
        contract: (c) => this.noLines(c),
        request: (c) => {
          const m = this.requestMembers(c.rest, c.line);
          if (first && m) this.rec.specRequest = m;
          this.noLines(c);
        },
      },
      ['title', 'contract', 'request', 'text'],
    );
  }

  private oracle(s: Stmt): void {
    if (s.rest === '') this.p(s.line, 'P028');
    if (this.rec.oracle) this.p(s.line, 'P044');
    else this.rec.oracle = { file: this.file, line: s.line, command: s.rest };
    this.clauses(s, { source: (c) => this.noLines(c) }, []);
  }

  private op(s: Stmt): void {
    const w = words(s.rest);
    if (w.length !== 1) this.p(s.line, 'P031');
    const op: Op = {
      file: this.file,
      line: s.line,
      name: w.length === 1 ? w[0] : undefined,
      fields: new Map(),
      tolerances: new Map(),
      audit: false,
    };
    this.rec.ops.push(op);
    this.clauses(
      s,
      {
        input: (c) => {
          for (const f of splitFields(c.rest)) {
            const m = /^([A-Za-z0-9_-]+)(\?)?\s+\S[^]*$/.exec(f.trim());
            if (!m) this.p(c.line, 'P017');
            else if (op.fields.has(m[1])) this.p(c.line, 'P052');
            else op.fields.set(m[1], m[2] === '?');
          }
          this.noLines(c);
        },
        result: (c) => {
          this.prose(s.line, [c.rest], 'T004');
          this.noLines(c);
        },
        tolerance: (c) => {
          const [path, num] = splitWord(c.rest);
          const n = parseNumber(num);
          if (path === '' || n === undefined || n < 0) this.p(c.line, 'P018');
          else if (op.tolerances.has(path)) this.p(c.line, 'P052');
          else op.tolerances.set(path, n === 0 ? 0 : n);
          this.noLines(c);
        },
        audit: (c) => {
          if (c.rest !== '' && c.rest !== 'text') this.p(c.line, 'P050');
          op.audit = true;
          this.noLines(c);
        },
        request: (c) => {
          op.request = this.requestMembers(c.rest, c.line) ?? {};
          this.noLines(c);
        },
      },
      ['result', 'audit', 'request'],
    );
  }

  private errors(s: Stmt): void {
    if (s.rest !== '') this.p(s.line, 'P050');
    if (this.sawErrors) this.p(s.line, 'P032');
    this.sawErrors = true;
    for (const c of s.clauses) {
      const [w, after] = splitWord(c.rest);
      if (w !== 'when' || after === '') this.p(c.line, 'P019');
      this.rec.codes.push(c.kw);
      const lines = [w === 'when' ? after : c.rest];
      for (const l of c.sub) {
        if (l.blank) continue;
        if (l.indent === 3) this.p(l.num, 'P006');
        else lines.push(l.text);
      }
      this.prose(c.line, lines, 'T004');
    }
  }

  private req(s: Stmt): void {
    const id = this.titled(s);
    const req: Req = { file: this.file, line: s.line, id, platform: 'any', cited: [], examples: [] };
    this.rec.reqs.push(req);
    this.clauses(
      s,
      {
        text: (c) => {
          req.text = { line: c.line, lines: this.text(c) };
        },
        decision: (c) => {
          req.cited.push(...c.rest.split(/[\s,]+/).filter((x) => x !== ''));
          this.noLines(c);
        },
        on: (c) => {
          if (PLATFORMS.has(c.rest)) req.platform = c.rest;
          else this.p(c.line, 'P033');
          this.noLines(c);
        },
        example: (c) => this.example(c, req),
        table: (c) => this.table(c, req),
      },
      ['text', 'on'],
    );
  }

  private open(s: Stmt): void {
    const id = this.titled(s);
    this.rec.opens.push({ file: this.file, line: s.line, id });
    const t003 = (c: Clause) => this.rec.openExamples.push({ file: this.file, line: c.line });
    this.clauses(
      s,
      { text: (c) => this.prose(s.line, this.text(c), 'T014'), example: t003, table: t003 },
      ['text'],
    );
  }

  private decision(s: Stmt): void {
    const id = this.titled(s);
    const d = { file: this.file, line: s.line, id, hasSource: false, status: undefined as string | undefined };
    this.rec.decisions.push(d);
    this.clauses(
      s,
      {
        source: (c) => {
          if (c.rest !== '') d.hasSource = true;
          this.noLines(c);
        },
        status: (c) => {
          d.status = c.rest;
          this.noLines(c);
        },
        text: (c) => this.prose(s.line, this.text(c), 'T004'),
        rejected: (c) => {
          const v = this.quoted(c);
          if (v !== undefined) this.prose(s.line, [v], 'T004');
          this.noLines(c);
        },
      },
      ['source', 'status', 'text'],
    );
  }

  /** An `example` clause (REQ-SY-010, REQ-SY-011). */
  private example(c: Clause, req: Req): void {
    let dropped = false;
    let raw = false;
    let rawLine: string | undefined;
    let op: string | undefined;
    let inputText: string | undefined;
    let input: JsonObject = {};
    if (c.rest === '') {
      this.p(c.line, 'P012');
      dropped = true;
    } else {
      const [w, after] = splitWord(c.rest);
      if (w === 'raw') {
        raw = true;
        if (after.startsWith('"')) {
          const v = parseJson(after);
          if (v && typeof v.value === 'string') rawLine = v.value;
        } else if (after.length >= 2 && after.startsWith("'") && after.endsWith("'")) {
          rawLine = after.slice(1, -1);
        }
        if (rawLine === undefined) {
          this.p(c.line, 'P004');
          dropped = true;
        } else if (/[\r\n]/.test(rawLine)) {
          this.p(c.line, 'P026');
          dropped = true;
        }
      } else {
        op = w;
        if (after !== '') {
          const v = parseJson(after);
          if (!v || hasNonFinite(v.value)) {
            this.p(c.line, 'P009');
            dropped = true;
          } else if (!isObject(v.value)) {
            this.p(c.line, 'P012');
            dropped = true;
          } else {
            inputText = after;
            input = v.value;
          }
        }
      }
    }

    let request: JsonObject | undefined;
    const omit: string[] = [];
    const expects: Expectation[] = [];
    let inputLines = false;
    const sub = c.sub;
    let i = 0;
    while (i < sub.length) {
      const l = sub[i++];
      if (l.blank || l.text.startsWith('#')) continue;
      if (l.indent !== 4) {
        this.p(l.num, 'P006');
        continue;
      }
      const [kw, rest] = splitWord(l.text);
      switch (kw) {
        case 'expect': {
          const e = this.expectation(rest, l.num);
          if (e) expects.push(e);
          break;
        }
        case 'request':
          if (raw) this.p(l.num, 'P022');
          else if (request) this.p(l.num, 'P052');
          else request = this.requestMembers(rest, l.num);
          break;
        case 'omit': {
          if (raw) {
            this.p(l.num, 'P022');
            break;
          }
          const names = rest.split(/[\s,]+/).filter((x) => x !== '');
          if (names.length === 0) this.p(l.num, 'P011');
          else omit.push(...names);
          break;
        }
        case 'input': {
          const from = fromForm(rest);
          let text: string[] = [];
          if (!from) {
            // The text: the lines right after, blank or indented six or more.
            while (i < sub.length && (sub[i].blank || sub[i].indent >= 6)) {
              const t = sub[i++];
              text.push(t.blank ? '' : ' '.repeat(t.indent - 6) + t.text);
            }
            while (text.length && text[text.length - 1] === '') text.pop();
          }
          if (raw) {
            this.p(l.num, 'P022');
            break;
          }
          const path = parseInputPath(from ? from.path : rest);
          if (!path) {
            this.p(l.num, 'P049');
            break;
          }
          let value: string;
          if (from) {
            const target = this.resolveFrom(from.file);
            if (target === undefined) {
              this.p(l.num, 'P048');
              break;
            }
            value = this.allFiles[target];
          } else value = text.map((t) => t + '\n').join('');
          if (!reachable(input, path)) {
            this.p(l.num, 'P049');
            break;
          }
          if (!from && text.length === 0) {
            this.p(l.num, 'P049');
            break;
          }
          inputLines = true;
          putPath(input, path, value);
          break;
        }
        default:
          this.p(l.num, 'P011');
      }
    }
    if (dropped) return;
    const n = req.examples.length + 1;
    req.examples.push({
      file: this.file,
      line: c.line,
      req,
      n,
      raw,
      rawLine,
      op,
      hasInput: inputText !== undefined || inputLines,
      inputText,
      inputLines,
      input,
      request,
      omit,
      expects,
      row: false,
    });
  }

  private expectation(rest: string, line: number): Expectation | undefined {
    const m = /^[^\s=≈~]+/.exec(rest);
    if (!m) {
      this.p(line, 'P011');
      return undefined;
    }
    const path = m[0];
    const after = rest.slice(path.length).replace(/^\s+/, '');
    if (after.startsWith('=')) {
      const v = after.slice(1).replace(/^\s+/, '');
      if (v === '?') return { line, path, kind: 'oracle' };
      const parsed = parseJson(v);
      if (!parsed || hasNonFinite(parsed.value)) {
        this.p(line, 'P009');
        return undefined;
      }
      return { line, path, kind: 'eq', value: parsed.value };
    }
    if (after.startsWith('≈') || after.startsWith('~')) {
      const a = approx(after.slice(1).trim());
      if (!a) {
        this.p(line, 'P010');
        return undefined;
      }
      return { line, path, kind: 'approx', value: a[0], tol: a[1] };
    }
    this.p(line, 'P011');
    return undefined;
  }

  /** Resolves an `input ... from` name; undefined when it is no file of the record's folder. */
  private resolveFrom(name: string): string | undefined {
    const parts = this.file.split('/').slice(0, -1);
    for (const part of name.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        if (parts.length === 0) return undefined;
        parts.pop();
      } else parts.push(part);
    }
    const target = parts.join('/');
    if (!hasOwn(this.allFiles, target)) return undefined;
    const folder = this.rec.folder;
    if (folder !== '' && !target.startsWith(folder + '/')) return undefined;
    return target;
  }

  /** A `table` clause (REQ-SY-012). */
  private table(c: Clause, req: Req): void {
    const rows: Line[] = [];
    for (const l of c.sub) {
      if (l.blank || l.text.startsWith('#')) continue;
      if (l.text.startsWith('|') && l.indent >= 4) {
        if (!/^\|[\s|:-]*$/.test(l.text) || !l.text.endsWith('|')) rows.push(l);
      } else this.p(l.num, 'P006');
    }
    const opWords = words(c.rest);
    if (opWords.length !== 1 || rows.length < 2) {
      this.p(c.line, 'P013');
      return;
    }
    const op = opWords[0];
    interface Column {
      name: string;
      expect: boolean;
      tol?: number;
    }
    const columns: Column[] = [];
    const header = rows[0];
    for (const cell of cells(header.text)) {
      const m = /\s|±|\+-/.exec(cell);
      const name = m ? cell.slice(0, m.index) : cell;
      const after = m ? cell.slice(m.index).replace(/^\s+/, '') : '';
      let tolText: string | undefined;
      let form = name !== '';
      if (after.startsWith('±')) tolText = after.slice(1).trim();
      else if (after.startsWith('+-')) tolText = after.slice(2).trim();
      else if (after !== '') form = false;
      const expect = EXPECTATION_PATH.test(name);
      if (!expect && !NAME.test(name)) form = false;
      if (!form || columns.some((col) => col.name === name)) {
        this.p(header.num, 'P013');
        return;
      }
      const col: Column = { name, expect };
      if (tolText !== undefined) {
        const t = parseNumber(tolText);
        if (!expect || t === undefined || t < 0) this.p(header.num, 'P010');
        else col.tol = t === 0 ? 0 : t;
      }
      columns.push(col);
    }
    for (const row of rows.slice(1)) {
      const cs = cells(row.text);
      if (cs.length !== columns.length) {
        this.p(row.num, 'P014');
        continue;
      }
      const input: JsonObject = {};
      const inputParts: string[] = [];
      const expects: Expectation[] = [];
      cs.forEach((cell, k) => {
        const col = columns[k];
        if (cell === '') return;
        if (col.expect && cell === '?') {
          expects.push({ line: row.num, path: col.name, kind: 'oracle' });
          return;
        }
        if (col.expect && col.tol !== undefined) {
          const n = parseNumber(cell);
          if (n === undefined) this.p(row.num, 'P010');
          else expects.push({ line: row.num, path: col.name, kind: 'approx', value: n, tol: col.tol });
          return;
        }
        const v = parseJson(cell);
        if (!v || hasNonFinite(v.value)) {
          this.p(row.num, 'P009');
          return;
        }
        if (col.expect) expects.push({ line: row.num, path: col.name, kind: 'eq', value: v.value });
        else {
          setMember(input, col.name, v.value);
          inputParts.push(JSON.stringify(col.name) + ':' + cell);
        }
      });
      req.examples.push({
        file: this.file,
        line: row.num,
        req,
        n: req.examples.length + 1,
        raw: false,
        op,
        hasInput: true,
        inputText: '{' + inputParts.join(',') + '}',
        inputLines: false,
        input,
        omit: [],
        expects,
        row: true,
      });
    }
  }
}

/** Splits an `input` clause into fields at commas outside quotes and brackets. */
function splitFields(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      cur += ch;
      if (ch === '\\' && i + 1 < s.length) cur += s[++i];
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch) && depth > 0) depth--;
    else if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** The `from "<file>"` form of an input line, when it ends so. */
function fromForm(rest: string): { path: string; file: string } | undefined {
  const m = /^([^]*?)\s+from\s+("(?:[^"\\]|\\[^])*")$/.exec(rest);
  if (!m) return undefined;
  const v = parseJson(m[2]);
  if (!v || typeof v.value !== 'string') return undefined;
  return { path: m[1], file: v.value };
}

/** An input path: names separated by dots, each a word or a quoted string. */
export function parseInputPath(s: string): string[] | undefined {
  const names: string[] = [];
  let i = 0;
  if (s === '') return undefined;
  for (;;) {
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      if (j >= s.length) return undefined;
      const v = parseJson(s.slice(i, j + 1));
      if (!v || typeof v.value !== 'string') return undefined;
      names.push(v.value);
      i = j + 1;
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(s.slice(i));
      if (!m) return undefined;
      names.push(m[0]);
      i += m[0].length;
    }
    if (i === s.length) return names;
    if (s[i] !== '.') return undefined;
    i++;
  }
}

/** True when no value on the way to the path's last name is other than an object. */
function reachable(input: JsonObject, path: string[]): boolean {
  let cur: Json = input;
  for (const k of path.slice(0, -1)) {
    if (!isObject(cur)) return false;
    if (!hasOwn(cur, k)) return true;
    cur = cur[k];
  }
  return isObject(cur);
}

function putPath(input: JsonObject, path: string[], value: string): void {
  let cur = input;
  for (const k of path.slice(0, -1)) {
    if (!hasOwn(cur, k)) setMember(cur, k, {});
    cur = cur[k] as JsonObject;
  }
  setMember(cur, path[path.length - 1], value);
}

/** `<number> ± <tolerance>`, `+-` standing for `±`. */
function approx(s: string): [number, number] | undefined {
  const num = JSON_NUMBER.source.slice(1, -1);
  const m = new RegExp(`^(${num})\\s*(?:±|\\+-)\\s*(${num})$`).exec(s);
  if (!m) return undefined;
  const a = parseNumber(m[1]);
  const t = parseNumber(m[2]);
  if (a === undefined || t === undefined || t < 0) return undefined;
  return [a, t === 0 ? 0 : t];
}

/** The cells of a table row: texts between `|`, where `\|` is a `|` inside a cell. */
function cells(row: string): string[] {
  const out: string[] = [];
  let cur = '';
  let endsWithBar = false;
  for (let i = 1; i < row.length; i++) {
    endsWithBar = false;
    if (row[i] === '\\' && row[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (row[i] === '|') {
      out.push(cur);
      cur = '';
      endsWithBar = true;
    } else cur += row[i];
  }
  if (!endsWithBar && row.length > 1) out.push(cur);
  return out.map((c) => c.trim());
}
