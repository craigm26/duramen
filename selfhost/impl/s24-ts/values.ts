/** JSON and path semantics shared by the checker and judge. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export const own = (value: any, name: string): boolean => value != null && Object.hasOwn(value, name);
export const object = (value: any): boolean => value !== null && typeof value === 'object' && !Array.isArray(value);
export const dict = (): Record<string, any> => Object.create(null);
export const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export function finite(value: any): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (value !== null && typeof value === 'object') return Object.values(value).every(finite);
  return true;
}
export function json(text: string): any {
  const value = JSON.parse(text);
  if (!finite(value)) throw new Error('Nonfinite JSON number');
  return value;
}
export function number(text: string): number | undefined {
  try { const value = json(text); return typeof value === 'number' ? value : undefined; }
  catch { return undefined; }
}
export function relative(name: string): boolean {
  return name.length > 0 && !/[\\\0]/.test(name) && !/^[a-z]:/i.test(name) &&
    name.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}
export const missing = Symbol('missing');
export function atPath(answer: any, path: string): any {
  const names = path.split('.');
  let current = answer;
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(name) || !own(current, name)) return missing;
    } else if (!object(current) || !own(current, name)) return missing;
    current = current[name];
    if (i === 0 && name === 'audit' && names.length > 1) {
      if (typeof current !== 'string') return missing;
      try { current = json(current); } catch { return missing; }
    }
  }
  return current;
}
export function equal(actual: any, expected: any, tolerances: Record<string, number> = {}, path = ''): boolean {
  if (typeof actual === 'number' && typeof expected === 'number' && own(tolerances, path)) {
    return Math.abs(actual - expected) <= tolerances[path];
  }
  if (actual === expected) return true;
  if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') return false;
  if (Array.isArray(actual) !== Array.isArray(expected)) return false;
  const keys = Object.keys(expected);
  return Object.keys(actual).length === keys.length && keys.every(key => own(actual, key) &&
    equal(actual[key], expected[key], tolerances, path ? path + '.' + key : key));
}
export function meets(check: any, answer: any): boolean {
  const actual = atPath(answer, check.path);
  if (actual === missing) return false;
  if (check.kind === 'eq') return equal(actual, check.value);
  if (check.kind === 'approx') return typeof actual === 'number' && Math.abs(actual - check.value) <= check.tol;
  return false;
}
