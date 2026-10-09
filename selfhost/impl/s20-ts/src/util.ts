export function hasOwn(o: any, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

export function setOwn(obj: any, key: string, value: any): void {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}

export function isObj(v: any): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function tryParse(text: string): { ok: boolean; value: any } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: undefined };
  }
}

// True when a parsed JSON value holds a number too large to be finite (REQ-SY-013).
export function hasBig(v: any): boolean {
  if (typeof v === 'number') return !Number.isFinite(v);
  if (Array.isArray(v)) return v.some(hasBig);
  if (isObj(v)) return Object.values(v).some(hasBig);
  return false;
}

export function deepEqual(a: any, b: any): boolean {
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObj(a)) {
    if (!isObj(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return a === b;
}

// Compare as sequences of UTF-16 code units.
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function splitWord(s: string): [string, string] {
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(s.replace(/^\s+/, ''));
  return m ? [m[1], m[2] ?? ''] : ['', ''];
}

export function dirOf(name: string): string {
  const i = name.lastIndexOf('/');
  return i < 0 ? '' : name.slice(0, i);
}

const NOTFOUND = { found: false, value: undefined };

// Reads a path in a response or an answer (REQ-OR-003, REQ-JU-002).
export function lookup(root: any, path: string): { found: boolean; value: any } {
  const names = path.split('.');
  let cur = root;
  let i = 0;
  if (names.length > 1 && names[0] === 'audit') {
    if (!isObj(root) || !hasOwn(root, 'audit') || typeof root.audit !== 'string') return NOTFOUND;
    const p = tryParse(root.audit);
    if (!p.ok || hasBig(p.value)) return NOTFOUND;
    cur = p.value;
    i = 1;
  }
  for (; i < names.length; i++) {
    const n = names[i];
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9][0-9]*)$/.test(n)) return NOTFOUND;
      const k = Number(n);
      if (k >= cur.length) return NOTFOUND;
      cur = cur[k];
    } else if (isObj(cur) && hasOwn(cur, n)) {
      cur = cur[n];
    } else {
      return NOTFOUND;
    }
  }
  return { found: true, value: cur };
}

export function validName(name: string): boolean {
  if (name.includes('\\') || name.includes('\0')) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
}
