import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle } from '../src/handler.ts';

const echo = readFileSync(new URL('../fixtures/echo.mjs', import.meta.url), 'utf8');

function diags(files: Record<string, string>, entry?: string): string[] {
  const r = handle(JSON.stringify({ id: 'x', op: 'check', input: entry === undefined ? { files } : { files, entry } }));
  return r.result.diagnostics;
}

test('rest-of-language statements and clauses are accepted and ignored (OPEN-RC-001)', () => {
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.2\nspec s 1\ntype T\n  anything goes\nproperty p\n  x\n' }), []);
});

test('a second duramen statement is read like a first (REQ-RC-004)', () => {
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.1\nspec s 1\nduramen 0.1\n  title "t"\n' }), ['s.duramen:3: error P023', 's.duramen:4: error P015']);
});

test('read errors stop the check and the suite (REQ-RC-005, REQ-SU-001)', () => {
  const r = handle(JSON.stringify({ id: 'x', op: 'cases', input: { files: { 's.duramen': 'duramen 0.1\nspec s 1\nbogus\n' } } }));
  assert.deepEqual(r.result, { errors: 1, cases: [] });
});

test('warnings do not stop the suite (REQ-SU-001)', () => {
  const files = { 's.duramen': 'duramen 0.1\nspec s 1\noracle node echo.mjs\nop f\n  input x? json\nreq A "a"\n  example f {"y": 1}\n', 'echo.mjs': echo };
  const r = handle(JSON.stringify({ id: 'x', op: 'cases', input: { files } }));
  assert.equal(r.result.errors, 0);
  assert.equal(r.result.cases.length, 1);
});

test('judge: a failing answer lists parts in order (REQ-JU-001)', () => {
  const c = { checks: [{ path: 'result', kind: 'eq', value: 1 }], full: { members: ['id', 'result'], result: 1, tolerances: {} } };
  const r = handle(JSON.stringify({ id: 'j', op: 'judge', input: { case: c, answer: { id: 'a', result: 2, extra: 1 } } }));
  assert.deepEqual(r.result, { pass: false, failed: ['checks.0', 'members', 'result'] });
});

test('judge: tolerance applies to a path of the result (REQ-JU-004)', () => {
  const c = { checks: [], full: { members: ['id', 'result'], result: { t: 1 }, tolerances: { 'result.t': 0.5 } } };
  const ok = handle(JSON.stringify({ id: 'j', op: 'judge', input: { case: c, answer: { id: 'a', result: { t: 1.4 } } } }));
  const bad = handle(JSON.stringify({ id: 'j', op: 'judge', input: { case: c, answer: { id: 'a', result: { t: 1.6 } } } }));
  assert.deepEqual(ok.result, { pass: true });
  assert.deepEqual(bad.result, { pass: false, failed: ['result'] });
});
