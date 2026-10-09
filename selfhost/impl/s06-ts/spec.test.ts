import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, serve } from './serve.ts';

const ECHO = String.raw`// A tiny oracle for the example records in this specification.
import { createInterface } from 'node:readline';

let status = 0;
for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === '') continue;
  let req;
  try { req = JSON.parse(line); } catch { console.log(JSON.stringify({ id: null, error: 'bad_request' })); continue; }
  const input = req && typeof req.input === 'object' && req.input !== null ? req.input : {};
  if (Number.isInteger(input.exit)) status = input.exit;
  if (input.silent === true) continue;
  const result = input.line === true ? { result: line } : { result: input };
  console.log(JSON.stringify({ id: req?.id ?? null, ...(input.answer ?? result) }));
}
process.exitCode = status;
`;

type Files = Record<string, string>;

function diags(files: Files, entry?: string): string[] {
  const input: Record<string, unknown> = { files };
  if (entry !== undefined) input.entry = entry;
  const r = handle(JSON.stringify({ id: 'x', op: 'check', input })) as { result: { diagnostics: string[] } };
  return r.result.diagnostics;
}

function cases(files: Files, entry?: string): any {
  const input: Record<string, unknown> = { files };
  if (entry !== undefined) input.entry = entry;
  return (handle(JSON.stringify({ id: 'x', op: 'cases', input })) as any).result;
}

const S = (body: string) => 'duramen 0.1\nspec s 1\n' + body;
const withEcho = (files: Files): Files => ({ 'echo.mjs': ECHO, ...files });
const OPF = 'oracle node echo.mjs\nop f\n  input x? json\n';

// ---- REQ-RQ-001 / REQ-RQ-002

test('REQ-RQ-001: entry file, whole folder, file names in diagnostics', () => {
  const a = 'duramen 0.1\nspec a 1\n';
  assert.deepEqual(diags({ 'a.duramen': a, 'b.duramen': 'frobnicate\n' }, 'a.duramen'), []);
  assert.deepEqual(diags({ 'a.duramen': a, 'b.duramen': 'frobnicate\n' }), ['b.duramen:1: error P002', 'b.duramen:1: error P020']);
  const r = handle(JSON.stringify({ id: 'q', op: 'check', input: { files: { 'a.duramen': a, 'b.duramen': 'frobnicate\n' } } }));
  assert.deepEqual(r, { id: 'q', result: { diagnostics: ['b.duramen:1: error P002', 'b.duramen:1: error P020'], errors: 2, warnings: 0 } });
});

test('REQ-RQ-002: requests that cannot be handled', () => {
  const ok = { 'a.duramen': 'duramen 0.1\nspec a 1\n' };
  const t = (line: string, exp: unknown) => assert.deepEqual(handle(line), exp);
  t('{not json', { id: null, error: 'bad_request' });
  t('[1, 2]', { id: null, error: 'bad_request' });
  t(JSON.stringify({ op: 'check', input: { files: ok } }), { id: null, error: 'bad_request' });
  t(JSON.stringify({ id: 7, op: 'check', input: { files: ok } }), { id: null, error: 'bad_request' });
  t(JSON.stringify({ id: 'i', op: 'lint', input: { files: { 'a.duramen': 'x' } } }), { id: 'i', error: 'unknown_op' });
  t(JSON.stringify({ id: 'i', op: 'lint' }), { id: 'i', error: 'unknown_op' });
  t(JSON.stringify({ id: 'i', op: 'check' }), { id: 'i', error: 'bad_request' });
  const bad = (input: unknown) => t(JSON.stringify({ id: 'i', op: 'check', input }), { id: 'i', error: 'bad_request' });
  bad({});
  bad({ files: {} });
  bad({ files: ['a.duramen'] });
  bad({ files: { 'a.duramen': 1 } });
  for (const n of ['../a.duramen', '/a.duramen', 'x/./a.duramen', 'x//a.duramen', 'c:a.duramen', 'a\\b.duramen', 'a\0b']) {
    bad({ files: { [n]: 'x' } });
  }
  bad({ files: { a: 'x', 'a/b.duramen': 'x' } });
  bad({ files: ok, entry: '../a.duramen' });
  bad({ files: ok, entry: 1 });
  bad({ files: ok, entry: '' });
  assert.equal((handle(JSON.stringify({ id: 'i', op: 'check', input: { files: ok, entry: '.' } })) as any).error, undefined);
});

test('driver protocol: blank lines get no response, order kept, LF only', () => {
  const ok = { 'a.duramen': 'duramen 0.1\nspec a 1\n' };
  const out = serve(
    JSON.stringify({ id: '1', op: 'check', input: { files: ok } }) + '\n \t \n\n' + JSON.stringify({ id: '2', op: 'nope' }) + '\n',
  );
  const lines = out.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[2], '');
  assert.equal(JSON.parse(lines[0]).id, '1');
  assert.deepEqual(JSON.parse(lines[1]), { id: '2', error: 'unknown_op' });
  assert.ok(!out.includes('\r'));
});

// ---- REQ-RC

test('REQ-RC-001: files of a record', () => {
  const d = 'duramen 0.1\nspec a 1\n';
  const fr = 'frobnicate\n';
  assert.deepEqual(
    diags({
      'a.duramen': d,
      'notes.md': fr,
      'build/x.duramen': fr,
      'sub/build/x.duramen': fr,
      'node_modules/x.duramen': fr,
      '.hidden.duramen': fr,
      'sub/.hidden/x.duramen': fr,
      'sub/b.duramen': 'duramen 0.1\n',
    }),
    [],
  );
  assert.deepEqual(diags({ 'notes.md': d, 'a.duramen': fr }, 'notes.md'), []);
  assert.deepEqual(diags({ 'sub/a.duramen': d, 'sub/deeper/b.duramen': 'duramen 0.1\n', 'c.duramen': fr }, 'sub'), []);
  assert.deepEqual(diags({ 'sub/a.duramen': d, 'sub/b.duramen': fr }, 'sub/a.duramen'), []);
  assert.deepEqual(diags({ 'build/a.duramen': d, 'build/build/b.duramen': fr }, 'build'), []);
  assert.deepEqual(diags({ 'a.duramen': d }, 'missing.duramen'), ['missing.duramen:1: error P046']);
  assert.deepEqual(diags({ 'a.duramen': d }, 'sub'), ['sub:1: error P046']);
  assert.deepEqual(diags({ 'notes.md': d }), ['.:1: error P046']);
});

