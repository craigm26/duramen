import type { Diag, Entries, Expect, FileModel, Item, ReqM, TextBlock } from './types.ts';
import { NUM_SRC, NUM_RE, tryJSON, isPlainObject, setOwn } from './json.ts';

interface Line {
  n: number;
  indent: number;
  body: string;
  blank: boolean;
}

interface Clause {
  kw: string;
  line: number;
  rest: string;
  lines: Line[];
}

interface Stmt {
  kw: string;
  line: number;
  rest: string;
  clauses: Clause[];
  unknown: boolean;
}

export interface ReadContext {
  files: Record<string, string>;
  recordFolder: string;
}

const CORE = new Set(['duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note']);
const REST = new Set(['type', 'edge', 'edgedef', 'property', 'evidence']);
const WORD_RE = /^[\p{L}\p{Nd}_-]+$/u;
const EXPECT_APPROX_RE = new RegExp(`^(${NUM_SRC})\\s*(?:±|\\+-)\\s*(${NUM_SRC})$`);

function dirname(name: string): string {
  const i = name.lastIndexOf('/');
  return i < 0 ? '' : name.slice(0, i);
}

function firstWord(s: string): [string, string] {
  const m = /^(\S*)\s*([\s\S]*)$/.exec(s)!;
  return [m[1], m[2]];
}

function newModel(name: string): FileModel {
  return {
    name, diags: [], version: null, hasDuramen: false, specs: [], oracles: [], sections: [], notes: [],
    ops: [], errors: [], reqs: [], opens: [], decisions: [],
  };
}

function scanLines(text: string, diag: (line: number, code: string) => void): Line[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const out: Line[] = [];
  text.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const n = i + 1;
    const body = raw.replace(/\s+$/, '');
    const ws = /^\s*/.exec(body)![0];
    const rest = body.slice(ws.length);
    if (rest === '') {
      out.push({ n, indent: 0, body: '', blank: true });
    } else if (/[^ ]/.test(ws)) {
      diag(n, 'P001');
    } else {
      out.push({ n, indent: ws.length, body: rest, blank: false });
    }
  });
  return out;
}

function groupStatements(lines: Line[], diag: (line: number, code: string) => void): Stmt[] {
  const stmts: Stmt[] = [];
  let cur: Stmt | null = null;
  let clause: Clause | null = null;
  for (const ln of lines) {
    if (ln.blank) {
      if (clause) clause.lines.push(ln);
      continue;
    }
    if (ln.indent === 0) {
      if (ln.body.startsWith('#')) continue;
      const [kw, rest] = firstWord(ln.body);
      const known = CORE.has(kw) || REST.has(kw);
      cur = { kw, line: ln.n, rest, clauses: [], unknown: !known };
      clause = null;
      if (!known) diag(ln.n, 'P002');
      stmts.push(cur);
      continue;
    }
    if (cur === null) {
      diag(ln.n, 'P003');
      continue;
    }
    if (cur.unknown || REST.has(cur.kw)) continue;
    if (ln.indent === 1) {
      diag(ln.n, 'P007');
    } else if (ln.indent === 2) {
      if (ln.body.startsWith('#')) continue;
      const [kw, rest] = firstWord(ln.body);
      clause = { kw, line: ln.n, rest, lines: [] };
      cur.clauses.push(clause);
    } else if (clause === null) {
      diag(ln.n, 'P006');
    } else {
      clause.lines.push(ln);
    }
  }
  return stmts;
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      cur += ch;
      if (ch === '\\') cur += s[++i] ?? '';
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if ('[{('.includes(ch)) depth++;
    else if (']})'.includes(ch)) depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parsePath(s: string): string[] | null {
  const segs: string[] = [];
  let i = 0;
  for (;;) {
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      if (j >= s.length) return null;
      const p = tryJSON(s.slice(i, j + 1));
      if (!p.ok || typeof p.value !== 'string') return null;
      segs.push(p.value);
      i = j + 1;
    } else {
      const m = /^[\p{L}\p{Nd}_-]+/u.exec(s.slice(i));
      if (!m) return null;
      segs.push(m[0]);
      i += m[0].length;
    }
    if (i === s.length) return segs;
    if (s[i] !== '.') return null;
    i++;
  }
}

function splitRow(body: string): string[] {
  const cells: string[] = [];
  let buf = '';
  for (let i = 1; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') {
      buf += '|';
      i++;
    } else if (ch === '|') {
      cells.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim() !== '') cells.push(buf.trim());
  return cells;
}

