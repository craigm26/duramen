import assert from 'node:assert';
import { test } from 'node:test';
import { call } from './helpers.ts';

const j = async (kase: unknown, answer: unknown) => (await call('judge', { case: kase, answer })).result;
const bad = async (input: unknown) => assert.deepStrictEqual(await call('judge', input), { id: '1', error: 'bad_request' });
const full = (members: string[], extra: object = {}) => ({ members, tolerances: {}, ...extra });
const eq = (path: string, value: unknown) => ({ path, kind: 'eq', value });

test('REQ-JU-001: verdicts', async () => {
  const c = { checks: [eq('result.x', 1)], full: full(['id', 'result'], { result: { x: 1 } }) };
  assert.deepStrictEqual(await j(c, { id: 'A#1', result: { x: 1 } }), { pass: true });
  assert.deepStrictEqual(await j(c, null), { pass: false, failed: ['answer'] });
  assert.deepStrictEqual(
    await j(
      { checks: [eq('result.x', 1), eq('result.y', 2), eq('id', 'A#1')], full: full(['id', 'result'], { result: { x: 1, y: 2 } }) },
      { id: 'A#1', result: { x: 5 }, note: 1 }),
    { pass: false, failed: ['checks.0', 'checks.1', 'members', 'result'] });
  assert.deepStrictEqual(
    await j({ id: 'A#1', kind: 'example', line: '{}', checks: [], full: null, more: 1 }, { id: 'anything', x: 1 }), { pass: true });
  await bad({ case: { checks: [], full: null } });
  assert.deepStrictEqual(await call('judge', undefined), { id: '1', error: 'bad_request' });
  const rows: [unknown, unknown][] = [
    [[], null],
    [{ checks: {}, full: null }, null],
    [{ checks: [{ path: 'result', kind: 'eq' }], full: null }, null],
    [{ checks: [{ path: 1, kind: 'eq', value: 1 }], full: null }, null],
    [{ checks: [{ path: 'result', kind: 'approx', value: '1', tol: 0 }], full: null }, null],
    [{ checks: [{ path: 'result', kind: 'approx', value: 1, tol: -1 }], full: null }, null],
    [{ checks: [{ path: 'result', kind: 'approx', value: 1 }], full: null }, null],
    [{ checks: [1], full: null }, null],
    [{ checks: [] }, null],
    [{ full: null }, null],
    [{ checks: [], full: [] }, null],
    [{ checks: [], full: { members: 'id', tolerances: {} } }, null],
    [{ checks: [], full: { members: [1], tolerances: {} } }, null],
    [{ checks: [], full: { members: ['id'] } }, null],
    [{ checks: [], full: { members: ['id'], tolerances: { result: '1' } } }, null],
    [{ checks: [], full: { members: ['id'], tolerances: { result: -1 } } }, null],
    [{ checks: [], full: { members: ['id', 'audit'], tolerances: {}, audit: 1 } }, null],
    [{ checks: [], full: null }, []],
    [{ checks: [], full: null }, 'x'],
  ];
  for (const [k, a] of rows) await bad({ case: k, answer: a });
});

test('REQ-JU-002: paths in an answer', async () => {
  const checks = [
    eq('result.a.0', 5), eq('result.a.01', 6), eq('result.a.length', 2), eq('result.b.', 3), eq('result.c.0', 7),
    eq('result.d.length', 3), eq('audit.k.1', 2), eq('audit', '{"k": [1, 2]}'), eq('result.a.-1', 6),
  ];
  assert.deepStrictEqual(
    await j({ checks, full: null }, { id: 'A#1', result: { a: [5, 6], b: { '': 3 }, c: { 0: 7 }, d: 'abc' }, audit: '{"k": [1, 2]}' }),
    { pass: false, failed: ['checks.1', 'checks.2', 'checks.5', 'checks.8'] });
  assert.deepStrictEqual(
    await j({ checks: [eq('audit.k', 1), eq('audit', '{"k": 1, "big": 1e400}')], full: null }, { id: 'A#1', audit: '{"k": 1, "big": 1e400}' }),
    { pass: false, failed: ['checks.0'] });
  assert.deepStrictEqual(
    await j({ checks: [eq('audit.k', 1), eq('result', null)], full: null }, { id: 'A#1', audit: 'k=1' }),
    { pass: false, failed: ['checks.0', 'checks.1'] });
});

