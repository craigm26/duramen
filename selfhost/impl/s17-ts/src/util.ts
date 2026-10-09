export type Obj = { [key: string]: unknown };

export function hasOwn(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

export function setOwn(o: object, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
}

export function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// True when a JSON value holds a number too large to be finite (REQ-SY-013).
export function hasBig(v: unknown): boolean {
  if (typeof v === 'number') return !Number.isFinite(v);
  if (Array.isArray(v)) return v.some(hasBig);
  if (isObject(v)) return Object.keys(v).some((k) => hasBig(v[k]));
  return false;
}

export interface Parsed {
  ok: boolean;
  value?: unknown;
  big?: boolean;
}

export function parseJson(text: string): Parsed {
  try {
    const value = JSON.parse(text);
    return { ok: true, value, big: hasBig(value) };
  } catch {
    return { ok: false };
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') return a === b;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!hasOwn(b, k)) return false;
    if (!deepEqual((a as Obj)[k], (b as Obj)[k])) return false;
  }
  return true;
}

export interface Found {
  found: boolean;
  value?: unknown;
}

// Reads a path in a response or answer (REQ-OR-003, REQ-JU-002).
export function getPath(root: unknown, path: string): Found {
  const names = path.split('.');
  let cur: unknown = root;
  let start = 0;
  if (names[0] === 'audit' && names.length > 1) {
    if (!isObject(root) || !hasOwn(root, 'audit') || typeof root.audit !== 'string') return { found: false };
    const p = parseJson(root.audit);
    if (!p.ok || p.big) return { found: false };
    cur = p.value;
    start = 1;
  }
  for (let i = start; i < names.length; i++) {
    const name = names[i];
    if (isObject(cur)) {
      if (!hasOwn(cur, name)) return { found: false };
      cur = cur[name];
    } else if (Array.isArray(cur)) {
      if (!/^(0|[1-9][0-9]*)$/.test(name)) return { found: false };
      const idx = Number(name);
      if (idx >= cur.length) return { found: false };
      cur = cur[idx];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: cur };
}

// First word of a trimmed text, and the rest with its leading white space removed.
export function splitWord(s: string): [string, string] {
  const m = /^(\S*)\s*([\s\S]*)$/.exec(s) as RegExpExecArray;
  return [m[1], m[2]];
}

export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isJsonNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
