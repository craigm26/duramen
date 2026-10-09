// Checks of the implementation folder itself (SPEC REQ-BU-001 to REQ-BU-004).

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const relativeFiles = (readdirSync(root, { recursive: true }) as string[])
  .map((path) => path.split('\\').join('/'))
  .filter((path) => statSync(join(root, path)).isFile());

// Files that REQ-BU-004 does not count: tests and anything under a test/ or tests/ folder.
function isTestFile(path: string): boolean {
  const name = basename(path);
  return (
    /\.test\./.test(name) ||
    /_test\./.test(name) ||
    /^test_.*\.py$/.test(name) ||
    /(^|\/)tests?\//.test(path)
  );
}

test('REQ-BU-001 REGEN.json has exactly lang, build, test and driver, of the required types', () => {
  const regen = JSON.parse(readFileSync(join(root, 'REGEN.json'), 'utf8')) as Record<string, unknown>;
  assert.deepStrictEqual(Object.keys(regen).sort(), ['build', 'driver', 'lang', 'test']);
  assert.equal(regen.lang, 'ts');
  assert.equal(regen.build, '');
  assert.equal(typeof regen.test, 'string');
  assert.equal(typeof regen.driver, 'string');
});

test('REQ-BU-001 driver is plain space-separated words, not a shell command', () => {
  const regen = JSON.parse(readFileSync(join(root, 'REGEN.json'), 'utf8')) as { driver: string };
  for (const word of regen.driver.split(' ')) assert.match(word, /^[A-Za-z0-9_./-]+$/);
});

test('REQ-BU-003 no dependency folders or lock files', () => {
  const forbidden = ['node_modules', 'package-lock.json', 'requirements.txt', 'Pipfile', 'poetry.lock'];
  for (const name of forbidden) {
    assert.ok(!relativeFiles.some((path) => path.split('/').includes(name)), `${name} is present`);
  }
});

test('REQ-BU-003 package.json, if present, declares no dependencies', () => {
  for (const path of relativeFiles.filter((p) => basename(p) === 'package.json')) {
    const text = readFileSync(join(root, path), 'utf8');
    assert.doesNotMatch(text, /"(dev|peer|optional)?[dD]ependencies"/);
  }
});

test('REQ-BU-003 erasable syntax only, and relative imports with the .ts extension', () => {
  const sources = relativeFiles.filter((p) => ['.ts', '.mts', '.mjs', '.js', '.py'].includes(extname(p)));
  for (const path of sources) {
    const text = readFileSync(join(root, path), 'utf8');
    assert.doesNotMatch(text, /(^|\s)enum\s+\w+\s*\{/m, `${path} uses enum`);
    assert.doesNotMatch(text, /(^|\s)namespace\s+\w+\s*\{/m, `${path} uses namespace`);
    assert.doesNotMatch(text, /constructor\s*\(\s*(private|public|protected|readonly)\s/, `${path} uses parameter properties`);
    for (const [, specifier] of text.matchAll(/from\s+'(\.[^']*)'/g)) {
      assert.match(specifier, /\.ts$/, `${path} imports ${specifier} without .ts`);
    }
  }
});

test('REQ-BU-003 the runtime is Node.js 22.18 or later', () => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert.ok(major > 22 || (major === 22 && minor >= 18), process.versions.node);
});

test('REQ-BU-004 at most 3000 non-blank lines of source, excluding tests', () => {
  let total = 0;
  for (const path of relativeFiles) {
    if (!['.ts', '.mts', '.mjs', '.js', '.py'].includes(extname(path)) || isTestFile(path)) continue;
    total += readFileSync(join(root, path), 'utf8').split('\n').filter((line) => line.trim() !== '').length;
  }
  assert.ok(total <= 3000, `${total} non-blank lines`);
});
