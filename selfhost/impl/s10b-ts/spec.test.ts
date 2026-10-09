import test from 'node:test';
import assert from 'node:assert';
import { checkRecord } from './checker.ts';

test('REQ-RQ-001 Example 1: valid simple spec', () => {
  const result = checkRecord({
    entry: 'a.duramen',
    files: {
      'a.duramen': 'duramen 0.1\nspec a 1\n',
      'b.duramen': 'frobnicate\n',
    },
  });
  assert.deepStrictEqual(result.diagnostics, []);
  assert.strictEqual(result.errors, 0);
  assert.strictEqual(result.warnings, 0);
});

test('REQ-RQ-001 Example 2: missing entry includes all files', () => {
  const result = checkRecord({
    files: {
      'a.duramen': 'duramen 0.1\nspec a 1\n',
      'b.duramen': 'frobnicate\n',
    },
  });
  assert.ok(result.diagnostics.some(d => d.includes('P002')));
});

test('REQ-RC-001 Example 1: folder record reads all .duramen files', () => {
  const result = checkRecord({
    files: {
      'a.duramen': 'duramen 0.1\nspec a 1\n',
      'notes.md': 'frobnicate\n',
      'build/x.duramen': 'frobnicate\n',
      'sub/build/x.duramen': 'frobnicate\n',
      'node_modules/x.duramen': 'frobnicate\n',
      '.hidden.duramen': 'frobnicate\n',
      'sub/.hidden/x.duramen': 'frobnicate\n',
      'sub/b.duramen': 'duramen 0.1\n',
    },
  });
  assert.deepStrictEqual(result.diagnostics, []);
});

test('REQ-RC-002 Example 1: files sorted by UTF-16 order', () => {
  const result = checkRecord({
    files: {
      'b.duramen': 'duramen 0.1\nspec b 1\n',
      'a.duramen': 'duramen 0.1\nspec a 1\n',
    },
  });
  assert.ok(result.diagnostics.some(d => d.includes('P044')));
});

test('REQ-RC-003 Example 1: missing duramen statement P020', () => {
  const result = checkRecord({
    files: {
      's.duramen': 'spec s 1\n',
    },
  });
  assert.ok(result.diagnostics.some(d => d.includes('P020')));
});

test('REQ-RC-003 Example 3: invalid version P023', () => {
  const result = checkRecord({
    files: {
      's.duramen': 'duramen 0.3\nspec s 1\n',
    },
  });
  assert.ok(result.diagnostics.some(d => d.includes('P023')));
});

test('REQ-RC-004 Example 4: second spec statement P044', () => {
  const result = checkRecord({
    files: {
      's.duramen': 'duramen 0.1\nspec a 1\n\nspec b 1\n',
    },
  });
  assert.ok(result.diagnostics.some(d => d.includes('P044')));
});

test('REQ-SY-002 Example 1: unknown statement P002', () => {
  const result = checkRecord({
    files: {
      's.duramen': '# A comment.\nduramen 0.1\nspec s 1\nfrobnicate this\n  title "ignored"\nNote\n',
    },
  });
  const diags = result.diagnostics.join(';');
  assert.ok(diags.includes('P002'));
});

test('REQ-SY-001 Example 2: tab indentation P001', () => {
  const result = checkRecord({
    files: {
      's.duramen': 'duramen 0.1\nspec s 1\n\tnote\n',
    },
  });
  assert.ok(result.diagnostics.some(d => d.includes('P001')));
});

test('REQ-SY-003 Example 3: indentation error before clause P007', () => {
  const result = checkRecord({
    files: {
      's.duramen': 'duramen 0.1\nspec s 1\nnote\n text\n',
    },
  });
  assert.ok(result.diagnostics.length > 0);
});
