// Paths into JSON values: names separated by dots, and indexes for arrays (REQ-OR-003,
// REQ-SY-011).

import { isPlainObject } from "./text.ts";

// Splits a path into its names. An empty name is allowed here (REQ-OR-003).
export function splitPath(path: string): string[] {
  return path.split(".");
}

// An index as JSON writes an integer: "0", or a digit string without a leading zero.
export function isIndex(name: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(name);
}

// Reads the value at the names. `found` is false when there is none.
export function lookup(root: unknown, names: string[]): { found: boolean; value?: unknown } {
  let cur: unknown = root;
  for (const name of names) {
    if (Array.isArray(cur)) {
      if (!isIndex(name)) return { found: false };
      const i = Number(name);
      if (i >= cur.length) return { found: false };
      cur = cur[i];
    } else if (isPlainObject(cur)) {
      if (!Object.prototype.hasOwnProperty.call(cur, name)) return { found: false };
      cur = cur[name];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: cur };
}

// Sets the member at the names of an object, creating objects on the way where there are
// none (REQ-SY-011). Returns false when a name on the way holds a value that is not an
// object.
export function assignPath(root: Record<string, unknown>, names: string[], value: unknown): boolean {
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < names.length - 1; i++) {
    const name = names[i];
    if (!Object.prototype.hasOwnProperty.call(cur, name)) {
      defineMember(cur, name, {});
    }
    const next = cur[name];
    if (!isPlainObject(next)) return false;
    cur = next;
  }
  defineMember(cur, names[names.length - 1], value);
  return true;
}

// Sets a member as JSON does, even for names such as "__proto__".
export function defineMember(obj: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}