test('REQ-JU-003: checks', async () => {
  const checks = [
    eq('result.o', { a: 1, b: [1, 2] }), eq('result.z', 0), eq('result.t', 1), eq('result.n', true), eq('result.s', 1),
    eq('result.missing', null), eq('result.e', []), eq('result.l', {}), eq('result.p', [1, 2]), eq('result.w', { a: 1 }),
    { path: 'result.h', kind: 'approx', value: 2, tol: 0.5 }, { path: 'result.i', kind: 'approx', value: 2, tol: 0.5 },
    { path: 'result.j', kind: 'approx', value: 2, tol: 0.5 }, { path: 'result.k', kind: 'approx', value: 2, tol: 0.5 },
    { path: 'result.m', kind: 'approx', value: 1.9, tol: 0.1 }, eq('result.u', null),
  ];
  const answer = JSON.parse(
    '{"id":"A#1","result":{"o":{"b":[1,2.0],"a":1.0},"z":-0,"t":true,"n":1,"s":"1","e":{},"l":[],"p":[2,1],"w":{"a":1,"b":2},"h":2.5,"i":2.5000001,"j":"2","k":1.5,"m":2,"u":null}}');
  assert.deepStrictEqual(await j({ checks, full: null }, answer), {
    pass: false,
    failed: ['checks.2', 'checks.3', 'checks.4', 'checks.5', 'checks.6', 'checks.7', 'checks.8', 'checks.9', 'checks.11', 'checks.12', 'checks.14'],
  });
});

test('REQ-JU-004: the whole answer', async () => {
  assert.deepStrictEqual(
    await j({ checks: [], full: full(['id', 'result'], { result: 1 }) }, { result: 1, id: 'A#1' }), { pass: true });
  assert.deepStrictEqual(
    await j({ checks: [], full: full(['error', 'id'], { error: 'e' }) }, { id: 'x', error: 'f', result: 1 }),
    { pass: false, failed: ['members', 'error'] });
  assert.deepStrictEqual(
    await j({ checks: [], full: full(['error', 'id'], { error: { code: 1, at: [1] } }) }, { id: 'x', error: { at: [1.0], code: 1 } }),
    { pass: true });
  assert.deepStrictEqual(
    await j({ checks: [], full: full(['error', 'id'], { error: null }) }, { id: 'x' }), { pass: false, failed: ['members', 'error'] });
  assert.deepStrictEqual(
    await j({ checks: [], full: { members: ['id', 'result'], result: 10, tolerances: { result: 1 } } }, { id: 'A#1', result: 10.5 }),
    { pass: true });
  const fa = full(['audit', 'id', 'result'], { result: 1, audit: 'A' });
  assert.deepStrictEqual(await j({ checks: [], full: fa }, { id: 'A#1', result: 1, audit: 'A ' }), { pass: false, failed: ['audit'] });
  assert.deepStrictEqual(await j({ checks: [], full: fa }, { id: 'A#1', result: 1 }), { pass: false, failed: ['members', 'audit'] });
  assert.deepStrictEqual(await j({ checks: [], full: full(['id']) }, { id: 'x', result: 1 }), { pass: false, failed: ['members'] });
  const tf = { members: ['id', 'result'], result: { t: 1, u: [1, 2] }, tolerances: { 'result.t': 0.5, 'result.u.1': 0.1 } };
  const rows: [unknown, boolean, string[]?][] = [
    [{ id: 'A#1', result: { u: [1, 2.05], t: 1.5 } }, true],
    [{ id: 'A#1', result: { u: [1.01, 2], t: 1 } }, false, ['result']],
    [{ id: 'A#1', result: { u: [1, 2], t: '1' } }, false, ['result']],
    [{ id: 'A#1', result: { u: [1, 2], t: 1, v: 0 } }, false, ['result']],
    [{ id: 'A#1', result: { u: [1, 2, 3], t: 1 } }, false, ['result']],
    [{ id: 'A#1' }, false, ['members', 'result']],
    [{ id: 'A#1', result: { u: [1, 2], t: 0.4 } }, false, ['result']],
  ];
  for (const [a, pass, failed] of rows) {
    assert.deepStrictEqual(await j({ checks: [], full: tf }, a), pass ? { pass: true } : { pass: false, failed });
  }
});
