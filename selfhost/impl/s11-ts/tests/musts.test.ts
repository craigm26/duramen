// Tests for the MUSTs of SPEC.md beyond its own examples, one group per requirement,
// and for the choices recorded in CHOICES.md (named C-<n>).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cases, check, ECHO, text } from './helpers.ts';

const HEAD = ['duramen 0.1', 'spec s 1'];
const ORACLE = [...HEAD, 'oracle node echo.mjs', 'op f', '  input x? json, answer? json, exit? integer'];
const diags = async (files: { [k: string]: string }, extra: object = {}) => (await check(files, extra)).diagnostics;
const one = (...ls: string[]) => diags({ 's.duramen': text(...ls) });
const echo = (...ls: string[]) => diags({ 's.duramen': text(...ls), 'echo.mjs': ECHO });

describe('REQ-RQ-001: a record travels inside the request', () => {
  it('writes each diagnostic file as its name in the request', async () => {
    assert.deepEqual(await diags({ 'x/y/s.duramen': text(...HEAD, 'nope') }), ['x/y/s.duramen:3: error P002']);
  });
});

describe('REQ-RC-001: the files of a record', () => {
  it('a missing record gets P046 and no other diagnostic', async () => {
    assert.deepEqual(await diags({ 'a.duramen': 'frobnicate' }, { entry: 'b' }), ['b:1: error P046']);
  });
  it('a folder whose files are all left out has no files', async () => {
    assert.deepEqual(await diags({ 'r/.a.duramen': text(...HEAD), 'r/build/b.duramen': text(...HEAD) }, { entry: 'r' }),
      ['r:1: error P046']);
  });
  it('a name below a file is no record', async () => {
    assert.deepEqual(await diags({ 'a.duramen': text(...HEAD) }, { entry: 'a.duramen/b' }), ['a.duramen/b:1: error P046']);
  });
  it('a folder named by the entry may itself start with "."', async () => {
    assert.deepEqual(await diags({ '.r/a.duramen': text(...HEAD) }, { entry: '.r' }), []);
  });
});

describe('REQ-RC-003: versions', () => {
  it('accepts 0.2, and a version stated after other statements (C-3)', async () => {
    assert.deepEqual(await one('spec s 1', 'duramen 0.2'), []);
  });
  it('judges a version as the whole rest of the line', async () => {
    assert.deepEqual(await one('duramen 0.1 x', 'spec s 1'), ['s.duramen:1: error P023']);
  });
});

describe('REQ-RC-004: one spec, one oracle, one list of errors', () => {
  it('reports a second spec in the same file and in another', async () => {
    assert.deepEqual(await diags({ 'a.duramen': text(...HEAD, 'spec t 1'), 'b.duramen': text('duramen 0.1', 'spec u 1') }),
      ['a.duramen:3: error P044', 'b.duramen:2: error P044']);
  });
  it('a malformed first spec still counts', async () => {
    assert.deepEqual(await one('duramen 0.1', 'spec s', 'spec t 1'), ['s.duramen:2: error P021', 's.duramen:3: error P044']);
  });
});

describe('REQ-RC-005: problems found while reading stop the check', () => {
  it('reports no T code when a P error was found', async () => {
    assert.deepEqual(await one(...HEAD, 'req A "a"', 'decision D "d"', 'nope'), ['s.duramen:5: error P002']);
  });
});

describe('REQ-RC-006: the order of diagnostics', () => {
  it('lists two equal problems twice and counts them', async () => {
    const r = await check({ 's.duramen': text(...HEAD, 'op f', '  input , ') });
    assert.deepEqual(r, { diagnostics: ['s.duramen:4: error P017', 's.duramen:4: error P017'], errors: 2, warnings: 0 });
  });
  it('orders by file in UTF-16 order, then line, then code', async () => {
    const r = await diags({ 'b.duramen': text('x'), 'B.duramen': text(...HEAD, 'y'), 'a.duramen': text('duramen 0.1', '', 'z') });
    assert.deepEqual(r, ['B.duramen:3: error P002', 'a.duramen:3: error P002', 'b.duramen:1: error P002', 'b.duramen:1: error P020']);
  });
});

describe('REQ-SY-001: lines', () => {
  it('ends lines at CR LF and at a lone CR', async () => {
    assert.deepEqual(await diags({ 's.duramen': 'duramen 0.1\r\nspec s 1\rnope\r\n' }), ['s.duramen:3: error P002']);
  });
  it('ignores a BOM only at the start', async () => {
    assert.deepEqual(await diags({ 's.duramen': '﻿duramen 0.1\nspec s 1\n﻿note\n' }), ['s.duramen:3: error P001']);
  });
  it('a line with P001 is otherwise ignored', async () => {
    assert.deepEqual(await one(...HEAD, '\tfrobnicate', ' \tmore'), ['s.duramen:3: error P001', 's.duramen:4: error P001']);
  });
});

