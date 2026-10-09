import type { Diag, Level } from './common.ts';
import { dirname, escapeRegExp, hasOwn, jsonEqual, setMember, tryJson } from './common.ts';
import type { Case, Model, OpInfo, RecordInfo } from './reader.ts';
import { readRecord } from './reader.ts';
import { OracleRunner, parseResponse } from './oracle.ts';

export interface Analysis {
  diags: Diag[];
  cases: Record<string, unknown>[];
}

function excluded(rel: string): boolean {
  const parts = rel.split('/');
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith('.')) return true;
    if (i < parts.length - 1 && (parts[i] === 'build' || parts[i] === 'node_modules')) return true;
  }
  return !rel.endsWith('.duramen');
}

export function resolveRecord(files: Record<string, string>, entry: string | undefined): RecordInfo | { missing: string } {
  const names = Object.keys(files);
  if (entry !== undefined && entry !== '.' && hasOwn(files, entry)) {
    return { name: entry, folder: dirname(entry), files, recordFiles: [entry] };
  }
  const folder = entry === undefined || entry === '.' ? '' : entry;
  const prefix = folder === '' ? '' : folder + '/';
  const recordFiles = names.filter((n) => n.startsWith(prefix) && !excluded(n.slice(prefix.length)));
  if (recordFiles.length === 0) return { missing: folder === '' ? '.' : folder };
  recordFiles.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { name: folder === '' ? '.' : folder, folder, files, recordFiles };
}

const LEVEL_RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };

export function sortDiags(diags: Diag[]): Diag[] {
  return diags
    .map((d, i) => ({ d, i }))
    .sort((a, b) => {
      const x = a.d;
      const y = b.d;
      if (x.file !== y.file) return x.file < y.file ? -1 : 1;
      if (x.line !== y.line) return x.line - y.line;
      if (x.code !== y.code) return x.code < y.code ? -1 : 1;
      if (x.level !== y.level) return LEVEL_RANK[x.level] - LEVEL_RANK[y.level];
      return a.i - b.i;
    })
    .map((x) => x.d);
}

function holdsObligation(text: string): boolean {
  const re = /(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])/;
  for (const line of text.split('\n')) {
    const stripped = line.replace(/"[^"]*"|“[^”]*”|`[^`]*`/g, ' ');
    if (re.test(stripped)) return true;
  }
  return false;
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

function namesOrder(text: string, codes: string[]): boolean {
  const distinct = [...new Set(codes)];
  let named = 0;
  for (const code of distinct) {
    const re = new RegExp('(?<![A-Za-z0-9_-])' + escapeRegExp(code) + '(?![A-Za-z0-9_-])');
    if (re.test(text)) named++;
  }
  if (named < 2) return false;
  return ORDER_PHRASES.some((p) => {
    const body = p.split(' ').map(escapeRegExp).join('\\s+');
    return new RegExp('(?<![A-Za-z0-9_])' + body + '(?![A-Za-z0-9_])', 'i').test(text);
  });
}

function buildLine(c: Case, model: Model, opMap: Map<string, OpInfo>): string {
  if (c.raw !== undefined) return c.raw;
  const op = opMap.get(c.op);
  const base = op?.request ?? model.specs[0]?.request ?? {};
  const members: Record<string, unknown> = {};
  for (const k of Object.keys(base)) setMember(members, k, base[k]);
  for (const k of Object.keys(c.request ?? {})) setMember(members, k, c.request![k]);
  const omit = new Set(c.omit);
  const parts: string[] = [];
  if (!omit.has('id')) parts.push(`"id":${JSON.stringify(c.id)}`);
  if (!omit.has('op')) parts.push(`"op":${JSON.stringify(c.op)}`);
  for (const k of Object.keys(members)) {
    if (omit.has(k)) continue;
    parts.push(`${JSON.stringify(k)}:${JSON.stringify(members[k])}`);
  }
  if (c.inputText !== undefined && !omit.has('input')) parts.push(`"input":${c.inputText}`);
  return '{' + parts.join(',') + '}';
}

function lookup(resp: Record<string, unknown>, path: string): { found: boolean; value?: unknown } {
  const segs = path.split('.');
  let cur: unknown = resp;
  let i = 0;
  if (segs[0] === 'audit' && segs.length > 1) {
    if (!hasOwn(resp, 'audit') || typeof resp.audit !== 'string') return { found: false };
    const p = tryJson(resp.audit);
    if (!p.ok) return { found: false };
    cur = p.value;
    i = 1;
  }
  for (; i < segs.length; i++) {
    const s = segs[i];
    if (Array.isArray(cur)) {
      if (/^(?:0|[1-9][0-9]*)$/.test(s) && Number(s) < cur.length) cur = cur[Number(s)];
      else return { found: false };
    } else if (cur !== null && typeof cur === 'object') {
      if (hasOwn(cur, s)) cur = (cur as Record<string, unknown>)[s];
      else return { found: false };
    } else return { found: false };
  }
  return { found: true, value: cur };
}

