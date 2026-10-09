// Checking a record: selection, T checks, running the oracle, and the suite.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRecord, isObj, setOwn } from './reader.ts';
import type { Diag, Example, Level, Model, OpS, ReqS } from './reader.ts';

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const dirOf = (f: string) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '');
const ORACLE_TIMEOUT_MS = 60000;

export interface Run {
  req: ReqS;
  ex: Example;
  id: string;
  line: string;
  solo: boolean;
  runnable: boolean;
  resp: Record<string, unknown> | null;
}

export interface Analysis {
  diags: Diag[];
  model?: Model;
  runs: Run[];
}

export function selectRecord(files: Record<string, string>, entry: string | undefined) {
  const e = entry === undefined ? '.' : entry;
  if (e !== '.' && hasOwn(files, e)) return { names: [e], folder: dirOf(e), recordName: e };
  const folder = e === '.' ? '' : e;
  const names = Object.keys(files).filter((n) => {
    let rel = n;
    if (folder !== '') {
      if (!n.startsWith(folder + '/')) return false;
      rel = n.slice(folder.length + 1);
    }
    if (!rel.endsWith('.duramen')) return false;
    const parts = rel.split('/');
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith('.')) return false;
      if (i < parts.length - 1 && (parts[i] === 'build' || parts[i] === 'node_modules')) return false;
    }
    return true;
  }).sort();
  return { names, folder, recordName: e };
}

const LEVEL_ORDER: Record<Level, number> = { error: 0, warning: 1, info: 2 };
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function sortDiags(d: Diag[]): Diag[] {
  return d.slice().sort((a, b) =>
    cmp(a.file, b.file) || a.line - b.line || cmp(a.code, b.code) || LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

// ---- obligations ----

const QUOTED = /"[^"]*"|“[^”]*”|`[^`]*`/g;
const OBL = /(?<![\p{L}\p{N}_])(?:MUST|SHALL|REQUIRED)(?![\p{L}\p{N}_])/u;
function hasObligation(lines: string[]): boolean {
  return lines.some((l) => OBL.test(l.replace(QUOTED, ' ')));
}

const ORDER_PHRASE = new RegExp(
  '(?<![\\p{L}\\p{N}_])(?:in\\s+this\\s+order|in\\s+the\\s+order|first\\s+that\\s+applies|first\\s+match|precede|precedes|preceded|before|after|take\\s+precedence|takes\\s+precedence)(?![\\p{L}\\p{N}_])',
  'iu');
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- paths and values ----

function getPath(resp: Record<string, unknown>, path: string): { found: boolean; value?: unknown } {
  let names = path.split('.');
  let cur: unknown = resp;
  if (names[0] === 'audit' && names.length > 1) {
    if (!hasOwn(resp, 'audit') || typeof resp.audit !== 'string') return { found: false };
    try { cur = JSON.parse(resp.audit); } catch { return { found: false }; }
    names = names.slice(1);
  }
  for (const nm of names) {
    if (Array.isArray(cur)) {
      if (!/^(?:0|[1-9]\d*)$/.test(nm)) return { found: false };
      const i = Number(nm);
      if (i >= cur.length) return { found: false };
      cur = cur[i];
    } else if (isObj(cur)) {
      if (!hasOwn(cur, nm)) return { found: false };
      cur = cur[nm];
    } else return { found: false };
  }
  return { found: true, value: cur };
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => hasOwn(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

// ---- request lines ----

function buildLine(model: Model, ex: Example, id: string): string {
  if (ex.kind === 'raw') return ex.rawLine!;
  const op = model.ops.find((o) => o.name === ex.op);
  const base = op && op.request !== undefined ? op.request : model.specs[0]?.request ?? {};
  const members: Record<string, unknown> = {};
  for (const k of Object.keys(base)) setOwn(members, k, base[k]);
  if (ex.request) for (const k of Object.keys(ex.request)) setOwn(members, k, ex.request[k]);
  const omit = new Set(ex.omit);
  const parts: string[] = [];
  if (!omit.has('id')) parts.push(`"id":${JSON.stringify(id)}`);
  if (!omit.has('op')) parts.push(`"op":${JSON.stringify(ex.op)}`);
  for (const k of Object.keys(members)) {
    if (!omit.has(k)) parts.push(`${JSON.stringify(k)}:${JSON.stringify(members[k])}`);
  }
  if (ex.inputText !== undefined && !omit.has('input')) parts.push(`"input":${ex.inputText}`);
  return `{${parts.join(',')}}`;
}

// ---- the oracle ----

export function splitCommand(s: string): string[] | null {
  const words: string[] = [];
  let cur = '', inWord = false, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') {
      if (inWord) { words.push(cur); cur = ''; inWord = false; }
      i++;
      continue;
    }
    inWord = true;
    if (c === '"') {
      i++;
      let closed = false;
      while (i < s.length) {
        if (s[i] === '\\' && s[i + 1] === '"') { cur += '"'; i += 2; continue; }
        if (s[i] === '"') { closed = true; i++; break; }
        cur += s[i++];
      }
      if (!closed) return null;
    } else if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) return null;
      cur += s.slice(i + 1, j);
      i = j + 1;
    } else { cur += c; i++; }
  }
  if (inWord) words.push(cur);
  return words;
}

