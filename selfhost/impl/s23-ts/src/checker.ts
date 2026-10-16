// Checking a record (REQ-RC-*, REQ-CK-*, REQ-OR-*) and listing its suite (REQ-SU-*).

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { getOwn, hasOwn, hasNonFinite, isObj, jsonEqual, lookup, setOwn } from './json.ts';
import { newModel, readFile, Sink } from './reader.ts';
import type { Diag, Item, Model, OpModel, ReqModel } from './reader.ts';

export interface CheckOutput {
  diagnostics: string[];
  errors: number;
  warnings: number;
  cases: unknown[];
}

const LEVELS = ['error', 'warning', 'info'];

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function folderOf(file: string): string {
  const i = file.lastIndexOf('/');
  return i < 0 ? '.' : file.slice(0, i);
}

// ------------------------------------------------------------ obligations

const QUOTES: Record<string, string> = { '"': '"', '“': '”', '`': '`' };

function stripQuotations(line: string): string {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const close = QUOTES[ch];
    if (close !== undefined) {
      const j = line.indexOf(close, i + 1);
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

const OBLIGATION = /(?<![A-Za-z0-9_])(MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])/;

function holdsObligation(text: string): boolean {
  return text.split(/\r\n|\n|\r/).some((l) => OBLIGATION.test(stripQuotations(l)));
}

const PHRASES =
  /(?<![A-Za-z0-9_])(in\s+this\s+order|in\s+the\s+order|first\s+that\s+applies|first\s+match|precedes?|preceded|before|after|take\s+precedence|takes\s+precedence)(?![A-Za-z0-9_])/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ------------------------------------------------------------ oracle

function splitCommand(s: string): string[] | null {
  const words: string[] = [];
  let cur = '';
  let has = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ' || ch === '\t') {
      if (has) words.push(cur);
      cur = '';
      has = false;
      i++;
    } else if (ch === '"') {
      has = true;
      i++;
      let closed = false;
      while (i < s.length) {
        if (s[i] === '\\' && s[i + 1] === '"') {
          cur += '"';
          i += 2;
        } else if (s[i] === '"') {
          closed = true;
          i++;
          break;
        } else cur += s[i++];
      }
      if (!closed) return null;
    } else if (ch === "'") {
      has = true;
      const j = s.indexOf("'", i + 1);
      if (j < 0) return null;
      cur += s.slice(i + 1, j);
      i = j + 1;
    } else {
      cur += ch;
      has = true;
      i++;
    }
  }
  if (has) words.push(cur);
  return words;
}

interface RunResult {
  lines: string[];
  failed: boolean;
}

