// Judging an answer against a case (REQ-JU-001 to REQ-JU-004).

import { cmpUnits, hasOwn, isPlainObject, jsonEqual, readPath } from './json.ts';
import type { JsonObject } from './json.ts';

const isNum = (v: unknown): v is number => typeof v === 'number';
const isTol = (v: unknown): v is number => isNum(v) && v >= 0;

/** Whether `input` has the form REQ-JU-001 gives for `judge`. */
export function validJudgeInput(input: JsonObject): boolean {
  if (!hasOwn(input, 'case') || !hasOwn(input, 'answer')) return false;
  const c = input.case;
  const answer = input.answer;
  if (!isPlainObject(c)) return false;
  if (answer !== null && !isPlainObject(answer)) return false;
  if (!hasOwn(c, 'checks') || !Array.isArray(c.checks)) return false;
  for (const check of c.checks) {
    if (!isPlainObject(check) || typeof check.path !== 'string' || !hasOwn(check, 'kind')) return false;
    if (check.kind === 'eq' && !hasOwn(check, 'value')) return false;
    if (check.kind === 'approx' && !(isNum(check.value) && isTol(check.tol))) return false;
  }
  if (!hasOwn(c, 'full')) return false;
  const full = c.full;
  if (full === null) return true;
  if (!isPlainObject(full)) return false;
  if (!Array.isArray(full.members) || !full.members.every((m) => typeof m === 'string')) return false;
  if (!isPlainObject(full.tolerances)) return false;
  const tols = full.tolerances;
  if (!Object.keys(tols).every((k) => isTol(tols[k]))) return false;
  if (hasOwn(full, 'audit') && typeof full.audit !== 'string') return false;
  return true;
}

function within(actual: unknown, expected: number, tol: number): boolean {
  return isNum(actual) && Math.abs(actual - expected) <= tol;
}

/** The answer's result against the expected one, numbers at named paths within tolerance. */
function resultMatches(expected: unknown, actual: unknown, path: string, tols: JsonObject): boolean {
  if (isNum(expected) && hasOwn(tols, path)) return within(actual, expected, tols[path] as number);
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((x, i) => resultMatches(x, actual[i], `${path}.${i}`, tols))
    );
  }
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) return false;
    const ek = Object.keys(expected);
    const ak = Object.keys(actual);
    return (
      ek.length === ak.length &&
      ek.every((k) => hasOwn(actual, k) && resultMatches(expected[k], actual[k], `${path}.${k}`, tols))
    );
  }
  return jsonEqual(expected, actual);
}

export function judge(input: JsonObject): JsonObject {
  const c = input.case as JsonObject;
  const answer = input.answer;
  if (answer === null) return { pass: false, failed: ['answer'] };
  const a = answer as JsonObject;
  const failed: string[] = [];
  (c.checks as JsonObject[]).forEach((check, n) => {
    const v = readPath(a, check.path as string);
    let ok: boolean;
    if (check.kind === 'eq') ok = v !== undefined && jsonEqual(v.value, check.value);
    else if (check.kind === 'approx') ok = v !== undefined && within(v.value, check.value as number, check.tol as number);
    else ok = false; // checks of other kinds are open (OPEN-JU-001)
    if (!ok) failed.push(`checks.${n}`);
  });
  const full = c.full;
  if (isPlainObject(full)) {
    const members = Object.keys(a).sort(cmpUnits);
    const want = full.members as string[];
    if (members.length !== want.length || members.some((m, i) => m !== want[i])) failed.push('members');
    if (hasOwn(full, 'error')) {
      if (!hasOwn(a, 'error') || !jsonEqual(a.error, full.error)) failed.push('error');
    } else {
      if (hasOwn(full, 'result')) {
        const tols = full.tolerances as JsonObject;
        if (!hasOwn(a, 'result') || !resultMatches(full.result, a.result, 'result', tols)) failed.push('result');
      }
      if (hasOwn(full, 'audit') && a.audit !== full.audit) failed.push('audit');
    }
  }
  return failed.length === 0 ? { pass: true } : { pass: false, failed };
}
