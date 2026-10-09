import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { compareUnits, deepEqual, isObj, resolvePath, tryParse } from './util.ts';
import { newRec, readFile } from './reader.ts';
import type { Diag, Example, Expect, Level, Op, Rec, Req } from './reader.ts';

export interface Analysis {
  diagnostics: string[];
  errors: number;
  warnings: number;
  cases: Record<string, unknown>[];
}

const ORACLE_TIMEOUT_MS = 30000;
const LEVEL_RANK: Record<Level, number> = { error: 0, warning: 1, info: 2 };

function sortDiags(ds: Diag[]): Diag[] {
  return ds.slice().sort(
    (a, b) =>
      compareUnits(a.file, b.file) ||
      a.line - b.line ||
      compareUnits(a.code, b.code) ||
      LEVEL_RANK[a.level] - LEVEL_RANK[b.level],
  );
}

function finish(ds: Diag[], cases: Record<string, unknown>[] = []): Analysis {
  const sorted = sortDiags(ds);
  return {
    diagnostics: sorted.map((d) => `${d.file}:${d.line}: ${d.level} ${d.code}`),
    errors: sorted.filter((d) => d.level === 'error').length,
    warnings: sorted.filter((d) => d.level === 'warning').length,
    cases,
  };
}

function selectFiles(files: Record<string, string>, entry: string | undefined): { names: string[]; label: string } | { missing: string } {
  const names = Object.keys(files);
  if (entry === undefined || entry === '.') {
    const sel = folderFiles(names, '');
    return sel.length ? { names: sel, label: '.' } : { missing: '.' };
  }
  if (Object.hasOwn(files, entry)) return { names: [entry], label: entry };
  const sel = folderFiles(names, entry + '/');
  return sel.length ? { names: sel, label: entry } : { missing: entry };
}

function folderFiles(names: string[], prefix: string): string[] {
  const out: { name: string; rel: string }[] = [];
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const rel = name.slice(prefix.length);
    const parts = rel.split('/');
    if (!rel.endsWith('.duramen')) continue;
    if (parts.some((p) => p.startsWith('.'))) continue;
    if (parts.slice(0, -1).some((p) => p === 'build' || p === 'node_modules')) continue;
    out.push({ name, rel });
  }
  out.sort((a, b) => compareUnits(a.rel, b.rel));
  return out.map((o) => o.name);
}

const QUOTES = /"[^"]*"|“[^”]*”|`[^`]*`/g;
function hasObligation(text: string): boolean {
  return text.split('\n').some((l) => /\b(?:MUST|SHALL|REQUIRED)\b/.test(l.replace(QUOTES, '')));
}

