// JSON helpers shared by the reader, the checker and the suite.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type Parsed = { ok: true; value: Json } | { ok: false };

/** Parses JSON text; numbers too large for binary64 make it fail (REQ-SY-013). */
export function parseJson(text: string): Parsed {
  let value: Json;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (hasNonFinite(value)) return { ok: false };
  return { ok: true, value };
}

/** Parses JSON text without refusing large numbers. */
export function parseLoose(text: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export function hasNonFinite(v: unknown): boolean {
  if (typeof v === 'number') return !Number.isFinite(v);
  if (Array.isArray(v)) return v.some(hasNonFinite);
  if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v)) if (hasNonFinite((v as Record<string, unknown>)[k])) return true;
  }
  return false;
}

export function isObject(v: unknown): v is { [k: string]: Json } {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Sets an own member, also one named `__proto__`, keeping the place of one that exists. */
export function setMember(obj: object, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}

export function hasMember(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** The same JSON value: members in any order, numbers by value. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!hasMember(b, k)) return false;
    if (!jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** A JSON number that is finite as binary64, or undefined. */
export function jsonNumber(text: string): number | undefined {
  if (!NUMBER.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

export const NUMBER_SOURCE = NUMBER.source.slice(1, -1);

/** Compares strings as sequences of UTF-16 code units. */
export function compareUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
