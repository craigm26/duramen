export type Json = unknown;

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const NUM_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

export function parseNumber(s: string): number | null {
  const t = s.trim();
  return NUM_RE.test(t) ? Number(t) : null;
}

export function tryParse(s: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false };
  }
}

export function setOwn(o: Record<string, unknown>, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

export function getOwn(o: unknown, k: string): unknown {
  if (isObj(o) && Object.hasOwn(o, k)) return o[k];
  return undefined;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObj(a)) {
    if (!isObj(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

/** Index just after the JSON string literal starting at s[i] (a quote), or -1. */
export function scanString(s: string, i: number): number {
  let j = i + 1;
  while (j < s.length) {
    const ch = s[j];
    if (ch === '\\') j += 2;
    else if (ch === '"') return j + 1;
    else j++;
  }
  return -1;
}

export function parseQuoted(s: string): { ok: true; value: string } | { ok: false } {
  if (!s.startsWith('"')) return { ok: false };
  const e = scanString(s, 0);
  if (e !== s.length) return { ok: false };
  const r = tryParse(s);
  if (r.ok && typeof r.value === 'string') return { ok: true, value: r.value };
  return { ok: false };
}

const WORD = /[A-Za-z0-9_-]/;

/** Scans a path (words or quoted strings separated by dots) from position i. */
export function scanPath(s: string, i = 0): { segs: string[]; end: number } | null {
  const segs: string[] = [];
  let p = i;
  for (;;) {
    if (s[p] === '"') {
      const e = scanString(s, p);
      if (e < 0) return null;
      const r = tryParse(s.slice(p, e));
      if (!r.ok || typeof r.value !== 'string') return null;
      segs.push(r.value);
      p = e;
    } else {
      const st = p;
      while (p < s.length && WORD.test(s[p])) p++;
      if (p === st) return null;
      segs.push(s.slice(st, p));
    }
    if (s[p] === '.') {
      p++;
      continue;
    }
    return { segs, end: p };
  }
}

export function compareUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Splits at top-level commas: not inside quotes, brackets, braces or parentheses. */
export function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQ = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      cur += ch;
      if (ch === '\\' && i + 1 < s.length) cur += s[++i];
      else if (ch === '"') inQ = false;
      continue;
    }
    if (ch === '"') inQ = true;
    else if ('[{('.includes(ch)) depth++;
    else if (']})'.includes(ch)) depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** Resolves a path in a response; undefined when absent. */
export function resolvePath(resp: unknown, segs: string[]): { found: boolean; value?: unknown } {
  let cur: unknown = resp;
  for (let i = 0; i < segs.length; i++) {
    const k = segs[i];
    if (i === 1 && segs[0] === 'audit') {
      // audit.<path> reads the JSON the audit text holds
    }
    if (i === 1 && segs[0] === 'audit' && typeof cur === 'string') {
      const r = tryParse(cur);
      if (!r.ok) return { found: false };
      cur = r.value;
    }
    if (Array.isArray(cur)) {
      if (!/^(?:0|[1-9]\d*)$/.test(k)) return { found: false };
      const idx = Number(k);
      if (idx >= cur.length) return { found: false };
      cur = cur[idx];
    } else if (isObj(cur)) {
      if (!Object.hasOwn(cur, k)) return { found: false };
      cur = cur[k];
    } else return { found: false };
  }
  return { found: true, value: cur };
}
