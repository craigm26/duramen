// node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parse } from '../src/parse.mjs';
import { check } from '../src/check.mjs';
import { generateCases, runCases } from '../src/suite.mjs';
import { renderSpec } from '../src/render.mjs';
import { EDGES, packConflicts } from '../src/edges.mjs';
import { canon } from '../examples/heat-engine/oracle.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const HEAT = join(ROOT, 'examples', 'heat-engine', 'heat.tilth');
const IMPLS = process.env.HEAT_ENGINE_IMPLS ?? join(ROOT, '..', 'regen-heat-engine', 'impl');

async function checkFile(path) {
  const { ast, diagnostics } = parse(readFileSync(path, 'utf8'), path);
  const r = diagnostics.some((d) => d.level === 'error') ? { diagnostics: [], oracle: null } : await check(ast);
  return { ast, ds: [...diagnostics, ...r.diagnostics], oracle: r.oracle };
}
const codes = (ds, level = 'error') => ds.filter((d) => d.level === level).map((d) => d.code).sort();
const src = (s) => s.replace(/^\n/, '');

// ---------- parser

test('parse: statements, clauses, prose paragraphs, tables and examples', () => {
  const { ast, diagnostics } = parse(src(`
tilth 0.1
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
`), 'demo.tilth');
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
  assert.deepEqual(ast.ops[0].inputs, [{ name: 'a', optional: false, type: 'number' }, { name: 'b', optional: true, type: 'number' }]);
});

test('parse: bad input gives diagnostics, never an exception', () => {
  const { diagnostics } = parse('spec x 1\n\tbad\nfrobnicate\nreq A "t"\n  example op {not json}\n', 'x.tilth');
  assert.deepEqual([...new Set(diagnostics.map((d) => d.code))].sort(), ['P001', 'P002', 'P009', 'P020']);
});

test('parse: an error condition may continue on the next lines', () => {
  const { ast } = parse('tilth 0.1\nspec x 1\nerrors\n  e1 when one\n    and two\n  e2 when three\n', 'x.tilth');
  assert.deepEqual(ast.errors.map((e) => [e.code, e.when]), [['e1', 'one and two'], ['e2', 'three']]);
});

// ---------- the history: each file reports exactly what it is there to show

const HISTORY = {
  'r01-typed-example.tilth': [['T002'], []],
  'r02-order-restated.tilth': [['T005'], []],
  'obligation-in-context.tilth': [['T004'], ['T012']], // and nothing cites the decision
  'ambiguous-edge.tilth': [['T015'], []],
  'rcan-two-orders.tilth': [['T026'], []],
  'rfc8785-vs-oracle.tilth': [['T006', 'T006'], []],
};
for (const [file, [errors, warnings]] of Object.entries(HISTORY)) {
  test(`history: ${file} reports ${errors.join(', ')}`, async () => {
    const { ds } = await checkFile(join(ROOT, 'examples', 'history', file));
    assert.deepEqual(codes(ds), errors);
    assert.deepEqual(codes(ds, 'warning'), warnings);
  });
}

test('history: the unfinished r01 example is filled in by the oracle', async () => {
  const { ast, oracle } = await checkFile(join(ROOT, 'examples', 'history', 'r01-typed-example.tilth'));
  assert.match(renderSpec(ast, oracle), /\| `60` \| `2\.5` \| `"T=60\.0°C RH=2\.5→5% \(rh_clamped,out_of_validity_range\) → Tw=25\.97°C"` \|/);
});

// ---------- structural rules