test('REQ-RC-002: order of files', () => {
  const mk = (n: string) => `duramen 0.1\nspec ${n} 1\n`;
  assert.deepEqual(diags({ 'b.duramen': mk('b'), 'a.duramen': mk('a') }), ['b.duramen:2: error P044']);
  assert.deepEqual(diags({ 'a.duramen': mk('a'), 'B.duramen': mk('b') }), ['a.duramen:2: error P044']);
  assert.deepEqual(diags({ 'a/z.duramen': mk('z'), 'a.duramen': mk('a') }), ['a/z.duramen:2: error P044']);
  assert.deepEqual(diags({ '｡.duramen': mk('x'), '😀.duramen': mk('y') }), ['｡.duramen:2: error P044']);
});

test('REQ-RC-003: versions', () => {
  assert.deepEqual(diags({ 's.duramen': 'spec s 1\n' }), ['s.duramen:1: error P020']);
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.3\nspec s 1\n' }), ['s.duramen:1: error P023']);
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.1\nspec s 1\nduramen 0.1\nduramen 9\n' }), ['s.duramen:3: error P023', 's.duramen:4: error P023']);
  assert.deepEqual(diags({ 's.duramen': 'duramen\nspec s 1\n' }), ['s.duramen:1: error P023']);
  assert.deepEqual(diags({ 'a.duramen': 'duramen 0.1\nspec s 1\n', 'b.duramen': 'duramen 0.2\n' }), ['.:1: error P047']);
  assert.deepEqual(diags({ 'r/a.duramen': 'duramen 0.2\nspec s 1\n', 'r/b.duramen': 'duramen 0.1\n' }, 'r'), ['r:1: error P047']);
  assert.deepEqual(diags({ 'a.duramen': 'duramen 0.2\nspec s 1\n', 'b.duramen': 'duramen 0.2\n' }), []);
  assert.deepEqual(diags({ 'a.duramen': 'duramen 0.2\nspec s 1\n', 'b.duramen': 'duramen 2\n' }), ['b.duramen:1: error P023']);
  assert.deepEqual(diags({ 's.duramen': '' }), ['.:1: error P021', 's.duramen:1: error P020']);
});

test('REQ-RC-004: one spec, one oracle, one errors', () => {
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.1\n' }), ['.:1: error P021']);
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.1\n' }, 's.duramen'), ['s.duramen:1: error P021']);
  assert.deepEqual(diags({ 'r/s.duramen': 'duramen 0.1\n' }, 'r'), ['r:1: error P021']);
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.1\nspec a 1\n\nspec b 1\n' }), ['s.duramen:4: error P044']);
  assert.deepEqual(
    diags({ 'a.duramen': S('oracle node a.mjs\n').replace('spec s 1', 'spec s 1'), 'b.duramen': 'duramen 0.1\noracle node b.mjs\n' }),
    ['b.duramen:2: error P044'],
  );
  assert.deepEqual(diags({ 's.duramen': S('errors\n  e1 when x\nerrors\n  e2 when y\n') }), ['s.duramen:5: error P032']);
  assert.deepEqual(
    diags({ 'a.duramen': S('errors\n  e1 when x\n'), 'b.duramen': 'duramen 0.1\n\nerrors\n  e2 when y\n' }),
    ['b.duramen:3: error P032'],
  );
  assert.deepEqual(diags({ 's.duramen': S('errors\nerrors\n') }), ['s.duramen:4: error P032']);
  assert.deepEqual(
    diags({
      's.duramen': 'duramen 0.1\nspec s 1\nduramen 0.1\n  title "t"\nspec s\noracle\n  source o.mjs\n    more\nerrors x\n  e if\n',
    }),
    [
      's.duramen:3: error P023',
      's.duramen:4: error P015',
      's.duramen:5: error P021',
      's.duramen:5: error P044',
      's.duramen:6: error P028',
      's.duramen:8: error P006',
      's.duramen:9: error P050',
      's.duramen:10: error P019',
    ],
  );
  assert.deepEqual(
    diags({ 'a.duramen': S('oracle\noracle node a.mjs\n'), 'b.duramen': 'duramen 0.1\noracle node b.mjs\n' }),
    ['a.duramen:3: error P028', 'a.duramen:4: error P044', 'b.duramen:2: error P044'],
  );
});

test('REQ-RC-005: problems found while reading stop the check', () => {
  assert.deepEqual(diags({ 's.duramen': S('frobnicate\nreq A "a"\n  example nope {}\n') }), ['s.duramen:3: error P002']);
});

test('REQ-RC-006: order of diagnostics', () => {
  const r = handle(
    JSON.stringify({
      id: 'q',
      op: 'check',
      input: { files: { 'b.duramen': 'frobnicate\nduramen 0.1\n', 'a.duramen': 'duramen 0.1\nspec s 1\n\n\nfrobnicate\nfrobnicate\n' } },
    }),
  ) as any;
  assert.deepEqual(r.result, {
    diagnostics: ['a.duramen:5: error P002', 'a.duramen:6: error P002', 'b.duramen:1: error P002'],
    errors: 3,
    warnings: 0,
  });
  const r2 = handle(
    JSON.stringify({
      id: 'q',
      op: 'check',
      input: { files: { 's.duramen': S('\ndecision D-1 "one"\n  text\n    No source, and cited by nothing.\n\nreq A "a"\n  decision D-2\n') } },
    }),
  ) as any;
  assert.deepEqual(r2.result, {
    diagnostics: ['s.duramen:4: warning T012', 's.duramen:4: warning T013', 's.duramen:8: error T001', 's.duramen:8: error T008'],
    errors: 2,
    warnings: 2,
  });
  assert.deepEqual(
    diags({
      's.duramen': S(
        '\ndecision D-1 "proposed"\n  source here\n  status proposed\n\ndecision D-2 "contested"\n  source there\n  status contested\n\nreq A "a"\n  decision D-1, D-2\n',
      ),
    }),
    ['s.duramen:12: error T001', 's.duramen:12: error T028', 's.duramen:12: warning T028'],
  );
});

// ---- REQ-SY

test('REQ-SY-001: lines', () => {
  assert.deepEqual(diags({ 's.duramen': '﻿duramen 0.1\r\nspec s 1\rnote  \n  text\t\n    Some text.  \r\n' }), []);
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.1\nspec s 1\n\tnote\n' }), ['s.duramen:3: error P001']);
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.1\nspec s 1\nnote\n  \ttext\n' }), ['s.duramen:4: error P001']);
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.1\nspec s 1\n note\n' }), ['s.duramen:3: error P001']);
  assert.deepEqual(diags({ 's.duramen': '  \t \nduramen 0.1\n\t\nspec s 1\n   \n' }), []);
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.1　\nspec s 1 \nnote\n  text\n' }), ['s.duramen:4: error P001']);
});

