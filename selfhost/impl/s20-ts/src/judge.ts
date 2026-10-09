import { deepEqual, hasOwn, isObj, lookup, setOwn } from './util.ts';

// Whether input has the forms REQ-JU-001 gives.
export function validJudgeInput(input: any): boolean {
  if (!hasOwn(input, 'case') || !hasOwn(input, 'answer')) return false;
  const c = input.case;
  if (!isObj(c) || !hasOwn(c, 'checks') || !Array.isArray(c.checks) || !hasOwn(c, 'full')) return false;
  for (const ck of c.checks) {
    if (!isObj(ck) || typeof ck.path !== 'string' || typeof ck.kind !== 'string') return false;
    if (ck.kind === 'eq' && !hasOwn(ck, 'value')) return false;
    if (ck.kind === 'approx') {
      if (typeof ck.value !== 'number' || typeof ck.tol !== 'number' || !(ck.tol >= 0)) return false;
    }
  }
  const f = c.full;
  if (f !== null) {
    if (!isObj(f)) return false;
    if (!Array.isArray(f.members) || !f.members.every((m: any) => typeof m === 'string')) return false;
    if (!isObj(f.tolerances)) return false;
    if (!Object.values(f.tolerances).every((t: any) => typeof t === 'number' && t >= 0)) return false;
    if (hasOwn(f, 'audit') && typeof f.audit !== 'string') return false;
  }
  return input.answer === null || isObj(input.answer);
}

function met(ck: any, answer: any): boolean {
  const r = lookup(answer, ck.path);
  if (!r.found) return false;
  if (ck.kind === 'eq') return deepEqual(r.value, ck.value);
  if (ck.kind === 'approx') return typeof r.value === 'number' && Math.abs(r.value - ck.value) <= ck.tol;
  return false;
}

function equalWithin(exp: any, act: any, path: string, tols: any): boolean {
  if (typeof exp === 'number' && hasOwn(tols, path)) {
    return typeof act === 'number' && Math.abs(act - exp) <= tols[path];
  }
  if (Array.isArray(exp)) {
    return Array.isArray(act) && act.length === exp.length && exp.every((x, i) => equalWithin(x, act[i], path + '.' + i, tols));
  }
  if (isObj(exp)) {
    if (!isObj(act)) return false;
    const ke = Object.keys(exp);
    return ke.length === Object.keys(act).length && ke.every((k) => hasOwn(act, k) && equalWithin(exp[k], act[k], path + '.' + k, tols));
  }
  return exp === act;
}

export function judge(c: any, answer: any): any {
  if (answer === null) return { pass: false, failed: ['answer'] };
  const failed: string[] = [];
  c.checks.forEach((ck: any, i: number) => {
    if (!met(ck, answer)) failed.push('checks.' + i);
  });
  const f = c.full;
  if (f !== null) {
    const members = Object.keys(answer).sort();
    if (members.length !== f.members.length || members.some((m, i) => m !== f.members[i])) failed.push('members');
    if (hasOwn(f, 'error')) {
      if (!hasOwn(answer, 'error') || !deepEqual(answer.error, f.error)) failed.push('error');
    } else {
      if (hasOwn(f, 'result')) {
        if (!hasOwn(answer, 'result') || !equalWithin(f.result, answer.result, 'result', f.tolerances)) failed.push('result');
      }
      if (hasOwn(f, 'audit')) {
        if (!hasOwn(answer, 'audit') || answer.audit !== f.audit) failed.push('audit');
      }
    }
  }
  const out: any = { pass: failed.length === 0 };
  if (failed.length) setOwn(out, 'failed', failed);
  return out;
}
