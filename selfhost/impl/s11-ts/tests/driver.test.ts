// The driver protocol (Interface, REQ-RQ-002).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lines, runDriver } from './helpers.ts';

const ok = { files: { 'a.duramen': 'duramen 0.1\nspec a 1\n' } };

describe('the driver protocol', () => {
  it('answers each line that is not blank, in order, with its id, and exits with 0', async () => {
    const run = await runDriver(lines(
      { id: 'a', op: 'check', input: ok }, '', '  \t ', { id: 'b', op: 'nope' }, { id: 'c', op: 'cases', input: ok },
    ));
    assert.equal(run.status, 0);
    assert.deepEqual(run.responses.map((r: any) => r.id), ['a', 'b', 'c']);
    assert.deepEqual(run.responses[0], { id: 'a', result: { diagnostics: [], errors: 0, warnings: 0 } });
    assert.deepEqual(run.responses[1], { id: 'b', error: 'unknown_op' });
    assert.deepEqual(run.responses[2], { id: 'c', result: { errors: 0, cases: [] } });
  });

  it('writes lines that end with LF and hold no CR', async () => {
    const run = await runDriver(lines({ id: 'x\r\ny', op: 'check', input: { files: { 'a\r.duramen': 'x\r\n' } } }));
    assert.ok(run.stdout.endsWith('\n'));
    assert.ok(!run.stdout.includes('\r'));
    assert.equal(run.stdout.split('\n').length, 2);
    assert.equal((run.responses[0] as any).id, 'x\r\ny');
  });

  it('reads a last line without LF, and a line ending with CR LF', async () => {
    const run = await runDriver(JSON.stringify({ id: 'a', op: 'x' }) + '\r\n' + JSON.stringify({ id: 'b', op: 'x' }));
    assert.deepEqual(run.responses, [{ id: 'a', error: 'unknown_op' }, { id: 'b', error: 'unknown_op' }]);
  });

  it('exits with 0 on empty input', async () => {
    const run = await runDriver('');
    assert.equal(run.status, 0);
    assert.equal(run.stdout, '');
  });

  it('gives a response of id and result, or id and error, only', async () => {
    const run = await runDriver(lines({ id: 'a', op: 'check', input: ok, extra: 1 }, 'null', '"s"', { id: null, op: 'check' }));
    assert.deepEqual(Object.keys(run.responses[0] as object).sort(), ['id', 'result']);
    assert.deepEqual(run.responses.slice(1), [
      { id: null, error: 'bad_request' }, { id: null, error: 'bad_request' }, { id: null, error: 'bad_request' },
    ]);
  });

  it('checks unknown_op before the input (REQ-RQ-002)', async () => {
    const run = await runDriver(lines({ id: 'a', op: 'lint', input: 5 }, { id: 'b', op: 5 }, { id: 'c' }));
    assert.deepEqual(run.responses.map((r: any) => r.error), ['unknown_op', 'unknown_op', 'unknown_op']);
  });

  it('refuses bad inputs with bad_request and goes on (REQ-RQ-002)', async () => {
    const bad = [
      5, [], { files: 'x' }, { files: { 'a.duramen': null } }, { files: { 'a\u0000b': 'x' } }, { files: { 'a/': 'x' } },
      { files: { 'a/b': 'x', 'a/b/c.duramen': 'x' } }, { files: { 'a.duramen': 'x' }, entry: '/a' },
      { files: { 'a.duramen': 'x' }, entry: 'a\\b' }, { files: { 'a.duramen': 'x' }, entry: null },
    ];
    const run = await runDriver(lines(...bad.map((input, i) => ({ id: `${i}`, op: 'check', input })), { id: 'last', op: 'check', input: ok }));
    assert.deepEqual(run.responses.slice(0, -1), bad.map((_, i) => ({ id: `${i}`, error: 'bad_request' })));
    assert.equal((run.responses.at(-1) as any).result.errors, 0);
  });

  it('accepts entry "." as the folder that holds all the files', async () => {
    const run = await runDriver(lines({ id: 'a', op: 'check', input: { files: { 'x.md': '' }, entry: '.' } }));
    assert.deepEqual((run.responses[0] as any).result.diagnostics, ['.:1: error P046']);
  });
});