test('REQ-SY-002: statements and comments', () => {
  assert.deepEqual(
    diags({ 's.duramen': '# A comment.\nduramen 0.1\n#A comment too.\nspec s 1\nfrobnicate this\n  title "ignored"\n    ignored too\nNote\n' }),
    ['s.duramen:5: error P002', 's.duramen:8: error P002'],
  );
  assert.deepEqual(diags({ 's.duramen': '  indented\n # indented too\nduramen 0.1\nspec s 1\n' }), ['s.duramen:1: error P003', 's.duramen:2: error P003']);
});

test('REQ-SY-003: clauses', () => {
  assert.deepEqual(diags({ 's.duramen': S('note\n  # A comment.\n  text\n    Text.\n    # Text, not a comment.\n') }), []);
  assert.deepEqual(diags({ 's.duramen': S('note\n text\n') }), ['s.duramen:4: error P007']);
  assert.deepEqual(diags({ 's.duramen': S('note\n    Text without a clause.\n  text\n    Text.\n') }), ['s.duramen:4: error P006']);
  assert.deepEqual(
    diags({ 's.duramen': S('  colour blue\n    more\nnote\n  example f {}\n    expect result = 1\n') }),
    ['s.duramen:3: error P015', 's.duramen:6: error P015'],
  );
  assert.deepEqual(
    diags({ 's.duramen': S('note\n # not a comment here\n    # nor here\n  text\n    Text.\n') }),
    ['s.duramen:4: error P007', 's.duramen:5: error P006'],
  );
  assert.deepEqual(
    diags({
      's.duramen': S(
        '  title "one"\n  title "two"\n    more\nnote\n  text\n    One.\n  text Two.\ndecision D "d"\n  source a\n  source b\n  status accepted\n  status rejected\n',
      ),
    }),
    ['s.duramen:4: error P052', 's.duramen:9: error P052', 's.duramen:12: error P052', 's.duramen:14: error P052'],
  );
  assert.deepEqual(diags({ 's.duramen': S('  title "A title"\n    that goes on\n  # A comment.\n    # Another.\n') }), ['s.duramen:4: error P006']);
});

test('REQ-SY-004: duramen, spec and oracle statements', () => {
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.1\n  title "x"\nspec s 1\n' }), ['s.duramen:2: error P015']);
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.1\nspec s\n' }), ['s.duramen:2: error P021']);
  assert.deepEqual(diags({ 's.duramen': 'duramen 0.1\nspec s 1 2\n' }), ['s.duramen:2: error P021']);
  assert.deepEqual(
    diags({
      's.duramen':
        'duramen 0.1\nspec s 1.0.0-beta\n  title "The s program"\n  contract s-out-2\n  request {"clock": "2026-01-01T00:00:00Z", "n": 1}\n  text\n    What s is.\n',
    }),
    [],
  );
  assert.deepEqual(diags({ 's.duramen': S('  request {"clock":\n') }), ['s.duramen:3: error P009']);
  assert.deepEqual(diags({ 's.duramen': S('  request ["clock"]\n') }), ['s.duramen:3: error P009']);
  assert.deepEqual(diags({ 's.duramen': S('  request {"op": "x"}\n') }), ['s.duramen:3: error P051']);
  assert.deepEqual(diags({ 's.duramen': S('oracle\n') }), ['s.duramen:3: error P028']);
  assert.deepEqual(diags({ 's.duramen': S('oracle node model.mjs --quiet\n  source model.mjs, lib/a.mjs lib/b.mjs\n  timeout 5\n') }), ['s.duramen:5: error P015']);
});

test('REQ-SY-005: text', () => {
  assert.deepEqual(diags({ 's.duramen': S('note\n  text Here.\n') }), ['s.duramen:4: error P008']);
  assert.deepEqual(diags({ 's.duramen': S('note\n  text\n    One.\n   Two.\n') }), ['s.duramen:6: error P008']);
  assert.deepEqual(diags({ 's.duramen': S('note\n  text\n    # It MUST be text.\n') }), ['s.duramen:3: error T004']);
});

test('REQ-SY-006: quoted strings, IDs and titles', () => {
  assert.deepEqual(diags({ 's.duramen': S('section S A title\n') }), ['s.duramen:3: error P005']);
  assert.deepEqual(diags({ 's.duramen': S('section S "A title" and more\n') }), ['s.duramen:3: error P005']);
  assert.deepEqual(diags({ 's.duramen': S('section S\n') }), ['s.duramen:3: error P005']);
  assert.deepEqual(
    diags({ 's.duramen': S('section S "unclosed\nsection T "A" "B"\nsection U "\n') }),
    ['s.duramen:3: error P005', 's.duramen:4: error P004', 's.duramen:5: error P005'],
  );
  assert.deepEqual(diags({ 's.duramen': S('section S "A \\q title"\n') }), ['s.duramen:3: error P004']);
  assert.deepEqual(diags({ 's.duramen': S('section S "A "quoted" title"\n') }), ['s.duramen:3: error P004']);
  assert.deepEqual(diags({ 's.duramen': S('  title A title\n') }), ['s.duramen:3: error P004']);
  assert.deepEqual(diags({ 's.duramen': S('section S-1.x "A \\"quoted\\" title, é and all"\n') }), []);
});

test('REQ-SY-007: operations', () => {
  assert.deepEqual(diags({ 's.duramen': S('op f g\n') }), ['s.duramen:3: error P031']);
  assert.deepEqual(diags({ 's.duramen': S('op\n') }), ['s.duramen:3: error P031']);
  assert.deepEqual(
    diags({
      's.duramen': S(
        'op f\n  input a number, b? {x: number, y: string}, c "one, two" | [1, 2], d-e (f, g)\n  result the sum\n  tolerance result.sum 0.005\n  tolerance result.count 0\n  audit text\n  request {}\n',
      ),
    }),
    [],
  );
  assert.deepEqual(
    diags({
      's.duramen': S(
        "op f\n  input a\n  input a.b number\n  input b?number\n  input\n  input c number, , d number,\n  input e 'x, y'\n  input c number\n  input é number\nop g\n  audit json\nop\n  input x\n  tolerance result.y\n",
      ),
    }),
    [
      's.duramen:4: error P017',
      's.duramen:5: error P017',
      's.duramen:6: error P017',
      's.duramen:7: error P017',
      's.duramen:8: error P017',
      's.duramen:8: error P017',
      's.duramen:9: error P017',
      's.duramen:10: error P052',
      's.duramen:11: error P017',
      's.duramen:13: error P050',
      's.duramen:14: error P031',
      's.duramen:15: error P017',
      's.duramen:16: error P018',
    ],
  );
  assert.deepEqual(
    diags({ 's.duramen': S('op f\n  tolerance result.x\n  tolerance result.x -1\n  tolerance result.x 0x10\n  tolerance result.x 1 2\n  tolerance result.x 1e-3\n') }),
    ['s.duramen:4: error P018', 's.duramen:5: error P018', 's.duramen:6: error P018', 's.duramen:7: error P018'],
  );
  assert.deepEqual(
    diags({
      's.duramen': S('op f\n  request 5\nop g\n  request {"input": 5}\nop h\n  tolerance result.x 1\n  tolerance result.y 1\n  tolerance result.x 2\n'),
    }),
    ['s.duramen:4: error P009', 's.duramen:6: error P051', 's.duramen:10: error P052'],
  );
});