const ORDER_PHRASES = [
  'in this order',
  'in the order',
  'first that applies',
  'first match',
  'precede',
  'precedes',
  'preceded',
  'before',
  'after',
  'take precedence',
  'takes precedence',
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenize(cmd: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = cmd.length;
  while (i < n) {
    while (i < n && (cmd[i] === ' ' || cmd[i] === '\t')) i++;
    if (i >= n) break;
    let word = '';
    while (i < n && cmd[i] !== ' ' && cmd[i] !== '\t') {
      const ch = cmd[i];
      if (ch === '"') {
        i++;
        while (i < n && cmd[i] !== '"') {
          if (cmd[i] === '\\' && cmd[i + 1] === '"') {
            word += '"';
            i += 2;
          } else word += cmd[i++];
        }
        i++;
      } else if (ch === "'") {
        i++;
        while (i < n && cmd[i] !== "'") word += cmd[i++];
        i++;
      } else {
        word += ch;
        i++;
      }
    }
    out.push(word);
  }
  return out;
}

interface RunResult {
  lines: string[];
  failed: boolean;
}

function runOracle(command: string, cwd: string, input: string[]): RunResult {
  const words = tokenize(command);
  if (words.length === 0) return { lines: [], failed: true };
  const prog = words[0] === 'node' ? process.execPath : words[0];
  const r = spawnSync(prog, words.slice(1), {
    cwd,
    input: input.join('\n') + '\n',
    encoding: 'utf8',
    timeout: ORACLE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 1 << 28,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const err = r.error as (Error & { code?: string }) | undefined;
  const failed = (err !== undefined && err.code !== 'EPIPE') || r.signal !== null || r.status !== 0;
  const out = typeof r.stdout === 'string' ? r.stdout : '';
  return { lines: out.split('\n').filter((l) => l.trim() !== ''), failed };
}

interface Item {
  req: Req;
  ex: Example;
  id: string;
  line: string;
  solo: boolean;
  runnable: boolean;
}

function buildLine(ex: Example, id: string, rec: Rec, op: Op | undefined): string {
  if (ex.raw !== null) return ex.raw;
  const m = new Map<string, string>();
  m.set('id', JSON.stringify(id));
  m.set('op', JSON.stringify(ex.op));
  const base = op?.request ?? rec.spec?.request ?? new Map<string, unknown>();
  for (const [k, v] of base) m.set(k, JSON.stringify(v));
  for (const [k, v] of ex.request) m.set(k, JSON.stringify(v));
  let input: string | null = null;
  if (ex.hasInputLines) input = JSON.stringify(ex.inputObj ?? {});
  else if (ex.inputText !== null) input = ex.inputText;
  if (input !== null) m.set('input', input);
  for (const k of ex.omit) m.delete(k);
  return '{' + [...m].map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(',') + '}';
}

function expectsError(ex: Example): boolean {
  return ex.expects.some((e) => e.path[0] === 'error');
}

export function analyze(files: Record<string, string>, entry: string | undefined): Analysis {
  const sel = selectFiles(files, entry);
  if ('missing' in sel) return finish([{ file: sel.missing, line: 1, level: 'error', code: 'P046' }]);

  const rec = newRec();
  for (const name of sel.names) readFile(name, files[name], rec, files);
  if (!rec.hasSpecStatement) rec.diags.push({ file: sel.label, line: 1, level: 'error', code: 'P021' });
  if (new Set(rec.versions).size > 1) rec.diags.push({ file: sel.label, line: 1, level: 'error', code: 'P047' });
  if (rec.diags.some((d) => d.level === 'error')) return finish(rec.diags);

  const ds: Diag[] = [];
  const add = (file: string, line: number, level: Level, code: string): void => {
    ds.push({ file, line, level, code });
  };
  const err = (file: string, line: number, code: string): void => add(file, line, 'error', code);

  // ---- T001, T007, T008, T012, T013, T027, T028
  const reqIds = new Set<string>();
  const openIds = new Set<string>();
  const decIds = new Set<string>();
  const decById = new Map<string, Rec['decisions'][number]>();
  for (const d of rec.decisions) {
    if (decIds.has(d.id)) err(d.file, d.line, 'T007');
    else {
      decIds.add(d.id);
      decById.set(d.id, d);
    }
  }
  const cited = new Set<string>();
  for (const r of rec.reqs) {
    if (reqIds.has(r.id)) err(r.file, r.line, 'T007');
    reqIds.add(r.id);
    if (r.examples.length === 0) err(r.file, r.line, 'T001');
    for (const dId of r.decisions) {
      cited.add(dId);
      const d = decById.get(dId);
      if (!d) {
        err(r.file, r.line, 'T008');
        continue;
      }
      const w = d.status === null ? 'accepted' : d.status.split(/\s+/)[0];
      if (w === 'contested' || w === 'superseded' || w === 'rejected') err(r.file, r.line, 'T028');
      else if (w === 'observed' || w === 'inferred' || w === 'proposed') add(r.file, r.line, 'warning', 'T028');
    }
  }
  for (const o of rec.opens) {
    if (openIds.has(o.id)) err(o.file, o.line, 'T007');
    openIds.add(o.id);
    for (const l of o.exampleLines) err(o.file, l, 'T003');
  }
  const STATUS = ['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected'];
  for (const d of rec.decisions) {
    if (!cited.has(d.id)) add(d.file, d.line, 'warning', 'T012');
    if (d.source === null || d.source === '') add(d.file, d.line, 'warning', 'T013');
    if (d.status !== null) {
      const w = d.status.split(/\s+/)[0];
      let bad = !STATUS.includes(w);
      if (!bad && w === 'superseded') {
        const m = /^superseded by (\S+)$/.exec(d.status);
        if (!m || !decById.has(m[1])) bad = true;
      }
      if (bad) err(d.file, d.line, 'T027');
    }
  }

  // ---- T004 / T014
  const ob = (file: string, line: number, text: string): void => {
    if (hasObligation(text)) err(file, line, 'T004');
  };
  if (rec.spec) for (const t of rec.spec.texts) ob(rec.spec.file, t.line, t.text);
  // texts of sections and notes carry the file of their statement
  for (const t of [...rec.sectionTexts, ...rec.noteTexts]) ob(t.file ?? '', t.line, t.text);
  for (const d of rec.decisions) {
    for (const t of d.texts) ob(d.file, d.line, t.text);
    for (const r of d.rejected) ob(d.file, d.line, r);
  }
  for (const op of rec.ops.values()) if (op.result !== null) ob(op.file, op.line, op.result);
  if (rec.errors) for (const it of rec.errors.items) ob(rec.errors.file, it.line, it.cond);
  for (const o of rec.opens) for (const t of o.texts) if (hasObligation(t.text)) add(o.file, o.line, 'warning', 'T014');

  // ---- T005
  if (rec.errors) {
    const codes = [...new Set(rec.errors.items.map((i) => i.code))];
    for (const r of rec.reqs) {
      for (const t of r.texts) {
        const found = codes.filter((c) =>
          new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(c)}(?![A-Za-z0-9_-])`).test(t.text),
        );
        if (found.length < 2) continue;
        const phrase = ORDER_PHRASES.some((p) => new RegExp(`\\b${escapeRe(p)}\\b`, 'i').test(t.text));
        if (phrase) err(r.file, t.line, 'T005');
      }
    }
  }

  // ---- examples: T009 T010 T011 T023
  const declared = new Set(rec.errors?.items.map((i) => i.code) ?? []);
  const items: Item[] = [];
  for (const r of rec.reqs) {
    r.examples.forEach((ex, k) => {
      const id = `${r.id}#${k + 1}`;
      const op = ex.op === null ? undefined : rec.ops.get(ex.op);
      const expErr = expectsError(ex);
      if (ex.raw === null && !expErr) {
        if (!op) err(ex.file, ex.line, 'T009');
        else {
          const have = new Set(ex.fields);
          for (const f of op.fields) if (!f.optional && !have.has(f.name)) err(ex.file, ex.line, 'T010');
          const known = new Set(op.fields.map((f) => f.name));
          for (const f of ex.fields) if (!known.has(f)) add(ex.file, ex.line, 'warning', 'T011');
        }
      }
      for (const e of ex.expects) {
        if (e.path.length === 1 && e.path[0] === 'error' && e.kind !== 'oracle') {
          if (typeof e.value !== 'string' || !declared.has(e.value)) err(ex.file, e.line, 'T023');
        }
      }
      const line = buildLine(ex, id, rec, op);
      const solo = ex.raw !== null || ex.omit.includes('id');
      items.push({ req: r, ex, id, line, solo, runnable: ex.raw !== null || expErr || op !== undefined });
    });
  }

  // ---- oracle
  const responses = new Map<Item, Record<string, unknown> | null>();
  if (items.length > 0 && !rec.oracle) {
    err(rec.spec!.file, rec.spec!.line, 'T019');
  } else if (items.length > 0 && rec.oracle) {
    const orc = rec.oracle;
    const tmp = mkdtempSync(join(tmpdir(), 'duramen-'));
    try {
      for (const [n, text] of Object.entries(files)) {
        const p = join(tmp, n);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, text);
      }
      const cwd = join(tmp, dirname(orc.file) === '.' ? '' : dirname(orc.file));
      const runnable = items.filter((i) => i.runnable);
      const shared = runnable.filter((i) => !i.solo);
      if (shared.length > 0) {
        const res = runOracle(orc.command, cwd, shared.map((i) => i.line));
        if (res.failed) err(orc.file, orc.line, 'T020');
        const byId = new Map<string, Record<string, unknown>>();
        for (const l of res.lines) {
          const r = tryParse(l);
          if (r.ok && isObj(r.value) && typeof r.value.id === 'string' && !byId.has(r.value.id)) byId.set(r.value.id, r.value);
        }
        for (const i of shared) responses.set(i, byId.get(i.id) ?? null);
      }
      for (const i of runnable.filter((x) => x.solo)) {
        const res = runOracle(orc.command, cwd, [i.line]);
        if (res.failed) err(i.ex.file, i.ex.line, 'T020');
        let resp: Record<string, unknown> | null = null;
        if (res.lines.length === 1) {
          const r = tryParse(res.lines[0]);
          if (r.ok && isObj(r.value)) resp = r.value;
        }
        responses.set(i, resp);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    for (const i of items) {
      if (!i.runnable) continue;
      const resp = responses.get(i) ?? null;
      const ex = i.ex;
      if (resp === null) {
        err(ex.file, ex.line, 'T021');
        continue;
      }
      if (Object.hasOwn(resp, 'oracle_error')) {
        err(ex.file, ex.line, 'T022');
        continue;
      }
      if (ex.expects.length === 0 && Object.hasOwn(resp, 'error')) add(ex.file, ex.line, 'warning', 'T024');
      for (const e of ex.expects) {
        const got = resolvePath(resp, e.path);
        if (e.kind === 'oracle') {
          if (!got.found) err(ex.file, e.line, 'T025');
        } else if (e.kind === 'eq') {
          if (!got.found || !deepEqual(got.value, e.value)) err(ex.file, e.line, 'T002');
        } else {
          const v = got.value;
          if (!got.found || typeof v !== 'number' || !(Math.abs(v - (e.value as number)) <= (e.tol as number))) {
            err(ex.file, e.line, 'T002');
          }
        }
      }
    }
  }

  const a = finish(ds.concat(rec.diags));
  if (a.errors > 0) return a;

  // ---- cases
  const cases: Record<string, unknown>[] = [];
  for (const i of items) {
    const resp = responses.get(i) as Record<string, unknown>;
    const op = i.ex.op === null ? undefined : rec.ops.get(i.ex.op);
    const checks = i.ex.expects.map((e: Expect) => checkOf(e, resp));
    const full: Record<string, unknown> = { members: Object.keys(resp).sort(compareUnits) };
    if (Object.hasOwn(resp, 'error')) full.error = resp.error;
    if (Object.hasOwn(resp, 'result')) full.result = resp.result;
    if (op?.audit && Object.hasOwn(resp, 'audit')) full.audit = resp.audit;
    const tol: Record<string, number> = {};
    if (op) for (const [k, v] of op.tolerances) tol[k] = v;
    full.tolerances = tol;
    const c: Record<string, unknown> = {
      id: i.id,
      kind: 'example',
      reqs: [`REQ-${i.req.id}`],
      platform: i.req.platform,
      line: i.line,
    };
    if (i.solo) c.solo = true;
    c.checks = checks;
    c.full = full;
    cases.push(c);
  }
  a.cases = cases;
  return a;
}

function checkOf(e: Expect, resp: Record<string, unknown>): Record<string, unknown> {
  const path = e.path.join('.');
  if (e.kind === 'eq') return { path, kind: 'eq', value: e.value };
  if (e.kind === 'approx') return { path, kind: 'approx', value: e.value, tol: e.tol };
  return { path, kind: 'eq', value: resolvePath(resp, e.path).value, from: 'oracle' };
}
