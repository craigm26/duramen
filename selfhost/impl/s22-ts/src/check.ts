// Checking a record (REQ-CK-*), running its examples (REQ-OR-*) and its suite (REQ-SU-*).

import { sortDiags } from './diag.ts';
import type { Diag, Level } from './diag.ts';
import { cmpUnits, hasOwn, isPlainObject, jsonEqual, parseFinite, readPath, setOwn } from './json.ts';
import type { JsonObject } from './json.ts';
import { cleanup, materialize, runOracle, splitCommand } from './oracle.ts';
import { Reader } from './parse.ts';
import type { Example, Model, Op, Req } from './parse.ts';
import { assembleRecord } from './record.ts';

const SEVEN = new Set(['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected']);
const WITHDRAWN = new Set(['contested', 'superseded', 'rejected']);
const WEAK = new Set(['observed', 'inferred', 'proposed']);

const OBLIGATION = /(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])/;
const PHRASES = [
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
const ORDER_PHRASE = new RegExp(
  `(?<![A-Za-z0-9_])(?:${PHRASES.map((p) => p.split(' ').join('\\s+')).join('|')})(?![A-Za-z0-9_])`,
  'i',
);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');

/** Removes quotations from a line, each leaving a space where it stood (REQ-CK-006). */
function unquote(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    const close = ch === '"' ? '"' : ch === '“' ? '”' : ch === '`' ? '`' : undefined;
    if (close !== undefined) {
      const j = line.indexOf(close, i + 1);
      if (j >= 0) {
        out += ' ';
        i = j + 1;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

export function holdsObligation(text: string): boolean {
  return text.split(/\r\n|\r|\n/).some((line) => OBLIGATION.test(unquote(line)));
}

export function restatesOrder(text: string, codes: Iterable<string>): boolean {
  let named = 0;
  for (const code of codes) {
    if (new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(code)}(?![A-Za-z0-9_-])`).test(text)) named++;
  }
  return named >= 2 && ORDER_PHRASE.test(text);
}

export function expectsError(ex: Example): boolean {
  return ex.expects.some((e) => e.path === 'error');
}

function firstOp(model: Model, name: string | undefined): Op | undefined {
  return name === undefined ? undefined : model.ops.find((o) => o.name === name);
}

function firstWord(status: string): string {
  return status.split(/\s/)[0];
}

/** The checks of REQ-CK-001 to REQ-CK-009, on a record read without errors. */
function staticChecks(model: Model, d: (file: string, line: number, code: string, level?: Level) => void): void {
  const dups = <T extends { id: string; file: string; line: number }>(items: T[]) => {
    const seen = new Set<string>();
    for (const it of items) {
      if (seen.has(it.id)) d(it.file, it.line, 'T007');
      seen.add(it.id);
    }
  };
  dups(model.reqs);
  dups(model.opens);
  dups(model.decisions);
  dups(model.ops.map((o) => ({ id: o.name, file: o.file, line: o.line })));

  const declared = new Set(model.decisions.map((x) => x.id));
  const cited = new Set<string>();
  for (const req of model.reqs) {
    if (req.examples.length === 0) d(req.file, req.line, 'T001');
    for (const id of new Set(req.decisions)) {
      cited.add(id);
      const dec = model.decisions.find((x) => x.id === id);
      if (!dec) {
        d(req.file, req.line, 'T008');
        continue;
      }
      const w = dec.status === undefined ? 'accepted' : firstWord(dec.status);
      if (WITHDRAWN.has(w)) d(req.file, req.line, 'T028');
      else if (WEAK.has(w)) d(req.file, req.line, 'T028', 'warning');
    }
    if (req.text && restatesOrder(req.text.text, model.codes)) d(req.file, req.text.line, 'T005');
    for (const ex of req.examples) {
      for (const e of ex.expects) {
        if (e.path !== 'error' || e.kind === 'oracle') continue;
        if (e.kind === 'approx' || typeof e.value !== 'string' || !model.codes.has(e.value)) d(ex.file, e.line, 'T023');
      }
      if (ex.raw || expectsError(ex)) continue;
      const op = firstOp(model, ex.op);
      if (!op) {
        d(ex.file, ex.line, 'T009');
        continue;
      }
      for (const [name, f] of op.fields) if (!f.optional && !hasOwn(ex.input, name)) d(ex.file, ex.line, 'T010');
      for (const name of Object.keys(ex.input)) if (!op.fields.has(name)) d(ex.file, ex.line, 'T011', 'warning');
    }
  }
  for (const dec of model.decisions) {
    if (!cited.has(dec.id)) d(dec.file, dec.line, 'T012', 'warning');
    if (!dec.source) d(dec.file, dec.line, 'T013', 'warning');
    if (dec.status !== undefined) {
      const w = firstWord(dec.status);
      if (!SEVEN.has(w)) d(dec.file, dec.line, 'T027');
      else if (w === 'superseded') {
        const m = /^superseded by (\S+)$/.exec(dec.status);
        if (!m || !declared.has(m[1])) d(dec.file, dec.line, 'T027');
      }
    }
  }
  for (const o of model.obligations) {
    if (holdsObligation(o.text)) d(o.file, o.line, o.open ? 'T014' : 'T004', o.open ? 'warning' : 'error');
  }
  for (const open of model.opens) for (const line of open.tested) d(open.file, line, 'T003');
}

/** A case's request line (REQ-SU-003). */
export function requestLine(model: Model, ex: Example): string {
  if (ex.raw) return ex.rawLine!;
  const op = firstOp(model, ex.op);
  const members: JsonObject = {};
  const base = op?.request ?? model.spec?.request ?? {};
  for (const k of Object.keys(base)) setOwn(members, k, base[k]);
  if (ex.request) for (const k of Object.keys(ex.request)) setOwn(members, k, ex.request[k]);
  const omit = new Set(ex.omit);
  const parts: string[] = [];
  if (!omit.has('id')) parts.push(`"id":${JSON.stringify(ex.caseId)}`);
  if (!omit.has('op')) parts.push(`"op":${JSON.stringify(ex.op)}`);
  for (const k of Object.keys(members)) {
    if (!omit.has(k)) parts.push(`${JSON.stringify(k)}:${JSON.stringify(members[k])}`);
  }
  if (ex.inputText !== undefined && !omit.has('input')) parts.push(`"input":${ex.inputText}`);
  return `{${parts.join(',')}}`;
}

export function isSolo(ex: Example): boolean {
  return ex.raw || ex.omit.includes('id');
}

function asResponse(line: string): JsonObject | undefined {
  const p = parseFinite(line);
  return p && isPlainObject(p.value) ? p.value : undefined;
}

export interface Outcome {
  diagnostics: Diag[];
  model?: Model;
  responses: Map<Example, JsonObject>;
}

export async function checkRecord(files: Map<string, string>, entry: string): Promise<Outcome> {
  const record = assembleRecord(files, entry);
  const reader = new Reader(files, record);
  reader.read();
  const diags = reader.diags;
  const responses = new Map<Example, JsonObject>();
  if (diags.some((x) => x.level === 'error')) return { diagnostics: sortDiags(diags), responses };
  const model = reader.model;
  const d = (file: string, line: number, code: string, level: Level = 'error') =>
    diags.push({ file, line, level, code });
  staticChecks(model, d);

  const examples = model.reqs.flatMap((r: Req) => r.examples);
  if (examples.length > 0 && !model.oracle) {
    d(model.spec!.file, model.spec!.line, 'T019');
  } else if (examples.length > 0 && model.oracle) {
    const oracle = model.oracle;
    const runs = examples.filter((ex) => ex.raw || expectsError(ex) || firstOp(model, ex.op));
    const argv = splitCommand(oracle.command);
    const root = materialize(files);
    try {
      const slash = oracle.file.lastIndexOf('/');
      const cwd = slash < 0 ? root : `${root}/${oracle.file.slice(0, slash)}`;
      const batch = runs.filter((ex) => !isSolo(ex));
      if (batch.length > 0) {
        const run = await runOracle(argv, cwd, batch.map((ex) => requestLine(model, ex) + '\n').join(''));
        if (run.failed) d(oracle.file, oracle.line, 'T020');
        const byId = new Map<string, JsonObject>();
        for (const line of run.lines) {
          const r = asResponse(line);
          if (r && typeof r.id === 'string' && !byId.has(r.id)) byId.set(r.id, r);
        }
        for (const ex of batch) {
          const r = byId.get(ex.caseId);
          if (r) responses.set(ex, r);
        }
      }
      for (const ex of runs.filter(isSolo)) {
        const run = await runOracle(argv, cwd, requestLine(model, ex) + '\n');
        if (run.failed) d(ex.file, ex.line, 'T020');
        const r = run.lines.length === 1 ? asResponse(run.lines[0]) : undefined;
        if (r) responses.set(ex, r);
      }
    } finally {
      cleanup(root);
    }
    for (const ex of runs) {
      const r = responses.get(ex);
      if (!r) {
        d(ex.file, ex.line, 'T021');
        continue;
      }
      if (hasOwn(r, 'oracle_error')) {
        d(ex.file, ex.line, 'T022');
        continue;
      }
      for (const e of ex.expects) {
        const v = readPath(r, e.path);
        if (e.kind === 'oracle') {
          if (!v) d(ex.file, e.line, 'T025');
        } else if (e.kind === 'eq') {
          if (!v || !jsonEqual(v.value, e.value)) d(ex.file, e.line, 'T002');
        } else if (!v || typeof v.value !== 'number' || !(Math.abs(v.value - (e.value as number)) <= e.tol!)) {
          d(ex.file, e.line, 'T002');
        }
      }
      if (hasOwn(r, 'error') && ex.expects.length === 0) d(ex.file, ex.line, 'T024', 'warning');
    }
  }
  return { diagnostics: sortDiags(diags), model, responses };
}

export function countLevel(diags: Diag[], level: Level): number {
  return diags.filter((x) => x.level === level).length;
}

/** The suite of a record without errors (REQ-SU-002 to REQ-SU-005). */
export function buildCases(outcome: Outcome): JsonObject[] {
  const model = outcome.model;
  if (!model) return [];
  const cases: JsonObject[] = [];
  for (const req of model.reqs) {
    for (const ex of req.examples) {
      const r = outcome.responses.get(ex) ?? {};
      const checks = ex.expects.map((e) => {
        if (e.kind === 'approx') return { path: e.path, kind: 'approx', value: e.value, tol: e.tol };
        if (e.kind === 'eq') return { path: e.path, kind: 'eq', value: e.value };
        return { path: e.path, kind: 'eq', value: readPath(r, e.path)?.value, from: 'oracle' };
      });
      const op = ex.raw ? undefined : firstOp(model, ex.op);
      const tolerances: JsonObject = {};
      if (op) for (const [path, t] of op.tolerances) setOwn(tolerances, path, t);
      const full: JsonObject = { members: Object.keys(r).sort(cmpUnits), tolerances };
      if (hasOwn(r, 'error')) full.error = r.error;
      if (hasOwn(r, 'result')) full.result = r.result;
      if (op?.audit && typeof r.audit === 'string') full.audit = r.audit;
      const c: JsonObject = {
        id: ex.caseId,
        kind: 'example',
        reqs: [`REQ-${req.id}`],
        platform: req.platform,
        line: requestLine(model, ex),
        checks,
        full,
      };
      if (isSolo(ex)) c.solo = true;
      cases.push(c);
    }
  }
  return cases;
}
