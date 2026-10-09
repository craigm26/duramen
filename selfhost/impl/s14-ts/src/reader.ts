import type { Diag, Example, Expect, Op, Rec, Req } from './model.ts';
import {
  hasOwn,
  isPlainObject,
  parseJson,
  parseNumberText,
  setOwn,
  splitFirstWord,
  words,
} from './util.ts';

interface Line {
  no: number;
  indent: number;
  content: string;
  blank: boolean;
}

interface Group {
  kw: string;
  rest: string;
  line: number;
  body: Line[];
}

export interface ReadCtx {
  files: Record<string, string>;
  recordFolder: string[];
  recordName: string;
  diags: Diag[];
  rec: Rec;
  specCount: number;
  oracleCount: number;
  errorsCount: number;
  versions: Set<string>;
}

export function newRec(): Rec {
  return { errorCodes: [], ops: [], reqs: [], decisions: [], opens: [], obligations: [] };
}

const OTHER_STATEMENTS = new Set(['type', 'edge', 'edgedef', 'property', 'evidence']);
const PLATFORMS = new Set(['any', 'posix', 'windows']);

type Handler = { once?: boolean; fn: (g: Group) => void };

export function readFile(ctx: ReadCtx, name: string, text: string): void {
  const diag = (code: string, line: number) =>
    ctx.diags.push({ file: name, line, level: 'error', code });
  const rec = ctx.rec;
  const dir = name.split('/').slice(0, -1);

  // ---- lines -----------------------------------------------------------
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines: Line[] = [];
  text.split(/\r\n|\r|\n/).forEach((s, i) => {
    const no = i + 1;
    const t = s.trimEnd();
    if (t === '') {
      lines.push({ no, indent: 0, content: '', blank: true });
      return;
    }
    let ind = 0;
    while (t[ind] === ' ') ind++;
    if (/\s/.test(t[ind])) {
      diag('P001', no);
      return;
    }
    lines.push({ no, indent: ind, content: t.slice(ind), blank: false });
  });

  // ---- statements ------------------------------------------------------
  const stmts: Group[] = [];
  let cur: Group | null = null;
  for (const l of lines) {
    if (l.blank) {
      cur?.body.push(l);
      continue;
    }
    if (cur === null && l.indent > 0) {
      diag('P003', l.no);
      continue;
    }
    if (l.indent === 0) {
      if (l.content.startsWith('#')) continue;
      const [kw, rest] = splitFirstWord(l.content);
      cur = { kw, rest, line: l.no, body: [] };
      stmts.push(cur);
    } else {
      cur!.body.push(l);
    }
  }

  // ---- helpers ---------------------------------------------------------
  const isComment = (l: Line) => l.content.startsWith('#');

  const noBody = (g: Group) => {
    for (const l of g.body) if (!l.blank && !isComment(l)) diag('P006', l.no);
  };

  const clausesOf = (body: Line[]): Group[] => {
    const groups: Group[] = [];
    let c: Group | null = null;
    for (const l of body) {
      if (l.blank) {
        c?.body.push(l);
        continue;
      }
      if (l.indent === 1) {
        diag('P007', l.no);
        continue;
      }
      if (l.indent === 2) {
        if (isComment(l)) continue;
        const [kw, rest] = splitFirstWord(l.content);
        c = { kw, rest, line: l.no, body: [] };
        groups.push(c);
        continue;
      }
      if (c === null) diag('P006', l.no);
      else c.body.push(l);
    }
    return groups;
  };

  const runClauses = (body: Line[], spec: Record<string, Handler>) => {
    const seen = new Set<string>();
    for (const g of clausesOf(body)) {
      const h = hasOwn(spec, g.kw) ? spec[g.kw] : undefined;
      if (!h) {
        diag('P015', g.line);
        continue;
      }
      if (h.once) {
        if (seen.has(g.kw)) {
          diag('P052', g.line);
          continue;
        }
        seen.add(g.kw);
      }
      h.fn(g);
    }
  };

  const readText = (g: Group): string => {
    if (g.rest !== '') diag('P008', g.line);
    const out: string[] = [];
    for (const l of g.body) {
      if (l.blank) out.push('');
      else if (l.indent >= 4) out.push(' '.repeat(l.indent - 4) + l.content);
      else diag('P008', l.no);
    }
    while (out.length > 0 && out[0] === '') out.shift();
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    return out.join('\n');
  };

  const quoted = (s: string): string | null => {
    const p = parseJson(s);
    return p.ok && typeof p.value === 'string' ? p.value : null;
  };

  /** `<ID> "<title>"`; returns the ID. */
  const readHeader = (rest: string, line: number): string => {
    const [id, title] = splitFirstWord(rest);
    if (id === '' || title.length < 2 || !title.startsWith('"') || !title.endsWith('"')) {
      diag('P005', line);
    } else if (quoted(title) === null) {
      diag('P004', line);
    }
    return id;
  };

  const readRequestText = (text: string, line: number): Record<string, unknown> | undefined => {
    const p = parseJson(text);
    if (!p.ok || !isPlainObject(p.value)) {
      diag('P009', line);
      return undefined;
    }
    if (hasOwn(p.value, 'id') || hasOwn(p.value, 'op') || hasOwn(p.value, 'input')) {
      diag('P051', line);
      return undefined;
    }
    return p.value;
  };

  const obligation = (line: number, text: string, warn = false) =>
    rec.obligations.push({ file: name, line, text, warn });

  // ---- examples --------------------------------------------------------
  const parsePath = (s: string): string[] | null => {
    const segs: string[] = [];
    let i = 0;
    for (;;) {
      if (s[i] === '"') {
        let j = i + 1;
        while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
        if (j >= s.length) return null;
        const v = quoted(s.slice(i, j + 1));
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
  };

  const parseFromForm = (rest: string): { path: string; file: string } | null => {
    for (const m of rest.matchAll(/\s+from\s+/g)) {
      const file = quoted(rest.slice(m.index + m[0].length));
      if (file !== null) return { path: rest.slice(0, m.index), file };
    }
    return null;
  };

  const resolveFrom = (file: string, exDir: string[]): string | null => {
    const cur = [...exDir];
    for (const p of file.split('/')) {
      if (p === '' || p === '.') continue;
      if (p === '..') {
        if (cur.length === 0) return null;
        cur.pop();
      } else cur.push(p);
    }
    const rf = ctx.recordFolder;
    if (cur.length < rf.length || rf.some((p, i) => cur[i] !== p)) return null;
    const n = cur.join('/');
    return hasOwn(ctx.files, n) ? ctx.files[n] : null;
  };

  const parseExpect = (rest: string, line: number): Expect | null => {
    const m = /^([^\s=≈~]+)\s*([\s\S]*)$/.exec(rest);
    if (!m || m[2] === '') {
      diag('P011', line);
      return null;
    }
    const path = m[1];
    const tail = m[2];
    if (tail[0] === '=') {
      const v = tail.slice(1).trim();
      if (v === '?') return { line, path, kind: 'oracle' };
      const p = parseJson(v);
      if (!p.ok) {
        diag('P009', line);
        return null;
      }
      return { line, path, kind: 'eq', value: p.value };
    }
    if (tail[0] === '≈' || tail[0] === '~') {
      const m2 = /^([\s\S]*?)(?:±|\+-)([\s\S]*)$/.exec(tail.slice(1));
      const value = m2 ? parseNumberText(m2[1].trim()) : null;
      const tol = m2 ? parseNumberText(m2[2].trim()) : null;
      if (value === null || tol === null || tol < 0) {
        diag('P010', line);
        return null;
      }
      return { line, path, kind: 'approx', value, tol };
    }
    diag('P011', line);
    return null;
  };

  const readExample = (g: Group, req: Req) => {
    const ex: Example = {
      file: name,
      dir,
      line: g.line,
      raw: false,
      hasInputLines: false,
      omit: [],
      expects: [],
      isRow: false,
      caseId: '',
    };
    req.examples.push(ex);
    if (g.rest === '') {
      diag('P012', g.line);
    } else {
      const [w, after] = splitFirstWord(g.rest);
      if (w === 'raw') {
        ex.raw = true;
        let l: string | null = null;
        if (after.startsWith('"')) l = quoted(after);
        else if (after.length >= 2 && after.startsWith("'") && after.endsWith("'")) l = after.slice(1, -1);
        if (l === null) diag('P004', g.line);
        else if (/[\r\n]/.test(l)) diag('P026', g.line);
        else ex.rawLine = l;
      } else {
        ex.op = w;
        if (after !== '') {
          const p = parseJson(after);
          if (!p.ok) diag('P009', g.line);
          else if (!isPlainObject(p.value)) diag('P012', g.line);
          else {
            ex.jsonText = after;
            ex.jsonValue = p.value;
          }
        }
      }
    }

    let pending: { line: number; path: string; file?: string; kind: 'text' | 'from' | 'skip'; lines: string[] } | null =
      null;

    const finalize = () => {
      const p = pending;
      pending = null;
      if (p === null || p.kind === 'skip' || ex.raw) return;
      const segs = parsePath(p.path);
      if (segs === null) {
        diag('P049', p.line);
        return;
      }
      let value: string;
      if (p.kind === 'from') {
        const t = resolveFrom(p.file!, dir);
        if (t === null) {
          diag('P048', p.line);
          return;
        }
        value = t;
      } else {
        value = '';
      }
      if (ex.inputObj === undefined) {
        ex.inputObj = isPlainObject(ex.jsonValue) ? ex.jsonValue : {};
      }
      let o: Record<string, unknown> = ex.inputObj;
      let through = true;
      for (let i = 0; i < segs.length - 1; i++) {
        if (!hasOwn(o, segs[i])) break;
        const v = o[segs[i]];
        if (!isPlainObject(v)) {
          through = false;
          break;
        }
        o = v;
      }
      if (!through) {
        diag('P049', p.line);
        return;
      }
      if (p.kind === 'text') {
        const ls = [...p.lines];
        while (ls.length > 0 && ls[ls.length - 1] === '') ls.pop();
        if (ls.length === 0) {
          diag('P049', p.line);
          return;
        }
        value = ls.join('\n') + '\n';
      }
      o = ex.inputObj;
      for (let i = 0; i < segs.length - 1; i++) {
        if (!hasOwn(o, segs[i])) setOwn(o, segs[i], {});
        o = o[segs[i]] as Record<string, unknown>;
      }
      setOwn(o, segs[segs.length - 1], value);
    };

    for (const l of g.body) {
      if (l.blank) {
        if (pending !== null) pending.lines.push('');
        continue;
      }
      if (l.indent >= 6 && pending !== null) {
        if (pending.kind === 'text') pending.lines.push(' '.repeat(l.indent - 6) + l.content);
        else if (pending.kind === 'from' && !isComment(l)) diag('P006', l.no);
        continue;
      }
      finalize();
      if (isComment(l)) continue;
      if (l.indent !== 4) {
        diag('P006', l.no);
        continue;
      }
      const [kw, rest] = splitFirstWord(l.content);
      if (kw === 'expect') {
        const e = parseExpect(rest, l.no);
        if (e) ex.expects.push(e);
      } else if (kw === 'request') {
        if (ex.raw) diag('P022', l.no);
        else if (ex.request !== undefined) diag('P052', l.no);
        else {
          const r = readRequestText(rest, l.no);
          if (r) ex.request = r;
        }
      } else if (kw === 'omit') {
        if (ex.raw) diag('P022', l.no);
        else {
          const names = rest.split(/[,\s]+/).filter((n) => n !== '');
          if (names.length === 0) diag('P011', l.no);
          else ex.omit.push(...names);
        }
      } else if (kw === 'input') {
        const f = parseFromForm(rest);
        if (ex.raw) {
          diag('P022', l.no);
          pending = { line: l.no, path: '', kind: f ? 'from' : 'skip', lines: [] };
        } else {
          ex.hasInputLines = true;
          pending = f
            ? { line: l.no, path: f.path, file: f.file, kind: 'from', lines: [] }
            : { line: l.no, path: rest, kind: 'text', lines: [] };
        }
      } else {
        diag('P011', l.no);
      }
    }
    finalize();
  };

  // ---- tables ----------------------------------------------------------
  const splitCells = (content: string): string[] => {
    const cells: string[] = [];
    let cur = '';
    const s = content.slice(1);
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\' && s[i + 1] === '|') {
        cur += '|';
        i++;
      } else if (s[i] === '|') {
        cells.push(cur);
        cur = '';
      } else cur += s[i];
    }
    cells.push(cur);
    if (cells[cells.length - 1].trim() === '') cells.pop();
    return cells.map((c) => c.trim());
  };

  const readTable = (g: Group, req: Req) => {
    const rows: Line[] = [];
    for (const l of g.body) {
      if (l.blank || isComment(l)) continue;
      if (l.indent >= 4 && l.content.startsWith('|')) rows.push(l);
      else diag('P006', l.no);
    }
    const ws = words(g.rest);
    const real = rows.filter((l) => !/^\|(?:[|\-:\s]*\|)?$/.test(l.content));
    if (ws.length !== 1 || real.length < 2) {
      diag('P013', g.line);
      return;
    }
    const header = real[0];
    interface Col {
      name: string;
      expect: boolean;
      tol?: number;
    }
    const cols: Col[] = [];
    const names = new Set<string>();
    let bad = false;
    for (const cell of splitCells(header.content)) {
      const m = /^((?:(?!\+-)[^\s±])*)([\s\S]*)$/.exec(cell)!;
      const cname = m[1];
      const after = m[2].trim();
      let tolText: string | null = null;
      let form = cname !== '' && !names.has(cname);
      if (form && after !== '') {
        if (after.startsWith('±')) tolText = after.slice(1).trim();
        else if (after.startsWith('+-')) tolText = after.slice(2).trim();
        else form = false;
      }
      const expect = /^(?:result|audit|error|id)(?:\.|$)/.test(cname);
      if (form && !expect && !/^[A-Za-z0-9_-]+$/.test(cname)) form = false;
      if (!form) {
        diag('P013', header.no);
        bad = true;
        break;
      }
      names.add(cname);
      const col: Col = { name: cname, expect };
      if (tolText !== null) {
        const t = parseNumberText(tolText);
        if (t === null || t < 0 || !expect) diag('P010', header.no);
        else col.tol = t;
      }
      cols.push(col);
    }
    if (bad) return;
    for (const row of real.slice(1)) {
      const cells = splitCells(row.content);
      if (cells.length !== cols.length) {
        diag('P014', row.no);
        continue;
      }
      const ex: Example = {
        file: name,
        dir,
        line: row.no,
        raw: false,
        op: ws[0],
        hasInputLines: false,
        omit: [],
        expects: [],
        isRow: true,
        caseId: '',
      };
      const inputs: string[] = [];
      const inputKeys: Record<string, unknown> = {};
      cells.forEach((cell, i) => {
        if (cell === '') return;
        const col = cols[i];
        if (col.expect) {
          if (cell === '?') {
            ex.expects.push({ line: row.no, path: col.name, kind: 'oracle' });
          } else if (col.tol !== undefined) {
            const n = parseNumberText(cell);
            if (n === null) diag('P010', row.no);
            else ex.expects.push({ line: row.no, path: col.name, kind: 'approx', value: n, tol: col.tol });
          } else {
            const p = parseJson(cell);
            if (!p.ok) diag('P009', row.no);
            else ex.expects.push({ line: row.no, path: col.name, kind: 'eq', value: p.value });
          }
        } else {
          const p = parseJson(cell);
          if (!p.ok) diag('P009', row.no);
          else {
            inputs.push(`"${col.name}":${cell}`);
            setOwn(inputKeys, col.name, p.value);
          }
        }
      });
      ex.jsonText = '{' + inputs.join(',') + '}';
      ex.jsonValue = inputKeys;
      req.examples.push(ex);
    }
  };

  // ---- statements ------------------------------------------------------
  let durCount = 0;
  for (const s of stmts) {
    const { kw, rest, line } = s;
    switch (kw) {
      case 'duramen': {
        durCount++;
        if (durCount === 1) {
          if (rest === '0.1' || rest === '0.2') ctx.versions.add(rest);
          else diag('P023', line);
        } else diag('P023', line);
        runClauses(s.body, {});
        break;
      }
      case 'spec': {
        const first = ctx.specCount++ === 0;
        if (!first) diag('P044', line);
        if (words(rest).length !== 2) diag('P021', line);
        const info: NonNullable<Rec['spec']> = { file: name, line };
        if (first) rec.spec = info;
        runClauses(s.body, {
          title: {
            once: true,
            fn: (g) => {
              if (quoted(g.rest) === null) diag('P004', g.line);
              noBody(g);
            },
          },
          text: { once: true, fn: (g) => obligation(line, readText(g)) },
          contract: { once: true, fn: noBody },
          request: {
            once: true,
            fn: (g) => {
              const r = readRequestText(g.rest, g.line);
              if (r && first) info.request = r;
              noBody(g);
            },
          },
        });
        break;
      }
      case 'oracle': {
        const first = ctx.oracleCount++ === 0;
        if (!first) diag('P044', line);
        if (rest === '') diag('P028', line);
        if (first) rec.oracle = { file: name, line, command: rest, dir };
        runClauses(s.body, { source: { fn: noBody } });
        break;
      }
      case 'section': {
        readHeader(rest, line);
        runClauses(s.body, { text: { once: true, fn: (g) => obligation(line, readText(g)) } });
        break;
      }
      case 'note': {
        if (rest !== '') diag('P050', line);
        runClauses(s.body, { text: { once: true, fn: (g) => obligation(line, readText(g)) } });
        break;
      }
      case 'op': {
        const ws = words(rest);
        if (ws.length !== 1) diag('P031', line);
        const op: Op = {
          file: name,
          line,
          name: ws[0] ?? '',
          fields: [],
          tolerances: new Map(),
          audit: false,
        };
        rec.ops.push(op);
        const seenFields = new Set<string>();
        runClauses(s.body, {
          input: {
            fn: (g) => {
              noBody(g);
              for (const piece of splitFields(g.rest)) {
                const m = /^([A-Za-z0-9_-]+)(\?)?\s+(\S[\s\S]*)$/.exec(piece.trim());
                if (!m) diag('P017', g.line);
                else if (seenFields.has(m[1])) diag('P052', g.line);
                else {
                  seenFields.add(m[1]);
                  op.fields.push({ name: m[1], optional: m[2] === '?' });
                }
              }
            },
          },
          result: {
            once: true,
            fn: (g) => {
              noBody(g);
              obligation(line, g.rest);
            },
          },
          tolerance: {
            fn: (g) => {
              noBody(g);
              const [path, numText] = splitFirstWord(g.rest);
              const n = parseNumberText(numText);
              if (path === '' || n === null || n < 0) diag('P018', g.line);
              else if (op.tolerances.has(path)) diag('P052', g.line);
              else op.tolerances.set(path, n);
            },
          },
          audit: {
            once: true,
            fn: (g) => {
              noBody(g);
              if (g.rest !== '' && g.rest !== 'text') diag('P050', g.line);
              else op.audit = true;
            },
          },
          request: {
            once: true,
            fn: (g) => {
              noBody(g);
              const r = readRequestText(g.rest, g.line);
              if (r) op.request = r;
            },
          },
        });
        break;
      }
      case 'errors': {
        const first = ctx.errorsCount++ === 0;
        if (!first) diag('P032', line);
        if (rest !== '') diag('P050', line);
        for (const g of clausesOf(s.body)) {
          const [w2, cond] = splitFirstWord(g.rest);
          const parts = [cond];
          for (const l of g.body) {
            if (l.blank) continue;
            if (l.indent < 4) diag('P006', l.no);
            else parts.push(' '.repeat(l.indent - 4) + l.content);
          }
          if (w2 !== 'when' || cond === '') {
            diag('P019', g.line);
            continue;
          }
          if (first) {
            rec.errorCodes.push(g.kw);
            obligation(g.line, parts.join('\n'));
          }
        }
        break;
      }
      case 'req': {
        const id = readHeader(rest, line);
        const req: Req = { file: name, line, id, platform: 'any', decisions: [], examples: [] };
        rec.reqs.push(req);
        runClauses(s.body, {
          text: {
            once: true,
            fn: (g) => {
              req.text = { line: g.line, text: readText(g) };
            },
          },
          decision: {
            fn: (g) => {
              noBody(g);
              req.decisions.push(...g.rest.split(/[,\s]+/).filter((d) => d !== ''));
            },
          },
          on: {
            once: true,
            fn: (g) => {
              noBody(g);
              if (!PLATFORMS.has(g.rest)) diag('P033', g.line);
              else req.platform = g.rest;
            },
          },
          example: { fn: (g) => readExample(g, req) },
          table: { fn: (g) => readTable(g, req) },
        });
        req.examples.forEach((e, i) => (e.caseId = `${id}#${i + 1}`));
        break;
      }
      case 'open': {
        const id = readHeader(rest, line);
        const open = { file: name, line, id, exTableLines: [] as number[] };
        rec.opens.push(open);
        runClauses(s.body, {
          text: { once: true, fn: (g) => obligation(line, readText(g), true) },
          example: { fn: (g) => open.exTableLines.push(g.line) },
          table: { fn: (g) => open.exTableLines.push(g.line) },
        });
        break;
      }
      case 'decision': {
        const id = readHeader(rest, line);
        const dec = { file: name, line, id, source: undefined as string | undefined, hasStatus: false, status: '' };
        rec.decisions.push(dec);
        runClauses(s.body, {
          source: {
            once: true,
            fn: (g) => {
              noBody(g);
              dec.source = g.rest;
            },
          },
          status: {
            once: true,
            fn: (g) => {
              noBody(g);
              dec.hasStatus = true;
              dec.status = g.rest;
            },
          },
          text: { once: true, fn: (g) => obligation(line, readText(g)) },
          rejected: {
            fn: (g) => {
              noBody(g);
              const v = quoted(g.rest);
              if (v === null) diag('P004', g.line);
              else obligation(line, v);
            },
          },
        });
        break;
      }
      default:
        if (!OTHER_STATEMENTS.has(kw)) diag('P002', line);
    }
  }
  if (durCount === 0) diag('P020', 1);
}

/** Splits `input` fields at commas outside double quotes and brackets. */
function splitFields(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      cur += c;
      if (c === '\\' && i + 1 < s.length) cur += s[++i];
      else if (c === '"') inQ = false;
    } else if (c === '"') {
      inQ = true;
      cur += c;
    } else if ('([{'.includes(c)) {
      depth++;
      cur += c;
    } else if (')]}'.includes(c)) {
      if (depth > 0) depth--;
      cur += c;
    } else if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}
