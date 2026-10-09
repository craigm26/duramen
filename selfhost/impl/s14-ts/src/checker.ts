import type { Diag, Example, Expect, Op, Rec } from './model.ts';
import { makeSandbox, batchResponses, runOracle, soloResponse } from './oracle.ts';
import { newRec, readFile } from './reader.ts';
import type { ReadCtx } from './reader.ts';
import { compareUnits, deepEqual, hasOwn, isPlainObject, lookup, setOwn } from './util.ts';

type Obj = Record<string, unknown>;

export interface Analysis {
  diags: Diag[];
  errors: number;
  warnings: number;
  rec: Rec | null;
  responses: Map<Example, Obj | undefined>;
}

const LEVEL_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

function finish(diags: Diag[], rec: Rec | null, responses: Map<Example, Obj | undefined>): Analysis {
  diags.sort(
    (a, b) =>
      compareUnits(a.file, b.file) ||
      a.line - b.line ||
      compareUnits(a.code, b.code) ||
      LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level],
  );
  return {
    diags,
    errors: diags.filter((d) => d.level === 'error').length,
    warnings: diags.filter((d) => d.level === 'warning').length,
    rec,
    responses,
  };
}

export function formatDiag(d: Diag): string {
  return `${d.file}:${d.line}: ${d.level} ${d.code}`;
}

const OBLIGATION_RE = /(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])/;

