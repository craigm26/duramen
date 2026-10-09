// What round seven found in duramen itself (selfhost/s12-ts.md, selfhost/s13-py.md): an example's
// input lines apply in order, `from` lines included; a `from` file's name is read as REQ-SY-011
// says; a name such as __proto__ is a member like any other, and a record cannot change objects
// outside itself; and an escaped final `|` in a table row is a `|` in the last cell. None of these
// touches a case of the duramen-core 0.8.0 suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { handle } from '../src/serve.mjs';
import { parse, rowCells } from '../src/parse.mjs';
import { agreeRequests } from '../src/agree.mjs';
import { ROOT } from './helpers.mjs';

const echo = readFileSync(join(ROOT, 'spec', 'fixtures', 'echo.mjs'), 'utf8');
const HEAD = 'duramen 0.1\nspec s 1\noracle node echo.mjs\nop f\n  input a? json, t? json\n';
// One example of f with no input of its own and no expectation (the oracle's whole answer is
// then the case); its input lines start on line 8.
const example = (lines) => `${HEAD}req A "a"\n  example f {}\n${lines}`;
const request = async (op, files) => (await handle({ id: 'x', op, input: { files: { 'echo.mjs': echo, ...files } } })).result;
const diagnostics = async (files) => (await request('check', files)).diagnostics;
const inputOf = async (files) => {
  const r = await request('cases', files);
  assert.equal(r.errors, 0);
  return JSON.parse(r.cases[0].line).input;
};

test('inputs: input lines apply in order, from lines included', async () => {
  const t = { 't.txt': 'hello' };
  // a text after a file at the same path replaces it, and one before it is replaced
  assert.deepEqual(await inputOf({ 's.duramen': example('    input a from "t.txt"\n    input a\n      x\n'), ...t }), { a: 'x\n' });
  assert.deepEqual(await inputOf({ 's.duramen': example('    input a\n      x\n    input a from "t.txt"\n'), ...t }), { a: 'hello' });
  // a path through the file's text is through a value that is not an object
  assert.deepEqual(await diagnostics({ 's.duramen': example('    input a from "t.txt"\n    input a.b\n      x\n'), ...t }), ['s.duramen:9: error P049']);
  // and a file put under a path that a later line replaces is not through one
  assert.deepEqual(await diagnostics({ 's.duramen': example('    input a.b from "t.txt"\n    input a\n      x\n'), ...t }), []);
  assert.deepEqual(await inputOf({ 's.duramen': example('    input a.b from "t.txt"\n    input a\n      x\n'), ...t }), { a: 'x\n' });
});

test('inputs: a from name is split at /, empty parts and . skipped, .. one folder up', async () => {
  assert.deepEqual(await inputOf({ 's.duramen': example('    input t from "/t.txt"\n'), 't.txt': 'hello' }), { t: 'hello' });
  assert.deepEqual(await inputOf({ 's.duramen': example('    input t from "sub//./../..x"\n'), '..x': 'dots' }), { t: 'dots' });
  // `from` and a quoted string that is not a JSON string: an `input <path>` line, whose path is of no form
  assert.deepEqual(await diagnostics({ 's.duramen': example('    input t from "t\\q.txt"\n'), 't.txt': 'hello' }), ['s.duramen:8: error P049']);
  // From the command line, with the record in the working folder, `..` still leaves the record's folder.
  const dir = mkdtempSync(join(tmpdir(), 'duramen-inputs-'));
  try {
    mkdirSync(join(dir, 'r'));
    writeFileSync(join(dir, 'r', 's.duramen'), example('    input t from "../o.txt"\n').replace('oracle node echo.mjs\n', ''));
    writeFileSync(join(dir, 'o.txt'), 'outside');
    writeFileSync(join(dir, 'r', 'o.txt'), 'inside');
    let out = '';
    try { execFileSync(process.execPath, [join(ROOT, 'bin', 'duramen.mjs'), 'check', 's.duramen'], { cwd: join(dir, 'r'), encoding: 'utf8' }); } catch (e) { out = e.stdout; }
    assert.match(out, /^s\.duramen:7:\d+: error P048/); // the line moved up with the oracle line taken out
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('own members: __proto__ and other inherited names are members, and nothing outside the record changes', async () => {
  assert.deepEqual(JSON.stringify(await inputOf({ 's.duramen': example('    input a.__proto__.x\n      t\n') })), '{"a":{"__proto__":{"x":"t\\n"}}}');
  assert.deepEqual(JSON.stringify(await inputOf({ 's.duramen': example('    input __proto__\n      t\n') })), '{"__proto__":"t\\n"}');
  assert.equal(({}).x, undefined);
  assert.equal(Object.prototype.x, undefined);
  // a required input named toString is missing from {}; an optional one named constructor is absent
  const op = (head, field) => `${head}spec s 1\noracle node echo.mjs\nop f\n  input ${field}\nreq A "a"\n  example f {}\n    expect result = {}\n`;
  assert.deepEqual(await diagnostics({ 's.duramen': op('duramen 0.1\n', 'toString string') }), ['s.duramen:7: error T010']);
  assert.deepEqual(await diagnostics({ 's.duramen': op('duramen 0.2\n', 'constructor? number') }), []);
  // a tolerance for __proto__ is a tolerance, so a second one is P052
  assert.deepEqual(await diagnostics({ 's.duramen': `${HEAD}  tolerance __proto__ 1\n  tolerance __proto__ 2\nreq A "a"\n  example f {}\n    expect result = {}\n` }), ['s.duramen:7: error P052']);
  // a table column named __proto__ is an input field f does not have
  assert.deepEqual(await diagnostics({ 's.duramen': `${HEAD}req A "a"\n  table f\n    | __proto__ | result.__proto__ |\n    | {"x": 1} | {"x": 1} |\n` }), ['s.duramen:9: warning T011']);
  // a property's variable, and a field duramen agree draws
  const property = 'duramen 0.2\nspec s 1\noracle node echo.mjs\nop f\n  input a? number\nreq A "a"\n  text\n    It MUST echo.\nproperty P "p"\n  supports A\n  for __proto__ in 1 .. 3\n  call r = f {"a": __proto__}\n  expect r.result.a == __proto__\n';
  assert.deepEqual(await diagnostics({ 's.duramen': property }), []);
  const { requests } = agreeRequests(parse('duramen 0.2\nspec s 1\nop f\n  input __proto__ 1 | 2\n', 's.duramen').ast, { samples: 3, seed: 1 });
  for (const r of requests) assert.match(r.line, /"input":\{"__proto__":[12]\}/);
});

test('tables: a row\'s final \\| is a | in the last cell', () => {
  assert.deepEqual(rowCells('| 1 | a\\|'), ['1', 'a|']);
  assert.deepEqual(rowCells('| 1 | a\\||'), ['1', 'a|']);
  assert.deepEqual(rowCells('| 1 | a |'), ['1', 'a']);
  assert.deepEqual(rowCells('| 1 | a'), ['1', 'a']);
});
