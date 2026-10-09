// Behavior the examples of SPEC.md leave unshown: edges of its words, and the choices in CHOICES.md.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { holdsObligation, restatesOrder } from '../src/check.ts';
import { handleLine, isRelativePath } from '../src/handle.ts';
import { jsonEqual, readPath } from '../src/json.ts';
import { parseInputPath, splitFields, splitRow } from '../src/parse.ts';
import { splitCommand } from '../src/oracle.ts';

const echo = readFileSync(new URL('../fixtures/echo.mjs', import.meta.url), 'utf8');

async function call(op: string, input: unknown): Promise<any> {
  return JSON.parse(JSON.stringify(await handleLine(JSON.stringify({ id: 't', op, input }))));
}

async function diags(files: { [k: string]: string }, entry?: string): Promise<string[]> {
  const res = await call('check', entry === undefined ? { files } : { files, entry });
  return res.result.diagnostics;
}

const HEAD = 'duramen 0.1\nspec s 1\noracle node echo.mjs\nop f\n  input x? json\n';

describe('requests', () => {
  test('relative paths', () => {
    assert.ok(isRelativePath('a/b.duramen'));
    assert.ok(isRelativePath('é/😀.duramen'));
    for (const bad of ['', '/a', 'a/', 'a//b', './a', 'a/..', 'a\\b', 'a\0b', 'C:x', 'z:/y']) {
      assert.ok(!isRelativePath(bad), bad);
    }
  });

  test('entry null is a bad request', async () => {
    const res = await call('check', { files: { 'a.duramen': 'duramen 0.1\nspec a 1\n' }, entry: null });
    assert.deepEqual(res, { id: 't', error: 'bad_request' });
  });

  test('a missing op with an id is unknown_op', async () => {
    assert.deepEqual(JSON.parse(JSON.stringify(await handleLine('{"id":"q"}'))), { id: 'q', error: 'unknown_op' });
  });

  test('a folder-of-another clash deeper down is a bad request', async () => {
    const res = await call('cases', { files: { 'a/b': 'x', 'a/b/c.duramen': 'x' } });
    assert.equal(res.error, 'bad_request');
  });
});

describe('reading', () => {
  test('statements of the rest of the language are accepted and their bodies not read', async () => {
    assert.deepEqual(await diags({ 's.duramen': 'duramen 0.1\nspec s 1\ntype T\n  anything at all\n    more\n' }), []);
  });

  test('a tab-indented line in the body of an unknown statement still gets P001', async () => {
    assert.deepEqual(await diags({ 's.duramen': 'duramen 0.1\nspec s 1\nfoo\n\tbar\n' }), [
      's.duramen:3: error P002',
      's.duramen:4: error P001',
    ]);
  });

  test('a text line indented three spaces gets P008 even when it starts with #', async () => {
    assert.deepEqual(await diags({ 's.duramen': 'duramen 0.1\nspec s 1\nnote\n  text\n   # x\n' }), [
      's.duramen:5: error P008',
    ]);
  });

  test('an `on` clause with no platform gets P033', async () => {
    assert.deepEqual(await diags({ 's.duramen': 'duramen 0.1\nspec s 1\nreq A "a"\n  on\n' }), [
      's.duramen:4: error P033',
    ]);
  });

  test('`input from "x"` with no path gets P049 and takes no text', async () => {
    const text = 'duramen 0.1\nspec s 1\nreq A "a"\n  example f {}\n    input from "x"\n      t\n';
    assert.deepEqual(await diags({ 's.duramen': text }), ['s.duramen:5: error P049', 's.duramen:6: error P006']);
  });

  test('a from name that climbs above the request files gets P048', async () => {
    const text = 'duramen 0.1\nspec s 1\nreq A "a"\n  example f {}\n    input t from "../../t.txt"\n';
    assert.deepEqual(await diags({ 'r/s.duramen': text, 't.txt': 'x' }), ['r/s.duramen:5: error P048']);
  });

  test('a from name that leaves the record folder and comes back in is read', async () => {
    const text = HEAD + 'req A "a"\n  example f {}\n    input x from "../r/t.txt"\n    expect result.x = "t"\n';
    assert.deepEqual(await diags({ 'r/s.duramen': text, 'r/t.txt': 't', 'r/echo.mjs': echo }, 'r'), []);
  });

  test('a comment at indent 4 ends an input text', async () => {
    const text = HEAD + 'req A "a"\n  example f {}\n    input x\n      a\n    # stop\n      b\n';
    assert.deepEqual(await diags({ 's.duramen': text, 'echo.mjs': echo }), ['s.duramen:11: error P006']);
  });

  test('a condition line indented three spaces gets P006 even when it starts with #', async () => {
    assert.deepEqual(await diags({ 's.duramen': 'duramen 0.1\nspec s 1\nerrors\n  e when x\n   # y\n' }), [
      's.duramen:5: error P006',
    ]);
  });

  test('clauses outside the once-only list may repeat', async () => {
    const text =
      'duramen 0.1\nspec s 1\noracle node echo.mjs\n  source a.mjs\n  source b.mjs\nop f\n  audit\n  audit text\n' +
      'decision D "d"\n  source s\n  rejected "x"\n  rejected "y"\n';
    assert.deepEqual(await diags({ 's.duramen': text }), ['s.duramen:9: warning T012']);
  });

  test('a section with no ID and no title gets P005', async () => {
    assert.deepEqual(await diags({ 's.duramen': 'duramen 0.1\nspec s 1\nsection\n' }), ['s.duramen:3: error P005']);
  });

  test('a row of only a pipe is a separator', () => {
    assert.deepEqual(splitRow('| a \\| b | c |'), ['a | b', 'c']);
    assert.deepEqual(splitRow('| a | |'), ['a', '']);
    assert.deepEqual(splitRow('| a | b'), ['a', 'b']);
  });

  test('fields split at commas outside quotes and brackets', () => {
    assert.deepEqual(splitFields('a x], b y'), ['a x]', ' b y']);
    assert.deepEqual(splitFields('c "a\\", b" x, d y'), ['c "a\\", b" x', ' d y']);
    assert.deepEqual(splitFields('a (x}, b json'), ['a (x}', ' b json']);
  });

  test('input paths', () => {
    assert.deepEqual(parseInputPath('files."a.duramen"'), ['files', 'a.duramen']);
    assert.deepEqual(parseInputPath('"" .x'), undefined);
    assert.deepEqual(parseInputPath('a."b"."c d"'), ['a', 'b', 'c d']);
    assert.equal(parseInputPath('a.'), undefined);
    assert.equal(parseInputPath(''), undefined);
  });
});

