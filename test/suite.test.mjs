import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadRecord } from '../src/record.mjs';
import { check } from '../src/check.mjs';
import { generateCases, runCases } from '../src/suite.mjs';
import { evaluateStatic, globToRegExp } from '../src/static.mjs';
import { parseType } from '../src/types.mjs';
import { CALC_ORACLE, src, withFiles } from './helpers.mjs';

const CALC_SPEC = src(`
duramen 0.2
spec calc 1
oracle node calc.mjs
op add
  input a number, b number
  returns {sum: number}
req ADD-1 "Adds"
  example add {"a": 1, "b": 2}
    expect result.sum = 3
  example add {"a": 2, "b": 2}
    expect result.sum = ?
  static file "REGEN.json" exists
property P-1 "Commutes"
  supports ADD-1
  samples 25
  for a in -100 .. 100
  for b in -100 .. 100
  call x = add {"a": a, "b": b}
  call y = add {"a": b, "b": a}
  call z = add {"a": x.result.sum, "b": 0}
  expect x.result == y.result
  expect z.result.sum == x.result.sum
`);

// An implementation of the calc spec, broken in one way: `a - b` instead of `a + b` when a > b.
const SUB_WHEN_BIGGER = CALC_ORACLE.replace('result: { sum: i.a + i.b }', 'result: { sum: i.a > i.b ? i.a - i.b : i.a + i.b }');

async function built(dir) {
  const { ast } = loadRecord(join(dir, 'calc.duramen'));
  const r = await check(ast);
  assert.deepEqual(r.diagnostics.filter((d) => d.level === 'error'), []);
  return generateCases(ast, r.oracle, r.properties);
}

test('suite: example, property and static cases run against an implementation', async () => {
  await withFiles({ 'calc.mjs': CALC_ORACLE, 'calc.duramen': CALC_SPEC, 'impl/REGEN.json': '{"driver": "node calc.mjs"}', 'impl/calc.mjs': CALC_ORACLE }, async (dir) => {
    const cases = await built(dir);
    assert.deepEqual(cases.map((c) => c.kind), ['example', 'example', 'static', 'property']);
    assert.equal(cases[3].samples.length, 25);
    const r = await runCases(cases, { command: 'node calc.mjs', cwd: join(dir, 'impl'), implDir: join(dir, 'impl'), repeat: 2 });
    assert.deepEqual(r.failures, []);
    assert.deepEqual(r.tally, { example: { passed: 2, total: 2 }, property: { passed: 1, total: 1 }, static: { passed: 1, total: 1 }, protocol: { passed: 4, total: 4 } });
  });
});

test('suite: a property fails with the sample that breaks it', async () => {
  await withFiles({ 'calc.mjs': CALC_ORACLE, 'calc.duramen': CALC_SPEC, 'impl/REGEN.json': '{"driver": "node calc.mjs"}', 'impl/calc.mjs': SUB_WHEN_BIGGER }, async (dir) => {
    const cases = await built(dir);
    const r = await runCases(cases, { command: 'node calc.mjs', cwd: join(dir, 'impl'), implDir: join(dir, 'impl') });
    const f = r.failures.find((x) => x.id === 'prop:P-1');
    assert.ok(f, JSON.stringify(r.failures));
    assert.match(f.why[0], /sample \d+ \(a = .*, b = .*\): x\.result == y\.result is false/);
  });
});

test('suite: without the oracle, only checks that do not come from it remain', async () => {
  await withFiles({ 'calc.mjs': CALC_ORACLE, 'calc.duramen': CALC_SPEC, 'impl/calc.mjs': CALC_ORACLE.replace('{ sum: i.a + i.b }', '{ sum: i.a + i.b, extra: 1 }') }, async (dir) => {
    const cases = await built(dir);
    const full = await runCases(cases, { command: 'node calc.mjs', cwd: join(dir, 'impl'), noStatic: true });
    const without = await runCases(cases, { command: 'node calc.mjs', cwd: join(dir, 'impl'), noStatic: true, withoutOracle: true });
    // the extra member breaks the oracle's whole-answer comparison, which only the oracle stands behind
    assert.deepEqual(full.failures.map((f) => f.id).sort(), ['ADD-1#1', 'ADD-1#2']);
    assert.deepEqual(without.failures, []);
  });
});

test('suite: a nondeterministic driver fails the determinism case', async () => {
  await withFiles({ 'calc.mjs': CALC_ORACLE, 'calc.duramen': CALC_SPEC, 'impl/calc.mjs': CALC_ORACLE.replace('{ sum: i.a + i.b }', '{ sum: i.a + i.b, t: process.hrtime.bigint().toString() }') }, async (dir) => {
    const cases = await built(dir);
    const r = await runCases(cases, { command: 'node calc.mjs', cwd: join(dir, 'impl'), noStatic: true, withoutOracle: true, repeat: 2 });
    assert.ok(r.failures.some((f) => f.id === 'protocol:deterministic'), JSON.stringify(r.failures.map((f) => f.id)));
  });
});

test('static: globs, budgets, JSON shape, text and commands', async () => {
  assert.ok(globToRegExp('**/*.ts').test('a.ts'));
  assert.ok(globToRegExp('**/*.ts').test('src/deep/a.ts'));
  assert.ok(!globToRegExp('*.ts').test('src/a.ts'));
  assert.ok(globToRegExp('**/test/**').test('src/test/x.ts'));
  await withFiles({
    'REGEN.json': '{"lang": "ts", "test": "node -e \\"process.exit(0)\\"", "driver": "node d.ts"}',
    'src/a.ts': 'one\n\ntwo\nthree\n',
    'src/a.test.ts': 'x\ny\nz\n',
    'bad/REGEN.json': '{"lang": "rust", "test": "node -e \\"process.exit(4)\\""}',
    'package.json': '{"name": "x", "devDependencies": {"y": "1"}}',
  }, async (dir) => {
    const env = new Map([['command', parseType('string | {default: string, ...}').type]]);
    const T = (s) => parseType(s).type;
    assert.deepEqual(await evaluateStatic({ kind: 'lines', globs: ['**/*.ts'], max: 3, exclude: ['**/*.test.*'] }, dir), { ok: true, why: [], measured: 3 });
    assert.equal((await evaluateStatic({ kind: 'lines', globs: ['**/*.ts'], max: 5, exclude: [] }, dir)).ok, false);
    assert.equal((await evaluateStatic({ kind: 'exists', globs: ['REGEN.json'] }, dir)).ok, true);
    assert.equal((await evaluateStatic({ kind: 'absent', globs: ['node_modules', 'src'] }, dir)).ok, false);
    assert.equal((await evaluateStatic({ kind: 'json', target: 'REGEN.json', type: T('{lang: "ts" | "py", test: command, driver: command}') }, dir, env)).ok, true);
    assert.match((await evaluateStatic({ kind: 'json', target: 'bad/REGEN.json', type: T('{lang: "ts" | "py", ...}') }, dir, env)).why[0], /none of/);
    assert.equal((await evaluateStatic({ kind: 'text', globs: ['package.json'], pattern: '"(dev|peer|optional)?[dD]ependencies"' }, dir)).ok, false);
    assert.equal((await evaluateStatic({ kind: 'command', key: 'test', within: 30 }, dir)).ok, true);
    const bad = await evaluateStatic({ kind: 'command', key: 'test', within: 30 }, join(dir, 'bad'));
    assert.match(bad.why[0], /status 4/);
  });
});