test('check: requirement rules (T001, T002, T003, T007 to T013, T023, T024)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tilth-test-'));
  try {
    const p = join(dir, 'rules.tilth');
    writeFileSync(p, src(`
tilth 0.1
spec rules 1
  request {"clock": "2026-01-01T00:00:00.000Z"}
oracle node ${join(ROOT, 'examples', 'heat-engine', 'oracle-driver.mjs').replace(/\\/g, '/')}
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
`));
    const { ds } = await checkFile(p);
    assert.deepEqual(codes(ds), ['T001', 'T002', 'T003', 'T007', 'T008', 'T009', 'T010', 'T023']);
    // T024: the oracle answers the example with the missing field with bad_request.
    assert.deepEqual(codes(ds, 'warning'), ['T011', 'T012', 'T013', 'T024']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('check: obligation words outside requirements (T004, T014), quotes exempt', async () => {
  const { ast, diagnostics } = parse(src(`
tilth 0.1
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
`), 's.tilth');
  assert.deepEqual(diagnostics, []);
  const { diagnostics: ds } = await check(ast);
  const t004 = ds.filter((d) => d.code === 'T004').map((d) => d.message.split(':')[0]);
  // Two in D-1: its text and its rejected alternative.
  assert.deepEqual(t004.sort(), ['"MUST" in decision D-1', '"MUST" in decision D-1', '"MUST" in op o', '"MUST" in the spec\'s text', '"REQUIRED" in a section', '"SHALL" in the errors list'].sort());
  assert.deepEqual(codes(ds, 'warning').filter((c) => c === 'T014'), ['T014']);
});

test('check: an example the oracle answers with an error must say so (T024)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tilth-test-'));
  try {
    const p = join(dir, 'x.tilth');
    writeFileSync(p, `tilth 0.1\nspec x 1\noracle node ${join(ROOT, 'examples', 'heat-engine', 'oracle-driver.mjs').replace(/\\/g, '/')}\nop flagF\n  input wetBulbF? number\nreq A-1 "t"\n  example flagF {}\n`);
    const { ds } = await checkFile(p);
    assert.deepEqual(codes(ds, 'warning'), ['T024']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('check: decision status (T027, T028)', async () => {
  const { ast, diagnostics } = parse(src(`
tilth 0.1
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
`), 's.tilth');
  assert.deepEqual(diagnostics, []);
  const { diagnostics: ds } = await check(ast);
  assert.deepEqual(codes(ds), ['T019', 'T027', 'T027', 'T028']);
  assert.deepEqual(codes(ds, 'warning'), ['T012', 'T012', 'T028']);
});

// ---------- the edge library checks itself against independent models

test('edges: number-text/ecmascript agrees with ECMAScript String()', () => {
  for (const { input, text } of EDGES['number-text/ecmascript'].pack) assert.equal(String(JSON.parse(input)), text, input);
});

test('edges: json/sorted-utf16 agrees with the heat-engine canonical writer', () => {
  for (const { input, text } of EDGES['json/sorted-utf16'].pack) assert.equal(canon(JSON.parse(input)), text, input);
});

test('edges: json/sorted-codepoint agrees with a code-point-ordered writer', () => {
  const cp = (s) => [...s].map((c) => c.codePointAt(0));
  const cmp = (a, b) => { const A = cp(a), B = cp(b); for (let i = 0; i < Math.min(A.length, B.length); i++) if (A[i] !== B[i]) return A[i] - B[i]; return A.length - B.length; };
  const lone = (s) => !s.isWellFormed();
  const w = (v) => {
    if (typeof v === 'string' && lone(v)) throw new Error('no canonical form');
    if (v === null || typeof v !== 'object') return canon(v);
    if (Array.isArray(v)) return `[${v.map(w).join(',')}]`;
    return `{${Object.keys(v).sort(cmp).map((k) => { if (lone(k)) throw new Error('no canonical form'); return `${JSON.stringify(k)}:${w(v[k])}`; }).join(',')}}`;
  };
  for (const item of EDGES['json/sorted-codepoint'].pack) {
    if (item.refuse) assert.throws(() => w(JSON.parse(item.input)), /no canonical form/, item.input);
    else assert.equal(w(JSON.parse(item.input)), item.text, item.input);
  }
});

test('edges: json/rfc8785 is json/sorted-utf16 except that it refuses lone surrogates', () => {
  const lone = (s) => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);
  const a = EDGES['json/rfc8785'].pack, b = EDGES['json/sorted-utf16'].pack;
  a.forEach((x, i) => {
    assert.equal(x.input, b[i].input);
    if (lone(JSON.stringify(JSON.parse(x.input)).replace(/\\u[0-9a-f]{4}/g, (m) => String.fromCharCode(parseInt(m.slice(2), 16))))) assert.equal(x.refuse, true, x.input);
    else assert.equal(x.text, b[i].text, x.input);
  });
});

test('edges: conflicts between packs', () => {
  assert.equal(packConflicts('json/sorted-utf16', 'json/rfc8785').length, 2);
  assert.equal(packConflicts('json/sorted-utf16', 'json/sorted-codepoint').length, 3);
  assert.equal(packConflicts('json/sorted-codepoint', 'json/rfc8785').length, 1);
  assert.equal(packConflicts('json/sorted-utf16', 'json/sorted-utf16').length, 0);
});

// ---------- the heat-engine slice end to end

test('heat-engine: the slice checks clean', async () => {
  const { ds } = await checkFile(HEAT);
  assert.deepEqual(codes(ds), []);
  assert.deepEqual(codes(ds, 'warning'), []);
});

test('heat-engine: the suite has one case per example and per bound pack item', async () => {
  const { ast, oracle } = await checkFile(HEAT);
  const cases = generateCases(ast, oracle);
  const examples = ast.items.filter((i) => i.type === 'req').reduce((n, r) => n + r.examples.length, 0);
  assert.equal(cases.length, examples + EDGES['number-text/ecmascript'].pack.length + EDGES['json/sorted-utf16'].pack.length);
  assert.ok(cases.every((c) => c.full), 'every case carries the oracle answer');
  assert.equal(cases.filter((c) => c.solo).length, 3);
});

test('heat-engine: the oracle itself passes the generated suite', async () => {
  const { ast, oracle } = await checkFile(HEAT);
  const r = await runCases(generateCases(ast, oracle), { command: 'node oracle-driver.mjs', cwd: join(ROOT, 'examples', 'heat-engine') });
  assert.deepEqual(r.failures, []);
});

test('protocol: CR in the output, and a wrong response count, are failures', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tilth-test-'));
  try {
    // Answers every line, blank ones included, with CRLF.
    writeFileSync(join(dir, 'bad.mjs'), "let s='';for await (const c of process.stdin) s+=c;for (const l of s.split('\\n').slice(0,-1)) { let id=null; try { id=JSON.parse(l).id; } catch {} process.stdout.write(JSON.stringify({id,result:1})+'\\r\\n'); }\n");
    const cases = [{ id: 'a', reqs: ['REQ-X'], platform: 'any', line: '{"id":"a","op":"x","input":{}}', checks: [], full: null }];
    const r = await runCases(cases, { command: 'node bad.mjs', cwd: dir });
    assert.deepEqual(r.failures.map((f) => f.id).sort(), ['protocol:bytes', 'protocol:lines']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('heat-engine: the committed build output is what `tilth build` writes now', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tilth-test-'));
  try {
    const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'tilth.mjs'), 'build', HEAT, '--out', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const f of ['SPEC.md', 'DECISIONS.md', 'trace.md', 'cases.jsonl']) {
      assert.equal(readFileSync(join(dir, f), 'utf8'), readFileSync(join(ROOT, 'examples', 'heat-engine', 'build', f), 'utf8'), `${f} is stale: run npm run example`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const lang of ['ts', 'py']) {
  const impl = join(IMPLS, lang);
  test(`heat-engine: the released ${lang} implementation passes`, { skip: !existsSync(join(impl, 'REGEN.json')) && `no ${impl}` }, () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'tilth.mjs'), 'run', HEAT, '--impl', impl], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /passed (\d+)\/\1\b/);
  });
}
