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

test('diff: an old example replaced, not edited, is run through the new oracle', async () => {
  const { behaviorChanges, withBehavior } = await import('../src/diff.mjs');
  const oracle = (k) => `for await (const c of process.stdin) for (const l of String(c).split('\\n')) if (l.trim()) { const r = JSON.parse(l); console.log(JSON.stringify({ id: r.id, result: r.input.x + ${k} })); }\n`;
  const rec = (x, want, version) => src(`
duramen 0.1
spec s ${version}
oracle node oracle.mjs
op f
  input x number
req A "a"
  example f {"x": ${x}}
    expect result = ${want}
`);
  await withFiles({ 'old/s.duramen': rec(1, 2, '1.0.0'), 'old/oracle.mjs': oracle(1), 'new/s.duramen': rec(5, 7, '1.1.0'), 'new/oracle.mjs': oracle(2) }, async (dir) => {
    const a = loadRecord(join(dir, 'old')).ast, b = loadRecord(join(dir, 'new')).ast;
    const d = diffRecords(a, b);
    assert.equal(d.worst, 'tightening'); // the texts show one example removed and one added
    const beh = await behaviorChanges(a, b);
    assert.equal(beh.compared, 1);
    assert.deepEqual(beh.changes.map((c) => c.kind), ['breaking']);
    assert.match(beh.changes[0].what, /result was 2, the new oracle gives 3/);
    const r = withBehavior(d, a, b, beh);
    assert.equal(r.worst, 'breaking');
    assert.equal(r.version.ok, false); // 1.0.0 -> 1.1.0 is too small for a breaking change
  });
});

test('agree: an audit that is not a string is no part of the answer, in either order (REQ-SU-005)', async () => {
  const AUDITED = (audit) => `import { readFileSync } from 'node:fs';
for (const line of readFileSync(0, 'utf8').split('\\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  console.log(JSON.stringify({ id: r.id, result: { sum: r.input.a + r.input.b }, audit: ${JSON.stringify(audit)} }));
}`;
  const spec = src(`
duramen 0.2
spec calc 1.0.0
oracle node calc.mjs
op add
  input a integer in 0 .. 5, b integer in 0 .. 5
  audit
req ADD-1 "Adds"
  example add {"a": 1, "b": 2}
    expect result.sum = 3
`);
  await withFiles({ 'calc.mjs': AUDITED('x'), 'calc.duramen': spec, 'five/calc.mjs': AUDITED(5), 'six/calc.mjs': AUDITED(6), 'text/calc.mjs': AUDITED('y') }, async (dir) => {
    const { ast } = loadRecord(join(dir, 'calc.duramen'));
    const at = (name) => ({ name, command: 'node calc.mjs', cwd: join(dir, name) });
    assert.deepEqual((await agree(ast, [at('five'), at('six')], { samples: 5 })).disagreements, []);
    for (const order of [[at('five'), at('text')], [at('text'), at('five')]]) {
      const r = await agree(ast, order, { samples: 5 });
      assert.equal(r.disagreements.length, 5);
      assert.equal(r.disagreements[0].groups.length, 2);
    }
  });
});
