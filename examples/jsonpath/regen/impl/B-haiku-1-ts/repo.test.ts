// Checks on the implementation folder itself: REGEN.json, dependencies, size, and language rules
// (SPEC.md REQ-BU-001 to REQ-BU-004, and R1 for the Node.js version).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map((p) => String(p).split('\\').join('/'))
    .filter((p) => !p.startsWith('node_modules/') && statSync(join(ROOT, p)).isFile());
}

const FILES = listFiles(ROOT);

const isTest = (p: string): boolean =>
  /\.test\./.test(p) || /_test\./.test(p) || /(^|\/)test_[^/]*\.py$/.test(p) || /(^|\/)(test|tests)\//.test(p);

test('REQ-BU-001: REGEN.json has exactly lang, build, test and driver of the required types', () => {
  const regen = JSON.parse(readFileSync(join(ROOT, 'REGEN.json'), 'utf8')) as Record<string, unknown>;
  assert.deepStrictEqual(Object.keys(regen).sort(), ['build', 'driver', 'lang', 'test']);
  assert.ok(regen.lang === 'ts' || regen.lang === 'py');
  const isCommand = (v: unknown): boolean =>
    typeof v === 'string' ||
    (typeof v === 'object' &&
      v !== null &&
      !Array.isArray(v) &&
      typeof (v as Record<string, unknown>).default === 'string' &&
      Object.values(v as Record<string, unknown>).every((c) => typeof c === 'string'));
  assert.ok(isCommand(regen.build), 'build');
  assert.ok(isCommand(regen.test), 'test');
  assert.ok(isCommand(regen.driver), 'driver');
  // driver is split on single spaces and started without a shell: plain words only.
  assert.ok(!/\s{2,}|^\s|\s$|["'`$|&;<>]/.test(regen.driver as string), 'driver must be plain space-separated words');
});

test('REQ-BU-002: the test command is runnable (this file is run by it)', () => {
  const regen = JSON.parse(readFileSync(join(ROOT, 'REGEN.json'), 'utf8')) as { test: string };
  assert.equal(typeof regen.test, 'string');
  assert.ok(FILES.some((p) => /\.test\.ts$/.test(p)));
});

test('REQ-BU-003: no installed dependencies, lock files or node_modules', () => {
  for (const banned of ['node_modules', 'package-lock.json', 'requirements.txt', 'Pipfile', 'poetry.lock']) {
    assert.ok(!existsSync(join(ROOT, banned)), banned);
    assert.ok(!FILES.some((p) => p.split('/').includes(banned) || p.endsWith('/' + banned)), banned);
  }
  for (const p of FILES.filter((f) => /(^|\/)package\.json$/.test(f))) {
    const text = readFileSync(join(ROOT, p), 'utf8');
    assert.ok(!/"(dev|peer|optional)?[dD]ependencies"/.test(text), p);
  }
});

test('REQ-BU-003: Node.js 22.18 or later, and TypeScript is erasable with .ts relative imports', () => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert.ok(major > 22 || (major === 22 && minor >= 18), process.versions.node);
  const sources = FILES.filter((p) => /\.ts$/.test(p) && !isTest(p));
  for (const p of sources) {
    const text = readFileSync(join(ROOT, p), 'utf8');
    assert.ok(!/^\s*(export\s+)?(const\s+)?enum\s/m.test(text), `${p}: enum`);
    assert.ok(!/^\s*(export\s+)?(declare\s+)?namespace\s/m.test(text), `${p}: namespace`);
    assert.ok(!/constructor\s*\([^)]*\b(public|private|protected|readonly)\s/.test(text), `${p}: parameter property`);
    assert.ok(!/^\s*import\s+\w+\s*=\s*require\(/m.test(text), `${p}: import =`);
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g)) {
      assert.ok(m[1].endsWith('.ts'), `${p}: relative import without .ts: ${m[1]}`);
    }
  }
});

test('REQ-BU-004: at most 3000 non-blank lines of source, tests excluded', () => {
  const sources = FILES.filter((p) => /\.(ts|mts|mjs|js|py)$/.test(p) && !isTest(p));
  let lines = 0;
  for (const p of sources) {
    lines += readFileSync(join(ROOT, p), 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '').length;
  }
  assert.ok(lines <= 3000, `${lines} non-blank source lines in ${sources.join(', ')}`);
});