export function readFile(name: string, text: string, ctx: ReadContext): FileModel {
  const m = newModel(name);
  const diag = (line: number, code: string) => {
    m.diags.push({ file: name, line, level: 'error', code } satisfies Diag);
  };

  const noLines = (c: Clause) => {
    for (const ln of c.lines) if (!ln.blank && !ln.body.startsWith('#')) diag(ln.n, 'P006');
  };

  const takeClauses = (st: Stmt, allowed: Set<string> | null, once: Set<string>): Clause[] => {
    const seen = new Set<string>();
    const out: Clause[] = [];
    for (const c of st.clauses) {
      if (allowed && !allowed.has(c.kw)) {
        diag(c.line, 'P015');
        continue;
      }
      if (once.has(c.kw)) {
        if (seen.has(c.kw)) {
          diag(c.line, 'P052');
          continue;
        }
        seen.add(c.kw);
      }
      out.push(c);
    }
    return out;
  };

  const readText = (c: Clause): TextBlock => {
    if (c.rest !== '') diag(c.line, 'P008');
    const lines: string[] = [];
    for (const ln of c.lines) {
      if (ln.blank) lines.push('');
      else if (ln.indent >= 4) lines.push(' '.repeat(ln.indent - 4) + ln.body);
      else diag(ln.n, 'P008');
    }
    while (lines.length && lines[0] === '') lines.shift();
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return { line: c.line, lines };
  };

  const readQuoted = (c: Clause): string | null => {
    const p = tryJSON(c.rest);
    if (!p.ok || typeof p.value !== 'string') {
      diag(c.line, 'P004');
      return null;
    }
    return p.value;
  };

  const readRequest = (text: string, line: number): Entries | null => {
    const p = tryJSON(text);
    if (!p.ok || !isPlainObject(p.value)) {
      diag(line, 'P009');
      return null;
    }
    if (['id', 'op', 'input'].some((k) => Object.hasOwn(p.value as object, k))) {
      diag(line, 'P051');
      return null;
    }
    return Object.entries(p.value);
  };

  const idTitle = (st: Stmt): string => {
    const mm = /^(\S+)\s+([\s\S]*)$/.exec(st.rest);
    if (!mm) {
      diag(st.line, 'P005');
      return st.rest.split(/\s+/)[0] ?? '';
    }
    const t = mm[2];
    if (!(t.startsWith('"') && t.endsWith('"'))) {
      diag(st.line, 'P005');
    } else {
      const p = tryJSON(t);
      if (!p.ok || typeof p.value !== 'string') diag(st.line, 'P004');
    }
    return mm[1];
  };

  const readFileText = (rel: string): string | null => {
    if (rel === '' || rel.startsWith('/')) return null;
    const parts = dirname(name) === '' ? [] : dirname(name).split('/');
    for (const seg of rel.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (parts.length === 0) return null;
        parts.pop();
      } else {
        parts.push(seg);
      }
    }
    const joined = parts.join('/');
    const f = ctx.recordFolder;
    if (f !== '' && !joined.startsWith(f + '/')) return null;
    return Object.hasOwn(ctx.files, joined) ? ctx.files[joined] : null;
  };

  // ---- examples ----

  const parseExpect = (rest: string, line: number): Expect | null => {
    const path = /^[^\s=≈~]*/.exec(rest)![0];
    const r = rest.slice(path.length).trimStart();
    if (r.startsWith('=')) {
      const v = r.slice(1).trim();
      if (v === '?') return { line, path, kind: 'oracle' };
      const p = tryJSON(v);
      if (!p.ok) {
        diag(line, 'P009');
        return null;
      }
      return { line, path, kind: 'eq', value: p.value };
    }
    if (r.startsWith('≈') || r.startsWith('~')) {
      const mm = EXPECT_APPROX_RE.exec(r.slice(1).trim());
      if (!mm || Number(mm[2]) < 0) {
        diag(line, 'P010');
        return null;
      }
      return { line, path, kind: 'approx', value: Number(mm[1]), tol: Number(mm[2]) };
    }
    diag(line, 'P011');
    return null;
  };

  const readExample = (req: ReqM, c: Clause): void => {
    let raw = false;
    let rawLine = '';
    let op = '';
    let inputText = '';
    let hasInputText = false;
    let ok = true;
    const rest = c.rest;
    if (rest === '') {
      diag(c.line, 'P012');
      ok = false;
    } else {
      const [w, after] = firstWord(rest);
      if (w === 'raw') {
        raw = true;
        let line: string | null = null;
        if (after.startsWith('"')) {
          const p = tryJSON(after);
          if (p.ok && typeof p.value === 'string') line = p.value;
        } else if (after.startsWith("'") && after.length >= 2 && after.endsWith("'")) {
          line = after.slice(1, -1);
        }
        if (line === null) {
          diag(c.line, 'P004');
          ok = false;
        } else if (/[\r\n]/.test(line)) {
          diag(c.line, 'P026');
          ok = false;
        } else {
          rawLine = line;
        }
      } else {
        op = w;
        if (after !== '') {
          const p = tryJSON(after);
          if (!p.ok) {
            diag(c.line, 'P009');
            ok = false;
          } else if (!isPlainObject(p.value)) {
            diag(c.line, 'P012');
            ok = false;
          } else {
            inputText = after;
            hasInputText = true;
          }
        }
      }
    }
    let obj: Record<string, unknown> | null = hasInputText ? (JSON.parse(inputText) as Record<string, unknown>) : null;
    let inputApplied = false;
    const request: Entries = [];
    const omit: string[] = [];
    const expects: Expect[] = [];
    const lines = c.lines;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.blank || ln.body.startsWith('#')) continue;
      if (ln.indent !== 4) {
        diag(ln.n, 'P006');
        continue;
      }
      const [kw, r] = firstWord(ln.body);
      if (kw === 'expect') {
        const e = parseExpect(r, ln.n);
        if (e) expects.push(e);
      } else if (kw === 'request') {
        if (raw) diag(ln.n, 'P022');
        else {
          const ent = readRequest(r, ln.n);
          if (ent) for (const [k, v] of ent) setEntry(request, k, v);
        }
      } else if (kw === 'omit') {
        if (raw) diag(ln.n, 'P022');
        else omit.push(...r.split(/[,\s]+/).filter((x) => x !== ''));
      } else if (kw === 'input') {
        let j = i + 1;
        const body: Line[] = [];
        while (j < lines.length && (lines[j].blank || lines[j].indent >= 6)) body.push(lines[j++]);
        i = j - 1;
        if (raw) {
          diag(ln.n, 'P022');
          continue;
        }
        const fm = /^(\S[\s\S]*?)\s+from\s+("(?:[^"\\]|\\.)*")$/.exec(r);
        const fp = fm ? tryJSON(fm[2]) : null;
        const isFrom = fm !== null && fp !== null && fp.ok && typeof fp.value === 'string';
        const path = parsePath(isFrom ? fm![1] : r);
        let value: string | null = null;
        let code: string | null = null;
        if (isFrom) {
          for (const b of body) if (!b.blank) diag(b.n, 'P006');
          if (path === null) code = 'P049';
          else {
            value = readFileText((fp as { value: string }).value);
            if (value === null) code = 'P048';
          }
        } else {
          const tl = body.map((b) => (b.blank ? '' : ' '.repeat(b.indent - 6) + b.body));
          while (tl.length && tl[tl.length - 1] === '') tl.pop();
          if (path === null || tl.length === 0) code = 'P049';
          else value = tl.join('\n') + '\n';
        }
        if (code === null && path !== null && value !== null) {
          if (obj === null) obj = {};
          let cur: Record<string, unknown> = obj;
          let bad = false;
          for (let k = 0; k < path.length - 1; k++) {
            const key = path[k];
            if (!Object.hasOwn(cur, key)) setOwn(cur, key, {});
            const nxt = cur[key];
            if (!isPlainObject(nxt)) {
              bad = true;
              break;
            }
            cur = nxt;
          }
          if (bad) code = 'P049';
          else {
            setOwn(cur, path[path.length - 1], value);
            inputApplied = true;
          }
        }
        if (code) diag(ln.n, code);
      } else {
        diag(ln.n, 'P011');
      }
    }
    if (!ok) return;
    req.items.push({
      file: name, line: c.line, n: req.items.length + 1, kind: 'example', raw, rawLine, op,
      hasInput: inputApplied || hasInputText, inputText, inputObj: inputApplied ? obj : null,
      request, omit, expects, reqId: req.id, platform: req.platform,
    });
  };

  const readTable = (req: ReqM, c: Clause): void => {
    const rows: Line[] = [];
    for (const ln of c.lines) {
      if (ln.blank || ln.body.startsWith('#')) continue;
      if (ln.indent >= 4 && ln.body.startsWith('|')) rows.push(ln);
      else diag(ln.n, 'P006');
    }
    const data = rows.filter((r) => !(/^[|\-: ]+$/.test(r.body) && r.body.endsWith('|')));
    const opWords = c.rest.split(/\s+/).filter((x) => x !== '');
    if (opWords.length !== 1 || data.length < 2) {
      diag(c.line, 'P013');
      return;
    }
    const op = opWords[0];
    const header = data[0];
    interface Col { kind: 'input' | 'expect'; base: string; tol: number | null }
    const cols: Col[] = [];
    let bad = false;
    const tolErrors: number[] = [];
    for (const cell of splitRow(header.body)) {
      const mm = /(±|\+-)/.exec(cell);
      const base = (mm ? cell.slice(0, mm.index) : cell).trim();
      const tolText = mm ? cell.slice(mm.index + mm[1].length).trim() : null;
      const isExpect = /^(result|audit|error|id)(\..*)?$/.test(base) && !/\s/.test(base);
      if (!isExpect && !WORD_RE.test(base)) {
        bad = true;
        break;
      }
      let tol: number | null = null;
      if (tolText !== null) {
        if (!isExpect || !NUM_RE.test(tolText) || Number(tolText) < 0) tolErrors.push(header.n);
        else tol = Number(tolText);
      }
      cols.push({ kind: isExpect ? 'expect' : 'input', base, tol });
    }
    if (bad) {
      diag(header.n, 'P013');
      return;
    }
    for (const l of tolErrors) diag(l, 'P010');
    for (const row of data.slice(1)) {
      const cells = splitRow(row.body);
      if (cells.length !== cols.length) {
        diag(row.n, 'P014');
        continue;
      }
      const parts: string[] = [];
      const expects: Expect[] = [];
      let ok = true;
      cols.forEach((col, k) => {
        const cell = cells[k];
        if (cell === '') return;
        if (col.kind === 'input') {
          if (!tryJSON(cell).ok) {
            diag(row.n, 'P009');
            ok = false;
          } else parts.push(`"${col.base}":${cell}`);
        } else if (cell === '?') {
          expects.push({ line: row.n, path: col.base, kind: 'oracle' });
        } else if (col.tol !== null) {
          if (!NUM_RE.test(cell)) {
            diag(row.n, 'P010');
            ok = false;
          } else expects.push({ line: row.n, path: col.base, kind: 'approx', value: Number(cell), tol: col.tol });
        } else {
          const p = tryJSON(cell);
          if (!p.ok) {
            diag(row.n, 'P009');
            ok = false;
          } else expects.push({ line: row.n, path: col.base, kind: 'eq', value: p.value });
        }
      });
      if (!ok) continue;
      req.items.push({
        file: name, line: row.n, n: req.items.length + 1, kind: 'row', raw: false, rawLine: '', op,
        hasInput: true, inputText: `{${parts.join(',')}}`, inputObj: null, request: [], omit: [],
        expects, reqId: req.id, platform: req.platform,
      });
    }
  };

  // ---- statements ----

  const processStmt = (st: Stmt): void => {
    const line = st.line;
    switch (st.kw) {
      case 'duramen': {
        takeClauses(st, new Set(), new Set());
        if (m.hasDuramen) diag(line, 'P023');
        else {
          m.hasDuramen = true;
          if (st.rest === '0.1' || st.rest === '0.2') m.version = st.rest;
          else diag(line, 'P023');
        }
        break;
      }
      case 'spec': {
        if (st.rest.split(/\s+/).filter((x) => x !== '').length !== 2) diag(line, 'P021');
        const spec = { file: name, line, request: null as Entries | null, text: null as TextBlock | null };
        for (const c of takeClauses(st, new Set(['title', 'text', 'contract', 'request']), new Set(['title', 'contract', 'request', 'text']))) {
          if (c.kw === 'text') spec.text = readText(c);
          else {
            noLines(c);
            if (c.kw === 'title') readQuoted(c);
            else if (c.kw === 'request') spec.request = readRequest(c.rest, c.line);
          }
        }
        m.specs.push(spec);
        break;
      }
      case 'oracle': {
        if (st.rest === '') diag(line, 'P028');
        for (const c of takeClauses(st, new Set(['source']), new Set())) noLines(c);
        m.oracles.push({ file: name, line, command: st.rest });
        break;
      }
      case 'section':
      case 'note': {
        if (st.kw === 'note') {
          if (st.rest !== '') diag(line, 'P050');
        } else idTitle(st);
        let text: TextBlock | null = null;
        for (const c of takeClauses(st, new Set(['text']), new Set(['text']))) text = readText(c);
        (st.kw === 'note' ? m.notes : m.sections).push({ file: name, line, text });
        break;
      }
      case 'op': {
        const words = st.rest.split(/\s+/).filter((x) => x !== '');
        if (words.length !== 1) diag(line, 'P031');
        const op = {
          file: name, line, name: words[0] ?? '', fields: [] as { name: string; optional: boolean }[],
          hasAudit: false, tolerances: [] as [string, number][], request: null as Entries | null, result: null as string | null,
        };
        const allowed = new Set(['input', 'result', 'tolerance', 'audit', 'request']);
        for (const c of takeClauses(st, allowed, new Set(['result', 'audit', 'request']))) {
          if (c.kw === 'input') {
            noLines(c);
            for (const f of splitTop(c.rest)) {
              const fm = /^([\p{L}\p{Nd}_-]+)(\?)?\s+(\S[\s\S]*)$/u.exec(f);
              if (!fm) diag(c.line, 'P017');
              else op.fields.push({ name: fm[1], optional: fm[2] === '?' });
            }
          } else if (c.kw === 'result') {
            noLines(c);
            op.result = c.rest;
          } else if (c.kw === 'tolerance') {
            noLines(c);
            const [p, num] = firstWord(c.rest);
            if (p === '' || !NUM_RE.test(num) || Number(num) < 0) diag(c.line, 'P018');
            else if (op.tolerances.some(([k]) => k === p)) diag(c.line, 'P052');
            else op.tolerances.push([p, Number(num)]);
          } else if (c.kw === 'audit') {
            noLines(c);
            if (c.rest !== '' && c.rest !== 'text') diag(c.line, 'P015');
            else op.hasAudit = true;
          } else if (c.kw === 'request') {
            noLines(c);
            op.request = readRequest(c.rest, c.line);
          }
        }
        m.ops.push(op);
        break;
      }
      case 'errors': {
        if (st.rest !== '') diag(line, 'P050');
        const e = { file: name, line, clauses: [] as { code: string; line: number; condition: string[] }[] };
        for (const c of st.clauses) {
          const [w, cond] = firstWord(c.rest);
          if (w !== 'when' || cond === '') diag(c.line, 'P019');
          const condition = [cond];
          for (const ln of c.lines) {
            if (ln.blank) condition.push('');
            else if (ln.indent >= 4) condition.push(ln.body);
            else diag(ln.n, 'P006');
          }
          while (condition.length > 1 && condition[condition.length - 1] === '') condition.pop();
          e.clauses.push({ code: c.kw, line: c.line, condition });
        }
        m.errors.push(e);
        break;
      }
      case 'req': {
        const id = idTitle(st);
        const req: ReqM = { file: name, line, id, text: null, decisions: [], platform: 'any', items: [] };
        const allowed = new Set(['text', 'decision', 'on', 'example', 'table']);
        for (const c of takeClauses(st, allowed, new Set(['text', 'on']))) {
          if (c.kw === 'text') req.text = readText(c);
          else if (c.kw === 'decision') {
            noLines(c);
            req.decisions.push(...c.rest.split(/[,\s]+/).filter((x) => x !== ''));
          } else if (c.kw === 'on') {
            noLines(c);
            if (c.rest === 'any' || c.rest === 'posix' || c.rest === 'windows') req.platform = c.rest;
            else diag(c.line, 'P033');
          } else if (c.kw === 'example') readExample(req, c);
          else readTable(req, c);
        }
        m.reqs.push(req);
        break;
      }
      case 'open': {
        const id = idTitle(st);
        const open = { file: name, line, id, text: null as TextBlock | null, reported: [] as number[] };
        for (const c of takeClauses(st, new Set(['text', 'example', 'table']), new Set(['text']))) {
          if (c.kw === 'text') open.text = readText(c);
          else open.reported.push(c.line);
        }
        m.opens.push(open);
        break;
      }
      case 'decision': {
        const id = idTitle(st);
        const d = { file: name, line, id, source: null as string | null, status: null as string | null, rejected: [] as string[], text: null as TextBlock | null };
        const allowed = new Set(['source', 'status', 'text', 'rejected']);
        for (const c of takeClauses(st, allowed, new Set(['source', 'status', 'text']))) {
          if (c.kw === 'text') d.text = readText(c);
          else {
            noLines(c);
            if (c.kw === 'source') d.source = c.rest;
            else if (c.kw === 'status') d.status = c.rest;
            else {
              const q = readQuoted(c);
              if (q !== null) d.rejected.push(q);
            }
          }
        }
        m.decisions.push(d);
        break;
      }
      default:
        break;
    }
  };

  const lines = scanLines(text, diag);
  for (const st of groupStatements(lines, diag)) if (!st.unknown) processStmt(st);
  if (!m.hasDuramen) diag(1, 'P020');
  return m;
}

function setEntry(entries: Entries, key: string, value: unknown): void {
  const e = entries.find(([k]) => k === key);
  if (e) e[1] = value;
  else entries.push([key, value]);
}
