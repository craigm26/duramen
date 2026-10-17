// Checking a record (REQ-CK-*, REQ-OR-*) and building its suite (REQ-SU-*).

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRecord } from './reader.ts';
import type { Diag, Example, Model, OpDecl, Req } from './reader.ts';
import { cmp, deepEqual, dirname, getPath, hasOwn, isObj, parseJson, setOwn } from './util.ts';

const ORACLE_TIMEOUT_MS = 30000;

export interface Outcome {
  diagnostics: Diag[];
  errors: number;
  warnings: number;
  cases: any[] | null;
}

interface Run { id: string; ex: Example; req: Req; n: number; solo: boolean; line: string; op: OpDecl | undefined }

const LEVELS = ['error', 'warning', 'info'];

function sortDiags(ds: Diag[]): Diag[] {
  return ds
    .map((x, i) => ({ x, i }))
    .sort(
      (a, b) =>
        cmp(a.x.file, b.x.file) ||
        a.x.line - b.x.line ||
        cmp(a.x.code, b.x.code) ||
        LEVELS.indexOf(a.x.level) - LEVELS.indexOf(b.x.level) ||
        a.i - b.i,
    )
    .map((o) => o.x);
}

function obligation(text: string): boolean {
  for (const line of text.split(/\r\n|\n|\r/)) {
    let out = '';
    for (let i = 0; i < line.length; ) {
      const ch = line[i];
      const close = ch === '"' ? '"' : ch === '“' ? '”' : ch === '`' ? '`' : null;
      const j = close === null ? -1 : line.indexOf(close, i + 1);
      if (j < 0) {
        out += ch;
        i++;
      } else {
        out += ' ';
        i = j + 1;
      }
    }
    if (/(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])/.test(out)) return true;
  }
  return false;
}

const ORDER_PHRASES = [
  'in this order', 'in the order', 'first that applies', 'first match', 'precede', 'precedes', 'preceded',
  'before', 'after', 'take precedence', 'takes precedence',
];

function mentionsOrder(text: string): string[] | null {
  const ok = ORDER_PHRASES.some((p) => {
    const re = new RegExp('(?<![A-Za-z0-9_])' + p.split(' ').join('\\s+') + '(?![A-Za-z0-9_])', 'i');
    return re.test(text);
  });
  return ok ? [] : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function splitCommand(s: string): string[] | null {
  const words: string[] = [];
  let cur = '';
  let inWord = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') {
      if (inWord) words.push(cur);
      cur = '';
      inWord = false;
      i++;
      continue;
    }
    inWord = true;
    if (c === '"') {
      i++;
      for (;;) {
        if (i >= s.length) return null;
        if (s[i] === '\\' && s[i + 1] === '"') {
          cur += '"';
          i += 2;
        } else if (s[i] === '"') {
          i++;
          break;
        } else cur += s[i++];
      }
    } else if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) return null;
      cur += s.slice(i + 1, j);
      i = j + 1;
    } else {
      cur += c;
      i++;
    }
  }
  if (inWord) words.push(cur);
  return words;
}

interface RunResult { responses: any[]; failed: boolean }

async function runOracle(cmd: string, cwd: string, lines: string[]): Promise<RunResult> {
  const words = splitCommand(cmd);
  if (!words || words.length === 0) return { responses: [], failed: true };
  const prog = words[0] === 'node' ? process.execPath : words[0];
  return new Promise((resolve) => {
    let out = '';
    let failed = false;
    let done = false;
    let proc: ReturnType<typeof spawn>;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ responses: out.split('\n'), failed });
    };
    const timer = setTimeout(() => {
      failed = true;
      proc?.kill('SIGKILL');
      finish();
    }, ORACLE_TIMEOUT_MS);
    try {
      proc = spawn(prog, words.slice(1), { cwd, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      failed = true;
      finish();
      return;
    }
    proc.on('error', () => {
      failed = true;
      finish();
    });
    proc.stdout!.setEncoding('utf8');
    proc.stdout!.on('data', (s: string) => {
      out += s;
    });
    proc.stdin!.on('error', () => {});
    proc.on('close', (code, signal) => {
      if (code !== 0 || signal) failed = true;
      finish();
    });
    proc.stdin!.end(lines.map((l) => l.toWellFormed() + '\n').join(''), 'utf8');
  });
}

// The objects an oracle's output lines hold (REQ-OR-002).
function parseResponses(rawLines: string[]): any[] {
  const out: any[] = [];
  for (const l of rawLines) {
    if (l.trim() === '') continue;
    const p = parseJson(l);
    out.push(p.ok && !p.big && isObj(p.value) ? p.value : null);
  }
  return out;
}

