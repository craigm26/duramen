// Checking a record that was read without errors: T diagnostics, the oracle, the suite.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirOf, readRecord } from './reader.ts';
import type { Diag, Example, Model } from './reader.ts';
import { has, hasHuge, isObject, jsonEqual, parseJson, readResponsePath, setMember } from './util.ts';

const LEVEL_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

export function sortDiags(diags: Diag[]): Diag[] {
  return diags.slice().sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
  });
}

export function formatDiag(d: Diag): string {
  return `${d.file}:${d.line}: ${d.level} ${d.code}`;
}

const OBLIGATION = /(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])/;

function stripQuotations(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    const close = c === '"' ? '"' : c === '“' ? '”' : c === '`' ? '`' : null;
    if (close) {
      const j = line.indexOf(close, i + 1);
      if (j >= 0) {
        out += ' ';
        i = j + 1;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

function holdsObligation(lines: string[]): boolean {
  return lines.some((l) => OBLIGATION.test(stripQuotations(l)));
}

const PHRASES = new RegExp(
  '(?<![A-Za-z0-9_])(?:' +
    ['in\\s+this\\s+order', 'in\\s+the\\s+order', 'first\\s+that\\s+applies', 'first\\s+match', 'precede', 'precedes',
      'preceded', 'before', 'after', 'take\\s+precedence', 'takes\\s+precedence'].join('|') +
    ')(?![A-Za-z0-9_])', 'i');

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function splitCommand(cmd: string): string[] | null {
  const words: string[] = [];
  let cur = '';
  let inWord = false;
  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i];
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
      let closed = false;
      while (i < cmd.length) {
        if (cmd[i] === '\\' && cmd[i + 1] === '"') {
          cur += '"';
          i += 2;
        } else if (cmd[i] === '"') {
          closed = true;
          i++;
          break;
        } else cur += cmd[i++];
      }
      if (!closed) return null;
    } else if (c === "'") {
      const j = cmd.indexOf("'", i + 1);
      if (j < 0) return null;
      cur += cmd.slice(i + 1, j);
      i = j + 1;
    } else {
      cur += c;
      i++;
    }
  }
  if (inWord) words.push(cur);
  return words;
}

export function buildLine(ex: Example, model: Model): string {
  if (ex.raw) return ex.rawLine;
  const op = model.ops.find((o) => o.name === ex.op);
  const base = op && op.request !== null ? op.request : model.spec ? model.spec.request : null;
  const members: any = {};
  for (const src of [base, ex.request]) {
    if (src) for (const k of Object.keys(src)) setMember(members, k, src[k]);
  }
  const parts: string[] = [];
  if (!ex.omit.has('id')) parts.push('"id":' + JSON.stringify(ex.id));
  if (!ex.omit.has('op')) parts.push('"op":' + JSON.stringify(ex.op));
  for (const k of Object.keys(members)) {
    if (!ex.omit.has(k)) parts.push(JSON.stringify(k) + ':' + JSON.stringify(members[k]));
  }
  if (ex.inputText !== null && !ex.omit.has('input')) parts.push('"input":' + ex.inputText);
  return '{' + parts.join(',') + '}';
}

export function isSolo(ex: Example): boolean {
  return ex.raw || ex.omit.has('id');
}

function expectsError(ex: Example): boolean {
  return ex.expects.some((e) => e.path === 'error');
}

interface RunResult { failed: boolean; stdout: string }

function runProgram(argv: string[] | null, cwd: string, input: string): RunResult {
  if (!argv || argv.length === 0) return { failed: true, stdout: '' };
  const opts = { cwd, input, encoding: 'utf8' as const, timeout: 20000, maxBuffer: 1 << 28 };
  let r = spawnSync(argv[0], argv.slice(1), opts);
  if (r.error && (r.error as any).code === 'ENOENT' && argv[0] === 'node') {
    r = spawnSync(process.execPath, argv.slice(1), opts);
  }
  const failed = !!r.error || r.status !== 0 || !!r.signal;
  return { failed, stdout: typeof r.stdout === 'string' ? r.stdout : '' };
}

function validResponse(line: string): any {
  const p = parseJson(line);
  return p.ok && isObject(p.value) && !hasHuge(p.value) ? p.value : undefined;
}

function nonBlankLines(stdout: string): string[] {
  return stdout.split('\n').filter((l) => !/^\s*$/.test(l));
}

function statusWord(status: string | null): string {
  if (status === null) return '';
  return status.split(/\s+/)[0];
}

const STATUS_WORDS = ['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected'];

export interface Analysis { diags: Diag[]; model: Model; examples: Example[]; errors: number; warnings: number }

export function analyze(files: Record<string, string>, entry: string | undefined): Analysis {
  const read = readRecord(files, entry);
  const model = read.model;
  const examples: Example[] = [];
  let diags = read.diags;
  if (!diags.some((d) => d.level === 'error')) {
    diags = diags.concat(checkRecord(model, files, examples));
  }
  diags = sortDiags(diags);
  return {
    diags, model, examples,
    errors: diags.filter((d) => d.level === 'error').length,
    warnings: diags.filter((d) => d.level === 'warning').length,
  };
}

