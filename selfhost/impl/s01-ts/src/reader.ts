import { isObj, parseNumber, parseQuoted, scanPath, scanString, setOwn, getOwn, splitTopLevel, tryParse } from './util.ts';

export type Level = 'error' | 'warning' | 'info';
export interface Diag {
  file: string;
  line: number;
  level: Level;
  code: string;
}

export interface Expect {
  line: number;
  path: string[];
  kind: 'eq' | 'approx' | 'oracle';
  value?: unknown;
  tol?: number;
}

export interface Example {
  file: string;
  line: number;
  raw: string | null;
  op: string | null;
  inputText: string | null;
  inputObj: Record<string, unknown> | null;
  hasInputLines: boolean;
  request: Map<string, unknown>;
  omit: string[];
  expects: Expect[];
  fields: string[];
}

export interface TextItem {
  file?: string;
  line: number;
  text: string;
}

export interface Req {
  file: string;
  line: number;
  id: string;
  texts: TextItem[];
  decisions: string[];
  platform: string;
  examples: Example[];
}

export interface OpenItem {
  file: string;
  line: number;
  id: string;
  texts: TextItem[];
  exampleLines: number[];
}

export interface Decision {
  file: string;
  line: number;
  id: string;
  source: string | null;
  status: string | null;
  texts: TextItem[];
  rejected: string[];
}

export interface Field {
  name: string;
  optional: boolean;
}

export interface Op {
  file: string;
  line: number;
  name: string;
  fields: Field[];
  result: string | null;
  tolerances: Map<string, number>;
  audit: boolean;
  request: Map<string, unknown> | null;
}

export interface Rec {
  diags: Diag[];
  spec: { file: string; line: number; texts: TextItem[]; request: Map<string, unknown> } | null;
  oracle: { file: string; line: number; command: string } | null;
  errors: { file: string; line: number; items: { code: string; cond: string; line: number }[] } | null;
  ops: Map<string, Op>;
  reqs: Req[];
  opens: OpenItem[];
  decisions: Decision[];
  sectionTexts: TextItem[];
  noteTexts: TextItem[];
  versions: string[];
  hasSpecStatement: boolean;
}

export function newRec(): Rec {
  return {
    diags: [],
    spec: null,
    oracle: null,
    errors: null,
    ops: new Map(),
    reqs: [],
    opens: [],
    decisions: [],
    sectionTexts: [],
    noteTexts: [],
    versions: [],
    hasSpecStatement: false,
  };
}

interface L {
  n: number;
  indent: number;
  text: string;
  blank: boolean;
}

interface Clause {
  kw: string;
  rest: string;
  line: number;
  sub: L[];
}

interface Stmt {
  kw: string;
  rest: string;
  line: number;
  body: L[];
}

const KNOWN = new Set(['duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note']);
const LATER = new Set(['type', 'edge', 'edgedef', 'property', 'evidence']);
const VERSIONS = new Set(['0.1', '0.2']);
const ROOTS = new Set(['result', 'audit', 'error', 'id']);

function firstWord(s: string): string {
  return s.split(/\s+/)[0];
}

function dirOf(name: string): string {
  const i = name.lastIndexOf('/');
  return i < 0 ? '' : name.slice(0, i);
}

function resolveRel(dir: string, rel: string): string | null {
  const parts = (dir === '' ? [] : dir.split('/')).concat(rel.split('/'));
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(p);
  }
  return out.join('/');
}