class OracleRunner {
  files: Map<string, string>;
  tmp: string | null = null;
  constructor(files: Map<string, string>) {
    this.files = files;
  }
  materialize(): string {
    if (this.tmp) return this.tmp;
    const root = mkdtempSync(join(tmpdir(), 'duramen-'));
    for (const [name, text] of this.files) {
      try {
        const p = join(root, ...name.split('/'));
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, text);
      } catch {
        // a name the file system cannot hold (OPEN-RQ-003)
      }
    }
    this.tmp = root;
    return root;
  }
  cleanup(): void {
    if (this.tmp) rmSync(this.tmp, { recursive: true, force: true });
    this.tmp = null;
  }
  run(cmd: string, dir: string, lines: string[]): RunResult {
    const words = splitCommand(cmd);
    if (!words || words.length === 0) return { lines: [], failed: true };
    const root = this.materialize();
    const cwd = dir === '.' ? root : join(root, ...dir.split('/'));
    const prog = words[0] === 'node' ? process.execPath : words[0];
    const input = Buffer.from(lines.map((l) => l + '\n').join(''), 'utf8');
    const r = spawnSync(prog, words.slice(1), {
      cwd,
      input,
      timeout: 60000,
      maxBuffer: 1 << 28,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const failed = (r.error !== undefined && (r.error as NodeJS.ErrnoException).code !== 'EPIPE') || r.status !== 0;
    const out = r.stdout ? r.stdout.toString('utf8') : '';
    const outLines = out.split('\n').filter((l) => !/^\s*$/.test(l));
    return { lines: outLines, failed };
  }
}

function parseResponseLine(l: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(l);
    if (!isObj(v) || hasNonFinite(v)) return null;
    return v;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ the check

interface Prepared {
  item: Item;
  req: ReqModel;
  id: string;
  op: OpModel | null;
  solo: boolean;
  line: string;
  run: boolean;
  response?: Record<string, unknown>;
  oracleValues: Map<number, unknown>;
}

function buildLine(p: Prepared, model: Model): string {
  const item = p.item;
  if (item.raw) return item.rawLine!;
  const parts: string[] = [];
  if (!item.omit.has('id')) parts.push('"id":' + JSON.stringify(p.id));
  if (!item.omit.has('op')) parts.push('"op":' + JSON.stringify(item.op));
  const members: Record<string, unknown> = Object.create(null);
  const base = p.op && p.op.request ? p.op.request : model.spec ? model.spec.request : null;
  if (base) for (const k of Object.keys(base)) setOwn(members, k, getOwn(base, k));
  if (item.request) for (const k of Object.keys(item.request)) setOwn(members, k, getOwn(item.request, k));
  for (const k of Object.keys(members)) {
    if (item.omit.has(k)) continue;
    parts.push(JSON.stringify(k) + ':' + JSON.stringify(members[k]));
  }
  if (!item.omit.has('input')) {
    if (item.inputObj) parts.push('"input":' + JSON.stringify(item.inputObj));
    else if (item.inputText !== null) parts.push('"input":' + item.inputText);
  }
  return '{' + parts.join(',') + '}';
}

export function checkRecord(files: Map<string, string>, entryIn: string | undefined): CheckOutput {
  const entry = entryIn === undefined ? '.' : entryIn;
  const sink = new Sink();
  const model = newModel();

  // which files make the record
  let recName = entry;
  let recFolder: string;
  let list: string[] = [];
  if (entry !== '.' && files.has(entry)) {
    list = [entry];
    recFolder = folderOf(entry);
  } else {
    recFolder = entry;
    const prefix = entry === '.' ? '' : entry + '/';
    for (const name of files.keys()) {
      if (!name.startsWith(prefix) || !name.endsWith('.duramen')) continue;
      const parts = name.slice(prefix.length).split('/');
      const last = parts.length - 1;
      let ok = !parts[last].startsWith('.');
      for (let i = 0; i < last && ok; i++) {
        if (parts[i].startsWith('.') || parts[i] === 'build' || parts[i] === 'node_modules') ok = false;
      }
      if (ok) list.push(name);
    }
    list.sort((a, b) => cmp(a.slice(prefix.length), b.slice(prefix.length)));
    if (list.length === 0) {
      sink.add(recName, 1, 'P046');
      return finish(sink.list, null, null);
    }
  }

  const ctx = { model, sink, files, recordFolder: recFolder, folderOf };
  const fileVersions: string[] = [];
  for (const name of list) {
    const v = readFile(ctx, name, files.get(name)!);
    if (v) fileVersions.push(v);
  }
  if (!model.spec) sink.add(recName, 1, 'P021');
  if (new Set(fileVersions).size > 1) sink.add(recName, 1, 'P047');

  if (sink.list.some((d) => d.level === 'error')) return finish(sink.list, null, null);

  // ---- T checks
  const runner = new OracleRunner(files);
  try {
    return finish(...checkModel(model, sink, files, runner));
  } finally {
    runner.cleanup();
  }
}

function finish(diags: Diag[], cases: unknown[] | null, _unused: null): CheckOutput {
  void _unused;
  diags.sort(
    (a, b) =>
      cmp(a.file, b.file) || a.line - b.line || cmp(a.code, b.code) || LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level),
  );
  const errors = diags.filter((d) => d.level === 'error').length;
  const warnings = diags.filter((d) => d.level === 'warning').length;
  return {
    diagnostics: diags.map((d) => `${d.file}:${d.line}: ${d.level} ${d.code}`),
    errors,
    warnings,
    cases: errors === 0 && cases ? cases : [],
  };
}

function checkModel(model: Model, sink: Sink, files: Map<string, string>, runner: OracleRunner): [Diag[], unknown[], null] {
  void files;
  const add = (f: string, l: number, c: string, lv: 'error' | 'warning' = 'error') => sink.add(f, l, c, lv);

  // T007 duplicates and operation index
  const firstOp = new Map<string, OpModel>();
  const dup = (seen: Set<string>, id: string) => {
    if (seen.has(id)) return true;
    seen.add(id);
    return false;
  };
  const sOps = new Set<string>();
  for (const op of model.ops) {
    if (dup(sOps, op.name)) add(op.file, op.line, 'T007');
    else firstOp.set(op.name, op);
  }
  const sReqs = new Set<string>();
  for (const r of model.reqs) if (dup(sReqs, r.id)) add(r.file, r.line, 'T007');
  const sOpens = new Set<string>();
  for (const o of model.opens) if (dup(sOpens, o.id)) add(o.file, o.line, 'T007');
  const sDec = new Set<string>();
  const decById = new Map<string, (typeof model.decisions)[number]>();
  for (const d of model.decisions) {
    if (dup(sDec, d.id)) add(d.file, d.line, 'T007');
    else decById.set(d.id, d);
  }

  // T003
  for (const c of model.openClauses) add(c.file, c.line, 'T003');

  // T004 / T014
  for (const o of model.oblig) {
    for (const t of o.texts) {
      if (holdsObligation(t)) add(o.file, o.line, o.code, o.code === 'T004' ? 'error' : 'warning');
    }
  }

  const codes = new Set(model.codes);

  // per requirement
  const cited = new Set<string>();
  for (const r of model.reqs) {
    if (r.items.length === 0) add(r.file, r.line, 'T001');
    const once = new Set<string>();
    for (const d of r.decisions) {
      if (once.has(d)) continue;
      once.add(d);
      cited.add(d);
      const dec = decById.get(d);
      if (!dec) {
        add(r.file, r.line, 'T008');
        continue;
      }
      const w = statusWord(dec.status);
      if (w === 'contested' || w === 'superseded' || w === 'rejected') add(r.file, r.line, 'T028');
      else if (w === 'observed' || w === 'inferred' || w === 'proposed') add(r.file, r.line, 'T028', 'warning');
    }
    if (r.text && codes.size >= 2) {
      const named = [...codes].filter((c) => new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(c)}(?![A-Za-z0-9_-])`).test(r.text!.text));
      if (named.length >= 2 && PHRASES.test(r.text.text)) add(r.file, r.text.line, 'T005');
    }
  }

  // decisions
  for (const d of model.decisions) {
    if (!cited.has(d.id)) add(d.file, d.line, 'T012', 'warning');
    if (d.source === null || d.source === '') add(d.file, d.line, 'T013', 'warning');
    if (d.status !== null) {
      const w = d.status.split(/\s/)[0];
      const known = ['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected'];
      let ok = known.includes(w);
      if (ok && w === 'superseded') {
        const m = /^superseded by (\S+)$/.exec(d.status);
        ok = !!m && decById.has(m[1]);
      }
      if (!ok) add(d.file, d.line, 'T027');
    }
  }

  // examples
  const prepared: Prepared[] = [];
  let anyExample = false;
  for (const r of model.reqs) {
    let n = 0;
    for (const item of r.items) {
      n++;
      anyExample = true;
      const op = item.op !== null ? (firstOp.get(item.op) ?? null) : null;
      const expectsError = item.expects.some((e) => e.path === 'error');
      if (!item.raw && !expectsError) {
        if (!op) add(item.file, item.line, 'T009');
        else {
          let given: string[] = [];
          if (item.inputObj) given = Object.keys(item.inputObj);
          else if (item.inputText !== null) {
            try {
              given = Object.keys(JSON.parse(item.inputText));
            } catch {
              given = [];
            }
          }
          for (const [name, optional] of op.fields) if (!optional && !given.includes(name)) add(item.file, item.line, 'T010');
          for (const g of given) if (!op.fields.has(g)) add(item.file, item.line, 'T011', 'warning');
        }
      }
      for (const e of item.expects) {
        if (e.path !== 'error' || e.kind === 'oracle') continue;
        if (typeof e.value !== 'string' || !codes.has(e.value)) add(item.file, e.line, 'T023');
      }
      const p: Prepared = {
        item,
        req: r,
        id: `${r.id}#${n}`,
        op,
        solo: item.raw || item.omit.has('id'),
        line: '',
        run: item.raw || expectsError || op !== null,
        oracleValues: new Map(),
      };
      p.line = buildLine(p, model);
      prepared.push(p);
    }
  }

  // T019 / oracle
  if (anyExample && !model.oracle) {
    add(model.spec!.file, model.spec!.line, 'T019');
  } else if (model.oracle) {
    const orc = model.oracle;
    const toRun = prepared.filter((p) => p.run);
    const batch = toRun.filter((p) => !p.solo);
    if (batch.length > 0) {
      const res = runner.run(orc.cmd, orc.dir, batch.map((p) => p.line));
      if (res.failed) add(orc.file, orc.line, 'T020');
      const byId = new Map<string, Record<string, unknown>>();
      for (const l of res.lines) {
        const v = parseResponseLine(l);
        if (v && typeof v.id === 'string' && !byId.has(v.id)) byId.set(v.id, v);
      }
      for (const p of batch) p.response = byId.get(p.id);
    }
    for (const p of toRun.filter((q) => q.solo)) {
      const res = runner.run(orc.cmd, orc.dir, [p.line]);
      if (res.failed) add(p.item.file, p.item.line, 'T020');
      if (res.lines.length === 1) {
        const v = parseResponseLine(res.lines[0]);
        if (v) p.response = v;
      }
    }
    for (const p of toRun) evaluate(p, add);
  }

  return [sink.list, buildCases(prepared), null];
}