test('REQ-SY-008: the errors list', () => {
  assert.deepEqual(
    diags({
      's.duramen': S('errors\n  bad_input when the input is not an object, or\n    when it lacks a field\n  not_found when there is no such thing\n'),
    }),
    [],
  );
  assert.deepEqual(diags({ 's.duramen': S('errors first\n  e when x\n') }), ['s.duramen:3: error P050']);
  assert.deepEqual(
    diags({
      's.duramen': S('errors\n  e if x\n  e when\n    the input is bad\n  when x\n  f when y\n   and z\n  g is\n   wrong\n'),
    }),
    ['s.duramen:4: error P019', 's.duramen:5: error P019', 's.duramen:7: error P019', 's.duramen:9: error P006', 's.duramen:10: error P019', 's.duramen:11: error P006'],
  );
  assert.deepEqual(diags({ 's.duramen': S('errors\n  e when x\n    # It MUST be read.\n') }), ['s.duramen:4: error T004']);
});

test('REQ-SY-009: req, open, decision, section, note', () => {
  assert.deepEqual(
    diags({
      's.duramen': S(
        'section S "Things"\n  text\n    About things.\nnote\n  text\n    A note.\nopen S-1 "Unsaid"\n  text\n    Left open.\ndecision D-1 "Why"\n  source the author\n  status accepted\n  text\n    Because.\n  rejected "Another way, because no."\n  rejected "A third way."\n',
      ),
    }),
    ['s.duramen:12: warning T012'],
  );
  assert.deepEqual(
    diags({
      's.duramen': S(
        'req A "a"\n  on mac\n  status accepted\n  example f {}\nnote x\nsection S "s"\n  example f {}\ndecision D "d"\n  title "x"\nopen O "o"\n  decision D\n',
      ),
    }),
    ['s.duramen:4: error P033', 's.duramen:5: error P015', 's.duramen:7: error P050', 's.duramen:9: error P015', 's.duramen:11: error P015', 's.duramen:13: error P015'],
  );
});

test('REQ-SY-010: examples (1)', () => {
  assert.deepEqual(
    diags({
      's.duramen': S('req A "a"\n  example\n  example f [1]\n  example f {"x": 1\n  example f 2\n  example raw "{\\"id\\": \\"1\\",\\n\\"op\\": \\"f\\"}"\n'),
    }),
    ['s.duramen:4: error P012', 's.duramen:5: error P012', 's.duramen:6: error P009', 's.duramen:7: error P012', 's.duramen:8: error P026'],
  );
  assert.deepEqual(
    diags({
      's.duramen': S(
        'req A "a"\n  example raw\n  example raw {"id": "x"}\n  example raw "unclosed\n  example raw "a" "b"\n  example raw "carriage\\rreturn"\n  example f [1]\n    expect result\n     expect result = 1\n    expect result ≈ 1\n    expect result~1+-0.5\n    expect result="~"\n    expect result =\n    expect = 1\n    request {"a": 1}\n    request {"b": 1}\n    omit\n    omit a, b c\n    omit d\n',
      ),
    }),
    [
      's.duramen:4: error P004',
      's.duramen:5: error P004',
      's.duramen:6: error P004',
      's.duramen:7: error P004',
      's.duramen:8: error P026',
      's.duramen:9: error P012',
      's.duramen:10: error P011',
      's.duramen:11: error P006',
      's.duramen:12: error P010',
      's.duramen:15: error P009',
      's.duramen:16: error P011',
      's.duramen:18: error P052',
      's.duramen:19: error P011',
    ],
  );
});

test('REQ-SY-010: examples (2)', () => {
  assert.deepEqual(
    diags({
      's.duramen': S("req A \"a\"\n  example raw '{\"id\": \"x\"}'\n    omit\n    request\n    input\n  example f {}\n    request\n    input\n    omit ,\n"),
    }),
    ['s.duramen:5: error P022', 's.duramen:6: error P022', 's.duramen:7: error P022', 's.duramen:9: error P009', 's.duramen:10: error P049', 's.duramen:11: error P011'],
  );
  assert.deepEqual(
    diags({
      's.duramen': S(
        "req A \"a\"\n  example f {}\n    expect result ≈ 1 ± -1\n    expect result ~ 1 +- x\n    expect result ≈ 0x10 ± 1\n    expect result = {nope}\n    expect result\n    result = 1\n     expect result = 1\n      expect result = 1\n    request [1]\n    request {\"input\": {}}\n  example raw '{\"id\": \"x\"}'\n    omit id\n    request {\"a\": 1}\n    input files.\"a\"\n      text\n",
      ),
    }),
    [
      's.duramen:5: error P010',
      's.duramen:6: error P010',
      's.duramen:7: error P010',
      's.duramen:8: error P009',
      's.duramen:9: error P011',
      's.duramen:10: error P011',
      's.duramen:11: error P006',
      's.duramen:12: error P006',
      's.duramen:13: error P009',
      's.duramen:14: error P051',
      's.duramen:16: error P022',
      's.duramen:17: error P022',
      's.duramen:18: error P022',
    ],
  );
});

