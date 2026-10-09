// Reading a record: lines, statements and clauses (REQ-RC-003 to REQ-SY-013).

import { dirname, isInside, resolveRelative, type Files } from './files.ts';
import { hasNonFinite, isObject, jsonNumber, NUMBER_SOURCE, parseJson, parseLoose, setMember, type Json } from './json.ts';
import {
  emptyRecord,
  type Diagnostic, type Example, type Expectation, type Op, type Record, type Req, type TextBlock,
} from './model.ts';

interface Line {
  num: number;
  indent: number;
  /** The line without its indent and without white space at its end. */
  text: string;
  blank: boolean;
}

interface Clause {
  line: Line;
  keyword: string;
  rest: string;
  sub: Line[];
}

interface Statement {
  line: Line;
  keyword: string;
  rest: string;
  body: Line[];
}

const CORE = new Set(['duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note']);
const REST_OF_LANGUAGE = new Set(['type', 'edge', 'edgedef', 'property', 'evidence']);
const VERSIONS = new Set(['0.1', '0.2']);
const FIELD = /^[A-Za-z0-9_-]+$/;
const APPROX = new RegExp(`^(${NUMBER_SOURCE})\\s*(?:±|\\+-)\\s*(${NUMBER_SOURCE})$`);

/** Splits a line into its first word and the rest, with the white space between them removed. */
function firstWord(text: string): [string, string] {
  const m = /^(\S*)\s*([\s\S]*)$/.exec(text)!;
  return [m[1], m[2]];
}

export function readLines(content: string, file: string, diags: Diagnostic[]): Line[] {
  if (content.startsWith('﻿')) content = content.slice(1);
  const out: Line[] = [];
  const raw = content.split(/\r\n|\r|\n/);
  for (let i = 0; i < raw.length; i++) {
    const num = i + 1;
    const text = raw[i].replace(/\s+$/, '');
    if (text === '') {
      out.push({ num, indent: 0, text: '', blank: true });
      continue;
    }
    const lead = /^\s*/.exec(text)![0];
    if (/[^ ]/.test(lead)) {
      diags.push({ file, line: num, level: 'error', code: 'P001' });
      continue;
    }
    out.push({ num, indent: lead.length, text: text.slice(lead.length), blank: false });
  }
  return out;
}

export interface ReadResult {
  record: Record;
  diags: Diagnostic[];
}

export function readRecord(files: Files, name: string, folder: string, names: string[]): ReadResult {
  const reader = new Reader(files, name, folder, names);
  for (const f of names) reader.readFile(f, files.get(f)!);
  reader.finish();
  return { record: reader.record, diags: reader.diags };
}

class Reader {
  files: Files;
  record: Record;
  diags: Diagnostic[] = [];
  versions: string[] = [];
  file = '';

  constructor(files: Files, name: string, folder: string, names: string[]) {
    this.files = files;
    this.record = emptyRecord(name, folder, names);
  }

  err(line: number, code: string): void {
    this.diags.push({ file: this.file, line, level: 'error', code });
  }

  finish(): void {
    const r = this.record;
    if (r.specs.length === 0) this.diags.push({ file: r.name, line: 1, level: 'error', code: 'P021' });
    if (new Set(this.versions).size > 1) this.diags.push({ file: r.name, line: 1, level: 'error', code: 'P047' });
  }

  readFile(file: string, content: string): void {
    this.file = file;
    const lines = readLines(content, file, this.diags);
    const statements: Statement[] = [];
    for (const l of lines) {
      if (l.blank) {
        statements.at(-1)?.body.push(l);
      } else if (l.indent === 0) {
        if (l.text.startsWith('#')) continue;
        const [keyword, rest] = firstWord(l.text);
        statements.push({ line: l, keyword, rest, body: [] });
      } else if (statements.length === 0) {
        this.err(l.num, 'P003');
      } else {
        statements.at(-1)!.body.push(l);
      }
    }
    let version: boolean = false;
    for (const st of statements) {
      if (st.keyword === 'duramen') {
        if (version || !VERSIONS.has(st.rest)) this.err(st.line.num, 'P023');
        else this.versions.push(st.rest);
        version = true;
      }
      this.readStatement(st);
    }
    if (!version) this.err(1, 'P020');
  }

