// JSON helpers shared by the checker and the judge.

export type JsonObject = { [k: string]: unknown };

export function isPlainObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Sets an own member, so that a name like `__proto__` is a member like any other. */
export function setOwn(o: JsonObject, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
}

function allFinite(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(allFinite);
  if (isPlainObject(v)) return Object.keys(v).every((k) => allFinite(v[k]));
  return true;
}

/** Parses JSON text; undefined when it is not JSON or holds a number too large for binary64. */
export function parseFinite(text: string): { value: unknown } | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  return allFinite(value) ? { value } : undefined;
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** A JSON number finite in binary64, as its value; undefined otherwise. */
export function jsonNumber(text: string): number | undefined {
  if (!NUMBER.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/** A JSON number of 0 or more (`-0` is 0), finite in binary64. */
export function jsonTolerance(text: string): number | undefined {
  const n = jsonNumber(text);
  return n !== undefined && n >= 0 ? (n === 0 ? 0 : n) : undefined;
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') return a === b;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  }
  const ao = a as JsonObject;
  const bo = b as JsonObject;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => hasOwn(bo, k) && jsonEqual(ao[k], bo[k]));
}

const INDEX = /^(?:0|[1-9]\d*)$/;

function step(cur: unknown, name: string): { value: unknown } | undefined {
  if (Array.isArray(cur)) {
    if (!INDEX.test(name)) return undefined;
    const i = Number(name);
    return i < cur.length ? { value: cur[i] } : undefined;
  }
  if (isPlainObject(cur)) return hasOwn(cur, name) ? { value: cur[name] } : undefined;
  return undefined;
}

/**
 * Reads a path (names separated by dots) in a response or an answer. After `audit`, the
 * rest of the path is read in the JSON value the `audit` text holds.
 */
export function readPath(root: JsonObject, path: string): { value: unknown } | undefined {
  const names = path.split('.');
  let cur: unknown = root;
  let rest = names;
  if (names[0] === 'audit' && names.length > 1) {
    if (!hasOwn(root, 'audit') || typeof root.audit !== 'string') return undefined;
    const held = parseFinite(root.audit);
    if (!held) return undefined;
    cur = held.value;
    rest = names.slice(1);
  }
  for (const name of rest) {
    const next = step(cur, name);
    if (!next) return undefined;
    cur = next.value;
  }
  return { value: cur };
}

/** Compares UTF-16 code units, as JavaScript compares strings. */
export function cmpUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
