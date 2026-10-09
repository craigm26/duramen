// JSON helpers shared by the checker and the judge.

export type Obj = Record<string, unknown>;

export function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function hasOwn(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

/** Sets an own member, also for names such as `__proto__`; a member set again keeps its place. */
export function setOwn(o: object, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
}

/** True when every number in the value is finite (REQ-SY-013). */
export function allFinite(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(allFinite);
  if (isObject(v)) return Object.keys(v).every((k) => allFinite(v[k]));
  return true;
}

export type Parsed = { ok: true; value: unknown } | { ok: false };

/** Parses JSON text; a number too large to be finite makes it fail, as text that is not JSON does. */
export function parseJson(text: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!allFinite(value)) return { ok: false };
  return { ok: true, value };
}

const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

/** A JSON number that is finite in binary64, or null. */
export function parseNumber(text: string): number | null {
  if (!NUMBER.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** A JSON number of 0 or more (`-0` is 0), or null. */
export function parseTolerance(text: string): number | null {
  const n = parseNumber(text);
  if (n === null || n < 0) return null;
  return n === 0 ? 0 : n;
}

/** Two JSON values are equal: object members in any order, numbers by value. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') return a === b;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  if (isObject(a) || isObject(b)) {
    if (!isObject(a) || !isObject(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!hasOwn(b, k) || !jsonEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return a === b;
}

const INDEX = /^(?:0|[1-9][0-9]*)$/;

function step(v: unknown, name: string): { found: boolean; value?: unknown } {
  if (Array.isArray(v)) {
    if (!INDEX.test(name)) return { found: false };
    const i = Number(name);
    if (i >= v.length) return { found: false };
    return { found: true, value: v[i] };
  }
  if (isObject(v)) {
    if (!hasOwn(v, name)) return { found: false };
    return { found: true, value: v[name] };
  }
  return { found: false };
}

/**
 * Reads a path in a response or answer (REQ-OR-003, REQ-JU-002): names separated by dots;
 * after `audit`, the rest is read in the JSON value its text holds.
 */
export function readPath(root: Obj, path: string): { found: boolean; value?: unknown } {
  const names = path.split('.');
  let cur: { found: boolean; value?: unknown } = step(root, names[0]);
  let i = 1;
  if (names[0] === 'audit' && names.length > 1) {
    if (!cur.found || typeof cur.value !== 'string') return { found: false };
    const p = parseJson(cur.value);
    if (!p.ok) return { found: false };
    cur = { found: true, value: p.value };
  }
  for (; i < names.length && cur.found; i++) cur = step(cur.value, names[i]);
  return cur;
}