interface Output { failed: boolean; lines: string[] }

function runProcess(cwd: string, words: string[], lines: string[]): Output {
  const cmd = words[0] === 'node' ? process.execPath : words[0];
  const r = spawnSync(cmd, words.slice(1), {
    cwd, input: lines.map((l) => l + '\n').join(''), encoding: 'utf8',
    timeout: ORACLE_TIMEOUT_MS, maxBuffer: 1 << 28,
  });
  const err = r.error as (Error & { code?: string }) | undefined;
  const failed = Boolean((err && err.code !== 'EPIPE') || r.signal || r.status !== 0);
  const out = typeof r.stdout === 'string' ? r.stdout : '';
  return { failed, lines: out.split('\n').filter((l) => l.trim() !== '') };
}

function parseObj(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line);
    return isObj(v) ? v : null;
  } catch { return null; }
}

// ---- the analysis ----

export function analyze(files: Record<string, string>, entry: string | undefined): Analysis {
  const sel = selectRecord(files, entry);
  if (sel.names.length === 0) {
    return { diags: [{ file: sel.recordName, line: 1, level: 'error', code: 'P046' }], runs: [] };
  }
  const { model, diags } = readRecord(files, sel.names, sel.folder, sel.recordName);
  if (diags.some((d) => d.level === 'error')) return { diags: sortDiags(diags), runs: [] };

  const out: Diag[] = [];
  const spec = model.specs[0];
  const add = (file: string, line: number, code: string, level: Level = 'error') => out.push({ file, line, level, code });

  // IDs
  const dupCheck = <T extends { file: string; line: number }>(items: T[], key: (t: T) => string) => {
    const seen = new Set<string>();
    for (const it of items) {
      const k = key(it);
      if (seen.has(k)) add(it.file, it.line, 'T007'); else seen.add(k);
    }
  };
  dupCheck(model.reqs, (r) => r.id);
  dupCheck(model.opens, (o) => o.id);
  dupCheck(model.decs, (d) => d.id);
  dupCheck(model.ops, (o) => o.name);

  const declared = new Map<string, typeof model.decs[number]>();
  for (const d of model.decs) if (!declared.has(d.id)) declared.set(d.id, d);
  const cited = new Set<string>();
  for (const r of model.reqs) {
    for (const id of new Set(r.decisions)) {
      cited.add(id);
      const d = declared.get(id);
      if (!d) { add(r.file, r.line, 'T008'); continue; }
      const word = d.status === undefined ? 'accepted' : d.status.split(/\s+/)[0];
      if (word === 'contested' || word === 'superseded' || word === 'rejected') add(r.file, r.line, 'T028');
      else if (word === 'observed' || word === 'inferred' || word === 'proposed') add(r.file, r.line, 'T028', 'warning');
    }
    if (r.items.length === 0) add(r.file, r.line, 'T001');
  }
  const STATUSES = ['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected'];
  for (const d of model.decs) {
    if (!cited.has(d.id)) add(d.file, d.line, 'T012', 'warning');
    if (d.source === undefined || d.source.trim() === '') add(d.file, d.line, 'T013', 'warning');
    if (d.status !== undefined) {
      const word = d.status.split(/\s+/)[0];
      let ok = STATUSES.includes(word);
      if (ok && word === 'superseded') {
        const m = d.status.match(/^superseded by (\S+)$/);
        ok = Boolean(m && declared.has(m[1]));
      }
      if (!ok) add(d.file, d.line, 'T027');
    }
  }
  for (const o of model.opens) for (const l of o.itemLines) add(o.file, l, 'T003');
  for (const b of model.obls) {
    if (hasObligation(b.lines)) add(b.file, b.line, b.level === 'error' ? 'T004' : 'T014', b.level);
  }

  // order stated once
  const codes = [...new Set(model.errorLists.flatMap((l) => l.codes.map((c) => c.code)))];
  for (const r of model.reqs) {
    if (!r.text) continue;
    const text = r.text.lines.join('\n');
    const named = codes.filter((c) => new RegExp(`(?<![\\p{L}\\p{N}_-])${escRe(c)}(?![\\p{L}\\p{N}_-])`, 'u').test(text));
    if (named.length >= 2 && ORDER_PHRASE.test(text)) add(r.file, r.text.line, 'T005');
  }

  // examples
  const runs: Run[] = [];
  const opByName = (n: string): OpS | undefined => model.ops.find((o) => o.name === n);
  for (const r of model.reqs) {
    r.items.forEach((ex, i) => {
      const id = `${r.id}#${i + 1}`;
      const hasErr = ex.expects.some((e) => e.path === 'error');
      const op = opByName(ex.op);
      const runnable = ex.kind === 'raw' || hasErr || op !== undefined;
      const solo = ex.kind === 'raw' || ex.omit.includes('id');
      runs.push({ req: r, ex, id, line: buildLine(model, ex, id), solo, runnable, resp: null });

      if (ex.kind !== 'raw' && !hasErr) {
        if (!op) add(r.file, ex.line, 'T009');
        else {
          let keys: string[] = [];
          if (ex.inputText !== undefined) {
            try { const v = JSON.parse(ex.inputText); if (isObj(v)) keys = Object.keys(v); } catch { /* none */ }
          }
          for (const f of op.fields) if (!f.optional && !keys.includes(f.name)) add(r.file, ex.line, 'T010');
          for (const k of keys) if (!op.fields.some((f) => f.name === k)) add(r.file, ex.line, 'T011', 'warning');
        }
      }
      for (const e of ex.expects) {
        if (e.path === 'error' && e.kind === 'eq' && !(typeof e.value === 'string' && codes.includes(e.value))) {
          add(r.file, e.line, 'T023');
        }
      }
    });
  }

  // run the oracle
  const oracle = model.oracles[0];
  if (runs.length > 0 && !oracle) add(spec.file, spec.line, 'T019');
  else if (oracle) runOracle(files, oracle, runs, add);

  // judge
  if (oracle) {
    for (const run of runs) {
      if (!run.runnable) continue;
      const { ex, req } = run;
      const resp = run.resp;
      if (!resp) { add(req.file, ex.line, 'T021'); continue; }
      if (hasOwn(resp, 'oracle_error')) { add(req.file, ex.line, 'T022'); continue; }
      for (const e of ex.expects) {
        const got = getPath(resp, e.path);
        if (e.kind === 'oracle') { if (!got.found) add(req.file, e.line, 'T025'); }
        else if (e.kind === 'eq') { if (!got.found || !deepEqual(got.value, e.value)) add(req.file, e.line, 'T002'); }
        else if (!got.found || typeof got.value !== 'number' || !(Math.abs(got.value - (e.value as number)) <= (e.tol as number))) {
          add(req.file, e.line, 'T002');
        }
      }
      if (ex.expects.length === 0 && hasOwn(resp, 'error')) add(req.file, ex.line, 'T024', 'warning');
    }
  }
  return { diags: sortDiags([...diags, ...out]), model, runs };
}

