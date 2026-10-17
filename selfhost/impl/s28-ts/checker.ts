import { atPath, holds, own } from './comparison.ts';
import { diagnostic } from './model.ts';
import type { Example, RecordModel, Statement } from './model.ts';
import { parseRecord } from './parser.ts';
import { runOracle } from './oracle.ts';

export function obligation(text = ''): boolean {
  return text.split(/\r\n|\r|\n/).some(line => {
    const unquoted = line.replace(/"[^"\r\n]*"|“[^”\r\n]*”|`[^`\r\n]*`/g, ' ');
    return /(^|[^A-Za-z0-9_])(MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])/.test(unquoted);
  });
}
function regexEscape(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function repeatsOrder(text: string, codes: string[]): boolean {
  const named = codes.filter(code => new RegExp('(^|[^A-Za-z0-9_-])' + regexEscape(code) + '(?![A-Za-z0-9_-])').test(text));
  return named.length >= 2 && /(^|[^A-Za-z0-9_])(?:in\s+this\s+order|in\s+the\s+order|first\s+that\s+applies|first\s+match|precede|precedes|preceded|before|after|take\s+precedence|takes\s+precedence)(?![A-Za-z0-9_])/i.test(text);
}
function firstOf(r: RecordModel, kind: string): Map<string, Statement> {
  const map = new Map<string, Statement>();
  for (const s of r.statements.filter(s => s.key === kind)) {
    if (map.has(s.id)) diagnostic(r, s, 'T007');
    else map.set(s.id, s);
  }
  return map;
}

export function requestLine(r: RecordModel, op: Statement | undefined, e: Example): string {
  if (e.raw !== undefined) { e.solo = true; return e.raw; }
  const extra = Object.assign(Object.create(null), op?.request ?? r.spec?.request ?? {}, e.request ?? {});
  const members: string[] = [];
  if (!e.omit.has('id')) members.push('"id":' + JSON.stringify(e.id)); else e.solo = true;
  if (!e.omit.has('op')) members.push('"op":' + JSON.stringify(e.op));
  for (const key of Object.keys(extra)) if (!e.omit.has(key)) members.push(JSON.stringify(key) + ':' + JSON.stringify(extra[key]));
  if (!e.omit.has('input') && (e.inputText !== undefined || e.inputLines)) {
    members.push('"input":' + (e.inputLines ? JSON.stringify(e.input) : e.inputText));
  }
  return '{' + members.join(',') + '}';
}

export function checkRecord(files: Record<string, string>, entry = '.'): { model: RecordModel; result: any; cases: any[] } {
  const r = parseRecord(files, entry);
  let suite: any[] = [];
  if (!r.diagnostics.some(d => d.level === 'error' && d.code.startsWith('P'))) {
    const requirements = r.statements.filter(s => s.key === 'req');
    firstOf(r, 'req'); firstOf(r, 'open');
    const decisions = firstOf(r, 'decision'), operations = firstOf(r, 'op');
    const cited = new Set(requirements.flatMap(s => [...s.citations]));
    const codes = [...new Set(r.errors?.conditions.map(c => c.code) ?? [])];
    const statuses = new Set(['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected']);
    for (const s of r.statements) {
      if ((s.key === 'spec' && s !== r.spec) || (s.key === 'oracle' && s !== r.oracle) || (s.key === 'errors' && s !== r.errors)) continue;
      if (['spec', 'section', 'note', 'decision', 'open'].includes(s.key) && obligation(s.text)) diagnostic(r, s, s.key === 'open' ? 'T014' : 'T004', s.key === 'open' ? 'warning' : 'error');
      if (s.key === 'op' && obligation(s.result)) diagnostic(r, s, 'T004');
      if (s.key === 'errors') for (const c of s.conditions) if (obligation(c.text)) diagnostic(r, c, 'T004');
      if (s.key === 'open') for (const c of s.clauses) if (c.key === 'example' || c.key === 'table') diagnostic(r, c, 'T003');
      if (s.key === 'decision') {
        for (const text of s.rejected) if (obligation(text)) diagnostic(r, s, 'T004');
        if (!cited.has(s.id)) diagnostic(r, s, 'T012', 'warning');
        if (!s.source) diagnostic(r, s, 'T013', 'warning');
        if (s.status !== undefined) {
          const status = s.status.split(/\s/)[0];
          if (!statuses.has(status) || (status === 'superseded' && (!/^superseded by \S+$/.test(s.status) || !decisions.has(s.status.slice(14))))) diagnostic(r, s, 'T027');
        }
      }
      if (s.key === 'req') {
        if (!s.examples.length) diagnostic(r, s, 'T001');
        if (s.text && repeatsOrder(s.text, codes)) diagnostic(r, { file: s.file, line: s.textLine! }, 'T005');
        for (const id of s.citations) {
          const d = decisions.get(id);
          if (!d) diagnostic(r, s, 'T008');
          else {
            const status = d.status === undefined ? 'accepted' : d.status.split(/\s/)[0];
            if (['contested', 'superseded', 'rejected'].includes(status)) diagnostic(r, s, 'T028');
            else if (['observed', 'inferred', 'proposed'].includes(status)) diagnostic(r, s, 'T028', 'warning');
          }
        }
      }
    }
    const all: Example[] = [], runnable: Example[] = [];
    for (const req of requirements) req.examples.forEach((e, index) => {
      e.id = req.id + '#' + (index + 1);
      const raw = e.raw !== undefined;
      const op = raw ? undefined : operations.get(e.op);
      const errorExpected = e.expectations.some(exp => exp.path === 'error');
      if (!raw && !errorExpected) {
        if (!op) diagnostic(r, e, 'T009');
        else {
          for (const [field, optional] of op.fields) if (!optional && !own(e.input, field)) diagnostic(r, e, 'T010');
          for (const field of Object.keys(e.input)) if (!op.fields.has(field)) diagnostic(r, e, 'T011', 'warning');
        }
      }
      for (const exp of e.expectations) if (exp.path === 'error' && exp.kind !== 'oracle' && (typeof exp.value !== 'string' || !codes.includes(exp.value))) diagnostic(r, exp, 'T023');
      e.requestLine = requestLine(r, op, e);
      all.push(e);
      if (raw || errorExpected || op) runnable.push(e);
    });
    if (all.length && !r.oracle) diagnostic(r, r.spec!, 'T019');
    else {
      runOracle(r, runnable);
      for (const e of runnable) {
        if (e.response === undefined) { diagnostic(r, e, 'T021'); continue; }
        if (own(e.response, 'oracle_error')) { diagnostic(r, e, 'T022'); continue; }
        if (own(e.response, 'error') && !e.expectations.length) diagnostic(r, e, 'T024', 'warning');
        for (const exp of e.expectations) {
          if (exp.kind === 'oracle') {
            exp.value = atPath(e.response, exp.path);
            if (exp.value === undefined) diagnostic(r, exp, 'T025');
          } else if (!holds(e.response, exp)) diagnostic(r, exp, 'T002');
        }
      }
    }
    if (!r.diagnostics.some(d => d.level === 'error')) {
      suite = requirements.flatMap(req => req.examples.map(e => {
        const op = e.raw === undefined ? operations.get(e.op) : undefined;
        const response = e.response;
        const full: any = { members: Object.keys(response).sort(), tolerances: Object.fromEntries(op?.tolerances ?? []) };
        for (const key of ['error', 'result']) if (own(response, key)) full[key] = response[key];
        if (op?.audit && typeof response.audit === 'string') full.audit = response.audit;
        const checks = e.expectations.map(exp => ({ path: exp.path, kind: exp.kind === 'oracle' ? 'eq' : exp.kind, value: exp.value,
          ...(exp.kind === 'approx' ? { tol: exp.tol } : {}), ...(exp.kind === 'oracle' ? { from: 'oracle' } : {}) }));
        return { id: e.id, kind: 'example', reqs: ['REQ-' + req.id], platform: req.platform, line: e.requestLine, ...(e.solo ? { solo: true } : {}), checks, full };
      }));
    }
  }
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const levels = { error: 0, warning: 1, info: 2 };
  r.diagnostics.sort((a, b) => compare(a.file, b.file) || a.line - b.line || compare(a.code, b.code) || levels[a.level] - levels[b.level]);
  const result = { diagnostics: r.diagnostics.map(d => `${d.file}:${d.line}: ${d.level} ${d.code}`), errors: r.diagnostics.filter(d => d.level === 'error').length, warnings: r.diagnostics.filter(d => d.level === 'warning').length };
  return { model: r, result, cases: suite };
}
