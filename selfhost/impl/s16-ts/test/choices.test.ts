// Behavior the spec leaves to the builder, as CHOICES.md records it, and corners its examples
// do not reach.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT, send } from './helpers.ts';

const spec = readFileSync(join(ROOT, 'SPEC.md'), 'utf8').split('\n');
const start = spec.indexOf('```', spec.indexOf('### `fixtures/echo.mjs`'));
const echo = spec.slice(start + 1, spec.indexOf('```', start + 1)).join('\n') + '\n';

async function check(files: Record<string, string>, extra: object = {}, env: Record<string, string> = {}) {
  const [r] = await send([{ id: 'x', op: 'check', input: { files, ...extra } }], env);
  return r.result.diagnostics as string[];
}

async function cases(files: Record<string, string>) {
  const [r] = await send([{ id: 'x', op: 'cases', input: { files } }]);
  return r.result;
}

const head = 'duramen 0.1\nspec s 1\noracle node echo.mjs\nop f\n  input x? json, answer? json\n';

test('C-1: entry "." and no entry name the same record', async () => {
  const files = { 'a.duramen': 'duramen 0.1\n' };
  assert.deepEqual(await check(files, { entry: '.' }), await check(files));
});

test('C-2: the statements of the rest of the language are read without a diagnostic', async () => {
  const d = await check({ 's.duramen': 'duramen 0.1\nspec s 1\ntype T\n  anything here\n    and here\nedge E\n' });
  assert.deepEqual(d, []);
});

test('C-3: P001 is reported in the body of an unknown statement too', async () => {
  const d = await check({ 's.duramen': 'duramen 0.1\nspec s 1\nfrob\n\tx\n' });
  assert.deepEqual(d, ['s.duramen:3: error P002', 's.duramen:4: error P001']);
});

test('C-4: an indented comment before the first statement gets P003', async () => {
  const d = await check({ 's.duramen': '  # comment\nduramen 0.1\nspec s 1\n' });
  assert.deepEqual(d, ['s.duramen:1: error P003']);
});

test('C-5: two bad cells in one table row get two diagnostics', async () => {
  const d = await check({ 's.duramen': head + 'req A "a"\n  table f\n    | x | answer |\n    | { | [ |\n' });
  assert.deepEqual(d, ['s.duramen:9: error P009', 's.duramen:9: error P009']);
});

test('C-6: a from name that leaves the folder and comes back is read by where it ends', async () => {
  const d = await check(
    {
      'r/s.duramen': 'duramen 0.1\nspec s 1\nop f\n  input x string\nreq A "a"\n  example f {}\n    input x from "../r/t.txt"\n',
      'r/t.txt': 't',
    },
    { entry: 'r' },
  );
  assert.deepEqual(d, ['r/s.duramen:2: error T019']);
});

test('C-7: examples of two requirements with one ID are counted per statement', async () => {
  const d = await check({
    's.duramen': head + 'req A "a"\n  example f {}\n    expect id = "A#1"\nreq A "b"\n  example f {"x": 1}\n    expect id = "A#1"\n',
    'echo.mjs': echo,
  });
  assert.deepEqual(d, ['s.duramen:9: error T007']);
});

test('C-8: of two responses with one id, the first is the one', async () => {
  const dup = 'for await (const c of process.stdin) {}\nconsole.log(JSON.stringify({id: "A#1", result: 1}));\nconsole.log(JSON.stringify({id: "A#1", result: 2}));\n';
  const d = await check({
    's.duramen': 'duramen 0.1\nspec s 1\noracle node dup.mjs\nop f\nreq A "a"\n  example f\n    expect result = 1\n',
    'dup.mjs': dup,
  });
  assert.deepEqual(d, []);
});

test('C-9: an oracle that takes too long gets T020, and its examples T021', async () => {
  const slow = 'setTimeout(() => {}, 20000);\n';
  const d = await check(
    { 's.duramen': 'duramen 0.1\nspec s 1\noracle node slow.mjs\nop f\nreq A "a"\n  example f\n', 'slow.mjs': slow },
    {},
    { DURAMEN_ORACLE_TIMEOUT_MS: '1500' },
  );
  assert.deepEqual(d, ['s.duramen:3: error T020', 's.duramen:6: error T021']);
});

test('C-10: the oracle runs in the folder of the file that holds the oracle statement', async () => {
  const d = await check({
    'a.duramen': 'duramen 0.1\nspec s 1\nreq A "a"\n  example f {}\nop f\n',
    'sub/o.duramen': 'duramen 0.1\noracle node echo.mjs\n',
    'sub/echo.mjs': echo,
  });
  assert.deepEqual(d, []);
});

