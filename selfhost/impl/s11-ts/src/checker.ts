// Checking a record that was read without errors, and running its examples (REQ-CK-*, REQ-OR-*).

import { join } from 'node:path';
import { dirname, type Files } from './files.ts';
import { hasMember, hasNonFinite, isObject, jsonEqual, parseLoose, type Json } from './json.ts';
import type { Diagnostic, Example, Level, Record } from './model.ts';
import { cleanup, materialize, runOracle } from './oracle.ts';
import { expectsError, isSolo, requestLine, type Outcome } from './suite.ts';

const STATUSES = ['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected'];
const OBLIGATION = /(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])/;
const ORDER_PHRASES = [
  'in this order', 'in the order', 'first that applies', 'first match', 'precede', 'precedes', 'preceded',
  'before', 'after', 'take precedence', 'takes precedence',
].map((p) => new RegExp(`(?<![A-Za-z0-9_])${p.split(' ').join('\\s+')}(?![A-Za-z0-9_])`, 'i'));

/** Whether a text states an obligation outside quotations on one line (REQ-CK-006). */
export function holdsObligation(lines: string[]): boolean {
  return lines.some((line) => OBLIGATION.test(unquote(line)));
}

function unquote(line: string): string {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const close = line[i] === '"' ? '"' : line[i] === '“' ? '”' : line[i] === '`' ? '`' : undefined;
    if (close !== undefined) {
      const j = line.indexOf(close, i + 1);
      if (j >= 0) {
        out += ' ';
        i = j;
        continue;
      }
    }
    out += line[i];
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The value at a path of a response (REQ-OR-003). */
export function valueAt(resp: { [k: string]: Json }, path: string): { found: boolean; value?: Json } {
  const names = path.split('.');
  let cur: Json = resp;
  if (names[0] === 'audit' && names.length > 1) {
    if (typeof resp.audit !== 'string' || !hasMember(resp, 'audit')) return { found: false };
    const p = parseLoose(resp.audit);
    if (!p.ok) return { found: false };
    cur = p.value;
    names.shift();
  }
  for (const name of names) {
    if (Array.isArray(cur)) {
      if (!/^(?:0|[1-9]\d*)$/.test(name) || Number(name) >= cur.length) return { found: false };
      cur = cur[Number(name)];
    } else if (isObject(cur)) {
      if (!hasMember(cur, name)) return { found: false };
      cur = cur[name];
    } else return { found: false };
  }
  return { found: true, value: cur };
}

export interface Checked {
  diags: Diagnostic[];
  outcomes: Map<Example, Outcome>;
}

export async function checkRecord(record: Record, files: Files): Promise<Checked> {
  const diags: Diagnostic[] = [];
  const add = (file: string, line: number, code: string, level: Level = 'error') =>
    diags.push({ file, line, level, code });

  // IDs of the cases.
  for (const req of record.reqs) req.examples.forEach((ex, i) => { ex.id = `${req.id}#${i + 1}`; });

  // REQ-CK-001
  for (const req of record.reqs) if (req.examples.length === 0) add(req.file, req.line, 'T001');

  // REQ-CK-002
  const unique = (items: { id: string; file: string; line: number }[]) => {
    const seen = new Set<string>();
    for (const it of items) {
      if (seen.has(it.id)) add(it.file, it.line, 'T007');
      seen.add(it.id);
    }
  };
  unique(record.reqs);
  unique(record.opens);
  unique(record.decisions);
  unique(record.ops.map((o) => ({ id: o.name, file: o.file, line: o.line })));

  // REQ-CK-003, REQ-CK-009
  const decisions = new Map<string, Record['decisions'][number]>();
  for (const d of record.decisions) if (!decisions.has(d.id)) decisions.set(d.id, d);
  const cited = new Set<string>();
  for (const req of record.reqs) {
    for (const id of new Set(req.decisions)) {
      cited.add(id);
      const d = decisions.get(id);
      if (!d) {
        add(req.file, req.line, 'T008');
        continue;
      }
      const word = d.status === undefined ? 'accepted' : /^\S*/.exec(d.status)![0];
      if (word === 'contested' || word === 'superseded' || word === 'rejected') add(req.file, req.line, 'T028');
      else if (word === 'observed' || word === 'inferred' || word === 'proposed') {
        add(req.file, req.line, 'T028', 'warning');
      }
    }
  }
  for (const d of record.decisions) {
    if (!cited.has(d.id)) add(d.file, d.line, 'T012', 'warning');
    if (d.source === undefined || d.source === '') add(d.file, d.line, 'T013', 'warning');
    if (d.status !== undefined) {
      const word = /^\S*/.exec(d.status)![0];
      let ok = STATUSES.includes(word);
      if (word === 'superseded') {
        const m = /^superseded by (\S+)$/.exec(d.status);
        ok = m !== null && decisions.has(m[1]);
      }
      if (!ok) add(d.file, d.line, 'T027');
    }
  }

  // REQ-CK-004, REQ-CK-005
  const codes = new Set(record.errors.flatMap((l) => l.codes.map((c) => c.code)));
  const examples = record.reqs.flatMap((r) => r.examples);
  for (const ex of examples) {
    for (const e of ex.expects) {
      if (e.kind === 'eq' && e.path === 'error' && !(typeof e.value === 'string' && codes.has(e.value))) {
        add(ex.file, e.line, 'T023');
      }
    }
    if (ex.raw || expectsError(ex)) continue;
    const op = record.ops.find((o) => o.name === ex.op);
    if (!op) {
      add(ex.file, ex.line, 'T009');
      continue;
    }
    const input = ex.hasInputLines
      ? ex.inputValue!
      : ex.inputText !== undefined ? (JSON.parse(ex.inputText) as { [k: string]: Json }) : {};
    for (const [name, optional] of op.fields) if (!optional && !hasMember(input, name)) add(ex.file, ex.line, 'T010');
    for (const name of Object.keys(input)) if (!op.fields.has(name)) add(ex.file, ex.line, 'T011', 'warning');
  }

  // REQ-CK-006
  const obligation = (file: string, line: number, lines: string[] | undefined, level: Level = 'error') => {
    if (lines && holdsObligation(lines)) add(file, line, level === 'error' ? 'T004' : 'T014', level);
  };
  for (const s of record.specs) obligation(s.file, s.line, s.text?.lines);
  for (const s of record.sections) obligation(s.file, s.line, s.text?.lines);
  for (const n of record.notes) obligation(n.file, n.line, n.text?.lines);
  for (const d of record.decisions) {
    obligation(d.file, d.line, d.text?.lines);
    for (const alt of d.rejected) obligation(d.file, d.line, [alt]);
  }
  for (const op of record.ops) if (op.result !== undefined) obligation(op.file, op.line, [op.result]);
  for (const list of record.errors) for (const c of list.codes) obligation(list.file, c.line, c.condition);
  for (const o of record.opens) obligation(o.file, o.line, o.text?.lines, 'warning');

  // REQ-CK-007
  for (const o of record.opens) for (const line of o.exampleLines) add(o.file, line, 'T003');

  // REQ-CK-008
  for (const req of record.reqs) {
    if (!req.text) continue;
    const text = req.text.lines.join('\n');
    const named = [...codes].filter((code) =>
      new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(code)}(?![A-Za-z0-9_-])`).test(text));
    if (named.length >= 2 && ORDER_PHRASES.some((p) => p.test(text))) add(req.file, req.text.line, 'T005');
  }

  // REQ-OR-001 to REQ-OR-008
  const outcomes = new Map<Example, Outcome>();
  const oracle = record.oracles[0];
  if (examples.length > 0 && !oracle) {
    const spec = record.specs[0];
    add(spec.file, spec.line, 'T019');
  } else if (oracle) {
    const run = examples.filter((ex) => ex.raw || expectsError(ex) || record.ops.some((o) => o.name === ex.op));
    if (run.length > 0) await runExamples(record, files, run, outcomes, add);
  }
  return { diags, outcomes };
}

async function runExamples(
  record: Record, files: Files, run: Example[], outcomes: Map<Example, Outcome>,
  add: (file: string, line: number, code: string, level?: Level) => void,
): Promise<void> {
  const oracle = record.oracles[0];
  const root = await materialize(files);
  try {
    const cwd = join(root, ...dirname(oracle.file).split('/').filter((p) => p !== ''));
    const batch = run.filter((ex) => !isSolo(ex));
    const solo = run.filter(isSolo);
    const jobs: (() => Promise<void>)[] = [];
    if (batch.length > 0) {
      jobs.push(() => runOracle(oracle.command, cwd, batch.map((ex) => requestLine(ex, record))).then((res) => {
        if (!res.ok) add(oracle.file, oracle.line, 'T020');
        const byId = new Map<string, { [k: string]: Json }>();
        for (const line of res.lines) {
          const resp = response(line);
          if (resp && typeof resp.id === 'string' && !byId.has(resp.id)) byId.set(resp.id, resp);
        }
        for (const ex of batch) outcomes.set(ex, { response: byId.get(ex.id!), values: new Map() });
      }));
    }
    for (const ex of solo) {
      jobs.push(() => runOracle(oracle.command, cwd, [requestLine(ex, record)]).then((res) => {
        if (!res.ok) add(ex.file, ex.line, 'T020');
        const lines = res.lines.filter((l) => l.trim() !== '');
        outcomes.set(ex, { response: lines.length === 1 ? response(lines[0]) : undefined, values: new Map() });
      }));
    }
    // At most a few runs of the oracle at once.
    const workers = Array.from({ length: Math.min(8, jobs.length) }, async () => {
      for (let job = jobs.shift(); job; job = jobs.shift()) await job();
    });
    await Promise.all(workers);
  } finally {
    await cleanup(root);
  }
  for (const ex of run) {
    const out = outcomes.get(ex)!;
    const resp = out.response;
    if (!resp) {
      add(ex.file, ex.line, 'T021');
      continue;
    }
    if (hasMember(resp, 'oracle_error')) {
      add(ex.file, ex.line, 'T022');
      continue;
    }
    for (const e of ex.expects) {
      const at = valueAt(resp, e.path);
      if (e.kind === 'oracle') {
        if (!at.found) add(ex.file, e.line, 'T025');
        else out.values.set(e, at.value!);
      } else if (e.kind === 'eq') {
        if (!at.found || !jsonEqual(at.value, e.value)) add(ex.file, e.line, 'T002');
      } else if (!at.found || typeof at.value !== 'number' || !(Math.abs(at.value - e.value!) <= e.tol!)) {
        add(ex.file, e.line, 'T002');
      }
    }
    if (ex.expects.length === 0 && hasMember(resp, 'error')) add(ex.file, ex.line, 'T024', 'warning');
  }
}

/** A response line: a JSON object holding no number too large to be finite. */
function response(line: string): { [k: string]: Json } | undefined {
  const p = parseLoose(line);
  if (!p.ok || !isObject(p.value) || hasNonFinite(p.value)) return undefined;
  return p.value;
}