  clauses(st: Statement): Clause[] {
    const out: Clause[] = [];
    for (const l of st.body) {
      if (l.blank) {
        out.at(-1)?.sub.push(l);
      } else if (l.indent === 1) {
        this.err(l.num, 'P007');
      } else if (l.indent === 2) {
        if (l.text.startsWith('#')) continue;
        const [keyword, rest] = firstWord(l.text);
        out.push({ line: l, keyword, rest, sub: [] });
      } else if (out.length === 0) {
        this.err(l.num, 'P006');
      } else {
        out.at(-1)!.sub.push(l);
      }
    }
    return out;
  }

  /**
   * Reads the clauses of a statement: each keyword's handler, P015 for one it does not take,
   * and P052 for a second of those taken once.
   */
  dispatch(st: Statement, handlers: { [k: string]: (c: Clause) => void }, once: string[], ignored: string[] = []): void {
    const seen = new Set<string>();
    for (const c of this.clauses(st)) {
      if (ignored.includes(c.keyword)) continue;
      if (!Object.hasOwn(handlers, c.keyword)) {
        this.err(c.line.num, 'P015');
        continue;
      }
      if (once.includes(c.keyword)) {
        if (seen.has(c.keyword)) {
          this.err(c.line.num, 'P052');
          continue;
        }
        seen.add(c.keyword);
      }
      handlers[c.keyword](c);
    }
  }

  /** Under a clause that takes no lines of its own, every line but blanks and comments is P006. */
  noLines(c: Clause): void {
    for (const l of c.sub) if (!l.blank && !l.text.startsWith('#')) this.err(l.num, 'P006');
  }

  text(c: Clause): TextBlock {
    if (c.rest !== '') this.err(c.line.num, 'P008');
    const lines: string[] = [];
    for (const l of c.sub) {
      if (l.blank) lines.push('');
      else if (l.indent === 3) this.err(l.num, 'P008');
      else lines.push(' '.repeat(l.indent - 4) + l.text);
    }
    while (lines.length > 0 && lines[0] === '') lines.shift();
    while (lines.length > 0 && lines.at(-1) === '') lines.pop();
    return { line: c.line.num, lines };
  }

  quoted(c: Clause): string | undefined {
    this.noLines(c);
    const p = parseLoose(c.rest);
    if (!p.ok || typeof p.value !== 'string') {
      this.err(c.line.num, 'P004');
      return undefined;
    }
    return p.value;
  }

  /** Request members: P009 for what is not a JSON object, P051 for one that sets id, op or input. */
  request(text: string, line: number): { [k: string]: Json } | undefined {
    const p = parseJson(text);
    if (!p.ok || !isObject(p.value)) {
      this.err(line, 'P009');
      return undefined;
    }
    if (['id', 'op', 'input'].some((k) => Object.hasOwn(p.value as object, k))) {
      this.err(line, 'P051');
      return undefined;
    }
    return p.value;
  }

  /** `<ID> "<title>"`; returns the ID. */
  idTitle(st: Statement): string {
    const [id, title] = firstWord(st.rest);
    if (id === '' || title.length < 2 || !title.startsWith('"') || !title.endsWith('"')) {
      this.err(st.line.num, 'P005');
    } else {
      const p = parseLoose(title);
      if (!p.ok || typeof p.value !== 'string') this.err(st.line.num, 'P004');
    }
    return id;
  }

