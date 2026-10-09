// Judging one answer against one case (REQ-JU-001 to REQ-JU-004).
import { has, isObject, jsonEqual, readResponsePath } from './util.ts';

function isNum(v: any): boolean {
  return typeof v === 'number';
}

// True when `c` and `a` have the forms REQ-JU-001 gives.
export function validJudgeInput(c: any, a: any, hasAnswer: boolean): boolean {
  if (!isObject(c) || !hasAnswer) return false;
  if (!Array.isArray(c.checks)) return false;
  for (const k of c.checks) {
    if (!isObject(k) || typeof k.path !== 'string' || typeof k.kind !== 'string') return false;
    if (k.kind === 'eq' && !has(k, 'value')) return false;
    if (k.kind === 'approx' && !(isNum(k.value) && isNum(k.tol) && k.tol >= 0)) return false;
  }
  if (!has(c, 'full')) return false;
  const f = c.full;
  if (f !== null) {
    if (!isObject(f)) return false;
    if (!Array.isArray(f.members) || !f.members.every((m: any) => typeof m === 'string')) return false;
    if (!isObject(f.tolerances)) return false;
    for (const k of Object.keys(f.tolerances)) {
      const t = f.tolerances[k];
      if (!isNum(t) || t < 0) return false;
    }
    if (has(f, 'audit') && typeof f.audit !== 'string') return false;
  }
  return a === null || isObject(a);
}

function holds(check: any, answer: any): boolean {
  const got = readResponsePath(answer, check.path);
  if (!got.found) return false;
  if (check.kind === 'eq') return jsonEqual(got.value, check.value);
  if (check.kind === 'approx') return isNum(got.value) && Math.abs(got.value - check.value) <= check.tol;
  return false;
}

function resultEqual(exp: any, got: any, path: string, tols: any): boolean {
  if (has(tols, path) && isNum(exp) && isNum(got)) return Math.abs(got - exp) <= tols[path];
  if (Array.isArray(exp)) {
    if (!Array.isArray(got) || got.length !== exp.length) return false;
    return exp.every((e, i) => resultEqual(e, got[i], path + '.' + i, tols));
  }
  if (isObject(exp)) {
    if (!isObject(got)) return false;
    const ke = Object.keys(exp);
    if (ke.length !== Object.keys(got).length) return false;
    return ke.every((k) => has(got, k) && resultEqual(exp[k], got[k], path + '.' + k, tols));
  }
  return jsonEqual(exp, got);
}

export function judge(c: any, answer: any): { pass: boolean; failed?: string[] } {
  if (answer === null) return { pass: false, failed: ['answer'] };
  const failed: string[] = [];
  c.checks.forEach((k: any, i: number) => {
    if (!holds(k, answer)) failed.push('checks.' + i);
  });
  const full = c.full;
  if (full !== null) {
    const members = Object.keys(answer).sort();
    if (members.length !== full.members.length || members.some((m, i) => m !== full.members[i])) failed.push('members');
    if (has(full, 'error')) {
      if (!has(answer, 'error') || !jsonEqual(answer.error, full.error)) failed.push('error');
    } else {
      if (has(full, 'result') && (!has(answer, 'result') || !resultEqual(full.result, answer.result, 'result', full.tolerances))) {
        failed.push('result');
      }
      if (has(full, 'audit') && (!has(answer, 'audit') || answer.audit !== full.audit)) failed.push('audit');
    }
  }
  return failed.length ? { pass: false, failed } : { pass: true };
}