function statusWord(status: string | null): string {
  if (status === null) return 'accepted';
  return status.split(/\s/)[0];
}

function evaluate(p: Prepared, add: (f: string, l: number, c: string, lv?: 'error' | 'warning') => void): void {
  const item = p.item;
  const resp = p.response;
  if (!resp) {
    add(item.file, item.line, 'T021');
    return;
  }
  if (hasOwn(resp, 'oracle_error')) {
    add(item.file, item.line, 'T022');
    return;
  }
  if (hasOwn(resp, 'error') && item.expects.length === 0) add(item.file, item.line, 'T024', 'warning');
  item.expects.forEach((e, i) => {
    const f = lookup(resp, e.path);
    if (e.kind === 'oracle') {
      if (!f.found) add(item.file, e.line, 'T025');
      else p.oracleValues.set(i, f.value);
    } else if (e.kind === 'eq') {
      if (!f.found || !jsonEqual(f.value, e.value)) add(item.file, e.line, 'T002');
    } else {
      if (!f.found || typeof f.value !== 'number' || !(Math.abs(f.value - (e.value as number)) <= (e.tol as number)))
        add(item.file, e.line, 'T002');
    }
  });
}

function buildCases(prepared: Prepared[]): unknown[] {
  const out: unknown[] = [];
  for (const p of prepared) {
    const resp = p.response;
    if (!resp) continue;
    const checks = p.item.expects.map((e, i) => {
      if (e.kind === 'eq') return { path: e.path, kind: 'eq', value: e.value };
      if (e.kind === 'approx') return { path: e.path, kind: 'approx', value: e.value, tol: e.tol };
      return { path: e.path, kind: 'eq', value: p.oracleValues.get(i), from: 'oracle' };
    });
    const full: Record<string, unknown> = { members: Object.keys(resp).sort() };
    if (hasOwn(resp, 'error')) full.error = resp.error;
    if (hasOwn(resp, 'result')) full.result = resp.result;
    if (!p.item.raw && p.op && p.op.audit && typeof resp.audit === 'string') full.audit = resp.audit;
    const tol: Record<string, number> = Object.create(null);
    if (!p.item.raw && p.op) for (const k of Object.keys(p.op.tolerances)) setOwn(tol, k, p.op.tolerances[k]);
    full.tolerances = tol;
    const c: Record<string, unknown> = {
      id: p.id,
      kind: 'example',
      reqs: ['REQ-' + p.req.id],
      platform: p.req.platform,
      line: p.line,
    };
    if (p.solo) c.solo = true;
    c.checks = checks;
    c.full = full;
    out.push(c);
  }
  return out;
}
