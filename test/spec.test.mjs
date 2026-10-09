import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../src/parse.mjs';
import { check } from '../src/check.mjs';
import { loadRecord, readCSV } from '../src/record.mjs';
import { makeRng } from '../src/types.mjs';
import { ROOT, ORACLE_DRIVER, CALC_ORACLE, src, codes, checkPath, withFiles } from './helpers.mjs';

// ---------- the parser

test('parse: statements, clauses, prose paragraphs, tables and examples', () => {
  const { ast, diagnostics } = parse(src(`
duramen 0.1
spec demo 1.0
  request {"clock": "c"}
op add
  input a number, b? number
  tolerance result 0.5
req ADD-1 "Adds"
  decision D-1
  text
    First paragraph.

    Second paragraph.
  example add {"a": 1.0, "b": 2e0}
    expect result = 3
  example add
    omit clock
    expect error = "bad_request"
  example raw "{not json"
    expect id = null
  table add
    | a | b | result ± 0.1 | audit.x |
    | 1 |   | 1            | ?       |
decision D-1 "Why"
  source a test
`), 'demo.duramen');
  assert.deepEqual(diagnostics, []);
  const r = ast.items.find((i) => i.type === 'req');
  assert.equal(r.text, 'First paragraph.\n\nSecond paragraph.');
  assert.equal(r.examples.length, 4);
  assert.equal(r.examples[0].raw, '{"a": 1.0, "b": 2e0}');
  assert.equal(r.examples[1].noInput, true);
  assert.deepEqual(r.examples[1].omit, ['clock']);
  assert.equal(r.examples[2].rawLine, '{not json');
  const row = r.examples[3];
  assert.deepEqual(row.input, { a: 1 }); // the empty cell leaves b out
  assert.equal(row.raw, '{"a":1}');
  assert.deepEqual(row.expects.map((e) => e.kind), ['approx', 'show']);
  assert.deepEqual(ast.ops[0].inputs.map(({ name, optional, type }) => ({ name, optional, type })), [{ name: 'a', optional: false, type: 'number' }, { name: 'b', optional: true, type: 'number' }]);
});

test('parse: bad input gives diagnostics with lines and columns, never an exception', () => {
  const { diagnostics } = parse('spec x 1\n\tbad\nfrobnicate\nreq A "t"\n  example op {not json}\n', 'x.duramen');
  assert.deepEqual([...new Set(diagnostics.map((d) => d.code))].sort(), ['P001', 'P002', 'P009', 'P020']);
  const p9 = diagnostics.find((d) => d.code === 'P009');
  assert.equal(p9.line, 5);
  assert.ok(p9.col > 10, `column ${p9.col} points into the JSON`);
});

test('parse: an error condition may continue on the next lines', () => {
  const { ast } = parse('duramen 0.1\nspec x 1\nerrors\n  e1 when one\n    and two\n  e2 when three\n', 'x.duramen');
  assert.deepEqual(ast.errors.map((e) => [e.code, e.when]), [['e1', 'one and two'], ['e2', 'three']]);
});

test('parse: 0.2 statements (type, property, evidence, static, edgedef)', () => {
  const { ast, diagnostics } = parse(src(`
duramen 0.2
spec s 1
type num = number | "NaN"
op add
  input a num, b number in 0 .. 10
  returns {sum: number}
req A-1 "Adds"
  example add {"a": 1, "b": 2}
    expect result.sum = 3
  static file "REGEN.json" exists
  static lines "**/*.ts" at most 800 excluding "**/*.test.*"
  static json "REGEN.json" matches {driver: string, ...}
  static command test exits 0 within 60
  static text "**/*.ts" not matching "eval\\\\("
property P-1 "Commutes"
  supports A-1
  samples 20
  for a in -5 .. 5
  for b in int 0 .. 10
  for k in one of 1, 2, "x"
  where a != 0
  call x = add {"a": a, "b": b}
  call y = add {"a": b, "b": a}
  expect x.result == y.result
evidence E-1 "Table"
  source a book
  kind published
  supports A-1
  table add
    | a | b | result.sum |
    | 1 | 1 | 2          |
  waive 1 because D-1
edgedef my/edge "Mine"
  family mine
  text
    Text.
  item 1e21 => 1e+21
  item "\\u2028" escaped "\\"\\u2028\\""
  item "\\ud800" refused
`), 's.duramen');
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.types[0].name, 'num');
  assert.equal(ast.ops[0].inputs[1].parsed.range[1], 10);
  assert.deepEqual(ast.items[0].statics.map((s) => s.kind), ['exists', 'lines', 'json', 'command', 'text']);
  const p = ast.properties[0];
  assert.deepEqual(p.vars.map((v) => v.gen.kind), ['type', 'type', 'oneof']);
  assert.equal(p.calls.length, 2);
  assert.equal(ast.evidence[0].tables[0].rows.length, 1);
  assert.deepEqual(ast.edgedefs[0].pack.map((i) => i.text ?? 'refused'), ['1e+21', '"\u2028"', 'refused']);
});

