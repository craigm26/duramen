export const absent = Symbol('absent');
export function object(value: any): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export const own = (value: any, name: string): boolean => value != null && Object.hasOwn(value, name);
export const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export function finite(value: any): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (value !== null && typeof value === 'object') return Object.values(value).every(finite);
  return true;
}
export function json(text: string): any {
  try { const value = JSON.parse(text); return finite(value) ? value : absent; }
  catch { return absent; }
}
export function number(text: string): number | typeof absent {
  const value = json(text);
  return typeof value === 'number' ? value : absent;
}
export function equal(a: any, b: any, tolerances: Record<string, number> = {}, path = ''): boolean {
  if (typeof a === 'number' && typeof b === 'number' && own(tolerances, path)) {
    return Math.abs(a - b) <= tolerances[path];
  }
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a), other = Object.keys(b);
  return keys.length === other.length && keys.every(key => own(b, key) && equal(a[key], b[key], tolerances, path ? path + '.' + key : key));
}
export function readPath(answer: any, path: string): any {
  const parts = path.split('.');
  let value = answer;
  for (let i = 0; i < parts.length; i++) {
    if (i === 1 && parts[0] === 'audit') {
      value = typeof value === 'string' ? json(value) : absent;
    }
    const name = parts[i];
    if (Array.isArray(value)) {
      if (!/^(0|[1-9][0-9]*)$/.test(name) || !own(value, name)) return absent;
    } else if (!object(value) || !own(value, name)) return absent;
    value = value[name];
  }
  return value;
}
export function meets(check: any, answer: any): boolean {
  const value = readPath(answer, check.path);
  if (value === absent) return false;
  if (check.kind === 'eq') return equal(value, check.value);
  if (check.kind === 'approx') return typeof value === 'number' && Math.abs(value - check.value) <= check.tol;
  return false;
}
export function validJudge(input: any): boolean {
  const c = input.case;
  if (!object(c) || !Array.isArray(c.checks) || !own(input, 'answer') || !(input.answer === null || object(input.answer))) return false;
  if (!c.checks.every((check: any) => object(check) && typeof check.path === 'string' &&
    (check.kind === 'eq' ? own(check, 'value') : check.kind === 'approx' && typeof check.value === 'number' && typeof check.tol === 'number' && check.tol >= 0))) return false;
  const full = c.full;
  return full === null || object(full) && Array.isArray(full.members) && full.members.every((name: any) => typeof name === 'string') &&
    object(full.tolerances) && Object.values(full.tolerances).every((n: any) => typeof n === 'number' && n >= 0) && (!own(full, 'audit') || typeof full.audit === 'string');
}
export function judge(c: any, answer: any): any {
  if (answer === null) return { pass: false, failed: ['answer'] };
  const failed: string[] = [];
  c.checks.forEach((check: any, i: number) => { if (!meets(check, answer)) failed.push('checks.' + i); });
  const f = c.full;
  if (f !== null) {
    if (!equal(Object.keys(answer).sort(compare), f.members)) failed.push('members');
    if (own(f, 'error')) {
      if (!own(answer, 'error') || !equal(answer.error, f.error)) failed.push('error');
    } else {
      if (own(f, 'result') && (!own(answer, 'result') || !equal(answer.result, f.result, f.tolerances, 'result'))) failed.push('result');
      if (own(f, 'audit') && (!own(answer, 'audit') || answer.audit !== f.audit)) failed.push('audit');
    }
  }
  return failed.length ? { pass: false, failed } : { pass: true };
}