test('REQ-SY-011: texts in an example input', () => {
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': S(
          'oracle node echo.mjs\nop f\n  input files object, n? number\nreq A "a"\n  example f {"n": 1}\n    input files."a b"\n      one\n        two\n\n    input files.x\n      three\n\n\n    expect result = {"n": 1, "files": {"a b": "one\\n  two\\n", "x": "three\\n"}}\n',
        ),
      }),
    ),
    [],
  );
  assert.deepEqual(
    diags({
      's.duramen': S('req A "a"\n  example f {"x": 1}\n    input files.\n    input files.."a"\n    input "a\n    input x.y\n      text\n    input z\n    input y from "missing.txt"\n'),
    }),
    ['s.duramen:5: error P049', 's.duramen:6: error P049', 's.duramen:7: error P049', 's.duramen:8: error P049', 's.duramen:10: error P049', 's.duramen:11: error P048'],
  );
  assert.deepEqual(
    diags({ 's.duramen': S('req A "a"\n  example f {}\n    input a\n     not six\n      six, but after the line that ended the text\n') }),
    ['s.duramen:5: error P049', 's.duramen:6: error P006', 's.duramen:7: error P006'],
  );
  assert.deepEqual(
    diags(
      {
        'r/s.duramen': S(
          'req A "a"\n  example f {}\n    input a from "../outside.txt"\n    input b from "t.txt"\n      not its text\n    input c from "unclosed\n  example f {\n    input d from "../outside.txt"\n',
        ),
        'r/t.txt': 't\n',
        'outside.txt': 'x',
      },
      'r',
    ),
    ['r/s.duramen:5: error P048', 'r/s.duramen:7: error P006', 'r/s.duramen:8: error P049', 'r/s.duramen:9: error P009', 'r/s.duramen:10: error P048'],
  );
  assert.deepEqual(
    diags({
      'sub/data/t.txt': 'hello,\r\nworld',
      'sub/s.duramen': S('oracle node echo.mjs\nop f\n  input t? string\nreq A "a"\n  example f {}\n    input t from "data/t.txt"\n    expect result = {"t": "hello,\\r\\nworld"}\n'),
      'sub/echo.mjs': ECHO,
    }),
    [],
  );
});

test('REQ-SY-012: tables', () => {
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': S(
          'oracle node echo.mjs\nop f\n  input x? json, y? json\nreq A "a"\n  table f\n    | x        | y | result.x | result.y ± 0.5 |\n    |----------|---|:--------:|----------------|\n    | "a\\|b"   |   | "a\\|b"   |                |\n    | 1        | 2 | ?        | 2.4            |\n',
        ),
      }),
    ),
    [],
  );
  assert.deepEqual(
    diags({
      's.duramen': S(
        'req A "a"\n  table f\n  table f g\n    | x |\n    | 1 |\n  table f\n    | x |\n  table f\n    | x | result ± -1 |\n    | 1 | 2           |\n  table f\n    | x | result ± 0.5 |\n    | 1 | "2"          |\n  table f\n    | x | y |\n    | 1 |\n    | {  | 2 |\n    x | 1\n  table f\n    | x | |\n    | 1 | 2 |\n  table f\n    | x ± 1 |\n    | 1     |\n',
      ),
    }),
    [
      's.duramen:4: error P013',
      's.duramen:5: error P013',
      's.duramen:8: error P013',
      's.duramen:11: error P010',
      's.duramen:15: error P010',
      's.duramen:18: error P014',
      's.duramen:19: error P009',
      's.duramen:20: error P006',
      's.duramen:22: error P013',
      's.duramen:25: error P010',
    ],
  );
  assert.deepEqual(
    diags({
      's.duramen': S(
        'req A "a"\n  table f g\n    | x |\n    | {bad |\n  table f\n   | x |\n    | 1 |\n  table f\n    | a.b | result |\n    | 1   | 2      |\n  table f\n    | x | result ± lots |\n    | 1 | "two"         |\n  table f\n    | x | result ± 1 2 | result.y+-0.5 |\n    | 1 | 2            | 3             |\n  table f\n    | x | x |\n    | 1 | 2 |\n  table f\n    | x | result ± 0.5 |\n    | 1 | 2.25 [       |\n    | { | ?            |\n',
      ),
    }),
    [
      's.duramen:4: error P013',
      's.duramen:7: error P013',
      's.duramen:8: error P006',
      's.duramen:11: error P013',
      's.duramen:14: error P010',
      's.duramen:17: error P010',
      's.duramen:20: error P013',
      's.duramen:24: error P010',
      's.duramen:25: error P009',
    ],
  );
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': S('oracle node echo.mjs\nop f\n  input x? json\nreq A "a"\n  table f\n    |---|----------|\n    | x | result.x |\n    |   |\n    | 1 | 1\n    |\n    | 2 | 2        |\n'),
      }),
    ),
    [],
  );
});

// ---- REQ-CK

test('REQ-CK-001: every requirement has an example', () => {
  assert.deepEqual(diags({ 's.duramen': S('req A "a"\n  text\n    It MUST work.\n') }), ['s.duramen:3: error T001']);
  assert.deepEqual(diags({ 's.duramen': S('req A "a"\n  table f\n    | x |\n    |---|\n') }), ['s.duramen:4: error P013']);
});

test('REQ-CK-002: IDs are unique', () => {
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': S(
          'oracle node echo.mjs\nop f\n  input x? json\nreq A "a"\n  example f {}\nreq A "again"\n  example f {}\nopen A "an open item may share a requirement\'s ID"\n  text\n    Open.\nopen B "b"\n  text\n    Open.\nopen B "b again"\n  text\n    Open.\ndecision D-1 "d"\n  source s\ndecision D-1 "d again"\n  source s\nreq C "c"\n  decision D-1\n  example f {}\n',
        ),
      }),
    ),
    ['s.duramen:8: error T007', 's.duramen:16: error T007', 's.duramen:21: error T007'],
  );
  assert.deepEqual(
    diags(
      withEcho({
        'a.duramen': S('oracle node echo.mjs\nop f\n  input x? json\nreq A "a"\n  example f {}\n'),
        'b.duramen': 'duramen 0.1\nreq A "a"\n  example f {}\nop f\n  input y? json\n',
      }),
    ),
    ['b.duramen:2: error T007', 'b.duramen:4: error T007'],
  );
});

test('REQ-CK-003: cited decisions are declared', () => {
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': S(OPF.replace('x? json\n', 'x? json\ndecision D-1 "d"\n  source s\nreq A "a"\n  decision D-1 D-2, D-3\n  decision D-2\n  example f {}\n')),
      }),
    ),
    ['s.duramen:8: error T008', 's.duramen:8: error T008'],
  );
});

test('REQ-CK-004: examples of declared operations', () => {
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': S(
          'oracle node echo.mjs\nop f\n  input a number, b? number\nerrors\n  e when never\nreq A "a"\n  example g {"a": 1}\n  example f {"b": 1}\n  example f {"a": 1, "c": 2}\n  example f\n  example g {"answer": {"error": "e"}}\n    expect error = "e"\n  example raw \'{"id": "A#6", "op": "g"}\'\n  table f\n    | b | c |\n    | 1 | 2 |\n  example g {}\n    expect error.code = "e"\n',
        ),
      }),
    ),
    ['s.duramen:9: error T009', 's.duramen:10: error T010', 's.duramen:11: warning T011', 's.duramen:12: error T010', 's.duramen:18: error T010', 's.duramen:18: warning T011', 's.duramen:19: error T009'],
  );
});

