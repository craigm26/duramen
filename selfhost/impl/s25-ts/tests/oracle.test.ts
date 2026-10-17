import assert from 'node:assert';
import { test } from 'node:test';
import { cases, ECHO, expectDiags, t } from './helpers.ts';

const H = ['duramen 0.1', 'spec s 1'];
const hs = (...lines: string[]) => t(...H, ...lines);
const one = (s: string, expected: string[], extra: Record<string, string> = {}) =>
  expectDiags({ 's.duramen': s, 'echo.mjs': ECHO, ...extra }, expected);
const O = ['oracle node echo.mjs'];

test('REQ-OR-001: a record with examples has an oracle', async () => {
  await expectDiags({ 's.duramen': hs('op f', '  input x? json', 'req A "a"', '  example f {}', '    expect result = 1') }, ['s.duramen:2: error T019']);
  await expectDiags(
    { 's.duramen': hs('op f', '  input x? json', 'req A "a"', '  text', '    No example.', 'req B "b"', '  example f {}') },
    ['s.duramen:2: error T019', 's.duramen:5: error T001']);
});

test('REQ-OR-002: how the oracle is run', async () => {
  await one(
    t('duramen 0.1', 'spec s 1', '  request {"clock": 1}', ...O, 'op f', '  input line? boolean, x? json', 'req A "a"',
      '  example f {"line": true,  "x": 2.50}',
      '    expect result = "{\\"id\\":\\"A#1\\",\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true,  \\"x\\": 2.50}}"',
      '  example f {"line": true}', '    omit id', '    expect result = "{\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true}}"',
      '  example raw \'{"id": "x",  "op": "f", "input": {"line": true}}\'', '    expect id = "x"',
      '    expect result = "{\\"id\\": \\"x\\",  \\"op\\": \\"f\\", \\"input\\": {\\"line\\": true}}"'),
    []);
  await expectDiags(
    {
      'sub/s.duramen': hs('oracle node "my echo.mjs"', 'op f', '  input x? json', 'req A "a"', '  example f {"x": 1}', '    expect result.x = 1'),
      'sub/my echo.mjs': ECHO,
    },
    []);
  await one(hs(...O, 'op f', '  input x? json', 'req A "a"', '  text', '    No example.', 'req B "b"', '  example f {"x": 1}', '    expect result.x = 2'),
    ['s.duramen:6: error T001', 's.duramen:11: error T002']);
  await one(
    hs(...O, 'op f', '  input say? string', 'req A "a"',
      '  example raw \'{"id": "r1", "op": "f", "input": {"say": " \\u00a0\\n{\\"id\\": \\"elsewhere\\", \\"result\\": 1}\\n\\t"}}\'',
      '    expect result = 1',
      '  example raw \'{"id": "r2", "op": "f", "input": {"say": "{\\"id\\": \\"r2\\", \\"result\\": 1}\\r\\n"}}\'', '    expect result = 1',
      '  example raw \'{"id": "r3", "op": "f", "input": {"say": "{\\"result\\": 1}\\r{\\"result\\": 2}"}}\'', '    expect result = ?',
      '  example raw \'{"id": "r4", "op": "f", "input": {"say": "{\\"result\\": 1}\\n[2]"}}\'', '    expect result = ?'),
    ['s.duramen:11: error T021', 's.duramen:13: error T021']);
  const r = await cases({
    's.duramen': hs(...O, 'op f', '  input x? json', 'req A "a"',
      '  example raw "{\\"id\\":\\"r\\",\\"op\\":\\"f\\",\\"input\\":{\\"x\\":\\"\\ud800\\"}}"', '    expect result = ?'),
    'echo.mjs': ECHO,
  });
  assert.deepStrictEqual(r.cases[0].checks[0].value, { x: '�' });
});

test('REQ-OR-003: examples the oracle disagrees with', async () => {
  await one(
    hs(...O, 'op f', '  input x? json, y? json, answer? json', 'req A "a"', '  example f {"x": 1.0, "y": [5, {"z": null}]}',
      '    expect result = {"y": [5, {"z": null}], "x": 1}', '    expect result.y.1.z = null', '    expect result.y.0 ≈ 5.5 ± 0.5',
      '    expect result.x = 2', '    expect result.y.2 = 5', '    expect result.y.0 ≈ 5.5 ± 0.4', '    expect result.y.1 = {}',
      '  example f {"answer": {"result": 0, "audit": "{\\"a\\": [1, 2]}"}}', '    expect audit.a.1 = 2',
      '    expect audit = "{\\"a\\": [1, 2]}"', '    expect audit.b = 1', '  table f', '    | x | result.x | result.y |',
      '    | 1 | 2        | 3        |', '  example f {"x": {"": 1}}', '    expect result.x. = 1', '    expect result..x = 1',
      '  example f {"y": [7, 8]}', '    expect result.y.1 = 8', '    expect result.y.length = 2', '    expect result.y.01 = 8'),
    ['s.duramen:11: error T002', 's.duramen:12: error T002', 's.duramen:13: error T002', 's.duramen:14: error T002',
      's.duramen:18: error T002', 's.duramen:21: error T002', 's.duramen:21: error T002', 's.duramen:24: error T002',
      's.duramen:27: error T002', 's.duramen:28: error T002']);
  await one(
    hs(...O, 'op f', '  input answer? json', 'errors', '  e when never', 'req A "a"', '  example f {"answer": {"result": 1}}',
      '    expect error = "e"', '  example g {"answer": {"error": "e"}}', '    expect error = "e"'),
    ['s.duramen:10: error T002']);
  await one(
    hs(...O, 'op f', '  input answer? json, x? json', 'req A "a"',
      '  example f {"answer": {"result": 1, "audit": "{\\"a\\": 1e400, \\"b\\": 1}"}}', '    expect audit.b = 1', '    expect audit.a = ?',
      '  example f {"x": 2}', '    expect result.x ≈ 1.9 ± 0.1', '    expect result.x ≈ 1.9 ± 0.10000000000000009',
      '  example f {"x": 1}', '    expect result.x ≈ -8.673617379884035e-19 ± 1'),
    ['s.duramen:8: error T002', 's.duramen:9: error T025', 's.duramen:11: error T002']);
});

