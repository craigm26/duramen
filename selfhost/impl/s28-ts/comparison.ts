export const own = (value: any, key: string): boolean => Object.hasOwn(value, key);
export const object = (value: any): boolean => value !== null && typeof value === 'object' && !Array.isArray(value);

export function finiteJSON(value: any): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (value && typeof value === 'object') return Object.values(value).every(finiteJSON);
  return true;
}

export function readJSON(text: string): any {
  const value = JSON.parse(text);
  if (!finiteJSON(value)) throw new Error('Nonfinite JSON number');
  return value;
}

// undefined denotes absence; it is never a JSON value.
export function atPath(answer: any, path: string): any {
  const parts = path.split('.');
  let value = answer;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (Array.isArray(value)) {
      if (!/^(0|[1-9][0-9]*)$/.test(part) || !own(value, part)) return undefined;
    } else if (!object(value) || !own(value, part)) return undefined;
    value = value[part];
    if (i === 0 && part === 'audit' && parts.length > 1) {
      if (typeof value !== 'string') return undefined;
      try { value = readJSON(value); } catch { return undefined; }
    }
  }
  return value;
}

export function equal(actual: any, expected: any, tolerances: any = {}, path = ''): boolean {
  if (actual === undefined || expected === undefined) return false;
  if (typeof actual !== typeof expected) return false;
  if (typeof expected === 'number') {
    return own(tolerances, path) ? Math.abs(actual - expected) <= tolerances[path] : actual === expected;
  }
  if (actual === null || expected === null || typeof expected !== 'object') return actual === expected;
  if (Array.isArray(actual) !== Array.isArray(expected)) return false;
  const keys = Object.keys(expected);
  if (Object.keys(actual).length !== keys.length) return false;
  return keys.every(k => own(actual, k) && equal(actual[k], expected[k], tolerances, path ? path + '.' + k : k));
}

export function holds(answer: any, check: any): boolean {
  const actual = atPath(answer, check.path);
  if (actual === undefined) return false;
  if (check.kind === 'approx') return typeof actual === 'number' && Math.abs(actual - check.value) <= check.tol;
  return check.kind === 'eq' && equal(actual, check.value);
}

export function validJudge(input: any): boolean {
  if (!own(input, 'answer') || !(input.answer === null || object(input.answer)) || !object(input.case)) return false;
  const c = input.case;
  if (!Array.isArray(c.checks) || !c.checks.every((check: any) => {
    if (!object(check) || typeof check.path !== 'string' || typeof check.kind !== 'string') return false;
    if (check.kind === 'eq') return own(check, 'value');
    if (check.kind === 'approx') return typeof check.value === 'number' && typeof check.tol === 'number' && check.tol >= 0;
    return true; // Other kinds are deliberately open.
  })) return false;
  const full = c.full;
  return full === null || (object(full) && Array.isArray(full.members) && full.members.every((m: any) => typeof m === 'string') &&
    object(full.tolerances) && Object.values(full.tolerances).every(t => typeof t === 'number' && t >= 0) &&
    (!own(full, 'audit') || typeof full.audit === 'string'));
}

export function judge(c: any, answer: any): any {
  if (answer === null) return { pass: false, failed: ['answer'] };
  const failed: string[] = [];
  c.checks.forEach((check: any, i: number) => { if (!holds(answer, check)) failed.push('checks.' + i); });
  const full = c.full;
  if (full !== null) {
    if (!equal(Object.keys(answer).sort(), full.members)) failed.push('members');
    if (own(full, 'error')) {
      if (!own(answer, 'error') || !equal(answer.error, full.error)) failed.push('error');
    } else {
      if (own(full, 'result') && (!own(answer, 'result') || !equal(answer.result, full.result, full.tolerances, 'result'))) failed.push('result');
      if (own(full, 'audit') && answer.audit !== full.audit) failed.push('audit');
    }
  }
  return failed.length ? { pass: false, failed } : { pass: true };
}
