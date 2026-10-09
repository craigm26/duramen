import { readRecord } from './reader.ts';
import { responsesById, runOracle, soloResponse } from './oracle.ts';
import { cmp, deepEqual, dirOf, hasOwn, lookup, setOwn } from './util.ts';

const LEVELS = ['error', 'warning', 'info'];

function resolveRecord(files: Record<string, string>, entry: string | undefined): any {
  const all = Object.keys(files);
  if (entry === undefined || entry === '.') return pick(all, '', '.', '');
  if (hasOwn(files, entry)) return { names: [entry], folder: dirOf(entry), recName: entry };
  if (all.some((n) => n.startsWith(entry + '/'))) return pick(all, entry + '/', entry, entry);
  return { names: [], folder: '', recName: entry };
}

function pick(all: string[], prefix: string, recName: string, folder: string): any {
  const rel: [string, string][] = [];
  for (const n of all) {
    if (!n.startsWith(prefix)) continue;
    const r = n.slice(prefix.length);
    if (!r.endsWith('.duramen')) continue;
    const parts = r.split('/');
    if (parts.some((p, i) => p.startsWith('.') || (i < parts.length - 1 && (p === 'build' || p === 'node_modules')))) continue;
    rel.push([r, n]);
  }
  rel.sort((a, b) => cmp(a[0], b[0]));
  return { names: rel.map((x) => x[1]), folder, recName };
}

const OBLIGATION = /(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])/;

