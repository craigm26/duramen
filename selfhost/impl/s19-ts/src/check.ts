// Checking a record (REQ-CK-*, REQ-OR-*) and generating its suite (REQ-SU-*).

import { hasOwn, jsonEqual, readPath, setOwn } from './json.ts';
import type { Obj } from './json.ts';
import type { Diag, Example, Level, Model, Op } from './model.ts';
import { dirname, readRecord } from './read.ts';
import { cleanup, materialize, responseOf, runOracle, splitCommand } from './oracle.ts';

export interface Request {
  files: Obj;
  entry?: string;
}

export interface Outcome {
  diags: Diag[];
  cases: Obj[];
}

const LEVELS: Record<Level, number> = { error: 0, warning: 1, info: 2 };

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortDiags(diags: Diag[]): Diag[] {
  return diags.slice().sort(
    (a, b) => cmp(a.file, b.file) || a.line - b.line || cmp(a.code, b.code) || LEVELS[a.level] - LEVELS[b.level],
  );
}

export function formatDiag(d: Diag): string {
  return `${d.file}:${d.line}: ${d.level} ${d.code}`;
}

/** The record a request names (REQ-RC-001): its files in order, or the name that names none. */
export function selectRecord(
  files: Obj,
  entry: string | undefined,
): { names: string[]; name: string; folder: string } | { missing: string } {
  const all = Object.keys(files);
  if (entry !== undefined && entry !== '.' && hasOwn(files, entry)) {
    return { names: [entry], name: entry, folder: dirname(entry) };
  }
  const folder = entry === undefined || entry === '.' ? '' : entry;
  const name = folder === '' ? '.' : folder;
  const prefix = folder === '' ? '' : folder + '/';
  const names = all
    .filter((n) => n.startsWith(prefix))
    .filter((n) => {
      const parts = n.slice(prefix.length).split('/');
      const last = parts[parts.length - 1];
      if (parts.some((p) => p.startsWith('.'))) return false;
      if (parts.slice(0, -1).some((p) => p === 'build' || p === 'node_modules')) return false;
      return last.endsWith('.duramen');
    })
    .sort(cmp);
  if (names.length === 0) return { missing: name };
  return { names, name, folder };
}

const OBLIGATION = /(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])/;

