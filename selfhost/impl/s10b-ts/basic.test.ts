import test from 'node:test';
import assert from 'node:assert';
import { checkRecord } from './checker.ts';

test('REQ-RQ-001: valid check request works', () => {
  const result = checkRecord({
    files: { 'a.duramen': 'duramen 0.1\nspec a 1\n' }
  });

  assert.ok(result);
  assert.ok(Array.isArray(result.diagnostics));
  assert.strictEqual(typeof result.errors, 'number');
  assert.strictEqual(typeof result.warnings, 'number');
});

test('REQ-RQ-002: empty files object is bad_request', () => {
  try {
    checkRecord({ files: {} });
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(err.message.includes('bad_request'));
  }
});

test('REQ-RQ-001: valid check request with entry file', () => {
  const result = checkRecord({
    entry: 'a.duramen',
    files: { 'a.duramen': 'duramen 0.1\nspec a 1\n' },
  });

  assert.ok(Array.isArray(result.diagnostics));
  assert.strictEqual(result.errors, 0);
  assert.strictEqual(result.warnings, 0);
});

test('REQ-RC-001: record with no files gets P046', () => {
  const result = checkRecord({
    files: { 'a.duramen': 'duramen 0.1\nspec a 1\n' },
    entry: 'missing.duramen',
  });

  assert.ok(result.diagnostics.some(d => d.includes('P046')));
});

test('REQ-RC-003: missing duramen statement gets P020', () => {
  const result = checkRecord({
    files: { 's.duramen': 'spec s 1\n' },
  });

  assert.ok(result.diagnostics.some(d => d.includes('P020')));
});

test('REQ-RC-004: missing spec gets P021', () => {
  const result = checkRecord({
    files: { 's.duramen': 'duramen 0.1\n' },
  });

  assert.ok(result.diagnostics.some(d => d.includes('P021')));
});