describe('REQ-SY-002: statements and comments', () => {
  it('ignores the body of an unknown statement', async () => {
    assert.deepEqual(await one(...HEAD, 'nope', ' one', '  two', '\t', '   three'), ['s.duramen:3: error P002']);
  });
  it('reads the statements of the rest of the language as nothing (C-5)', async () => {
    assert.deepEqual(await one(...HEAD, 'type T', '  whatever', ' odd'), []);
  });
});

describe('REQ-SY-003: clauses', () => {
  it('gives P006 to a # line indented three with no clause before it', async () => {
    assert.deepEqual(await one(...HEAD, 'note', '   # x'), ['s.duramen:4: error P006']);
  });
  it('gives P007 to a # line indented one', async () => {
    assert.deepEqual(await one(...HEAD, 'note', ' # x'), ['s.duramen:4: error P007']);
  });
  it('ignores the lines under a clause a statement does not take', async () => {
    assert.deepEqual(await one(...HEAD, 'note', '  nope', '    x', '      y'), ['s.duramen:4: error P015']);
  });
  it('a second once-only clause gets P052 also when the first had a problem', async () => {
    assert.deepEqual(await one(...HEAD, 'op f', '  audit json', '  audit', 'req A "a"', '  on mac', '  on any'),
      ['s.duramen:4: error P050', 's.duramen:5: error P052', 's.duramen:7: error P033', 's.duramen:8: error P052']);
  });
  it('gives P006 to a line under a clause that takes none', async () => {
    assert.deepEqual(await one(...HEAD, 'op f', '  result r', '    more', '  input a b', '    more'),
      ['s.duramen:5: error P006', 's.duramen:7: error P006']);
  });
});

describe('REQ-SY-004: spec and oracle', () => {
  it('gives P009 to a request value with a number too large', async () => {
    assert.deepEqual(await one('duramen 0.1', 'spec s 1', '  request {"a": [1e999]}'), ['s.duramen:3: error P009']);
  });
  it('gives P051 to a request setting id or input', async () => {
    assert.deepEqual(await one('duramen 0.1', 'spec s 1', '  request {"id": "x"}', 'op f', '  request {"input": 1}'),
      ['s.duramen:3: error P051', 's.duramen:5: error P051']);
  });
});

describe('REQ-SY-006: quoted strings, IDs and titles', () => {
  it('gives P005 to a statement with no ID (C-8)', async () => {
    assert.deepEqual(await one(...HEAD, 'req'), ['s.duramen:3: error P005']);
  });
  it('gives P004 to a rejected alternative that is not a JSON string', async () => {
    assert.deepEqual(await one(...HEAD, 'decision D "d"', '  source s', '  rejected nope'), ['s.duramen:5: error P004']);
  });
});

describe('REQ-SY-007: operations', () => {
  it('a P018 tolerance does not count as the one for its path (C-11)', async () => {
    assert.deepEqual(await one(...HEAD, 'op f', '  tolerance r x', '  tolerance r 1', '  tolerance r 2'), [
      's.duramen:4: error P018', 's.duramen:6: error P052',
    ]);
  });
});

describe('REQ-SY-010: examples', () => {
  it('reads a raw line between the first and the last single quote, as written', async () => {
    const r = await cases({ 's.duramen': text(...ORACLE, 'req A "a"', "  example raw '{\"id\":\"q\",\"op\":\"f\",\"x\":'1'}'"), 'echo.mjs': ECHO });
    assert.equal(r.errors, 0);
    assert.equal(r.cases[0].line, '{"id":"q","op":"f","x":\'1\'}');
  });
  it('a raw line may not hold a CR', async () => {
    assert.deepEqual(await one(...HEAD, 'req A "a"', '  example raw "a\\rb"'), ['s.duramen:4: error P026']);
  });
  it('reads lines under an example dropped for its first line', async () => {
    assert.deepEqual(await one(...HEAD, 'req A "a"', '  example f 1', '    nope', '    expect x'),
      ['s.duramen:4: error P012', 's.duramen:5: error P011', 's.duramen:6: error P011']);
  });
  it('reads expect forms with ~ and ±, and = with no space', async () => {
    assert.deepEqual(await echo(...ORACLE, 'req A "a"', '  example f {"x": 2}',
      '    expect result.x ≈ 2.1 +- 0.2', '    expect result.x~1.9±0.25', '    expect result.x=2', '    expect result = ?'), []);
  });
});

