// Judging an answer against a case (REQ-JU-*).

import { getOwn, hasOwn, isObj, jsonEqual, lookup } from './json.ts';

export type Verdict = { pass: true } | { pass: false; failed: string[] };

// Returns null when the case or the answer has a form REQ-JU-001 does not give.
export function judge(c: unknown, answer: unknown): Verdict | null {
  if (!isObj(c)) return null;
  const checks = getOwn(c, 'checks');
  if (!Array.isArray(checks)) return null;
  for (const k of checks) {
    if (!isObj(k) || typeof getOwn(k, 'path') !== 'string' || !hasOwn(k, 'kind')) return null;
    const kind = getOwn(k, 'kind');
    if (kind === 'eq') {
      if (!hasOwn(k, 'value')) return null;
    } else if (kind === 'approx') {
      const v = getOwn(k, 'value');
      const t = getOwn(k, 'tol');
      if (typeof v !== 'number' || typeof t !== 'number' || !(t >= 0)) return null;
    }
  }
  if (!hasOwn(c, 'full')) return null;
  const full = getOwn(c, 'full');
  if (full !== null) {
    if (!isObj(full)) return null;
    const members = getOwn(full, 'members');
    if (!Array.isArray(members) || !members.every((m) => typeof m === 'string')) return null;
    const tols = getOwn(full, 'tolerances');
    if (!isObj(tols)) return null;
    for (const k of Object.keys(tols)) {
      const t = getOwn(tols, k);
      if (typeof t !== 'number' || !(t >= 0)) return null;
    }
    if (hasOwn(full, 'audit') && typeof getOwn(full, 'audit') !== 'string') return null;
  }
  if (answer !== null && !isObj(answer)) return null;

  if (answer === null) return { pass: false, failed: ['answer'] };
  const failed: string[] = [];
  checks.forEach((k: Record<string, unknown>, i: number) => {
    const f = lookup(answer, getOwn(k, 'path') as string);
    const kind = getOwn(k, 'kind');
    let ok = false;
    if (kind === 'eq') ok = f.found && jsonEqual(f.value, getOwn(k, 'value'));
    else if (kind === 'approx')
      ok =
        f.found &&
        typeof f.value === 'number' &&
        Math.abs(f.value - (getOwn(k, 'value') as number)) <= (getOwn(k, 'tol') as number);
    if (!ok) failed.push(`checks.${i}`);
  });
  if (full !== null) {
    const f = full as Record<string, unknown>;
    const names = Object.keys(answer).sort();
    const members = getOwn(f, 'members') as string[];
    if (names.length !== members.length || names.some((n, i) => n !== members[i])) failed.push('members');
    if (hasOwn(f, 'error')) {
      if (!hasOwn(answer, 'error') || !jsonEqual(getOwn(answer, 'error'), getOwn(f, 'error'))) failed.push('error');
    } else {
      if (hasOwn(f, 'result')) {
        const tols = getOwn(f, 'tolerances') as Record<string, number>;
        if (!hasOwn(answer, 'result') || !eqTol(getOwn(answer, 'result'), getOwn(f, 'result'), 'result', tols))
          failed.push('result');
      }
      if (hasOwn(f, 'audit')) {
        if (!hasOwn(answer, 'audit') || getOwn(answer, 'audit') !== getOwn(f, 'audit')) failed.push('audit');
      }
    }
  }
  return failed.length ? { pass: false, failed } : { pass: true };
}

function eqTol(a: unknown, b: unknown, path: string, tols: Record<string, number>): boolean {
  if (typeof b === 'number') {
    if (typeof a !== 'number') return false;
    if (hasOwn(tols, path)) return Math.abs(a - b) <= (getOwn(tols, path) as number);
    return a === b;
  }
  if (Array.isArray(b)) {
    if (!Array.isArray(a) || a.length !== b.length) return false;
    return b.every((x, i) => eqTol(a[i], x, `${path}.${i}`, tols));
  }
  if (isObj(b)) {
    if (!isObj(a)) return false;
    const kb = Object.keys(b);
    if (Object.keys(a).length !== kb.length) return false;
    return kb.every((k) => hasOwn(a, k) && eqTol(getOwn(a, k), getOwn(b, k), `${path}.${k}`, tols));
  }
  return jsonEqual(a, b);
}
