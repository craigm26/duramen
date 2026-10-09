import { compareUnits, deepEqual, hasOwn, isPlainObject, lookup } from './util.ts';

type Obj = Record<string, unknown>;

export interface Check {
  path: string;
  kind: string;
  value?: unknown;
  tol?: number;
}

export interface JudgeCase {
  checks: Check[];
  full: null | { members: string[]; tolerances: Obj; error?: unknown; result?: unknown; audit?: string };
}

const isNum = (v: unknown): v is number => typeof v === 'number';

/** Returns the case in the form REQ-JU-001 gives, or null when it has another. */
export function validateCase(c: unknown): JudgeCase | null {
  if (!isPlainObject(c) || !Array.isArray(c.checks) || !hasOwn(c, 'full')) return null;
  for (const k of c.checks) {
    if (!isPlainObject(k) || typeof k.path !== 'string' || typeof k.kind !== 'string') return null;
    if (k.kind === 'eq') {
      if (!hasOwn(k, 'value')) return null;
    } else if (k.kind === 'approx') {
      if (!isNum(k.value) || !isNum(k.tol) || !(k.tol >= 0)) return null;
    }
  }
  const f = c.full;
  if (f !== null) {
    if (!isPlainObject(f)) return null;
    if (!Array.isArray(f.members) || !f.members.every((m) => typeof m === 'string')) return null;
    if (!isPlainObject(f.tolerances)) return null;
    if (!Object.values(f.tolerances).every((t) => isNum(t) && t >= 0)) return null;
    if (hasOwn(f, 'audit') && typeof f.audit !== 'string') return null;
  }
  return c as unknown as JudgeCase;
}

function sameWithTolerance(exp: unknown, got: unknown, path: string, tols: Obj): boolean {
  if (isNum(exp) && isNum(got) && hasOwn(tols, path)) {
    return Math.abs(got - exp) <= (tols[path] as number);
  }
  if (Array.isArray(exp)) {
    if (!Array.isArray(got) || got.length !== exp.length) return false;
    return exp.every((e, i) => sameWithTolerance(e, got[i], `${path}.${i}`, tols));
  }
  if (isPlainObject(exp)) {
    if (!isPlainObject(got)) return false;
    const ks = Object.keys(exp);
    if (ks.length !== Object.keys(got).length) return false;
    return ks.every((k) => hasOwn(got, k) && sameWithTolerance(exp[k], got[k], `${path}.${k}`, tols));
  }
  return deepEqual(exp, got);
}

export function judge(c: JudgeCase, answer: Obj | null): string[] {
  if (answer === null) return ['answer'];
  const failed: string[] = [];
  c.checks.forEach((k, i) => {
    const got = lookup(answer, k.path);
    let ok = false;
    if (k.kind === 'eq') ok = got.found && deepEqual(got.value, k.value);
    else if (k.kind === 'approx') {
      ok = got.found && isNum(got.value) && Math.abs(got.value - (k.value as number)) <= k.tol!;
    }
    if (!ok) failed.push(`checks.${i}`);
  });
  const f = c.full;
  if (f === null) return failed;
  const members = Object.keys(answer).sort(compareUnits);
  if (members.length !== f.members.length || members.some((m, i) => m !== f.members[i])) failed.push('members');
  if (hasOwn(f, 'error')) {
    if (!hasOwn(answer, 'error') || !deepEqual(answer.error, f.error)) failed.push('error');
  } else {
    if (hasOwn(f, 'result')) {
      if (!hasOwn(answer, 'result') || !sameWithTolerance(f.result, answer.result, 'result', f.tolerances)) {
        failed.push('result');
      }
    }
    if (hasOwn(f, 'audit')) {
      if (!hasOwn(answer, 'audit') || answer.audit !== f.audit) failed.push('audit');
    }
  }
  return failed;
}