test('parse: properties name only bound variables', () => {
  const { diagnostics } = parse(src(`
duramen 0.2
spec s 1
property P-1 "x"
  for a in 0 .. 1
  call x = add {"a": b}
  expect y.result == 1
`), 's.duramen');
  assert.deepEqual(codes(diagnostics), ['P037', 'P037']);
});

test('parse: fuzzed sources never throw and never hit an internal error', () => {
  const files = [join(ROOT, 'examples', 'heat-engine', 'heat.duramen'), ...readdirSync(join(ROOT, 'examples', 'history')).map((f) => join(ROOT, 'examples', 'history', f)), ...readdirSync(join(ROOT, 'lib', 'edges')).map((f) => join(ROOT, 'lib', 'edges', f))];
  const rng = makeRng(20261008);
  const junk = ['', ' ', '\t', '"', '{', '}', '|', '=', '?', '±', '\n', '  ', '    ', 'req', 'example', 'expect', 'for', 'call', 'in', '..', '#', '\\', 'raw', "'"];
  let runs = 0;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (let k = 0; k < 60; k++) {
      let t = text;
      for (let m = rng.int(1, 6); m > 0; m--) {
        const at = rng.int(0, t.length);
        const op = rng.int(0, 2);
        if (op === 0) t = t.slice(0, at) + rng.pick(junk) + t.slice(at);
        else if (op === 1) t = t.slice(0, at) + t.slice(at + rng.int(1, 40));
        else { const lines = t.split('\n'); const i = rng.int(0, lines.length - 1); lines.splice(rng.int(0, lines.length - 1), 0, lines[i]); t = lines.join('\n'); }
      }
      const { diagnostics } = parse(t, f);
      assert.ok(!diagnostics.some((d) => d.code === 'P099'), `internal error on a fuzzed ${f}: ${diagnostics.find((d) => d.code === 'P099')?.message}`);
      for (const d of diagnostics) assert.ok(Number.isInteger(d.line) && Number.isInteger(d.col), JSON.stringify(d));
      runs++;
    }
  }
  assert.ok(runs > 400);
});

// ---------- records

test('record: a folder of files is one spec; each diagnostic names its file', async () => {
  await withFiles({
    'calc.mjs': CALC_ORACLE,
    '00-spec.duramen': 'duramen 0.2\nspec calc 1\noracle node calc.mjs\nop add\n  input a number, b number\n',
    'reqs/add.duramen': 'duramen 0.2\nreq ADD-1 "Adds"\n  example add {"a": 1, "b": 2}\n    expect result.sum = 4\n',
  }, async (dir) => {
    const { ds } = await checkPath(dir);
    assert.deepEqual(codes(ds), ['T002']);
    assert.match(ds.find((d) => d.code === 'T002').file, /reqs[\\/]add\.duramen$/);
  });
});

test('record: one spec, one oracle, one errors list, one version', async () => {
  await withFiles({
    'a.duramen': 'duramen 0.2\nspec a 1\noracle node x.mjs\nerrors\n  e when x\n',
    'b.duramen': 'duramen 0.1\nspec b 1\noracle node y.mjs\nerrors\n  f when y\n',
  }, async (dir) => {
    const { diagnostics } = loadRecord(dir);
    assert.deepEqual(codes(diagnostics), ['P032', 'P044', 'P044', 'P047']);
  });
});

