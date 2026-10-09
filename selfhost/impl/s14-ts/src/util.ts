export function hasOwn(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

export function setOwn(o: Record<string, unknown>, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function splitFirstWord(s: string): [string, string] {
  const m = /^(\S*)\s*([\s\S]*)$/.exec(s)!;
  return [m[1], m[2]];
}

export function words(s: string): string[] {
  return s.split(/\s+/).filter((w) => w !== '');
}

export function hasNonFinite(v: unknown): boolean {
  if (typeof v === 'number') return !Number.isFinite(v);
  if (Array.isArray(v)) return v.some(hasNonFinite);
  if (typeof v === 'object' && v !== null) return Object.values(v).some(hasNonFinite);
  return false;
}

export type Parsed = { ok: true; value: unknown } | { ok: false };

/** Strict JSON; a number too large for binary64 makes the text no JSON here (REQ-SY-013). */
export function parseJson(text: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (hasNonFinite(value)) return { ok: false };
  return { ok: true, value };
}

const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

export function parseNumberText(text: string): number | null {
  if (!NUMBER_RE.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!hasOwn(b, k)) return false;
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

export type Found = { found: true; value: unknown } | { found: false };

function walk(root: unknown, names: string[]): Found {
  let cur = root;
  for (const n of names) {
    if (Array.isArray(cur)) {
      if (!/^(?:0|[1-9]\d*)$/.test(n)) return { found: false };
      const i = Number(n);
      if (i >= cur.length) return { found: false };
      cur = cur[i];
    } else if (typeof cur === 'object' && cur !== null) {
      if (!hasOwn(cur, n)) return { found: false };
      cur = (cur as Record<string, unknown>)[n];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: cur };
}

/** Reads a dotted path in a response; `audit.<rest>` reads inside the audit text's JSON. */
export function lookup(root: unknown, path: string): Found {
  const names = path.split('.');
  if (names[0] === 'audit' && names.length > 1) {
    if (!isPlainObject(root) || !hasOwn(root, 'audit')) return { found: false };
    const a = root.audit;
    if (typeof a !== 'string') return { found: false };
    const p = parseJson(a);
    if (!p.ok) return { found: false };
    return walk(p.value, names.slice(1));
  }
  return walk(root, names);
}

export function compareUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
