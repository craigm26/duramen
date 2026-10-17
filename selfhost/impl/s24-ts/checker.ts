import { parseRecord, add } from './parser.ts';
import type { RecordModel, Statement, Example } from './parser.ts';
import { makeRequest, runOracle } from './oracle.ts';
import { atPath, compare, dict, meets, missing, own } from './values.ts';

function unquoted(text: string): string {
  // A space in place of a quotation keeps words on its two sides separate.
  return text.split(/\r\n|\r|\n/).map(line => line.replace(/"[^"\r\n]*"|“[^”\r\n]*”|\x60[^\x60\r\n]*\x60/g, ' ')).join('\n');
}
function obligation(text = ''): boolean { return /(^|[^a-zA-Z0-9_])(MUST|SHALL|REQUIRED)(?![a-zA-Z0-9_])/.test(unquoted(text)); }
function escapeRegex(text: string): string { return text.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&'); }
function hasCode(text: string, code: string): boolean {
  return new RegExp('(^|[^a-zA-Z0-9_-])' + escapeRegex(code) + '(?![a-zA-Z0-9_-])').test(text);
}
function repeatedOrder(text: string, codes: Set<string>): boolean {
  if ([...codes].filter(code => hasCode(text,code)).length < 2) return false;
  return /(^|[^a-zA-Z0-9_])(?:in\s+this\s+order|in\s+the\s+order|first\s+that\s+applies|first\s+match|precede|precedes|preceded|before|after|take\s+precedence|takes\s+precedence)(?![a-zA-Z0-9_])/i.test(text);
}
const states = new Set(['observed','inferred','proposed','accepted','contested','superseded','rejected']);
function status(s: Statement): string {
  const first = s.status?.split(/\s/)[0] ?? 'accepted';
  return states.has(first) ? first : 'accepted';
}
function staticCheck(r: RecordModel): Map<string,Statement> {
  const kinds = new Map<string,Map<string,Statement>>();
  for (const kind of ['req','open','decision','op']) kinds.set(kind,new Map());
  for (const s of r.statements) {
    const ids = kinds.get(s.kind);
    if (ids) {
      if (ids.has(s.id!)) add(r,s,'T007');
      else ids.set(s.id!,s);
    }
  }
  const decisions = kinds.get('decision')!, ops = kinds.get('op')!;
  const cited = new Set(r.statements.filter(s => s.kind === 'req').flatMap(s => s.citations));
  for (const s of r.statements) {
    if (['spec','section','note','decision'].includes(s.kind) && obligation(s.text)) add(r,s,'T004');
    if (s.kind === 'open') {
      if (obligation(s.text)) add(r,s,'T014','warning');
      for (const c of s.clauses) if (['example','table'].includes(c.key)) add(r,c,'T003');
    }
    if (s.kind === 'op' && obligation(s.result)) add(r,s,'T004');
    if (s.kind === 'errors' && s === r.errors) for (const c of s.clauses) if (obligation((c as any).condition)) add(r,c,'T004');
    if (s.kind === 'decision') {
      for (const text of s.rejected) if (obligation(text)) add(r,s,'T004');
      if (!cited.has(s.id!)) add(r,s,'T012','warning');
      if (!s.source) add(r,s,'T013','warning');
      if (s.status !== undefined) {
        const first = s.status.split(/\s/)[0];
        if (!states.has(first) || (first === 'superseded' && (!/^superseded by \S+$/.test(s.status) || !decisions.has(s.status.slice(14))))) add(r,s,'T027');
      }
    }
    if (s.kind !== 'req') continue;
    if (!s.examples.length) add(r,s,'T001');
    for (const id of new Set(s.citations)) {
      const decision = decisions.get(id);
      if (!decision) { add(r,s,'T008'); continue; }
      const state = status(decision);
      if (['contested','superseded','rejected'].includes(state)) add(r,s,'T028');
      else if (['observed','inferred','proposed'].includes(state)) add(r,s,'T028','warning');
    }
    if (s.text && repeatedOrder(s.text,r.errorCodes)) add(r,{file:s.file,line:s.textLine!},'T005');
    for (const e of s.examples) {
      const expectsError = e.checks.some(c => c.path === 'error');
      if (!e.isRaw && !expectsError) {
        const op = ops.get(e.op);
        if (!op) add(r,e,'T009');
        else {
          for (const [field,optional] of op.fields) if (!optional && !own(e.input,field)) add(r,e,'T010');
          for (const field of Object.keys(e.input ?? {})) if (!op.fields.has(field)) add(r,e,'T011','warning');
        }
      }
      for (const c of e.checks) if (c.path === 'error' && c.from !== 'oracle' && (typeof c.value !== 'string' || !r.errorCodes.has(c.value))) add(r,c,'T023');
    }
  }
  return ops;
}
function full(e: Example, op?: Statement): any {
  const answer = e.answer;
  if (answer === undefined) return null;
  const f: any = { members:Object.keys(answer).sort(), tolerances:op?.tolerances ?? dict() };
  if (own(answer,'error')) f.error = answer.error;
  if (own(answer,'result')) f.result = answer.result;
  if (op?.audit && typeof answer.audit === 'string') f.audit = answer.audit;
  return f;
}
function diagnostics(r: RecordModel): any {
  const order = {error:0,warning:1,info:2};
  r.diagnostics.sort((a,b) => compare(a.file,b.file) || a.line-b.line || compare(a.code,b.code) || order[a.level]-order[b.level]);
  return {
    diagnostics:r.diagnostics.map(d => d.file + ':' + d.line + ': ' + d.level + ' ' + d.code),
    errors:r.diagnostics.filter(d => d.level === 'error').length,
    warnings:r.diagnostics.filter(d => d.level === 'warning').length
  };
}
export async function analyze(files: Record<string,string>, entry = '.'): Promise<{ check: any; cases: any }> {
  const r = parseRecord(files,entry);
  if (r.diagnostics.some(d => d.level === 'error')) {
    const check = diagnostics(r); return {check,cases:{errors:check.errors,cases:[]}};
  }
  const ops = staticCheck(r);
  const requirements = r.statements.filter(s => s.kind === 'req');
  const examples: Example[] = [];
  for (const req of requirements) req.examples.forEach((e,i) => {
    e.id = req.id + '#' + (i+1);
    makeRequest(e,r.spec!,e.isRaw ? undefined : ops.get(e.op));
    if (e.isRaw || ops.has(e.op) || e.checks.some(c => c.path === 'error')) examples.push(e);
  });
  if (requirements.some(req => req.examples.length) && !r.oracle) add(r,r.spec!,'T019');
  else if (r.oracle) {
    await runOracle(r,examples);
    for (const e of examples) {
      if (e.answer === undefined) { add(r,e,'T021'); continue; }
      if (own(e.answer,'oracle_error')) { add(r,e,'T022'); continue; }
      if (own(e.answer,'error') && !e.checks.length) add(r,e,'T024','warning');
      for (const c of e.checks) {
        if (c.from === 'oracle') {
          const value = atPath(e.answer,c.path);
          if (value === missing) add(r,c,'T025');
          else c.value = value;
        } else if (!meets(c,e.answer)) add(r,c,'T002');
      }
    }
  }
  const check = diagnostics(r);
  const cases: any[] = [];
  if (!check.errors) for (const req of requirements) for (const e of req.examples) {
    const checks = e.checks.map(({file,line,...check}) => check);
    const c: any = {id:e.id,kind:'example',reqs:['REQ-' + req.id],platform:req.platform,line:e.requestLine,checks,full:full(e,e.isRaw ? undefined : ops.get(e.op))};
    if (e.solo) c.solo = true;
    cases.push(c);
  }
  return {check,cases:{errors:check.errors,cases}};
}