export function buildLine(ex: Example, id: string, spec: Model['spec'], op: OpDecl | undefined): string {
  if (ex.raw !== null) return ex.raw;
  const members: Record<string, any> = {};
  const base = op && op.request ? op.request : spec?.request ?? {};
  for (const k of Object.keys(base)) setOwn(members, k, base[k]);
  if (ex.request) for (const k of Object.keys(ex.request)) setOwn(members, k, ex.request[k]);
  const omit = new Set(ex.omit);
  const parts: string[] = [];
  if (!omit.has('id')) parts.push('"id":' + JSON.stringify(id));
  if (!omit.has('op')) parts.push('"op":' + JSON.stringify(ex.op));
  for (const k of Object.keys(members)) if (!omit.has(k)) parts.push(JSON.stringify(k) + ':' + JSON.stringify(members[k]));
  if (!omit.has('input')) {
    if (ex.table || (ex.inputText !== null && !ex.inputLines)) parts.push('"input":' + ex.inputText);
    else if (ex.inputLines) parts.push('"input":' + JSON.stringify(ex.inputObj));
  }
  return '{' + parts.join(',') + '}';
}

function isSolo(ex: Example): boolean {
  return ex.raw !== null || ex.omit.includes('id');
}

function expectsError(ex: Example): boolean {
  return ex.expects.some((e) => e.path === 'error');
}

