import { hasBig, hasOwn, isObj, setOwn, splitWord, tryParse, dirOf } from './util.ts';

// Reading a record (REQ-RC-*, REQ-SY-*): files to a model, plus the P diagnostics found on the way.

const STATEMENTS = new Set(['duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note']);
const REST_OF_LANGUAGE = new Set(['type', 'edge', 'edgedef', 'property', 'evidence']);

function lex(text: string, dg: (line: number, code: string) => void): any[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const out: any[] = [];
  const raw = text.split(/\r\n|\n|\r/);
  for (let i = 0; i < raw.length; i++) {
    const no = i + 1;
    const s = raw[i].replace(/\s+$/, '');
    if (s === '') {
      out.push({ no, blank: true, indent: 0, text: '' });
      continue;
    }
    const lead = /^\s*/.exec(s)![0];
    if (/[^ ]/.test(lead)) {
      dg(no, 'P001');
      continue;
    }
    out.push({ no, blank: false, indent: lead.length, text: s.slice(lead.length) });
  }
  return out;
}

function clausesOf(stmt: any, dg: (line: number, code: string) => void): any[] {
  const out: any[] = [];
  let last: any = null;
  for (const l of stmt.body) {
    if (l.blank) {
      if (last) last.lines.push(l);
      continue;
    }
    if (l.indent === 1) {
      dg(l.no, 'P007');
      continue;
    }
    if (l.indent === 2) {
      if (l.text.startsWith('#')) continue;
      const [kw, rest] = splitWord(l.text);
      last = { kw, rest, line: l.no, lines: [] };
      out.push(last);
      continue;
    }
    if (!last) {
      dg(l.no, 'P006');
      continue;
    }
    last.lines.push(l);
  }
  return out;
}

function parseQuoted(s: string): string | null {
  const p = tryParse(s);
  return p.ok && typeof p.value === 'string' ? p.value : null;
}

function splitCells(text: string): string[] {
  const cells: string[] = [];
  let buf = '';
  for (let i = 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '|') {
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

function isSeparator(t: string): boolean {
  return t === '|' || /^\|[|\-:\s]*\|$/.test(t);
}

function parseNumber(s: string): number | null {
  const p = tryParse(s);
  return p.ok && typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : null;
}

function parseHeaderCell(cell: string): any {
  let i = 0;
  while (i < cell.length && !/\s/.test(cell[i]) && cell[i] !== '±' && !cell.startsWith('+-', i)) i++;
  const name = cell.slice(0, i);
  const rest = cell.slice(i).trim();
  let tolText: string | null = null;
  if (rest !== '') {
    if (rest.startsWith('±')) tolText = rest.slice(1).trim();
    else if (rest.startsWith('+-')) tolText = rest.slice(2).trim();
    else return null;
  }
  let kind: string;
  if (/^(result|audit|error|id)(\.[\s\S]*)?$/.test(name)) kind = 'path';
  else if (/^[A-Za-z0-9_-]+$/.test(name)) kind = 'field';
  else return null;
  return { kind, name, tolText, tol: null };
}

function splitFields(s: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let depth = 0;
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      cur += ch;
      if (ch === '\\' && i + 1 < s.length) cur += s[++i];
      else if (ch === '"') inQ = false;
      continue;
    }
    if (ch === '"') inQ = true;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) {
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

function parsePath(s: string): string[] | null {
  const names: string[] = [];
  let i = 0;
  for (;;) {
    let name: string;
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\') j++;
        j++;
      }
      if (j >= s.length) return null;
      const q = parseQuoted(s.slice(i, j + 1));
      if (q === null) return null;
      name = q;
      i = j + 1;
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(s.slice(i));
      if (!m) return null;
      name = m[0];
      i += name.length;
    }
    names.push(name);
    if (i === s.length) return names;
    if (s[i] !== '.') return null;
    i++;
  }
}

