// Judging an answer against a case (REQ-JU-001 to REQ-JU-004).

import { deepEqual, getPath, hasOwn, isObject } from './util.ts';
import type { Obj } from './util.ts';

function isNum(v: unknown): v is number {
  return typeof v === 'number';
}

// The forms REQ-JU-001 gives; null when the case or the answer has another.
export function validJudgeInput(input: Obj): boolean {
  if (!hasOwn(input, 'case') || !hasOwn(input, 'answer')) return false;
  const c = input.case;
  if (!isObject(c)) return false;
  if (!Array.isArray(c.checks)) return false;
  for (const k of c.checks) {
    if (!isObject(k) || typeof k.path !== 'string' || typeof k.kind !== 'string') return false;
    if (k.kind === 'eq' && !hasOwn(k, 'value')) return false;
    if (k.kind === 'approx') {
      if (!isNum(k.value) || !isNum(k.tol) || k.tol < 0) return false;
    }
  }
  if (!hasOwn(c, 'full')) return false;
  const f = c.full;
  if (f !== null) {
    if (!isObject(f)) return false;
    if (!Array.isArray(f.members) || !f.members.every((m) => typeof m === 'string')) return false;
    if (!isObject(f.tolerances)) return false;
    for (const k of Object.keys(f.tolerances)) {
      const t = f.tolerances[k];
      if (!isNum(t) || t < 0) return false;
    }
    if (hasOwn(f, 'audit') && typeof f.audit !== 'string') return false;
  }
  const a = input.answer;
  return a === null || isObject(a);
}

function sameWithin(expected: unknown, actual: unknown, path: string, tol: Obj): boolean {
  if (typeof expected === 'number' && typeof actual === 'number' && hasOwn(tol, path)) {
    return Math.abs(actual - expected) <= (tol[path] as number);
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((e, i) => sameWithin(e, actual[i], path + '.' + i, tol));
  }
  if (isObject(expected)) {
    if (!isObject(actual)) return false;
    const ke = Object.keys(expected);
    if (ke.length !== Object.keys(actual).length) return false;
    return ke.every((k) => hasOwn(actual, k) && sameWithin(expected[k], actual[k], path + '.' + k, tol));
  }
  return deepEqual(expected, actual);
}

export function judge(input: Obj): Obj {
  const c = input.case as Obj;
  const answer = input.answer as Obj | null;
  if (answer === null) return { pass: false, failed: ['answer'] };
  const failed: string[] = [];
  (c.checks as Obj[]).forEach((k, i) => {
    const g = getPath(answer, k.path as string);
    let ok = false;
    if (k.kind === 'eq') ok = g.found && deepEqual(g.value, k.value);
    else if (k.kind === 'approx') {
      ok = g.found && isNum(g.value) && Math.abs(g.value - (k.value as number)) <= (k.tol as number);
    }
    if (!ok) failed.push('checks.' + i);
  });
  const full = c.full as Obj | null;
  if (full !== null) {
    const members = Object.keys(answer).sort();
    const want = full.members as string[];
    if (members.length !== want.length || members.some((m, i) => m !== want[i])) failed.push('members');
    if (hasOwn(full, 'error')) {
      if (!hasOwn(answer, 'error') || !deepEqual(answer.error, full.error)) failed.push('error');
    } else {
      if (hasOwn(full, 'result')) {
        if (!hasOwn(answer, 'result') || !sameWithin(full.result, answer.result, 'result', full.tolerances as Obj)) {
          failed.push('result');
        }
      }
      if (hasOwn(full, 'audit')) {
        if (typeof answer.audit !== 'string' || answer.audit !== full.audit) failed.push('audit');
      }
    }
  }
  return failed.length === 0 ? { pass: true } : { pass: false, failed };
}