function checkRecord(model: Model, files: Record<string, string>, examples: Example[]): Diag[] {
  const out: Diag[] = [];
  const add = (file: string, line: number, code: string, level: Diag['level'] = 'error') =>
    out.push({ file, line, level, code });

  for (const r of model.reqs) examples.push(...r.examples);

  // IDs are unique (REQ-CK-002).
  const seenReq = new Set<string>();
  const seenOpen = new Set<string>();
  const seenDec = new Set<string>();
  const seenOp = new Set<string>();
  for (const r of model.reqs) {
    if (seenReq.has(r.id)) add(r.file, r.n, 'T007');
    seenReq.add(r.id);
  }
  for (const o of model.opens) {
    if (seenOpen.has(o.id)) add(o.file, o.n, 'T007');
    seenOpen.add(o.id);
  }
  for (const d of model.decisions) {
    if (seenDec.has(d.id)) add(d.file, d.n, 'T007');
    seenDec.add(d.id);
  }
  for (const o of model.ops) {
    if (seenOp.has(o.name)) add(o.file, o.n, 'T007');
    seenOp.add(o.name);
  }
  const opByName = new Map<string, Model['ops'][number]>();
  for (const o of model.ops) if (!opByName.has(o.name)) opByName.set(o.name, o);
  const decByName = new Map<string, Model['decisions'][number]>();
  for (const d of model.decisions) if (!decByName.has(d.id)) decByName.set(d.id, d);

  // Requirements: examples, citations (REQ-CK-001, 003, 008, 009).
  const cited = new Set<string>();
  const codes = Array.from(new Set(model.errorCodes));
  for (const r of model.reqs) {
    if (r.examples.length === 0) add(r.file, r.n, 'T001');
    const ids = Array.from(new Set(r.decisions));
    for (const id of ids) {
      cited.add(id);
      const d = decByName.get(id);
      if (!d) {
        add(r.file, r.n, 'T008');
        continue;
      }
      const w = statusWord(d.status);
      if (w === 'contested' || w === 'superseded' || w === 'rejected') add(r.file, r.n, 'T028');
      else if (w === 'observed' || w === 'inferred' || w === 'proposed') add(r.file, r.n, 'T028', 'warning');
    }
    if (r.text) {
      const text = r.text.lines.join('\n');
      const named = codes.filter((c) => new RegExp('(?<![A-Za-z0-9_-])' + escapeRe(c) + '(?![A-Za-z0-9_-])').test(text));
      if (named.length >= 2 && PHRASES.test(text)) add(r.file, r.text.n, 'T005');
    }
  }

  // Examples against operations and declared errors (REQ-CK-004, 005).
  for (const ex of examples) {
    if (!ex.raw && !expectsError(ex)) {
      const op = opByName.get(ex.op);
      if (!op) add(ex.file, ex.n, 'T009');
      else {
        const keys = ex.inputObj && isObject(ex.inputObj) ? Object.keys(ex.inputObj) : [];
        for (const f of op.fields) if (!f.optional && !keys.includes(f.name)) add(ex.file, ex.n, 'T010');
        for (const k of keys) if (!op.fields.some((f) => f.name === k)) add(ex.file, ex.n, 'T011', 'warning');
      }
    }
    for (const e of ex.expects) {
      if (e.path !== 'error' || e.kind === 'oracle') continue;
      const ok = e.kind === 'eq' && typeof e.value === 'string' && codes.includes(e.value);
      if (!ok) add(ex.file, e.n, 'T023');
    }
  }

  // Obligations outside requirements (REQ-CK-006).
  const obl = (file: string, line: number, lines: string[] | null) => {
    if (lines && holdsObligation(lines)) add(file, line, 'T004');
  };
  if (model.spec) obl(model.spec.file, model.spec.n, model.spec.text && model.spec.text.lines);
  for (const s of model.sections) obl(s.file, s.n, s.text && s.text.lines);
  for (const s of model.notes) obl(s.file, s.n, s.text && s.text.lines);
  for (const d of model.decisions) {
    obl(d.file, d.n, d.text && d.text.lines);
    for (const a of d.rejected) obl(d.file, d.n, [a]);
  }
  for (const o of model.ops) if (o.result !== null) obl(o.file, o.n, [o.result]);
  for (const c of model.errorConds) obl(c.file, c.n, c.lines);
  for (const o of model.opens) {
    if (o.text && holdsObligation(o.text.lines)) add(o.file, o.n, 'T014', 'warning');
    for (const n of o.items) add(o.file, n, 'T003');
  }

  // Decisions (REQ-CK-009).
  for (const d of model.decisions) {
    if (!cited.has(d.id)) add(d.file, d.n, 'T012', 'warning');
    if (d.source === null || d.source === '') add(d.file, d.n, 'T013', 'warning');
    if (d.status !== null) {
      const w = statusWord(d.status);
      let ok = STATUS_WORDS.includes(w);
      if (ok && w === 'superseded') {
        const m = /^superseded by (\S+)$/.exec(d.status);
        ok = !!m && seenDec.has(m[1]);
      }
      if (!ok) add(d.file, d.n, 'T027');
    }
  }

  // The oracle (REQ-OR-*).
  if (examples.length > 0 && !model.oracle) {
    if (model.spec) add(model.spec.file, model.spec.n, 'T019');
  } else if (model.oracle) {
    runExamples(model, files, examples, opByName, add);
  }
  return out;
}

