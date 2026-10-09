// Judging an answer against a case (REQ-JU-001 to REQ-JU-004).

import { hasOwn, isObject, jsonEqual, readPath } from './json.ts';
import type { Obj } from './json.ts';

function isTolerance(v: unknown): boolean {
  return typeof v === 'number' && v >= 0;
}

/** True when `input` has the form REQ-JU-001 gives. */
export function validJudgeInput(input: Obj): boolean {
  if (!hasOwn(input, 'case') || !hasOwn(input, 'answer')) return false;
  const c = input.case;
  const answer = input.answer;
  if (!isObject(c)) return false;
  if (answer !== null && !isObject(answer)) return false;
  if (!Array.isArray(c.checks)) return false;
  for (const ch of c.checks) {
    if (!isObject(ch) || typeof ch.path !== 'string' || typeof ch.kind !== 'string') return false;
    if (ch.kind === 'eq' && !hasOwn(ch, 'value')) return false;
    if (ch.kind === 'approx' && (typeof ch.value !== 'number' || !isTolerance(ch.tol))) return false;
  }
  if (!hasOwn(c, 'full')) return false;
  const full = c.full;
  if (full === null) return true;
  if (!isObject(full)) return false;
  if (!Array.isArray(full.members) || !full.members.every((m) => typeof m === 'string')) return false;
  if (!isObject(full.tolerances)) return false;
  const tols = full.tolerances;
  if (!Object.keys(tols).every((k) => isTolerance(tols[k]))) return false;
  if (hasOwn(full, 'audit') && typeof full.audit !== 'string') return false;
  return true;
}

function meetsCheck(answer: Obj, check: Obj): boolean {
  const v = readPath(answer, check.path as string);
  if (!v.found) return false;
  if (check.kind === 'eq') return jsonEqual(v.value, check.value);
  if (check.kind === 'approx') {
    return typeof v.value === 'number' && Math.abs(v.value - (check.value as number)) <= (check.tol as number);
  }
  // Checks of other kinds are open (OPEN-JU-001); this judge holds none of them.
  return false;
}

/** Equal as JSON values, except that a number at a path `tols` names may be that far off. */
function equalWithin(expected: unknown, actual: unknown, path: string, tols: Obj): boolean {
  if (typeof expected === 'number' && hasOwn(tols, path)) {
    return typeof actual === 'number' && Math.abs(actual - expected) <= (tols[path] as number);
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((e, i) => equalWithin(e, actual[i], `${path}.${i}`, tols));
  }
  if (isObject(expected)) {
    if (!isObject(actual)) return false;
    const ke = Object.keys(expected);
    if (ke.length !== Object.keys(actual).length) return false;
    return ke.every((k) => hasOwn(actual, k) && equalWithin(expected[k], actual[k], `${path}.${k}`, tols));
  }
  return jsonEqual(expected, actual);
}

export function judge(input: Obj): Obj {
  const c = input.case as Obj;
  const answer = input.answer as Obj | null;
  if (answer === null) return { pass: false, failed: ['answer'] };
  const failed: string[] = [];
  (c.checks as Obj[]).forEach((ch, i) => {
    if (!meetsCheck(answer, ch)) failed.push(`checks.${i}`);
  });
  const full = c.full as Obj | null;
  if (full !== null) {
    const members = Object.keys(answer).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const want = full.members as string[];
    if (members.length !== want.length || members.some((m, i) => m !== want[i])) failed.push('members');
    if (hasOwn(full, 'error')) {
      if (!hasOwn(answer, 'error') || !jsonEqual(answer.error, full.error)) failed.push('error');
    } else {
      if (hasOwn(full, 'result')) {
        const ok = hasOwn(answer, 'result') && equalWithin(full.result, answer.result, 'result', full.tolerances as Obj);
        if (!ok) failed.push('result');
      }
      if (hasOwn(full, 'audit') && answer.audit !== full.audit) failed.push('audit');
    }
  }
  return failed.length === 0 ? { pass: true } : { pass: false, failed };
}
