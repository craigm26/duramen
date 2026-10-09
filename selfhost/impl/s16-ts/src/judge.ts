// The `judge` operation (REQ-JU-001 to REQ-JU-004).

import { hasOwn, isObject, jsonEqual, readPath, type JsonObject } from './util.ts';

const isNumber = (v: unknown): v is number => typeof v === 'number';

/** True when `case` and `answer` have the forms REQ-JU-001 gives. */
export function validJudgeInput(input: JsonObject): boolean {
  if (!hasOwn(input, 'case') || !hasOwn(input, 'answer')) return false;
  const c = input.case;
  const answer = input.answer;
  if (!isObject(c) || !(answer === null || isObject(answer))) return false;
  if (!hasOwn(c, 'checks') || !Array.isArray(c.checks)) return false;
  for (const chk of c.checks) {
    if (!isObject(chk) || typeof chk.path !== 'string' || !hasOwn(chk, 'kind')) return false;
    if (chk.kind === 'eq' && !hasOwn(chk, 'value')) return false;
    if (chk.kind === 'approx' && !(isNumber(chk.value) && isNumber(chk.tol) && chk.tol >= 0)) return false;
  }
  if (!hasOwn(c, 'full')) return false;
  const full = c.full;
  if (full === null) return true;
  if (!isObject(full)) return false;
  if (!Array.isArray(full.members) || !full.members.every((m) => typeof m === 'string')) return false;
  if (!isObject(full.tolerances)) return false;
  const tols = full.tolerances;
  if (!Object.keys(tols).every((k) => isNumber(tols[k]) && (tols[k] as number) >= 0)) return false;
  if (hasOwn(full, 'audit') && typeof full.audit !== 'string') return false;
  return true;
}

function within(got: unknown, value: number, tol: number): boolean {
  return isNumber(got) && Math.abs(got - value) <= tol;
}

/** Equal as JSON values, except that numbers at the paths `tolerances` names may differ. */
function equalWithin(expected: unknown, got: unknown, path: string, tols: JsonObject): boolean {
  if (isNumber(expected) && hasOwn(tols, path)) return within(got, expected, tols[path] as number);
  if (Array.isArray(expected)) {
    if (!Array.isArray(got) || got.length !== expected.length) return false;
    return expected.every((x, i) => equalWithin(x, got[i], `${path}.${i}`, tols));
  }
  if (isObject(expected)) {
    if (!isObject(got)) return false;
    const ke = Object.keys(expected);
    if (ke.length !== Object.keys(got).length) return false;
    return ke.every((k) => hasOwn(got, k) && equalWithin(expected[k], got[k], `${path}.${k}`, tols));
  }
  return jsonEqual(expected, got);
}

export function judge(input: JsonObject): { pass: boolean; failed?: string[] } {
  const c = input.case as JsonObject;
  const answer = input.answer;
  if (!isObject(answer)) return { pass: false, failed: ['answer'] };
  const failed: string[] = [];
  (c.checks as JsonObject[]).forEach((chk, i) => {
    const got = readPath(answer, chk.path as string);
    let ok: boolean;
    if (chk.kind === 'eq') ok = got !== undefined && jsonEqual(got.value, chk.value);
    else if (chk.kind === 'approx') ok = got !== undefined && within(got.value, chk.value as number, chk.tol as number);
    else ok = false; // Checks of other kinds are open (OPEN-JU-001).
    if (!ok) failed.push(`checks.${i}`);
  });
  const full = c.full;
  if (isObject(full)) {
    const members = Object.keys(answer).sort();
    const want = full.members as string[];
    if (members.length !== want.length || members.some((m, i) => m !== want[i])) failed.push('members');
    if (hasOwn(full, 'error')) {
      if (!hasOwn(answer, 'error') || !jsonEqual(answer.error, full.error)) failed.push('error');
    } else {
      const tols = full.tolerances as JsonObject;
      if (hasOwn(full, 'result') && !(hasOwn(answer, 'result') && equalWithin(full.result, answer.result, 'result', tols))) {
        failed.push('result');
      }
      if (hasOwn(full, 'audit') && !(hasOwn(answer, 'audit') && answer.audit === full.audit)) failed.push('audit');
    }
  }
  return failed.length === 0 ? { pass: true } : { pass: false, failed };
}
