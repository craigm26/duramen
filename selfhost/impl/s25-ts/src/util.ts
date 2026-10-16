// Small helpers shared by the reader, the checker and the judge.

export const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export function setOwn(o: Record<string, unknown>, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
}

export function isObj(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const NUM_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

// The first word of a trimmed text and the rest after the white space that follows it.
export function firstWord(s: string): [string, string] {
  const m = /^(\S*)\s*([\s\S]*)$/.exec(s)!;
  return [m[1], m[2]];
}

export function hasBig(v: unknown): boolean {
  if (typeof v === 'number') return !Number.isFinite(v);
  if (Array.isArray(v)) return v.some(hasBig);
  if (typeof v === 'object' && v !== null) return Object.keys(v).some((k) => hasBig((v as any)[k]));
  return false;
}

export interface Parsed { ok: boolean; big: boolean; value: any }

// JSON.parse, flagging a number too large to be finite (REQ-SY-013).
export function parseJson(text: string): Parsed {
  let value: any;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, big: false, value: undefined };
  }
  return { ok: true, big: hasBig(value), value };
}

export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((x: any, i: number) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => hasOwn(b, k) && deepEqual(a[k], b[k]));
}

export interface Found { found: boolean; value?: any }
const NONE: Found = { found: false };

// Reads a path (REQ-OR-003, REQ-JU-002) in a response or an answer.
export function getPath(root: any, path: string): Found {
  const segs = path.split('.');
  let cur = root;
  let start = 0;
  if (segs[0] === 'audit' && segs.length > 1) {
    if (!isObj(root) || !hasOwn(root, 'audit') || typeof root.audit !== 'string') return NONE;
    const p = parseJson(root.audit);
    if (!p.ok || p.big) return NONE;
    cur = p.value;
    start = 1;
  }
  for (let i = start; i < segs.length; i++) {
    const s = segs[i];
    if (Array.isArray(cur)) {
      if (!/^(?:0|[1-9]\d*)$/.test(s)) return NONE;
      const idx = Number(s);
      if (idx >= cur.length) return NONE;
      cur = cur[idx];
    } else if (isObj(cur)) {
      if (!hasOwn(cur, s)) return NONE;
      cur = cur[s];
    } else {
      return NONE;
    }
  }
  return { found: true, value: cur };
}

export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function dirname(name: string): string {
  const i = name.lastIndexOf('/');
  return i < 0 ? '' : name.slice(0, i);
}

// REQ-RQ-001: a relative path.
export function validName(name: string): boolean {
  if (name.includes('\\') || name.includes('\0')) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
}
