import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { handle } from './driver.ts';
import { canonical } from './engine.ts';

const CLOCK = '1999-12-31T23:59:59.999Z';

function call(op: string, input: unknown, extra: Record<string, unknown> = {}) {
  const line = JSON.stringify({ id: 't', op, input, clock: CLOCK, ...extra });
  const r = JSON.parse(handle(line));
  if (r.audit !== undefined) r.auditObj = JSON.parse(r.audit);
  return r;
}
const close = (a: number, b: number, tol = 0.00001) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('REQ-IF-004 clock injected', () => {
  assert.equal(call('flagF', { wetBulbF: 70 }).auditObj.computed_at, CLOCK);
  const c = call('flagC', { wetBulbC: 30 }).auditObj;
  assert.equal(c.computed_at, CLOCK);
  assert.equal(c.children[0].computed_at, CLOCK);
});

test('REQ-IF-006 numbers and specials', () => {
  assert.equal(call('wetBulb', { tempC: 2.0e1, rhPercent: 50.0 }).auditObj.result_summary, 'T=20.0°C RH=50% → Tw=13.70°C');
  const r = call('flagC', { wetBulbC: '-Infinity' });
  assert.equal(r.result, null);
  assert.equal(r.auditObj.inputs.wetBulbC, '-Infinity');
  assert.equal(r.audit.includes('"inputs":{"wetBulbC":"-Infinity"}'), true);
});

test('REQ-IF-007 errors', () => {
  const h = (s: string) => JSON.parse(handle(s));
  assert.deepEqual(h('{not json'), { id: null, error: 'bad_request' });
  assert.deepEqual(h('[1,2]'), { id: null, error: 'bad_request' });
  assert.deepEqual(h('{"op":"flagF","input":{"wetBulbF":80},"clock":"c"}'), { id: null, error: 'bad_request' });
  assert.deepEqual(h('{"id":5,"op":"flagF"}'), { id: null, error: 'bad_request' });
  assert.deepEqual(h('{"id":"a","op":"heatIndex","input":{"tempC":20},"clock":"c"}'), { id: 'a', error: 'unknown_op' });
  assert.deepEqual(h('{"id":"a","input":{"wetBulbF":80},"clock":"c"}'), { id: 'a', error: 'unknown_op' });
  assert.deepEqual(h('{"id":"a","op":"heatIndex"}'), { id: 'a', error: 'unknown_op' });
  assert.deepEqual(h('{"id":"a","op":"flagF","clock":"c"}'), { id: 'a', error: 'bad_request' });
  assert.deepEqual(h('{"id":"a","op":"flagF","input":{"wetBulbF":80}}'), { id: 'a', error: 'bad_request' });
  assert.deepEqual(h('{"id":"a","op":"wetBulb","input":{"tempC":20},"clock":"c"}'), { id: 'a', error: 'bad_request' });
  assert.deepEqual(h('{"id":"a","op":"flagF","input":{"wetBulbF":true},"clock":"c"}'), { id: 'a', error: 'bad_request' });
  assert.deepEqual(h('{"id":"a","op":"flagF","input":{"wetBulbF":"80"},"clock":"c"}'), { id: 'a', error: 'bad_request' });
  assert.deepEqual(h('{"id":"a","op":"canonical","input":{}}'), { id: 'a', error: 'bad_request' });
});

test('REQ-IF-008 extra members ignored', () => {
  const line = '{"id":"extra","op":"flagF","input":{"wetBulbF":86,"note":"x"},"clock":"2026-05-26T17:00:00.000Z","trace":true}';
  assert.deepEqual(JSON.parse(handle(line)).result, { flag: 'yellow', flagDartLabel: 'high' });
});

test('REQ-CJ-005 canonical', () => {
  const r = JSON.parse(handle('{"id":"c","op":"canonical","input":{"value":{"b":[1,2.50,1e21],"a":null}}}'));
  assert.deepEqual(r, { id: 'c', result: '{"a":null,"b":[1,2.5,1e+21]}' });
  const s = JSON.parse(handle('{"id":"c","op":"canonical","input":{"value":{"y":"Infinity","x":"NaN"}}}'));
  assert.equal(s.result, '{"x":"NaN","y":"Infinity"}');
});