describe('REQ-SY-011: texts in an example input', () => {
  it('gives P048 to a from file that is a folder', async () => {
    assert.deepEqual(await diags({ 's.duramen': text(...HEAD, 'req A "a"', '  example f {}', '    input a from "d"'), 'd/x.txt': 'x' }),
      ['s.duramen:5: error P048']);
  });
  it('reads a from file inside the record folder, from a subfolder', async () => {
    const r = await cases({
      'r/sub/s.duramen': text(...ORACLE, '  input t? string', 'req A "a"', '  example f {}', '    input t from "../d/t.txt"'),
      'r/d/t.txt': 'T', 'r/sub/echo.mjs': ECHO,
    }, { entry: 'r' });
    assert.equal(r.errors, 0);
    assert.equal(r.cases[0].line, '{"id":"A#1","op":"f","input":{"t":"T"}}');
  });
  it('a file record reads only inside the folder its file is in', async () => {
    assert.deepEqual(await diags({
      'r/s.duramen': text(...HEAD, 'req A "a"', '  example f {}', '    input t from "../t.txt"'), 't.txt': 'T',
    }, { entry: 'r/s.duramen' }), ['r/s.duramen:5: error P048']);
  });
  it('gives P049 to a path through an earlier input line\'s text', async () => {
    assert.deepEqual(await one(...HEAD, 'req A "a"', '  example f {}', '    input a', '      x', '    input a.b', '      y'),
      ['s.duramen:7: error P049']);
  });
});

describe('REQ-SY-012: tables', () => {
  it('reads a ? cell in a column with a tolerance as the oracle value', async () => {
    const r = await cases({ 's.duramen': text(...ORACLE, 'req A "a"', '  table f', '    | x | result.x ± 1 |', '    | 3 | ? |'), 'echo.mjs': ECHO });
    assert.deepEqual(r.cases[0].checks, [{ path: 'result.x', kind: 'eq', value: 3, from: 'oracle' }]);
  });
  it('gives P006 to lines that are no rows, but reads # lines as comments', async () => {
    assert.deepEqual(await one(...HEAD, 'req A "a"', '  table f', '    # c', '    | x |', '    x', '    | 1 |'),
      ['s.duramen:7: error P006']);
  });
});

describe('REQ-CK-002: IDs are unique', () => {
  it('a third use gets T007 too', async () => {
    assert.deepEqual(await one(...HEAD, 'open O "o"', 'open O "o"', 'open O "o"'),
      ['s.duramen:4: error T007', 's.duramen:5: error T007']);
  });
});

describe('REQ-CK-004: examples of declared operations', () => {
  it('reads the fields of an input made with input lines', async () => {
    assert.deepEqual(await echo(...ORACLE, 'op g', '  input files object', 'req A "a"', '  example g', '    input files.a', '      x',
      '  example g {"y": 1}', '    input files.a', '      x'), ['s.duramen:12: warning T011']);
  });
});

describe('REQ-CK-005: expected errors are declared', () => {
  it('an error column of a table names codes too (C-16)', async () => {
    assert.deepEqual(await echo(...ORACLE, 'errors', '  e when x', 'req A "a"', '  table f', '    | answer | error |',
      '    | {"error": "e"} | "e" |', '    | {"error": "z"} | "z" |'), ['s.duramen:12: error T023']);
  });
});

describe('REQ-CK-006: obligations live in requirements', () => {
  it('a requirement text may hold MUST', async () => {
    assert.deepEqual(await echo(...ORACLE, 'req A "a"', '  text', '    It MUST work.', '  example f {}'), []);
  });
});

describe('REQ-CK-009: decisions', () => {
  it('an empty source counts as none, and a missing status as accepted', async () => {
    assert.deepEqual(await echo(...ORACLE, 'decision D "d"', '  source', 'req A "a"', '  decision D', '  example f {}'),
      ['s.duramen:6: warning T013']);
  });
  it('a status of no known word counts as accepted for T028', async () => {
    assert.deepEqual(await echo(...ORACLE, 'decision D "d"', '  source s', '  status Rejected', 'req A "a"', '  decision D',
      '  example f {}'), ['s.duramen:6: error T027']);
  });
});