function badThrough(base: any, names: string[]): boolean {
  let cur = base;
  for (let i = 0; i < names.length - 1; i++) {
    if (!hasOwn(cur, names[i])) return false;
    const v = cur[names[i]];
    if (!isObj(v)) return true;
    cur = v;
  }
  return false;
}

function setPath(base: any, names: string[], value: any): void {
  let cur = base;
  for (let i = 0; i < names.length - 1; i++) {
    let v = hasOwn(cur, names[i]) ? cur[names[i]] : undefined;
    if (!isObj(v)) {
      v = {};
      setOwn(cur, names[i], v);
    }
    cur = v;
  }
  setOwn(cur, names[names.length - 1], value);
}

export function readRecord(files: Record<string, string>, names: string[], folder: string, recName: string): any {
  const diags: any[] = [];
  const G: any = {
    spec: null, oracle: null, errorsStmt: null, codes: [], ops: [], reqs: [], opens: [], decisions: [], obl: [], openExamples: [],
  };
  const versions: string[] = [];

  for (const file of names) readFile(file);

  if (new Set(versions).size > 1) diags.push({ file: recName, line: 1, code: 'P047', level: 'error' });
  if (!G.spec) diags.push({ file: recName, line: 1, code: 'P021', level: 'error' });

  function readFile(file: string): void {
    const dg = (line: number, code: string) => diags.push({ file, line, code, level: 'error' });
    const dir = dirOf(file);
    const lines = lex(files[file], dg);
    const stmts: any[] = [];
    let cur: any = null;
    for (const l of lines) {
      if (l.blank) {
        if (cur) cur.body.push(l);
        continue;
      }
      if (l.indent === 0) {
        if (l.text.startsWith('#')) continue;
        const [kw, rest] = splitWord(l.text);
        cur = { kw, rest, line: l.no, body: [] };
        stmts.push(cur);
      } else if (!cur) {
        dg(l.no, 'P003');
      } else {
        cur.body.push(l);
      }
    }

    let duramenCount = 0;
    let version: string | null = null;

    // Reads the clauses of a statement. `known` clause names, `once` the ones taken at most once.
    function each(s: any, known: string[], once: string[], handle: (c: any) => void): void {
      const seen = new Set<string>();
      for (const c of clausesOf(s, dg)) {
        if (!known.includes(c.kw)) {
          dg(c.line, 'P015');
          continue;
        }
        if (once.includes(c.kw)) {
          if (seen.has(c.kw)) {
            dg(c.line, 'P052');
            continue;
          }
          seen.add(c.kw);
        }
        handle(c);
      }
    }
    function noLines(c: any): void {
      for (const l of c.lines) if (!l.blank && !l.text.startsWith('#')) dg(l.no, 'P006');
    }
    function textOf(c: any): string {
      if (c.rest !== '') dg(c.line, 'P008');
      const out: string[] = [];
      for (const l of c.lines) {
        if (l.blank) out.push('');
        else if (l.indent < 4) dg(l.no, 'P008');
        else out.push(' '.repeat(l.indent - 4) + l.text);
      }
      while (out.length && out[0] === '') out.shift();
      while (out.length && out[out.length - 1] === '') out.pop();
      return out.join('\n');
    }
    function idTitle(s: any): string {
      const [id, t] = splitWord(s.rest);
      if (id === '' || t.length < 2 || !t.startsWith('"') || !t.endsWith('"')) dg(s.line, 'P005');
      else if (parseQuoted(t) === null) dg(s.line, 'P004');
      return id;
    }
    function requestOf(c: any): any {
      const p = tryParse(c.rest);
      if (!p.ok || hasBig(p.value) || !isObj(p.value)) {
        dg(c.line, 'P009');
        return null;
      }
      if (hasOwn(p.value, 'id') || hasOwn(p.value, 'op') || hasOwn(p.value, 'input')) {
        dg(c.line, 'P051');
        return null;
      }
      return p.value;
    }

    for (const s of stmts) {
      if (REST_OF_LANGUAGE.has(s.kw)) continue;
      if (!STATEMENTS.has(s.kw)) {
        dg(s.line, 'P002');
        continue;
      }
      switch (s.kw) {
        case 'duramen': {
          duramenCount++;
          if (duramenCount === 1) {
            if (s.rest === '0.1' || s.rest === '0.2') version = s.rest;
            else dg(s.line, 'P023');
          } else dg(s.line, 'P023');
          each(s, [], [], () => {});
          break;
        }
        case 'spec': {
          const words = s.rest === '' ? [] : s.rest.split(/\s+/);
          if (words.length !== 2) dg(s.line, 'P021');
          let me: any;
          if (G.spec) {
            dg(s.line, 'P044');
            me = {};
          } else {
            me = G.spec = { file, line: s.line, text: null, request: null };
          }
          each(s, ['title', 'text', 'contract', 'request'], ['title', 'text', 'contract', 'request'], (c) => {
            if (c.kw === 'title') {
              if (parseQuoted(c.rest) === null) dg(c.line, 'P004');
              noLines(c);
            } else if (c.kw === 'text') {
              me.text = textOf(c);
              me.textLine = c.line;
            } else if (c.kw === 'contract') noLines(c);
            else {
              me.request = requestOf(c);
              noLines(c);
            }
          });
          break;
        }
        case 'oracle': {
          if (s.rest === '') dg(s.line, 'P028');
          if (G.oracle) dg(s.line, 'P044');
          else G.oracle = { file, line: s.line, cmd: s.rest, dir };
          each(s, ['source'], [], noLines);
          break;
        }
        case 'section': {
          idTitle(s);
          each(s, ['text'], ['text'], (c) => {
            G.obl.push({ file, line: s.line, text: textOf(c), warn: false });
          });
          break;
        }
        case 'note': {
          if (s.rest !== '') dg(s.line, 'P050');
          each(s, ['text'], ['text'], (c) => {
            G.obl.push({ file, line: s.line, text: textOf(c), warn: false });
          });
          break;
        }
        case 'open': {
          idTitle(s);
          const o: any = { file, line: s.line, id: splitWord(s.rest)[0] };
          G.opens.push(o);
          each(s, ['text', 'example', 'table'], ['text'], (c) => {
            if (c.kw === 'text') G.obl.push({ file, line: s.line, text: textOf(c), warn: true });
            else G.openExamples.push({ file, line: c.line });
          });
          break;
        }
        case 'decision': {
          const d: any = { file, line: s.line, id: idTitle(s), source: '', status: null, rejected: [] };
          G.decisions.push(d);
          each(s, ['source', 'status', 'text', 'rejected'], ['source', 'status', 'text'], (c) => {
            if (c.kw === 'source') {
              d.source = c.rest;
              noLines(c);
            } else if (c.kw === 'status') {
              d.status = c.rest;
              noLines(c);
            } else if (c.kw === 'text') {
              G.obl.push({ file, line: s.line, text: textOf(c), warn: false });
            } else {
              const q = parseQuoted(c.rest);
              if (q === null) dg(c.line, 'P004');
              else G.obl.push({ file, line: s.line, text: q, warn: false });
              noLines(c);
            }
          });
          break;
        }
        case 'errors': {
          if (s.rest !== '') dg(s.line, 'P050');
          const first = !G.errorsStmt;
          if (first) G.errorsStmt = { file, line: s.line };
          else dg(s.line, 'P032');
          for (const c of clausesOf(s, dg)) {
            const m = /^when(?:\s+([\s\S]*))?$/.exec(c.rest);
            const cond: string[] = [m ? m[1] ?? '' : ''];
            if (!m || cond[0] === '') dg(c.line, 'P019');
            for (const l of c.lines) {
              if (l.blank) continue;
              if (l.indent < 4) dg(l.no, 'P006');
              else cond.push(' '.repeat(l.indent - 4) + l.text);
            }
            if (first) G.codes.push(c.kw);
            G.obl.push({ file, line: c.line, text: cond.join('\n'), warn: false });
          }
          break;
        }
        case 'op': {
          const words = s.rest === '' ? [] : s.rest.split(/\s+/);
          if (words.length !== 1) dg(s.line, 'P031');
          const op: any = { file, line: s.line, name: words[0] ?? '', fields: [], audit: false, tolerances: [], request: null };
          G.ops.push(op);
          const tolSeen = new Set<string>();
          each(s, ['input', 'result', 'tolerance', 'audit', 'request'], ['result', 'audit', 'request'], (c) => {
            if (c.kw === 'input') {
              for (const part of splitFields(c.rest)) {
                const m = /^([A-Za-z0-9_-]+)(\?)?\s+(\S[\s\S]*)$/.exec(part.trim());
                if (!m) dg(c.line, 'P017');
                else if (op.fields.some((f: any) => f.name === m[1])) dg(c.line, 'P052');
                else op.fields.push({ name: m[1], opt: m[2] === '?' });
              }
            } else if (c.kw === 'result') {
              G.obl.push({ file, line: s.line, text: c.rest, warn: false });
            } else if (c.kw === 'tolerance') {
              const [path, numText] = splitWord(c.rest);
              const n = path === '' ? null : parseNumber(numText);
              if (n === null || n < 0) dg(c.line, 'P018');
              else if (tolSeen.has(path)) dg(c.line, 'P052');
              else {
                tolSeen.add(path);
                op.tolerances.push([path, n]);
              }
            } else if (c.kw === 'audit') {
              if (c.rest !== '' && c.rest !== 'text') dg(c.line, 'P050');
              op.audit = true;
            } else {
              op.request = requestOf(c);
            }
            noLines(c);
          });
          break;
        }
        case 'req': {
          const r: any = { file, line: s.line, id: idTitle(s), platform: 'any', text: null, textLine: 0, decisions: [], examples: [] };
          G.reqs.push(r);
          each(s, ['text', 'decision', 'on', 'example', 'table'], ['text', 'on'], (c) => {
            if (c.kw === 'text') {
              r.text = textOf(c);
              r.textLine = c.line;
            } else if (c.kw === 'decision') {
              r.decisions.push(...c.rest.split(/[\s,]+/).filter(Boolean));
              noLines(c);
            } else if (c.kw === 'on') {
              if (c.rest === 'any' || c.rest === 'posix' || c.rest === 'windows') r.platform = c.rest;
              else dg(c.line, 'P033');
              noLines(c);
            } else if (c.kw === 'example') {
              r.examples.push(readExample(c));
            } else {
              readTable(c, r);
            }
          });
          break;
        }
      }
    }

    if (duramenCount === 0) dg(1, 'P020');
    if (version) versions.push(version);

    function newExample(line: number): any {
      return { file, line, raw: false, rawLine: '', op: '', inputText: null, inputObj: null, dropped: false, request: null, omit: [], expects: [], usedInput: false };
    }

    function readExpect(r: string, line: number, ex: any): void {
      const path = /^[^\s=≈~]*/.exec(r)![0];
      const after = r.slice(path.length).replace(/^\s+/, '');
      if (path === '') {
        dg(line, 'P011');
      } else if (after.startsWith('=')) {
        const v = after.slice(1).trim();
        if (v === '?') ex.expects.push({ line, path, kind: 'oracle' });
        else {
          const p = tryParse(v);
          if (!p.ok || hasBig(p.value)) dg(line, 'P009');
          else ex.expects.push({ line, path, kind: 'eq', value: p.value });
        }
      } else if (after.startsWith('≈') || after.startsWith('~')) {
        const s = after.slice(1);
        const a = s.indexOf('±');
        const b = s.indexOf('+-');
        let idx = -1;
        let len = 0;
        if (a >= 0 && (b < 0 || a < b)) {
          idx = a;
          len = 1;
        } else if (b >= 0) {
          idx = b;
          len = 2;
        }
        const n = idx < 0 ? null : parseNumber(s.slice(0, idx).trim());
        const t = idx < 0 ? null : parseNumber(s.slice(idx + len).trim());
        if (n === null || t === null || t < 0) dg(line, 'P010');
        else ex.expects.push({ line, path, kind: 'approx', value: n, tol: t });
      } else {
        dg(line, 'P011');
      }
    }

    function readExample(c: any): any {
      const ex = newExample(c.line);
      let base: any = {};
      if (c.rest === '') {
        dg(c.line, 'P012');
        ex.dropped = true;
      } else {
        const [w, r] = splitWord(c.rest);
        if (w === 'raw') {
          ex.raw = true;
          let line: string | null = null;
          if (r.startsWith('"')) line = parseQuoted(r);
          else if (r.length >= 2 && r.startsWith("'") && r.endsWith("'")) line = r.slice(1, -1);
          if (line === null) {
            dg(c.line, 'P004');
            ex.dropped = true;
          } else if (/[\r\n]/.test(line)) {
            dg(c.line, 'P026');
            ex.dropped = true;
          } else ex.rawLine = line;
        } else {
          ex.op = w;
          if (r !== '') {
            const p = tryParse(r);
            if (!p.ok || hasBig(p.value)) {
              dg(c.line, 'P009');
              ex.dropped = true;
            } else if (!isObj(p.value)) {
              dg(c.line, 'P012');
              ex.dropped = true;
            } else {
              ex.inputText = r;
              base = p.value;
            }
          }
        }
      }

      let requestRead = false;
      let pend: any = null;
      const close = () => {
        if (pend && pend.mode === 'text' && !pend.failed) {
          const t = pend.texts;
          while (t.length && t[t.length - 1] === '') t.pop();
          if (t.length === 0) dg(pend.line, 'P049');
          else setPath(base, pend.names, t.join('\n') + '\n');
        }
        pend = null;
      };
      const resolveFrom = (name: string): string | null => {
        const stack = dir === '' ? [] : dir.split('/');
        for (const p of name.split('/')) {
          if (p === '' || p === '.') continue;
          if (p === '..') {
            if (!stack.length) return null;
            stack.pop();
          } else stack.push(p);
        }
        const res = stack.join('/');
        return folder === '' || res.startsWith(folder + '/') ? res : null;
      };
      const onInput = (r: string, line: number) => {
        ex.usedInput = true;
        const t = r.trim();
        let isFrom = false;
        let file2 = '';
        let names: string[] | null;
        const m = /^([\s\S]*\S)\s+from\s+("[\s\S]*")$/.exec(t);
        const q = m ? parseQuoted(m[2]) : null;
        if (m && q !== null) {
          isFrom = true;
          file2 = q;
          names = parsePath(m[1]);
        } else names = parsePath(t);
        if (ex.raw) {
          dg(line, 'P022');
          pend = { mode: isFrom ? 'from' : 'skip' };
        } else if (isFrom) {
          pend = { mode: 'from' };
          if (!names) dg(line, 'P049');
          else {
            const res = resolveFrom(file2);
            if (res === null || !hasOwn(files, res)) dg(line, 'P048');
            else if (badThrough(base, names)) dg(line, 'P049');
            else setPath(base, names, files[res]);
          }
        } else if (!names || badThrough(base, names)) {
          dg(line, 'P049');
          pend = { mode: 'text', failed: true, texts: [] };
        } else pend = { mode: 'text', names, texts: [], line };
      };

      for (const l of c.lines) {
        if (l.blank) {
          if (pend && pend.mode === 'text') pend.texts.push('');
          continue;
        }
        if (pend && l.indent >= 6) {
          if (pend.mode === 'text') pend.texts.push(' '.repeat(l.indent - 6) + l.text);
          else if (pend.mode === 'from' && !l.text.startsWith('#')) dg(l.no, 'P006');
          continue;
        }
        close();
        if (l.text.startsWith('#')) continue;
        if (l.indent !== 4) {
          dg(l.no, 'P006');
          continue;
        }
        const [w, r] = splitWord(l.text);
        if (w === 'expect') readExpect(r, l.no, ex);
        else if (w === 'request') {
          if (ex.raw) dg(l.no, 'P022');
          else if (requestRead) dg(l.no, 'P052');
          else {
            const p = requestOf({ rest: r, line: l.no });
            if (p) {
              ex.request = p;
              requestRead = true;
            }
          }
        } else if (w === 'omit') {
          if (ex.raw) dg(l.no, 'P022');
          else {
            const names = r.split(/[,\s]+/).filter(Boolean);
            if (names.length === 0) dg(l.no, 'P011');
            else ex.omit.push(...names);
          }
        } else if (w === 'input') onInput(r, l.no);
        else dg(l.no, 'P011');
      }
      close();
      if (ex.usedInput && !ex.raw) {
        ex.inputObj = base;
        ex.inputText = JSON.stringify(base);
      } else if (ex.inputText !== null) ex.inputObj = base;
      return ex;
    }

    function readTable(c: any, req: any): void {
      const words = c.rest === '' ? [] : c.rest.split(/\s+/);
      if (words.length !== 1) {
        dg(c.line, 'P013');
        return;
      }
      const rows: any[] = [];
      for (const l of c.lines) {
        if (l.blank || l.text.startsWith('#')) continue;
        if (l.indent >= 4 && l.text.startsWith('|')) {
          if (!isSeparator(l.text)) rows.push(l);
        } else dg(l.no, 'P006');
      }
      if (rows.length < 2) {
        dg(c.line, 'P013');
        return;
      }
      const header = rows[0];
      const cols: any[] = [];
      const seen = new Set<string>();
      for (const cell of splitCells(header.text)) {
        const col = parseHeaderCell(cell);
        if (!col || seen.has(col.name)) {
          dg(header.no, 'P013');
          return;
        }
        seen.add(col.name);
        if (col.tolText !== null) {
          const t = col.kind === 'field' ? null : parseNumber(col.tolText);
          if (t === null || t < 0) dg(header.no, 'P010');
          else col.tol = t;
        }
        cols.push(col);
      }
      for (const row of rows.slice(1)) {
        const cells = splitCells(row.text);
        if (cells.length !== cols.length) {
          dg(row.no, 'P014');
          continue;
        }
        const ex = newExample(row.no);
        ex.op = words[0];
        const parts: string[] = [];
        cells.forEach((cell, i) => {
          const col = cols[i];
          if (cell === '') return;
          if (col.kind === 'field') {
            const p = tryParse(cell);
            if (!p.ok || hasBig(p.value)) dg(row.no, 'P009');
            else parts.push(JSON.stringify(col.name) + ':' + cell);
          } else if (cell === '?') {
            ex.expects.push({ line: row.no, path: col.name, kind: 'oracle' });
          } else if (col.tol !== null) {
            const v = parseNumber(cell);
            if (v === null) dg(row.no, 'P010');
            else ex.expects.push({ line: row.no, path: col.name, kind: 'approx', value: v, tol: col.tol });
          } else {
            const p = tryParse(cell);
            if (!p.ok || hasBig(p.value)) dg(row.no, 'P009');
            else ex.expects.push({ line: row.no, path: col.name, kind: 'eq', value: p.value });
          }
        });
        ex.inputText = '{' + parts.join(',') + '}';
        ex.inputObj = tryParse(ex.inputText).value ?? {};
        req.examples.push(ex);
      }
    }
  }

  return { model: G, diags };
}
