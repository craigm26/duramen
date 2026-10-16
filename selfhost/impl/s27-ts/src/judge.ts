// Judging one answer against one case (REQ-JU-*).

import { deepEqual, hasOwn, isPlainObject, resolvePath } from './util.ts';

// True when the case and answer have the forms REQ-JU-001 gives.
export function validJudgeInput(c: any, answer: any, hasAnswer: boolean): boolean {
  if (!isPlainObject(c)) return false;
  if (!hasOwn(c, 'checks') || !Array.isArray(c.checks)) return false;
  for (const k of c.checks) {
    if (!isPlainObject(k) || typeof k.path !== 'string' || !hasOwn(k, 'kind')) return false;
    if (k.kind === 'eq' && !hasOwn(k, 'value')) return false;
    if (k.kind === 'approx') {
      if (typeof k.value !== 'number' || typeof k.tol !== 'number' || !(k.tol >= 0)) return false;
    }
  }
  if (!hasOwn(c, 'full')) return false;
  const f = c.full;
  if (f !== null) {
    if (!isPlainObject(f)) return false;
    if (!Array.isArray(f.members) || !f.members.every((m: any) => typeof m === 'string')) return false;
    if (!isPlainObject(f.tolerances)) return false;
    for (const k of Object.keys(f.tolerances)) {
      const v = f.tolerances[k];
      if (typeof v !== 'number' || !(v >= 0)) return false;
    }
    if (hasOwn(f, 'audit') && typeof f.audit !== 'string') return false;
  }
  if (!hasAnswer) return false;
  return answer === null || isPlainObject(answer);
}

function meetsCheck(k: any, answer: any): boolean {
  const got = resolvePath(answer, k.path);
  if (!got.found) return false;
  if (k.kind === 'eq') return deepEqual(got.value, k.value);
  if (k.kind === 'approx') {
    return typeof got.value === 'number' && Math.abs(got.value - k.value) <= k.tol;
  }
  return false; // checks of other kinds are open (OPEN-JU-001)
}

// Same JSON value, except that a number at a path named in `tolerances` may be that far off.
function sameWithin(a: any, b: any, path: string, tol: any): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    if (hasOwn(tol, path)) return Math.abs(a - b) <= tol[path];
    return a === b;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => sameWithin(x, b[i], path + '.' + i, tol));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => hasOwn(b, k) && sameWithin(a[k], b[k], path + '.' + k, tol));
  }
  return deepEqual(a, b);
}

export function judge(c: any, answer: any): { pass: boolean; failed?: string[] } {
  if (answer === null) return { pass: false, failed: ['answer'] };
  const failed: string[] = [];
  c.checks.forEach((k: any, i: number) => {
    if (!meetsCheck(k, answer)) failed.push('checks.' + i);
  });
  const f = c.full;
  if (f !== null) {
    const members = Object.keys(answer).sort();
    if (members.length !== f.members.length || members.some((m, i) => m !== f.members[i])) failed.push('members');
    if (hasOwn(f, 'error')) {
      if (!hasOwn(answer, 'error') || !deepEqual(answer.error, f.error)) failed.push('error');
    } else {
      if (hasOwn(f, 'result')) {
        if (!hasOwn(answer, 'result') || !sameWithin(answer.result, f.result, 'result', f.tolerances)) failed.push('result');
      }
      if (hasOwn(f, 'audit')) {
        if (!hasOwn(answer, 'audit') || answer.audit !== f.audit) failed.push('audit');
      }
    }
  }
  return failed.length === 0 ? { pass: true } : { pass: false, failed };
}