function stripQuotations(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    const close = c === '"' ? '"' : c === '“' ? '”' : c === '`' ? '`' : null;
    if (close !== null) {
      const j = line.indexOf(close, i + 1);
      if (j >= 0) {
        out += ' ';
        i = j + 1;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

function hasObligation(text: string): boolean {
  return text.split('\n').some((l) => OBLIGATION_RE.test(stripQuotations(l)));
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
const PHRASE_RE = new RegExp(
  '(?<![A-Za-z0-9_])(?:' + PHRASES.map((p) => p.replace(/ /g, '\\s+')).join('|') + ')(?![A-Za-z0-9_])',
  'i',
);

function namesCode(text: string, code: string): boolean {
  let from = 0;
  for (;;) {
    const i = text.indexOf(code, from);
    if (i < 0) return false;
    const before = i === 0 ? '' : text[i - 1];
    const after = text[i + code.length] ?? '';
    if (!/[A-Za-z0-9_-]/.test(before) && !/[A-Za-z0-9_-]/.test(after)) return true;
    from = i + 1;
  }
}

const STATUS_WORDS = ['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected'];

export function analyze(files: Record<string, string>, entry: string | undefined): Analysis {
  const entryName = entry ?? '.';
  const empty = new Map<Example, Obj | undefined>();
  let list: { name: string; rel: string }[];
  let recordName: string;
  let recordFolder: string[];
  if (entryName !== '.' && hasOwn(files, entryName)) {
    list = [{ name: entryName, rel: entryName }];
    recordName = entryName;
    recordFolder = entryName.split('/').slice(0, -1);
  } else {
    const prefix = entryName === '.' ? '' : entryName + '/';
    recordName = entryName;
    recordFolder = entryName === '.' ? [] : entryName.split('/');
    list = Object.keys(files)
      .filter((n) => n.startsWith(prefix))
      .map((n) => ({ name: n, rel: n.slice(prefix.length) }))
      .filter(({ rel }) => {
        if (!rel.endsWith('.duramen')) return false;
        const parts = rel.split('/');
        if (parts.some((p) => p.startsWith('.'))) return false;
        return !parts.slice(0, -1).some((p) => p === 'build' || p === 'node_modules');
      });
    if (list.length === 0) {
      return finish([{ file: entryName, line: 1, level: 'error', code: 'P046' }], null, empty);
    }
  }
  list.sort((a, b) => compareUnits(a.rel, b.rel));

  const diags: Diag[] = [];
  const rec = newRec();
  const ctx: ReadCtx = {
    files,
    recordFolder,
    recordName,
    diags,
    rec,
    specCount: 0,
    oracleCount: 0,
    errorsCount: 0,
    versions: new Set(),
  };
  for (const { name } of list) readFile(ctx, name, files[name]);
  if (ctx.versions.size > 1) diags.push({ file: recordName, line: 1, level: 'error', code: 'P047' });
  if (ctx.specCount === 0) diags.push({ file: recordName, line: 1, level: 'error', code: 'P021' });
  if (diags.length > 0) return finish(diags, rec, empty);

  const responses = checkRecord(files, rec, diags);
  return finish(diags, rec, responses);
}

function expectsError(ex: Example): boolean {
  return ex.expects.some((e) => e.path === 'error');
}

function checkRecord(files: Record<string, string>, rec: Rec, diags: Diag[]): Map<Example, Obj | undefined> {
  const add = (file: string, line: number, level: Diag['level'], code: string) =>
    diags.push({ file, line, level, code });

  // first operation of each name
  const ops = new Map<string, Op>();
  for (const op of rec.ops) if (!ops.has(op.name)) ops.set(op.name, op);

  // T007: IDs are unique within each kind
  const dupes = <T extends { file: string; line: number }>(items: T[], key: (t: T) => string) => {
    const seen = new Set<string>();
    for (const it of items) {
      const k = key(it);
      if (seen.has(k)) add(it.file, it.line, 'error', 'T007');
      seen.add(k);
    }
  };
  dupes(rec.reqs, (r) => r.id);
  dupes(rec.opens, (o) => o.id);
  dupes(rec.decisions, (d) => d.id);
  dupes(rec.ops, (o) => o.name);

  // T003, T004, T014
  for (const o of rec.opens) for (const l of o.exTableLines) add(o.file, l, 'error', 'T003');
  for (const ob of rec.obligations) {
    if (hasObligation(ob.text)) add(ob.file, ob.line, ob.warn ? 'warning' : 'error', ob.warn ? 'T014' : 'T004');
  }

  // decisions
  const declared = new Map<string, (typeof rec.decisions)[number]>();
  for (const d of rec.decisions) if (!declared.has(d.id)) declared.set(d.id, d);
  const cited = new Set<string>();
  for (const r of rec.reqs) for (const id of r.decisions) cited.add(id);
  for (const d of rec.decisions) {
    if (!cited.has(d.id)) add(d.file, d.line, 'warning', 'T012');
    if (d.source === undefined || d.source === '') add(d.file, d.line, 'warning', 'T013');
    if (d.hasStatus) {
      const first = d.status.split(/\s+/)[0] ?? '';
      let ok = STATUS_WORDS.includes(first);
      if (ok && first === 'superseded') {
        const m = /^superseded by (\S+)$/.exec(d.status);
        ok = m !== null && declared.has(m[1]);
      }
      if (!ok) add(d.file, d.line, 'error', 'T027');
    }
  }

  // requirements
  for (const r of rec.reqs) {
    if (r.examples.length === 0) add(r.file, r.line, 'error', 'T001');
    for (const id of new Set(r.decisions)) {
      const d = declared.get(id);
      if (!d) {
        add(r.file, r.line, 'error', 'T008');
        continue;
      }
      const w = d.hasStatus ? (d.status.split(/\s+/)[0] ?? '') : 'accepted';
      if (w === 'contested' || w === 'superseded' || w === 'rejected') add(r.file, r.line, 'error', 'T028');
      else if (w === 'observed' || w === 'inferred' || w === 'proposed') add(r.file, r.line, 'warning', 'T028');
    }
    if (r.text) {
      const named = rec.errorCodes.filter((c, i, a) => a.indexOf(c) === i && namesCode(r.text!.text, c));
      if (named.length >= 2 && PHRASE_RE.test(r.text.text)) add(r.file, r.text.line, 'error', 'T005');
    }
    for (const ex of r.examples) {
      if (!ex.raw && !expectsError(ex)) {
        const op = ops.get(ex.op ?? '');
        if (!op) add(ex.file, ex.line, 'error', 'T009');
        else {
          const provided = Object.keys(ex.inputObj ?? (isPlainObject(ex.jsonValue) ? ex.jsonValue : {}));
          for (const f of op.fields) {
            if (!f.optional && !provided.includes(f.name)) add(ex.file, ex.line, 'error', 'T010');
          }
          for (const k of provided) {
            if (!op.fields.some((f) => f.name === k)) add(ex.file, ex.line, 'warning', 'T011');
          }
        }
      }
      for (const e of ex.expects) {
        if (e.path !== 'error' || e.kind === 'oracle') continue;
        const ok = e.kind === 'eq' && typeof e.value === 'string' && rec.errorCodes.includes(e.value);
        if (!ok) add(ex.file, e.line, 'error', 'T023');
      }
    }
  }

  // oracle
  const all = rec.reqs.flatMap((r) => r.examples);
  const responses = new Map<Example, Obj | undefined>();
  if (all.length > 0 && !rec.oracle) {
    add(rec.spec!.file, rec.spec!.line, 'error', 'T019');
    return responses;
  }
  if (all.length === 0 || !rec.oracle) return responses;
  const oracle = rec.oracle;
  const runnable = all.filter((ex) => ex.raw || expectsError(ex) || ops.has(ex.op ?? ''));
  const lineOf = new Map<Example, string>();
  for (const r of rec.reqs) {
    for (const ex of r.examples) if (runnable.includes(ex)) lineOf.set(ex, requestLine(ex, rec, ops));
  }
  const solo = (ex: Example) => ex.raw || ex.omit.includes('id');
  const batch = runnable.filter((ex) => !solo(ex));
  const singles = runnable.filter(solo);
  if (batch.length > 0 || singles.length > 0) {
    const sb = makeSandbox(files);
    try {
      const cwd = [sb.root, ...oracle.dir].join('/');
      if (batch.length > 0) {
        const run = runOracle(oracle.command, cwd, batch.map((ex) => lineOf.get(ex)! + '\n').join(''));
        if (run.failed) add(oracle.file, oracle.line, 'error', 'T020');
        const m = batchResponses(run.stdout);
        for (const ex of batch) responses.set(ex, m.get(ex.caseId));
      }
      for (const ex of singles) {
        const run = runOracle(oracle.command, cwd, lineOf.get(ex)! + '\n');
        if (run.failed) add(ex.file, ex.line, 'error', 'T020');
        responses.set(ex, soloResponse(run.stdout) ?? undefined);
      }
    } finally {
      sb.cleanup();
    }
  }

  for (const ex of runnable) {
    const resp = responses.get(ex);
    if (resp === undefined) {
      add(ex.file, ex.line, 'error', 'T021');
      continue;
    }
    if (hasOwn(resp, 'oracle_error')) {
      add(ex.file, ex.line, 'error', 'T022');
      continue;
    }
    if (ex.expects.length === 0 && hasOwn(resp, 'error')) add(ex.file, ex.line, 'warning', 'T024');
    for (const e of ex.expects) {
      const got = lookup(resp, e.path);
      if (e.kind === 'oracle') {
        if (!got.found) add(ex.file, e.line, 'error', 'T025');
      } else if (!got.found) {
        add(ex.file, e.line, 'error', 'T002');
      } else if (e.kind === 'eq') {
        if (!deepEqual(got.value, e.value)) add(ex.file, e.line, 'error', 'T002');
      } else if (typeof got.value !== 'number' || !(Math.abs(got.value - (e.value as number)) <= e.tol!)) {
        add(ex.file, e.line, 'error', 'T002');
      }
    }
  }
  return responses;
}

// ---- request lines and cases ---------------------------------------------

function copyMembers(into: Obj, from: Obj | undefined): void {
  if (!from) return;
  for (const k of Object.keys(from)) setOwn(into, k, from[k]);
}

export function requestLine(ex: Example, rec: Rec, ops: Map<string, Op>): string {
  if (ex.raw) return ex.rawLine!;
  const op = ops.get(ex.op ?? '');
  const members: Obj = {};
  copyMembers(members, op?.request ?? rec.spec?.request);
  copyMembers(members, ex.request);
  for (const k of ex.omit) delete members[k];
  const parts: string[] = [];
  if (!ex.omit.includes('id')) parts.push(`"id":${JSON.stringify(ex.caseId)}`);
  if (!ex.omit.includes('op')) parts.push(`"op":${JSON.stringify(ex.op)}`);
  for (const k of Object.keys(members)) parts.push(`${JSON.stringify(k)}:${JSON.stringify(members[k])}`);
  if (!ex.omit.includes('input')) {
    if (ex.hasInputLines) parts.push(`"input":${JSON.stringify(ex.inputObj ?? {})}`);
    else if (ex.jsonText !== undefined) parts.push(`"input":${ex.jsonText}`);
  }
  return '{' + parts.join(',') + '}';
}

function checkJson(e: Expect, resp: Obj): Obj {
  if (e.kind === 'approx') return { path: e.path, kind: 'approx', value: e.value, tol: e.tol };
  if (e.kind === 'eq') return { path: e.path, kind: 'eq', value: e.value };
  const got = lookup(resp, e.path);
  return { path: e.path, kind: 'eq', value: got.found ? got.value : null, from: 'oracle' };
}

export function buildCases(a: Analysis): Obj[] {
  const rec = a.rec!;
  const ops = new Map<string, Op>();
  for (const op of rec.ops) if (!ops.has(op.name)) ops.set(op.name, op);
  const cases: Obj[] = [];
  for (const r of rec.reqs) {
    for (const ex of r.examples) {
      const resp = a.responses.get(ex) ?? {};
      const op = ex.raw ? undefined : ops.get(ex.op ?? '');
      const full: Obj = { members: Object.keys(resp).sort(compareUnits) };
      if (hasOwn(resp, 'error')) full.error = resp.error;
      if (hasOwn(resp, 'result')) full.result = resp.result;
      if (op?.audit && typeof resp.audit === 'string') full.audit = resp.audit;
      const tolerances: Obj = {};
      if (op) for (const [p, n] of op.tolerances) setOwn(tolerances, p, n);
      full.tolerances = tolerances;
      const c: Obj = {
        id: ex.caseId,
        kind: 'example',
        reqs: ['REQ-' + r.id],
        platform: r.platform,
        line: requestLine(ex, rec, ops),
      };
      if (ex.raw || ex.omit.includes('id')) c.solo = true;
      c.checks = ex.expects.map((e) => checkJson(e, resp));
      c.full = full;
      cases.push(c);
    }
  }
  return cases;
}
