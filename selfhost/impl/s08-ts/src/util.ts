export type Level = 'error' | 'warning' | 'info';
export interface Diag { file: string; line: number; level: Level; code: string }
export interface Obj { [k: string]: unknown }

export function splitFirst(s: string): [string, string] {
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(s);
  return m ? [m[1], m[2] ?? ''] : ['', s.trim()];
}

export function words(s: string): string[] {
  return s.split(/\s+/).filter((w) => w !== '');
}

export function hasNonFinite(v: unknown): boolean {
  if (typeof v === 'number') return !Number.isFinite(v);
  if (Array.isArray(v)) return v.some(hasNonFinite);
  if (v !== null && typeof v === 'object') return Object.values(v).some(hasNonFinite);
  return false;
}

export type Parsed = { ok: true; value: unknown } | { ok: false };

// JSON that holds a number too large for binary64 is not accepted (REQ-SY-013).
export function parseJson(text: string): Parsed {
  try {
    const value = JSON.parse(text);
    if (hasNonFinite(value)) return { ok: false };
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

export function isPlainObject(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

export function parseNumber(text: string): number | undefined {
  if (!NUMBER.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

export function parseJsonString(text: string): string | undefined {
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) return undefined;
  try {
    const v = JSON.parse(text);
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

export function setKey(o: Obj, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
}

export function hasOwn(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') return a === b;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a as Obj);
  const kb = Object.keys(b as Obj);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => hasOwn(b as Obj, k) && deepEqual((a as Obj)[k], (b as Obj)[k]));
}

// Splits an oracle command (REQ-OR-002); null when a quote is not closed.
export function splitCommand(cmd: string): string[] | null {
  const out: string[] = [];
  let cur = '';
  let inWord = false;
  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i];
    if (c === ' ' || c === '\t') {
      if (inWord) { out.push(cur); cur = ''; inWord = false; }
      i++;
      continue;
    }
    inWord = true;
    if (c === '"') {
      i++;
      let closed = false;
      while (i < cmd.length) {
        if (cmd[i] === '\\' && cmd[i + 1] === '"') { cur += '"'; i += 2; continue; }
        if (cmd[i] === '"') { closed = true; i++; break; }
        cur += cmd[i];
        i++;
      }
      if (!closed) return null;
    } else if (c === "'") {
      const j = cmd.indexOf("'", i + 1);
      if (j < 0) return null;
      cur += cmd.slice(i + 1, j);
      i = j + 1;
    } else {
      cur += c;
      i++;
    }
  }
  if (inWord) out.push(cur);
  return out;
}

const OBLIGATION = /(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])/;
const QUOTATION = /"[^"]*"|“[^”]*”|`[^`]*`/g;

// Whether a text holds an obligation word outside quotations, line by line (REQ-CK-006).
export function holdsObligation(text: string): boolean {
  return text.split('\n').some((l) => OBLIGATION.test(l.replace(QUOTATION, '')));
}