/** Takes the quotations out of one line, each standing as a break between words. */
export function unquote(line: string): string {
  const closers: Record<string, string> = { '"': '"', '“': '”', '`': '`' };
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch in closers) {
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

export function holdsObligation(lines: string[]): boolean {
  return lines.some((l) => OBLIGATION.test(unquote(l)));
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
const ORDER = new RegExp(
  `(?<![A-Za-z0-9_])(?:${ORDER_PHRASES.map((p) => p.split(' ').join('\\s+')).join('|')})(?![A-Za-z0-9_])`,
  'i',
);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** REQ-CK-008: a text that restates the order of two or more declared codes. */
export function restatesOrder(lines: string[], codes: string[]): boolean {
  const text = lines.join('\n');
  if (!ORDER.test(text)) return false;
  let named = 0;
  for (const code of new Set(codes)) {
    const re = new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(code)}(?![A-Za-z0-9_-])`);
    if (re.test(text)) named++;
  }
  return named >= 2;
}

const STATUSES = ['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected'];

function expectsError(ex: Example): boolean {
  return ex.expects.some((e) => e.path === 'error');
}

/** The request line of a non-raw example (REQ-SU-003). */
function requestLine(ex: Example, id: string, op: Op | undefined, model: Model): string {
  if (ex.rawLine !== null) return ex.rawLine;
  const base = op && op.request ? op.request : (model.spec?.request ?? null);
  const members: Obj = {};
  if (base) for (const k of Object.keys(base)) setOwn(members, k, base[k]);
  if (ex.request) for (const k of Object.keys(ex.request)) setOwn(members, k, ex.request[k]);
  const parts: string[] = [];
  if (!ex.omit.has('id')) parts.push(`"id":${JSON.stringify(id)}`);
  if (!ex.omit.has('op')) parts.push(`"op":${JSON.stringify(ex.op)}`);
  for (const k of Object.keys(members)) {
    if (k === 'id' || k === 'op' || k === 'input' || ex.omit.has(k)) continue;
    parts.push(`${JSON.stringify(k)}:${JSON.stringify(members[k])}`);
  }
  if (!ex.omit.has('input')) {
    if (ex.hasInputLines) parts.push(`"input":${JSON.stringify(ex.input)}`);
    else if (ex.inputText !== null) parts.push(`"input":${ex.inputText}`);
  }
  return `{${parts.join(',')}}`;
}

interface Planned {
  ex: Example;
  reqId: string;
  platform: string;
  id: string;
  line: string;
  solo: boolean;
  op: Op | undefined;
  run: boolean;
  response?: Obj | null;
}

export async function checkRecord(req: Request): Promise<Outcome> {
  const sel = selectRecord(req.files, req.entry);
  if ('missing' in sel) {
    return { diags: [{ file: sel.missing, line: 1, level: 'error', code: 'P046' }], cases: [] };
  }
  const { diags: readDiags, model } = readRecord({ files: req.files, ...sel });
  if (readDiags.length > 0) return { diags: sortDiags(readDiags), cases: [] };

  const diags: Diag[] = [];
  const add = (file: string, line: number, code: string, level: Level = 'error') =>
    diags.push({ file, line, level, code });

  // REQ-CK-001
  for (const r of model.reqs) if (r.examples.length === 0) add(r.file, r.line, 'T001');

  // REQ-CK-002
  const unique = (items: { id: string; file: string; line: number }[]) => {
    const seen = new Set<string>();
    for (const it of items) {
      if (seen.has(it.id)) add(it.file, it.line, 'T007');
      seen.add(it.id);
    }
  };
  unique(model.reqs);
  unique(model.opens);
  unique(model.decisions);
  unique(model.ops.map((o) => ({ id: o.name, file: o.file, line: o.line })));
  const ops = new Map<string, Op>();
  for (const o of model.ops) if (!ops.has(o.name)) ops.set(o.name, o);

  // REQ-CK-003 and REQ-CK-009
  const decisions = new Map<string, (typeof model.decisions)[number]>();
  for (const d of model.decisions) if (!decisions.has(d.id)) decisions.set(d.id, d);
  const cited = new Set<string>();
  for (const r of model.reqs) {
    for (const id of new Set(r.decisions)) {
      cited.add(id);
      const d = decisions.get(id);
      if (!d) {
        add(r.file, r.line, 'T008');
        continue;
      }
      const word = d.status === null ? 'accepted' : d.status.split(/\s/)[0];
      if (word === 'contested' || word === 'superseded' || word === 'rejected') add(r.file, r.line, 'T028');
      else if (word === 'observed' || word === 'inferred' || word === 'proposed') {
        add(r.file, r.line, 'T028', 'warning');
      }
    }
  }
  for (const d of model.decisions) {
    if (!cited.has(d.id)) add(d.file, d.line, 'T012', 'warning');
    if (d.source === null) add(d.file, d.line, 'T013', 'warning');
    if (d.status !== null) {
      const word = d.status.split(/\s/)[0];
      let ok = STATUSES.includes(word);
      if (word === 'superseded') {
        const m = /^superseded by (\S+)$/.exec(d.status);
        ok = m !== null && decisions.has(m[1]);
      }
      if (!ok) add(d.file, d.line, 'T027');
    }
  }

  // REQ-CK-006
  for (const t of model.prose) {
    if (holdsObligation(t.lines)) add(t.file, t.line, t.warning ? 'T014' : 'T004', t.warning ? 'warning' : 'error');
  }

  // REQ-CK-007
  for (const o of model.openExamples) add(o.file, o.line, 'T003');

  // REQ-CK-008
  for (const r of model.reqs) {
    if (r.text && restatesOrder(r.text.lines, model.codes)) add(r.file, r.text.line, 'T005');
  }

  // REQ-CK-004 and REQ-CK-005, and the plan of runs.
  const planned: Planned[] = [];
  for (const r of model.reqs) {
    r.examples.forEach((ex, i) => {
      const id = `${r.id}#${i + 1}`;
      const raw = ex.rawLine !== null;
      const errs = expectsError(ex);
      const op = raw ? undefined : ops.get(ex.op!);
      if (!raw && !errs) {
        if (!op) add(ex.file, ex.line, 'T009');
        else {
          const input = ex.input ?? {};
          for (const f of op.fields) if (!f.optional && !hasOwn(input, f.name)) add(ex.file, ex.line, 'T010');
          const declared = new Set(op.fields.map((f) => f.name));
          for (const k of Object.keys(input)) if (!declared.has(k)) add(ex.file, ex.line, 'T011', 'warning');
        }
      }
      for (const e of ex.expects) {
        if (e.path !== 'error' || e.kind === 'oracle') continue;
        if (e.kind === 'approx' || typeof e.value !== 'string' || !model.codes.includes(e.value)) {
          add(ex.file, e.line, 'T023');
        }
      }
      planned.push({
        ex,
        reqId: r.id,
        platform: r.platform,
        id,
        line: requestLine(ex, id, op, model),
        solo: raw || ex.omit.has('id'),
        op,
        run: raw || errs || op !== undefined,
      });
    });
  }

  // REQ-OR-001 to REQ-OR-008
  if (planned.length > 0) {
    if (!model.oracle) add(model.spec!.file, model.spec!.line, 'T019');
    else await runAll(req.files, model, planned, add);
  }

  const sorted = sortDiags(diags);
  const errors = sorted.filter((d) => d.level === 'error').length;
  const cases = errors === 0 ? planned.map(caseOf) : [];
  return { diags: sorted, cases };
}