function runOracle(
  files: Record<string, string>,
  oracle: { file: string; line: number; command: string },
  runs: Run[],
  add: (file: string, line: number, code: string, level?: Level) => void,
) {
  const batch = runs.filter((r) => r.runnable && !r.solo);
  const solos = runs.filter((r) => r.runnable && r.solo);
  if (batch.length + solos.length === 0) return;
  const words = splitCommand(oracle.command);
  if (!words || words.length === 0) {
    if (batch.length > 0) add(oracle.file, oracle.line, 'T020');
    for (const s of solos) add(s.req.file, s.ex.line, 'T020');
    return;
  }
  const root = mkdtempSync(join(tmpdir(), 'duramen-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      try {
        const p = join(root, name);
        mkdirSync(join(root, dirOf(name)), { recursive: true });
        writeFileSync(p, text);
      } catch { /* a name the file system cannot hold */ }
    }
    const cwd = join(root, dirOf(oracle.file));
    if (batch.length > 0) {
      const o = runProcess(cwd, words, batch.map((r) => r.line));
      if (o.failed) add(oracle.file, oracle.line, 'T020');
      const byId = new Map<string, Record<string, unknown>>();
      for (const l of o.lines) {
        const v = parseObj(l);
        if (v && typeof v.id === 'string' && !byId.has(v.id)) byId.set(v.id, v);
      }
      for (const r of batch) r.resp = byId.get(r.id) ?? null;
    }
    for (const s of solos) {
      const o = runProcess(cwd, words, [s.line]);
      if (o.failed) add(s.req.file, s.ex.line, 'T020');
      s.resp = o.lines.length === 1 ? parseObj(o.lines[0]) : null;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function fmt(d: Diag): string {
  return `${d.file}:${d.line}: ${d.level} ${d.code}`;
}

export function check(files: Record<string, string>, entry?: string) {
  const a = analyze(files, entry);
  return {
    diagnostics: a.diags.map(fmt),
    errors: a.diags.filter((d) => d.level === 'error').length,
    warnings: a.diags.filter((d) => d.level === 'warning').length,
  };
}

export function cases(files: Record<string, string>, entry?: string) {
  const a = analyze(files, entry);
  const errors = a.diags.filter((d) => d.level === 'error').length;
  if (errors !== 0 || !a.model) return { errors, cases: [] as unknown[] };
  const out: unknown[] = [];
  for (const run of a.runs) {
    const resp = run.resp!;
    const op = a.model.ops.find((o) => o.name === run.ex.op);
    const checks = run.ex.expects.map((e) => {
      if (e.kind === 'eq') return { path: e.path, kind: 'eq', value: e.value };
      if (e.kind === 'approx') return { path: e.path, kind: 'approx', value: e.value, tol: e.tol };
      return { path: e.path, kind: 'eq', value: getPath(resp, e.path).value, from: 'oracle' };
    });
    const full: Record<string, unknown> = { members: Object.keys(resp).sort(), tolerances: {} };
    if (hasOwn(resp, 'error')) full.error = resp.error;
    if (hasOwn(resp, 'result')) full.result = resp.result;
    if (op && op.audit && hasOwn(resp, 'audit')) full.audit = resp.audit;
    if (op) full.tolerances = { ...op.tolerances };
    const c: Record<string, unknown> = {
      id: run.id, kind: 'example', reqs: [`REQ-${run.req.id}`], platform: run.req.platform,
      line: run.line, checks, full,
    };
    if (run.solo) c.solo = true;
    out.push(c);
  }
  return { errors, cases: out };
}
