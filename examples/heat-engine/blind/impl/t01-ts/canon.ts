// Canonical JSON (json/sorted-utf16) and number text (number-text/ecmascript).

export function numText(x: number): string {
  if (x === 0) return "0";
  return String(x);
}

export function fixed(x: number, places: number): string {
  return x === 0 ? (0).toFixed(places) : x.toFixed(places);
}

const SHORT: Record<number, string> = { 8: "\\b", 12: "\\f", 10: "\\n", 13: "\\r", 9: "\\t" };

function hex4(u: number): string {
  return "\\u" + u.toString(16).padStart(4, "0");
}

export function quote(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const u = s.charCodeAt(i);
    if (u === 0x22) out += '\\"';
    else if (u === 0x5c) out += "\\\\";
    else if (SHORT[u] !== undefined) out += SHORT[u];
    else if (u < 0x20) out += hex4(u);
    else if (u >= 0xd800 && u <= 0xdbff) {
      const n = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (n >= 0xdc00 && n <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
      } else out += hex4(u);
    } else if (u >= 0xdc00 && u <= 0xdfff) out += hex4(u);
    else out += s[i];
  }
  return out + '"';
}

export function canonical(v: unknown): string {
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") return Number.isFinite(v) ? numText(v) : "null";
  if (typeof v === "string") return quote(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return "{" + keys.map((k) => quote(k) + ":" + canonical(o[k])).join(",") + "}";
}