test('C-11: a judge check of an unknown kind is not met', async () => {
  const [r] = await send([
    { id: 'j', op: 'judge', input: { case: { checks: [{ path: 'result', kind: 'base64', value: 'AA==' }], full: null }, answer: { id: 'j', result: 1 } } },
  ]);
  assert.deepEqual(r.result, { pass: false, failed: ['checks.0'] });
});

test('C-12: request members are written id, op, the members in ECMAScript order, input', async () => {
  const r = await cases({
    's.duramen':
      'duramen 0.1\nspec s 1\n  request {"z": 1, "10": 2, "a": {"2": 1, "1": 2}}\noracle node echo.mjs\nop f\n  input x? json\nreq A "a"\n  example f {"x":1}\n    request {"z": 3, "0": 4}\n',
    'echo.mjs': echo,
  });
  assert.equal(r.cases[0].line, '{"id":"A#1","op":"f","0":4,"10":2,"z":3,"a":{"1":2,"2":1},"input":{"x":1}}');
});

test('C-13: an input path can name a member called __proto__', async () => {
  const r = await cases({
    's.duramen': head + 'req A "a"\n  example f {"x": {}}\n    input x."__proto__"\n      p\n',
    'echo.mjs': echo,
  });
  assert.equal(r.errors, 0);
  assert.equal(r.cases[0].line, '{"id":"A#1","op":"f","input":{"x":{"__proto__":"p\\n"}}}');
});

test('C-14: tolerances in cases follow the first operation of the name', async () => {
  const r = await cases({
    's.duramen': head + '  tolerance result.x 0.5\nreq A "a"\n  example f {"x": 1}\n',
    'echo.mjs': echo,
  });
  assert.deepEqual(r.cases[0].full, { members: ['id', 'result'], result: { x: 1 }, tolerances: { 'result.x': 0.5 } });
});

test('C-15: the order phrases of T005 match in ASCII letter case only', async () => {
  const d = await check({
    's.duramen':
      head + 'errors\n  e1 when x\n  e2 when y\nreq A "a"\n  text\n    e1 and e2 come BEFORE others.\n  example f {}\nreq B "b"\n  text\n    e1 and e2, ﬁrst match.\n  example f {}\n',
    'echo.mjs': echo,
  });
  assert.deepEqual(d, ['s.duramen:10: error T005']);
});

test('C-16: a solo example whose oracle writes nothing gets T021', async () => {
  const d = await check({ 's.duramen': head + 'req A "a"\n  example raw \'{"id":"r","op":"f","input":{"silent":true}}\'\n', 'echo.mjs': echo });
  assert.deepEqual(d, ['s.duramen:7: error T021']);
});

test('C-17: a blank line made of a CR alone gets no response', async () => {
  const out = await send([]);
  assert.deepEqual(out, []);
  const { runDriver } = await import('./helpers.ts');
  const run = await runDriver('\r\n' + JSON.stringify({ id: 'a', op: 'nope' }) + '\n');
  assert.deepEqual(run.stdout, '{"id":"a","error":"unknown_op"}\n');
});

test('C-18: a status of "superseded by" its own decision names a declared one', async () => {
  const d = await check({
    's.duramen': head + 'decision D "d"\n  source s\n  status superseded by D\nreq A "a"\n  decision D\n  example f {}\n',
    'echo.mjs': echo,
  });
  assert.deepEqual(d, ['s.duramen:9: error T028']);
});

test('C-20: full.audit is left out when the response audit is not a text', async () => {
  const r = await cases({
    's.duramen': head + '  audit\nreq A "a"\n  example f {"answer": {"result": 1, "audit": 5}}\n  example f {"answer": {"result": 1, "audit": "t"}}\n',
    'echo.mjs': echo,
  });
  assert.equal(r.errors, 0);
  assert.deepEqual(r.cases[0].full, { members: ['audit', 'id', 'result'], result: 1, tolerances: {} });
  assert.equal(r.cases[1].full.audit, 't');
});

test('C-19: input fields of a table row are written as the cells are, in column order', async () => {
  const r = await cases({
    's.duramen': head + 'req A "a"\n  table f\n    | answer | x |\n    | {"result": 1} | [1,  2] |\n',
    'echo.mjs': echo,
  });
  assert.equal(r.cases[0].line, '{"id":"A#1","op":"f","input":{"answer":{"result": 1},"x":[1,  2]}}');
});
