import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test('REQ-BU-001 REGEN.json shape', () => {
  const r = JSON.parse(readFileSync(join(root, 'REGEN.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(r).sort(), ['build', 'driver', 'lang', 'test']);
  assert.ok(r.lang === 'ts' || r.lang === 'py');
  for (const k of ['build', 'test', 'driver']) {
    const v = r[k];
    assert.ok(typeof v === 'string' || (typeof v === 'object' && typeof v.default === 'string'));
  }
  assert.match(r.driver, /^[^ ]+( [^ ]+)*$/);
});

test('REQ-BU-002 own tests exist and the driver works end to end', () => {
  const input = [
    '{"id":"a","op":"query","input":{"query":"$","document":1}}',
    '',
    '  \t',
    '{"id":"b","op":"query","input":{"query":"$x","document":1}}\r',
    '{"id":"c","op":"query","input":{"query":"$.*","document":{"b":1,"a":2}}}',
  ].join('\n');
  const r = spawnSync('node', ['driver.ts'], { cwd: root, input });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(
    r.stdout.toString('utf8'),
    '{"id":"a","result":{"values":[1],"paths":["$"]}}\n' +
      '{"id":"b","error":"invalid_query"}\n' +
      '{"id":"c","result":{"values":[1,2],"paths":["$[\'b\']","$[\'a\']"]}}\n',
  );
});

test('REQ-BU-003 no dependencies or installed packages', () => {
  const files = walk(root);
  for (const f of files) {
    assert.ok(!/node_modules|package-lock\.json|requirements\.txt|Pipfile|poetry\.lock/.test(f.slice(root.length)), f);
    if (f.endsWith('package.json')) assert.ok(!/"(dev|peer|optional)?[dD]ependencies"/.test(readFileSync(f, 'utf8')));
  }
  assert.ok(existsSync(join(root, 'driver.ts')));
});

test('REQ-BU-004 size limit', () => {
  let n = 0;
  for (const f of walk(root)) {
    const rel = f.slice(root.length);
    if (!/\.(ts|mts|mjs|js|py)$/.test(f) || /\.test\./.test(f) || /[\\/]tests?[\\/]/.test(rel)) continue;
    n += readFileSync(f, 'utf8').split('\n').filter((l) => l.trim() !== '').length;
  }
  assert.ok(n <= 3000, String(n));
});
