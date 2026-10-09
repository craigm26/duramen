// Names of files in a request, and the files a record is made of (REQ-RQ-001, REQ-RC-001,
// REQ-RC-002). A record is read as if its files were the whole content of a folder.

import { compareUtf16 } from "./text.ts";

export type Files = Record<string, string>;

// A name is a relative path (REQ-RQ-001): parts separated by "/", none empty, "." or "..",
// no backslash, no NUL, and not starting with a letter and a colon.
export function isRelativePath(name: string): boolean {
  if (name.length === 0) return false;
  if (/[\\\u0000]/.test(name)) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  return name.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

// Checks `input.files` (REQ-RQ-001 and the Errors list). Returns true when the files are
// well formed; the caller answers bad_request otherwise.
export function filesAreValid(files: unknown): files is Files {
  if (files === null || typeof files !== "object" || Array.isArray(files)) return false;
  const names = Object.keys(files);
  if (names.length === 0) return false;
  for (const name of names) {
    if (!isRelativePath(name)) return false;
    if (typeof (files as Record<string, unknown>)[name] !== "string") return false;
  }
  // One name may not be the folder of another, as "a" is of "a/b.duramen".
  for (const name of names) {
    for (const other of names) {
      if (other.startsWith(name + "/")) return false;
    }
  }
  return true;
}

export type RecordFiles = {
  // The name of the record as written in the request: a file, a folder, or "." for all.
  name: string;
  // The folder of the record ("" for the root of the request's files).
  folder: string;
  // True when the record is one file.
  single: boolean;
  // The names of the record's files, in record order (REQ-RC-002).
  members: string[];
};

// Lists the files of the record named by `entry` (REQ-RC-001). Returns null when the record
// has no files (P046 applies at line 1 of the name).
export function recordFiles(files: Files, entry: string | undefined): RecordFiles | null {
  const names = Object.keys(files);
  const name = entry === undefined ? "." : entry;
  if (name !== "." && Object.prototype.hasOwnProperty.call(files, name)) {
    return { name, folder: parentOf(name), single: true, members: [name] };
  }
  const folder = name === "." ? "" : name;
  const prefix = folder === "" ? "" : folder + "/";
  const members = names
    .filter((n) => n.startsWith(prefix))
    .map((n) => ({ full: n, rel: n.slice(prefix.length) }))
    .filter((m) => belongsToFolder(m.rel))
    .sort((a, b) => compareUtf16(a.rel, b.rel))
    .map((m) => m.full);
  if (members.length === 0) return null;
  return { name, folder, single: false, members };
}

// A file below a folder record belongs to the record when its name ends in ".duramen", no
// part of its path starts with ".", and no folder below the record is named build or
// node_modules (REQ-RC-001). `rel` is the path below the record's folder.
function belongsToFolder(rel: string): boolean {
  const parts = rel.split("/");
  const file = parts[parts.length - 1];
  if (!file.endsWith(".duramen")) return false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith(".")) return false;
    if (i < parts.length - 1 && (part === "build" || part === "node_modules")) return false;
  }
  return true;
}

export function parentOf(name: string): string {
  const i = name.lastIndexOf("/");
  return i < 0 ? "" : name.slice(0, i);
}

// Resolves a path given to `input <path> from "<file>"` (REQ-SY-010): relative to the folder
// of the file the example is in, and it must stay inside the record's folder (REQ-SY-011).
// Returns the file's name in the request, or null when it is outside the record's folder.
export function resolveInside(exampleFolder: string, rel: string, recordFolder: string): string | null {
  const stack = exampleFolder === "" ? [] : exampleFolder.split("/");
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return null;
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  const full = stack.join("/");
  if (recordFolder !== "" && !full.startsWith(recordFolder + "/")) return null;
  if (full === "") return null;
  return full;
}