  readStatement(st: Statement): void {
    const r = this.record;
    const file = this.file;
    const line = st.line.num;
    switch (st.keyword) {
      case 'duramen':
        this.dispatch(st, {}, []);
        return;
      case 'spec': {
        const words = st.rest === '' ? [] : st.rest.split(/\s+/);
        if (words.length !== 2) this.err(line, 'P021');
        if (r.specs.length > 0) this.err(line, 'P044');
        const spec: Record['specs'][number] = { file, line };
        r.specs.push(spec);
        this.dispatch(st, {
          title: (c) => { this.quoted(c); },
          contract: (c) => this.noLines(c),
          request: (c) => { this.noLines(c); spec.request = this.request(c.rest, c.line.num); },
          text: (c) => { spec.text = this.text(c); },
        }, ['title', 'contract', 'request', 'text']);
        return;
      }
      case 'oracle': {
        if (st.rest === '') this.err(line, 'P028');
        if (r.oracles.length > 0) this.err(line, 'P044');
        r.oracles.push({ file, line, command: st.rest });
        this.dispatch(st, { source: (c) => this.noLines(c) }, []);
        return;
      }
      case 'op':
        this.readOp(st);
        return;
      case 'errors': {
        if (st.rest !== '') this.err(line, 'P050');
        if (r.errors.length > 0) this.err(line, 'P032');
        const list: Record['errors'][number] = { file, line, codes: [] };
        r.errors.push(list);
        for (const c of this.clauses(st)) {
          const m = /^when(?:\s+(.*))?$/.exec(c.rest);
          const ok = m !== null && m[1] !== undefined && m[1] !== '';
          if (!ok) this.err(c.line.num, 'P019');
          const condition = ok ? [m![1]] : [];
          for (const l of c.sub) {
            if (l.blank) continue;
            if (l.indent === 3) this.err(l.num, 'P006');
            else condition.push(l.text);
          }
          if (ok) list.codes.push({ code: c.keyword, line: c.line.num, condition });
        }
        return;
      }
      case 'req':
        this.readReq(st);
        return;
      case 'open': {
        const open: Record['opens'][number] = { id: this.idTitle(st), file, line, exampleLines: [] };
        r.opens.push(open);
        const reported = (c: Clause) => { open.exampleLines.push(c.line.num); };
        this.dispatch(st, { text: (c) => { open.text = this.text(c); }, example: reported, table: reported }, ['text']);
        return;
      }
      case 'decision': {
        const d: Record['decisions'][number] = { id: this.idTitle(st), file, line, rejected: [] };
        r.decisions.push(d);
        this.dispatch(st, {
          source: (c) => { this.noLines(c); d.source = c.rest; },
          status: (c) => { this.noLines(c); d.status = c.rest; },
          text: (c) => { d.text = this.text(c); },
          rejected: (c) => {
            const q = this.quoted(c);
            if (q !== undefined) d.rejected.push(q);
          },
        }, ['source', 'status', 'text']);
        return;
      }
      case 'section': {
        this.idTitle(st);
        const s: Record['sections'][number] = { file, line };
        r.sections.push(s);
        this.dispatch(st, { text: (c) => { s.text = this.text(c); } }, ['text']);
        return;
      }
      case 'note': {
        if (st.rest !== '') this.err(line, 'P050');
        const n: Record['notes'][number] = { file, line };
        r.notes.push(n);
        this.dispatch(st, { text: (c) => { n.text = this.text(c); } }, ['text']);
        return;
      }
      default:
        if (!CORE.has(st.keyword) && !REST_OF_LANGUAGE.has(st.keyword)) this.err(line, 'P002');
        // The rest of the language (OPEN-RC-001) is read as nothing, as is an unknown statement's body.
        return;
    }
  }

  readOp(st: Statement): void {
    const words = st.rest === '' ? [] : st.rest.split(/\s+/);
    if (words.length !== 1) this.err(st.line.num, 'P031');
    const op: Op = {
      name: words.length === 1 ? words[0] : '', file: this.file, line: st.line.num,
      fields: new Map(), hasRequest: false, tolerances: [], audit: false,
    };
    if (words.length === 1) this.record.ops.push(op);
    this.dispatch(st, {
      input: (c) => {
        this.noLines(c);
        for (const field of splitFields(c.rest)) {
          const m = /^([A-Za-z0-9_-]+)(\?)?\s+\S/.exec(field.trim());
          if (!m) this.err(c.line.num, 'P017');
          else if (op.fields.has(m[1])) this.err(c.line.num, 'P052');
          else op.fields.set(m[1], m[2] === '?');
        }
      },
      result: (c) => { this.noLines(c); op.result = c.rest; },
      tolerance: (c) => {
        this.noLines(c);
        const [path, num] = firstWord(c.rest);
        if (path !== '' && op.tolerances.some(([p]) => p === path)) {
          this.err(c.line.num, 'P052');
          return;
        }
        const n = jsonNumber(num);
        if (path === '' || n === undefined || n < 0) this.err(c.line.num, 'P018');
        else op.tolerances.push([path, n === 0 ? 0 : n]);
      },
      audit: (c) => {
        this.noLines(c);
        if (c.rest !== '' && c.rest !== 'text') this.err(c.line.num, 'P050');
        else op.audit = true;
      },
      request: (c) => {
        this.noLines(c);
        const req = this.request(c.rest, c.line.num);
        if (req !== undefined) {
          op.request = req;
          op.hasRequest = true;
        }
      },
    }, ['result', 'audit', 'request'], ['returns']);
  }

