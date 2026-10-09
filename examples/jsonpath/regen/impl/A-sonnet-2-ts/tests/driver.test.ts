import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function drive(input: string): { out: string; lines: any[]; status: number | null } {
  const r = spawnSync(process.execPath, ['driver.ts'], { cwd: root, input, encoding: 'utf8' });
  const lines = r.stdout === '' ? [] : r.stdout.split('\n').slice(0, -1).map((l) => JSON.parse(l));
  return { out: r.stdout, lines, status: r.status };
}
const req = (o: unknown) => JSON.stringify(o) + '\n';

test('driver: query responses in request order, LF only, exit 0', () => {
  const r = drive(
    req({ id: 'a', op: 'query', input: { query: '$.x', document: { x: [1, 2] } } }) +
      req({ id: 'b', op: 'query', input: { query: '$[*]', document: [1, 'é'] } }),
  );
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(r.lines, [
    { id: 'a', result: { values: [[1, 2]], paths: ["$['x']"] } },
    { id: 'b', result: { values: [1, 'é'], paths: ['$[0]', '$[1]'] } },
  ]);
  assert.ok(r.out.endsWith('\n'));
  assert.ok(!r.out.includes('\r'));
});

test('driver: blank lines get no response; last line without LF is handled', () => {
  const r = drive('\n  \t \n' + req({ id: 'a', op: 'query', input: { query: '$', document: 1 } }) + '\t\n' +
    JSON.stringify({ id: 'z', op: 'query', input: { query: '$', document: 2 } }));
  assert.deepStrictEqual(r.lines.map((l) => l.id), ['a', 'z']);
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(drive('').lines, []);
  assert.strictEqual(drive('').status, 0);
  // CRLF framing: the CR is JSON white space, not part of the response
  const c = drive(JSON.stringify({ id: 'c', op: 'query', input: { query: '$', document: 1 } }) + '\r\n');
  assert.deepStrictEqual(c.lines.map((l) => l.id), ['c']);
  assert.ok(!c.out.includes('\r'));
});

test('driver: error codes and their order', () => {
  const ok = { query: '$', document: 1 };
  const cases: [string, unknown][] = [
    ['not json', { id: null, error: 'bad_request' }],
    ['[1]', { id: null, error: 'bad_request' }],
    ['"s"', { id: null, error: 'bad_request' }],
    ['null', { id: null, error: 'bad_request' }],
    ['{"op":"query","input":{}}', { id: null, error: 'bad_request' }],
    ['{"id":5,"op":"query","input":{}}', { id: null, error: 'bad_request' }],
    ['{"id":null,"op":"nope"}', { id: null, error: 'bad_request' }], // id check first
    ['{"id":"1"}', { id: '1', error: 'unknown_op' }],
    ['{"id":"1","op":5}', { id: '1', error: 'unknown_op' }],
    ['{"id":"1","op":"other","input":3}', { id: '1', error: 'unknown_op' }],
    ['{"id":"1","op":"query"}', { id: '1', error: 'bad_request' }],
    ['{"id":"1","op":"query","input":[]}', { id: '1', error: 'bad_request' }],
    ['{"id":"1","op":"query","input":{"document":1}}', { id: '1', error: 'bad_request' }],
    ['{"id":"1","op":"query","input":{"query":5,"document":1}}', { id: '1', error: 'bad_request' }],
    ['{"id":"1","op":"query","input":{"query":"$"}}', { id: '1', error: 'bad_request' }],
    ['{"id":"1","op":"query","input":{"query":"$[","document":1}}', { id: '1', error: 'invalid_query' }],
    ['{"id":"1","op":"query","input":{"query":5}}', { id: '1', error: 'bad_request' }], // 3 before 4
    [JSON.stringify({ id: '1', op: 'query', input: ok }), { id: '1', result: { values: [1], paths: ['$'] } }],
    ['{"id":"1","op":"query","input":{"query":"$","document":null}}', { id: '1', result: { values: [null], paths: ['$'] } }],
    ['{"id":"1","op":"query","input":{"query":"$"},}', { id: null, error: 'bad_request' }],
    ['{"id":"1","id":"2","op":"query","input":{"query":"$","document":0}}', { id: '2', result: { values: [0], paths: ['$'] } }],
  ];
  const r = drive(cases.map((c) => c[0]).join('\n') + '\n');
  assert.deepStrictEqual(r.lines, cases.map((c) => c[1]));
  for (const l of r.lines) assert.deepStrictEqual(Object.keys(l).length, 2);
});

test('driver: output is UTF-8, lone surrogates stay escaped', () => {
  const r = drive('{"id":"u","op":"query","input":{"query":"$","document":"\\ud800 \\u00e9 \\ud83d\\ude00"}}\n');
  assert.deepStrictEqual(r.lines[0].result.values, ['\ud800 é 😀']);
  assert.ok(r.out.includes('é'));
});

test('REQ-BU-001: REGEN.json shape', () => {
  const j = JSON.parse(readFileSync(join(root, 'REGEN.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(j).sort(), ['build', 'driver', 'lang', 'test']);
  assert.ok(j.lang === 'ts' || j.lang === 'py');
  for (const k of ['build', 'test', 'driver']) {
    const v = j[k];
    assert.ok(typeof v === 'string' || (typeof v === 'object' && typeof v.default === 'string'), k);
  }
  assert.match(j.driver, /^[^\s]+( [^\s]+)*$/);
});

function walk(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === '.git') continue;
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

test('REQ-BU-002/003: tests exist, no dependency files', () => {
  const files = walk(root);
  for (const bad of ['node_modules', 'package-lock.json', 'requirements.txt', 'Pipfile', 'poetry.lock']) {
    assert.ok(!files.some((f) => f.includes(bad)), bad);
  }
  assert.ok(!existsSync(join(root, 'node_modules')));
  const pkg = readFileSync(join(root, 'package.json'), 'utf8');
  assert.ok(!/"(dev|peer|optional)?[dD]ependencies"/.test(pkg));
});

test('REQ-BU-004: at most 3000 non-blank source lines', () => {
  let n = 0;
  for (const f of walk(root)) {
    if (!/\.(ts|mts|mjs|js|py)$/.test(f) || /\.test\./.test(f) || /\/tests?\//.test(f.replaceAll('\\', '/').replace(root.replaceAll('\\', '/'), ''))) continue;
    n += readFileSync(f, 'utf8').split('\n').filter((l) => l.trim() !== '').length;
  }
  assert.ok(n <= 3000, `${n} lines`);
});

test('REQ-BU-003: sources use erasable syntax and .ts relative imports', () => {
  for (const f of walk(root).filter((f) => f.endsWith('.ts'))) {
    const s = readFileSync(f, 'utf8');
    assert.ok(!/^\s*(export\s+)?(const\s+)?enum\s/m.test(s), f);
    assert.ok(!/^\s*(export\s+)?(declare\s+)?namespace\s/m.test(s), f);
    for (const m of s.matchAll(/from\s+'(\.[^']*)'/g)) assert.ok(m[1].endsWith('.ts'), `${f}: ${m[1]}`);
  }
});
