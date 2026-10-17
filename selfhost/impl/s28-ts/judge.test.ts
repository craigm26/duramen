import assert from 'node:assert/strict';
import test from 'node:test';
import { atPath, equal, judge, validJudge } from './comparison.ts';
import { handle } from './core.ts';

test('REQ-JU-001: verdict shape, failed-part ordering, null answer and ignored metadata', () => {
  const c = { checks: [{ path: 'result', kind: 'eq', value: 2 }, { path: 'error', kind: 'eq', value: 1 }], full: { members: ['audit', 'id', 'result'], result: 2, audit: 'A', tolerances: {} }, id: 'unused', metadata: true };
  assert.deepEqual(judge(c, null), { pass: false, failed: ['answer'] });
  assert.deepEqual(judge(c, { id: 'anything', result: 3, audit: 'B', extra: null }), { pass: false, failed: ['checks.0', 'checks.1', 'members', 'result', 'audit'] });
  assert.deepEqual(judge({ checks: [], full: null, ignored: [] }, { any: 'object' }), { pass: true });
});

test('REQ-JU-001: every required shape is validated before judging', () => {
  const good = { checks: [], full: null };
  const invalid = [null, [], {}, { checks: [], full: {} }, { checks: [], full: { members: [], tolerances: [], audit: '' } }, { checks: [{ path: '', kind: 'eq' }], full: null }, { checks: [{ path: '', kind: 'approx', value: 0, tol: -0.1 }], full: null }, { checks: [{ path: '', kind: 'approx', value: false, tol: 0 }], full: null }, { checks: [{ path: '', value: 0 }], full: null }, { checks: [{ path: 0, kind: 'eq', value: 0 }], full: null }, { checks: [], full: { members: [false], tolerances: {} } }, { checks: [], full: { members: [], tolerances: { x: null } } }, { checks: [], full: { members: [], tolerances: {}, audit: [] } }];
  for (const c of invalid) assert.deepEqual(handle({ id: 'j', op: 'judge', input: { case: c, answer: null } }), { id: 'j', error: 'bad_request' });
  for (const answer of [[], 'string', false, 0]) assert.equal(validJudge({ case: good, answer }), false);
  assert.equal(validJudge({ case: good }), false);
  assert.equal(validJudge({ case: good, answer: {} }), true);
});

test('REQ-JU-002: paths use own object members, canonical array indices, empty names and parsed audit', () => {
  const answer = JSON.parse('{"result":{"a":[4,5],"":{"":null},"object":{"01":8,"length":7},"text":"abc","__proto__":{"constructor":6}},"audit":"{\\"a\\":[2],\\"\\":9}"}');
  for (const [path, value] of [['result.a.0', 4], ['result..', null], ['result.object.01', 8], ['result.object.length', 7], ['result.__proto__.constructor', 6], ['audit.a.0', 2], ['audit.', 9]]) assert.deepEqual(atPath(answer, path as string), value);
  for (const path of ['result.a.01', 'result.a.-1', 'result.a.+0', 'result.a.1.0', 'result.a.length', 'result.text.length', 'result.constructor', 'audit.a.9']) assert.equal(atPath(answer, path), undefined, path);
  for (const audit of ['not-json', '{"x":1,"big":1e999}', 3, null]) assert.equal(atPath({ audit }, 'audit.x'), undefined);
});

test('REQ-JU-003: JSON types, order, signed zero, presence and exact binary64 distance', () => {
  assert.equal(equal({ b: [1, null], a: 0 }, { a: -0, b: [1.0, null] }), true);
  for (const [a, b] of [[true, 1], ['1', 1], [null, false], [{}, []], [[1, 2], [2, 1]], [{ a: 1 }, { a: 1, b: 2 }]]) assert.equal(equal(a, b), false);
  const c = { checks: [{ kind: 'eq', path: 'result.null', value: null }, { kind: 'eq', path: 'result.missing', value: null }, { kind: 'approx', path: 'result.n', value: 1.9, tol: 0.1 }, { kind: 'approx', path: 'result.n', value: 2.5, tol: 0.5 }, { kind: 'approx', path: 'result.s', value: 2, tol: 1 }], full: null };
  assert.deepEqual(judge(c, { result: { null: null, n: 2, s: '2' } }), { pass: false, failed: ['checks.1', 'checks.2', 'checks.4'] });
});

test('REQ-JU-004: members use UTF-16 order, preserve full.members order, and ignore id values', () => {
  const c = { checks: [], full: { members: ['id', '😀', '\uFFFE'], tolerances: {} } };
  assert.deepEqual(judge(c, { '\uFFFE': 1, id: 999, '😀': null }), { pass: true });
  assert.deepEqual(judge({ ...c, full: { ...c.full, members: ['id', '\uFFFE', '😀'] } }, { '\uFFFE': 1, id: 999, '😀': null }), { pass: false, failed: ['members'] });
});

test('REQ-JU-004: error presence supersedes result/audit and compares any JSON value', () => {
  const c = { checks: [], full: { members: ['audit', 'error', 'id', 'result'], error: { code: [1, null] }, result: 999, audit: 'expected', tolerances: {} } };
  assert.deepEqual(judge(c, { id: null, error: { code: [1.0, null] }, result: false, audit: 123 }), { pass: true });
  assert.deepEqual(judge(c, { id: null, error: null, result: 999, audit: 'expected' }), { pass: false, failed: ['error'] });
  assert.deepEqual(judge({ checks: [], full: { members: [], error: null, tolerances: {} } }, {}), { pass: false, failed: ['error'] });
});

test('REQ-JU-004: tolerances apply at exact nested result paths, preserving shape and audit text', () => {
  const c = { checks: [], full: { members: ['audit', 'result'], result: { rows: [{ x: 2 }], exact: [1] }, audit: 'é\n', tolerances: { 'result.rows.0.x': 0.5, result: 100 } } };
  assert.deepEqual(judge(c, { result: { exact: [1], rows: [{ x: 2.5 }] }, audit: 'é\n' }), { pass: true });
  for (const result of [{ rows: [{ x: 2.50001 }], exact: [1] }, { rows: [{ x: '2' }], exact: [1] }, { rows: [{ x: 2 }], exact: [1, 2] }, { rows: [{ x: 2, extra: 1 }], exact: [1] }]) assert.deepEqual(judge(c, { result, audit: 'é\n' }), { pass: false, failed: ['result'] });
  assert.deepEqual(judge(c, { result: c.full.result, audit: 'e\u0301\n' }), { pass: false, failed: ['audit'] });
});
