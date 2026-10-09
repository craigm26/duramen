export const NUM_SRC = '-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';
export const NUM_RE = new RegExp(`^${NUM_SRC}$`);

export type Parsed = { ok: true; value: unknown } | { ok: false };

export function tryJSON(text: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function setOwn(o: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(o, key, { value, writable: true, enumerable: true, configurable: true });
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => jsonEqual(x, b[i]));
  }
  if (isPlainObject(a)) {
    if (!isPlainObject(b)) return false;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]));
  }
  return false;
}

export type Found = { found: true; value: unknown } | { found: false };

function walk(cur: unknown, segs: string[]): Found {
  for (const seg of segs) {
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9]\d*)$/.test(seg) || Number(seg) >= cur.length) return { found: false };
      cur = cur[Number(seg)];
    } else if (isPlainObject(cur) && Object.hasOwn(cur, seg)) {
      cur = cur[seg];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: cur };
}

/** Reads a dotted path in a response; `audit.<path>` reads inside the JSON the audit text holds. */
export function getPath(response: Record<string, unknown>, path: string): Found {
  const segs = path.split('.');
  if (segs[0] === 'audit' && segs.length > 1) {
    const audit = response.audit;
    if (typeof audit !== 'string') return { found: false };
    const p = tryJSON(audit);
    if (!p.ok) return { found: false };
    return walk(p.value, segs.slice(1));
  }
  return walk(response, segs);
}
