import {
  type Diag, type Obj, splitFirst, words, parseJson, isPlainObject, parseNumber, parseJsonString,
  setKey, hasOwn,
} from './util.ts';

export interface Expect { line: number; path: string; kind: 'eq' | 'approx' | 'oracle'; value?: unknown; tol?: number }

export interface Item {
  file: string;
  line: number;
  op: string;
  raw: boolean;
  rawLine?: string;
  inputText?: string;
  inputKeys: string[];
  request?: Obj;
  omit: Set<string>;
  expects: Expect[];
}

export interface Field { name: string; optional: boolean }
export interface TextBlock { line: number; text: string }

export type Stmt =
  | { k: 'duramen' }
  | { k: 'spec'; file: string; line: number; text?: TextBlock; request?: Obj }
  | { k: 'oracle'; file: string; line: number; command: string }
  | { k: 'section'; file: string; line: number; id: string; text?: TextBlock }
  | {
    k: 'op'; file: string; line: number; name?: string; fields: Field[]; result?: string;
    tolerances: Map<string, number>; audit: boolean; request?: Obj;
  }
  | { k: 'errors'; file: string; line: number; clauses: { code: string; line: number; cond: string }[] }
  | {
    k: 'req'; file: string; line: number; id: string; platform: string; decisions: string[];
    text?: TextBlock; items: Item[]; hasStatic: boolean;
  }
  | { k: 'open'; file: string; line: number; id: string; text?: TextBlock; tests: number[] }
  | {
    k: 'decision'; file: string; line: number; id: string; source: string; status?: string;
    text?: TextBlock; rejected: string[];
  }
  | { k: 'note'; file: string; line: number; text?: TextBlock };

export interface FileResult { stmts: Stmt[]; hasDuramen: boolean; version?: string }

export interface ReadEnv {
  files: Record<string, string>;
  folder: string; // the record's folder, '' for the root
}

interface Ln { no: number; indent: number; blank: boolean; content: string }
interface Clause { kw: string; rest: string; line: number; sub: Ln[] }
interface RawStmt { kw: string; rest: string; line: number; body: Ln[] }

const CORE = new Set(['duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note']);
const OTHER = new Set(['type', 'edge', 'edgedef', 'property', 'evidence']);

const NUM = '-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';
const APPROX = new RegExp(`^\\s*(${NUM})\\s*(?:±|\\+-)\\s*([\\s\\S]*)$`);

