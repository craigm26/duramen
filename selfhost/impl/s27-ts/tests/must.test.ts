// One group of tests per requirement of SPEC.md, on top of the replayed examples.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { handle, respond } from '../src/protocol.ts';
import { splitCommand } from '../src/oracle.ts';
import { holdsObligation } from '../src/checker.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const examples = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'spec-examples.json'), 'utf8'));
const specText = readFileSync(join(root, 'SPEC.md'), 'utf8');
const echo = readFileSync(join(root, 'tests', 'fixtures', 'echo.mjs'), 'utf8');

const HEAD = 'duramen 0.1\nspec s 1\n';

function diags(files: Record<string, string>, entry?: string): string[] {
  const input: any = { files };
  if (entry !== undefined) input.entry = entry;
  const r = handle({ id: 'x', op: 'check', input });
  assert.ok(r.result, JSON.stringify(r));
  return r.result.diagnostics;
}
const one = (text: string) => diags({ 's.duramen': text });

test('every requirement of SPEC.md has a replayed example', () => {
  const ids = [...specText.matchAll(/^\*\*(REQ-[A-Z]+-\d+)\./gm)].map((m) => m[1]);
  assert.ok(ids.length >= 40);
  for (const id of ids) {
    assert.ok(
      examples.some((e: any) => e.req === id),
      `${id} has no example`,
    );
  }
});

