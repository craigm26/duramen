// Reading a record: lines, statements, clauses, and the P diagnostics (REQ-RC-*, REQ-SY-*).

import type { Diag, Level } from './diag.ts';
import { hasOwn, isPlainObject, jsonNumber, jsonTolerance, parseFinite, setOwn } from './json.ts';
import type { JsonObject } from './json.ts';
import type { Record } from './record.ts';

export interface Line {
  no: number;
  /** The line without its trailing white space. */
  text: string;
  indent: number;
  /** The line after its indent. */
  content: string;
  blank: boolean;
  /** Leading white space holds something other than spaces (P001). */
  bad: boolean;
}

interface Statement {
  kw: string;
  rest: string;
  no: number;
  body: Line[];
}

interface Clause {
  kw: string;
  rest: string;
  no: number;
  lines: Line[];
}

export interface Expect {
  line: number;
  path: string;
  kind: 'eq' | 'approx' | 'oracle';
  value?: unknown;
  tol?: number;
}

export interface Example {
  file: string;
  line: number;
  caseId: string;
  raw: boolean;
  rawLine?: string;
  op?: string;
  /** The input as it is sent; undefined when the request has no `input` member. */
  inputText?: string;
  /** The input's members, for REQ-CK-004. */
  input: JsonObject;
  request?: JsonObject;
  omit: string[];
  expects: Expect[];
  row: boolean;
}

export interface Op {
  name: string;
  file: string;
  line: number;
  fields: Map<string, { optional: boolean }>;
  tolerances: Map<string, number>;
  audit: boolean;
  request?: JsonObject;
}

export interface Req {
  id: string;
  file: string;
  line: number;
  decisions: string[];
  platform: string;
  text?: { line: number; text: string };
  examples: Example[];
}

export interface Open {
  id: string;
  file: string;
  line: number;
  /** Lines of its `example` and `table` clauses (T003). */
  tested: number[];
}

export interface Decision {
  id: string;
  file: string;
  line: number;
  source: boolean;
  status?: string;
}

export interface Obligation {
  file: string;
  line: number;
  text: string;
  /** T014 (a warning) for an open item's text, T004 otherwise. */
  open: boolean;
}

export interface Model {
  spec?: { file: string; line: number; request?: JsonObject };
  oracle?: { file: string; line: number; command: string };
  errorsSeen: boolean;
  codes: Set<string>;
  ops: Op[];
  reqs: Req[];
  opens: Open[];
  decisions: Decision[];
  obligations: Obligation[];
}

export const CORE = new Set(['duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note']);
/** Statements of the rest of the language (OPEN-RC-001): accepted, their bodies not read. */
export const REST = new Set(['type', 'edge', 'edgedef', 'property', 'evidence']);
export const VERSIONS = new Set(['0.1', '0.2']);

const PATH_ROOTS = ['result', 'audit', 'error', 'id'];
const WORD = /^[A-Za-z0-9_-]+$/;

export function readLines(text: string): Line[] {
  if (text.startsWith('﻿')) text = text.slice(1);
  return text.split(/\r\n|\r|\n/).map((r, i) => {
    const t = r.replace(/\s+$/, '');
    const lead = /^\s*/.exec(t)![0];
    return {
      no: i + 1,
      text: t,
      indent: lead.length,
      content: t.slice(lead.length),
      blank: t === '',
      bad: /[^ ]/.test(lead),
    };
  });
}

/** Splits `<keyword> <rest>`; the rest has no white space at either end. */
function split(content: string): { kw: string; rest: string } {
  const m = /^(\S*)\s*([^]*)$/.exec(content)!;
  return { kw: m[1], rest: m[2] };
}

function words(rest: string): string[] {
  return rest === '' ? [] : rest.split(/\s+/);
}