test('REQ-OR-004: an oracle that fails', async () => {
  await expectDiags(
    { 's.duramen': hs('oracle no-such-program-for-duramen', 'op f', '  input x? json', 'req A "a"', '  example f {}') },
    ['s.duramen:3: error T020', 's.duramen:7: error T021']);
  await one(
    hs(...O, 'op f', '  input x? json, exit? integer', 'req A "a"', '  example f {"x": 1}', '    expect result.x = 2',
      '  example f {"exit": 3}', '    expect result.exit = 3'),
    ['s.duramen:3: error T020', 's.duramen:8: error T002']);
  await one(
    hs(...O, 'op f', '  input exit? integer', 'req A "a"', '  example f {}', '  example raw \'{"id": "r", "op": "f", "input": {"exit": 4}}\''),
    ['s.duramen:8: error T020']);
  await expectDiags(
    { 's.duramen': hs('oracle no-such-program-for-duramen', 'op f', '  input x? json', 'req A "a"', '  example raw \'{"id": "r", "op": "f"}\'') },
    ['s.duramen:7: error T020', 's.duramen:7: error T021']);
  await one(hs('oracle node "echo.mjs', 'op f', '  input x? json', 'req A "a"', '  example f {}'), ['s.duramen:3: error T020', 's.duramen:7: error T021']);
});

test('REQ-OR-005: examples with no answer', async () => {
  await one(
    hs(...O, 'op f', '  input silent? boolean', 'req A "a"', '  example f {"silent": true}', '  example f {}',
      '  example raw \'{"id": "r", "op": "f", "input": {"silent": true}}\''),
    ['s.duramen:7: error T021', 's.duramen:9: error T021']);
  await one(
    hs(...O, 'op f', '  input say string', 'req A "a"', '  example f {"say": "{\\"id\\":\\"A#1\\",\\"result\\":1e400}"}',
      '    expect result = ?', '  example f {"say": "{\\"id\\":\\"A#2\\",\\"result\\":1e300}"}', '    expect result = ?'),
    ['s.duramen:7: error T021']);
});

test('REQ-OR-006: examples the oracle cannot compute', async () => {
  await one(
    hs(...O, 'op f', '  input answer? json', 'req A "a"', '  example f {"answer": {"oracle_error": "left open"}}',
      '    expect result = 1', '    expect result = ?'),
    ['s.duramen:7: error T022']);
  await one(
    hs(...O, 'op f', '  input answer? json', 'req A "a"', '  example f {"answer": {"oracle_error": null, "error": "x"}}'),
    ['s.duramen:7: error T022']);
});

test('REQ-OR-007: errors nobody expected', async () => {
  const f = async (s: string, diags: string[], errors: number, warnings: number) => {
    const { call } = await import('./helpers.ts');
    const r = await call('check', { files: { 's.duramen': s, 'echo.mjs': ECHO } });
    assert.deepStrictEqual(r.result, { diagnostics: diags, errors, warnings });
  };
  await f(
    hs(...O, 'op f', '  input answer? json', 'errors', '  e when never', 'req A "a"', '  example f {"answer": {"error": "e"}}',
      '  example f {"answer": {"error": "e"}}', '    expect error = "e"'),
    ['s.duramen:9: warning T024'], 0, 1);
  await f(hs(...O, 'op f', '  input answer? json', 'req A "a"', '  example f {"answer": {"error": null}}'), ['s.duramen:7: warning T024'], 0, 1);
  await f(
    hs(...O, 'op f', '  input answer? json', 'req A "a"', '  example f {"answer": {"error": "e"}}', '    expect result = 1',
      '  example f {"answer": {"error": "e"}}', '    expect id = "A#2"'),
    ['s.duramen:8: error T002'], 1, 0);
});

test('REQ-OR-008: values taken from the oracle', async () => {
  await one(
    hs(...O, 'op f', '  input x? json', 'req A "a"', '  example f {"x": 1}', '    expect result.x = ?', '    expect result.y = ?'),
    ['s.duramen:9: error T025']);
});