test('edges: number text, escaping, key order', () => {
  assert.equal(canonical([-0, 1e-7, 123456789012345680000, 1e21, 0.000001, 1.5e-10, -1e-7]), '[0,1e-7,123456789012345680000,1e+21,0.000001,1.5e-10,-1e-7]');
  assert.equal(canonical('\u0001\b\f\n\r\t"\\/\x7f '), '"\\u0001\\b\\f\\n\\r\\t\\"\\\\/\x7f "');
  assert.equal(canonical('\ud800a\udc00😀'), '"\\ud800a\\udc00😀"');
  assert.equal(canonical({ '': 1, '😀': 2, a: 3 }), '{"a":3,"😀":2,"":1}');
});

test('REQ-AU-001 audit members', () => {
  const a = call('flagF', { wetBulbF: 85 }).auditObj;
  assert.equal(a.spec_version, '0.2.0');
  assert.equal(a.function, 'flagFromWetBulbF');
  assert.deepEqual(Object.keys(a).sort(), ['citation', 'computed_at', 'constants', 'function', 'inputs', 'result_summary', 'spec_version']);
  assert.equal(call('flagC', { wetBulbC: 30 }).auditObj.children.length, 1);
});

test('REQ-AU-002 non-finite inputs in audit', () => {
  const r = call('wetBulb', { tempC: 'Infinity', rhPercent: 'NaN' });
  assert.equal(r.audit.includes('"inputs":{"rhPercent":"NaN","tempC":"Infinity"}'), true);
});

test('REQ-WB-001/002 wet-bulb', () => {
  const rows: [number, number, number, number | undefined][] = [
    [20, 50, 13.69934, undefined],
    [25, 120, 25.04558, 100],
    [30, 2.5, 10.77218, 5],
    [25, 99.5, 24.97823, undefined],
    [60, 50, 48.08736, undefined],
    [-30, 50, -29.31486, undefined],
  ];
  for (const [t, rh, w, c] of rows) {
    const r = call('wetBulb', { tempC: t, rhPercent: rh }).result;
    close(r.wetBulbC, w);
    close(r.wetBulbF, (w * 9) / 5 + 32, 0.000018001);
    assert.equal(r.clampedRhPct, c);
    assert.equal('clampedRhPct' in r, c !== undefined);
  }
});

test('REQ-WB-003 wet-bulb audit', () => {
  const a = call('wetBulb', { tempC: 25, rhPercent: 120 }).auditObj;
  assert.deepEqual(a.inputs, { rhPercent: 120, tempC: 25 });
  assert.deepEqual(a.constants, { rh_clamp_max: 100, rh_clamp_min: 5, stull_a: 0.151977, stull_b: 8.313659, stull_c: 1.676331, stull_d: 0.00391838, stull_e: 0.023101, stull_offset: -4.686035 });
  assert.equal(a.citation, 'Stull (2011) eq. 1');
  assert.equal(a.function, 'calculateWetBulb');
  const rows: [number, number, string][] = [
    [20, 50, 'T=20.0°C RH=50% → Tw=13.70°C'],
    [25, 120, 'T=25.0°C RH=120→100% (rh_clamped) → Tw=25.05°C'],
    [60, 2.5, 'T=60.0°C RH=2.5→5% (rh_clamped,out_of_validity_range) → Tw=25.97°C'],
    [20.25, 50, 'T=20.3°C RH=50% → Tw=13.91°C'],
    [-0.04, 50, 'T=-0.0°C RH=50% → Tw=-3.53°C'],
  ];
  for (const [t, rh, s] of rows) assert.equal(call('wetBulb', { tempC: t, rhPercent: rh }).auditObj.result_summary, s);
  assert.deepEqual(call('wetBulb', { tempC: 20, rhPercent: 50 }).auditObj.constants.rh_clamp_min, undefined);
});

test('REQ-WB-004 non-finite wet-bulb', () => {
  const rows: [unknown, unknown, string][] = [
    ['NaN', 50, 'tempC'], [20, 'NaN', 'rhPercent'], ['Infinity', 50, 'tempC'], [20, '-Infinity', 'rhPercent'], ['NaN', 'NaN', 'tempC'],
  ];
  for (const [t, rh, bad] of rows) {
    const r = call('wetBulb', { tempC: t, rhPercent: rh });
    assert.equal(r.result, null);
    assert.equal(r.auditObj.result_summary, 'invalid_input:' + bad);
    assert.deepEqual(r.auditObj.constants, {});
    assert.equal(r.auditObj.citation, 'Stull (2011) eq. 1');
  }
});