export async function analyze(files: Record<string, string>, entry: string | undefined): Promise<Outcome> {
  const rr = readRecord(files, entry);
  const finish = (ds: Diag[], cases: any[] | null): Outcome => {
    const diagnostics = sortDiags(ds);
    return {
      diagnostics,
      errors: diagnostics.filter((x) => x.level === 'error').length,
      warnings: diagnostics.filter((x) => x.level === 'warning').length,
      cases,
    };
  };
  if (rr.hasError) return finish(rr.diags, null);
  const m = rr.model;
  const ds: Diag[] = [...rr.diags];
  const add = (file: string, line: number, code: string, level: 'error' | 'warning' = 'error') =>
    ds.push({ file, line, level, code });

  // REQ-CK-001
  for (const r of m.reqs) if (r.cases.length === 0) add(r.file, r.line, 'T001');

  // REQ-CK-002
  const firstOp = new Map<string, OpDecl>();
  const seenReq = new Set<string>();
  for (const r of m.reqs) {
    if (seenReq.has(r.id)) add(r.file, r.line, 'T007');
    seenReq.add(r.id);
  }
  const seenOpen = new Set<string>();
  for (const o of m.opens) {
    if (seenOpen.has(o.id)) add(o.file, o.line, 'T007');
    seenOpen.add(o.id);
  }
  const seenDec = new Set<string>();
  for (const x of m.decisions) {
    if (seenDec.has(x.id)) add(x.file, x.line, 'T007');
    seenDec.add(x.id);
  }
  for (const o of m.ops) {
    if (firstOp.has(o.name)) add(o.file, o.line, 'T007');
    else firstOp.set(o.name, o);
  }

  // REQ-CK-003, REQ-CK-009
  const firstDec = new Map<string, (typeof m.decisions)[number]>();
  for (const x of m.decisions) if (!firstDec.has(x.id)) firstDec.set(x.id, x);
  const cited = new Set<string>();
  const WORDS = ['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected'];
  for (const r of m.reqs) {
    for (const id of r.decisions) {
      cited.add(id);
      const dec = firstDec.get(id);
      if (!dec) {
        add(r.file, r.line, 'T008');
        continue;
      }
      const w = dec.status === null ? 'accepted' : dec.status.split(/\s+/)[0];
      if (w === 'contested' || w === 'superseded' || w === 'rejected') add(r.file, r.line, 'T028');
      else if (w === 'observed' || w === 'inferred' || w === 'proposed') add(r.file, r.line, 'T028', 'warning');
    }
  }
  for (const x of m.decisions) {
    if (!cited.has(x.id)) add(x.file, x.line, 'T012', 'warning');
    if (x.source === '') add(x.file, x.line, 'T013', 'warning');
    if (x.status !== null) {
      const w = x.status.split(/\s+/)[0];
      let good = WORDS.includes(w);
      if (good && w === 'superseded') {
        const sm = /^superseded by (\S+)$/.exec(x.status);
        good = !!sm && firstDec.has(sm[1]);
      }
      if (!good) add(x.file, x.line, 'T027');
    }
  }

  // REQ-CK-006
  for (const o of m.obl) if (obligation(o.text)) add(o.file, o.line, o.code, o.code === 'T004' ? 'error' : 'warning');

  // REQ-CK-007
  for (const o of m.opens) for (const c of o.badClauses) add(o.file, c.line, 'T003');

  // REQ-CK-008
  for (const r of m.reqs) {
    if (r.text === null) continue;
    const named = new Set(
      m.codes.filter((c) =>
        new RegExp('(?<![A-Za-z0-9_-])' + escapeRe(c) + '(?![A-Za-z0-9_-])').test(r.text!),
      ),
    );
    if (named.size >= 2 && mentionsOrder(r.text) !== null) add(r.file, r.textLine, 'T005');
  }

  // Examples: REQ-CK-004, REQ-CK-005, REQ-CK-009 and the runs.
  const runs: Run[] = [];
  let total = 0;
  for (const r of m.reqs) {
    r.cases.forEach((ex, k) => {
      total++;
      const id = `${r.id}#${k + 1}`;
      const op = ex.op === null ? undefined : firstOp.get(ex.op);
      const errExp = expectsError(ex);
      if (ex.raw === null && !errExp) {
        if (!op) add(ex.file, ex.line, 'T009');
        else {
          let input: Record<string, any> = {};
          if (ex.inputLines) input = ex.inputObj!;
          else if (ex.inputText !== null) input = JSON.parse(ex.inputText);
          for (const [f, optional] of op.fields) if (!optional && !hasOwn(input, f)) add(ex.file, ex.line, 'T010');
          for (const key of Object.keys(input)) if (!op.fields.has(key)) add(ex.file, ex.line, 'T011', 'warning');
        }
      }
      for (const e of ex.expects) {
        if (e.path === 'error' && e.kind !== 'oracle') {
          if (e.kind === 'approx' || typeof e.value !== 'string' || !m.codes.includes(e.value)) add(ex.file, e.line, 'T023');
        }
      }
      if (ex.raw !== null || errExp || op) {
        runs.push({ id, ex, req: r, n: k + 1, solo: isSolo(ex), line: buildLine(ex, id, m.spec, op), op });
      }
    });
  }

  // REQ-OR-001..008
  const responses = new Map<Run, any>();
  if (total > 0 && !m.oracle) {
    add(m.spec!.file, m.spec!.line, 'T019');
  } else if (m.oracle && runs.length > 0) {
    const orc = m.oracle;
    const tmp = mkdtempSync(join(tmpdir(), 'duramen-'));
    try {
      for (const name of Object.keys(files)) {
        try {
          mkdirSync(join(tmp, dirname(name)), { recursive: true });
          writeFileSync(join(tmp, name), files[name], 'utf8');
        } catch {
          // a name this file system cannot hold (OPEN-RQ-003)
        }
      }
      mkdirSync(join(tmp, dirname(orc.file)), { recursive: true });
      const cwd = join(tmp, dirname(orc.file));
      const batch = runs.filter((x) => !x.solo);
      if (batch.length > 0) {
        const res = await runOracle(orc.cmd, cwd, batch.map((x) => x.line));
        if (res.failed) add(orc.file, orc.line, 'T020');
        const byId = new Map<string, any>();
        for (const o of parseResponses(res.responses)) {
          if (o && typeof o.id === 'string' && !byId.has(o.id)) byId.set(o.id, o);
        }
        for (const x of batch) if (byId.has(x.id)) responses.set(x, byId.get(x.id));
      }
      for (const x of runs.filter((y) => y.solo)) {
        const res = await runOracle(orc.cmd, cwd, [x.line]);
        if (res.failed) add(x.ex.file, x.ex.line, 'T020');
        const all = parseResponses(res.responses);
        if (all.length === 1 && all[0]) responses.set(x, all[0]);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    for (const x of runs) {
      const resp = responses.get(x);
      const ex = x.ex;
      if (!resp) {
        add(ex.file, ex.line, 'T021');
        continue;
      }
      if (hasOwn(resp, 'oracle_error')) {
        add(ex.file, ex.line, 'T022');
        continue;
      }
      for (const e of ex.expects) {
        const got = getPath(resp, e.path);
        if (e.kind === 'oracle') {
          if (!got.found) add(ex.file, e.line, 'T025');
        } else if (e.kind === 'eq') {
          if (!got.found || !deepEqual(got.value, e.value)) add(ex.file, e.line, 'T002');
        } else if (!got.found || typeof got.value !== 'number' || Math.abs(got.value - e.value) > e.tol!) {
          add(ex.file, e.line, 'T002');
        }
      }
      if (ex.expects.length === 0 && hasOwn(resp, 'error')) add(ex.file, ex.line, 'T024', 'warning');
    }
  }

  const out = finish(ds, null);
  if (out.errors > 0) return out;

  // REQ-SU-002..005
  const cases: any[] = [];
  for (const r of m.reqs) {
    r.cases.forEach((ex, k) => {
      const x = runs.find((y) => y.ex === ex)!;
      const resp = responses.get(x);
      const checks = ex.expects.map((e) => {
        if (e.kind === 'eq') return { path: e.path, kind: 'eq', value: e.value };
        if (e.kind === 'approx') return { path: e.path, kind: 'approx', value: e.value, tol: e.tol };
        return { path: e.path, kind: 'eq', value: getPath(resp, e.path).value, from: 'oracle' };
      });
      const full: Record<string, any> = { members: Object.keys(resp).sort(cmp) };
      if (hasOwn(resp, 'error')) full.error = resp.error;
      if (hasOwn(resp, 'result')) full.result = resp.result;
      const op = ex.raw === null ? x.op : undefined;
      if (op && op.audit && typeof resp.audit === 'string') full.audit = resp.audit;
      const tolerances: Record<string, number> = {};
      if (op) for (const key of Object.keys(op.tolerances)) setOwn(tolerances, key, op.tolerances[key]);
      full.tolerances = tolerances;
      const c: Record<string, any> = {
        id: x.id, kind: 'example', reqs: ['REQ-' + r.id], platform: r.platform, line: x.line, checks, full,
      };
      if (x.solo) c.solo = true;
      cases.push(c);
    });
  }
  out.cases = cases;
  return out;
}
