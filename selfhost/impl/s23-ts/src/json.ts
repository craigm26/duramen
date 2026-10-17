// JSON helpers shared by the reader, the checker and the judge.

export type Found = { found: true; value: unknown } | { found: false };
const NOT_FOUND: Found = { found: false };

export function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function hasNonFinite(v: unknown): boolean {
  if (typeof v === 'number') return !Number.isFinite(v);
  if (Array.isArray(v)) return v.some(hasNonFinite);
  if (v !== null && typeof v === 'object') return Object.keys(v).some((k) => hasNonFinite((v as Record<string, unknown>)[k]));
  return false;
}

// Parses JSON text; a number too large for binary64 makes the text no value (REQ-SY-013).
export function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (hasNonFinite(value)) return { ok: false };
  return { ok: true, value };
}

export function setOwn(o: object, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
}

export function getOwn(o: object, k: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k] : undefined;
}

export function hasOwn(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  const aa = Array.isArray(a);
  if (aa !== Array.isArray(b)) return false;
  if (aa) {
    const x = a as unknown[];
    const y = b as unknown[];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!jsonEqual(x[i], y[i])) return false;
    return true;
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!hasOwn(b as object, k)) return false;
    if (!jsonEqual(getOwn(a as object, k), getOwn(b as object, k))) return false;
  }
  return true;
}

function step(cur: unknown, seg: string): Found {
  if (Array.isArray(cur)) {
    if (/^(0|[1-9][0-9]*)$/.test(seg) && Number(seg) < cur.length) return { found: true, value: cur[Number(seg)] };
    return NOT_FOUND;
  }
  if (isObj(cur) && hasOwn(cur, seg)) return { found: true, value: getOwn(cur, seg) };
  return NOT_FOUND;
}

// Reads a path (REQ-OR-003, REQ-JU-002) in a response or an answer.
export function lookup(root: unknown, path: string): Found {
  const segs = path.split('.');
  let cur = root;
  for (let i = 0; i < segs.length; i++) {
    const r = step(cur, segs[i]);
    if (!r.found) return NOT_FOUND;
    cur = r.value;
    if (i === 0 && segs[0] === 'audit' && segs.length > 1) {
      if (typeof cur !== 'string') return NOT_FOUND;
      const p = parseJson(cur);
      if (!p.ok) return NOT_FOUND;
      cur = p.value;
    }
  }
  return { found: true, value: cur };
}