test('record: CSV evidence, with quoted fields and a missing column', async () => {
  assert.deepEqual(readCSV('a,b\n1,"x, ""y"""\n').rows[0].cells, { a: '1', b: 'x, "y"' });
  assert.match(readCSV('a,b\n1\n').error, /fields/);
  await withFiles({
    'calc.mjs': CALC_ORACLE,
    'data.csv': 'id,x,y,s\nr1,1,2,3\nr2,2,2,5\n',
    's.duramen': src(`
duramen 0.2
spec calc 1
oracle node calc.mjs
op add
  input a number, b number
req ADD-1 "Adds"
  example add {"a": 1, "b": 2}
    expect result.sum = 3
decision D-1 "The second row is wrong"
  source a test
evidence E-1 "Rows"
  source a test
  kind measured
  supports ADD-1
  table add from "data.csv"
    id id
    columns a = x, b = y
    expect result.sum = s
evidence E-2 "Missing column"
  source a test
  kind measured
  supports ADD-1
  table add from "data.csv"
    columns a = nope
`),
  }, async (dir) => {
    const { ast, diagnostics } = loadRecord(join(dir, 's.duramen'));
    assert.deepEqual(codes(diagnostics), ['P045']);
    assert.deepEqual(ast.evidence[0].rows.map((r) => [r.rowId, r.input, r.expects[0].value]), [['r1', { a: 1, b: 2 }, 3], ['r2', { a: 2, b: 2 }, 5]]);
  });
});

test('record: a spec may define edges; a name the library has is refused', async () => {
  await withFiles({ 's.duramen': 'duramen 0.2\nspec s 1\nedgedef json/rfc8785 "Mine"\n  item 1 => 1\nedgedef my/one "Mine"\n  item 1 => 1\nedge my/one\n' }, async (dir) => {
    const { ast, diagnostics } = loadRecord(join(dir, 's.duramen'));
    assert.deepEqual(codes(diagnostics), ['T033']);
    assert.ok(ast.edgeLib.defs.has('my/one'));
  });
});

// ---------- the checks

test('history: each incident file reports exactly what it is there to show', async () => {
  const HISTORY = {
    'r01-typed-example.duramen': [['T002'], []],
    'r02-order-restated.duramen': [['T005'], []],
    'obligation-in-context.duramen': [['T004'], ['T012']],
    'ambiguous-edge.duramen': [['T015'], []],
    'rcan-two-orders.duramen': [['T026'], []],
    'rfc8785-vs-oracle.duramen': [['T006', 'T006'], []],
  };
  for (const [file, [errors, warnings]] of Object.entries(HISTORY)) {
    const { ds } = await checkPath(join(ROOT, 'examples', 'history', file));
    assert.deepEqual(codes(ds), errors, file);
    assert.deepEqual(codes(ds, 'warning'), warnings, file);
  }
});

test('check: requirement rules (T001, T002, T003, T007 to T013, T023, T024)', async () => {
  await withFiles({ 'rules.duramen': src(`
duramen 0.1
spec rules 1
  request {"clock": "2026-01-01T00:00:00.000Z"}
oracle node ${ORACLE_DRIVER}
op flagF
  input wetBulbF number
errors
  bad_request when anything is wrong
req A-1 "No example"
  text
    Nothing to check.
req A-2 "Bad examples"
  decision D-9
  example nope {"x": 1}
  example flagF {"other": 1}
  example flagF {"wetBulbF": 1}
    expect error = "no_such_code"
req A-2 "Duplicate"
  example flagF {"wetBulbF": 80}
open O-1 "Open"
  example flagF {"wetBulbF": 80}
decision D-1 "Uncited, unsourced"
`) }, async (dir) => {
    const { ds } = await checkPath(join(dir, 'rules.duramen'));
    assert.deepEqual(codes(ds), ['T001', 'T002', 'T003', 'T007', 'T008', 'T009', 'T010', 'T023']);
    assert.deepEqual(codes(ds, 'warning'), ['T011', 'T012', 'T013', 'T024']);
  });
});

test('check: obligation words outside requirements (T004, T014), quotes exempt', async () => {
  const { ast, diagnostics } = parse(src(`
duramen 0.1
spec s 1
  text
    The program MUST do things.
op o
  input x number
  result the result MUST be right
errors
  e when the input SHALL be wrong
section S "S"
  text
    Background that is REQUIRED reading.
note
  text
    A quoted rule is fine: "callers MUST retry", and so is \`MUST\` in code.
open O-1 "Open"
  text
    Implementations MUST NOT depend on this.
decision D-1 "D"
  source a test
  text
    The old schema said "MUST clamp to [5, 99]"; we MUST clamp to [5, 100].
  rejected "Clamping to 99, which MUST be wrong"
`), 's.duramen');
  assert.deepEqual(diagnostics, []);
  ast.edgeLib = { defs: new Map(), families: new Map() };
  const { diagnostics: ds } = await check(ast);
  const t004 = ds.filter((d) => d.code === 'T004').map((d) => d.message.split(':')[0]);
  assert.deepEqual(t004.sort(), ['"MUST" in decision D-1', '"MUST" in decision D-1', '"MUST" in op o', '"MUST" in the spec\'s text', '"REQUIRED" in a section', '"SHALL" in the errors list'].sort());
  assert.deepEqual(codes(ds, 'warning').filter((c) => c === 'T014'), ['T014']);
});

