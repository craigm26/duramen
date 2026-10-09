// Behavior the specification leaves to the builder (CHOICES.md), and helpers behind its MUSTs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleLine } from '../src/protocol.ts';
import { splitCommand } from '../src/oracle.ts';
import { splitFields, splitRow, isSeparator, parseInputPath } from '../src/read.ts';
import { holdsObligation, restatesOrder } from '../src/check.ts';
import { readPath } from '../src/json.ts';
import { ECHO } from './spec-examples.ts';

async function send(op: string, input: unknown): Promise<any> {
  return JSON.parse(JSON.stringify(await handleLine(JSON.stringify({ id: 'x', op, input }))));
}

async function diags(text: string, extra: Record<string, string> = {}, entry?: string): Promise<string[]> {
  const input: Record<string, unknown> = { files: { 's.duramen': text, ...extra } };
  if (entry !== undefined) input.entry = entry;
  const r = await send('check', input);
  return r.result.diagnostics;
}

const HEAD = 'duramen 0.1\nspec s 1\n';
const ORACLE = HEAD + 'oracle node echo.mjs\nop f\n  input x? json, answer? json\n';

describe('reading (CHOICES.md)', () => {
  it('C-5: statements of the rest of the language are taken whole, with no diagnostic', async () => {
    assert.deepEqual(await diags(HEAD + 'type T\n  anything here\n x\n'), []);
  });

  it('C-7: P001 is given in the body of an unknown statement too', async () => {
    assert.deepEqual(await diags(HEAD + 'frobnicate\n\tx\n'), ['s.duramen:3: error P002', 's.duramen:4: error P001']);
  });

  it('C-8: a line indented one space in an ignored body gets nothing', async () => {
    assert.deepEqual(await diags(HEAD + 'frobnicate\n x\n'), ['s.duramen:3: error P002']);
  });

  it('C-9: a statement with no ID gets P005', async () => {
    assert.deepEqual(await diags(HEAD + 'section\n'), ['s.duramen:3: error P005']);
  });

  it('C-10: a # line under an example or a table is a comment', async () => {
    const t = ORACLE + 'req A "a"\n  example f {}\n     # five\n   # three\n  table f\n   # three\n    | x |\n    # four\n    | 1 |\n';
    assert.deepEqual(await diags(t, { 'echo.mjs': ECHO }), []);
  });

  it('C-11: a from name that is not a JSON string makes the line a path', async () => {
    const t = HEAD + 'req A "a"\n  example f {}\n    input a from "\\q"\n      text\n';
    assert.deepEqual(await diags(t), ['s.duramen:5: error P049']);
  });

  it('C-12: a from name that climbs above the request root gets P048', async () => {
    const t = HEAD + 'req A "a"\n  example f {}\n    input a from "../w/t.txt"\n';
    assert.deepEqual(await diags(t, { 't.txt': 't' }), ['s.duramen:5: error P048']);
  });

  it('C-13: a from file under build/ inside the record folder can be read', async () => {
    const t = ORACLE + 'req A "a"\n  example f {}\n    input x from "build/t.txt"\n    expect result.x = "t"\n';
    assert.deepEqual(await diags(t, { 'echo.mjs': ECHO, 'build/t.txt': 't' }), []);
  });

  it('C-14: brackets are counted per kind; a closer with none of its kind open is ordinary', () => {
    assert.deepEqual(splitFields('a {x]}, b c'), ['a {x]}', 'b c']);
    assert.deepEqual(splitFields('a (x}, b c'), ['a (x}, b c']);
    assert.deepEqual(splitFields('a {x: (y), z}, b [1, 2]'), ['a {x: (y), z}', 'b [1, 2]']);
    assert.deepEqual(splitFields('a x], b y'), ['a x]', 'b y']);
    assert.deepEqual(splitFields('c "a\\", b" x, d y'), ['c "a\\", b" x', 'd y']);
  });

  it('C-15: the version is the rest of the line after the keyword and its white space', async () => {
    assert.deepEqual(await diags('duramen   0.2\nspec s 1\n'), []);
  });

  it('C-17: T010 looks at the written input even when the example omits input', async () => {
    const t = HEAD + 'oracle node echo.mjs\nop f\n  input a json\nreq A "a"\n  example f {"a": 1}\n    omit input\n';
    assert.deepEqual(await diags(t, { 'echo.mjs': ECHO }), []);
  });

  it('C-18: audit.<path> on an audit that is not a string reads nothing', () => {
    assert.deepEqual(readPath({ audit: { a: 1 } }, 'audit.a'), { found: false });
    assert.deepEqual(readPath({ audit: '{"a": 1}' }, 'audit.a'), { found: true, value: 1 });
  });

  it('C-24: text after an example input that is not JSON gets P009', async () => {
    assert.deepEqual(await diags(HEAD + 'req A "a"\n  example f {} extra\n'), ['s.duramen:4: error P009']);
  });

  it('C-25: an empty title gets P004, an empty on P033', async () => {
    assert.deepEqual(await diags(HEAD + '  title\nreq A "a"\n  on\n'), ['s.duramen:3: error P004', 's.duramen:5: error P033']);
  });

  it('C-22: each bad cell of a row gets its own diagnostic', async () => {
    const t = HEAD + 'req A "a"\n  table f\n    | x | result |\n    | { | [ |\n';
    assert.deepEqual(await diags(t), ['s.duramen:6: error P009', 's.duramen:6: error P009']);
  });

  it('C-26: a comment at indent 2 inside a text neither ends it nor belongs to it', async () => {
    assert.deepEqual(await diags(HEAD + 'note\n  text\n    One.\n  # comment\n    MUST\n'), ['s.duramen:3: error T004']);
  });
});