export function readFile(name: string, source: string, rec: Rec, files: Record<string, string>): void {
  const P = (line: number, code: string): void => {
    rec.diags.push({ file: name, line, level: 'error', code });
  };

  // ---- lines
  const src = source.replace(/^﻿/, '');
  const rawLines = src.split(/\r\n|\r|\n/);
  const lines: L[] = [];
  rawLines.forEach((raw, i) => {
    const n = i + 1;
    const t = raw.replace(/\s+$/, '');
    if (t === '') {
      lines.push({ n, indent: 0, text: '', blank: true });
      return;
    }
    const lead = /^\s*/.exec(t)![0];
    if (/[^ ]/.test(lead)) {
      P(n, 'P001');
      return;
    }
    lines.push({ n, indent: lead.length, text: t.slice(lead.length), blank: false });
  });

  // ---- statements
  const stmts: Stmt[] = [];
  let cur: Stmt | null = null;
  for (const l of lines) {
    if (l.blank) {
      cur?.body.push(l);
      continue;
    }
    if (l.indent === 0) {
      if (l.text.startsWith('#')) continue;
      const kw = firstWord(l.text);
      cur = { kw, rest: l.text.slice(kw.length).trim(), line: l.n, body: [] };
      stmts.push(cur);
    } else if (cur === null) {
      P(l.n, 'P003');
    } else cur.body.push(l);
  }

  // ---- helpers
  function clausesOf(body: L[]): Clause[] {
    const out: Clause[] = [];
    let c: Clause | null = null;
    for (const l of body) {
      if (l.blank) {
        c?.sub.push(l);
        continue;
      }
      if (l.indent === 1) {
        P(l.n, 'P007');
        continue;
      }
      if (l.indent === 2) {
        if (l.text.startsWith('#')) continue;
        const kw = firstWord(l.text);
        c = { kw, rest: l.text.slice(kw.length).trim(), line: l.n, sub: [] };
        out.push(c);
        continue;
      }
      if (c === null) {
        P(l.n, 'P006');
        continue;
      }
      c.sub.push(l);
    }
    return out;
  }

  function noSub(c: Clause): void {
    for (const l of c.sub) if (!l.blank && !l.text.startsWith('#')) P(l.n, 'P006');
  }

  function textOf(c: Clause): string {
    if (c.rest !== '') P(c.line, 'P008');
    const out: string[] = [];
    for (const l of c.sub) {
      if (l.blank) out.push('');
      else if (l.indent < 4) P(l.n, 'P008');
      else out.push(' '.repeat(l.indent - 4) + l.text);
    }
    while (out.length && out[0] === '') out.shift();
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n');
  }

  function quotedClause(c: Clause): string | null {
    noSub(c);
    const q = parseQuoted(c.rest);
    if (!q.ok) {
      P(c.line, 'P004');
      return null;
    }
    return q.value;
  }

  function plain(c: Clause): void {
    noSub(c);
  }

  function requestObj(c: Clause): Map<string, unknown> | null {
    noSub(c);
    const r = tryParse(c.rest);
    if (!r.ok || !isObj(r.value)) {
      P(c.line, 'P009');
      return null;
    }
    if (Object.hasOwn(r.value, 'id') || Object.hasOwn(r.value, 'op') || Object.hasOwn(r.value, 'input')) {
      P(c.line, 'P051');
      return null;
    }
    return new Map(Object.entries(r.value));
  }

  /** `<ID> "<title>"` after a statement keyword. */
  function idTitle(s: Stmt): string {
    const m = /^(\S+)\s*([\s\S]*)$/.exec(s.rest);
    if (!m) {
      P(s.line, 'P005');
      return '';
    }
    const id = m[1];
    const r = m[2];
    if (!r.startsWith('"')) {
      P(s.line, 'P005');
      return id;
    }
    const e = scanString(r, 0);
    if (e < 0) {
      P(s.line, 'P004');
      return id;
    }
    const lit = tryParse(r.slice(0, e));
    if (!lit.ok || typeof lit.value !== 'string') {
      P(s.line, 'P004');
      return id;
    }
    if (e < r.length) P(s.line, /\s/.test(r[e]) ? 'P005' : 'P004');
    return id;
  }

  function mergeInto(dst: Map<string, unknown>, src2: Map<string, unknown>): void {
    for (const [k, v] of src2) dst.set(k, v);
  }

  // ---- examples
  function readPathStr(s: string): { segs: string[]; rest: string } | null {
    const p = scanPath(s, 0);
    if (!p) return null;
    return { segs: p.segs, rest: s.slice(p.end) };
  }

  function parseExpect(l: L, text: string, ex: Example): void {
    const rest0 = text.slice('expect'.length);
    if (!/^\s/.test(rest0)) {
      P(l.n, 'P011');
      return;
    }
    const pr = readPathStr(rest0.trim());
    if (!pr) {
      P(l.n, 'P011');
      return;
    }
    const m = /^\s*(=|≈|~)\s*([\s\S]*)$/.exec(pr.rest);
    if (!m) {
      P(l.n, 'P011');
      return;
    }
    const op = m[1];
    const val = m[2];
    if (op === '=') {
      if (val === '?') {
        ex.expects.push({ line: l.n, path: pr.segs, kind: 'oracle' });
        return;
      }
      const r = tryParse(val);
      if (!r.ok) {
        P(l.n, 'P009');
        return;
      }
      ex.expects.push({ line: l.n, path: pr.segs, kind: 'eq', value: r.value });
      return;
    }
    const mm = /^([\s\S]*?)\s*(?:±|\+-)\s*([\s\S]*)$/.exec(val);
    if (!mm) {
      P(l.n, 'P010');
      return;
    }
    const num = parseNumber(mm[1]);
    const tol = parseNumber(mm[2]);
    if (num === null || tol === null || tol < 0) {
      P(l.n, 'P010');
      return;
    }
    ex.expects.push({ line: l.n, path: pr.segs, kind: 'approx', value: num, tol });
  }

  function parseExample(c: Clause): Example {
    const ex: Example = {
      file: name,
      line: c.line,
      raw: null,
      op: null,
      inputText: null,
      inputObj: null,
      hasInputLines: false,
      request: new Map(),
      omit: [],
      expects: [],
      fields: [],
    };
    let isRaw = false;
    let baseValid = true;
    let work: Record<string, unknown> = {};
    const rest = c.rest;
    if (rest === '') {
      P(c.line, 'P012');
      baseValid = false;
    } else {
      const w = firstWord(rest);
      const arg = rest.slice(w.length).trim();
      if (w === 'raw') {
        isRaw = true;
        baseValid = false;
        if (arg.startsWith("'")) {
          const a = arg.indexOf("'");
          const b = arg.lastIndexOf("'");
          if (b > a) ex.raw = arg.slice(a + 1, b);
          else P(c.line, 'P004');
        } else {
          const q = parseQuoted(arg);
          if (!q.ok) P(c.line, 'P004');
          else if (/[\n\r]/.test(q.value)) P(c.line, 'P026');
          else ex.raw = q.value;
        }
      } else {
        ex.op = w;
        if (arg !== '') {
          const r = tryParse(arg);
          if (!r.ok) {
            P(c.line, 'P009');
            baseValid = false;
          } else if (!isObj(r.value)) {
            P(c.line, 'P012');
            baseValid = false;
          } else {
            ex.inputText = arg;
            work = r.value;
            ex.inputObj = r.value;
          }
        }
      }
    }

    const sub = c.sub;
    for (let i = 0; i < sub.length; i++) {
      const l = sub[i];
      if (l.blank) continue;
      if (l.text.startsWith('#')) continue;
      if (l.indent !== 4) {
        P(l.n, 'P006');
        continue;
      }
      const kw = firstWord(l.text);
      const arg = l.text.slice(kw.length).trim();
      if (kw === 'expect') {
        parseExpect(l, l.text, ex);
      } else if (kw === 'request') {
        if (isRaw) P(l.n, 'P022');
        else {
          const m = requestObj({ kw, rest: arg, line: l.n, sub: [] });
          if (m) mergeInto(ex.request, m);
        }
      } else if (kw === 'omit') {
        if (isRaw) P(l.n, 'P022');
        else {
          const names = arg.split(/[\s,]+/).filter((x) => x !== '');
          if (names.length === 0) P(l.n, 'P011');
          else ex.omit.push(...names);
        }
      } else if (kw === 'input') {
        // gather the text block
        const textLines: string[] = [];
        let j = i + 1;
        while (j < sub.length) {
          const l2 = sub[j];
          if (l2.blank) textLines.push('');
          else if (l2.indent >= 6) textLines.push(' '.repeat(l2.indent - 6) + l2.text);
          else break;
          j++;
        }
        i = j - 1;
        while (textLines.length && textLines[textLines.length - 1] === '') textLines.pop();
        if (isRaw) {
          P(l.n, 'P022');
          continue;
        }
        ex.hasInputLines = true;
        const pr = readPathStr(arg);
        if (!pr) {
          P(l.n, 'P049');
          continue;
        }
        const r = pr.rest.trim();
        let value: string | null = null;
        if (r === '') {
          if (textLines.length === 0) {
            P(l.n, 'P049');
            continue;
          }
          value = textLines.join('\n') + '\n';
        } else {
          const fm = /^from\s+([\s\S]*)$/.exec(r);
          if (!/^\s/.test(pr.rest) && pr.rest !== '' || !fm) {
            P(l.n, 'P049');
            continue;
          }
          const q = parseQuoted(fm[1]);
          if (!q.ok) {
            P(l.n, 'P004');
            continue;
          }
          const target = resolveRel(dirOf(name), q.value);
          if (target === null || !Object.hasOwn(files, target)) {
            P(l.n, 'P048');
            continue;
          }
          value = files[target];
        }
        if (!baseValid && ex.op === null) continue;
        if (!baseValid) continue;
        // set the path
        let o: Record<string, unknown> = work;
        let ok = true;
        for (let k = 0; k < pr.segs.length - 1; k++) {
          const key = pr.segs[k];
          const v = getOwn(o, key);
          if (v === undefined) {
            const n: Record<string, unknown> = {};
            setOwn(o, key, n);
            o = n;
          } else if (isObj(v)) o = v;
          else {
            ok = false;
            break;
          }
        }
        if (!ok) {
          P(l.n, 'P049');
          continue;
        }
        setOwn(o, pr.segs[pr.segs.length - 1], value);
      } else {
        P(l.n, 'P011');
      }
    }
    if (ex.hasInputLines) {
      ex.inputObj = work;
      ex.inputText = null;
    }
    ex.fields = ex.inputObj ? Object.keys(ex.inputObj) : [];
    return ex;
  }

  // ---- tables
  function splitRow(t: string): string[] {
    const s = t.slice(1);
    const cells: string[] = [];
    let cur2 = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && s[i + 1] === '|') {
        cur2 += '|';
        i++;
      } else if (ch === '|') {
        cells.push(cur2);
        cur2 = '';
      } else cur2 += ch;
    }
    if (cur2.trim() !== '') cells.push(cur2);
    return cells.map((x) => x.trim());
  }

  type Col =
    | { type: 'field'; name: string }
    | { type: 'exp'; path: string[]; tol?: number }
    | { type: 'bad' };

  function parseTable(c: Clause): Example[] {
    const words = c.rest.split(/\s+/).filter((x) => x !== '');
    const op = words.length === 1 ? words[0] : null;
    let bad = op === null;
    const rows: { n: number; cells: string[] }[] = [];
    for (const l of c.sub) {
      if (l.blank) continue;
      if (l.indent >= 4 && l.text.startsWith('|')) {
        if (/^\|[-:| ]*\|$/.test(l.text) && l.text.length >= 2) continue;
        rows.push({ n: l.n, cells: splitRow(l.text) });
      } else if (l.text.startsWith('#')) continue;
      else P(l.n, 'P006');
    }
    if (rows.length < 2) bad = true;
    if (bad) {
      P(c.line, 'P013');
      if (rows.length < 2) return [];
    }
    const header = rows[0];
    const cols: Col[] = header.cells.map((cell): Col => {
      if (cell === '') {
        P(header.n, 'P013');
        return { type: 'bad' };
      }
      const m = /^([\s\S]*?)\s*(±|\+-)\s*([\s\S]*)$/.exec(cell);
      const nm = m ? m[1] : cell;
      const p = scanPath(nm, 0);
      if (!p || p.end !== nm.length) {
        P(header.n, 'P013');
        return { type: 'bad' };
      }
      const isExp = ROOTS.has(p.segs[0]) && /^(?:result|audit|error|id)(?:\.|$)/.test(nm);
      let tol: number | undefined;
      let tolBad = false;
      if (m) {
        const t = parseNumber(m[3]);
        if (t === null || t < 0) tolBad = true;
        else tol = t;
      }
      if (!isExp) {
        if (p.segs.length !== 1 || !/^[A-Za-z0-9_-]+$/.test(nm)) {
          P(header.n, 'P013');
          return { type: 'bad' };
        }
        if (m) P(header.n, 'P010');
        return { type: 'field', name: nm };
      }
      if (tolBad) P(header.n, 'P010');
      return { type: 'exp', path: p.segs, tol };
    });
    const out: Example[] = [];
    for (const row of rows.slice(1)) {
      if (row.cells.length !== cols.length) {
        P(row.n, 'P014');
        continue;
      }
      const ex: Example = {
        file: name,
        line: row.n,
        raw: null,
        op,
        inputText: null,
        inputObj: null,
        hasInputLines: false,
        request: new Map(),
        omit: [],
        expects: [],
        fields: [],
      };
      const parts: string[] = [];
      cols.forEach((col, k) => {
        const cell = row.cells[k];
        if (cell === '' || col.type === 'bad') return;
        if (col.type === 'field') {
          if (!tryParse(cell).ok) {
            P(row.n, 'P009');
            return;
          }
          parts.push(`${JSON.stringify(col.name)}:${cell}`);
          ex.fields.push(col.name);
          return;
        }
        if (cell === '?') {
          ex.expects.push({ line: row.n, path: col.path, kind: 'oracle' });
          return;
        }
        if (col.tol !== undefined) {
          const num = parseNumber(cell);
          if (num === null) {
            P(row.n, 'P010');
            return;
          }
          ex.expects.push({ line: row.n, path: col.path, kind: 'approx', value: num, tol: col.tol });
          return;
        }
        const r = tryParse(cell);
        if (!r.ok) {
          P(row.n, 'P009');
          return;
        }
        ex.expects.push({ line: row.n, path: col.path, kind: 'eq', value: r.value });
      });
      ex.inputText = `{${parts.join(',')}}`;
      out.push(ex);
    }
    return out;
  }

  // ---- statements
  let fileHasDuramen = false;
  for (const s of stmts) {
    if (LATER.has(s.kw)) continue;
    if (!KNOWN.has(s.kw)) {
      P(s.line, 'P002');
      continue;
    }
    const clauses = clausesOf(s.body);
    switch (s.kw) {
      case 'duramen': {
        const words = s.rest.split(/\s+/).filter((x) => x !== '');
        if (fileHasDuramen) P(s.line, 'P023');
        else if (words.length !== 1 || !VERSIONS.has(words[0])) P(s.line, 'P023');
        else rec.versions.push(words[0]);
        fileHasDuramen = true;
        for (const c of clauses) {
          P(c.line, 'P015');
          noSub(c);
        }
        break;
      }
      case 'spec': {
        const words = s.rest.split(/\s+/).filter((x) => x !== '');
        if (words.length !== 2) P(s.line, 'P021');
        const first = !rec.hasSpecStatement;
        if (!first) P(s.line, 'P044');
        rec.hasSpecStatement = true;
        const texts: TextItem[] = [];
        let request = new Map<string, unknown>();
        for (const c of clauses) {
          if (c.kw === 'title') quotedClause(c);
          else if (c.kw === 'text') texts.push({ line: s.line, text: textOf(c) });
          else if (c.kw === 'contract') plain(c);
          else if (c.kw === 'request') {
            const m = requestObj(c);
            if (m) mergeInto(request, m);
          } else {
            P(c.line, 'P015');
            noSub(c);
          }
        }
        if (first) rec.spec = { file: name, line: s.line, texts, request };
        break;
      }
      case 'oracle': {
        if (s.rest === '') P(s.line, 'P028');
        const first = rec.oracle === null && !rec.diags.some((d) => d.code === 'P044' && false);
        const dup = rec.oracle !== null;
        if (dup) P(s.line, 'P044');
        for (const c of clauses) {
          if (c.kw === 'source') plain(c);
          else {
            P(c.line, 'P015');
            noSub(c);
          }
        }
        if (first && !dup) rec.oracle = { file: name, line: s.line, command: s.rest };
        break;
      }
      case 'section':
      case 'note': {
        if (s.kw === 'section') idTitle(s);
        else if (s.rest !== '') P(s.line, 'P050');
        const texts = s.kw === 'section' ? rec.sectionTexts : rec.noteTexts;
        for (const c of clauses) {
          if (c.kw === 'text') texts.push({ file: name, line: s.line, text: textOf(c) });
          else {
            P(c.line, 'P015');
            noSub(c);
          }
        }
        break;
      }
      case 'op': {
        const words = s.rest.split(/\s+/).filter((x) => x !== '');
        if (words.length !== 1) P(s.line, 'P031');
        const op: Op = {
          file: name,
          line: s.line,
          name: words[0] ?? '',
          fields: [],
          result: null,
          tolerances: new Map(),
          audit: false,
          request: null,
        };
        for (const c of clauses) {
          if (c.kw === 'input') {
            noSub(c);
            for (const f of splitTopLevel(c.rest)) {
              const m = /^([A-Za-z0-9_-]+)(\?)?\s+(\S[\s\S]*)$/.exec(f.trim());
              if (!m) P(c.line, 'P017');
              else op.fields.push({ name: m[1], optional: m[2] === '?' });
            }
          } else if (c.kw === 'result') {
            noSub(c);
            op.result = c.rest;
          } else if (c.kw === 'tolerance') {
            noSub(c);
            const p = scanPath(c.rest, 0);
            const num = p ? parseNumber(c.rest.slice(p.end)) : null;
            if (!p || !/^\s/.test(c.rest.slice(p.end)) || num === null || num < 0) P(c.line, 'P018');
            else op.tolerances.set(c.rest.slice(0, p.end), num);
          } else if (c.kw === 'audit') {
            noSub(c);
            op.audit = true;
          } else if (c.kw === 'request') {
            const m = requestObj(c);
            if (m) {
              if (!op.request) op.request = new Map();
              mergeInto(op.request, m);
            }
          } else {
            P(c.line, 'P015');
            noSub(c);
          }
        }
        if (words.length >= 1 && !rec.ops.has(op.name)) rec.ops.set(op.name, op);
        break;
      }
      case 'errors': {
        if (s.rest !== '') P(s.line, 'P050');
        const dup = rec.errors !== null;
        if (dup) P(s.line, 'P032');
        const items: { code: string; cond: string; line: number }[] = [];
        for (const c of clauses) {
          const w = firstWord(c.rest);
          const after = w === 'when' ? c.rest.slice(4).trim() : '';
          const cont: string[] = [];
          for (const l of c.sub) {
            if (l.blank) continue;
            if (l.indent < 4) P(l.n, 'P006');
            else cont.push(' '.repeat(l.indent - 4) + l.text);
          }
          const cond = [after, ...cont].filter((x) => x !== '').join('\n');
          if (w !== 'when' || cond === '') P(c.line, 'P019');
          else items.push({ code: c.kw, cond, line: c.line });
        }
        if (!dup) rec.errors = { file: name, line: s.line, items };
        break;
      }
      case 'req': {
        const id = idTitle(s);
        const req: Req = { file: name, line: s.line, id, texts: [], decisions: [], platform: 'any', examples: [] };
        for (const c of clauses) {
          if (c.kw === 'text') req.texts.push({ line: c.line, text: textOf(c) });
          else if (c.kw === 'decision') {
            noSub(c);
            req.decisions.push(...c.rest.split(/[\s,]+/).filter((x) => x !== ''));
          } else if (c.kw === 'on') {
            noSub(c);
            if (c.rest === 'any' || c.rest === 'posix' || c.rest === 'windows') req.platform = c.rest;
            else P(c.line, 'P033');
          } else if (c.kw === 'example') req.examples.push(parseExample(c));
          else if (c.kw === 'table') req.examples.push(...parseTable(c));
          else {
            P(c.line, 'P015');
            noSub(c);
          }
        }
        rec.reqs.push(req);
        break;
      }
      case 'open': {
        const id = idTitle(s);
        const item: OpenItem = { file: name, line: s.line, id, texts: [], exampleLines: [] };
        for (const c of clauses) {
          if (c.kw === 'text') item.texts.push({ line: s.line, text: textOf(c) });
          else if (c.kw === 'example') {
            parseExample(c);
            item.exampleLines.push(c.line);
          } else if (c.kw === 'table') {
            parseTable(c);
            item.exampleLines.push(c.line);
          } else {
            P(c.line, 'P015');
            noSub(c);
          }
        }
        rec.opens.push(item);
        break;
      }
      case 'decision': {
        const id = idTitle(s);
        const d: Decision = { file: name, line: s.line, id, source: null, status: null, texts: [], rejected: [] };
        for (const c of clauses) {
          if (c.kw === 'source') {
            plain(c);
            d.source = c.rest;
          } else if (c.kw === 'status') {
            plain(c);
            d.status = c.rest;
          } else if (c.kw === 'text') d.texts.push({ line: s.line, text: textOf(c) });
          else if (c.kw === 'rejected') {
            const q = quotedClause(c);
            if (q !== null) d.rejected.push(q);
          } else {
            P(c.line, 'P015');
            noSub(c);
          }
        }
        rec.decisions.push(d);
        break;
      }
    }
  }
  if (!fileHasDuramen) P(1, 'P020');
}
