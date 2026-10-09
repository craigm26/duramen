// The requirements that are checked on the implementation folder itself (REQ-BU-001 to
// REQ-BU-004): REGEN.json, the test command, dependencies and size.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert';

const root = fileURLToPath(new URL('..', import.meta.url));

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const files = listFiles(root).map((path) => relative(root, path).split(sep).join('/'));

test('REQ-BU-001: REGEN.json has exactly lang, build, test and driver, in the required types', () => {
  const regen = JSON.parse(readFileSync(join(root, 'REGEN.json'), 'utf8')) as Record<string, unknown>;
  assert.deepStrictEqual(Object.keys(regen).sort(), ['build', 'driver', 'lang', 'test']);
  assert.ok(regen.lang === 'ts' || regen.lang === 'py');
  for (const key of ['build', 'test', 'driver']) {
    const value = regen[key];
    const ok =
      typeof value === 'string' ||
      (typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).default === 'string');
    assert.ok(ok, `${key} is a command string or a per-platform object with default`);
  }
});

test('REQ-BU-001: driver is plain space-separated words, and names a file that exists', () => {
  const regen = JSON.parse(readFileSync(join(root, 'REGEN.json'), 'utf8')) as { driver: string };
  const words = regen.driver.split(' ');
  assert.ok(words.every((word) => word.length > 0 && !/["'\\]/.test(word)));
  assert.ok(files.includes(words[words.length - 1]), `${words[words.length - 1]} exists`);
});

test('REQ-BU-002: the test command of REGEN.json is npm test, and package.json defines it', () => {
  const regen = JSON.parse(readFileSync(join(root, 'REGEN.json'), 'utf8')) as { test: string };
  assert.strictEqual(regen.test, 'npm test');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.ok(typeof pkg.scripts.test === 'string' && pkg.scripts.test.length > 0);
});

test('REQ-BU-003: no installed-dependency files, and no dependency sections in package.json', () => {
  const forbidden = ['node_modules', 'package-lock.json', 'requirements.txt', 'Pipfile', 'poetry.lock'];
  for (const file of files) {
    const name = file.split('/').pop() as string;
    assert.ok(!forbidden.some((bad) => file === bad || file.startsWith(`${bad}/`) || name === bad), file);
  }
  for (const file of files.filter((f) => f === 'package.json' || f.endsWith('/package.json'))) {
    const text = readFileSync(join(root, file), 'utf8');
    assert.ok(!/"(dev|peer|optional)?[dD]ependencies"/.test(text), `${file} declares dependencies`);
  }
});

test('REQ-BU-004: the source, not counting tests, is at most 3000 non-blank lines', () => {
  const isSource = (f: string): boolean => /\.(ts|mts|mjs|js|py)$/.test(f);
  const isTest = (f: string): boolean =>
    /\.test\./.test(f) || /_test\./.test(f) || /(^|\/)test_[^/]*\.py$/.test(f) || /(^|\/)tests?\//.test(f);
  let total = 0;
  for (const file of files.filter((f) => isSource(f) && !isTest(f))) {
    total += readFileSync(join(root, file), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '').length;
  }
  assert.ok(total <= 3000, `${total} non-blank source lines`);
});