  readReq(st: Statement): void {
    const req: Req = {
      id: this.idTitle(st), file: this.file, line: st.line.num, decisions: [], platform: 'any', examples: [],
    };
    this.record.reqs.push(req);
    this.dispatch(st, {
      text: (c) => { req.text = this.text(c); },
      decision: (c) => {
        this.noLines(c);
        req.decisions.push(...c.rest.split(/[\s,]+/).filter((x) => x !== ''));
      },
      on: (c) => {
        this.noLines(c);
        if (c.rest === 'any' || c.rest === 'posix' || c.rest === 'windows') req.platform = c.rest;
        else this.err(c.line.num, 'P033');
      },
      example: (c) => {
        const ex = this.readExample(c, req);
        if (ex) req.examples.push(ex);
      },
      table: (c) => this.readTable(c, req),
    }, ['text', 'on'], ['static']);
  }

  readExample(c: Clause, req: Req): Example | undefined {
    const ex: Example = {
      file: this.file, line: c.line.num, req, raw: false, hasInputLines: false, omit: [], expects: [],
    };
    let dropped = false;
    let input: { [k: string]: Json } | undefined;
    if (c.rest === '') {
      this.err(c.line.num, 'P012');
      dropped = true;
    } else {
      const [op, after] = firstWord(c.rest);
      if (op === 'raw') {
        ex.raw = true;
        let line: string | undefined;
        if (after.startsWith('"')) {
          const p = parseLoose(after);
          if (p.ok && typeof p.value === 'string') line = p.value;
        } else if (after.length >= 2 && after.startsWith("'") && after.endsWith("'")) {
          line = after.slice(1, -1);
        }
        if (line === undefined) {
          this.err(c.line.num, 'P004');
          dropped = true;
        } else if (/[\r\n]/.test(line)) {
          this.err(c.line.num, 'P026');
          dropped = true;
        } else ex.rawLine = line;
      } else {
        ex.op = op;
        if (after !== '') {
          const p = parseLoose(after);
          if (!p.ok || hasNonFinite(p.value)) {
            this.err(c.line.num, 'P009');
            dropped = true;
          } else if (!isObject(p.value)) {
            this.err(c.line.num, 'P012');
            dropped = true;
          } else {
            ex.inputText = after;
            input = p.value;
          }
        }
      }
    }
    this.readExampleLines(c, ex, input);
    return dropped ? undefined : ex;
  }

  readExampleLines(c: Clause, ex: Example, input: { [k: string]: Json } | undefined): void {
    const sub = c.sub;
    let requestRead = false;
    let base: { [k: string]: Json } = input ?? {};
    for (let i = 0; i < sub.length; i++) {
      const l = sub[i];
      if (l.blank) continue;
      if (l.indent !== 4) {
        if (!l.text.startsWith('#')) this.err(l.num, 'P006');
        continue;
      }
      if (l.text.startsWith('#')) continue;
      const [word, rest] = firstWord(l.text);
      switch (word) {
        case 'expect': {
          const e = this.readExpect(rest, l.num);
          if (e) ex.expects.push(e);
          break;
        }
        case 'request':
          if (ex.raw) this.err(l.num, 'P022');
          else if (requestRead) this.err(l.num, 'P052');
          else {
            const r = this.request(rest, l.num);
            if (r !== undefined) {
              ex.request = r;
              requestRead = true;
            }
          }
          break;
        case 'omit': {
          if (ex.raw) {
            this.err(l.num, 'P022');
            break;
          }
          const names = rest.split(/[\s,]+/).filter((x) => x !== '');
          if (names.length === 0) this.err(l.num, 'P011');
          else ex.omit.push(...names);
          break;
        }
        case 'input': {
          if (ex.raw) {
            this.err(l.num, 'P022');
            while (i + 1 < sub.length && (sub[i + 1].blank || sub[i + 1].indent >= 6)) i++;
            break;
          }
          i = this.readInput(rest, l.num, sub, i, base);
          ex.hasInputLines = true;
          break;
        }
        default:
          this.err(l.num, 'P011');
      }
    }
    if (ex.hasInputLines) ex.inputValue = base;
  }