test('REQ-CK-005: expected errors are declared', () => {
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': S(
          'oracle node echo.mjs\nop f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n  example f {"answer": {"error": "e"}}\n    expect error = "e"\n  example f {"answer": {"error": "nope"}}\n    expect error = "nope"\n  example raw \'{"id": "r", "op": "f", "input": {"answer": {"error": "other"}}}\'\n    expect error = "other"\n  example f {"answer": {"error": "e"}}\n    expect error = ?\n',
        ),
      }),
    ),
    ['s.duramen:12: error T023', 's.duramen:14: error T023'],
  );
});

test('REQ-CK-006: obligations live in requirements', () => {
  assert.deepEqual(
    diags({
      's.duramen': S(
        '  text\n    The program MUST work.\nop f\n  result what it MUST return\nerrors\n  e when it SHALL fail\nsection S "It MUST be titled"\n  text\n    REQUIRED reading.\nnote\n  text\n    This note says `MUST`, "SHALL" and “REQUIRED”, MUSTARD and must.\ndecision D-1 "d"\n  source s\n  text\n    Fine.\n  rejected "Another MUST."\nopen O "o"\n  text\n    It MUST NOT be.\n',
      ),
    }),
    ['s.duramen:2: error T004', 's.duramen:5: error T004', 's.duramen:8: error T004', 's.duramen:9: error T004', 's.duramen:15: error T004', 's.duramen:15: warning T012', 's.duramen:20: warning T014'],
  );
  assert.deepEqual(
    diags({ 's.duramen': S('decision D-1 "d"\n  source s\n  text\n    It MUST.\n  rejected "It SHALL."\n  rejected "It is REQUIRED."\n') }),
    ['s.duramen:3: error T004', 's.duramen:3: error T004', 's.duramen:3: error T004', 's.duramen:3: warning T012'],
  );
  assert.deepEqual(
    diags({ 's.duramen': S('errors\n  e when the "MUST\n    hold" rule fails\n  f when the "MUST hold" rule fails\nnote\n  text\n    A MUST-have.\nsection S "s"\n  text\n    MUSTé\n') }),
    ['s.duramen:4: error T004', 's.duramen:7: error T004', 's.duramen:10: error T004'],
  );
});

test('REQ-CK-007: open items are not tested', () => {
  assert.deepEqual(
    diags({ 's.duramen': S('open O "o"\n  example f {}\n  table f\n    | x |\n    | 1 |\n  example f {not json\n    expect nothing at all\n  table g h\n    | {bad |\n') }),
    ['s.duramen:4: error T003', 's.duramen:5: error T003', 's.duramen:8: error T003', 's.duramen:10: error T003'],
  );
});

test('REQ-CK-008: the order of errors is stated once', () => {
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': S(
          'oracle node echo.mjs\nop f\n  input x? json\nerrors\n  too_big when x > 9\n  too_small when x < 0\nreq A "a"\n  text\n    A request that is too_big gets too_big, and one too_small gets too_small.\n  example f {}\nreq B "b"\n  text\n    too_big is checked Before too_small.\n  example f {}\nreq C "c"\n  text\n    too_big is checked first.\n    After that, nothing.\n  example f {}\nreq D "d"\n  text\n    too_big and too_small are checked in this\n    order.\n  example f {}\n',
        ),
      }),
    ),
    ['s.duramen:14: error T005', 's.duramen:23: error T005'],
  );
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': S(
          'oracle node echo.mjs\nop f\n  input x? json\nerrors\n  e when x\n  f when y\nreq A "a"\n  text\n    A request may be refused before it is read: see the errors list.\n  example f {}\n',
        ),
      }),
    ),
    [],
  );
});

test('REQ-CK-009: decisions', () => {
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': S(
          OPF +
            'decision D-1 "uncited, no source"\ndecision D-2 "bad status"\n  source s\n  status Accepted\ndecision D-3 "superseded by nothing"\n  source s\n  status superseded\ndecision D-4 "superseded by an undeclared one"\n  source s\n  status superseded by D-9\ndecision D-5 "superseded properly"\n  source s\n  status superseded by D-6\ndecision D-6 "accepted, with more words"\n  source s\n  status accepted on 2026-01-01\ndecision D-7 "observed"\n  source s\n  status observed\nreq A "a"\n  decision D-2, D-3, D-4, D-5, D-6, D-7\n  example f {}\n',
        ),
      }),
    ),
    [
      's.duramen:6: warning T012',
      's.duramen:6: warning T013',
      's.duramen:7: error T027',
      's.duramen:10: error T027',
      's.duramen:13: error T027',
      's.duramen:25: error T028',
      's.duramen:25: error T028',
      's.duramen:25: error T028',
      's.duramen:25: warning T028',
    ],
  );
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': S(
          OPF + 'decision D-1 "a comma after the word"\n  source s\n  status accepted, 2026-01-01\ndecision D-2 "an empty status"\n  source\n  status\nreq A "a"\n  decision D-1, D-2\n  example f {}\n',
        ),
      }),
    ),
    ['s.duramen:6: error T027', 's.duramen:9: warning T013', 's.duramen:9: error T027'],
  );
});

// ---- REQ-OR

test('REQ-OR-001: a record with examples has an oracle', () => {
  assert.deepEqual(diags({ 's.duramen': S('op f\n  input x? json\nreq A "a"\n  example f {}\n    expect result = 1\n') }), ['s.duramen:2: error T019']);
  assert.deepEqual(
    diags({ 's.duramen': S('op f\n  input x? json\nreq A "a"\n  text\n    No example.\nreq B "b"\n  example f {}\n') }),
    ['s.duramen:2: error T019', 's.duramen:5: error T001'],
  );
});

test('REQ-OR-002: how the oracle is run', () => {
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': 'duramen 0.1\nspec s 1\n  request {"clock": 1}\noracle node echo.mjs\nop f\n  input line? boolean, x? json\nreq A "a"\n  example f {"line": true,  "x": 2.50}\n    expect result = "{\\"id\\":\\"A#1\\",\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true,  \\"x\\": 2.50}}"\n  example f {"line": true}\n    omit id\n    expect result = "{\\"op\\":\\"f\\",\\"clock\\":1,\\"input\\":{\\"line\\": true}}"\n  example raw \'{"id": "x",  "op": "f", "input": {"line": true}}\'\n    expect id = "x"\n    expect result = "{\\"id\\": \\"x\\",  \\"op\\": \\"f\\",  \\"input\\": {\\"line\\": true}}"\n'.replace('\\"f\\",  \\"input', '\\"f\\", \\"input'),
      }),
    ),
    [],
  );
  assert.deepEqual(
    diags({
      'sub/s.duramen': S('oracle node "my echo.mjs"\nop f\n  input x? json\nreq A "a"\n  example f {"x": 1}\n    expect result.x = 1\n'),
      'sub/my echo.mjs': ECHO,
    }),
    [],
  );
  assert.deepEqual(
    diags(withEcho({ 's.duramen': S(OPF + 'req A "a"\n  text\n    No example.\nreq B "b"\n  example f {"x": 1}\n    expect result.x = 2\n') })),
    ['s.duramen:6: error T001', 's.duramen:11: error T002'],
  );
});