/** Splits the fields of an `input` clause at commas outside quotes and brackets. */
export function splitFields(s: string): string[] {
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

/** The names of an input path (`files."a.duramen"`), or undefined when it has another form. */
export function parseInputPath(s: string): string[] | undefined {
  const names: string[] = [];
  let i = 0;
  for (;;) {
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      if (j >= s.length) return undefined;
      let name: unknown;
      try {
        name = JSON.parse(s.slice(i, j + 1));
      } catch {
        return undefined;
      }
      if (typeof name !== 'string') return undefined;
      names.push(name);
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

/** `<path> from "<file>"`, when the line has that form. */
function fromForm(arg: string): { path: string; name: string } | undefined {
  const m = /^(?:([^]*?)\s+)?from\s+("(?:[^"\\]|\\[^])*")$/.exec(arg);
  if (!m) return undefined;
  try {
    const name = JSON.parse(m[2]);
    if (typeof name === 'string') return { path: m[1] ?? '', name };
  } catch {
    // not a quoted string
  }
  return undefined;
}

function isSeparator(content: string): boolean {
  return /^\|[\s|:-]*$/.test(content) && content.endsWith('|');
}

/** The cells of a table row, `\|` read as `|`, without the white space around each. */
export function splitRow(content: string): string[] {
  const cells: string[] = [];
  let cur = '';
  for (let i = 1; i < content.length; i++) {
    const ch = content[i];
    if (ch === '\\' && content[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cur);
      cur = '';
    } else cur += ch;
  }
  cells.push(cur);
  if (cells.length > 1 && cells[cells.length - 1] === '' && content.endsWith('|')) cells.pop();
  return cells.map((c) => c.trim());
}

function headerCell(cell: string): { name: string; tol?: string } | undefined {
  let i = 0;
  while (i < cell.length && !/\s/.test(cell[i]) && cell[i] !== '±' && !(cell[i] === '+' && cell[i + 1] === '-')) i++;
  const name = cell.slice(0, i);
  const rest = cell.slice(i).trimStart();
  if (rest === '') return { name };
  if (rest.startsWith('±')) return { name, tol: rest.slice(1).trim() };
  if (rest.startsWith('+-')) return { name, tol: rest.slice(2).trim() };
  return undefined;
}

export function isExpectationPath(name: string): boolean {
  return PATH_ROOTS.some((r) => name === r || name.startsWith(r + '.'));
}

const APPROX = /^\s*(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(?:±|\+-)\s*(\S+)$/;

interface ClauseRule {
  once?: boolean;
  /** The clause takes lines of its own. */
  lines?: boolean;
  fn: (c: Clause) => void;
}

export class Reader {
  diags: Diag[] = [];
  model: Model = {
    errorsSeen: false,
    codes: new Set(),
    ops: [],
    reqs: [],
    opens: [],
    decisions: [],
    obligations: [],
  };
  versions = new Set<string>();
  files: Map<string, string>;
  record: Record;

  constructor(files: Map<string, string>, record: Record) {
    this.files = files;
    this.record = record;
  }

  d(file: string, line: number, code: string, level: Level = 'error'): void {
    this.diags.push({ file, line, level, code });
  }

  read(): void {
    const rec = this.record;
    if (rec.files.length === 0) {
      this.d(rec.name, 1, 'P046');
      return;
    }
    for (const f of rec.files) this.readFile(f, this.files.get(f)!);
    if (this.versions.size > 1) this.d(rec.name, 1, 'P047');
    if (!this.model.spec) this.d(rec.name, 1, 'P021');
  }

  readFile(file: string, text: string): void {
    const statements: Statement[] = [];
    let cur: Statement | undefined;
    for (const l of readLines(text)) {
      if (l.blank) {
        cur?.body.push(l);
      } else if (l.bad) {
        this.d(file, l.no, 'P001');
      } else if (l.indent === 0) {
        if (l.content.startsWith('#')) continue;
        cur = { ...split(l.content), no: l.no, body: [] };
        statements.push(cur);
      } else if (!cur) {
        this.d(file, l.no, 'P003');
      } else {
        cur.body.push(l);
      }
    }
    let version: string | undefined;
    let versionStated = false;
    for (const st of statements) {
      if (st.kw === 'duramen') {
        if (versionStated || !VERSIONS.has(st.rest)) this.d(file, st.no, 'P023');
        else version = st.rest;
        versionStated = true;
      }
      this.statement(file, st);
    }
    if (!versionStated) this.d(file, 1, 'P020');
    if (version !== undefined) this.versions.add(version);
  }

  /** Groups a statement's body into clauses (REQ-SY-003). */
  clauses(file: string, body: Line[]): Clause[] {
    const out: Clause[] = [];
    let cur: Clause | undefined;
    for (const l of body) {
      if (l.blank) {
        cur?.lines.push(l);
      } else if (l.indent === 1) {
        this.d(file, l.no, 'P007');
      } else if (l.indent === 2) {
        if (l.content.startsWith('#')) continue;
        cur = { ...split(l.content), no: l.no, lines: [] };
        out.push(cur);
      } else if (!cur) {
        this.d(file, l.no, 'P006');
      } else {
        cur.lines.push(l);
      }
    }
    return out;
  }

  runClauses(file: string, body: Line[], rules: Map<string, ClauseRule>): void {
    const seen = new Set<string>();
    for (const c of this.clauses(file, body)) {
      const rule = rules.get(c.kw);
      if (!rule) {
        this.d(file, c.no, 'P015');
        continue;
      }
      if (rule.once) {
        if (seen.has(c.kw)) {
          this.d(file, c.no, 'P052');
          continue;
        }
        seen.add(c.kw);
      }
      if (!rule.lines) {
        for (const l of c.lines) if (!l.blank && !l.content.startsWith('#')) this.d(file, l.no, 'P006');
      }
      rule.fn(c);
    }
  }

  text(file: string, c: Clause): string {
    if (c.rest !== '') this.d(file, c.no, 'P008');
    const out: string[] = [];
    for (const l of c.lines) {
      if (l.blank) out.push('');
      else if (l.indent === 3) this.d(file, l.no, 'P008');
      else out.push(l.text.slice(4));
    }
    while (out.length && out[0] === '') out.shift();
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n');
  }

  quoted(file: string, line: number, rest: string): string | undefined {
    try {
      const v = JSON.parse(rest);
      if (typeof v === 'string') return v;
    } catch {
      // P004 below
    }
    this.d(file, line, 'P004');
    return undefined;
  }

  idTitle(file: string, st: Statement): string {
    const { kw: id, rest: title } = split(st.rest);
    if (title.length < 2 || !title.startsWith('"') || !title.endsWith('"')) this.d(file, st.no, 'P005');
    else this.quoted(file, st.no, title);
    return id;
  }

  requestValue(file: string, line: number, rest: string): JsonObject | undefined {
    const p = parseFinite(rest);
    if (!p || !isPlainObject(p.value)) {
      this.d(file, line, 'P009');
      return undefined;
    }
    const v = p.value;
    if (hasOwn(v, 'id') || hasOwn(v, 'op') || hasOwn(v, 'input')) {
      this.d(file, line, 'P051');
      return undefined;
    }
    return v;
  }

  obligation(file: string, line: number, text: string, open = false): void {
    this.model.obligations.push({ file, line, text, open });
  }

  statement(file: string, st: Statement): void {
    const m = this.model;
    const R = (entries: [string, ClauseRule][]) => this.runClauses(file, st.body, new Map(entries));
    const textRule = (fn: (t: string) => void): [string, ClauseRule] => [
      'text',
      { once: true, lines: true, fn: (c) => fn(this.text(file, c)) },
    ];
    switch (st.kw) {
      case 'duramen':
        R([]);
        return;
      case 'spec': {
        const first = !m.spec;
        if (first) m.spec = { file, line: st.no };
        else this.d(file, st.no, 'P044');
        if (words(st.rest).length !== 2) this.d(file, st.no, 'P021');
        R([
          ['title', { once: true, fn: (c) => this.quoted(file, c.no, c.rest) }],
          textRule((t) => first && this.obligation(file, st.no, t)),
          ['contract', { once: true, fn: () => {} }],
          [
            'request',
            {
              once: true,
              fn: (c) => {
                const v = this.requestValue(file, c.no, c.rest);
                if (first && v) m.spec!.request = v;
              },
            },
          ],
        ]);
        return;
      }
      case 'oracle': {
        if (!m.oracle) m.oracle = { file, line: st.no, command: st.rest };
        else this.d(file, st.no, 'P044');
        if (st.rest === '') this.d(file, st.no, 'P028');
        R([['source', { fn: () => {} }]]);
        return;
      }
      case 'errors': {
        const first = !m.errorsSeen;
        if (first) m.errorsSeen = true;
        else this.d(file, st.no, 'P032');
        if (st.rest !== '') this.d(file, st.no, 'P050');
        for (const c of this.clauses(file, st.body)) {
          const cond: string[] = [];
          const w = /^(\S+)(?:\s+([^]*))?$/.exec(c.rest);
          if (!w || w[1] !== 'when' || !w[2]) this.d(file, c.no, 'P019');
          else cond.push(w[2]);
          for (const l of c.lines) {
            if (l.blank) cond.push('');
            else if (l.indent === 3) this.d(file, l.no, 'P006');
            else cond.push(l.content);
          }
          if (first) {
            m.codes.add(c.kw);
            this.obligation(file, c.no, cond.join('\n'));
          }
        }
        return;
      }
      case 'op':
        this.op(file, st);
        return;
      case 'req':
        this.req(file, st);
        return;
      case 'open': {
        const open: Open = { id: this.idTitle(file, st), file, line: st.no, tested: [] };
        m.opens.push(open);
        const tested: ClauseRule = { lines: true, fn: (c) => open.tested.push(c.no) };
        R([textRule((t) => this.obligation(file, st.no, t, true)), ['example', tested], ['table', tested]]);
        return;
      }
      case 'decision': {
        const dec: Decision = { id: this.idTitle(file, st), file, line: st.no, source: false };
        m.decisions.push(dec);
        R([
          ['source', { once: true, fn: (c) => (dec.source = c.rest !== '') }],
          ['status', { once: true, fn: (c) => (dec.status = c.rest) }],
          textRule((t) => this.obligation(file, st.no, t)),
          [
            'rejected',
            {
              fn: (c) => {
                const alt = this.quoted(file, c.no, c.rest);
                if (alt !== undefined) this.obligation(file, st.no, alt);
              },
            },
          ],
        ]);
        return;
      }
      case 'section':
        this.idTitle(file, st);
        R([textRule((t) => this.obligation(file, st.no, t))]);
        return;
      case 'note':
        if (st.rest !== '') this.d(file, st.no, 'P050');
        R([textRule((t) => this.obligation(file, st.no, t))]);
        return;
      default:
        if (!REST.has(st.kw)) this.d(file, st.no, 'P002');
    }
  }

  op(file: string, st: Statement): void {
    const name = words(st.rest);
    if (name.length !== 1) this.d(file, st.no, 'P031');
    const op: Op = {
      name: name[0] ?? '',
      file,
      line: st.no,
      fields: new Map(),
      tolerances: new Map(),
      audit: false,
    };
    if (name.length === 1) this.model.ops.push(op);
    this.runClauses(
      file,
      st.body,
      new Map<string, ClauseRule>([
        [
          'input',
          {
            fn: (c) => {
              for (const f of splitFields(c.rest)) {
                const fm = /^([A-Za-z0-9_-]+)(\?)?\s+\S/.exec(f.trim());
                if (!fm) this.d(file, c.no, 'P017');
                else if (op.fields.has(fm[1])) this.d(file, c.no, 'P052');
                else op.fields.set(fm[1], { optional: fm[2] === '?' });
              }
            },
          },
        ],
        ['result', { once: true, fn: (c) => this.obligation(file, st.no, c.rest) }],
        [
          'tolerance',
          {
            fn: (c) => {
              const tm = /^(\S+)\s+([^]*)$/.exec(c.rest);
              const tol = tm ? jsonTolerance(tm[2]) : undefined;
              if (!tm || tol === undefined) this.d(file, c.no, 'P018');
              else if (op.tolerances.has(tm[1])) this.d(file, c.no, 'P052');
              else op.tolerances.set(tm[1], tol);
            },
          },
        ],
        [
          'audit',
          {
            fn: (c) => {
              if (c.rest !== '' && c.rest !== 'text') this.d(file, c.no, 'P050');
              else op.audit = true;
            },
          },
        ],
        [
          'request',
          {
            once: true,
            fn: (c) => {
              const v = this.requestValue(file, c.no, c.rest);
              if (v) op.request = v;
            },
          },
        ],
        // The rest of the language (OPEN-RC-001).
        ['returns', { lines: true, fn: () => {} }],
      ]),
    );
  }

  req(file: string, st: Statement): void {
    const req: Req = {
      id: this.idTitle(file, st),
      file,
      line: st.no,
      decisions: [],
      platform: 'any',
      examples: [],
    };
    this.model.reqs.push(req);
    const add = (ex: Example) => {
      ex.caseId = `${req.id}#${req.examples.length + 1}`;
      req.examples.push(ex);
    };
    this.runClauses(
      file,
      st.body,
      new Map<string, ClauseRule>([
        ['text', { once: true, lines: true, fn: (c) => (req.text = { line: c.no, text: this.text(file, c) }) }],
        ['decision', { fn: (c) => req.decisions.push(...c.rest.split(/[\s,]+/).filter(Boolean)) }],
        [
          'on',
          {
            once: true,
            fn: (c) => {
              if (c.rest === 'any' || c.rest === 'posix' || c.rest === 'windows') req.platform = c.rest;
              else this.d(file, c.no, 'P033');
            },
          },
        ],
        [
          'example',
          {
            lines: true,
            fn: (c) => {
              const ex = this.example(file, c);
              if (ex) add(ex);
            },
          },
        ],
        ['table', { lines: true, fn: (c) => this.table(file, c).forEach(add) }],
        // The rest of the language (OPEN-RC-001).
        ['static', { lines: true, fn: () => {} }],
      ]),
    );
  }

  /** Reads an example (REQ-SY-010, REQ-SY-011); undefined when its first line drops it. */
  example(file: string, c: Clause): Example | undefined {
    let ex: Example | undefined;
    let raw = false;
    if (c.rest === '') {
      this.d(file, c.no, 'P012');
    } else {
      const { kw: op, rest: arg } = split(c.rest);
      const base = { file, line: c.no, caseId: '', omit: [], expects: [], row: false };
      if (op === 'raw') {
        raw = true;
        let line: string | undefined;
        if (arg.startsWith('"')) {
          try {
            const v = JSON.parse(arg);
            if (typeof v === 'string') line = v;
          } catch {
            // P004 below
          }
        } else if (arg.length >= 2 && arg.startsWith("'") && arg.endsWith("'")) {
          line = arg.slice(1, -1);
        }
        if (line === undefined) this.d(file, c.no, 'P004');
        else if (/[\r\n]/.test(line)) this.d(file, c.no, 'P026');
        else ex = { ...base, raw: true, rawLine: line, input: {} };
      } else if (arg === '') {
        ex = { ...base, raw: false, op, input: {} };
      } else {
        const p = parseFinite(arg);
        if (!p) this.d(file, c.no, 'P009');
        else if (!isPlainObject(p.value)) this.d(file, c.no, 'P012');
        else ex = { ...base, raw: false, op, inputText: arg, input: p.value };
      }
    }

    const input: JsonObject = ex && !raw ? ex.input : {};
    const expects: Expect[] = [];
    const omit: string[] = [];
    let request: JsonObject | undefined;
    let requestRead = false;
    let inputLines = false;
    const lines = c.lines;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.blank) continue;
      if (l.indent !== 4 || l.content.startsWith('#')) {
        if (!l.content.startsWith('#')) this.d(file, l.no, 'P006');
        continue;
      }
      const { kw, rest: arg } = split(l.content);
      if (kw === 'expect') {
        const e = this.expect(file, l.no, arg);
        if (e) expects.push(e);
      } else if (kw === 'request') {
        if (raw) this.d(file, l.no, 'P022');
        else if (requestRead) this.d(file, l.no, 'P052');
        else {
          request = this.requestValue(file, l.no, arg);
          requestRead = request !== undefined;
        }
      } else if (kw === 'omit') {
        if (raw) this.d(file, l.no, 'P022');
        else {
          const names = arg.split(/[\s,]+/).filter(Boolean);
          if (names.length === 0) this.d(file, l.no, 'P011');
          omit.push(...names);
        }
      } else if (kw === 'input') {
        const from = fromForm(arg);
        let text: Line[] = [];
        if (!from) {
          let j = i + 1;
          while (j < lines.length && (lines[j].blank || lines[j].indent >= 6)) j++;
          text = lines.slice(i + 1, j);
          i = j - 1;
          while (text.length && text[text.length - 1].blank) text.pop();
        }
        if (raw) {
          this.d(file, l.no, 'P022');
          continue;
        }
        inputLines = true;
        this.inputLine(file, l.no, input, from, from ? from.path : arg, text);
      } else {
        this.d(file, l.no, 'P011');
      }
    }
    if (!ex) return undefined;
    ex.expects = expects;
    ex.omit = omit;
    ex.request = request;
    if (!raw && inputLines) ex.inputText = JSON.stringify(input);
    return ex;
  }

  inputLine(
    file: string,
    no: number,
    input: JsonObject,
    from: { name: string } | undefined,
    pathText: string,
    text: Line[],
  ): void {
    const names = parseInputPath(pathText);
    if (!names) {
      this.d(file, no, 'P049');
      return;
    }
    let value: string;
    if (from) {
      const target = this.resolveFrom(file, from.name);
      if (target === undefined) {
        this.d(file, no, 'P048');
        return;
      }
      value = this.files.get(target)!;
    } else {
      value = text.map((l) => l.text.slice(6) + '\n').join('');
    }
    let cur: unknown = input;
    for (const k of names.slice(0, -1)) {
      if (!isPlainObject(cur)) break;
      cur = hasOwn(cur, k) ? cur[k] : {};
    }
    if (!isPlainObject(cur) || (!from && text.length === 0)) {
      this.d(file, no, 'P049');
      return;
    }
    let obj = input;
    for (const k of names.slice(0, -1)) {
      if (!hasOwn(obj, k)) setOwn(obj, k, {});
      obj = obj[k] as JsonObject;
    }
    setOwn(obj, names[names.length - 1], value);
  }

  /** The request file a `from` name names, inside the record's folder (REQ-SY-011). */
  resolveFrom(exampleFile: string, name: string): string | undefined {
    const parts = exampleFile.split('/');
    parts.pop();
    for (const p of name.split('/')) {
      if (p === '' || p === '.') continue;
      if (p === '..') {
        if (parts.length === 0) return undefined;
        parts.pop();
      } else parts.push(p);
    }
    const full = parts.join('/');
    const folder = this.record.folder;
    if (folder !== '' && !full.startsWith(folder + '/')) return undefined;
    return this.files.has(full) ? full : undefined;
  }

  expect(file: string, no: number, arg: string): Expect | undefined {
    const path = /^[^\s=≈~]*/.exec(arg)![0];
    const op = arg.slice(path.length).trimStart();
    if (path === '' || !(op.startsWith('=') || op.startsWith('≈') || op.startsWith('~'))) {
      this.d(file, no, 'P011');
      return undefined;
    }
    if (op[0] === '=') {
      const v = op.slice(1).trim();
      if (v === '?') return { line: no, path, kind: 'oracle' };
      const p = parseFinite(v);
      if (!p) {
        this.d(file, no, 'P009');
        return undefined;
      }
      return { line: no, path, kind: 'eq', value: p.value };
    }
    const am = APPROX.exec(op.slice(1));
    const value = am ? jsonNumber(am[1]) : undefined;
    const tol = am ? jsonTolerance(am[2]) : undefined;
    if (value === undefined || tol === undefined) {
      this.d(file, no, 'P010');
      return undefined;
    }
    return { line: no, path, kind: 'approx', value, tol };
  }

  /** Reads a table (REQ-SY-012): one example per row. */
  table(file: string, c: Clause): Example[] {
    const rows: Line[] = [];
    for (const l of c.lines) {
      if (l.blank) continue;
      if (l.indent >= 4 && l.content.startsWith('|')) rows.push(l);
      else if (!l.content.startsWith('#')) this.d(file, l.no, 'P006');
    }
    const real = rows.filter((r) => !isSeparator(r.content));
    const op = words(c.rest);
    if (op.length !== 1 || real.length < 2) {
      this.d(file, c.no, 'P013');
      return [];
    }
    const [header, ...body] = real;
    const cols: { name: string; field: boolean; tol?: number }[] = [];
    for (const cell of splitRow(header.content)) {
      const hc = headerCell(cell);
      const path = hc !== undefined && isExpectationPath(hc.name);
      const field = hc !== undefined && !path && WORD.test(hc.name);
      if (!hc || (!path && !field) || cols.some((col) => col.name === hc.name)) {
        this.d(file, header.no, 'P013');
        return [];
      }
      const col: { name: string; field: boolean; tol?: number } = { name: hc.name, field };
      if (hc.tol !== undefined) {
        const t = field ? undefined : jsonTolerance(hc.tol);
        if (t === undefined) this.d(file, header.no, 'P010');
        else col.tol = t;
      }
      cols.push(col);
    }
    const out: Example[] = [];
    for (const row of body) {
      const cells = splitRow(row.content);
      if (cells.length !== cols.length) {
        this.d(file, row.no, 'P014');
        continue;
      }
      const parts: string[] = [];
      const input: JsonObject = {};
      const expects: Expect[] = [];
      cols.forEach((col, k) => {
        const cell = cells[k];
        if (cell === '') return;
        if (!col.field && cell === '?') {
          expects.push({ line: row.no, path: col.name, kind: 'oracle' });
        } else if (col.tol !== undefined) {
          const n = jsonNumber(cell);
          if (n === undefined) this.d(file, row.no, 'P010');
          else expects.push({ line: row.no, path: col.name, kind: 'approx', value: n, tol: col.tol });
        } else {
          const p = parseFinite(cell);
          if (!p) this.d(file, row.no, 'P009');
          else if (col.field) {
            parts.push(`${JSON.stringify(col.name)}:${cell}`);
            setOwn(input, col.name, p.value);
          } else expects.push({ line: row.no, path: col.name, kind: 'eq', value: p.value });
        }
      });
      out.push({
        file,
        line: row.no,
        caseId: '',
        raw: false,
        op: op[0],
        inputText: `{${parts.join(',')}}`,
        input,
        omit: [],
        expects,
        row: true,
      });
    }
    return out;
  }
}
