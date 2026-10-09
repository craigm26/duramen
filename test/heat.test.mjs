// The heat-engine slice end to end, and the edge library against independent models.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { generateCases, runCases } from '../src/suite.mjs';
import { renderSpec } from '../src/render.mjs';
import { packConflicts } from '../src/check.mjs';
import { loadRecord } from '../src/record.mjs';
import { canon } from '../examples/heat-engine/oracle.mjs';
import { ROOT, HEAT, HEAT_DIR, IMPLS, codes, checkPath } from './helpers.mjs';
import { jsonParseMisreadsKeys } from '../src/driver.mjs';

// On an engine whose JSON.parse misreads escaped keys (DESIGN.md, "Node.js versions"), property
// CJ-P1 fails on a sample whose objects hold a key that is one backslash: the slice cannot check
// clean there, and the tests that need it to are skipped, saying why.
const engineBug = jsonParseMisreadsKeys() && `the JSON.parse of Node.js ${process.version} misreads escaped keys, which breaks property CJ-P1`;

const lib = loadRecord(HEAT).ast.edgeLib;
const pack = (name) => lib.defs.get(name).pack;

test('edges: number-text/ecmascript agrees with ECMAScript String()', () => {
  for (const { input, text } of pack('number-text/ecmascript')) assert.equal(String(JSON.parse(input)), text, input);
});

test('edges: json/sorted-utf16 agrees with the heat-engine canonical writer', () => {
  for (const { input, text } of pack('json/sorted-utf16')) assert.equal(canon(JSON.parse(input)), text, input);
});

test('edges: json/sorted-codepoint agrees with a code-point-ordered writer', () => {
  const cp = (s) => [...s].map((c) => c.codePointAt(0));
  const cmp = (a, b) => { const A = cp(a), B = cp(b); for (let i = 0; i < Math.min(A.length, B.length); i++) if (A[i] !== B[i]) return A[i] - B[i]; return A.length - B.length; };
  const lone = (s) => !s.isWellFormed();
  const w = (v) => {
    if (typeof v === 'string' && lone(v)) throw new Error('no canonical form');
    if (v === null || typeof v !== 'object') return canon(v);
    if (Array.isArray(v)) return `[${v.map(w).join(',')}]`;
    return `{${Object.keys(v).sort(cmp).map((k) => { if (lone(k)) throw new Error('no canonical form'); return `${JSON.stringify(k)}:${w(v[k])}`; }).join(',')}}`;
  };
  for (const item of pack('json/sorted-codepoint')) {
    if (item.refuse) assert.throws(() => w(JSON.parse(item.input)), /no canonical form/, item.input);
    else assert.equal(w(JSON.parse(item.input)), item.text, item.input);
  }
});

test('edges: json/rfc8785 is json/sorted-utf16 except that it refuses lone surrogates', () => {
  const a = pack('json/rfc8785'), b = pack('json/sorted-utf16');
  a.forEach((x, i) => {
    assert.equal(x.input, b[i].input);
    const v = JSON.parse(x.input);
    if (typeof v === 'string' && !v.isWellFormed()) assert.equal(x.refuse, true, x.input);
    else assert.equal(x.text, b[i].text, x.input);
  });
});

test('edges: conflicts between packs, and the ambiguous family names', () => {
  assert.equal(packConflicts(lib, 'json/sorted-utf16', 'json/rfc8785').length, 2);
  assert.equal(packConflicts(lib, 'json/sorted-utf16', 'json/sorted-codepoint').length, 3);
  assert.equal(packConflicts(lib, 'json/sorted-codepoint', 'json/rfc8785').length, 1);
  assert.equal(packConflicts(lib, 'json/sorted-utf16', 'json/sorted-utf16').length, 0);
  assert.deepEqual([...lib.families.get('canonical-json')].sort(), ['json/rfc8785', 'json/sorted-codepoint', 'json/sorted-utf16']);
  assert.deepEqual([...lib.families.get('json')].sort(), ['json/rfc8785', 'json/sorted-codepoint', 'json/sorted-utf16']);
  assert.deepEqual(lib.families.get('number-text'), ['number-text/ecmascript']);
});

test('heat-engine: the slice checks clean, with nothing resting on the oracle alone', { skip: engineBug }, async () => {
  const { ds, corroboration } = await checkPath(HEAT, { strict: true });
  assert.deepEqual(codes(ds), []);
  assert.deepEqual(codes(ds, 'warning'), []);
  assert.ok(corroboration.every((c) => !c.oracleOnly));
});

test('heat-engine: the suite has one case per example, evidence row, pack item, property and static check', async () => {
  const { ast, oracle, properties } = await checkPath(HEAT);
  const cases = generateCases(ast, oracle, properties);
  const count = (k) => cases.filter((c) => c.kind === k).length;
  const reqs = ast.items.filter((i) => i.type === 'req');
  assert.equal(count('example'), reqs.reduce((n, r) => n + r.examples.length, 0));
  assert.equal(count('evidence'), ast.evidence.reduce((n, ev) => n + ev.rows.length, 0));
  assert.equal(count('edge'), pack('number-text/ecmascript').length + pack('json/sorted-utf16').length);
  assert.equal(count('property'), ast.properties.length);
  assert.equal(count('static'), reqs.reduce((n, r) => n + r.statics.length, 0));
  assert.ok(cases.filter((c) => c.kind === 'example' || c.kind === 'evidence').every((c) => c.full), 'every driver case carries the oracle answer');
});

test('heat-engine: the oracle itself passes the generated suite (static checks aside)', { skip: engineBug }, async () => {
  const { ast, oracle, properties } = await checkPath(HEAT);
  const r = await runCases(generateCases(ast, oracle, properties), { command: 'node oracle-driver.mjs', cwd: HEAT_DIR, noStatic: true });
  assert.deepEqual(r.failures, []);
});

test('heat-engine: the brief shows evidence, properties and static checks', async () => {
  const { ast, oracle, properties } = await checkPath(HEAT);
  const md = renderSpec(ast, oracle, { properties });
  assert.match(md, /\*\*EV-WB-FIXTURES\.\*\*/);
  assert.match(md, /\*\*PROP-WB-P1\.\*\*/);
  assert.match(md, /Checked on the implementation folder:/);
  assert.doesNotMatch(md, /\/home\/|\\Users\\/, 'no local paths in the brief');
});

test('heat-engine: the committed build output is what `duramen build` writes now', { skip: engineBug }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'duramen-test-'));
  try {
    const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'duramen.mjs'), 'build', HEAT, '--out', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const f of ['SPEC.md', 'DECISIONS.md', 'trace.md', 'cases.jsonl']) {
      assert.equal(readFileSync(join(dir, f), 'utf8'), readFileSync(join(HEAT_DIR, 'build', f), 'utf8'), `${f} is stale: run npm run example`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const lang of ['ts', 'py']) {
  const impl = join(IMPLS, lang);
  test(`heat-engine: the released ${lang} implementation passes`, { skip: (!existsSync(join(impl, 'REGEN.json')) && `no ${impl}`) || engineBug }, () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'duramen.mjs'), 'run', HEAT, '--impl', impl], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /passed (\d+)\/\1\b/);
  });
}