test('REQ-OR-003: examples the oracle disagrees with', () => {
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': S(
          'oracle node echo.mjs\nop f\n  input x? json, y? json, answer? json\nreq A "a"\n  example f {"x": 1.0, "y": [5, {"z": null}]}\n    expect result = {"y": [5, {"z": null}], "x": 1}\n    expect result.y.1.z = null\n    expect result.y.0 ≈ 5.5 ± 0.5\n    expect result.x = 2\n    expect result.y.2 = 5\n    expect result.y.0 ≈ 5.5 ± 0.4\n    expect result.y.1 = {}\n  example f {"answer": {"result": 0, "audit": "{\\"a\\": [1, 2]}"}}\n    expect audit.a.1 = 2\n    expect audit = "{\\"a\\": [1, 2]}"\n    expect audit.b = 1\n  table f\n    | x | result.x | result.y |\n    | 1 | 2        | 3        |\n  example f {"x": {"": 1}}\n    expect result.x. = 1\n    expect result..x = 1\n  example f {"y": [7, 8]}\n    expect result.y.1 = 8\n    expect result.y.length = 2\n    expect result.y.01 = 8\n',
        ),
      }),
    ),
    ['s.duramen:11: error T002', 's.duramen:12: error T002', 's.duramen:13: error T002', 's.duramen:14: error T002', 's.duramen:18: error T002', 's.duramen:21: error T002', 's.duramen:21: error T002', 's.duramen:24: error T002', 's.duramen:27: error T002', 's.duramen:28: error T002'],
  );
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': S(
          'oracle node echo.mjs\nop f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n  example f {"answer": {"result": 1}}\n    expect error = "e"\n  example g {"answer": {"error": "e"}}\n    expect error = "e"\n',
        ),
      }),
    ),
    ['s.duramen:10: error T002'],
  );
});

test('REQ-OR-004: an oracle that fails', () => {
  assert.deepEqual(
    diags({ 's.duramen': S('oracle no-such-program-for-duramen\nop f\n  input x? json\nreq A "a"\n  example f {}\n') }),
    ['s.duramen:3: error T020', 's.duramen:7: error T021'],
  );
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': S('oracle node echo.mjs\nop f\n  input x? json, exit? integer\nreq A "a"\n  example f {"x": 1}\n    expect result.x = 2\n  example f {"exit": 3}\n    expect result.exit = 3\n'),
      }),
    ),
    ['s.duramen:3: error T020', 's.duramen:8: error T002'],
  );
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': S('oracle node echo.mjs\nop f\n  input exit? integer\nreq A "a"\n  example f {}\n  example raw \'{"id": "r", "op": "f", "input": {"exit": 4}}\'\n'),
      }),
    ),
    ['s.duramen:8: error T020'],
  );
  assert.deepEqual(
    diags({ 's.duramen': S('oracle no-such-program-for-duramen\nop f\n  input x? json\nreq A "a"\n  example raw \'{"id": "r", "op": "f"}\'\n') }),
    ['s.duramen:7: error T020', 's.duramen:7: error T021'],
  );
  assert.deepEqual(
    diags(withEcho({ 's.duramen': S('oracle node "echo.mjs\nop f\n  input x? json\nreq A "a"\n  example f {}\n') })),
    ['s.duramen:3: error T020', 's.duramen:7: error T021'],
  );
});

test('REQ-OR-005: examples with no answer', () => {
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': S('oracle node echo.mjs\nop f\n  input silent? boolean\nreq A "a"\n  example f {"silent": true}\n  example f {}\n  example raw \'{"id": "r", "op": "f", "input": {"silent": true}}\'\n'),
      }),
    ),
    ['s.duramen:7: error T021', 's.duramen:9: error T021'],
  );
});

test('REQ-OR-006: examples the oracle cannot compute', () => {
  assert.deepEqual(
    diags(
      withEcho({
        's.duramen': S('oracle node echo.mjs\nop f\n  input answer? json\nreq A "a"\n  example f {"answer": {"oracle_error": "left open"}}\n    expect result = 1\n    expect result = ?\n'),
      }),
    ),
    ['s.duramen:7: error T022'],
  );
});

test('REQ-OR-007: errors nobody expected', () => {
  const r = handle(
    JSON.stringify({
      id: 'q',
      op: 'check',
      input: {
        files: withEcho({
          's.duramen': S('oracle node echo.mjs\nop f\n  input answer? json\nerrors\n  e when never\nreq A "a"\n  example f {"answer": {"error": "e"}}\n  example f {"answer": {"error": "e"}}\n    expect error = "e"\n'),
        }),
      },
    }),
  ) as any;
  assert.deepEqual(r.result, { diagnostics: ['s.duramen:9: warning T024'], errors: 0, warnings: 1 });
});

test('REQ-OR-008: values taken from the oracle', () => {
  assert.deepEqual(
    diags(withEcho({ 's.duramen': S(OPF + 'req A "a"\n  example f {"x": 1}\n    expect result.x = ?\n    expect result.y = ?\n') })),
    ['s.duramen:9: error T025'],
  );
});

// ---- REQ-SU

test('REQ-SU-001: no suite from a record with errors', () => {
  assert.deepEqual(cases({ 's.duramen': 'frobnicate\n' }), { cases: [], errors: 3 });
  assert.deepEqual(cases({ 's.duramen': S('req A "a"\n  text\n    Nothing to show.\n') }), { cases: [], errors: 1 });
  const r = cases(withEcho({ 's.duramen': S(OPF + 'req A "a"\n  example f {"y": 1}\n') }));
  assert.equal(r.errors, 0);
  assert.equal(r.cases[0].id, 'A#1');
});

