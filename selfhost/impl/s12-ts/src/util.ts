// Shared helpers: JSON values, paths, equality.

export function setMember(obj: any, key: string, value: any): void {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}

export function has(obj: any, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function isObject(v: any): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// True when a parsed JSON value holds a number too large to be finite.
export function hasHuge(v: any): boolean {
  if (typeof v === 'number') return !Number.isFinite(v);
  if (Array.isArray(v)) return v.some(hasHuge);
  if (isObject(v)) return Object.keys(v).some((k) => hasHuge(v[k]));
  return false;
}

// Parses JSON text; returns { ok, value }. Not ok when it is not JSON.
export function parseJson(text: string): { ok: boolean; value?: any } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export function jsonEqual(a: any, b: any): boolean {
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a === 'number') return a === b;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!has(b, k)) return false;
    if (!jsonEqual(a[k], b[k])) return false;
  }
  return true;
}

const INDEX = /^(0|[1-9][0-9]*)$/;

// Reads a path in a value. Returns { found, value }.
export function readPath(root: any, names: string[]): { found: boolean; value?: any } {
  let cur = root;
  for (const n of names) {
    if (Array.isArray(cur)) {
      if (!INDEX.test(n)) return { found: false };
      const i = Number(n);
      if (i >= cur.length) return { found: false };
      cur = cur[i];
    } else if (isObject(cur)) {
      if (!has(cur, n)) return { found: false };
      cur = cur[n];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: cur };
}

// Reads a dotted path in a response/answer; `audit.<rest>` reads inside the audit text's JSON.
export function readResponsePath(resp: any, path: string): { found: boolean; value?: any } {
  const names = path.split('.');
  if (names[0] === 'audit' && names.length > 1) {
    if (!isObject(resp) || !has(resp, 'audit') || typeof resp.audit !== 'string') return { found: false };
    const p = parseJson(resp.audit);
    if (!p.ok || hasHuge(p.value)) return { found: false };
    return readPath(p.value, names.slice(1));
  }
  return readPath(resp, names);
}

export function compareUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// A relative path as REQ-RQ-001 defines it.
export function validRelativePath(name: string): boolean {
  if (typeof name !== 'string') return false;
  if (name.includes('\\') || name.includes('\0')) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  for (const part of name.split('/')) {
    if (part === '' || part === '.' || part === '..') return false;
  }
  return true;
}