function runExamples(model: Model, files: Record<string, string>, examples: Example[],
  opByName: Map<string, Model['ops'][number]>, add: (f: string, l: number, c: string, lv?: Diag['level']) => void) {
  const oracle = model.oracle!;
  const runnable = examples.filter((ex) => ex.raw || expectsError(ex) || opByName.has(ex.op));
  const lines = new Map<Example, string>();
  for (const ex of runnable) lines.set(ex, buildLine(ex, model));
  const batch = runnable.filter((ex) => !isSolo(ex));
  const solos = runnable.filter((ex) => isSolo(ex));
  if (runnable.length > 0) {
    const tmp = mkdtempSync(join(tmpdir(), 'duramen-'));
    try {
      for (const name of Object.keys(files)) {
        const p = join(tmp, name);
        mkdirSync(dirOf(p), { recursive: true });
        writeFileSync(p, files[name]);
      }
      const cwd = join(tmp, dirOf(oracle.file));
      const argv = splitCommand(oracle.command);
      if (batch.length > 0) {
        const r = runProgram(argv, cwd, batch.map((ex) => lines.get(ex)! + '\n').join(''));
        if (r.failed) add(oracle.file, oracle.n, 'T020');
        const byId = new Map<string, any>();
        for (const l of nonBlankLines(r.stdout)) {
          const v = validResponse(l);
          if (v && typeof v.id === 'string' && !byId.has(v.id)) byId.set(v.id, v);
        }
        for (const ex of batch) {
          if (byId.has(ex.id)) {
            ex.response = byId.get(ex.id);
            ex.responded = true;
          }
        }
      }
      for (const ex of solos) {
        const r = runProgram(argv, cwd, lines.get(ex)! + '\n');
        if (r.failed) add(ex.file, ex.n, 'T020');
        const ls = nonBlankLines(r.stdout);
        if (ls.length === 1) {
          const v = validResponse(ls[0]);
          if (v) {
            ex.response = v;
            ex.responded = true;
          }
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  for (const ex of runnable) {
    if (!ex.responded) {
      add(ex.file, ex.n, 'T021');
      continue;
    }
    const resp = ex.response;
    if (has(resp, 'oracle_error')) {
      add(ex.file, ex.n, 'T022');
      continue;
    }
    if (has(resp, 'error') && ex.expects.length === 0) add(ex.file, ex.n, 'T024', 'warning');
    for (const e of ex.expects) {
      const got = readResponsePath(resp, e.path);
      if (e.kind === 'oracle') {
        if (!got.found) add(ex.file, e.n, 'T025');
      } else if (e.kind === 'eq') {
        if (!got.found || !jsonEqual(got.value, e.value)) add(ex.file, e.n, 'T002');
      } else if (!got.found || typeof got.value !== 'number' || !(Math.abs(got.value - e.value) <= e.tol!)) {
        add(ex.file, e.n, 'T002');
      }
    }
  }
}

export function buildCases(a: Analysis): any[] {
  const model = a.model;
  const cases: any[] = [];
  for (const r of model.reqs) {
    for (const ex of r.examples) {
      const resp = ex.response;
      const c: any = {
        id: ex.id, kind: 'example', reqs: ['REQ-' + r.id], platform: r.platform, line: buildLine(ex, model),
      };
      if (isSolo(ex)) c.solo = true;
      c.checks = ex.expects.map((e) => {
        if (e.kind === 'oracle') {
          return { path: e.path, kind: 'eq', value: readResponsePath(resp, e.path).value, from: 'oracle' };
        }
        if (e.kind === 'approx') return { path: e.path, kind: 'approx', value: e.value, tol: e.tol };
        return { path: e.path, kind: 'eq', value: e.value };
      });
      const op = ex.raw ? undefined : model.ops.find((o) => o.name === ex.op);
      const full: any = { members: Object.keys(resp).sort() };
      if (has(resp, 'error')) full.error = resp.error;
      if (has(resp, 'result')) full.result = resp.result;
      if (op && op.audit && has(resp, 'audit')) full.audit = resp.audit;
      full.tolerances = {};
      if (op) for (const k of Object.keys(op.tolerances)) setMember(full.tolerances, k, op.tolerances[k]);
      c.full = full;
      cases.push(c);
    }
  }
  return cases;
}