describe('checking', () => {
  test('obligation words', () => {
    assert.ok(holdsObligation('It MUST.'));
    assert.ok(holdsObligation('MUST-have'));
    assert.ok(holdsObligation('x`a`MUST'));
    assert.ok(!holdsObligation('MU`a`ST'));
    assert.ok(!holdsObligation('“MUST”'));
    assert.ok(!holdsObligation('must MUSTARD _MUST'));
    assert.ok(holdsObligation('"It\rMUST" be'));
  });

  test('order phrases', () => {
    assert.ok(restatesOrder('a is checked TAKES\nPRECEDENCE over b', ['a', 'b']));
    assert.ok(!restatesOrder('a before a', ['a', 'b']));
    assert.ok(!restatesOrder('a-x and b before', ['a', 'b']));
    assert.ok(!restatesOrder('a and b beforehand', ['a', 'b']));
  });

  test('an example expecting an error of an undeclared op is run and judged', async () => {
    const text = HEAD + 'errors\n  e when x\nreq A "a"\n  example g {"answer": {"error": "e"}}\n    expect error = "e"\n';
    assert.deepEqual(await diags({ 's.duramen': text, 'echo.mjs': echo }), []);
  });
});

describe('the suite', () => {
  test('a `__proto__` request member is written like any other', async () => {
    const text = HEAD + 'req A "a"\n  example f {"x": 1}\n    request {"__proto__": 1, "b": 2}\n';
    const res = await call('cases', { files: { 's.duramen': text, 'echo.mjs': echo } });
    assert.equal(res.result.cases[0].line, '{"id":"A#1","op":"f","__proto__":1,"b":2,"input":{"x": 1}}');
  });

  test('a member set again by the example keeps its place', async () => {
    const text =
      'duramen 0.1\nspec s 1\n  request {"a": 1, "b": 2}\noracle node echo.mjs\nop f\n  input x? json\n' +
      'req A "a"\n  example f {}\n    request {"a": 3}\n';
    const res = await call('cases', { files: { 's.duramen': text, 'echo.mjs': echo } });
    assert.equal(res.result.cases[0].line, '{"id":"A#1","op":"f","a":3,"b":2,"input":{}}');
  });

  test('input lines on an input that holds `__proto__` keep it as a member', async () => {
    const text = HEAD + 'req A "a"\n  example f {"__proto__": {"y": 1}}\n    input __proto__.z\n      t\n';
    const res = await call('cases', { files: { 's.duramen': text, 'echo.mjs': echo } });
    assert.equal(res.result.cases[0].line, '{"id":"A#1","op":"f","input":{"__proto__":{"y":1,"z":"t\\n"}}}');
  });
});

describe('judging', () => {
  test('a check of an unknown kind is not met', async () => {
    const res = await call('judge', { case: { checks: [{ path: 'id', kind: 'base64' }], full: null }, answer: { id: 'x' } });
    assert.deepEqual(res.result, { pass: false, failed: ['checks.0'] });
  });

  test('a check without a kind is a bad request', async () => {
    const res = await call('judge', { case: { checks: [{ path: 'id' }], full: null }, answer: {} });
    assert.equal(res.error, 'bad_request');
  });

  test('an audit that is not a string holds no value under it', () => {
    assert.equal(readPath({ audit: { a: 1 } }, 'audit.a'), undefined);
    assert.deepEqual(readPath({ audit: { a: 1 } }, 'audit'), { value: { a: 1 } });
  });

  test('values compare as JSON values', () => {
    assert.ok(jsonEqual({ a: [1, { b: null }] }, { a: [1.0, { b: null }] }));
    assert.ok(jsonEqual(-0, 0));
    assert.ok(!jsonEqual([], {}));
    assert.ok(!jsonEqual(null, {}));
    assert.ok(!jsonEqual('1', 1));
  });
});

describe('the oracle command', () => {
  test('words, quotes and joins', () => {
    assert.deepEqual(splitCommand('node "my echo.mjs" --x'), ['node', 'my echo.mjs', '--x']);
    assert.deepEqual(splitCommand("a'b c'd \"\" e\\f"), ['ab cd', '', 'e\\f']);
    assert.deepEqual(splitCommand('a "x\\"y\\z"'), ['a', 'x"y\\z']);
    assert.deepEqual(splitCommand('a\t b'), ['a', 'b']);
    assert.equal(splitCommand('node "echo.mjs'), undefined);
  });
});
