import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

test('driver end to end: order, blank lines, CRLF, exit status', () => {
  const input =
    '{"id":"a","op":"query","input":{"query":"$","document":1}}\r\n' +
    '\n  \t \n' +
    '{"id":"b","op":"query","input":{"query":"$x","document":1}}\n' +
    '{"id":"c","op":"query","input":{"query":"$.*","document":{"b":1,"1":2}}}';
  const r = spawnSync('node', ['driver.ts'], { cwd: root, input, encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(
    r.stdout,
    '{"id":"a","result":{"values":[1],"paths":["$"]}}\n' +
      '{"id":"b","error":"invalid_query"}\n' +
      '{"id":"c","result":{"values":[1,2],"paths":["$[\'b\']","$[\'1\']"]}}\n',
  );
});

test('REQ-BU-001..004 folder requirements', () => {
  const cfg = JSON.parse(readFileSync(join(root, 'REGEN.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(cfg).sort(), ['build', 'driver', 'lang', 'test']);
  assert.strictEqual(cfg.lang, 'ts');
  assert.ok(!/ {2}|\t/.test(cfg.driver));
  const pkg = readFileSync(join(root, 'package.json'), 'utf8');
  assert.ok(!/"(dev|peer|optional)?[dD]ependencies"/.test(pkg));
  let lines = 0;
  for (const f of readdirSync(root)) {
    assert.ok(!['node_modules', 'package-lock.json', 'requirements.txt'].includes(f));
    if (/\.(ts|mts|mjs|js)$/.test(f) && !/\.test\./.test(f) && statSync(join(root, f)).isFile()) {
      lines += readFileSync(join(root, f), 'utf8').split('\n').filter((l) => l.trim()).length;
    }
  }
  assert.ok(lines <= 3000, `source lines: ${lines}`);
});
