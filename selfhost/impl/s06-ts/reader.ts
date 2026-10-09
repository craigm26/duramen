import type { Diag, Level } from './common.ts';
import { JSON_NUMBER, dirname, hasOwn, isObject, setMember, tryJson } from './common.ts';

export interface Expect {
  line: number;
  path: string;
  kind: 'eq' | 'approx' | 'oracle';
  value?: unknown;
  tol?: number;
}

export interface Case {
  file: string;
  line: number;
  reqId: string;
  id: string;
  platform: string;
  raw?: string;
  op: string;
  inputText?: string;
  request?: Record<string, unknown>;
  omit: string[];
  expects: Expect[];
}

export interface OpInfo {
  file: string;
  line: number;
  name: string;
  valid: boolean;
  fields: { name: string; optional: boolean }[];
  tolerances: Map<string, number>;
  audit: boolean;
  request?: Record<string, unknown>;
}

export interface ReqInfo {
  file: string;
  line: number;
  id: string;
  platform: string;
  decisions: string[];
  cases: Case[];
  text?: string;
  textLine?: number;
}

export interface OpenInfo {
  file: string;
  line: number;
  id: string;
  testLines: number[];
}

export interface DecisionInfo {
  file: string;
  line: number;
  id: string;
  source?: string;
  status?: string;
}

export interface ObText {
  file: string;
  line: number;
  text: string;
  open: boolean;
}

export interface Model {
  specs: { file: string; line: number; request?: Record<string, unknown> }[];
  oracle?: { file: string; line: number; command: string };
  ops: OpInfo[];
  reqs: ReqInfo[];
  opens: OpenInfo[];
  decisions: DecisionInfo[];
  errorCodes: string[];
  texts: ObText[];
}

export interface RecordInfo {
  name: string;
  folder: string;
  files: Record<string, string>;
  recordFiles: string[];
}

interface Ln {
  no: number;
  indent: number;
  text: string;
  blank: boolean;
}

interface Clause {
  kw: string;
  line: number;
  rest: string;
  body: Ln[];
}

interface Stmt {
  kw: string;
  line: number;
  rest: string;
  lines: Ln[];
}

const KEYWORDS = new Set(['duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note']);
const REST_KEYWORDS = new Set(['type', 'edge', 'edgedef', 'property', 'evidence']);
const VERSIONS = new Set(['0.1', '0.2']);
const STATUS_WORDS = new Set(['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected']);
void STATUS_WORDS;

function firstWord(s: string): { word: string; rest: string } {
  const m = /^(\S+)\s*([\s\S]*)$/.exec(s);
  return m ? { word: m[1], rest: m[2] } : { word: '', rest: '' };
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      cur += ch;
      if (ch === '\\' && i + 1 < s.length) {
        cur += s[++i];
      } else if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"') {
      inQuote = true;
      cur += ch;
    } else if (ch === '[' || ch === '{' || ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ']' || ch === '}' || ch === ')') {
      if (depth > 0) depth--;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

export function parsePath(s: string): string[] | null {
  if (s === '') return null;
  const segs: string[] = [];
  let i = 0;
  for (;;) {
    const here = s.slice(i);
    let m: RegExpExecArray | null;
    if (here.startsWith('"')) {
      m = /^"(?:[^"\\]|\\.)*"/.exec(here);
      if (!m) return null;
      const p = tryJson(m[0]);
      if (!p.ok || typeof p.value !== 'string') return null;
      segs.push(p.value);
    } else {
      m = /^[A-Za-z0-9_-]+/.exec(here);
      if (!m) return null;
      segs.push(m[0]);
    }
    i += m[0].length;
    if (i === s.length) return segs;
    if (s[i] !== '.') return null;
    i++;
  }
}

function resolveFrom(folderOfExample: string, recordFolder: string, from: string): string | null {
  if (from === '' || from.startsWith('/')) return null;
  const parts = folderOfExample === '' ? [] : folderOfExample.split('/');
  for (const p of from.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(p);
  }
  const name = parts.join('/');
  if (recordFolder !== '' && !name.startsWith(recordFolder + '/')) return null;
  if (name === '') return null;
  return name;
}