test('REQ-SU-002: one case per example', () => {
  assert.deepEqual(
    cases(withEcho({ 's.duramen': S(OPF + 'req A "a"\n  example f {"x": 1}\n    expect result.x = 1\nreq B "b"\n  on posix\n  table f\n    | x | result.x |\n    | 2 | 2        |\n    | 3 | ?        |\n') })),
    {
      cases: [
        { checks: [{ kind: 'eq', path: 'result.x', value: 1 }], full: { members: ['id', 'result'], result: { x: 1 }, tolerances: {} }, id: 'A#1', kind: 'example', line: '{"id":"A#1","op":"f","input":{"x": 1}}', platform: 'any', reqs: ['REQ-A'] },
        { checks: [{ kind: 'eq', path: 'result.x', value: 2 }], full: { members: ['id', 'result'], result: { x: 2 }, tolerances: {} }, id: 'B#1', kind: 'example', line: '{"id":"B#1","op":"f","input":{"x":2}}', platform: 'posix', reqs: ['REQ-B'] },
        { checks: [{ from: 'oracle', kind: 'eq', path: 'result.x', value: 3 }], full: { members: ['id', 'result'], result: { x: 3 }, tolerances: {} }, id: 'B#2', kind: 'example', line: '{"id":"B#2","op":"f","input":{"x":3}}', platform: 'posix', reqs: ['REQ-B'] },
      ],
      errors: 0,
    },
  );
  const r = cases(withEcho({
    'b.duramen': 'duramen 0.1\nreq B "b"\n  on windows\n  example f {}\n',
    'a.duramen': S(OPF + 'req A "a"\n  example f {}\n  example f {}\n'),
  }));
  assert.deepEqual(r.cases.map((c: any) => c.id), ['A#1', 'A#2', 'B#1']);
  assert.equal(r.cases[2].platform, 'windows');
});

test('REQ-SU-003: request lines', () => {
  const r = cases(withEcho({
    's.duramen': S(
      '  request {"clock": "c", "trace": true}\noracle node echo.mjs\nop f\n  input x? json\nop g\n  input x? json\n  request {"mode": 2}\nreq A "a"\n  example f {"x" : 2.50e0 }\n  example f\n  example f {"x": 1}\n    request {"trace": false, "user": "u"}\n    omit clock\n  example g {"x": 1}\n    omit id, input\n  example f {"x": 1}\n    omit op, id\n  example raw \'{"id": "A#6",  "op": "f"}\'\n  example f {"x": 1}\n    request {"b": {"z": 1, "10": 2, "9": 3}, "2": "two", "a": 1}\n    omit clock\n    omit trace\n  table f\n    | result |\n    | ?      |\n',
    ),
  }));
  assert.equal(r.errors, 0);
  assert.deepEqual(r.cases[0], { checks: [], full: { members: ['id', 'result'], result: { x: 2.5 }, tolerances: {} }, id: 'A#1', kind: 'example', line: '{"id":"A#1","op":"f","clock":"c","trace":true,"input":{"x" : 2.50e0 }}', platform: 'any', reqs: ['REQ-A'] });
  assert.equal(r.cases[1].line, '{"id":"A#2","op":"f","clock":"c","trace":true}');
  assert.equal(r.cases[2].line, '{"id":"A#3","op":"f","trace":false,"user":"u","input":{"x": 1}}');
  assert.deepEqual(r.cases[3], { checks: [], full: { members: ['id', 'result'], result: {}, tolerances: {} }, id: 'A#4', kind: 'example', line: '{"op":"g","mode":2}', platform: 'any', reqs: ['REQ-A'], solo: true });
  assert.equal(r.cases[4].line, '{"clock":"c","trace":true,"input":{"x": 1}}');
  assert.equal(r.cases[4].solo, true);
  assert.equal(r.cases[5].line, '{"id": "A#6",  "op": "f"}');
  assert.equal(r.cases[5].solo, true);
  assert.equal(r.cases[6].line, '{"id":"A#7","op":"f","2":"two","b":{"9":3,"10":2,"z":1},"a":1,"input":{"x": 1}}');
  assert.equal(r.cases[7].line, '{"id":"A#8","op":"f","clock":"c","trace":true,"input":{}}');

  const r2 = cases(withEcho({
    's.duramen': S(
      'oracle node echo.mjs\nop f\n  input files? object, n? number\nreq A "a"\n  example f {"n" : 1.50, "files": {"z": "old"}}\n    input files."a.duramen"\n      duramen 0.1\n      "quoted" é\n    input files.z\n      new\n  table f\n    | n      | files |\n    | 1.50   |       |\n    |        | {}    |\n',
    ),
  }));
  assert.equal(r2.cases[0].line, '{"id":"A#1","op":"f","input":{"n":1.5,"files":{"z":"new\\n","a.duramen":"duramen 0.1\\n\\"quoted\\" é\\n"}}}');
  assert.equal(r2.cases[1].line, '{"id":"A#2","op":"f","input":{"n":1.50}}');
  assert.equal(r2.cases[2].line, '{"id":"A#3","op":"f","input":{"files":{}}}');
});

test('REQ-SU-004: checks', () => {
  const r = cases(withEcho({
    's.duramen': S(OPF + 'req A "a"\n  example f {"x": {"y": [1, 2]}}\n    expect result.x.y.0 = 1\n    expect result.x.y.1 ~ 2.1 +- 0.25\n    expect result.x = ?\n    expect id = "A#1"\n  table f\n    | x | result.x ± 0.5 |\n    | 2 | 2.25           |\n'),
  }));
  assert.deepEqual(r.cases[0].checks, [
    { kind: 'eq', path: 'result.x.y.0', value: 1 },
    { kind: 'approx', path: 'result.x.y.1', tol: 0.25, value: 2.1 },
    { from: 'oracle', kind: 'eq', path: 'result.x', value: { y: [1, 2] } },
    { kind: 'eq', path: 'id', value: 'A#1' },
  ]);
  assert.deepEqual(r.cases[1].checks, [{ kind: 'approx', path: 'result.x', tol: 0.5, value: 2.25 }]);
});

test('REQ-SU-005: the whole answer', () => {
  const r = cases(withEcho({
    's.duramen': S(
      'oracle node echo.mjs\nop f\n  input answer? json\n  audit\n  tolerance result.t 0.5\n  tolerance result.u 0\nop g\n  input answer? json\nerrors\n  e when never\nreq A "a"\n  example f {"answer": {"result": {"t": 1}, "audit": "A"}}\n  example f {"answer": {"error": "e", "extra": 1}}\n    expect error = "e"\n  example g {"answer": {"result": 2, "audit": "B"}}\n  example h {"answer": {"error": "e"}}\n    expect error = "e"\n',
    ),
  }));
  assert.deepEqual(r.cases[0].full, { audit: 'A', members: ['audit', 'id', 'result'], result: { t: 1 }, tolerances: { 'result.t': 0.5, 'result.u': 0 } });
  assert.deepEqual(r.cases[1].full, { error: 'e', members: ['error', 'extra', 'id'], tolerances: { 'result.t': 0.5, 'result.u': 0 } });
  assert.deepEqual(r.cases[2].full, { members: ['audit', 'id', 'result'], result: 2, tolerances: {} });
  assert.deepEqual(r.cases[3].full, { error: 'e', members: ['error', 'id'], tolerances: {} });
});
