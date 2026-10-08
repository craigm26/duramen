import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { main, parseArgs } from '../src/cli.mjs';
import { tokenize, mutantsOf, mutate } from '../src/mutate.mjs';
import { loadRecord } from '../src/record.mjs';
import { ROOT, CALC_ORACLE, src, withFiles } from './helpers.mjs';

const BIN = join(ROOT, 'bin', 'duramen.mjs');
const run = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd });

async function capture(argv) {
  const out = [], err = [];
  const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('cli: options', () => {
  assert.deepEqual(parseArgs(['x', '--out', 'd', '--json'], { out: 'value', json: 'flag' }), { _: ['x'], out: 'd', json: true });
  assert.deepEqual(parseArgs(['--out=d', 'x'], { out: 'value' }), { _: ['x'], out: 'd' });
  assert.match(parseArgs(['--nope'], {}).error, /unknown option/);
  assert.match(parseArgs(['--out'], { out: 'value' }).error, /needs a value/);
  assert.match(parseArgs(['--json=1'], { json: 'flag' }).error, /takes no value/);
});

test('cli: exit status 0 ok, 1 spec errors or failures, 2 usage and files', async () => {
  assert.equal((await capture([])).code, 2);
  assert.equal((await capture(['frobnicate', 'x'])).code, 2);
  assert.equal((await capture(['check'])).code, 2);
  assert.equal((await capture(['check', 'a', 'b'])).code, 2);
  assert.equal((await capture(['check', 'no-such-file.duramen'])).code, 2);
  assert.equal((await capture(['run', join(ROOT, 'examples', 'history', 'r01-typed-example.duramen')])).code, 2); // no --impl or --driver
  assert.equal((await capture(['check', join(ROOT, 'examples', 'history', 'r01-typed-example.duramen')])).code, 1);
  assert.equal((await capture(['--version'])).code, 0);
  assert.equal((await capture(['help'])).code, 0);
});

test('cli: --json gives one parseable object', async () => {
  const r = await capture(['check', join(ROOT, 'examples', 'history', 'r02-order-restated.duramen'), '--json']);
  assert.equal(r.code, 1);
  const j = JSON.parse(r.out);
  assert.equal(j.ok, false);
  assert.deepEqual(j.diagnostics.map((d) => d.code), ['T005']);
  assert.ok(Number.isInteger(j.diagnostics[0].col));
});

test('cli: run through the binary, with an implementation that is missing its REGEN.json', async () => {
  await withFiles({ 'calc.mjs': CALC_ORACLE, 's.duramen': 'duramen 0.2\nspec s 1\noracle node calc.mjs\nop add\n  input a number, b number\nreq A "a"\n  example add {"a": 1, "b": 1}\n    expect result.sum = 2\n', 'impl/x': '' }, async (dir) => {
    const bad = run(['run', 's.duramen', '--impl', 'impl'], dir);
    assert.equal(bad.status, 2, bad.stdout + bad.stderr);
    assert.match(bad.stderr, /REGEN\.json not found/);
    assert.doesNotMatch(bad.stderr, /at .*\.mjs:\d+/, 'no stack trace');
    const ok = run(['run', 's.duramen', '--driver', 'node calc.mjs', '--cwd', '.', '--no-static'], dir);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /passed 4\/4/);
  });
});

test('mutate: the tokenizer skips strings, comments, templates and regular expressions', () => {
  const toks = tokenize('const a = "1 + 2"; // 3 * 4\nconst b = `x ${c + 1} y`; const r = /a+b/g; const d = e / 2;');
  const nums = toks.filter((t) => t.t === 'num').map((t) => t.v);
  assert.deepEqual(nums, ['1', '2']); // the 1 inside ${...} and the 2 in e / 2
  assert.ok(toks.some((t) => t.t === 'regex'));
  const ms = mutantsOf('const f = (x) => x < 80 ? -1 : x * 2;');
  assert.deepEqual(ms.map((m) => `${m.from}->${m.to}`), ['<-><=', '80->81', '80->79', '1->2', '1->0', '*->/', '2->3', '2->1']);
});

test('mutate: catches what the checks pin, and names what they do not', async () => {
  // the oracle's sum is pinned by a typed example; its "double" op only by a value written ?
  const ORACLE = CALC_ORACLE.replace("else if (r.op === 'echo')", "else if (r.op === 'double' && i && typeof i.a === 'number') out.push(JSON.stringify({ id, result: { d: i.a * 2 } }));\n  else if (r.op === 'echo')");
  await withFiles({ 'calc.mjs': ORACLE, 's.duramen': src(`
duramen 0.2
spec s 1
oracle node calc.mjs
  source calc.mjs
op add
  input a number, b number
op double
  input a number
req A-1 "Adds"
  example add {"a": 1, "b": 2}
    expect result.sum = 3
req A-2 "Doubles"
  example double {"a": 4}
    expect result.d = ?
`) }, async (dir) => {
    const { ast } = loadRecord(join(dir, 's.duramen'));
    const r = await mutate(ast, [join(dir, 'calc.mjs')], { jobs: 2 });
    assert.equal(r.error, undefined);
    const unpinned = r.unpinned.map((m) => `${m.from}->${m.to}`);
    assert.ok(unpinned.includes('*->/') && unpinned.includes('2->3'), `the doubling is unpinned: ${unpinned}`);
    assert.ok(r.results.some((m) => m.from === '+' && m.to === '-' && m.caught.includes('T002')), 'the sum is pinned');
  });
});
