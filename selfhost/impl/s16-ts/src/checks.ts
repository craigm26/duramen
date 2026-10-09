// The checks of a record that was read without errors (REQ-CK-001 to REQ-CK-009, REQ-OR-001).

import type { Diag, Example, Level, Op, RecordModel } from './model.ts';
import { hasOwn } from './util.ts';

const STATUS_WORDS = new Set(['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected']);
const WITHDRAWN = new Set(['contested', 'superseded', 'rejected']);
const WEAK = new Set(['observed', 'inferred', 'proposed']);

/** The first operation of each name (REQ-CK-002). */
export function firstOps(rec: RecordModel): Map<string, Op> {
  const m = new Map<string, Op>();
  for (const op of rec.ops) if (op.name !== undefined && !m.has(op.name)) m.set(op.name, op);
  return m;
}

/** An example that expects an error: an expectation whose path is `error` itself. */
export function expectsError(ex: Example): boolean {
  return ex.expects.some((e) => e.path === 'error');
}

export function allExamples(rec: RecordModel): Example[] {
  return rec.reqs.flatMap((r) => r.examples);
}

export function runCheck(rec: RecordModel, diags: Diag[]): void {
  const d = (file: string, line: number, code: string, level: Level = 'error') =>
    diags.push({ file, line, level, code });
  const ops = firstOps(rec);

  // T001
  for (const r of rec.reqs) if (r.examples.length === 0) d(r.file, r.line, 'T001');

  // T003
  for (const o of rec.openExamples) d(o.file, o.line, 'T003');

  // T007
  const unique = (items: { file: string; line: number; id: string | undefined }[]) => {
    const seen = new Set<string>();
    for (const it of items) {
      if (it.id === undefined) continue;
      if (seen.has(it.id)) d(it.file, it.line, 'T007');
      seen.add(it.id);
    }
  };
  unique(rec.reqs);
  unique(rec.opens);
  unique(rec.decisions);
  unique(rec.ops.map((o) => ({ file: o.file, line: o.line, id: o.name })));

  // T008, T028
  const declared = new Map<string, (typeof rec.decisions)[number]>();
  for (const dec of rec.decisions) if (!declared.has(dec.id)) declared.set(dec.id, dec);
  const cited = new Set<string>();
  for (const r of rec.reqs) {
    for (const id of new Set(r.cited)) {
      cited.add(id);
      const dec = declared.get(id);
      if (!dec) {
        d(r.file, r.line, 'T008');
        continue;
      }
      const word = /^\S*/.exec(dec.status ?? 'accepted')![0];
      if (WITHDRAWN.has(word)) d(r.file, r.line, 'T028');
      else if (WEAK.has(word)) d(r.file, r.line, 'T028', 'warning');
    }
  }

  // T012, T013, T027
  for (const dec of rec.decisions) {
    if (!cited.has(dec.id)) d(dec.file, dec.line, 'T012', 'warning');
    if (!dec.hasSource) d(dec.file, dec.line, 'T013', 'warning');
    if (dec.status !== undefined) {
      const word = /^\S*/.exec(dec.status)![0];
      let ok = STATUS_WORDS.has(word);
      if (ok && word === 'superseded') {
        const m = /^superseded by (\S+)$/.exec(dec.status);
        ok = m !== null && declared.has(m[1]);
      }
      if (!ok) d(dec.file, dec.line, 'T027');
    }
  }

  // T004, T014
  for (const t of rec.prose) {
    if (holdsObligation(t.lines)) d(t.file, t.line, t.code, t.code === 'T014' ? 'warning' : 'error');
  }

  // T005
  const codes = [...new Set(rec.codes)];
  for (const r of rec.reqs) {
    if (r.text && ordersErrors(r.text.lines.join('\n'), codes)) d(r.file, r.text.line, 'T005');
  }

  // T009, T010, T011, T023
  const declaredCodes = new Set(rec.codes);
  for (const ex of allExamples(rec)) {
    if (!ex.raw && !expectsError(ex)) {
      const op = ops.get(ex.op!);
      if (!op) d(ex.file, ex.line, 'T009');
      else {
        for (const [name, optional] of op.fields) if (!optional && !hasOwn(ex.input, name)) d(ex.file, ex.line, 'T010');
        for (const name of Object.keys(ex.input)) if (!op.fields.has(name)) d(ex.file, ex.line, 'T011', 'warning');
      }
    }
    for (const e of ex.expects) {
      if (e.path !== 'error' || e.kind === 'oracle') continue;
      if (e.kind === 'approx' || typeof e.value !== 'string' || !declaredCodes.has(e.value)) d(ex.file, e.line, 'T023');
    }
  }

  // T019
  if (!rec.oracle && rec.spec && allExamples(rec).length > 0) d(rec.spec.file, rec.spec.line, 'T019');
}

const OBLIGATION = /(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])/;
const QUOTES: Record<string, string> = { '"': '"', '“': '”', '`': '`' };

/** True when a text states an obligation outside quotations (REQ-CK-006). */
export function holdsObligation(lines: string[]): boolean {
  return lines.some((line) => OBLIGATION.test(unquoted(line)));
}

/** A line with each quotation on it replaced by a space. */
function unquoted(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const close = hasOwn(QUOTES, line[i]) ? QUOTES[line[i]] : undefined;
    if (close !== undefined) {
      const j = line.indexOf(close, i + 1);
      if (j >= 0) {
        out += ' ';
        i = j + 1;
        continue;
      }
    }
    out += line[i++];
  }
  return out;
}

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
);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

/** True when a requirement's text restates the order of errors (REQ-CK-008). */
export function ordersErrors(text: string, codes: string[]): boolean {
  let named = 0;
  for (const code of codes) {
    if (new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(code)}(?![A-Za-z0-9_-])`).test(text)) named++;
  }
  if (named < 2) return false;
  const lower = text.replace(/[A-Z]/g, (c) => c.toLowerCase());
  return ORDER_PHRASE.test(lower);
}