function unquoted(line: string): string {
  const closers: Record<string, string> = { '"': '"', '“': '”', '`': '`' };
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (hasOwn(closers, ch)) {
      const j = line.indexOf(closers[ch], i + 1);
      if (j >= 0) {
        out += ' ';
        i = j;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function holdsObligation(text: string): boolean {
  return text.split(/\r\n|\n|\r/).some((l) => OBLIGATION.test(unquoted(l)));
}

const ORDER_PHRASE = new RegExp(
  '(?<![A-Za-z0-9_])(?:in\\s+this\\s+order|in\\s+the\\s+order|first\\s+that\\s+applies|first\\s+match|precede|precedes|preceded|before|after|take\\s+precedence|takes\\s+precedence)(?![A-Za-z0-9_])',
  'i',
);

function namesCode(text: string, code: string): boolean {
  let from = 0;
  for (;;) {
    const i = text.indexOf(code, from);
    if (i < 0) return false;
    const before = i === 0 ? '' : text[i - 1];
    const after = text[i + code.length] ?? '';
    if (!/[A-Za-z0-9_-]/.test(before) && !/[A-Za-z0-9_-]/.test(after)) return true;
    from = i + 1;
  }
}

const STATUS_WORDS = ['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected'];

function requestLine(ex: any, id: string, op: any, spec: any): string {
  if (ex.raw) return ex.rawLine;
  const members: any = {};
  const base = op && op.request ? op.request : spec && spec.request ? spec.request : {};
  for (const [k, v] of Object.entries(base)) setOwn(members, k, v);
  if (ex.request) for (const [k, v] of Object.entries(ex.request)) setOwn(members, k, v);
  for (const k of ex.omit) delete members[k];
  const omit = new Set<string>(ex.omit);
  const parts: string[] = [];
  if (!omit.has('id')) parts.push('"id":' + JSON.stringify(id));
  if (!omit.has('op')) parts.push('"op":' + JSON.stringify(ex.op));
  for (const [k, v] of Object.entries(members)) parts.push(JSON.stringify(k) + ':' + JSON.stringify(v));
  if (ex.inputText !== null && !omit.has('input')) parts.push('"input":' + ex.inputText);
  return '{' + parts.join(',') + '}';
}

export function runCheck(files: Record<string, string>, entry: string | undefined, wantCases: boolean): any {
  const rec = resolveRecord(files, entry);
  let diags: any[] = [];
  let cases: any[] = [];
  if (rec.names.length === 0) {
    diags.push({ file: rec.recName, line: 1, code: 'P046', level: 'error' });
  } else {
    const { model, diags: pd } = readRecord(files, rec.names, rec.folder, rec.recName);
    diags = pd;
    if (!diags.some((d) => d.level === 'error')) {
      const r = checkModel(files, model, wantCases);
      diags = r.diags;
      cases = r.cases;
    }
  }
  diags.sort((a, b) => cmp(a.file, b.file) || a.line - b.line || cmp(a.code, b.code) || LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
  const errors = diags.filter((d) => d.level === 'error').length;
  const warnings = diags.filter((d) => d.level === 'warning').length;
  return { diags, errors, warnings, cases: errors === 0 ? cases : [] };
}

function checkModel(files: Record<string, string>, M: any, wantCases: boolean): any {
  const diags: any[] = [];
  const add = (file: string, line: number, code: string, level = 'error') => diags.push({ file, line, code, level });

  // IDs are unique (REQ-CK-002).
  const dup = (items: any[], key: (x: any) => string) => {
    const seen = new Set<string>();
    for (const it of items) {
      const k = key(it);
      if (seen.has(k)) add(it.file, it.line, 'T007');
      seen.add(k);
    }
  };
  dup(M.reqs, (x) => x.id);
  dup(M.opens, (x) => x.id);
  dup(M.decisions, (x) => x.id);
  dup(M.ops, (x) => x.name);
  const opByName = new Map<string, any>();
  for (const op of M.ops) if (!opByName.has(op.name)) opByName.set(op.name, op);

  // Open items are not tested (REQ-CK-007).
  for (const o of M.openExamples) add(o.file, o.line, 'T003');

  // Obligations (REQ-CK-006).
  for (const o of M.obl) {
    if (holdsObligation(o.text)) add(o.file, o.line, o.warn ? 'T014' : 'T004', o.warn ? 'warning' : 'error');
  }
  if (M.spec && M.spec.text !== null && holdsObligation(M.spec.text)) add(M.spec.file, M.spec.line, 'T004');

  // Requirements (REQ-CK-001, 003, 008).
  const declared = new Map<string, any>();
  for (const d of M.decisions) if (!declared.has(d.id)) declared.set(d.id, d);
  const cited = new Set<string>();
  const codes: string[] = [...new Set<string>(M.codes)];
  for (const r of M.reqs) {
    if (r.examples.length === 0) add(r.file, r.line, 'T001');
    const mine = new Set<string>(r.decisions);
    for (const id of mine) {
      cited.add(id);
      const d = declared.get(id);
      if (!d) {
        add(r.file, r.line, 'T008');
        continue;
      }
      const w = d.status === null ? 'accepted' : d.status.split(/\s+/)[0];
      if (w === 'contested' || w === 'superseded' || w === 'rejected') add(r.file, r.line, 'T028');
      else if (w === 'observed' || w === 'inferred' || w === 'proposed') add(r.file, r.line, 'T028', 'warning');
    }
    if (r.text !== null && codes.filter((c) => namesCode(r.text, c)).length >= 2 && ORDER_PHRASE.test(r.text)) {
      add(r.file, r.textLine, 'T005');
    }
  }

  // Decisions (REQ-CK-009).
  for (const d of M.decisions) {
    if (!cited.has(d.id)) add(d.file, d.line, 'T012', 'warning');
    if (d.source === '') add(d.file, d.line, 'T013', 'warning');
    if (d.status !== null) {
      const w = d.status.split(/\s+/)[0];
      let ok = STATUS_WORDS.includes(w);
      if (ok && w === 'superseded') {
        const m = /^superseded by (\S+)$/.exec(d.status);
        ok = m !== null && declared.has(m[1]);
      }
      if (!ok) add(d.file, d.line, 'T027');
    }
  }

  // Examples against operations and errors (REQ-CK-004, 005).
  const all: any[] = [];
  for (const r of M.reqs) {
    r.examples.forEach((ex: any, i: number) => {
      ex.id = `${r.id}#${i + 1}`;
      ex.req = r;
      all.push(ex);
    });
  }
  for (const ex of all) {
    const expectsError = ex.expects.some((e: any) => e.path === 'error');
    if (!ex.raw && !expectsError) {
      const op = opByName.get(ex.op);
      if (!op) add(ex.file, ex.line, 'T009');
      else {
        const keys = ex.inputObj ? Object.keys(ex.inputObj) : [];
        for (const f of op.fields) if (!f.opt && !keys.includes(f.name)) add(ex.file, ex.line, 'T010');
        for (const k of keys) if (!op.fields.some((f: any) => f.name === k)) add(ex.file, ex.line, 'T011', 'warning');
      }
    }
    for (const e of ex.expects) {
      if (e.path !== 'error' || e.kind === 'oracle') continue;
      if (e.kind !== 'eq' || typeof e.value !== 'string' || !codes.includes(e.value)) add(ex.file, e.line, 'T023');
    }
  }

  // The oracle (REQ-OR-*).
  const resps = new Map<any, any>();
  if (all.length > 0 && !M.oracle) {
    add(M.spec.file, M.spec.line, 'T019');
  } else if (all.length > 0) {
    const runnable = all.filter((ex) => ex.raw || ex.expects.some((e: any) => e.path === 'error') || opByName.has(ex.op));
    for (const ex of runnable) {
      const op = ex.raw ? null : opByName.get(ex.op);
      ex.sentLine = requestLine(ex, ex.id, op, M.spec);
      ex.solo = ex.raw || ex.omit.includes('id');
    }
    const shared = runnable.filter((ex) => !ex.solo);
    let byId = new Map<string, any>();
    if (shared.length > 0) {
      const r = runOracle(files, M.oracle.cmd, M.oracle.dir, shared.map((ex) => ex.sentLine));
      if (r.failed) add(M.oracle.file, M.oracle.line, 'T020');
      byId = responsesById(r.lines);
    }
    for (const ex of runnable) {
      if (!ex.solo) {
        if (byId.has(ex.id)) resps.set(ex, byId.get(ex.id));
      } else {
        const r = runOracle(files, M.oracle.cmd, M.oracle.dir, [ex.sentLine]);
        if (r.failed) add(ex.file, ex.line, 'T020');
        const resp = soloResponse(r.lines);
        if (resp) resps.set(ex, resp);
      }
    }
    for (const ex of runnable) {
      const resp = resps.get(ex);
      if (!resp) {
        add(ex.file, ex.line, 'T021');
        continue;
      }
      if (hasOwn(resp, 'oracle_error')) {
        add(ex.file, ex.line, 'T022');
        continue;
      }
      if (hasOwn(resp, 'error') && ex.expects.length === 0) add(ex.file, ex.line, 'T024', 'warning');
      for (const e of ex.expects) {
        const got = lookup(resp, e.path);
        if (e.kind === 'oracle') {
          if (!got.found) add(ex.file, e.line, 'T025');
        } else if (e.kind === 'eq') {
          if (!got.found || !deepEqual(got.value, e.value)) add(ex.file, e.line, 'T002');
        } else if (!got.found || typeof got.value !== 'number' || !(Math.abs(got.value - e.value) <= e.tol)) {
          add(ex.file, e.line, 'T002');
        }
      }
    }
  }

  const cases: any[] = [];
  if (wantCases && !diags.some((d) => d.level === 'error')) {
    for (const ex of all) {
      const resp = resps.get(ex);
      const op = ex.raw ? null : opByName.get(ex.op);
      const checks = ex.expects.map((e: any) => {
        if (e.kind === 'eq') return { path: e.path, kind: 'eq', value: e.value };
        if (e.kind === 'approx') return { path: e.path, kind: 'approx', value: e.value, tol: e.tol };
        return { path: e.path, kind: 'eq', value: lookup(resp, e.path).value, from: 'oracle' };
      });
      const full: any = { members: Object.keys(resp).sort() };
      if (hasOwn(resp, 'error')) full.error = resp.error;
      if (hasOwn(resp, 'result')) full.result = resp.result;
      if (op && op.audit && typeof resp.audit === 'string') full.audit = resp.audit;
      full.tolerances = {};
      if (op) for (const [p, n] of op.tolerances) setOwn(full.tolerances, p, n);
      const c: any = { id: ex.id, kind: 'example', reqs: ['REQ-' + ex.req.id], platform: ex.req.platform, line: ex.sentLine, checks, full };
      if (ex.solo) c.solo = true;
      cases.push(c);
    }
  }
  return { diags, cases };
}
