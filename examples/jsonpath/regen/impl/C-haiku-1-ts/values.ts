// JSON values as JSON.parse gives them, and the rules that compare, measure and print them.

export type Json = null | boolean | number | string | Json[] | { [name: string]: Json };

// RFC 9535's Nothing: the missing value of a comparable. It is not the value null.
export const NOTHING = Symbol("Nothing");

export function isObject(v: unknown): v is { [name: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function hasMember(obj: object, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, name);
}

// Orders two strings code point by code point (REQ-FI-005). Code points are compared as
// numbers, so U+FFFF comes before U+1F600, which UTF-16 code units would reverse.
export function compareStrings(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const p = x[i].codePointAt(0)!;
    const q = y[i].codePointAt(0)!;
    if (p !== q) return p - q;
  }
  return x.length - y.length;
}

// The member names of an object in the order REQ-SE-008 takes them.
export function sortedNames(obj: { [name: string]: Json }): string[] {
  return Object.keys(obj).sort(compareStrings);
}

// Equality of two JSON values that both have values (REQ-FI-004).
export function equal(a: Json, b: Json): boolean {
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => equal(x, b[i]));
  }
  if (typeof a === "object") {
    if (typeof b !== "object") return false;
    const names = Object.keys(a);
    if (names.length !== Object.keys(b).length) return false;
    return names.every((name) => hasMember(b, name) && equal(a[name], b[name]));
  }
  return a === b;
}

// Less than (REQ-FI-005): numbers by value, strings by code point, nothing else.
export function lessThan(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a < b;
  if (typeof a === "string" && typeof b === "string") return compareStrings(a, b) < 0;
  return false;
}

const NAME_ESCAPES: Record<string, string> = {
  "'": "\\'",
  "\\": "\\\\",
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r",
};

// A member name as a Normalized Path writes it, between single quotes (REQ-NP-002).
export function escapeName(name: string): string {
  return name.replace(/['\\\u0000-\u001f]/g, (c) => NAME_ESCAPES[c] ?? "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

// A Normalized Path (REQ-NP-001) from the names and indexes that lead to a node.
export function normalizedPath(steps: Array<string | number>): string {
  let out = "$";
  for (const step of steps) {
    out += typeof step === "number" ? `[${step}]` : `['${escapeName(step)}']`;
  }
  return out;
}
