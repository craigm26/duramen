// The `check` and `cases` operations.

import { allExamples, firstOps, runCheck } from './checks.ts';
import type { Diag } from './model.ts';
import { caseId, isSolo, requestLine, runExamples } from './oracle.ts';
import { Reader } from './reader.ts';
import { resolveRecord } from './record.ts';
import { compareUnits, hasOwn, readPath, setMember, type Json, type JsonObject } from './util.ts';

const LEVELS = ['error', 'warning', 'info'];

function sortDiags(diags: Diag[]): Diag[] {
  return [...diags].sort(
    (a, b) =>
      compareUnits(a.file, b.file) ||
      a.line - b.line ||
      compareUnits(a.code, b.code) ||
      LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level),
  );
}

async function analyse(files: Record<string, string>, entry: string | undefined) {
  const name = entry ?? '.';
  const diags: Diag[] = [];
  const rec = resolveRecord(files, name);
  if (!rec) {
    diags.push({ file: name, line: 1, level: 'error', code: 'P046' });
    return { diags, rec: undefined, responses: undefined };
  }
  new Reader(rec, files, diags).readAll();
  if (diags.length > 0) return { diags: sortDiags(diags), rec: undefined, responses: undefined };
  runCheck(rec, diags);
  const responses = rec.oracle && !diags.some((d) => d.code === 'T019') ? await runExamples(rec, files, diags) : undefined;
  return { diags: sortDiags(diags), rec, responses };
}

export async function check(files: Record<string, string>, entry: string | undefined) {
  const { diags } = await analyse(files, entry);
  return {
    diagnostics: diags.map((d) => `${d.file}:${d.line}: ${d.level} ${d.code}`),
    errors: diags.filter((d) => d.level === 'error').length,
    warnings: diags.filter((d) => d.level === 'warning').length,
  };
}

export async function cases(files: Record<string, string>, entry: string | undefined) {
  const { diags, rec, responses } = await analyse(files, entry);
  const errors = diags.filter((d) => d.level === 'error').length;
  if (errors > 0 || !rec) return { errors, cases: [] };
  const ops = firstOps(rec);
  const out: JsonObject[] = [];
  for (const ex of allExamples(rec)) {
    const resp = responses?.get(ex) ?? {};
    const op = ex.raw ? undefined : ops.get(ex.op!);
    const checks: Json[] = ex.expects.map((e) => {
      if (e.kind === 'eq') return { path: e.path, kind: 'eq', value: e.value! };
      if (e.kind === 'approx') return { path: e.path, kind: 'approx', value: e.value!, tol: e.tol! };
      const got = readValue(resp, e.path);
      return { path: e.path, kind: 'eq', value: got, from: 'oracle' };
    });
    const full: JsonObject = { members: Object.keys(resp).sort(compareUnits) };
    if (hasOwn(resp, 'error')) full.error = resp.error;
    if (hasOwn(resp, 'result')) full.result = resp.result;
    if (op?.audit && typeof resp.audit === 'string') full.audit = resp.audit;
    const tolerances: JsonObject = {};
    if (op) for (const [path, n] of op.tolerances) setMember(tolerances, path, n);
    full.tolerances = tolerances;
    const c: JsonObject = {
      id: caseId(ex),
      kind: 'example',
      reqs: ['REQ-' + ex.req.id],
      platform: ex.req.platform,
      line: requestLine(ex, rec),
    };
    if (isSolo(ex)) c.solo = true;
    c.checks = checks;
    c.full = full;
    out.push(c);
  }
  return { errors, cases: out };
}

function readValue(resp: JsonObject, path: string): Json {
  return (readPath(resp, path)?.value ?? null) as Json;
}