  /** An `input` line and the text under it; returns the index of its last line. */
  readInput(rest: string, num: number, sub: Line[], i: number, base: { [k: string]: Json }): number {
    let pathText = rest;
    let from: string | undefined;
    const m = /^(.*)\sfrom\s+(".*")$/.exec(rest);
    if (m) {
      const p = parseLoose(m[2]);
      if (p.ok && typeof p.value === 'string') {
        pathText = m[1].trim();
        from = p.value;
      }
    }
    let text: string | undefined;
    let bad = false;
    if (from !== undefined) {
      while (i + 1 < sub.length && (sub[i + 1].blank || sub[i + 1].indent >= 6)) {
        i++;
        if (!sub[i].blank) this.err(sub[i].num, 'P006');
      }
      const target = resolveRelative(dirname(this.file), from);
      if (target === undefined || !isInside(this.record.folder, target) || !this.files.has(target)) {
        this.err(num, 'P048');
      } else text = this.files.get(target)!;
    } else {
      const lines: string[] = [];
      while (i + 1 < sub.length && (sub[i + 1].blank || sub[i + 1].indent >= 6)) {
        i++;
        lines.push(sub[i].blank ? '' : ' '.repeat(sub[i].indent - 6) + sub[i].text);
      }
      while (lines.length > 0 && lines.at(-1) === '') lines.pop();
      if (lines.length === 0) bad = true;
      else text = lines.map((x) => x + '\n').join('');
    }
    const path = parsePath(pathText);
    if (path === undefined) bad = true;
    else {
      let obj: { [k: string]: Json } = base;
      for (const name of path.slice(0, -1)) {
        if (!Object.hasOwn(obj, name)) setMember(obj, name, {});
        const next = obj[name];
        if (!isObject(next)) {
          bad = true;
          break;
        }
        obj = next;
      }
      if (!bad && text !== undefined) setMember(obj, path.at(-1)!, text);
    }
    if (bad) this.err(num, 'P049');
    return i;
  }

  readExpect(rest: string, num: number): Expectation | undefined {
    const pm = /^[^\s=≈~]+/.exec(rest);
    if (!pm) {
      this.err(num, 'P011');
      return undefined;
    }
    const path = pm[0];
    const after = rest.slice(path.length).trimStart();
    const sign = after[0];
    if (sign === '=') {
      const v = after.slice(1).trim();
      if (v === '?') return { line: num, path, kind: 'oracle' };
      const p = parseJson(v);
      if (!p.ok) {
        this.err(num, 'P009');
        return undefined;
      }
      return { line: num, path, kind: 'eq', value: p.value };
    }
    if (sign === '≈' || sign === '~') {
      const m = APPROX.exec(after.slice(1).trim());
      const value = m ? jsonNumber(m[1]) : undefined;
      const tol = m ? jsonNumber(m[2]) : undefined;
      if (value === undefined || tol === undefined || tol < 0) {
        this.err(num, 'P010');
        return undefined;
      }
      return { line: num, path, kind: 'approx', value, tol: tol === 0 ? 0 : tol };
    }
    this.err(num, 'P011');
    return undefined;
  }