test('REQ-WB-005 wet-bulb from F', () => {
  const a = call('wetBulbF', { tempF: 68, rhPercent: 50 }).auditObj;
  assert.equal(a.result_summary, 'T=20.0°C RH=50% → Tw=13.70°C');
  assert.deepEqual(a.inputs, { rhPercent: 50, tempC: 20 });
  assert.equal(a.function, 'calculateWetBulb');
  assert.equal(call('wetBulbF', { tempF: 100, rhPercent: 40 }).auditObj.inputs.tempC, 37.77777777777778);
  assert.equal(call('wetBulbF', { tempF: 98.6, rhPercent: 50 }).auditObj.inputs.tempC, 37);
  const n = call('wetBulbF', { tempF: 'NaN', rhPercent: 50 });
  assert.equal(n.result, null);
  assert.equal(n.auditObj.result_summary, 'invalid_input:tempC');
});

test('REQ-FL-001 flags', () => {
  const rows: [number, string, string][] = [
    [79.99, 'white', 'low'], [80, 'green', 'moderate'], [84.99, 'green', 'moderate'], [85, 'yellow', 'high'],
    [88, 'red', 'extreme'], [89.99, 'red', 'extreme'], [90, 'black', 'critical'],
  ];
  for (const [w, f, l] of rows) assert.deepEqual(call('flagF', { wetBulbF: w }).result, { flag: f, flagDartLabel: l });
});

test('REQ-FL-002 flag audit', () => {
  const a = call('flagF', { wetBulbF: 85 }).auditObj;
  assert.equal(a.citation, 'USMC 6200.1E Table 3-1');
  assert.deepEqual(a.inputs, { wetBulbF: 85 });
  assert.deepEqual(a.constants, { white_max: 80, green_max: 85, yellow_max: 88, red_max: 90 });
  const rows: [number, string][] = [
    [85, 'wetBulbF=85 → yellow'], [250, 'wetBulbF=250 → black (out_of_observed_range)'],
    [-60, 'wetBulbF=-60 → white (out_of_observed_range)'], [200, 'wetBulbF=200 → black'],
  ];
  for (const [w, s] of rows) assert.equal(call('flagF', { wetBulbF: w }).auditObj.result_summary, s);
});

test('REQ-FL-003 non-finite F', () => {
  const r = call('flagF', { wetBulbF: 'NaN' });
  assert.equal(r.result, null);
  assert.equal(r.auditObj.result_summary, 'invalid_input:wetBulbF');
  assert.deepEqual(r.auditObj.constants, {});
});

test('REQ-FL-004 flag from C', () => {
  const rows: [number, string][] = [[26.66666666666666, 'white'], [30, 'yellow'], [29.444444444444443, 'yellow'], [29.444444443444443, 'green']];
  for (const [c, f] of rows) assert.equal(call('flagC', { wetBulbC: c }).result.flag, f);
});

test('REQ-FL-005 flag C audit', () => {
  const a = call('flagC', { wetBulbC: 30 }).auditObj;
  assert.equal(a.function, 'flagFromWetBulbC');
  assert.equal(a.result_summary, 'wetBulbC=30 → wetBulbF=86.0000 → yellow');
  assert.equal(a.children[0].result_summary, 'wetBulbF=86 → yellow');
  assert.equal(a.children[0].function, 'flagFromWetBulbF');
  assert.equal(call('flagC', { wetBulbC: 26.66666666666666 }).auditObj.result_summary, 'wetBulbC=26.66666666666666 → wetBulbF=80.0000 → white');
});

test('REQ-FL-006 non-finite C', () => {
  const r = call('flagC', { wetBulbC: 'NaN' });
  assert.equal(r.result, null);
  assert.equal(r.auditObj.result_summary, 'invalid_input:wetBulbC');
  assert.equal('children' in r.auditObj, false);
  assert.deepEqual(r.auditObj.constants, {});
});

test('driver process: order, blank lines, exit status', () => {
  const input = '{"id":"1","op":"flagF","input":{"wetBulbF":86},"clock":"c"}\n\n   \n{bad\r\n{"id":"2","op":"canonical","input":{"value":[1]}}';
  const p = spawnSync('node', ['driver.ts'], { input, encoding: 'utf8' });
  assert.equal(p.status, 0);
  const lines = p.stdout.split('\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[3], '');
  assert.equal(JSON.parse(lines[0]).id, '1');
  assert.deepEqual(JSON.parse(lines[1]), { id: null, error: 'bad_request' });
  assert.deepEqual(JSON.parse(lines[2]), { id: '2', result: '[1]' });
  assert.equal(p.stdout.includes('\r'), false);
});
