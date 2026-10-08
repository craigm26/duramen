// Canonical JSON (json/sorted-utf16), number text and fixed-point text.

export function numText(x: number): string {
  return String(x); // ECMAScript Number::toString; -0 gives "0"
}

export function fixedText(x: number, places: number): string {
  return x.toFixed(places); // ECMAScript Number.prototype.toFixed
}

function strText(s: string): string {
  // JSON.stringify is well-formed: lone surrogates become lowercase \udXXX,
  // controls become \b \f \n \r \t or lowercase \u00XX, "/" and U+2028 stay.
  return JSON.stringify(s);
}

export function canonical(v: unknown): string {
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") return Number.isFinite(v) ? numText(v) : "null";
  if (typeof v === "string") return strText(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort(); // default sort compares UTF-16 code units
    return "{" + keys.map((k) => strText(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  return "null";
}