export function readRecord(rec: RecordInfo): { diags: Diag[]; model: Model } {
  const diags: Diag[] = [];
  const model: Model = { specs: [], ops: [], reqs: [], opens: [], decisions: [], errorCodes: [], texts: [] };
  const counts = { spec: 0, oracle: 0, errors: 0 };
  const versions = new Set<string>();

  for (const file of rec.recordFiles) {
    readFile(file, rec.files[file], rec, diags, model, counts, versions);
  }
  if (counts.spec === 0) diags.push({ file: rec.name, line: 1, level: 'error', code: 'P021' });
  if (versions.size > 1) diags.push({ file: rec.name, line: 1, level: 'error', code: 'P047' });
  return { diags, model };
}

function readFile(
  file: string,
  source: string,
  rec: RecordInfo,
  diags: Diag[],
  model: Model,
  counts: { spec: number; oracle: number; errors: number },
  versions: Set<string>,
): void {
  const d = (line: number, code: string, level: Level = 'error') => {
    diags.push({ file, line, level, code });
  };
  const fileFolder = dirname(file);

  // lines
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  const raw = source.split(/\r\n|\r|\n/);
  const stmts: Stmt[] = [];
  let cur: Stmt | null = null;
  for (let i = 0; i < raw.length; i++) {
    const no = i + 1;
    const t = raw[i].replace(/\s+$/, '');
    if (t === '') {
      if (cur) cur.lines.push({ no, indent: 0, text: '', blank: true });
      continue;
    }
    const lead = /^\s*/.exec(t)![0];
    if (/[^ ]/.test(lead)) {
      d(no, 'P001');
      continue;
    }
    const indent = lead.length;
    const text = t.slice(indent);
    if (indent === 0) {
      if (text.startsWith('#')) continue;
      const fw = firstWord(text);
      cur = { kw: fw.word, line: no, rest: fw.rest, lines: [] };
      stmts.push(cur);
    } else if (!cur) {
      d(no, 'P003');
    } else {
      cur.lines.push({ no, indent, text, blank: false });
    }
  }

  let duramenSeen = 0;
  let versionOfFile: string | null = null;

  for (const st of stmts) {
    if (!KEYWORDS.has(st.kw)) {
      if (!REST_KEYWORDS.has(st.kw)) d(st.line, 'P002');
      continue;
    }
    const clauses = toClauses(st, d);
    readStatement(st, clauses);
  }

  if (duramenSeen === 0) d(1, 'P020');
  else if (versionOfFile !== null) versions.add(versionOfFile);

  function toClauses(st: Stmt, d: (line: number, code: string) => void): Clause[] {
    const out: Clause[] = [];
    let latest: Clause | null = null;
    for (const ln of st.lines) {
      if (ln.blank) {
        if (latest) latest.body.push(ln);
        continue;
      }
      if (ln.indent === 1) {
        d(ln.no, 'P007');
        continue;
      }
      if (ln.indent === 2) {
        if (ln.text.startsWith('#')) continue;
        const fw = firstWord(ln.text);
        latest = { kw: fw.word, line: ln.no, rest: fw.rest, body: [] };
        out.push(latest);
        continue;
      }
      if (!latest) {
        d(ln.no, 'P006');
        continue;
      }
      latest.body.push(ln);
    }
    return out;
  }

  function noBody(c: Clause): void {
    for (const ln of c.body) {
      if (!ln.blank && !ln.text.startsWith('#')) d(ln.no, 'P006');
    }
  }

  function readText(c: Clause): string {
    if (c.rest !== '') d(c.line, 'P008');
    const lines: string[] = [];
    for (const ln of c.body) {
      if (ln.blank) {
        lines.push('');
      } else if (ln.indent < 4) {
        d(ln.no, 'P008');
      } else {
        lines.push(' '.repeat(ln.indent - 4) + ln.text);
      }
    }
    while (lines.length && lines[0] === '') lines.shift();
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  }

  function quoted(c: Clause): string | undefined {
    noBody(c);
    const p = tryJson(c.rest);
    if (!p.ok || typeof p.value !== 'string') {
      d(c.line, 'P004');
      return undefined;
    }
    return p.value;
  }

  function readRequest(line: number, rest: string): Record<string, unknown> | undefined {
    const p = tryJson(rest);
    if (!p.ok || !isObject(p.value)) {
      d(line, 'P009');
      return undefined;
    }
    if (hasOwn(p.value, 'id') || hasOwn(p.value, 'op') || hasOwn(p.value, 'input')) {
      d(line, 'P051');
      return undefined;
    }
    return p.value;
  }

  // Applies the clause table: unknown clauses get P015, repeated "once" clauses P052; their lines are ignored.
  function eachClause(
    clauses: Clause[],
    handlers: Record<string, (c: Clause) => void>,
    once: string[],
  ): void {
    const seen = new Set<string>();
    for (const c of clauses) {
      if (!hasOwn(handlers, c.kw)) {
        d(c.line, 'P015');
        continue;
      }
      if (once.includes(c.kw)) {
        if (seen.has(c.kw)) {
          d(c.line, 'P052');
          continue;
        }
        seen.add(c.kw);
      }
      handlers[c.kw](c);
    }
  }

  function idTitle(st: Stmt): string {
    const fw = firstWord(st.rest);
    const title = fw.rest;
    if (title.length < 2 || !title.startsWith('"') || !title.endsWith('"')) {
      d(st.line, 'P005');
    } else {
      const p = tryJson(title);
      if (!p.ok || typeof p.value !== 'string') d(st.line, 'P004');
    }
    return fw.word;
  }

  function addText(line: number, text: string, open = false): void {
    model.texts.push({ file, line, text, open });
  }

  function readStatement(st: Stmt, clauses: Clause[]): void {
    switch (st.kw) {
      case 'duramen': {
        duramenSeen++;
        if (duramenSeen === 1) {
          if (VERSIONS.has(st.rest)) versionOfFile = st.rest;
          else d(st.line, 'P023');
        } else d(st.line, 'P023');
        eachClause(clauses, {}, []);
        return;
      }
      case 'spec': {
        counts.spec++;
        if (counts.spec > 1) d(st.line, 'P044');
        const words = st.rest.split(/\s+/).filter(Boolean);
        if (words.length !== 2) d(st.line, 'P021');
        const info: { file: string; line: number; request?: Record<string, unknown> } = { file, line: st.line };
        let text: string | undefined;
        eachClause(
          clauses,
          {
            title: (c) => void quoted(c),
            contract: (c) => noBody(c),
            request: (c) => {
              noBody(c);
              info.request = readRequest(c.line, c.rest);
            },
            text: (c) => {
              text = readText(c);
            },
          },
          ['title', 'contract', 'request', 'text'],
        );
        if (counts.spec === 1) model.specs.push(info);
        if (text !== undefined) addText(st.line, text);
        return;
      }
      case 'oracle': {
        counts.oracle++;
        if (counts.oracle > 1) d(st.line, 'P044');
        if (st.rest === '') d(st.line, 'P028');
        eachClause(clauses, { source: (c) => noBody(c) }, []);
        if (counts.oracle === 1) model.oracle = { file, line: st.line, command: st.rest };
        return;
      }
      case 'section': {
        idTitle(st);
        let text: string | undefined;
        eachClause(clauses, { text: (c) => (text = readText(c)) }, ['text']);
        if (text !== undefined) addText(st.line, text);
        return;
      }
      case 'note': {
        if (st.rest !== '') d(st.line, 'P050');
        let text: string | undefined;
        eachClause(clauses, { text: (c) => (text = readText(c)) }, ['text']);
        if (text !== undefined) addText(st.line, text);
        return;
      }
      case 'op':
        return readOp(st, clauses);
      case 'errors':
        return readErrors(st, clauses);
      case 'req':
        return readReq(st, clauses);
      case 'open': {
        const id = idTitle(st);
        const info: OpenInfo = { file, line: st.line, id, testLines: [] };
        let text: string | undefined;
        eachClause(
          clauses,
          {
            text: (c) => (text = readText(c)),
            example: (c) => void info.testLines.push(c.line),
            table: (c) => void info.testLines.push(c.line),
          },
          ['text'],
        );
        model.opens.push(info);
        if (text !== undefined) addText(st.line, text, true);
        return;
      }
      case 'decision': {
        const id = idTitle(st);
        const info: DecisionInfo = { file, line: st.line, id };
        let text: string | undefined;
        eachClause(
          clauses,
          {
            source: (c) => {
              noBody(c);
              info.source = c.rest;
            },
            status: (c) => {
              noBody(c);
              info.status = c.rest;
            },
            text: (c) => (text = readText(c)),
            rejected: (c) => {
              const v = quoted(c);
              if (v !== undefined) addText(st.line, v);
            },
          },
          ['source', 'status', 'text'],
        );
        model.decisions.push(info);
        if (text !== undefined) addText(st.line, text);
        return;
      }
    }
  }

  function readOp(st: Stmt, clauses: Clause[]): void {
    const words = st.rest.split(/\s+/).filter(Boolean);
    const valid = words.length === 1;
    if (!valid) d(st.line, 'P031');
    const op: OpInfo = {
      file,
      line: st.line,
      name: valid ? words[0] : '',
      valid,
      fields: [],
      tolerances: new Map(),
      audit: false,
    };
    const fieldNames = new Set<string>();
    const seen = new Set<string>();
    for (const c of clauses) {
      switch (c.kw) {
        case 'input': {
          noBody(c);
          for (const f of splitTop(c.rest)) {
            const m = /^([A-Za-z0-9_-]+)(\?)?\s+(\S[\s\S]*)$/.exec(f);
            if (!m) {
              d(c.line, 'P017');
              continue;
            }
            if (fieldNames.has(m[1])) {
              d(c.line, 'P052');
              continue;
            }
            fieldNames.add(m[1]);
            op.fields.push({ name: m[1], optional: m[2] === '?' });
          }
          break;
        }
        case 'result':
        case 'audit':
        case 'request': {
          if (seen.has(c.kw)) {
            d(c.line, 'P052');
            break;
          }
          seen.add(c.kw);
          noBody(c);
          if (c.kw === 'result') addText(st.line, c.rest);
          else if (c.kw === 'audit') {
            if (c.rest === '' || c.rest === 'text') op.audit = true;
            else d(c.line, 'P050');
          } else op.request = readRequest(c.line, c.rest);
          break;
        }
        case 'tolerance': {
          noBody(c);
          const fw = firstWord(c.rest);
          if (fw.word === '' || !JSON_NUMBER.test(fw.rest) || Number(fw.rest) < 0) {
            d(c.line, 'P018');
            break;
          }
          if (op.tolerances.has(fw.word)) {
            d(c.line, 'P052');
            break;
          }
          op.tolerances.set(fw.word, Number(fw.rest));
          break;
        }
        default:
          d(c.line, 'P015');
      }
    }
    model.ops.push(op);
  }

  function readErrors(st: Stmt, clauses: Clause[]): void {
    counts.errors++;
    if (counts.errors > 1) d(st.line, 'P032');
    if (st.rest !== '') d(st.line, 'P050');
    for (const c of clauses) {
      const cond: string[] = [];
      for (const ln of c.body) {
        if (ln.blank) continue;
        if (ln.indent < 4) d(ln.no, 'P006');
        else cond.push(ln.text);
      }
      const m = /^(\S+)\s+when(?:\s+([\s\S]*))?$/.exec(c.kw + (c.rest === '' ? '' : ' ' + c.rest));
      if (!m || (m[2] ?? '').trim() === '') {
        d(c.line, 'P019');
        continue;
      }
      if (counts.errors === 1) model.errorCodes.push(m[1]);
      addText(c.line, [m[2], ...cond].join('\n'));
    }
  }

  function readReq(st: Stmt, clauses: Clause[]): void {
    const id = idTitle(st);
    const req: ReqInfo = { file, line: st.line, id, platform: 'any', decisions: [], cases: [] };
    const seen = new Set<string>();
    for (const c of clauses) {
      switch (c.kw) {
        case 'text':
        case 'on': {
          if (seen.has(c.kw)) {
            d(c.line, 'P052');
            break;
          }
          seen.add(c.kw);
          if (c.kw === 'text') {
            req.text = readText(c);
            req.textLine = c.line;
          } else {
            noBody(c);
            if (c.rest === 'any' || c.rest === 'posix' || c.rest === 'windows') req.platform = c.rest;
            else d(c.line, 'P033');
          }
          break;
        }
        case 'decision':
          noBody(c);
          req.decisions.push(...c.rest.split(/[,\s]+/).filter(Boolean));
          break;
        case 'example':
          readExample(c, req);
          break;
        case 'table':
          readTable(c, req);
          break;
        default:
          d(c.line, 'P015');
      }
    }
    req.cases.forEach((k, i) => {
      k.id = `${req.id}#${i + 1}`;
      k.platform = req.platform;
    });
    model.reqs.push(req);
  }

  function newCase(req: ReqInfo, line: number, op: string): Case {
    return {
      file,
      line,
      reqId: req.id,
      id: '',
      platform: '',
      op,
      omit: [],
      expects: [],
    };
  }

  function readExpect(ln: Ln, rest: string): Expect | null {
    const pm = /^[^\s=≈~]*/.exec(rest)!;
    const path = pm[0];
    if (path === '') {
      d(ln.no, 'P011');
      return null;
    }
    const after = rest.slice(path.length).replace(/^\s+/, '');
    if (after.startsWith('=')) {
      const v = after.slice(1).trim();
      if (v === '?') return { line: ln.no, path, kind: 'oracle' };
      const p = tryJson(v);
      if (!p.ok) {
        d(ln.no, 'P009');
        return null;
      }
      return { line: ln.no, path, kind: 'eq', value: p.value };
    }
    if (after.startsWith('≈') || after.startsWith('~')) {
      const body = after.slice(1);
      const m = /^\s*(\S+?)\s*(?:±|\+-)\s*(\S+)\s*$/.exec(body);
      if (!m || !JSON_NUMBER.test(m[1]) || !JSON_NUMBER.test(m[2]) || Number(m[2]) < 0) {
        d(ln.no, 'P010');
        return null;
      }
      return { line: ln.no, path, kind: 'approx', value: Number(m[1]), tol: Number(m[2]) };
    }
    d(ln.no, 'P011');
    return null;
  }

  function readExample(c: Clause, req: ReqInfo): void {
    let dropped = false;
    let isRaw = false;
    let op = '';
    let rawLine: string | undefined;
    let inputText: string | undefined;
    let inputObj: Record<string, unknown> | null = null;
    let hasInputJson = false;

    if (c.rest === '') {
      d(c.line, 'P012');
      dropped = true;
    } else {
      const fw = firstWord(c.rest);
      if (fw.word === 'raw') {
        isRaw = true;
        const r = fw.rest;
        if (r.length >= 2 && r.startsWith('"') && r.endsWith('"')) {
          const p = tryJson(r);
          if (!p.ok || typeof p.value !== 'string') {
            d(c.line, 'P004');
            dropped = true;
          } else if (/[\r\n]/.test(p.value)) {
            d(c.line, 'P026');
            dropped = true;
          } else rawLine = p.value;
        } else if (r.length >= 2 && r.startsWith("'") && r.endsWith("'")) {
          rawLine = r.slice(1, -1);
        } else {
          d(c.line, 'P004');
          dropped = true;
        }
      } else {
        op = fw.word;
        if (fw.rest !== '') {
          const p = tryJson(fw.rest);
          if (!p.ok) {
            d(c.line, 'P009');
            dropped = true;
          } else if (!isObject(p.value)) {
            d(c.line, 'P012');
            dropped = true;
          } else {
            inputText = fw.rest;
            inputObj = p.value;
            hasInputJson = true;
          }
        }
      }
    }

    const kase = newCase(req, c.line, op);
    if (rawLine !== undefined) kase.raw = rawLine;
    let requestRead = false;
    let inputsPresent = false;
    const body = c.body;
    for (let i = 0; i < body.length; i++) {
      const ln = body[i];
      if (ln.blank) continue;
      if (ln.indent !== 4) {
        if (!ln.text.startsWith('#')) d(ln.no, 'P006');
        continue;
      }
      if (ln.text.startsWith('#')) continue;
      const fw = firstWord(ln.text);
      switch (fw.word) {
        case 'expect': {
          const e = readExpect(ln, fw.rest);
          if (e) kase.expects.push(e);
          break;
        }
        case 'request': {
          if (isRaw) {
            d(ln.no, 'P022');
            break;
          }
          if (requestRead) {
            d(ln.no, 'P052');
            break;
          }
          const r = readRequest(ln.no, fw.rest);
          if (r) {
            requestRead = true;
            kase.request = r;
          }
          break;
        }
        case 'omit': {
          if (isRaw) {
            d(ln.no, 'P022');
            break;
          }
          const names = fw.rest.split(/[,\s]+/).filter(Boolean);
          if (names.length === 0) d(ln.no, 'P011');
          kase.omit.push(...names);
          break;
        }
        case 'input': {
          // the text under the line: blank lines and lines indented six spaces or more
          const block: Ln[] = [];
          while (i + 1 < body.length && (body[i + 1].blank || body[i + 1].indent >= 6)) {
            block.push(body[++i]);
          }
          if (isRaw) {
            d(ln.no, 'P022');
            break;
          }
          inputsPresent = true;
          const fm = /^([\s\S]*?)\s+from\s+("(?:[^"\\]|\\.)*")$/.exec(fw.rest);
          const fromParsed = fm ? tryJson(fm[2]) : null;
          if (fm && fromParsed && fromParsed.ok && typeof fromParsed.value === 'string') {
            const segs = parsePath(fm[1]);
            for (const b of block) {
              if (!b.blank && !b.text.startsWith('#')) d(b.no, 'P006');
            }
            if (!segs) d(ln.no, 'P049');
            const target = resolveFrom(fileFolder, rec.folder, fromParsed.value);
            const content = target !== null && hasOwn(rec.files, target) ? rec.files[target] : null;
            if (content === null) {
              d(ln.no, 'P048');
              break;
            }
            if (segs && !dropped) setInput(ln.no, segs, content);
            break;
          }
          const segs = parsePath(fw.rest);
          const lines = block.map((b) => (b.blank ? '' : ' '.repeat(b.indent - 6) + b.text));
          while (lines.length && lines[lines.length - 1] === '') lines.pop();
          if (!segs || lines.length === 0) {
            d(ln.no, 'P049');
            break;
          }
          if (!dropped) setInput(ln.no, segs, lines.join('\n') + '\n');
          break;
        }
        default:
          d(ln.no, 'P011');
      }
    }

    function setInput(line: number, segs: string[], value: string): void {
      if (inputObj === null) inputObj = {};
      let cur: Record<string, unknown> = inputObj;
      for (let k = 0; k < segs.length - 1; k++) {
        const s = segs[k];
        if (!hasOwn(cur, s)) {
          const n: Record<string, unknown> = {};
          setMember(cur, s, n);
          cur = n;
        } else if (isObject(cur[s])) {
          cur = cur[s] as Record<string, unknown>;
        } else {
          d(line, 'P049');
          return;
        }
      }
      setMember(cur, segs[segs.length - 1], value);
    }

    if (dropped) return;
    void hasInputJson;
    if (!isRaw && inputsPresent && inputObj !== null) {
      inputText = JSON.stringify(inputObj);
    }
    kase.inputText = inputText;
    req.cases.push(kase);
  }

  function cellsOf(text: string): string[] {
    const s = text.slice(1);
    const cells: string[] = [];
    let cur = '';
    let lastPipe = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && s[i + 1] === '|') {
        cur += '|';
        i++;
        lastPipe = false;
      } else if (ch === '|') {
        cells.push(cur);
        cur = '';
        lastPipe = true;
      } else {
        cur += ch;
        lastPipe = false;
      }
    }
    if (!lastPipe) cells.push(cur);
    return cells.map((x) => x.trim());
  }

  function readTable(c: Clause, req: ReqInfo): void {
    const rows: Ln[] = [];
    for (const ln of c.body) {
      if (ln.blank || ln.text.startsWith('#')) continue;
      if (ln.text.startsWith('|') && ln.indent >= 4) rows.push(ln);
      else d(ln.no, 'P006');
    }
    const data = rows.filter((r) => !(r.text === '|' || /^\|[|\-: ]*\|$/.test(r.text)));
    const opWords = c.rest.split(/\s+/).filter(Boolean);
    if (opWords.length !== 1 || data.length < 2) {
      d(c.line, 'P013');
      return;
    }
    const op = opWords[0];
    const headLn = data[0];
    interface Col {
      name: string;
      input: boolean;
      tol?: number;
    }
    const cols: Col[] = [];
    const names = new Set<string>();
    let bad = false;
    for (const cell of cellsOf(headLn.text)) {
      const m = /^(\S+?)(?:\s*(±|\+-)([\s\S]*))?$/.exec(cell);
      if (!m) {
        d(headLn.no, 'P013');
        bad = true;
        break;
      }
      const name = m[1];
      const isPath = /^(?:result|audit|error|id)(?:\..*)?$/.test(name);
      const isInput = !isPath && /^[A-Za-z0-9_-]+$/.test(name);
      if (!isPath && !isInput) {
        d(headLn.no, 'P013');
        bad = true;
        break;
      }
      if (names.has(name)) {
        d(headLn.no, 'P013');
        bad = true;
        break;
      }
      names.add(name);
      const col: Col = { name, input: isInput };
      if (m[2] !== undefined) {
        const t = m[3].trim();
        if (isInput || !JSON_NUMBER.test(t) || Number(t) < 0) d(headLn.no, 'P010');
        else col.tol = Number(t);
      }
      cols.push(col);
    }
    if (bad) return;
    for (const row of data.slice(1)) {
      const cells = cellsOf(row.text);
      if (cells.length !== cols.length) {
        d(row.no, 'P014');
        continue;
      }
      const kase = newCase(req, row.no, op);
      const parts: string[] = [];
      cols.forEach((col, k) => {
        const cell = cells[k];
        if (cell === '') return;
        if (col.input) {
          if (!tryJson(cell).ok) d(row.no, 'P009');
          parts.push(`${JSON.stringify(col.name)}:${cell}`);
          return;
        }
        if (cell === '?') {
          kase.expects.push({ line: row.no, path: col.name, kind: 'oracle' });
        } else if (col.tol !== undefined) {
          if (!JSON_NUMBER.test(cell)) d(row.no, 'P010');
          else kase.expects.push({ line: row.no, path: col.name, kind: 'approx', value: Number(cell), tol: col.tol });
        } else {
          const p = tryJson(cell);
          if (!p.ok) d(row.no, 'P009');
          else kase.expects.push({ line: row.no, path: col.name, kind: 'eq', value: p.value });
        }
      });
      kase.inputText = '{' + parts.join(',') + '}';
      req.cases.push(kase);
    }
  }

  void rec;
}