export function parsePath(s: string): string[] | null {
  const segs: string[] = [];
  let i = 0;
  for (;;) {
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      if (j >= s.length) return null;
      const str = parseJsonString(s.slice(i, j + 1));
      if (str === undefined) return null;
      segs.push(str);
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

function splitRow(text: string): string[] {
  const cells: string[] = [];
  let cur = '';
  for (let i = 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && text[i + 1] === '|') { cur += '|'; i++; }
    else if (c === '|') { cells.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  if (cur.trim() !== '') cells.push(cur.trim());
  return cells;
}

const SEPARATOR = /^\|(?:[-:| ]*\|)?$/;

// Where a record's file named by `rel` lives, or undefined when it is outside the folder or absent.
function resolveInput(env: ReadEnv, from: string, rel: string): string | undefined {
  if (rel === '' || rel.startsWith('/')) return undefined;
  const stack = from.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (stack.length === 0) return undefined; stack.pop(); } else stack.push(seg);
  }
  const base = env.folder === '' ? [] : env.folder.split('/');
  if (stack.length < base.length || base.some((b, i) => stack[i] !== b)) return undefined;
  const name = stack.join('/');
  return hasOwn(env.files, name) ? env.files[name] : undefined;
}

export function readFile(name: string, text: string, env: ReadEnv, diags: Diag[]): FileResult {
  const add = (line: number, code: string): void => {
    diags.push({ file: name, line, level: 'error', code });
  };
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const raws: RawStmt[] = [];
  let cur: RawStmt | undefined;
  text.split(/\r\n|\r|\n/).forEach((ln, idx) => {
    const no = idx + 1;
    const t = ln.trimEnd();
    if (t === '') { cur?.body.push({ no, indent: 0, blank: true, content: '' }); return; }
    const lead = /^\s*/.exec(t)![0];
    if (/[^ ]/.test(lead)) { add(no, 'P001'); return; }
    const indent = lead.length;
    const content = t.slice(indent);
    if (indent === 0) {
      if (content.startsWith('#')) return;
      const [kw, rest] = splitFirst(content);
      cur = { kw, rest, line: no, body: [] };
      raws.push(cur);
      return;
    }
    if (!cur) { add(no, 'P003'); return; }
    cur.body.push({ no, indent, blank: false, content });
  });

  function splitClauses(body: Ln[]): Clause[] {
    const out: Clause[] = [];
    let c: Clause | undefined;
    for (const l of body) {
      if (l.blank) { c?.sub.push(l); continue; }
      if (l.indent === 1) { add(l.no, 'P007'); continue; }
      if (l.indent === 2) {
        if (l.content.startsWith('#')) continue;
        const [kw, rest] = splitFirst(l.content);
        c = { kw, rest, line: l.no, sub: [] };
        out.push(c);
        continue;
      }
      if (!c) { add(l.no, 'P006'); continue; }
      c.sub.push(l);
    }
    return out;
  }

  function noLines(c: Clause): void {
    for (const l of c.sub) if (!l.blank && !l.content.startsWith('#')) add(l.no, 'P006');
  }

  function eachClause(s: RawStmt, allowed: string[], once: string[], fn: (c: Clause) => void): void {
    const seen = new Set<string>();
    for (const c of splitClauses(s.body)) {
      if (!allowed.includes(c.kw)) { add(c.line, 'P015'); continue; }
      if (once.includes(c.kw)) {
        if (seen.has(c.kw)) { add(c.line, 'P052'); continue; }
        seen.add(c.kw);
      }
      fn(c);
    }
  }

  function readText(c: Clause): TextBlock {
    if (c.rest !== '') add(c.line, 'P008');
    const out: string[] = [];
    for (const l of c.sub) {
      if (l.blank) { out.push(''); continue; }
      if (l.indent < 4) { add(l.no, 'P008'); continue; }
      out.push(' '.repeat(l.indent - 4) + l.content);
    }
    while (out.length > 0 && out[0] === '') out.shift();
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    return { line: c.line, text: out.join('\n') };
  }

  function quoted(c: Clause): string | undefined {
    noLines(c);
    const s = parseJsonString(c.rest);
    if (s === undefined) add(c.line, 'P004');
    return s;
  }

  function header(s: RawStmt): string {
    const [id, title] = splitFirst(s.rest);
    if (id === '' || title.length < 2 || !title.startsWith('"') || !title.endsWith('"')) {
      add(s.line, 'P005');
    } else if (parseJsonString(title) === undefined) {
      add(s.line, 'P004');
    }
    return id;
  }

  function readRequest(c: Clause): Obj | undefined {
    const p = parseJson(c.rest);
    if (!p.ok || !isPlainObject(p.value)) { add(c.line, 'P009'); return undefined; }
    if (hasOwn(p.value, 'id') || hasOwn(p.value, 'op') || hasOwn(p.value, 'input')) {
      add(c.line, 'P051');
      return undefined;
    }
    return p.value;
  }

  function readExample(c: Clause): Item | null {
    const item: Item = { file: name, line: c.line, op: '', raw: false, inputKeys: [], omit: new Set(), expects: [] };
    let dropped = false;
    let inputObj: Obj | undefined;
    let inputUsed = false;
    const [first, after] = splitFirst(c.rest);
    if (c.rest === '') {
      add(c.line, 'P012');
      dropped = true;
    } else if (first === 'raw') {
      item.raw = true;
      let line: string | undefined;
      if (after.startsWith('"')) line = parseJsonString(after);
      else if (after.length >= 2 && after.startsWith("'") && after.endsWith("'")) line = after.slice(1, -1);
      if (line === undefined) { add(c.line, 'P004'); dropped = true; }
      else if (/[\r\n]/.test(line)) { add(c.line, 'P026'); dropped = true; }
      else item.rawLine = line;
    } else {
      item.op = first;
      if (after !== '') {
        const p = parseJson(after);
        if (!p.ok) { add(c.line, 'P009'); dropped = true; }
        else if (!isPlainObject(p.value)) { add(c.line, 'P012'); dropped = true; }
        else { inputObj = p.value; item.inputText = after; }
      }
    }

    let requestRead = false;
    const lines = c.sub;
    const skipText = (i: number): number => {
      while (i < lines.length && (lines[i].blank || lines[i].indent >= 6)) i++;
      return i;
    };
    let i = 0;
    while (i < lines.length) {
      const l = lines[i++];
      if (l.blank || l.content.startsWith('#')) continue;
      if (l.indent !== 4) { add(l.no, 'P006'); continue; }
      const [w, r] = splitFirst(l.content);
      if (w === 'expect') {
        let k = 0;
        while (k < r.length && !/\s/.test(r[k]) && r[k] !== '=' && r[k] !== '≈' && r[k] !== '~') k++;
        const path = r.slice(0, k);
        const rest = r.slice(k).trimStart();
        if (path === '') { add(l.no, 'P011'); continue; }
        if (rest.startsWith('=')) {
          const v = rest.slice(1).trim();
          if (v === '?') item.expects.push({ line: l.no, path, kind: 'oracle' });
          else {
            const p = parseJson(v);
            if (!p.ok) add(l.no, 'P009');
            else item.expects.push({ line: l.no, path, kind: 'eq', value: p.value });
          }
        } else if (rest.startsWith('≈') || rest.startsWith('~')) {
          const m = APPROX.exec(rest.slice(1));
          const n = m ? parseNumber(m[1]) : undefined;
          const tol = m ? parseNumber(m[2]) : undefined;
          if (n === undefined || tol === undefined || tol < 0) add(l.no, 'P010');
          else item.expects.push({ line: l.no, path, kind: 'approx', value: n, tol });
        } else add(l.no, 'P011');
      } else if (w === 'request' || w === 'omit' || w === 'input') {
        if (item.raw) {
          add(l.no, 'P022');
          if (w === 'input') i = skipText(i);
          continue;
        }
        if (w === 'request') {
          if (requestRead) { add(l.no, 'P052'); continue; }
          const q = readRequest({ kw: w, rest: r, line: l.no, sub: [] });
          if (q) { item.request = q; requestRead = true; }
        } else if (w === 'omit') {
          const names = r.split(/[,\s]+/).filter((x) => x !== '');
          if (names.length === 0) add(l.no, 'P011');
          for (const n of names) item.omit.add(n);
        } else {
          const m = /\s+from\s+("(?:[^"\\]|\\.)*")$/.exec(r);
          const file = m ? parseJsonString(m[1]) : undefined;
          const pathText = m && file !== undefined ? r.slice(0, m.index) : r;
          const path = parsePath(pathText);
          let body: string | undefined;
          let ok = path !== null;
          if (!ok) add(l.no, 'P049');
          if (file !== undefined) {
            if (ok) {
              body = resolveInput(env, name, file);
              if (body === undefined) { add(l.no, 'P048'); ok = false; }
            } else {
              // a path of another form already got P049
            }
          } else {
            const j = skipText(i);
            const got = lines.slice(i, j);
            i = j;
            while (got.length > 0 && got[got.length - 1].blank) got.pop();
            if (got.length === 0) {
              if (ok) add(l.no, 'P049');
              ok = false;
            } else {
              body = got.map((g) => (g.blank ? '' : ' '.repeat(g.indent - 6) + g.content)).join('\n') + '\n';
            }
          }
          if (ok && path && body !== undefined) {
            const base: Obj = inputObj ?? {};
            let o = base;
            let through = true;
            for (const seg of path.slice(0, -1)) {
              if (!hasOwn(o, seg)) setKey(o, seg, {});
              const next = o[seg];
              if (!isPlainObject(next)) { through = false; break; }
              o = next;
            }
            if (!through) add(l.no, 'P049');
            else {
              setKey(o, path[path.length - 1], body);
              inputObj = base;
              inputUsed = true;
            }
          }
        }
      } else add(l.no, 'P011');
    }

    if (dropped) return null;
    if (inputUsed && inputObj) item.inputText = JSON.stringify(inputObj);
    if (inputObj) item.inputKeys = Object.keys(inputObj);
    return item;
  }

  function readTable(c: Clause): Item[] {
    const rows: { no: number; text: string }[] = [];
    for (const l of c.sub) {
      if (l.blank || l.content.startsWith('#')) continue;
      if (l.indent >= 4 && l.content.startsWith('|')) rows.push({ no: l.no, text: l.content });
      else add(l.no, 'P006');
    }
    const data = rows.filter((r) => !SEPARATOR.test(r.text));
    if (words(c.rest).length !== 1 || data.length < 2) { add(c.line, 'P013'); return []; }
    const op = c.rest;
    const head = data[0];
    interface Col { name: string; isPath: boolean; tol?: number }
    const cols: Col[] = [];
    let stop = false;
    for (const cell of splitRow(head.text)) {
      let k = 0;
      while (k < cell.length && !/\s/.test(cell[k]) && cell[k] !== '±' && !(cell[k] === '+' && cell[k + 1] === '-')) k++;
      const nm = cell.slice(0, k);
      const rem = cell.slice(k).trim();
      let tolText: string | undefined;
      let bad = false;
      if (rem !== '') {
        if (rem.startsWith('±')) tolText = rem.slice(1).trim();
        else if (rem.startsWith('+-')) tolText = rem.slice(2).trim();
        else bad = true;
      }
      const isPath = /^(?:result|audit|error|id)(?:\..*)?$/.test(nm);
      if (!isPath && !/^[A-Za-z0-9_-]+$/.test(nm)) bad = true;
      if (bad || cols.some((x) => x.name === nm)) { add(head.no, 'P013'); stop = true; break; }
      const col: Col = { name: nm, isPath };
      if (tolText !== undefined) {
        const t = parseNumber(tolText);
        if (!isPath || t === undefined || t < 0) add(head.no, 'P010');
        else col.tol = t;
      }
      cols.push(col);
    }
    if (stop) return [];

    const items: Item[] = [];
    for (const row of data.slice(1)) {
      const cells = splitRow(row.text);
      if (cells.length !== cols.length) { add(row.no, 'P014'); continue; }
      const item: Item = {
        file: name, line: row.no, op, raw: false, inputKeys: [], omit: new Set(), expects: [],
      };
      const parts: string[] = [];
      cells.forEach((cell, ci) => {
        if (cell === '') return;
        const col = cols[ci];
        if (!col.isPath) {
          if (!parseJson(cell).ok) { add(row.no, 'P009'); return; }
          parts.push(`${JSON.stringify(col.name)}:${cell}`);
          item.inputKeys.push(col.name);
        } else if (cell === '?') {
          item.expects.push({ line: row.no, path: col.name, kind: 'oracle' });
        } else if (col.tol !== undefined) {
          const n = parseNumber(cell);
          if (n === undefined) add(row.no, 'P010');
          else item.expects.push({ line: row.no, path: col.name, kind: 'approx', value: n, tol: col.tol });
        } else {
          const p = parseJson(cell);
          if (!p.ok) add(row.no, 'P009');
          else item.expects.push({ line: row.no, path: col.name, kind: 'eq', value: p.value });
        }
      });
      item.inputText = `{${parts.join(',')}}`;
      items.push(item);
    }
    return items;
  }

  const stmts: Stmt[] = [];
  let hasDuramen = false;
  let version: string | undefined;

  for (const s of raws) {
    if (!CORE.has(s.kw) && !OTHER.has(s.kw)) { add(s.line, 'P002'); continue; }
    switch (s.kw) {
      case 'duramen': {
        const ok = s.rest === '0.1' || s.rest === '0.2';
        if (hasDuramen) add(s.line, 'P023');
        else if (!ok) add(s.line, 'P023');
        else version = s.rest;
        hasDuramen = true;
        for (const c of splitClauses(s.body)) add(c.line, 'P015');
        stmts.push({ k: 'duramen' });
        break;
      }
      case 'spec': {
        const st: Stmt = { k: 'spec', file: name, line: s.line };
        if (words(s.rest).length !== 2) add(s.line, 'P021');
        eachClause(s, ['title', 'text', 'contract', 'request'], ['title', 'text', 'contract', 'request'], (c) => {
          if (c.kw === 'title') quoted(c);
          else if (c.kw === 'text') st.text = readText(c);
          else if (c.kw === 'contract') noLines(c);
          else { noLines(c); st.request = readRequest(c); }
        });
        stmts.push(st);
        break;
      }
      case 'oracle': {
        if (s.rest === '') add(s.line, 'P028');
        eachClause(s, ['source'], [], (c) => noLines(c));
        stmts.push({ k: 'oracle', file: name, line: s.line, command: s.rest });
        break;
      }
      case 'section': {
        const id = header(s);
        const st: Stmt = { k: 'section', file: name, line: s.line, id };
        eachClause(s, ['text'], ['text'], (c) => { st.text = readText(c); });
        stmts.push(st);
        break;
      }
      case 'op': {
        const ws = words(s.rest);
        if (ws.length !== 1) add(s.line, 'P031');
        const st: Stmt = {
          k: 'op', file: name, line: s.line, name: ws.length === 1 ? ws[0] : undefined,
          fields: [], tolerances: new Map(), audit: false,
        };
        const seenFields = new Set<string>();
        eachClause(s, ['input', 'result', 'tolerance', 'audit', 'request', 'returns'], ['result', 'audit', 'request'], (c) => {
          if (c.kw === 'input') {
            noLines(c);
            for (const f of splitFields(c.rest)) {
              const m = /^([A-Za-z0-9_-]+)(\?)?\s+(\S[\s\S]*)$/.exec(f.trim());
              if (!m) { add(c.line, 'P017'); continue; }
              if (seenFields.has(m[1])) { add(c.line, 'P052'); continue; }
              seenFields.add(m[1]);
              st.fields.push({ name: m[1], optional: m[2] === '?' });
            }
          } else if (c.kw === 'result') {
            noLines(c);
            st.result = c.rest;
          } else if (c.kw === 'tolerance') {
            noLines(c);
            const [path, num] = splitFirst(c.rest);
            const n = parseNumber(num);
            if (path === '' || n === undefined || n < 0) add(c.line, 'P018');
            else if (st.tolerances.has(path)) add(c.line, 'P052');
            else st.tolerances.set(path, n);
          } else if (c.kw === 'audit') {
            noLines(c);
            if (c.rest !== '' && c.rest !== 'text') add(c.line, 'P050');
            st.audit = true;
          } else if (c.kw === 'request') {
            noLines(c);
            st.request = readRequest(c);
          } else noLines(c);
        });
        stmts.push(st);
        break;
      }
      case 'errors': {
        if (s.rest !== '') add(s.line, 'P050');
        const st: Stmt = { k: 'errors', file: name, line: s.line, clauses: [] };
        for (const c of splitClauses(s.body)) {
          const [w, cond] = splitFirst(c.rest);
          const lines = [cond];
          for (const l of c.sub) {
            if (l.blank) continue;
            if (l.indent < 4) { add(l.no, 'P006'); continue; }
            lines.push(' '.repeat(l.indent - 4) + l.content);
          }
          if (w !== 'when' || cond === '') add(c.line, 'P019');
          st.clauses.push({ code: c.kw, line: c.line, cond: lines.join('\n') });
        }
        stmts.push(st);
        break;
      }
      case 'req': {
        const id = header(s);
        const st: Stmt = {
          k: 'req', file: name, line: s.line, id, platform: 'any', decisions: [], items: [], hasStatic: false,
        };
        eachClause(s, ['text', 'decision', 'on', 'example', 'table', 'static'], ['text', 'on'], (c) => {
          if (c.kw === 'text') st.text = readText(c);
          else if (c.kw === 'decision') {
            noLines(c);
            st.decisions.push(...c.rest.split(/[,\s]+/).filter((x) => x !== ''));
          } else if (c.kw === 'on') {
            noLines(c);
            if (c.rest === 'any' || c.rest === 'posix' || c.rest === 'windows') st.platform = c.rest;
            else add(c.line, 'P033');
          } else if (c.kw === 'example') {
            const it = readExample(c);
            if (it) st.items.push(it);
          } else if (c.kw === 'table') st.items.push(...readTable(c));
          else { noLines(c); st.hasStatic = true; }
        });
        stmts.push(st);
        break;
      }
      case 'open': {
        const id = header(s);
        const st: Stmt = { k: 'open', file: name, line: s.line, id, tests: [] };
        eachClause(s, ['text', 'example', 'table'], ['text'], (c) => {
          if (c.kw === 'text') st.text = readText(c);
          else st.tests.push(c.line);
        });
        stmts.push(st);
        break;
      }
      case 'decision': {
        const id = header(s);
        const st: Stmt = { k: 'decision', file: name, line: s.line, id, source: '', rejected: [] };
        eachClause(s, ['source', 'status', 'text', 'rejected'], ['source', 'status', 'text'], (c) => {
          if (c.kw === 'source') { noLines(c); st.source = c.rest; }
          else if (c.kw === 'status') { noLines(c); st.status = c.rest; }
          else if (c.kw === 'text') st.text = readText(c);
          else {
            noLines(c);
            const r = parseJsonString(c.rest);
            if (r === undefined) add(c.line, 'P004');
            else st.rejected.push(r);
          }
        });
        stmts.push(st);
        break;
      }
      case 'note': {
        if (s.rest !== '') add(s.line, 'P050');
        const st: Stmt = { k: 'note', file: name, line: s.line };
        eachClause(s, ['text'], ['text'], (c) => { st.text = readText(c); });
        stmts.push(st);
        break;
      }
      default:
        // statements of the rest of the language (OPEN-RC-001): read as nothing
        break;
    }
  }
  return { stmts, hasDuramen, version };
}

// Fields are separated by commas outside double quotes, brackets, braces and parentheses.
export function splitFields(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQuote = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      cur += c;
      if (c === '\\' && i + 1 < s.length) { cur += s[++i]; }
      else if (c === '"') inQuote = false;
      continue;
    }
    if (c === '"') inQuote = true;
    else if (c === '[' || c === '{' || c === '(') depth++;
    else if ((c === ']' || c === '}' || c === ')') && depth > 0) depth--;
    else if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
