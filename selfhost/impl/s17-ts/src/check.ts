// Checking a record that was read without errors (REQ-CK-001 to REQ-CK-009, REQ-OR-001 to REQ-OR-008).

import type { Diag, Example, OpModel, RecordModel } from './model.ts';
import { buildLine, isSolo } from './line.ts';
import { cleanup, materialize, responsesById, runOracle, soloResponse } from './oracle.ts';
import { deepEqual, getPath, hasOwn } from './util.ts';
import type { Obj } from './util.ts';
import { dirname, join } from 'node:path';

export interface Checked {
  diags: Diag[];
  responses: Map<Example, Obj | null>;
  ops: Map<string, OpModel>;
}

function stripQuotes(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const close = ch === '"' ? '"' : ch === '“' ? '”' : ch === '`' ? '`' : null;
    if (close !== null) {
      const j = s.indexOf(close, i + 1);
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

const OBLIGATION = /(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])/;

export function holdsObligation(lines: string[]): boolean {
  return lines.some((l) => OBLIGATION.test(stripQuotes(l)));
}

const PHRASES =
  /(?<![A-Za-z0-9_])(?:in\s+this\s+order|in\s+the\s+order|first\s+that\s+applies|first\s+match|preced(?:es?|ed)|before|after|takes?\s+precedence)(?![A-Za-z0-9_])/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LINES = /\r\n|\r|\n/;
const STATUS_WORDS = ['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected'];

export function checkRecord(rec: RecordModel): Checked {
  const diags: Diag[] = [];
  const add = (file: string, line: number, level: 'error' | 'warning', code: string): void => {
    diags.push({ file, line, level, code });
  };

  // REQ-CK-002
  const seenReq = new Set<string>();
  for (const r of rec.reqs) {
    if (seenReq.has(r.id)) add(r.file, r.line, 'error', 'T007');
    seenReq.add(r.id);
  }
  const seenOpen = new Set<string>();
  for (const o of rec.opens) {
    if (seenOpen.has(o.id)) add(o.file, o.line, 'error', 'T007');
    seenOpen.add(o.id);
  }
  const seenDec = new Set<string>();
  const firstDec = new Map<string, (typeof rec.decisions)[number]>();
  for (const dec of rec.decisions) {
    if (seenDec.has(dec.id)) add(dec.file, dec.line, 'error', 'T007');
    else firstDec.set(dec.id, dec);
    seenDec.add(dec.id);
  }
  const ops = new Map<string, OpModel>();
  for (const op of rec.ops) {
    if (op.name === null) continue;
    if (ops.has(op.name)) add(op.file, op.line, 'error', 'T007');
    else ops.set(op.name, op);
  }

  // REQ-CK-001, REQ-CK-007
  for (const r of rec.reqs) if (r.examples.length === 0) add(r.file, r.line, 'error', 'T001');
  for (const o of rec.opens) for (const n of o.tested) add(o.file, n, 'error', 'T003');

  // REQ-CK-006
  if (rec.spec && rec.spec.text !== null && holdsObligation(rec.spec.text.split(LINES))) {
    add(rec.spec.file, rec.spec.line, 'error', 'T004');
  }
  for (const h of [...rec.sections, ...rec.notes]) {
    if (h.text !== null && holdsObligation(h.text.split(LINES))) add(h.file, h.line, 'error', 'T004');
  }
  for (const dec of rec.decisions) {
    if (dec.text !== null && holdsObligation(dec.text.split(LINES))) add(dec.file, dec.line, 'error', 'T004');
    for (const alt of dec.rejected) {
      if (holdsObligation(alt.split(LINES))) add(dec.file, dec.line, 'error', 'T004');
    }
  }
  for (const op of rec.ops) {
    if (op.result !== null && holdsObligation([op.result])) add(op.file, op.line, 'error', 'T004');
  }
  for (const c of rec.errorsClauses) {
    if (holdsObligation(c.lines)) add(rec.errorsFile, c.line, 'error', 'T004');
  }
  for (const o of rec.opens) {
    if (o.text !== null && holdsObligation(o.text.split(LINES))) add(o.file, o.line, 'warning', 'T014');
  }

  // REQ-CK-008
  const codes = [...new Set(rec.errorsCodes)];
  for (const r of rec.reqs) {
    if (r.text === null || codes.length < 2) continue;
    const named = codes.filter((c) =>
      new RegExp('(?<![A-Za-z0-9_-])' + escapeRe(c) + '(?![A-Za-z0-9_-])').test(r.text as string),
    );
    if (named.length >= 2 && PHRASES.test(r.text)) add(r.file, r.textLine, 'error', 'T005');
  }

  // REQ-CK-003, REQ-CK-009
  const cited = new Set<string>();
  for (const r of rec.reqs) {
    for (const id of new Set(r.decisions)) {
      cited.add(id);
      const dec = firstDec.get(id);
      if (!dec) {
        add(r.file, r.line, 'error', 'T008');
        continue;
      }
      const word = dec.status === null ? 'accepted' : /^\S*/.exec(dec.status)![0];
      if (word === 'contested' || word === 'superseded' || word === 'rejected') {
        add(r.file, r.line, 'error', 'T028');
      } else if (word === 'observed' || word === 'inferred' || word === 'proposed') {
        add(r.file, r.line, 'warning', 'T028');
      }
    }
  }
  for (const dec of rec.decisions) {
    if (!cited.has(dec.id)) add(dec.file, dec.line, 'warning', 'T012');
    if (dec.source === null || dec.source === '') add(dec.file, dec.line, 'warning', 'T013');
    if (dec.status !== null) {
      const word = /^\S*/.exec(dec.status)![0];
      let ok = STATUS_WORDS.includes(word);
      if (ok && word === 'superseded') {
        const m = /^superseded by (\S+)$/.exec(dec.status);
        ok = m !== null && seenDec.has(m[1]);
      }
      if (!ok) add(dec.file, dec.line, 'error', 'T027');
    }
  }

  // REQ-CK-004, REQ-CK-005
  const declared = new Set(rec.errorsCodes);
  let anyExample = false;
  const toRun: { ex: Example; id: string; line: string; solo: boolean }[] = [];
  for (const r of rec.reqs) {
    r.examples.forEach((ex, i) => {
      anyExample = true;
      const expectsError = ex.expects.some((e) => e.path === 'error');
      const op = ex.op !== null ? ops.get(ex.op) : undefined;
      if (!ex.raw && !expectsError) {
        if (!op) {
          add(ex.file, ex.line, 'error', 'T009');
        } else {
          for (const f of op.fields) {
            if (!f.optional && !ex.inputKeys.includes(f.name)) add(ex.file, ex.line, 'error', 'T010');
          }
          for (const k of ex.inputKeys) {
            if (!op.fields.some((f) => f.name === k)) add(ex.file, ex.line, 'warning', 'T011');
          }
        }
      }
      for (const e of ex.expects) {
        if (e.path !== 'error' || e.kind === 'oracle') continue;
        if (e.kind === 'approx' || typeof e.value !== 'string' || !declared.has(e.value)) {
          add(ex.file, e.line, 'error', 'T023');
        }
      }
      if (ex.raw || expectsError || op) {
        const id = `${r.id}#${i + 1}`;
        toRun.push({ ex, id, line: buildLine(ex, id, rec.spec, op), solo: isSolo(ex) });
      }
    });
  }

  // REQ-OR-001 to REQ-OR-008
  const responses = new Map<Example, Obj | null>();
  if (anyExample && !rec.oracle) {
    add(rec.spec!.file, rec.spec!.line, 'error', 'T019');
  } else if (rec.oracle && toRun.length > 0) {
    const oracle = rec.oracle;
    const root = materialize(rec.files);
    try {
      const cwd = join(root, dirname(oracle.file) === '.' ? '' : dirname(oracle.file));
      const batch = toRun.filter((t) => !t.solo);
      if (batch.length > 0) {
        const run = runOracle(oracle.command, cwd, batch.map((t) => t.line));
        if (run.failed) add(oracle.file, oracle.line, 'error', 'T020');
        const byId = responsesById(run.lines);
        for (const t of batch) responses.set(t.ex, byId.get(t.id) ?? null);
      }
      for (const t of toRun.filter((x) => x.solo)) {
        const run = runOracle(oracle.command, cwd, [t.line]);
        if (run.failed) add(t.ex.file, t.ex.line, 'error', 'T020');
        responses.set(t.ex, soloResponse(run.lines));
      }
    } finally {
      cleanup(root);
    }
    for (const t of toRun) {
      const ex = t.ex;
      const resp = responses.get(ex) ?? null;
      if (resp === null) {
        add(ex.file, ex.line, 'error', 'T021');
        continue;
      }
      if (hasOwn(resp, 'oracle_error')) {
        add(ex.file, ex.line, 'error', 'T022');
        continue;
      }
      for (const e of ex.expects) {
        const g = getPath(resp, e.path);
        if (e.kind === 'oracle') {
          if (!g.found) add(ex.file, e.line, 'error', 'T025');
        } else if (e.kind === 'eq') {
          if (!g.found || !deepEqual(g.value, e.value)) add(ex.file, e.line, 'error', 'T002');
        } else if (
          !g.found ||
          typeof g.value !== 'number' ||
          !(Math.abs(g.value - (e.value as number)) <= (e.tol as number))
        ) {
          add(ex.file, e.line, 'error', 'T002');
        }
      }
      if (hasOwn(resp, 'error') && ex.expects.length === 0) add(ex.file, ex.line, 'warning', 'T024');
    }
  }
  return { diags, responses, ops };
}