test('check: a quotation is not part of the words around it (T004, duramen-core 0.10.0)', async () => {
  const at = async (text) => {
    const { ast } = parse(src(`
duramen 0.1
spec s 1
note
  text
    ${text}
`), 's.duramen');
    ast.edgeLib = { defs: new Map(), families: new Map() };
    return (await check(ast)).diagnostics.filter((d) => d.code === 'T004').length;
  };
  assert.equal(await at('x`a`MUST'), 1);
  assert.equal(await at('A"q"SHALL'), 1);
  assert.equal(await at('MUST“q”x'), 1);
  assert.equal(await at('MU`a`ST'), 0);
  assert.equal(await at('"MU"ST and MU"ST"'), 0);
  assert.equal(await at('It ``MUST`` be.'), 1);
});

test('check: decision status (T027, T028)', async () => {
  await withFiles({ 's.duramen': src(`
duramen 0.1
spec s 1
op o
  input x number
req A-1 "Rests on a contested decision"
  decision D-1
  example o {"x": 1}
req A-2 "Rests on a proposed decision"
  decision D-2
  example o {"x": 1}
decision D-1 "Contested"
  source a test
  status contested
decision D-2 "Proposed"
  source a test
  status proposed
decision D-3 "Superseded, but by what?"
  source a test
  status superseded
decision D-4 "Not a status"
  source a test
  status maybe
`) }, async (dir) => {
    const { ds } = await checkPath(join(dir, 's.duramen'));
    assert.deepEqual(codes(ds), ['T019', 'T027', 'T027', 'T028']);
    assert.deepEqual(codes(ds, 'warning'), ['T012', 'T012', 'T028']);
  });
});

test('check: 0.2 rules against an oracle (T029, T030, T031, T032, T034, T035, T036, T038, T039)', async () => {
  await withFiles({ 'calc.mjs': CALC_ORACLE, 's.duramen': src(`
duramen 0.2
spec calc 1
oracle node calc.mjs
type small = number in 0 .. 10
op add
  input a small, b small
  returns {sum: string}
op echo
  input v nosuchtype
req ADD-1 "Adds"
  example add {"a": 1, "b": 2}
    expect result.sum = 3
  example add {"a": 11, "b": 2}
    expect result.sum = 13
req ADD-2 "Only the oracle says"
  example add {"a": 2, "b": 2}
    expect result.sum = ?
property P-1 "Commutes"
  supports ADD-1
  samples 30
  for a in 0 .. 10
  for b in 0 .. 10
  call x = add {"a": a, "b": b}
  call y = add {"a": b, "b": a}
  expect x.result == y.result
property P-2 "Wrong on purpose"
  supports ADD-9
  for a in 0 .. 10
  call x = add {"a": a, "b": 1}
  expect x.result.sum == a
property P-3 "Unknown op"
  supports ADD-1
  for a in 0 .. 1
  call x = mul {"a": a}
  expect x.result == 1
evidence E-1 "Two rows, one wrong"
  source a test
  kind measured
  supports ADD-1
  table add
    | a | b | result.sum |
    | 1 | 1 | 2          |
    | 2 | 2 | 5          |
    | 3 | 3 | 6          |
  waive 3 because D-1
decision D-1 "Row 3 is waived"
  source a test
`) }, async (dir) => {
    const { ds } = await checkPath(join(dir, 's.duramen'));
    // T029: 11 is outside small; T030: row 2; T031: P-2; T034: nosuchtype; T035: mul;
    // T038: sum is a number, not a string; T039: ADD-9
    assert.deepEqual(codes(ds), ['T029', 'T030', 'T031', 'T034', 'T035', 'T038', 'T038', 'T038', 'T038', 'T038', 'T038', 'T039']);
    assert.deepEqual(codes(ds, 'warning'), ['T032', 'T036']); // ADD-2 rests on the oracle; row 3 agrees, so its waiver is stale
    const strict = await checkPath(join(dir, 's.duramen'), { strict: true });
    assert.ok(codes(strict.ds).includes('T032'));
  });
});

test('check: a 0.1 file cannot use 0.2 statements (T037)', async () => {
  await withFiles({ 's.duramen': 'duramen 0.1\nspec s 1\nreq A "a"\n  static file "x" exists\n' }, async (dir) => {
    const { ds } = await checkPath(join(dir, 's.duramen'));
    assert.deepEqual(codes(ds), ['T037']);
  });
});
