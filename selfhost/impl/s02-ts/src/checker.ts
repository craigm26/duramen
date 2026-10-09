import type { Diag, Entries, FileModel, Item, Level, OpM, SpecM } from './types.ts';
import { getPath, jsonEqual } from './json.ts';
import { readFile } from './reader.ts';
import { selectRecord } from './record.ts';
import { Workspace, parseResponses, parseSolo } from './oracle.ts';

type Response = Record<string, unknown>;

export interface Analysis {
  diags: Diag[];
  /** Present when the record has no errors. */
  cases: object[] | null;
}

const LEVEL_ORDER: Record<Level, number> = { error: 0, warning: 1, info: 2 };
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function sortDiags(diags: Diag[]): Diag[] {
  return diags
    .map((d, i) => ({ d, i }))
    .sort((x, y) =>
      cmp(x.d.file, y.d.file) || x.d.line - y.d.line || cmp(x.d.code, y.d.code) ||
      LEVEL_ORDER[x.d.level] - LEVEL_ORDER[y.d.level] || x.i - y.i)
    .map((x) => x.d);
}

const QUOTE_RE = /"[^"]*"|“[^”]*”|`[^`]*`/g;
const OBLIGATION_RE = /(?<![\p{L}\p{N}_])(?:MUST|SHALL|REQUIRED)(?![\p{L}\p{N}_])/u;
const ORDER_RE = new RegExp(
  '(?<![\\p{L}\\p{N}_])(?:in\\s+this\\s+order|in\\s+the\\s+order|first\\s+that\\s+applies|first\\s+match|precedes?|preceded|before|after|takes?\\s+precedence)(?![\\p{L}\\p{N}_])',
  'iu');
const STATUS_RE = /^(observed|inferred|proposed|accepted|contested|superseded|rejected)(?![\p{L}\p{N}_])/u;

