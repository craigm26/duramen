import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));

function driverRun(input: string): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(process.execPath, ['driver.ts'], { cwd: HERE, input, encoding: 'utf8' });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

// Every file in the implementation folder, relative to it.
function allFiles(): string[] {
  return readdirSync(HERE, { recursive: true, encoding: 'utf8' }).filter((f) => {
    return !f.includes('node_modules') && !f.startsWith('.');
  });
}

function isTestFile(f: string): boolean {
  const name = f.split(/[\\/]/).pop() ?? f;
  return /\.test\./.test(name) || /_test\./.test(name) || /^test_.*\.py$/.test(name) || /(^|[\\/])(test|tests)[\\/]/.test(f);
}

function sourceFiles(): string[] {
  return allFiles().filter((f) => /\.(ts|mts|mjs|js|py)$/.test(f) && !isTestFile(f));
}

test('driver answers each non-blank request with one line, in request order, and exits 0', () => {
  const input = [
    '{"id":"1","op":"query","input":{"query":"$.store.book[?@.price < 10].title","document":{"store":{"book":[{"title":"A","price":8.95},{"title":"B","price":12.99}]}}}}',
    '',
    '{"id":"2","op":"nope","input":{}}',
    'not json',
    '{"id":"3","op":"query","input":{"query":"$[?length(@.*) < 3]","document":[]}}',
    '   ',
    '{"id":"4","op":"query","input":{"query":"$[1]","document":[10,20.50]}}',
  ].join('\n');
  const r = driverRun(input);
  assert.strictEqual(r.status, 0);
  assert.ok(!r.stdout.includes('\r'));
  assert.ok(r.stdout.endsWith('\n'));
  assert.deepStrictEqual(r.stdout.split('\n').slice(0, -1), [
    `{"id":"1","result":{"values":["A"],"paths":["$['store']['book'][0]['title']"]}}`,
    '{"id":"2","error":"unknown_op"}',
    '{"id":null,"error":"bad_request"}',
    '{"id":"3","error":"invalid_query"}',
    '{"id":"4","result":{"values":[20.50],"paths":["$[1]"]}}',
  ]);
});

test('driver with no input writes nothing and exits 0', () => {
  const r = driverRun('');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('REQ-BU-001: REGEN.json has exactly the keys lang, build, test and driver', () => {
  const regen = JSON.parse(readFileSync(join(HERE, 'REGEN.json'), 'utf8')) as Record<string, unknown>;
  assert.deepStrictEqual(Object.keys(regen).sort(), ['build', 'driver', 'lang', 'test']);
  assert.strictEqual(regen.lang, 'ts');
  for (const k of ['build', 'test', 'driver']) {
    assert.strictEqual(typeof regen[k], 'string', `${k} is a command string`);
  }
  assert.deepStrictEqual((regen.driver as string).split(' '), ['node', 'driver.ts']);
});

test('REQ-BU-003: no installed dependencies, and package.json declares none', () => {
  for (const banned of ['node_modules', 'package-lock.json', 'requirements.txt', 'Pipfile', 'poetry.lock']) {
    assert.ok(!existsSync(join(HERE, banned)), `${banned} must not exist`);
  }
  const pkg = readFileSync(join(HERE, 'package.json'), 'utf8');
  assert.ok(!/"(dev|peer|optional)?[dD]ependencies"/.test(pkg));
});

test('REQ-BU-003: sources use erasable syntax and .ts import extensions', () => {
  for (const f of sourceFiles().filter((x) => x.endsWith('.ts'))) {
    const text = readFileSync(join(HERE, f), 'utf8');
    assert.ok(!/^\s*(export\s+)?(const\s+)?enum\s/m.test(text), `${f} has an enum`);
    assert.ok(!/\bnamespace\s+\w/.test(text), `${f} has a namespace`);
    assert.ok(!/constructor\s*\(\s*(private|public|protected|readonly)\s/.test(text), `${f} has a parameter property`);
    for (const m of text.matchAll(/from\s+['"](\.{1,2}\/[^'"]*)['"]/g)) {
      assert.ok(m[1].endsWith('.ts'), `${f} imports ${m[1]} without .ts`);
    }
  }
});

test('REQ-BU-004: at most 3000 non-blank lines of source, not counting tests', () => {
  let lines = 0;
  for (const f of sourceFiles()) {
    lines += readFileSync(join(HERE, f), 'utf8').split('\n').filter((l) => l.trim() !== '').length;
  }
  assert.ok(lines <= 3000, `${lines} non-blank source lines`);
});
