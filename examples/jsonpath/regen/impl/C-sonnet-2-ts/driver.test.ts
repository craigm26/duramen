import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

function drive(input: string) {
  const r = spawnSync('node', ['driver.ts'], { cwd: dir, input, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.ok(input === '' || r.stdout === '' || r.stdout.endsWith('\n'));
  assert.ok(!r.stdout.includes('\r'));
  return r.stdout.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));
}

const req = (o: unknown) => JSON.stringify(o);

test('REQ-RQ-001 requests that cannot be handled', () => {
  const lines = [
    '{not json', '[1]', req({ op: 'query', input: { query: '$', document: 1 } }),
    req({ id: 7, op: 'query', input: { query: '$', document: 1 } }),
    req({ id: 'a', input: { query: '$', document: 1 } }),
    req({ id: 'b', op: 'select', input: { query: '$', document: 1 } }),
    req({ id: 'c', op: 'query' }), req({ id: 'd', op: 'query', input: [] }),
    req({ id: 'e', op: 'query', input: { document: 1 } }),
    req({ id: 'f', op: 'query', input: { query: 5, document: 1 } }),
    req({ id: 'g', op: 'query', input: { query: null, document: 1 } }),
    req({ id: 'h', op: 'query', input: { query: '$' } }),
    req({ id: 'i', op: 'query', input: { query: '$[', document: 1 } }),
    req({ id: 'j', op: 'query', input: { query: '$', document: 1 } }),
  ];
  const out = drive(lines.join('\n') + '\n');
  assert.deepEqual(out, [
    { id: null, error: 'bad_request' }, { id: null, error: 'bad_request' },
    { id: null, error: 'bad_request' }, { id: null, error: 'bad_request' },
    { id: 'a', error: 'unknown_op' }, { id: 'b', error: 'unknown_op' },
    { id: 'c', error: 'bad_request' }, { id: 'd', error: 'bad_request' },
    { id: 'e', error: 'bad_request' }, { id: 'f', error: 'bad_request' },
    { id: 'g', error: 'bad_request' }, { id: 'h', error: 'bad_request' },
    { id: 'i', error: 'invalid_query' }, { id: 'j', result: { values: [1], paths: ['$'] } },
  ]);
});

test('driver: blank lines get no response, last line without newline is handled', () => {
  const out = drive('\n  \t\n' + req({ id: 'x', op: 'query', input: { query: '$.a', document: { a: 1 } } }));
  assert.deepEqual(out, [{ id: 'x', result: { values: [1], paths: ["$['a']"] } }]);
});

test('REQ-RQ-003 unknown members are ignored', () => {
  const out = drive(req({ id: 'r1', op: 'query', trace: true, input: { query: '$.a', document: { a: 1 }, flags: 'x' } }) + '\n');
  assert.deepEqual(out, [{ id: 'r1', result: { values: [1], paths: ["$['a']"] } }]);
});

test('REQ-RQ-002 result and order of responses', () => {
  const lines = [1, 2, 3].map((n) => req({ id: 'n' + n, op: 'query', input: { query: '$[0,0]', document: [n] } }));
  const out = drive(lines.join('\n') + '\n');
  assert.deepEqual(out.map((o) => o.id), ['n1', 'n2', 'n3']);
  assert.deepEqual(out[1].result, { values: [2, 2], paths: ['$[0]', '$[0]'] });
});

test('REQ-BU-001/003 REGEN.json and package.json', () => {
  const regen = JSON.parse(readFileSync(join(dir, 'REGEN.json'), 'utf8'));
  assert.deepEqual(Object.keys(regen).sort(), ['build', 'driver', 'lang', 'test']);
  assert.equal(regen.lang, 'ts');
  assert.ok(!/"(dev|peer|optional)?[dD]ependencies"/.test(readFileSync(join(dir, 'package.json'), 'utf8')));
});
