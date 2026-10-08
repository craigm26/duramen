import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadRecord } from '../src/record.mjs';
import { agree, agreeRequests } from '../src/agree.mjs';
import { diffRecords, versionVerdict } from '../src/diff.mjs';
import { CALC_ORACLE, src, withFiles } from './helpers.mjs';

const SPEC = (version, extra = '') => src(`
duramen 0.2
spec calc ${version}
oracle node calc.mjs
op add
  input a integer in 0 .. 5, b integer in 0 .. 5
req ADD-1 "Adds"
  example add {"a": 1, "b": 2}
    expect result.sum = 3
${extra}`);

test('agree: generated requests are deterministic, and a disagreement names who said what', async () => {
  const OFF_BY_ONE_AT_5 = CALC_ORACLE.replace('result: { sum: i.a + i.b }', 'result: { sum: i.a === 5 ? i.a + i.b + 1 : i.a + i.b }');
  await withFiles({ 'calc.mjs': CALC_ORACLE, 'calc.duramen': SPEC('1.0.0'), 'a/calc.mjs': CALC_ORACLE, 'b/calc.mjs': OFF_BY_ONE_AT_5 }, async (dir) => {
    const { ast } = loadRecord(join(dir, 'calc.duramen'));
    assert.deepEqual(agreeRequests(ast, { samples: 10 }).requests.map((r) => r.line), agreeRequests(ast, { samples: 10 }).requests.map((r) => r.line));
    const r = await agree(ast, [
      { name: 'oracle', command: 'node calc.mjs', cwd: dir },
      { name: 'a', command: 'node calc.mjs', cwd: join(dir, 'a') },
      { name: 'b', command: 'node calc.mjs', cwd: join(dir, 'b') },
    ], { samples: 60 });
    assert.equal(r.requests, 60);
    assert.ok(r.disagreements.length > 0);
    for (const d of r.disagreements) {
      assert.equal(d.input.a, 5);
      assert.deepEqual(d.groups.map((g) => g.names), [['oracle', 'a'], ['b']]);
    }
  });
});

test('diff: changes are classified, and the version bump is checked', async () => {
  await withFiles({
    'old.duramen': SPEC('1.0.0', 'req ADD-2 "Zero"\n  example add {"a": 0, "b": 0}\n    expect result.sum = 0\nopen O-1 "Later"\n  text\n    Later.\n'),
    'tight.duramen': SPEC('1.0.0', 'req ADD-2 "Zero"\n  example add {"a": 0, "b": 0}\n    expect result.sum = 0\n  example add {"a": 0, "b": 1}\n    expect result.sum = 1\nopen O-1 "Later"\n  text\n    Later.\n'),
    'break.duramen': SPEC('1.1.0', 'req ADD-2 "Zero"\n  example add {"a": 0, "b": 0}\n    expect result.sum = 1\n'),
  }, async (dir) => {
    const load = (f) => loadRecord(join(dir, f)).ast;
    const t = diffRecords(load('old.duramen'), load('tight.duramen'));
    assert.equal(t.worst, 'tightening');
    assert.equal(t.version.ok, false); // 1.0.0 -> 1.0.0
    const b = diffRecords(load('old.duramen'), load('break.duramen'));
    assert.deepEqual(b.changes.filter((c) => c.kind === 'breaking').map((c) => c.what), ['REQ-ADD-2: expectation result.sum changed (line 10)']);
    assert.ok(b.changes.some((c) => c.kind === 'tightening' && c.what === 'OPEN-O-1 removed'));
    assert.equal(b.version.ok, false); // breaking from 1.0.0 needs 2.0.0
    assert.match(b.version.why, /major/);
  });
  assert.equal(versionVerdict('0.3.1', '0.4.0', 'breaking').ok, true); // before 1.0, the minor carries breaking changes
  assert.equal(versionVerdict('1.2.0', '1.2.1', 'additive').ok, false);
  assert.equal(versionVerdict('1.2.0', '1.2.1', 'prose').ok, true);
  assert.equal(versionVerdict('x', 'y', 'prose').ok, null);
});
