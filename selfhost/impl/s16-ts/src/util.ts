// Small helpers shared by the checker and the judge: JSON values, paths and ordering.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

/** A JSON number, as JSON writes one. */
export const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** An array index as JSON writes an integer of 0 or more. */
const INDEX = /^(?:0|[1-9]\d*)$/;

export function hasOwn(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

export function isObject(v: unknown): v is JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Sets a member as an own data property, even one named `__proto__`. */
export function setMember(o: object, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
}

/** True when a parsed JSON value holds a number too large to be finite in binary64. */
export function hasNonFinite(v: unknown): boolean {
  if (typeof v === 'number') return !Number.isFinite(v);
  if (Array.isArray(v)) return v.some(hasNonFinite);
  if (isObject(v)) return Object.keys(v).some((k) => hasNonFinite(v[k]));
  return false;
}

/** Parses JSON text, or answers undefined when it is not JSON. */
export function parseJson(text: string): { value: Json } | undefined {
  try {
    return { value: JSON.parse(text) as Json };
  } catch {
    return undefined;
  }
}

/** Parses a JSON number that is finite, or answers undefined. */
export function parseNumber(text: string): number | undefined {
  if (!JSON_NUMBER.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/** Two JSON values are equal: members in any order, numbers as binary64 values. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') return a === b;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => jsonEqual(x, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => hasOwn(b, k) && jsonEqual(a[k], b[k]));
  }
  return a === b;
}

function step(cur: unknown, name: string): { value: unknown } | undefined {
  if (Array.isArray(cur)) {
    if (!INDEX.test(name)) return undefined;
    const i = Number(name);
    return i < cur.length ? { value: cur[i] } : undefined;
  }
  if (isObject(cur)) return hasOwn(cur, name) ? { value: cur[name] } : undefined;
  return undefined;
}

/**
 * Reads a path in a response (REQ-OR-003, REQ-JU-002): names separated by dots; after
 * `audit`, the rest of the path is read in the JSON value the audit text holds.
 */
export function readPath(root: unknown, path: string): { value: unknown } | undefined {
  const names = path.split('.');
  let cur: unknown = root;
  for (let i = 0; i < names.length; i++) {
    const r = step(cur, names[i]);
    if (!r) return undefined;
    cur = r.value;
    if (i === 0 && names[0] === 'audit' && names.length > 1) {
      if (typeof cur !== 'string') return undefined;
      const parsed = parseJson(cur);
      if (!parsed || hasNonFinite(parsed.value)) return undefined;
      cur = parsed.value;
    }
  }
  return { value: cur };
}

/** Compares strings as sequences of UTF-16 code units. */
export function compareUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Splits off the first word (up to white space) and the rest after the white space. */
export function splitWord(s: string): [string, string] {
  const m = /^(\S*)\s*([^]*)$/.exec(s)!;
  return [m[1], m[2]];
}

/** The words of a text, separated by white space. */
export function words(s: string): string[] {
  return s.split(/\s+/).filter((w) => w !== '');
}

/**
 * The members of an object in the order ECMAScript keeps them: names that are array
 * indexes first, in increasing order, then the others in the order they were first set.
 */
export function ecmaOrder(names: string[]): string[] {
  const isIndex = (k: string) => INDEX.test(k) && Number(k) < 4294967295;
  const idx = names.filter(isIndex).sort((a, b) => Number(a) - Number(b));
  return [...idx, ...names.filter((k) => !isIndex(k))];
}
