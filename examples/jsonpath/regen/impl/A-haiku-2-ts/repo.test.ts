// Checks on the implementation folder itself (SPEC: REQ-BU-001 to REQ-BU-004).
import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = import.meta.dirname;
const read = (name: string): string => readFileSync(join(DIR, name), 'utf8');
const regen = JSON.parse(read('REGEN.json'));

const isTest = (p: string): boolean =>
  /\.test\./.test(p) || /_test\./.test(p) || /(^|[\\/])test_[^\\/]*\.py$/.test(p) || /(^|[\\/])(test|tests)[\\/]/.test(p);
const sourceFiles = (): string[] =>
  (readdirSync(DIR, { recursive: true }) as string[]).filter((p) => /\.(ts|mts|mjs|js|py)$/.test(p) && !isTest(p));

test('REGEN.json has exactly lang, build, test and driver, of the stated types (REQ-BU-001)', () => {
  assert.deepStrictEqual(Object.keys(regen).sort(), ['build', 'driver', 'lang', 'test']);
  assert.ok(regen.lang === 'ts' || regen.lang === 'py');
  for (const key of ['build', 'test', 'driver']) {
    const cmd = regen[key];
    const values = typeof cmd === 'string' ? [cmd] : Object.values(cmd);
    assert.ok(typeof cmd === 'string' || (typeof cmd.default === 'string' && values.every((v) => typeof v === 'string')));
    if (typeof cmd !== 'string') assert.strictEqual(typeof cmd.default, 'string');
  }
  // The driver is split on single spaces and started without a shell.
  assert.match(regen.driver, /^[A-Za-z0-9_./ -]+$/);
  assert.ok(!regen.driver.includes('  '));
  assert.ok(existsSync(join(DIR, 'driver.ts')));
});

test('the command named as test runs every test file of the folder (REQ-BU-002)', () => {
  const testFiles = readdirSync(DIR).filter((f) => f.endsWith('.test.ts'));
  assert.ok(testFiles.length > 0);
  for (const f of testFiles) assert.ok(regen.test.split(' ').includes(f), `${f} is not run`);
  for (const f of regen.test.split(' ').filter((w: string) => w.endsWith('.test.ts'))) {
    assert.ok(existsSync(join(DIR, f)), `${f} is missing`);
  }
});

test('no installed dependencies, and package.json declares none (REQ-BU-003)', () => {
  for (const f of ['node_modules', 'package-lock.json', 'requirements.txt', 'Pipfile', 'poetry.lock']) {
    assert.ok(!existsSync(join(DIR, f)), `${f} must not be in the folder`);
  }
  assert.doesNotMatch(read('package.json'), /"(dev|peer|optional)?[dD]ependencies"/);
});

test('the TypeScript is erasable and imports relative paths with the .ts extension (REQ-BU-003)', () => {
  for (const f of sourceFiles().filter((p) => p.endsWith('.ts'))) {
    const text = readFileSync(join(DIR, f), 'utf8');
    assert.doesNotMatch(text, /^\s*(export\s+)?(const\s+)?enum\s/m, `${f}: enum`);
    assert.doesNotMatch(text, /\bnamespace\s+\w/, `${f}: namespace`);
    assert.doesNotMatch(text, /constructor\s*\(\s*(public|private|protected|readonly)\b/, `${f}: parameter property`);
    for (const [, spec] of text.matchAll(/from\s+'(\.{1,2}\/[^']*)'/g)) {
      assert.ok(spec.endsWith('.ts'), `${f}: import ${spec} has no .ts extension`);
    }
  }
});

test('the source is at most 3000 non-blank lines (REQ-BU-004)', () => {
  let lines = 0;
  for (const f of sourceFiles()) {
    lines += readFileSync(join(DIR, f), 'utf8').split('\n').filter((l) => l.trim() !== '').length;
  }
  assert.ok(lines <= 3000, `${lines} non-blank lines`);
});
