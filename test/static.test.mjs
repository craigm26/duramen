// Static checks fail closed: a folder they could not read completely is never judged as passing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateStatic, listTree } from '../src/static.mjs';

function folder(files) {
  const dir = mkdtempSync(join(tmpdir(), 'duramen-static-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

test('static: a listing cut short says so, and the checks that need the whole tree fail', async () => {
  const dir = folder({ 'a.ts': 'x\n', 'b.ts': 'y\n', 'c.ts': 'z\n', 'secret.env': 'KEY=1\n' });
  try {
    const t = listTree(dir, 2);
    assert.equal(t.paths.length, 2);
    assert.equal(t.truncated, true);
    const opts = { maxFiles: 2 };
    for (const st of [
      { kind: 'absent', globs: ['*.env'] },
      { kind: 'lines', globs: ['*.ts'], exclude: [], max: 100 },
      { kind: 'text', globs: ['*'], pattern: 'KEY' },
    ]) {
      const r = await evaluateStatic(st, dir, new Map(), opts);
      assert.equal(r.ok, false, st.kind);
      assert.ok(r.why.some((w) => /more than 2 entries/.test(w)), `${st.kind}: ${r.why.join('; ')}`);
    }
    // What was found is still found.
    const first = listTree(dir, 2).paths[0];
    assert.equal((await evaluateStatic({ kind: 'exists', globs: [first] }, dir, new Map(), opts)).ok, true);
    // With room for every entry, the same checks are judged on the whole tree.
    assert.equal((await evaluateStatic({ kind: 'absent', globs: ['*.env'] }, dir, new Map())).ok, false);
    assert.equal((await evaluateStatic({ kind: 'lines', globs: ['*.ts'], exclude: [], max: 100 }, dir, new Map())).ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('static: files that cannot be read or searched fail lines and text checks', async () => {
  const dir = folder({ 'a.ts': 'x\n', 'big.ts': 'y'.repeat(64) + '\n' });
  try {
    symlinkSync(join(dir, 'missing.ts'), join(dir, 'gone.ts'));
    const lines = await evaluateStatic({ kind: 'lines', globs: ['*.ts'], exclude: [], max: 100 }, dir, new Map());
    assert.equal(lines.ok, false);
    assert.ok(lines.why.some((w) => /^gone\.ts could not be read/.test(w)), lines.why.join('; '));
    const text = await evaluateStatic({ kind: 'text', globs: ['big.ts'], pattern: 'nothing' }, dir, new Map(), { maxSearchBytes: 16 });
    assert.equal(text.ok, false);
    assert.ok(text.why.some((w) => /^big\.ts is larger than 16 bytes/.test(w)), text.why.join('; '));
    assert.equal((await evaluateStatic({ kind: 'text', globs: ['big.ts'], pattern: 'nothing' }, dir, new Map())).ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