describe('the oracle (CHOICES.md)', () => {
  it('C-4, C-23: solo and batched runs both answer', async () => {
    const t = ORACLE + 'req A "a"\n  example f {"x": 1}\n    expect result.x = 1\n  example raw \'{"op":"f","input":{"x":2}}\'\n    expect result.x = 2\n';
    assert.deepEqual(await diags(t, { 'echo.mjs': ECHO }), []);
  });

  it('splits commands with quotes as REQ-OR-002 says', () => {
    assert.deepEqual(splitCommand('node "my echo.mjs"'), ['node', 'my echo.mjs']);
    assert.deepEqual(splitCommand('a\t"b\\"c" d\'e f\'g ""'), ['a', 'b"c', 'de fg', '']);
    assert.deepEqual(splitCommand('a "b\\x"'), ['a', 'b\\x']);
    assert.equal(splitCommand('node "echo.mjs'), null);
    assert.equal(splitCommand("node 'echo.mjs"), null);
  });

  it('T020 for an oracle that exits with a status, with its responses still used', async () => {
    const t = ORACLE + 'req A "a"\n  example f {"x": 1}\n    expect result.x = 1\n  example f {"exit": 2}\n';
    const r = await diags(t.replace('answer? json', 'answer? json, exit? json'), { 'echo.mjs': ECHO });
    assert.deepEqual(r, ['s.duramen:3: error T020']);
  });
});

describe('requests (CHOICES.md)', () => {
  it('C-20: an entry of null is a bad request', async () => {
    const r = await send('check', { files: { 's.duramen': HEAD }, entry: null });
    assert.equal(r.error, 'bad_request');
  });

  it('accepts entry "." as the folder that holds all the files', async () => {
    const r = await send('check', { files: { 's.duramen': HEAD }, entry: '.' });
    assert.deepEqual(r.result, { diagnostics: [], errors: 0, warnings: 0 });
  });

  it('rejects names holding NUL', async () => {
    const r = await send('check', { files: { 'a\u0000.duramen': HEAD } });
    assert.equal(r.error, 'bad_request');
  });
});

describe('judge (CHOICES.md)', () => {
  it('C-19: a check of another kind is accepted and never held', async () => {
    const r = await send('judge', { case: { checks: [{ path: 'id', kind: 'base64' }], full: null }, answer: { id: 'x' } });
    assert.deepEqual(r.result, { pass: false, failed: ['checks.0'] });
  });

  it('C-19: a check whose kind is not a string is a bad request', async () => {
    const r = await send('judge', { case: { checks: [{ path: 'id', kind: 1 }], full: null }, answer: null });
    assert.equal(r.error, 'bad_request');
  });

  it('compares an object error as a JSON value (REQ-JU-004)', async () => {
    const full = { members: ['error', 'id'], error: { a: [1] }, tolerances: {} };
    const r = await send('judge', { case: { checks: [], full }, answer: { id: 'x', error: { a: [1.0] } } });
    assert.deepEqual(r.result, { pass: true });
  });
});

describe('helpers', () => {
  it('finds obligations outside quotations (REQ-CK-006)', () => {
    assert.equal(holdsObligation(['It MUST.']), true);
    assert.equal(holdsObligation(['It `MUST`.']), false);
    assert.equal(holdsObligation(['``MUST``']), true);
    assert.equal(holdsObligation(['x`a`MUST']), true);
    assert.equal(holdsObligation(['MU`a`ST']), false);
    assert.equal(holdsObligation(['“MUST”, MUSTARD, must']), false);
    assert.equal(holdsObligation(['MUSTé', 'x']), true);
    assert.equal(holdsObligation(['_MUST']), false);
  });

  it('finds an order restated (REQ-CK-008)', () => {
    assert.equal(restatesOrder(['a and b, in', 'THE   order'], ['a', 'b']), true);
    assert.equal(restatesOrder(['a and a come first'], ['a', 'b']), false);
    assert.equal(restatesOrder(['a-x and b, before'], ['a', 'b']), false);
    assert.equal(restatesOrder(['a and b, beforehand'], ['a', 'b']), false);
    assert.equal(restatesOrder(['a.b and c? take precedence'], ['a.b', 'c?']), true);
  });

  it('reads table rows (REQ-SY-012)', () => {
    assert.deepEqual(splitRow('| a\\|b | c'), ['a|b', 'c']);
    assert.deepEqual(splitRow('| a | |'), ['a', '']);
    assert.equal(isSeparator('|'), true);
    assert.equal(isSeparator('| :-: |\u3000|'), true);
    assert.equal(isSeparator('|---'), false);
  });

  it('reads input paths (REQ-SY-011)', () => {
    assert.deepEqual(parseInputPath('files."a.b".c'), ['files', 'a.b', 'c']);
    assert.equal(parseInputPath('files.'), null);
    assert.equal(parseInputPath('a b'), null);
    assert.equal(parseInputPath(''), null);
  });
});
