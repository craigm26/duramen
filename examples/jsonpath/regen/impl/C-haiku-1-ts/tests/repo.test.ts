// The checks SPEC.md makes on the implementation folder itself: REQ-BU-001 (REGEN.json),
// REQ-BU-003 (runtime, dependencies, erasable syntax) and REQ-BU-004 (size).

import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entries = readdirSync(root, { recursive: true }) as string[];
const isCounted = (rel: string): boolean => {
  const parts = rel.split(/[\\/]/);
  const name = parts[parts.length - 1];
  if (parts.slice(0, -1).some((p) => p === "test" || p === "tests")) return false;
  if (/\.test\./.test(name) || /_test\./.test(name) || /^test_.*\.py$/.test(name)) return false;
  return /\.(ts|mts|mjs|js|py)$/.test(name);
};
const sourceFiles = entries.filter((rel) => isCounted(rel) || /^tests[\\/].*\.ts$/.test(rel));
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

test("REQ-BU-001: REGEN.json has exactly the four keys, with the types SPEC.md gives", () => {
  const regen = JSON.parse(read("REGEN.json")) as Record<string, unknown>;
  assert.deepStrictEqual(Object.keys(regen).sort(), ["build", "driver", "lang", "test"]);
  assert.strictEqual(regen.lang, "ts");
  for (const key of ["build", "test", "driver"]) {
    assert.strictEqual(typeof regen[key], "string", key);
  }
  assert.strictEqual(regen.build, "", "nothing to build");
  // driver is split on single spaces and started without a shell: plain words only.
  assert.ok(/^[A-Za-z0-9_.\- ]+$/.test(regen.driver as string));
});

test("REQ-BU-003: no installed dependencies, and no dependency declarations", () => {
  const names = entries.map((rel) => rel.split(/[\\/]/).pop());
  for (const banned of ["node_modules", "package-lock.json", "requirements.txt", "Pipfile", "poetry.lock"]) {
    assert.ok(!names.includes(banned), banned);
  }
  for (const rel of entries.filter((r) => /(^|[\\/])package\.json$/.test(r))) {
    assert.ok(!/"(dev|peer|optional)?[dD]ependencies"/.test(read(rel)), rel);
  }
});

test("REQ-BU-003: erasable TypeScript only, and relative imports carry the .ts extension", () => {
  for (const rel of sourceFiles.filter((r) => r.endsWith(".ts"))) {
    const src = read(rel);
    assert.ok(!/^\s*(export\s+)?(const\s+)?enum\s/m.test(src), `${rel} has an enum`);
    assert.ok(!/^\s*(export\s+)?namespace\s/m.test(src), `${rel} has a namespace`);
    assert.ok(!/constructor\s*\(\s*(private|public|protected|readonly)\s/.test(src), `${rel} has a parameter property`);
    for (const m of src.matchAll(/from\s+"(\.\.?\/[^"]*)"/g)) {
      assert.ok(m[1].endsWith(".ts"), `${rel}: ${m[1]} has no .ts extension`);
    }
  }
});

test("REQ-BU-004: at most 3000 non-blank lines of source, tests not counted", () => {
  let total = 0;
  for (const rel of entries.filter(isCounted)) {
    total += read(rel).split("\n").filter((line) => line.trim() !== "").length;
  }
  assert.ok(total <= 3000, `${total} non-blank lines`);
});
