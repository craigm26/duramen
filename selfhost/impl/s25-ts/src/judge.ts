// `judge`: whether an answer meets a case (REQ-JU-001 to REQ-JU-004).

import { deepEqual, getPath, hasOwn, isObj } from './util.ts';

export class BadRequest extends Error {}

const isNum = (v: unknown): v is number => typeof v === 'number';

function validate(input: Record<string, any>): void {
  if (!hasOwn(input, 'case') || !hasOwn(input, 'answer')) throw new BadRequest();
  const c = input.case;
  if (!isObj(c) || !Array.isArray(c.checks) || !hasOwn(c, 'full')) throw new BadRequest();
  for (const ch of c.checks) {
    if (!isObj(ch) || typeof ch.path !== 'string' || typeof ch.kind !== 'string') throw new BadRequest();
    if (ch.kind === 'eq' && !hasOwn(ch, 'value')) throw new BadRequest();
    if (ch.kind === 'approx' && !(isNum(ch.value) && isNum(ch.tol) && ch.tol >= 0)) throw new BadRequest();
  }
  const f = c.full;
  if (f !== null) {
    if (!isObj(f)) throw new BadRequest();
    if (!Array.isArray(f.members) || !f.members.every((x: unknown) => typeof x === 'string')) throw new BadRequest();
    if (!isObj(f.tolerances) || !Object.keys(f.tolerances).every((k) => isNum(f.tolerances[k]) && f.tolerances[k] >= 0)) {
      throw new BadRequest();
    }
    if (hasOwn(f, 'audit') && typeof f.audit !== 'string') throw new BadRequest();
  }
  if (input.answer !== null && !isObj(input.answer)) throw new BadRequest();
}

function checkHolds(ch: Record<string, any>, answer: Record<string, any>): boolean {
  const got = getPath(answer, ch.path);
  if (!got.found) return false;
  if (ch.kind === 'eq') return deepEqual(got.value, ch.value);
  if (ch.kind === 'approx') return isNum(got.value) && Math.abs(got.value - ch.value) <= ch.tol;
  return false;
}

// Equal as JSON values, a number at a path of `tols` within its tolerance.
function resultEqual(a: any, b: any, path: string, tols: Record<string, number>): boolean {
  if (isNum(a) && isNum(b)) {
    if (hasOwn(tols, path)) return Math.abs(a - b) <= tols[path];
    return a === b;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => resultEqual(x, b[i], path + '.' + i, tols));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return (
      ka.length === Object.keys(b).length &&
      ka.every((k) => hasOwn(b, k) && resultEqual(a[k], b[k], path + '.' + k, tols))
    );
  }
  return deepEqual(a, b);
}

export function judge(input: Record<string, any>): { pass: boolean; failed?: string[] } {
  validate(input);
  const { case: c, answer } = input;
  if (answer === null) return { pass: false, failed: ['answer'] };
  const failed: string[] = [];
  c.checks.forEach((ch: Record<string, any>, n: number) => {
    if (!checkHolds(ch, answer)) failed.push('checks.' + n);
  });
  const f = c.full;
  if (f !== null) {
    const members = Object.keys(answer).sort();
    if (!deepEqual(members, f.members)) failed.push('members');
    if (hasOwn(f, 'error')) {
      if (!hasOwn(answer, 'error') || !deepEqual(answer.error, f.error)) failed.push('error');
    } else {
      if (hasOwn(f, 'result') && (!hasOwn(answer, 'result') || !resultEqual(answer.result, f.result, 'result', f.tolerances))) {
        failed.push('result');
      }
      if (hasOwn(f, 'audit') && (!hasOwn(answer, 'audit') || answer.audit !== f.audit)) failed.push('audit');
    }
  }
  return failed.length === 0 ? { pass: true } : { pass: false, failed };
}
