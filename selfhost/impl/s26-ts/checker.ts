import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { absent, compare, json, meets, object, own, readPath } from './values.ts';
import { diagnostic, parse } from './parser.ts';
import type { Example, RecordData, Statement } from './parser.ts';

function obligations(text = ''): boolean {
  const unquoted = text.replace(/\r\n|\r/g, '\n').replace(/"[^"\n]*"|“[^”\n]*”|`[^`\n]*`/g, match => ' '.repeat(match.length));
  return /(^|[^A-Za-z0-9_])(MUST|SHALL|REQUIRED)(?=$|[^A-Za-z0-9_])/.test(unquoted);
}
function firstById(statements: Statement[]): Map<string, Statement> {
  const map = new Map<string, Statement>();
  for (const s of statements) if (!map.has(s.id)) map.set(s.id, s);
  return map;
}
function expectsError(e: Example): boolean { return e.checks.some(c => c.path === 'error'); }
function checkSemantics(r: RecordData): void {
  const requirements = r.statements.filter(s => s.kind === 'req');
  const decisions = r.statements.filter(s => s.kind === 'decision');
  const decisionMap = firstById(decisions);
  const operations = firstById(r.statements.filter(s => s.kind === 'op'));
  const cited = new Set(requirements.flatMap(s => s.decisions));
  const errorCodes = new Set(r.conditions.map(c => c.code));
  for (const kind of ['req', 'open', 'decision', 'op']) {
    const seen = new Set<string>();
    for (const s of r.statements.filter(s => s.kind === kind)) {
      if (seen.has(s.id)) diagnostic(r, s, 'T007'); else seen.add(s.id);
    }
  }
  for (const s of r.statements) {
    if (s.kind !== 'req' && obligations(s.text)) diagnostic(r, s, s.kind === 'open' ? 'T014' : 'T004', s.kind === 'open' ? 'warning' : 'error');
    if (s.kind === 'op' && obligations(s.result)) diagnostic(r, s, 'T004');
    for (const alternative of s.rejected) if (obligations(alternative)) diagnostic(r, s, 'T004');
    for (const loc of s.openTests) diagnostic(r, loc, 'T003');
  }
  for (const condition of r.conditions) if (obligations(condition.text)) diagnostic(r, condition.loc, 'T004');
  for (const d of decisions) {
    if (!cited.has(d.id)) diagnostic(r, d, 'T012', 'warning');
    if (!d.source) diagnostic(r, d, 'T013', 'warning');
    if (d.status !== undefined) {
      const status = d.status.split(/\s/)[0];
      const superseded = /^superseded by (\S+)$/.exec(d.status);
      if (!['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected'].includes(status) ||
        status === 'superseded' && (!superseded || !decisionMap.has(superseded[1]))) diagnostic(r, d, 'T027');
    }
  }
  for (const req of requirements) {
    if (!req.examples.length) diagnostic(r, req, 'T001');
    for (const id of new Set(req.decisions)) {
      const d = decisionMap.get(id);
      if (!d) diagnostic(r, req, 'T008');
      else {
        const status = d.status?.split(/\s/)[0] ?? 'accepted';
        if (['contested', 'superseded', 'rejected'].includes(status)) diagnostic(r, req, 'T028');
        else if (['observed', 'inferred', 'proposed'].includes(status)) diagnostic(r, req, 'T028', 'warning');
      }
    }
    if (req.text) {
      const named = [...errorCodes].filter(code => {
        const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp('(^|[^A-Za-z0-9_-])' + escaped + '(?=$|[^A-Za-z0-9_-])').test(req.text!);
      });
      const phrases = /(^|[^A-Za-z0-9_])(?:in\s+this\s+order|in\s+the\s+order|first\s+that\s+applies|first\s+match|precede|precedes|preceded|before|after|take\s+precedence|takes\s+precedence)(?=$|[^A-Za-z0-9_])/i;
      if (named.length >= 2 && phrases.test(req.text)) diagnostic(r, req.textLine!, 'T005');
    }
    req.examples.forEach((e, i) => {
      e.id = req.id + '#' + (i + 1);
      for (const check of e.checks) {
        if (check.path === 'error' && check.from !== 'oracle' && (typeof check.value !== 'string' || !errorCodes.has(check.value))) diagnostic(r, check, 'T023');
      }
      if (!e.rawMode && !expectsError(e)) {
        const op = operations.get(e.op);
        if (!op) diagnostic(r, e, 'T009');
        else {
          for (const [name, optional] of op.fields) if (!optional && !own(e.input, name)) diagnostic(r, e, 'T010');
          for (const name of Object.keys(e.input)) if (!op.fields.has(name)) diagnostic(r, e, 'T011', 'warning');
        }
      }
    });
  }
  if (requirements.some(req => req.examples.length) && !r.oracle) diagnostic(r, r.spec!, 'T019');
}
export function commandWords(command: string): string[] | undefined {
  const words: string[] = [];
  let word = '', active = false, quote = '';
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = '';
      else if (quote === '"' && c === '\\' && command[i + 1] === '"') { word += '"'; i++; }
      else word += c;
    } else if (c === '"' || c === "'") { quote = c; active = true; }
    else if (c === ' ' || c === '\t') {
      if (active) { words.push(word); word = ''; active = false; }
    } else { word += c; active = true; }
  }
  if (quote) return;
  if (active) words.push(word);
  return words.length ? words : undefined;
}
function requestLine(r: RecordData, e: Example, op?: Statement): string {
  if (e.rawMode) { e.solo = true; return e.raw!; }
  const members = { ...(op?.request ?? r.spec?.request ?? {}), ...(e.request ?? {}) };
  const result: string[] = [];
  if (!e.omit.includes('id')) result.push('"id":' + JSON.stringify(e.id)); else e.solo = true;
  if (!e.omit.includes('op')) result.push('"op":' + JSON.stringify(e.op));
  for (const [key, value] of Object.entries(members)) if (!e.omit.includes(key)) result.push(JSON.stringify(key) + ':' + JSON.stringify(value));
  if (!e.omit.includes('input') && (e.inputText !== undefined || e.modified)) result.push('"input":' + (e.modified ? JSON.stringify(e.input) : e.inputText));
  return '{' + result.join(',') + '}';
}
function runOracle(r: RecordData): void {
  if (!r.oracle) return;
  const operations = firstById(r.statements.filter(s => s.kind === 'op'));
  const examples = r.statements.filter(s => s.kind === 'req').flatMap(s => s.examples)
    .filter(e => e.rawMode || expectsError(e) || operations.has(e.op));
  if (!examples.length) return;
  for (const e of examples) e.lineText = requestLine(r, e, e.rawMode ? undefined : operations.get(e.op));
  const command = commandWords(r.oracle.rest);
  const root = fs.mkdtempSync(path.join(process.cwd(), '.duramen-'));
  const ioRoot = fs.mkdtempSync(path.join(process.cwd(), '.duramen-io-'));
  try {
    for (const [name, text] of Object.entries(r.files)) {
      const target = path.join(root, name);
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text, 'utf8');
    }
    const execute = (group: Example[], solo: boolean): void => {
      if (!group.length) return;
      let output = '', failed = true;
      if (command) {
        const inputFile = path.join(ioRoot, 'stdin'), outputFile = path.join(ioRoot, 'stdout'), errorFile = path.join(ioRoot, 'stderr');
        fs.writeFileSync(inputFile, group.map(e => e.lineText + '\n').join(''), 'utf8');
        const descriptors = [fs.openSync(inputFile, 'r'), fs.openSync(outputFile, 'w'), fs.openSync(errorFile, 'w')];
        try {
          const run = spawnSync(command[0], command.slice(1), {
            cwd: path.join(root, path.posix.dirname(r.oracle!.file)),
            stdio: descriptors, timeout: 5000, windowsHide: true, shell: false,
          });
          failed = Boolean(run.error || run.signal || run.status !== 0);
        } finally { for (const descriptor of descriptors) fs.closeSync(descriptor); }
        output = fs.readFileSync(outputFile, 'utf8');
      }
      if (failed) diagnostic(r, solo ? group[0] : r.oracle!, 'T020');
      const lines = output.split('\n').filter(line => !/^\s*$/.test(line));
      if (solo) {
        if (lines.length === 1) { const response = json(lines[0]); if (object(response)) group[0].response = response; }
      } else {
        const responses = new Map<string, any>();
        for (const line of lines) {
          const response = json(line);
          if (object(response) && typeof response.id === 'string' && !responses.has(response.id)) responses.set(response.id, response);
        }
        for (const e of group) if (responses.has(e.id!)) e.response = responses.get(e.id!);
      }
    };
    execute(examples.filter(e => !e.solo), false);
    for (const e of examples.filter(e => e.solo)) execute([e], true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(ioRoot, { recursive: true, force: true });
  }
  for (const e of examples) {
    if (e.response === undefined) { diagnostic(r, e, 'T021'); continue; }
    if (own(e.response, 'oracle_error')) { diagnostic(r, e, 'T022'); continue; }
    if (own(e.response, 'error') && !e.checks.length) diagnostic(r, e, 'T024', 'warning');
    for (const check of e.checks) {
      if (check.from === 'oracle') {
        const value = readPath(e.response, check.path);
        if (value === absent) diagnostic(r, check, 'T025'); else check.value = value;
      } else if (!meets(check, e.response)) diagnostic(r, check, 'T002');
    }
  }
}
export function analyze(files: Record<string, string>, entry = '.'): RecordData {
  const r = parse(files, entry);
  if (!r.diagnostics.some(d => d.level === 'error' && d.code.startsWith('P'))) { checkSemantics(r); runOracle(r); }
  r.diagnostics.sort((a, b) => compare(a.file, b.file) || a.line - b.line || compare(a.code, b.code) || compare(a.level, b.level));
  return r;
}
export function checkResult(r: RecordData): any {
  return {
    diagnostics: r.diagnostics.map(d => `${d.file}:${d.line}: ${d.level} ${d.code}`),
    errors: r.diagnostics.filter(d => d.level === 'error').length,
    warnings: r.diagnostics.filter(d => d.level === 'warning').length,
  };
}
export function casesResult(r: RecordData): any {
  const errors = checkResult(r).errors;
  if (errors) return { errors, cases: [] };
  const operations = firstById(r.statements.filter(s => s.kind === 'op'));
  const cases: any[] = [];
  for (const req of r.statements.filter(s => s.kind === 'req')) for (const e of req.examples) {
    const op = e.rawMode ? undefined : operations.get(e.op);
    const response = e.response;
    const full: any = { members: Object.keys(response).sort(compare), tolerances: op?.tolerances ?? {} };
    if (own(response, 'error')) full.error = response.error;
    if (own(response, 'result')) full.result = response.result;
    if (op?.audit && typeof response.audit === 'string') full.audit = response.audit;
    cases.push({
      id: e.id, kind: 'example', reqs: ['REQ-' + req.id], platform: req.platform, line: e.lineText,
      ...(e.solo ? { solo: true } : {}),
      checks: e.checks.map(c => ({ path: c.path, kind: c.kind, value: c.value, ...(c.tol === undefined ? {} : { tol: c.tol }), ...(c.from ? { from: c.from } : {}) })),
      full,
    });
  }
  return { errors: 0, cases };
}