test('REQ-RQ-002: bad lines get their error and the driver goes on', () => {
  const r = spawnSync('node', ['src/driver.ts'], {
    cwd: root,
    input: ['{not json', '', '   \t', '{"id":"a","op":"lint","input":{}}', '{"id":"b","op":"check","input":{"files":{"a.duramen":"duramen 0.1\\nspec a 1\\n"}}}', ''].join('\n'),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  const lines = r.stdout.split('\n');
  assert.equal(lines.pop(), '');
  assert.deepEqual(lines.map((l) => JSON.parse(l)), [
    { id: null, error: 'bad_request' },
    { id: 'a', error: 'unknown_op' },
    { id: 'b', result: { diagnostics: [], errors: 0, warnings: 0 } },
  ]);
});

test('Driver protocol: output has no CR and U+2028 is escaped', () => {
  const out = respond(JSON.stringify({ id: 'a b\r', op: 'nope' }))!;
  assert.ok(!out.includes('\r') && !out.includes(' '));
  assert.equal(JSON.parse(out).id, 'a b\r');
});

test('REQ-RC-001: a file record is that file whatever its name, a folder record skips hidden and build', () => {
  assert.deepEqual(diags({ 'x.txt': HEAD, 'a.duramen': 'frobnicate' }, 'x.txt'), []);
  assert.deepEqual(diags({ 'a.duramen': HEAD, '.h/b.duramen': 'x', 'node_modules/c.duramen': 'x' }), []);
  assert.deepEqual(diags({ 'a.duramen': HEAD }, 'nothere'), ['nothere:1: error P046']);
});

test('REQ-RC-002: files are read in UTF-16 order', () => {
  assert.deepEqual(diags({ 'b.duramen': HEAD, 'a.duramen': HEAD }), ['b.duramen:2: error P044']);
});

test('REQ-RC-003: versions', () => {
  assert.deepEqual(one('spec s 1\n'), ['s.duramen:1: error P020']);
  assert.deepEqual(one('duramen 0.2\nspec s 1\n'), []);
  assert.deepEqual(one('duramen 0.1 extra\nspec s 1\n'), ['s.duramen:1: error P023']);
  assert.deepEqual(diags({ 'a.duramen': HEAD, 'b.duramen': 'duramen 0.2\n' }), ['.:1: error P047']);
});

test('REQ-RC-004: one spec, one oracle, one errors list', () => {
  assert.deepEqual(one('duramen 0.1\n'), ['.:1: error P021']);
  assert.deepEqual(one(HEAD + 'spec t 1\noracle a\noracle b\nerrors\nerrors\n'), [
    's.duramen:3: error P044',
    's.duramen:5: error P044',
    's.duramen:7: error P032',
  ]);
});

test('REQ-RC-005: reading problems stop the check', () => {
  assert.deepEqual(one(HEAD + 'frobnicate\nreq A "a"\n'), ['s.duramen:3: error P002']);
});

test('REQ-RC-006: order of diagnostics and counts', () => {
  const r = handle({ id: 'x', op: 'check', input: { files: { 'b.duramen': 'frobnicate\nduramen 0.1\n', 'a.duramen': HEAD + '\nfrobnicate\n' } } });
  assert.deepEqual(r.result.diagnostics, ['a.duramen:4: error P002', 'b.duramen:1: error P002']);
  assert.equal(r.result.errors, 2);
  assert.equal(r.result.warnings, 0);
});

test('REQ-SY-001: lines, white space and indent', () => {
  assert.deepEqual(one('﻿duramen 0.1\r\nspec s 1\rnote  \n  text\t\n    Some.  \r\n'), []);
  assert.deepEqual(one(HEAD + '\tnote\n'), ['s.duramen:3: error P001']);
  assert.deepEqual(one(HEAD + 'note\n   text\n'), ['s.duramen:4: error P001']);
});

test('REQ-SY-002: statements and comments', () => {
  assert.deepEqual(one('# c\nduramen 0.1\nspec s 1\nNote\n  body\n'), ['s.duramen:4: error P002']);
  assert.deepEqual(one('  x\nduramen 0.1\nspec s 1\n'), ['s.duramen:1: error P003']);
});

test('REQ-SY-003: clauses', () => {
  assert.deepEqual(one(HEAD + 'note\n text\n'), ['s.duramen:4: error P007']);
  assert.deepEqual(one(HEAD + 'note\n    x\n'), ['s.duramen:4: error P006']);
  assert.deepEqual(one(HEAD + 'note\n  colour red\n'), ['s.duramen:4: error P015']);
  assert.deepEqual(one(HEAD + 'decision D "d"\n  source a\n  source b\n'), ['s.duramen:5: error P052']);
});

test('REQ-SY-004: duramen, spec and oracle statements', () => {
  assert.deepEqual(one('duramen 0.1\nspec s\n'), ['s.duramen:2: error P021']);
  assert.deepEqual(one(HEAD + '  request {"id": 1}\n'), ['s.duramen:3: error P051']);
  assert.deepEqual(one(HEAD + '  request [1]\n'), ['s.duramen:3: error P009']);
  assert.deepEqual(one(HEAD + 'oracle\n'), ['s.duramen:3: error P028']);
});

test('REQ-SY-005: text', () => {
  assert.deepEqual(one(HEAD + 'note\n  text x\n'), ['s.duramen:4: error P008']);
  assert.deepEqual(one(HEAD + 'note\n  text\n    a\n   b\n'), ['s.duramen:6: error P008']);
});

test('REQ-SY-006: quoted strings, IDs and titles', () => {
  assert.deepEqual(one(HEAD + 'section S T\n'), ['s.duramen:3: error P005']);
  assert.deepEqual(one(HEAD + 'section S "a" "b"\n'), ['s.duramen:3: error P004']);
  assert.deepEqual(one(HEAD + '  title x\n'), ['s.duramen:3: error P004']);
});

test('REQ-SY-007: operations', () => {
  assert.deepEqual(one(HEAD + 'op f g\n'), ['s.duramen:3: error P031']);
  assert.deepEqual(one(HEAD + 'op f\n  input a, b number\n  input b json\n  tolerance x -1\n  audit yes\n'), [
    's.duramen:4: error P017',
    's.duramen:5: error P052',
    's.duramen:6: error P018',
    's.duramen:7: error P050',
  ]);
});

test('REQ-SY-008: the errors list', () => {
  assert.deepEqual(one(HEAD + 'errors\n  a when x\n    y\n  b if x\n   z\n'), ['s.duramen:6: error P019', 's.duramen:7: error P006']);
  assert.deepEqual(one(HEAD + 'errors x\n'), ['s.duramen:3: error P050']);
});

test('REQ-SY-009: requirements, open items, decisions, sections and notes', () => {
  assert.deepEqual(one(HEAD + 'req A "a"\n  on mac\n  status x\n'), ['s.duramen:4: error P033', 's.duramen:5: error P015']);
  assert.deepEqual(one(HEAD + 'note x\n'), ['s.duramen:3: error P050']);
});

test('REQ-SY-010: examples', () => {
  assert.deepEqual(one(HEAD + 'req A "a"\n  example\n  example f [1]\n  example f {\n  example raw x\n'), [
    's.duramen:4: error P012',
    's.duramen:5: error P012',
    's.duramen:6: error P009',
    's.duramen:7: error P004',
  ]);
  assert.deepEqual(one(HEAD + 'req A "a"\n  example f {}\n    expect r = 1 2\n    foo\n    omit\n'), [
    's.duramen:5: error P009',
    's.duramen:6: error P011',
    's.duramen:7: error P011',
  ]);
});

test('REQ-SY-011: texts in an example input', () => {
  assert.deepEqual(one(HEAD + 'req A "a"\n  example f {}\n    input a.b\n'), ['s.duramen:5: error P049']);
  assert.deepEqual(one(HEAD + 'req A "a"\n  example f {}\n    input a from "nope"\n'), ['s.duramen:5: error P048']);
});

test('REQ-SY-012: tables', () => {
  assert.deepEqual(one(HEAD + 'req A "a"\n  table f\n    | x |\n'), ['s.duramen:4: error P013']);
  assert.deepEqual(one(HEAD + 'req A "a"\n  table f\n    | x |\n    | 1 | 2 |\n'), ['s.duramen:6: error P014']);
});

test('REQ-SY-013: numbers too large for binary64', () => {
  assert.deepEqual(one(HEAD + 'req A "a"\n  example f {"a": 1e400}\n'), ['s.duramen:4: error P009']);
  assert.deepEqual(one(HEAD + 'op f\n  tolerance r 1e400\n'), ['s.duramen:4: error P018']);
});

function withOracle(body: string, extra: Record<string, string> = {}) {
  return diags({ 's.duramen': HEAD + 'oracle node echo.mjs\nop f\n  input x? json, answer? json, silent? boolean, exit? integer\n' + body, 'echo.mjs': echo, ...extra });
}

test('REQ-CK-001: every requirement has an example', () => {
  assert.deepEqual(one(HEAD + 'req A "a"\n'), ['s.duramen:3: error T001']);
});

test('REQ-CK-002: IDs are unique', () => {
  assert.deepEqual(withOracle('req A "a"\n  example f {}\nreq A "b"\n  example f {}\n'), ['s.duramen:8: error T007']);
});

test('REQ-CK-003: cited decisions are declared', () => {
  assert.deepEqual(withOracle('req A "a"\n  decision Z, Z\n  example f {}\n'), ['s.duramen:6: error T008']);
});

test('REQ-CK-004: examples of declared operations', () => {
  assert.deepEqual(withOracle('req A "a"\n  example g {}\n  example f {"y": 1}\n'), ['s.duramen:7: error T009', 's.duramen:8: warning T011']);
});

test('REQ-CK-005: expected errors are declared', () => {
  assert.deepEqual(withOracle('errors\n  e when x\nreq A "a"\n  example f {"answer": {"error": "z"}}\n    expect error = "z"\n'), [
    's.duramen:10: error T023',
  ]);
});

test('REQ-CK-006: obligations live in requirements', () => {
  assert.ok(holdsObligation(['It MUST be']));
  assert.ok(!holdsObligation(['It "MUST" be', 'MUSTARD', 'must']));
  assert.ok(holdsObligation(['x`a`MUST']));
  assert.ok(!holdsObligation(['MU`a`ST']));
  assert.deepEqual(one(HEAD + 'note\n  text\n    It SHALL\nopen O "o"\n  text\n    REQUIRED\n'), ['s.duramen:3: error T004', 's.duramen:6: warning T014']);
});

test('REQ-CK-007: open items are not tested', () => {
  assert.deepEqual(one(HEAD + 'open O "o"\n  example f {nope\n  table\n'), ['s.duramen:4: error T003', 's.duramen:5: error T003']);
});

test('REQ-CK-008: the order of errors is stated once', () => {
  assert.deepEqual(withOracle('errors\n  a when x\n  b when y\nreq A "a"\n  text\n    a is checked before b.\n  example f {}\n'), ['s.duramen:10: error T005']);
});

test('REQ-CK-009: decisions', () => {
  assert.deepEqual(one(HEAD + 'decision D "d"\n  status Bad\n'), ['s.duramen:3: warning T012', 's.duramen:3: warning T013', 's.duramen:3: error T027']);
});

test('REQ-OR-001: a record with examples has an oracle', () => {
  assert.deepEqual(one(HEAD + 'op f\nreq A "a"\n  example f {}\n'), ['s.duramen:2: error T019']);
});

test('REQ-OR-002: oracle commands are split into words', () => {
  assert.deepEqual(splitCommand('node "my file.mjs" \'a b\' x"y z"w ""'), ['node', 'my file.mjs', 'a b', 'xy zw', '']);
  assert.deepEqual(splitCommand('a "b\\"c" d\\e'), ['a', 'b"c', 'd\\e']);
  assert.equal(splitCommand('node "oops'), undefined);
});

test('REQ-OR-003: examples the oracle disagrees with', () => {
  assert.deepEqual(withOracle('req A "a"\n  example f {"x": 1.0}\n    expect result.x = 1\n    expect result.x = 2\n    expect result.x ≈ 1.5 ± 0.5\n    expect result.x ≈ 1.6 ± 0.5\n'), [
    's.duramen:9: error T002',
    's.duramen:11: error T002',
  ]);
});

test('REQ-OR-004: an oracle that fails', () => {
  assert.deepEqual(withOracle('req A "a"\n  example f {"exit": 2}\n'), ['s.duramen:3: error T020']);
  assert.deepEqual(diags({ 's.duramen': HEAD + 'oracle nonexistent-program-xyz\nop f\nreq A "a"\n  example f {}\n' }), ['s.duramen:3: error T020', 's.duramen:6: error T021']);
});

test('REQ-OR-005: examples with no answer', () => {
  assert.deepEqual(withOracle('req A "a"\n  example f {"silent": true}\n'), ['s.duramen:7: error T021']);
});

test('REQ-OR-006: examples the oracle cannot compute', () => {
  assert.deepEqual(withOracle('req A "a"\n  example f {"answer": {"oracle_error": 1}}\n    expect result = 5\n'), ['s.duramen:7: error T022']);
});

test('REQ-OR-007: errors nobody expected', () => {
  assert.deepEqual(withOracle('req A "a"\n  example f {"answer": {"error": "e"}}\n'), ['s.duramen:7: warning T024']);
});

test('REQ-OR-008: values taken from the oracle', () => {
  assert.deepEqual(withOracle('req A "a"\n  example f {"x": 1}\n    expect result.y = ?\n'), ['s.duramen:8: error T025']);
});

test('REQ-SU-001 .. REQ-SU-005: the suite', () => {
  const r = handle({
    id: 'x',
    op: 'cases',
    input: {
      files: {
        's.duramen': HEAD + '  request {"clock": 1}\noracle node echo.mjs\nop f\n  input x? json\n  audit\n  tolerance result.x 0.5\nreq A "a"\n  example f {"x": 2.50}\n    expect result.x ≈ 2.5 ± 0\n    expect result = ?\n',
        'echo.mjs': echo,
      },
    },
  });
  assert.equal(r.result.errors, 0);
  assert.deepEqual(r.result.cases, [
    {
      id: 'A#1',
      kind: 'example',
      reqs: ['REQ-A'],
      platform: 'any',
      line: '{"id":"A#1","op":"f","clock":1,"input":{"x": 2.50}}',
      checks: [
        { path: 'result.x', kind: 'approx', value: 2.5, tol: 0 },
        { path: 'result', kind: 'eq', value: { x: 2.5 }, from: 'oracle' },
      ],
      full: { members: ['id', 'result'], result: { x: 2.5 }, tolerances: { 'result.x': 0.5 } },
    },
  ]);
  const bad = handle({ id: 'x', op: 'cases', input: { files: { 's.duramen': 'x' } } });
  assert.deepEqual(bad.result.cases, []);
  assert.equal(bad.result.errors > 0, true);
});

test('REQ-JU-001 .. REQ-JU-004: judging', () => {
  const judge = (c: any, a: any) => handle({ id: 'j', op: 'judge', input: { case: c, answer: a } });
  const full = { members: ['id', 'result'], result: { t: 1 }, tolerances: { 'result.t': 0.5 } };
  assert.deepEqual(judge({ checks: [{ path: 'result.t', kind: 'approx', value: 1, tol: 0.5 }], full }, { id: 'a', result: { t: 1.5 } }).result, { pass: true });
  assert.deepEqual(judge({ checks: [], full }, { id: 'a', result: { t: 1.6 } }).result, { pass: false, failed: ['result'] });
  assert.deepEqual(judge({ checks: [], full }, null).result, { pass: false, failed: ['answer'] });
  assert.deepEqual(judge({ checks: [{ path: 'a', kind: 'eq', value: true }], full: null }, { a: 1 }).result, { pass: false, failed: ['checks.0'] });
  assert.equal(handle({ id: 'j', op: 'judge', input: { case: { checks: [] }, answer: null } }).error, 'bad_request');
  assert.equal(handle({ id: 'j', op: 'judge', input: { case: { checks: [], full: null } } }).error, 'bad_request');
});