function hasObligation(lines: string[]): boolean {
  return lines.some((l) => OBLIGATION_RE.test(l.replace(QUOTE_RE, ' ')));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSolo(item: Item): boolean {
  return item.raw || item.omit.includes('id');
}

function caseId(item: Item): string {
  return `${item.reqId}#${item.n}`;
}

export function buildLine(item: Item, spec: SpecM | null, ops: Map<string, OpM>): string {
  if (item.raw) return item.rawLine;
  const op = ops.get(item.op);
  const base: Entries = op?.request ?? spec?.request ?? [];
  const members = new Map<string, string>();
  members.set('id', JSON.stringify(caseId(item)));
  members.set('op', JSON.stringify(item.op));
  for (const [k, v] of base) members.set(k, JSON.stringify(v));
  for (const [k, v] of item.request) members.set(k, JSON.stringify(v));
  for (const k of item.omit) members.delete(k);
  const parts: string[] = [];
  for (const [k, v] of members) parts.push(`${JSON.stringify(k)}:${v}`);
  if (item.hasInput && !item.omit.includes('input')) {
    parts.push(`"input":${item.inputObj ? JSON.stringify(item.inputObj) : item.inputText}`);
  }
  return `{${parts.join(',')}}`;
}

export function analyze(files: Record<string, string>, entry: string | undefined): Analysis {
  const sel = selectRecord(Object.keys(files), entry);
  if (sel.missing) return { diags: [{ file: sel.name, line: 1, level: 'error', code: 'P046' }], cases: null };

  const models: FileModel[] = sel.files.map((f) => readFile(f, files[f], { files, recordFolder: sel.folder }));
  const diags: Diag[] = models.flatMap((m) => m.diags);
  const rec = (line: number, code: string, level: Level = 'error', file = sel.name) => diags.push({ file, line, level, code });

  const versions = new Set(models.map((m) => m.version).filter((v) => v !== null));
  if (versions.size > 1) rec(1, 'P047');
  const specs = models.flatMap((m) => m.specs);
  if (specs.length === 0) rec(1, 'P021');
  markSecond(specs, 'P044', diags);
  markSecond(models.flatMap((m) => m.oracles), 'P044', diags);
  markSecond(models.flatMap((m) => m.errors), 'P032', diags);

  if (diags.length > 0) return { diags: sortDiags(diags), cases: null };

  const spec = specs[0];
  const oracle = models.flatMap((m) => m.oracles)[0] ?? null;
  const ops = new Map<string, OpM>();
  const allOps = models.flatMap((m) => m.ops);
  const codes = new Set(models.flatMap((m) => m.errors.flatMap((e) => e.clauses.map((c) => c.code))));
  const reqs = models.flatMap((m) => m.reqs);
  const opens = models.flatMap((m) => m.opens);
  const decisions = models.flatMap((m) => m.decisions);
  const tdiag = (file: string, line: number, code: string, level: Level = 'error') => diags.push({ file, line, level, code });

  // T007: duplicate names and IDs
  for (const op of allOps) {
    if (ops.has(op.name)) tdiag(op.file, op.line, 'T007');
    else ops.set(op.name, op);
  }
  for (const group of [reqs, opens, decisions]) {
    const seen = new Set<string>();
    for (const x of group) {
      if (seen.has(x.id)) tdiag(x.file, x.line, 'T007');
      seen.add(x.id);
    }
  }
  const declared = new Map<string, (typeof decisions)[number]>();
  for (const d of decisions) if (!declared.has(d.id)) declared.set(d.id, d);

  // T004 and T014: obligations outside requirements
  for (const s of specs) if (s.text && hasObligation(s.text.lines)) tdiag(s.file, s.line, 'T004');
  for (const m of models) {
    for (const s of [...m.sections, ...m.notes]) if (s.text && hasObligation(s.text.lines)) tdiag(s.file, s.line, 'T004');
    for (const op of m.ops) if (op.result !== null && hasObligation([op.result])) tdiag(op.file, op.line, 'T004');
    for (const e of m.errors) for (const c of e.clauses) if (hasObligation(c.condition)) tdiag(e.file, c.line, 'T004');
    for (const d of m.decisions) {
      if (d.text && hasObligation(d.text.lines)) tdiag(d.file, d.line, 'T004');
      for (const r of d.rejected) if (hasObligation([r])) tdiag(d.file, d.line, 'T004');
    }
    for (const o of m.opens) {
      if (o.text && hasObligation(o.text.lines)) tdiag(o.file, o.line, 'T014', 'warning');
      for (const l of o.reported) tdiag(o.file, l, 'T003');
    }
  }

  // requirements
  const cited = new Set<string>();
  for (const r of reqs) {
    if (r.items.length === 0) tdiag(r.file, r.line, 'T001');
    for (const id of r.decisions) {
      cited.add(id);
      const d = declared.get(id);
      if (!d) {
        tdiag(r.file, r.line, 'T008');
        continue;
      }
      const w = d.status === null ? 'accepted' : STATUS_RE.exec(d.status)?.[1];
      if (w === 'contested' || w === 'superseded' || w === 'rejected') tdiag(r.file, r.line, 'T028');
      else if (w === 'observed' || w === 'inferred' || w === 'proposed') tdiag(r.file, r.line, 'T028', 'warning');
    }
    if (r.text && codes.size > 1) {
      const text = r.text.lines.join('\n');
      let named = 0;
      for (const c of codes) {
        if (new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRe(c)}(?![\\p{L}\\p{N}_-])`, 'u').test(text)) named++;
      }
      if (named >= 2 && ORDER_RE.test(text)) tdiag(r.file, r.text.line, 'T005');
    }
    for (const item of r.items) {
      const errorExpected = item.expects.some((e) => e.path === 'error');
      if (!item.raw && !errorExpected) {
        const op = ops.get(item.op);
        if (!op) tdiag(item.file, item.line, 'T009');
        else {
          const given = new Set(item.inputObj ? Object.keys(item.inputObj) : inputKeys(item.inputText));
          const fieldNames = new Set(op.fields.map((f) => f.name));
          for (const f of op.fields) if (!f.optional && !given.has(f.name)) tdiag(item.file, item.line, 'T010');
          for (const k of given) if (!fieldNames.has(k)) tdiag(item.file, item.line, 'T011', 'warning');
        }
      }
      for (const e of item.expects) {
        if (e.path === 'error' && e.kind === 'eq' && !(typeof e.value === 'string' && codes.has(e.value))) {
          tdiag(item.file, e.line, 'T023');
        }
      }
    }
  }

  // decisions
  for (const d of decisions) {
    if (!cited.has(d.id)) tdiag(d.file, d.line, 'T012', 'warning');
    if (d.source === null || d.source === '') tdiag(d.file, d.line, 'T013', 'warning');
    if (d.status !== null) {
      const w = STATUS_RE.exec(d.status)?.[1];
      let bad = w === undefined;
      if (w === 'superseded') {
        const sm = /^superseded by (\S+)$/.exec(d.status);
        bad = !sm || !declared.has(sm[1]);
      }
      if (bad) tdiag(d.file, d.line, 'T027');
    }
  }

  // the oracle
  const items = reqs.flatMap((r) => r.items);
  const responses = new Map<Item, Response | null>();
  if (items.length > 0 && !oracle) {
    tdiag(spec.file, spec.line, 'T019');
  } else if (oracle) {
    const runnable = items.filter((i) => i.raw || i.expects.some((e) => e.path === 'error') || ops.has(i.op));
    const ws = new Workspace(files);
    try {
      const folder = oracle.file.includes('/') ? oracle.file.slice(0, oracle.file.lastIndexOf('/')) : '';
      const batch = runnable.filter((i) => !isSolo(i));
      if (batch.length > 0) {
        const r = ws.run(oracle.command, folder, batch.map((i) => buildLine(i, spec, ops) + '\n').join(''));
        if (r.failed) tdiag(oracle.file, oracle.line, 'T020');
        const byId = parseResponses(r.stdout);
        for (const i of batch) responses.set(i, byId.get(caseId(i)) ?? null);
      }
      for (const i of runnable.filter(isSolo)) {
        const r = ws.run(oracle.command, folder, buildLine(i, spec, ops) + '\n');
        if (r.failed) tdiag(i.file, i.line, 'T020');
        responses.set(i, parseSolo(r.stdout));
      }
    } finally {
      ws.close();
    }
    for (const i of runnable) judge(i, responses.get(i) ?? null, tdiag);
  }

  const sorted = sortDiags(diags);
  if (sorted.some((d) => d.level === 'error')) return { diags: sorted, cases: null };
  return { diags: sorted, cases: buildCases(reqs.flatMap((r) => r.items), spec, ops, responses) };
}

function markSecond(stmts: { file: string; line: number }[], code: string, diags: Diag[]): void {
  for (const s of stmts.slice(1)) diags.push({ file: s.file, line: s.line, level: 'error', code });
}

function inputKeys(text: string): string[] {
  if (text === '') return [];
  try {
    return Object.keys(JSON.parse(text));
  } catch {
    return [];
  }
}

function judge(
  item: Item,
  r: Response | null,
  tdiag: (file: string, line: number, code: string, level?: Level) => void,
): void {
  if (r === null) {
    tdiag(item.file, item.line, 'T021');
    return;
  }
  if (Object.hasOwn(r, 'oracle_error')) {
    tdiag(item.file, item.line, 'T022');
    return;
  }
  for (const e of item.expects) {
    const f = getPath(r, e.path);
    if (e.kind === 'oracle') {
      if (!f.found) tdiag(item.file, e.line, 'T025');
    } else if (e.kind === 'eq') {
      if (!f.found || !jsonEqual(f.value, e.value)) tdiag(item.file, e.line, 'T002');
    } else if (!f.found || typeof f.value !== 'number' || !(Math.abs(f.value - (e.value as number)) <= (e.tol as number))) {
      tdiag(item.file, e.line, 'T002');
    }
  }
  if (item.expects.length === 0 && Object.hasOwn(r, 'error')) tdiag(item.file, item.line, 'T024', 'warning');
}

function buildCases(items: Item[], spec: SpecM, ops: Map<string, OpM>, responses: Map<Item, Response | null>): object[] {
  return items.map((item) => {
    const r = responses.get(item) as Response;
    const op = ops.get(item.op);
    const checks = item.expects.map((e) => {
      if (e.kind === 'oracle') {
        const f = getPath(r, e.path);
        return { path: e.path, kind: 'eq', value: f.found ? f.value : null, from: 'oracle' };
      }
      if (e.kind === 'approx') return { path: e.path, kind: 'approx', value: e.value, tol: e.tol };
      return { path: e.path, kind: 'eq', value: e.value };
    });
    const full: Record<string, unknown> = { members: Object.keys(r).sort(cmp) };
    if (Object.hasOwn(r, 'error')) full.error = r.error;
    if (Object.hasOwn(r, 'result')) full.result = r.result;
    if (op?.hasAudit && Object.hasOwn(r, 'audit')) full.audit = r.audit;
    full.tolerances = Object.fromEntries(op ? op.tolerances : []);
    const c: Record<string, unknown> = {
      id: caseId(item), kind: 'example', reqs: [`REQ-${item.reqId}`], platform: item.platform,
      line: buildLine(item, spec, ops),
    };
    if (isSolo(item)) c.solo = true;
    c.checks = checks;
    c.full = full;
    return c;
  });
}
