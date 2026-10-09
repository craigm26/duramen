// Unit tests of the small parsers.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { holdsObligation, valueAt } from '../src/checker.ts';
import { isRelativePath, resolveRecord, resolveRelative } from '../src/files.ts';
import { jsonEqual, parseJson } from '../src/json.ts';
import { splitCommand } from '../src/oracle.ts';
import { cells, parsePath, splitFields } from '../src/reader.ts';

describe('splitCommand (REQ-OR-002)', () => {
  it('splits at spaces and tabs', () => assert.deepEqual(splitCommand('node  a.mjs\t--q'), ['node', 'a.mjs', '--q']));
  it('reads double and single quotes, joined parts and empty words', () => {
    assert.deepEqual(splitCommand('node "my echo.mjs" \'x y\' a"b c"d ""'), ['node', 'my echo.mjs', 'x y', 'ab cd', '']);
  });
  it('reads \\" inside double quotes, and other backslashes as themselves', () => {
    assert.deepEqual(splitCommand('a "b\\"c\\d"'), ['a', 'b"c\\d']);
  });
  it('refuses a quote that is not closed', () => {
    assert.equal(splitCommand('node "echo.mjs'), undefined);
    assert.equal(splitCommand("node 'echo.mjs"), undefined);
  });
});

describe('cells (REQ-SY-012)', () => {
  it('splits cells, trims them, and reads \\| as |', () => assert.deepEqual(cells('| "a\\|b" |   | x |'), ['"a|b"', '', 'x']));
  it('lets the last | be left out', () => assert.deepEqual(cells('| 1 | 1'), ['1', '1']));
  it('keeps an empty last cell before a final |', () => assert.deepEqual(cells('| x | |'), ['x', '']));
});

describe('parsePath (REQ-SY-011)', () => {
  it('reads words and quoted names', () => assert.deepEqual(parsePath('files."a.duramen".x_1-2'), ['files', 'a.duramen', 'x_1-2']));
  it('refuses empty names and unclosed quotes', () => {
    for (const p of ['', 'files.', 'files.."a"', '"a', 'a b', '.a', 'é']) assert.equal(parsePath(p), undefined, p);
  });
});

describe('splitFields (REQ-SY-007)', () => {
  it('splits at commas outside quotes, brackets, braces and parentheses', () => {
    assert.deepEqual(splitFields('a n, b? {x: 1, y: 2}, c "1, 2" | [1, 2], d (f, g)'),
      ['a n', ' b? {x: 1, y: 2}', ' c "1, 2" | [1, 2]', ' d (f, g)']);
  });
  it('gives an empty field for an empty clause', () => assert.deepEqual(splitFields(''), ['']));
});

describe('holdsObligation (REQ-CK-006)', () => {
  it('finds whole capital words', () => {
    assert.ok(holdsObligation(['It MUST work.']));
    assert.ok(holdsObligation(['A MUST-have.']));
    assert.ok(holdsObligation(['MUSTé']));
    assert.ok(holdsObligation(['It SHALL NOT.']));
    assert.ok(holdsObligation(['REQUIRED']));
  });
  it('ignores other words and quotations on one line', () => {
    assert.ok(!holdsObligation(['MUSTARD and must, _MUST, MUST1']));
    assert.ok(!holdsObligation(['says `MUST`, "SHALL" and “REQUIRED”']));
    assert.ok(holdsObligation(['the "MUST', 'hold" rule']));
  });
});

describe('valueAt (REQ-OR-003)', () => {
  const resp = { id: 'x', result: { y: [5, { z: null }], '': { a: 1 } }, audit: '{"a": [1, 2]}' };
  it('reads members and array indexes', () => {
    assert.deepEqual(valueAt(resp, 'result.y.1.z'), { found: true, value: null });
    assert.deepEqual(valueAt(resp, 'result..a'), { found: true, value: 1 });
  });
  it('has no length member and no index written otherwise', () => {
    assert.equal(valueAt(resp, 'result.y.length').found, false);
    assert.equal(valueAt(resp, 'result.y.01').found, false);
    assert.equal(valueAt(resp, 'result.y.2').found, false);
  });
  it('reads audit paths in the JSON of the audit text', () => {
    assert.deepEqual(valueAt(resp, 'audit.a.1'), { found: true, value: 2 });
    assert.deepEqual(valueAt(resp, 'audit'), { found: true, value: '{"a": [1, 2]}' });
  });
});

describe('JSON', () => {
  it('compares values with members in any order and numbers by value', () => {
    assert.ok(jsonEqual({ a: 1.0, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }));
    assert.ok(!jsonEqual([1], { 0: 1 }));
    assert.ok(!jsonEqual({ a: 1 }, { a: 1, b: 2 }));
  });
  it('refuses numbers too large for binary64 (REQ-SY-013)', () => {
    assert.equal(parseJson('[1, -1e400]').ok, false);
    assert.equal(parseJson('1e300').ok, true);
  });
});

describe('files (REQ-RQ-001, REQ-RC-001)', () => {
  it('knows relative paths', () => {
    for (const ok of ['a', 'a/b.duramen', '.hidden', 'é/😀']) assert.ok(isRelativePath(ok), ok);
    for (const bad of ['', '/a', 'a/', 'a//b', './a', 'a/../b', 'a\\b', 'c:a', 'Z:', 'a\0b']) {
      assert.ok(!isRelativePath(bad), bad);
    }
  });
  it('reads a folder record in UTF-16 order of relative names', () => {
    const files = new Map([['r/😀.duramen', ''], ['r/｡.duramen', ''], ['r/B.duramen', ''], ['r/a/z.duramen', '']]);
    const r = resolveRecord(files, 'r');
    assert.ok(r.ok);
    assert.deepEqual(r.files, ['r/B.duramen', 'r/a/z.duramen', 'r/😀.duramen', 'r/｡.duramen']);
  });
  it('resolves names relative to a folder', () => {
    assert.equal(resolveRelative('a/b', '../c'), 'a/c');
    assert.equal(resolveRelative('a', '../../c'), undefined);
    assert.equal(resolveRelative('', '/etc/passwd'), undefined);
  });
});