describe('REQ-OR-002: how the oracle is run', () => {
  const cwdOracle = [
    "import { createInterface } from 'node:readline';",
    'for await (const line of createInterface({ input: process.stdin })) {',
    '  const req = JSON.parse(line);',
    '  console.log(JSON.stringify({ id: req.id, result: process.cwd().split("/").at(-1) }));',
    '  console.log(JSON.stringify({ id: req.id, result: "second" }));',
    '  console.log("[1]");',
    '}',
  ].join('\n');
  it('runs in the folder of the file holding the oracle statement, and takes the first response of an id', async () => {
    assert.deepEqual(await diags({
      'a.duramen': text('duramen 0.1', 'req A "a"', '  example f {}', '    expect result = "o"'),
      'o/s.duramen': text(...HEAD, 'oracle node cwd.mjs', 'op f'),
      'o/cwd.mjs': cwdOracle,
    }), []);
  });
  it('a run sent alone that writes two lines has no response', async () => {
    assert.deepEqual(await diags({
      's.duramen': text(...HEAD, 'oracle node cwd.mjs', 'op f', 'req A "a"', '  example f {}', '    omit id'),
      'cwd.mjs': cwdOracle,
    }), ['s.duramen:6: error T021']);
  });
  it('does not run examples of undeclared operations', async () => {
    assert.deepEqual(await one(...HEAD, 'oracle no-such-program-for-duramen', 'req A "a"', '  example g {}'),
      ['s.duramen:5: error T009']);
  });
});

describe('REQ-OR-004: an oracle that fails', () => {
  it('a run alone that exits with a status other than 0 gets T020 at the example', async () => {
    assert.deepEqual(await echo(...ORACLE, 'req A "a"', '  example f {"exit": 1}', '    omit id'), ['s.duramen:7: error T020']);
  });
});

describe('REQ-OR-006: examples the oracle cannot compute', () => {
  it('gets T022 and no other check, also not T024 (C-21)', async () => {
    assert.deepEqual(await echo(...ORACLE, 'req A "a"', '  example f {"answer": {"oracle_error": 1, "error": "e"}}'),
      ['s.duramen:7: error T022']);
  });
});

describe('REQ-SU-001: no suite from a record with errors', () => {
  it('warnings do not stop the suite', async () => {
    const r = await cases({ 's.duramen': text(...ORACLE, 'req A "a"', '  example f {"y": 1}'), 'echo.mjs': ECHO });
    assert.equal(r.errors, 0);
    assert.equal(r.cases.length, 1);
  });
  it('counts the errors check reports', async () => {
    const files = { 's.duramen': text(...ORACLE, 'req A "a"', '  example g {}', 'req B "b"'), 'echo.mjs': ECHO };
    assert.deepEqual(await cases(files), { errors: (await check(files)).errors, cases: [] });
  });
});

describe('REQ-SU-002: one case per example', () => {
  it('numbers examples and table rows together, in order of lines', async () => {
    const r = await cases({ 's.duramen': text(...ORACLE, 'req A "a"', '  example f {}', '  table f', '    | x |', '    | 1 |',
      '    | 2 |', '  example raw \'{"id":"A#4","op":"f"}\''), 'echo.mjs': ECHO });
    assert.deepEqual(r.cases.map((c: any) => [c.id, c.solo]), [['A#1', undefined], ['A#2', undefined], ['A#3', undefined], ['A#4', true]]);
  });
});

describe('REQ-SU-003: request lines', () => {
  it('writes integer-named members first, and an operation request replaces the spec one', async () => {
    const r = await cases({ 's.duramen': text('duramen 0.1', 'spec s 1', '  request {"b": 1, "1": 2}', 'oracle node echo.mjs',
      'op f', 'op g', '  request {"z": 0}', 'req A "a"', '  example f', '    request {"a": 3, "b": 4, "0": 5}', '  example g {}'),
    'echo.mjs': ECHO });
    assert.equal(r.cases[0].line, '{"id":"A#1","op":"f","0":5,"1":2,"b":4,"a":3}');
    assert.equal(r.cases[1].line, '{"id":"A#2","op":"g","z":0,"input":{}}');
  });
});

describe('REQ-SU-005: the whole answer', () => {
  it('gives a raw example the tolerances and audit of the op its line names (C-24)', async () => {
    const r = await cases({ 's.duramen': text(...ORACLE, '  audit', '  tolerance result.x 1',
      'req A "a"', '  example raw \'{"id":"r","op":"f","input":{"answer":{"result":1,"audit":"t"}}}\''), 'echo.mjs': ECHO });
    assert.deepEqual(r.cases[0].full, { members: ['audit', 'id', 'result'], result: 1, audit: 't', tolerances: { 'result.x': 1 } });
  });
});
