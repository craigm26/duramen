import { object, own, equal, meets, finite } from './values.ts';

export function validJudge(input: any): boolean {
  if (!finite(input)) return false;
  const c = input.case;
  if (!object(c) || !Array.isArray(c.checks) || !own(c, 'full') || !own(input, 'answer')) return false;
  if (input.answer !== null && !object(input.answer)) return false;
  for (const check of c.checks) {
    if (!object(check) || typeof check.path !== 'string' || typeof check.kind !== 'string') return false;
    if (check.kind === 'eq') { if (!own(check, 'value')) return false; }
    else if (check.kind === 'approx') {
      if (typeof check.value !== 'number' || typeof check.tol !== 'number' || !(check.tol >= 0)) return false;
    } else return false;
  }
  const f = c.full;
  if (f === null) return true;
  return object(f) && Array.isArray(f.members) && f.members.every((x: any) => typeof x === 'string') &&
    object(f.tolerances) && Object.values(f.tolerances).every((x: any) => typeof x === 'number' && x >= 0) &&
    (!own(f, 'audit') || typeof f.audit === 'string');
}
export function judge(c: any, answer: any): any {
  if (answer === null) return { pass: false, failed: ['answer'] };
  const failed: string[] = [];
  c.checks.forEach((check: any, i: number) => { if (!meets(check, answer)) failed.push('checks.' + i); });
  const f = c.full;
  if (f !== null) {
    if (!equal(Object.keys(answer).sort(), f.members)) failed.push('members');
    if (own(f, 'error')) {
      if (!own(answer, 'error') || !equal(answer.error, f.error)) failed.push('error');
    } else {
      if (own(f, 'result') && (!own(answer, 'result') || !equal(answer.result, f.result, f.tolerances, 'result'))) failed.push('result');
      if (own(f, 'audit') && (!own(answer, 'audit') || answer.audit !== f.audit)) failed.push('audit');
    }
  }
  return failed.length ? { pass: false, failed } : { pass: true };
}