async function runAll(
  files: Obj,
  model: Model,
  planned: Planned[],
  add: (file: string, line: number, code: string, level?: Level) => void,
): Promise<void> {
  const toRun = planned.filter((p) => p.run);
  if (toRun.length === 0) return;
  const oracle = model.oracle!;
  const argv = splitCommand(oracle.command);
  const root = materialize(files);
  try {
    const cwd = root + '/' + dirname(oracle.file);
    const batch = toRun.filter((p) => !p.solo);
    const jobs: Promise<void>[] = [];
    if (batch.length > 0) {
      jobs.push(
        runOracle(argv, cwd, batch.map((p) => p.line + '\n').join('')).then((run) => {
          if (run.failed) add(oracle.file, oracle.line, 'T020');
          const byId = new Map<string, Obj>();
          for (const l of run.lines) {
            const r = responseOf(l);
            if (r && typeof r.id === 'string' && !byId.has(r.id)) byId.set(r.id, r);
          }
          for (const p of batch) p.response = byId.get(p.id) ?? null;
        }),
      );
    }
    for (const p of toRun.filter((q) => q.solo)) {
      jobs.push(
        runOracle(argv, cwd, p.line + '\n').then((run) => {
          if (run.failed) add(p.ex.file, p.ex.line, 'T020');
          p.response = run.lines.length === 1 ? responseOf(run.lines[0]) : null;
        }),
      );
    }
    await Promise.all(jobs);
  } finally {
    cleanup(root);
  }
  for (const p of toRun) judgeExample(p, add);
}

function judgeExample(p: Planned, add: (file: string, line: number, code: string, level?: Level) => void): void {
  const { ex, response } = p;
  if (!response) {
    add(ex.file, ex.line, 'T021');
    return;
  }
  if (hasOwn(response, 'oracle_error')) {
    add(ex.file, ex.line, 'T022');
    return;
  }
  for (const e of ex.expects) {
    const v = readPath(response, e.path);
    if (e.kind === 'oracle') {
      if (!v.found) add(ex.file, e.line, 'T025');
    } else if (e.kind === 'eq') {
      if (!v.found || !jsonEqual(v.value, e.value)) add(ex.file, e.line, 'T002');
    } else if (!v.found || typeof v.value !== 'number' || !(Math.abs(v.value - e.value!) <= e.tol!)) {
      add(ex.file, e.line, 'T002');
    }
  }
  if (hasOwn(response, 'error') && ex.expects.length === 0) add(ex.file, ex.line, 'T024', 'warning');
}

function caseOf(p: Planned): Obj {
  const response = p.response!;
  const checks = p.ex.expects.map((e) => {
    if (e.kind === 'eq') return { path: e.path, kind: 'eq', value: e.value };
    if (e.kind === 'approx') return { path: e.path, kind: 'approx', value: e.value, tol: e.tol };
    return { path: e.path, kind: 'eq', value: readPath(response, e.path).value, from: 'oracle' };
  });
  const full: Obj = {
    members: Object.keys(response).sort(cmp),
    tolerances: p.op ? p.op.tolerances : {},
  };
  if (hasOwn(response, 'error')) full.error = response.error;
  if (hasOwn(response, 'result')) full.result = response.result;
  if (p.op && p.op.audit && typeof response.audit === 'string') full.audit = response.audit;
  const c: Obj = {
    id: p.id,
    kind: 'example',
    reqs: [`REQ-${p.reqId}`],
    platform: p.platform,
    line: p.line,
  };
  if (p.solo) c.solo = true;
  c.checks = checks;
  c.full = full;
  return c;
}
