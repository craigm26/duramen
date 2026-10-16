// Small helpers shared by the reader, the checker, the suite and the judge.

export function setOwn(obj: any, key: string, value: any): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

export function hasOwn(obj: any, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function isPlainObject(v: any): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// True when the value holds a number that is not finite (a JSON number too large for binary64).
export function holdsBigNumber(v: any): boolean {
  if (typeof v === 'number') return !Number.isFinite(v);
  if (Array.isArray(v)) return v.some(holdsBigNumber);
  if (isPlainObject(v)) return Object.keys(v).some((k) => holdsBigNumber(v[k]));
  return false;
}

export type Parsed = { ok: true; value: any } | { ok: false };

export function parseJson(text: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

const NUMBER_RE = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;

export function isJsonNumberText(text: string): boolean {
  return NUMBER_RE.test(text);
}

// A JSON number text that is finite; returns undefined otherwise.
export function finiteNumber(text: string): number | undefined {
  if (!NUMBER_RE.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

export function deepEqual(a: any, b: any): boolean {
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a === 'number') return a === b;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!hasOwn(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

const INDEX_RE = /^(0|[1-9][0-9]*)$/;

// Reads a path (names separated by dots) in a response or an answer. Returns
// { found: false } when the path names nothing. After a first name `audit`, the rest
// of the path is read in the JSON value the audit text holds.
export function resolvePath(root: any, path: string): { found: boolean; value?: any } {
  const names = path.split('.');
  let cur = root;
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (i === 1 && names[0] === 'audit') {
      // `cur` is the audit text here
      if (typeof cur !== 'string') return { found: false };
      const p = parseJson(cur);
      if (!p.ok || holdsBigNumber(p.value)) return { found: false };
      cur = p.value;
    }
    if (Array.isArray(cur)) {
      if (!INDEX_RE.test(name)) return { found: false };
      const idx = Number(name);
      if (idx >= cur.length) return { found: false };
      cur = cur[idx];
    } else if (isPlainObject(cur)) {
      if (!hasOwn(cur, name)) return { found: false };
      cur = cur[name];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: cur };
}

export function splitLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}