export function analyse(files: Record<string, string>, entry: string | undefined): Analysis {
  const rec = resolveRecord(files, entry);
  if ('missing' in rec) {
    return { diags: [{ file: rec.missing, line: 1, level: 'error', code: 'P046' }], cases: [] };
  }
  const { diags, model } = readRecord(rec);
  if (diags.length > 0) return { diags: sortDiags(diags), cases: [] };

  const add = (file: string, line: number, code: string, level: Level = 'error') => {
    diags.push({ file, line, level, code });
  };

  const opMap = new Map<string, OpInfo>();
  for (const op of model.ops) if (op.valid && !opMap.has(op.name)) opMap.set(op.name, op);
  const decisionIds = new Set(model.decisions.map((x) => x.id));
  const allCases: Case[] = model.reqs.flatMap((r) => r.cases);

  // T001, T007, T008
  for (const r of model.reqs) if (r.cases.length === 0) add(r.file, r.line, 'T001');
  const dupCheck = <T extends { file: string; line: number }>(items: T[], key: (x: T) => string | null) => {
    const seen = new Set<string>();
    for (const it of items) {
      const k = key(it);
      if (k === null) continue;
      if (seen.has(k)) add(it.file, it.line, 'T007');
      seen.add(k);
    }
  };
  dupCheck(model.reqs, (x) => x.id);
  dupCheck(model.opens, (x) => x.id);
  dupCheck(model.decisions, (x) => x.id);
  dupCheck(model.ops, (x) => (x.valid ? x.name : null));
  for (const r of model.reqs) {
    for (const id of new Set(r.decisions)) if (!decisionIds.has(id)) add(r.file, r.line, 'T008');
  }

  // T009, T010, T011, T023
  const codes = new Set(model.errorCodes);
  for (const c of allCases) {
    const expectsError = c.expects.some((e) => e.path === 'error');
    if (c.raw === undefined && !expectsError) {
      const op = opMap.get(c.op);
      if (!op) add(c.file, c.line, 'T009');
      else {
        const given = new Set<string>();
        if (c.inputText !== undefined) {
          const p = tryJson(c.inputText);
          if (p.ok && p.value !== null && typeof p.value === 'object') for (const k of Object.keys(p.value)) given.add(k);
        }
        for (const f of op.fields) if (!f.optional && !given.has(f.name)) add(c.file, c.line, 'T010');
        const declared = new Set(op.fields.map((f) => f.name));
        for (const k of given) if (!declared.has(k)) add(c.file, c.line, 'T011', 'warning');
      }
    }
    for (const e of c.expects) {
      if (e.path === 'error' && e.kind === 'eq') {
        if (typeof e.value !== 'string' || !codes.has(e.value)) add(c.file, e.line, 'T023');
      }
    }
  }

  // T004, T014
  for (const t of model.texts) {
    if (!holdsObligation(t.text)) continue;
    if (t.open) add(t.file, t.line, 'T014', 'warning');
    else add(t.file, t.line, 'T004');
  }

  // T005
  for (const r of model.reqs) {
    if (r.text !== undefined && r.textLine !== undefined && namesOrder(r.text, model.errorCodes)) {
      add(r.file, r.textLine, 'T005');
    }
  }

  // T003
  for (const o of model.opens) for (const l of o.testLines) add(o.file, l, 'T003');

  // T012, T013, T027, T028
  const cited = new Set(model.reqs.flatMap((r) => r.decisions));
  const firstDecision = new Map<string, (typeof model.decisions)[number]>();
  for (const dec of model.decisions) if (!firstDecision.has(dec.id)) firstDecision.set(dec.id, dec);
  for (const dec of model.decisions) {
    if (!cited.has(dec.id)) add(dec.file, dec.line, 'T012', 'warning');
    if (dec.source === undefined || dec.source === '') add(dec.file, dec.line, 'T013', 'warning');
    if (dec.status !== undefined) {
      const word = dec.status.split(/\s/)[0];
      const known = ['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected'];
      let ok = known.includes(word);
      if (ok && word === 'superseded') {
        const m = /^superseded by (\S+)$/.exec(dec.status);
        ok = m !== null && decisionIds.has(m[1]);
      }
      if (!ok) add(dec.file, dec.line, 'T027');
    }
  }
  for (const r of model.reqs) {
    for (const id of new Set(r.decisions)) {
      const dec = firstDecision.get(id);
      if (!dec) continue;
      const word = dec.status === undefined ? 'accepted' : dec.status.split(/\s/)[0];
      if (word === 'contested' || word === 'superseded' || word === 'rejected') add(r.file, r.line, 'T028');
      else if (word === 'observed' || word === 'inferred' || word === 'proposed') add(r.file, r.line, 'T028', 'warning');
    }
  }

  // oracle
  const spec = model.specs[0];
  const outCases: Record<string, unknown>[] = [];
  const responses = new Map<Case, Record<string, unknown> | null>();
  if (allCases.length > 0 && !model.oracle) {
    add(spec.file, spec.line, 'T019');
  } else if (allCases.length > 0 && model.oracle) {
    const oracle = model.oracle;
    const runner = new OracleRunner(files, oracle.file, oracle.command);
    try {
      const lines = new Map<Case, string>();
      const runnable = allCases.filter((c) => c.raw !== undefined || c.expects.some((e) => e.path === 'error') || opMap.has(c.op));
      for (const c of runnable) lines.set(c, buildLine(c, model, opMap));
      const solo = (c: Case) => c.raw !== undefined || c.omit.includes('id');
      const batch = runnable.filter((c) => !solo(c));
      if (batch.length > 0) {
        const r = runner.run(batch.map((c) => lines.get(c)! + '\n').join(''));
        if (r.failed) add(oracle.file, oracle.line, 'T020');
        const byId = new Map<string, Record<string, unknown>>();
        for (const l of r.lines) {
          const o = parseResponse(l);
          if (o && typeof o.id === 'string' && !byId.has(o.id)) byId.set(o.id, o);
        }
        for (const c of batch) responses.set(c, byId.get(c.id) ?? null);
      }
      for (const c of runnable.filter(solo)) {
        const r = runner.run(lines.get(c)! + '\n');
        if (r.failed) add(c.file, c.line, 'T020');
        responses.set(c, r.lines.length === 1 ? parseResponse(r.lines[0]) : null);
      }

      for (const c of runnable) {
        const resp = responses.get(c);
        if (!resp) {
          add(c.file, c.line, 'T021');
          continue;
        }
        if (hasOwn(resp, 'oracle_error')) {
          add(c.file, c.line, 'T022');
          continue;
        }
        const checks: Record<string, unknown>[] = [];
        for (const e of c.expects) {
          const lk = lookup(resp, e.path);
          if (e.kind === 'oracle') {
            if (!lk.found) add(c.file, e.line, 'T025');
            else checks.push({ path: e.path, kind: 'eq', value: lk.value, from: 'oracle' });
          } else if (e.kind === 'eq') {
            if (!lk.found || !jsonEqual(lk.value, e.value)) add(c.file, e.line, 'T002');
            checks.push({ path: e.path, kind: 'eq', value: e.value });
          } else {
            const ok = lk.found && typeof lk.value === 'number' && Math.abs(lk.value - (e.value as number)) <= (e.tol as number);
            if (!ok) add(c.file, e.line, 'T002');
            checks.push({ path: e.path, kind: 'approx', value: e.value, tol: e.tol });
          }
        }
        if (c.expects.length === 0 && hasOwn(resp, 'error')) add(c.file, c.line, 'T024', 'warning');
        (c as Case & { checks?: unknown }).checks = checks;
      }
    } finally {
      runner.cleanup();
    }
  }

  const sorted = sortDiags(diags);
  if (sorted.some((x) => x.level === 'error')) return { diags: sorted, cases: [] };

  for (const c of allCases) {
    const resp = responses.get(c);
    if (!resp) continue;
    const op = opMap.get(c.op);
    const full: Record<string, unknown> = { members: Object.keys(resp).sort() };
    if (hasOwn(resp, 'error')) full.error = resp.error;
    if (hasOwn(resp, 'result')) full.result = resp.result;
    if (op?.audit && hasOwn(resp, 'audit')) full.audit = resp.audit;
    const tol: Record<string, unknown> = {};
    if (op) for (const [k, v] of op.tolerances) setMember(tol, k, v);
    full.tolerances = tol;
    const out: Record<string, unknown> = {
      id: c.id,
      kind: 'example',
      reqs: [`REQ-${c.reqId}`],
      platform: c.platform,
      line: buildLine(c, model, opMap),
      checks: (c as Case & { checks?: unknown }).checks ?? [],
      full,
    };
    if (c.raw !== undefined || c.omit.includes('id')) out.solo = true;
    outCases.push(out);
  }
  return { diags: sorted, cases: outCases };
}