  readTable(c: Clause, req: Req): void {
    const rows: Line[] = [];
    for (const l of c.sub) {
      if (l.blank) continue;
      if (l.text.startsWith('|')) {
        if (l.indent >= 4) rows.push(l);
        else this.err(l.num, 'P006');
      } else if (!l.text.startsWith('#')) this.err(l.num, 'P006');
    }
    const data = rows.filter((r) => !/^\|(?:[-|: ]*\|)?$/.test(r.text));
    const words = c.rest === '' ? [] : c.rest.split(/\s+/);
    if (words.length !== 1 || data.length < 2) {
      this.err(c.line.num, 'P013');
      return;
    }
    interface Column { name: string; input: boolean; tol?: number }
    const columns: Column[] = [];
    const header = data[0];
    for (const cell of cells(header.text)) {
      let name = cell;
      let tolText: string | undefined;
      const at = [cell.indexOf('±'), cell.indexOf('+-')].filter((x) => x >= 0);
      if (at.length > 0) {
        const k = Math.min(...at);
        name = cell.slice(0, k).trim();
        tolText = cell.slice(k + (cell[k] === '±' ? 1 : 2)).trim();
      }
      const isPath = /^(?:result|audit|error|id)(?:\.\S*)?$/.test(name);
      const isField = !isPath && FIELD.test(name);
      if ((!isPath && !isField) || columns.some((col) => col.name === name)) {
        this.err(header.num, 'P013');
        return;
      }
      const col: Column = { name, input: isField };
      if (tolText !== undefined) {
        const n = jsonNumber(tolText);
        if (isField || n === undefined || n < 0) this.err(header.num, 'P010');
        else col.tol = n === 0 ? 0 : n;
      }
      columns.push(col);
    }
    for (const row of data.slice(1)) {
      const cs = cells(row.text);
      if (cs.length !== columns.length) {
        this.err(row.num, 'P014');
        continue;
      }
      const parts: string[] = [];
      const fields: string[] = [];
      const expects: Expectation[] = [];
      let bad = false;
      columns.forEach((col, k) => {
        const cell = cs[k];
        if (cell === '') return;
        if (col.input) {
          if (!parseJson(cell).ok) {
            this.err(row.num, 'P009');
            bad = true;
          } else {
            parts.push(`${JSON.stringify(col.name)}:${cell}`);
            fields.push(col.name);
          }
        } else if (cell === '?') {
          expects.push({ line: row.num, path: col.name, kind: 'oracle' });
        } else if (col.tol !== undefined) {
          const n = jsonNumber(cell);
          if (n === undefined) {
            this.err(row.num, 'P010');
            bad = true;
          } else expects.push({ line: row.num, path: col.name, kind: 'approx', value: n, tol: col.tol });
        } else {
          const p = parseJson(cell);
          if (!p.ok) {
            this.err(row.num, 'P009');
            bad = true;
          } else expects.push({ line: row.num, path: col.name, kind: 'eq', value: p.value });
        }
      });
      if (bad) continue;
      req.examples.push({
        file: this.file, line: row.num, req, raw: false, op: words[0], inputText: `{${parts.join(',')}}`,
        hasInputLines: false, omit: [], expects, rowFields: fields,
      });
    }
  }
}

/** The fields of an `input` clause: split at commas outside quotes, brackets, braces and parentheses. */
export function splitFields(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '\\' && i + 1 < text.length) {
        cur += ch + text[++i];
        continue;
      }
      if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if ('[{('.includes(ch)) depth++;
    else if (']})'.includes(ch)) depth = Math.max(0, depth - 1);
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

/** A path of an input line: words or quoted strings separated by dots. */
export function parsePath(text: string): string[] | undefined {
  const names: string[] = [];
  let i = 0;
  for (;;) {
    if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (j >= text.length) return undefined;
      const p = parseLoose(text.slice(i, j + 1));
      if (!p.ok || typeof p.value !== 'string') return undefined;
      names.push(p.value);
      i = j + 1;
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(text.slice(i));
      if (!m) return undefined;
      names.push(m[0]);
      i += m[0].length;
    }
    if (i === text.length) return names;
    if (text[i] !== '.') return undefined;
    i++;
  }
}

/** The cells of a table row: `\|` is a `|` inside a cell, and the last `|` may be left out. */
export function cells(row: string): string[] {
  const out: string[] = [];
  let cur = '';
  let endedWithBar = false;
  for (let i = 1; i < row.length; i++) {
    const ch = row[i];
    endedWithBar = false;
    if (ch === '\\' && row[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      out.push(cur);
      cur = '';
      endedWithBar = true;
    } else cur += ch;
  }
  if (!endedWithBar) out.push(cur);
  return out.map((x) => x.trim());
}
