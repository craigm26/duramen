// Text helpers shared by the reader and the checks: lines, white space, JSON.
// White space is what ECMAScript's \s matches (REQ-SY-001), which is JavaScript's own \s.

export type Line = { no: number; text: string };

// Splits a file into lines (REQ-SY-001): a byte order mark at the start is ignored,
// and CR LF, a lone CR and LF each end a line. Trailing white space is removed.
export function splitLines(source: string): Line[] {
  let text = source;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(/\r\n?/g, "\n");
  const parts = text.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts.map((raw, i) => ({ no: i + 1, text: raw.replace(/\s+$/, "") }));
}

export function isBlank(text: string): boolean {
  return /^\s*$/.test(text);
}

// The number of leading spaces; `leadingBad` is true when the leading white space holds
// anything but spaces (REQ-SY-001).
export function indentOf(text: string): { spaces: number; leadingBad: boolean; rest: string } {
  const lead = /^\s*/.exec(text)?.[0] ?? "";
  const spaces = /^ */.exec(text)?.[0].length ?? 0;
  return { spaces, leadingBad: /[^ ]/.test(lead), rest: text.slice(lead.length) };
}

// The first word of a text, and the text after it with the white space between removed.
export function firstWord(text: string): { word: string; after: string } {
  const m = /^(\S*)\s*([\s\S]*)$/.exec(text.trim());
  return m ? { word: m[1], after: m[2] } : { word: "", after: "" };
}

export function trimWhite(text: string): string {
  return text.replace(/^\s+|\s+$/g, "");
}

// Parses JSON and reports whether it holds a number too large to be finite (REQ-SY-013).
// JSON.parse yields Infinity for such numbers, so they are found by walking the value.
export type ParsedJson = { ok: true; value: unknown; bigNumber: boolean } | { ok: false };

export function parseJson(text: string): ParsedJson {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  return { ok: true, value, bigNumber: hasNonFinite(value) };
}

export function hasNonFinite(value: unknown): boolean {
  if (typeof value === "number") return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasNonFinite);
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(hasNonFinite);
  }
  return false;
}

// True when the value is a JSON object (not null, not an array).
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Compares strings as sequences of UTF-16 code units (REQ-RC-002, REQ-RC-006).
export function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Two JSON values are equal when they are the same JSON value (REQ-OR-003): object members
// in any order, numbers by value.
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => jsonEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && jsonEqual(a[k], b[k]));
  }
  return false;
}
