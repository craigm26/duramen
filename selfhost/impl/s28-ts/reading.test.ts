import assert from 'node:assert/strict';
import test from 'node:test';
import { handle, relativePath } from './core.ts';
import { parseRecord } from './parser.ts';
import { checkRecord } from './checker.ts';
import { codes, preamble, read } from './test-support.ts';

test('REQ-RQ-001: virtual paths are validated and diagnostics retain request names', () => {
  for (const path of ['a', 'aa:b', 'dir/a:b.duramen', 'é', '__proto__']) assert.equal(relativePath(path), true, path);
  for (const path of ['', '/x', 'a/', 'a//b', '.', '..', 'a/../b', 'a/./b', 'z:x', 'a\\b', 'x\0y']) assert.equal(relativePath(path), false, path);
  const files = { 'chosen/arbitrary.txt': preamble + 'unknown', 'bad.duramen': 'bad' };
  const response = handle({ id: 'r', op: 'check', input: { files, entry: 'chosen/arbitrary.txt' } });
  assert.deepEqual(response.result.diagnostics, ['chosen/arbitrary.txt:3: error P002']);
});

test('REQ-RQ-002: error precedence and exact response shapes', () => {
  for (const request of [null, [], 1, {}, { id: 3, op: 'nope' }]) assert.deepEqual(handle(request), { id: null, error: 'bad_request' });
  assert.deepEqual(handle({ id: 'x', op: 'nope', input: [] }), { id: 'x', error: 'unknown_op' });
  for (const input of [null, [], {}, { files: {} }, { files: { a: 1 } }, { files: { a: '', 'a/b': '' } }, { files: { a: '' }, entry: null }]) {
    assert.deepEqual(handle({ id: 'x', op: 'check', input }), { id: 'x', error: 'bad_request' });
  }
});

test('REQ-RC-001: folder selection, explicit file selection, exclusions and missing records', () => {
  const files = { 'r/a.duramen': preamble, 'r/sub/b.duramen': 'duramen 0.1', 'r/.x.duramen': 'bad', 'r/.h/a.duramen': 'bad', 'r/build/a.duramen': 'bad', 'r/sub/node_modules/a.duramen': 'bad', 'r/data.txt': 'bad', 'outside.duramen': 'bad' };
  assert.deepEqual(checkRecord(files, 'r').result.diagnostics, []);
  assert.deepEqual(codes(parseRecord(files, 'r/data.txt')), ['P002', 'P020', 'P021']);
  for (const entry of ['missing', 'r/sub/nope', 'r/.h/nothing']) assert.deepEqual(checkRecord(files, entry).result.diagnostics, [`${entry}:1: error P046`]);
  assert.deepEqual(checkRecord({ 'notes.txt': '' }).result.diagnostics, ['.:1: error P046']);
  assert.deepEqual(checkRecord({ '.hidden/a.duramen': preamble }, '.hidden').result.diagnostics, []);
});

test('REQ-RC-002: statements follow UTF-16 filename order and line order', () => {
  const r = parseRecord({ 'r/\uFFFE.duramen': preamble, 'r/😀.duramen': preamble, 'r/Z.duramen': preamble }, 'r');
  assert.equal(r.spec?.file, 'r/Z.duramen');
  assert.deepEqual(r.diagnostics.map(d => d.file), ['r/😀.duramen', 'r/\uFFFE.duramen']);
  assert.deepEqual(codes(read('spec other 2\nspec third 3')), ['P044', 'P044']);
});

test('REQ-RC-003: missing, invalid, repeated and mixed language versions', () => {
  assert.deepEqual(codes(parseRecord({ f: 'spec p 1' }, 'f')), ['P020']);
  for (const version of ['', '0.3', '0.1 extra']) assert.deepEqual(codes(parseRecord({ f: 'duramen ' + version + '\nspec p 1' }, 'f')), ['P023']);
  assert.deepEqual(codes(read('duramen 9\nduramen 0.2')), ['P023', 'P023']);
  assert.deepEqual(checkRecord({ 'a.duramen': preamble, 'b.duramen': 'duramen 0.2' }).result.diagnostics, ['.:1: error P047']);
  assert.deepEqual(codes(parseRecord({ 'a.duramen': 'duramen 9\nspec p 1', 'b.duramen': 'duramen 0.2' })), ['P023']);
});

test('REQ-RC-004: malformed first singletons count and duplicate bodies are parsed', () => {
  const r = read('oracle\noracle node model.mjs\n  invalid clause\nerrors broken\nerrors\n  bad if condition\nspec bad\n  request []');
  assert.equal(r.oracle?.command, '');
  assert.deepEqual(codes(r), ['P028', 'P044', 'P015', 'P050', 'P032', 'P019', 'P021', 'P044', 'P009']);
  assert.deepEqual(checkRecord({ 'a.duramen': 'duramen 0.1' }).result.diagnostics, ['.:1: error P021']);
});

test('REQ-RC-005: any reading error prevents all semantic and oracle diagnostics', () => {
  const result = checkRecord({ 'x.duramen': preamble + 'bad\nreq X "x"\n  example missing {}\n' }).result;
  assert.deepEqual(result, { diagnostics: ['x.duramen:3: error P002'], errors: 1, warnings: 0 });
});

test('REQ-RC-006: diagnostics retain duplicates, sort by code and level, and count levels', () => {
  const result = checkRecord({ 'z.duramen': 'duramen 0.1\nreq X "x"\n  decision D E\n', 'a.duramen': preamble + 'decision D "d"\n  status contested\ndecision E "e"\n  status proposed\n' }).result;
  assert.deepEqual(result, { diagnostics: ['a.duramen:3: warning T013', 'a.duramen:5: warning T013', 'z.duramen:2: error T001', 'z.duramen:2: error T028', 'z.duramen:2: warning T028'], errors: 2, warnings: 3 });
  const duplicate = checkRecord({ 's.duramen': preamble + 'req X "x"\n  decision absent1 absent2\n' }).result;
  assert.equal(duplicate.diagnostics.filter((s: string) => s.endsWith('T008')).length, 2);
});

test('REQ-SY-001: BOM, all whitespace, line endings, invalid indents and Unicode separators', () => {
  assert.deepEqual(codes(parseRecord({ f: '\uFEFFduramen 0.1\r\nspec p 1\rnote\n  text\n    é\u2028x\u2029y\t\n' }, 'f')), []);
  const white = ['\t', '\v', '\f', '\u00A0', '\u1680', '\u2000', '\u200A', '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF'];
  for (const w of white) {
    assert.deepEqual(codes(read(w + '\n' + ' ' + w + 'note\nnote\n  text\n    fine' + w)), ['P001']);
  }
  const r = read('section S "a\u2028b"');
  assert.equal(r.statements.at(-1)?.title, 'a\u2028b');
});

test('REQ-SY-002: unknown statement bodies are ignored and orphan lines are diagnosed', () => {
  const r = parseRecord({ f: '  before\n #before\n#comment\nduramen 0.1\nspec p 1\nunknown\n  request []\n    extra\nNote' }, 'f');
  assert.deepEqual(codes(r), ['P003', 'P003', 'P002', 'P002']);
});

test('REQ-SY-003: clause indentation, unknown bodies and once-only clauses', () => {
  assert.deepEqual(codes(read('note\n #one\n    #no clause\n  bogus\n    arbitrary\n  text\n    text\n  text bad\n    ignored')), ['P007', 'P006', 'P015', 'P052']);
  for (const [statement, clause] of [['spec other 1', 'title x'], ['op f', 'request []'], ['req A "a"', 'on bad'], ['decision D "d"', 'source'], ['section S "s"', 'text'], ['open O "o"', 'text'], ['note', 'text']]) {
    const r = read(statement + '\n  ' + clause + '\n  ' + clause + '\n    ignored');
    assert.equal(codes(r).at(-1), 'P052');
  }
  assert.deepEqual(codes(read('op f\n  audit\n    #comment\n    not a comment\n  audit text')), ['P006', 'P052']);
});

test('REQ-SY-004: statement forms and request member validation', () => {
  assert.deepEqual(codes(read('duramen 0.1\n  text\nspec too many words\noracle\n  source model.mjs\n    extra')), ['P023', 'P015', 'P021', 'P044', 'P028', 'P006']);
  for (const statement of ['', 'op f\n']) {
    for (const value of ['', 'null', '[]', '1', '{']) assert.ok(codes(read(statement + '  request ' + value)).includes('P009'));
    for (const key of ['id', 'op', 'input']) assert.ok(codes(read(statement + '  request {"' + key + '":null}')).includes('P051'));
  }
});

test('REQ-SY-005: text whitespace, comments and malformed text clauses', () => {
  const r = read('note\n  text\n\n    first\n      deeper\n\n    #text\n\n');
  assert.equal(r.statements.at(-1)?.text, 'first\n  deeper\n\n#text');
  assert.deepEqual(codes(read('note\n  text suffix\n   wrong')), ['P008', 'P008']);
});

test('REQ-SY-006: IDs and title framing have distinct JSON errors', () => {
  for (const title of ['', 'plain', '"', '"unclosed', '"fine" tail']) assert.deepEqual(codes(read('section id ' + title)), ['P005']);
  for (const title of ['"bad\\q"', '"one" "two"', '"a"b"']) assert.deepEqual(codes(read('section id ' + title)), ['P004']);
  assert.equal(read('section any:id "\\u00E9"').statements.at(-1)?.title, 'é');
  assert.deepEqual(codes(read('decision D "d"\n  rejected 3')), ['P004']);
});

test('REQ-SY-007: fields and tolerances claim names only when well formed', () => {
  const r = read('op work\n  input a? {x:1, y:2}, b "a\\\",b", c (x}, d x]\n  input a number, bad, , e type\n  tolerance p 0\n  tolerance p invalid\n  tolerance p 1\n  audit json');
  const op = r.statements.at(-1)!;
  assert.deepEqual([...op.fields], [['a', true], ['b', false], ['c', false], ['d', false], ['e', false]]);
  assert.deepEqual(codes(r), ['P052', 'P017', 'P017', 'P018', 'P052', 'P050']);
  assert.deepEqual(codes(read('op two words\n  input bad\n  tolerance bad')), ['P031', 'P017', 'P018']);
});

test('REQ-SY-008: error conditions continue, retain comments, and allow repeated codes', () => {
  const r = read('errors\n  e when first\n    #continuation\n  e when second\n  f if malformed\n   continuation');
  assert.equal(r.errors?.conditions[0].text, 'first\n#continuation');
  assert.deepEqual(codes(r), ['P019', 'P006']);
  assert.deepEqual(codes(read('errors extra')), ['P050']);
});

test('REQ-SY-009: platform forms and empty decision lists', () => {
  for (const platform of ['any', 'posix', 'windows']) {
    const r = read('req R "r"\n  on ' + platform + '\n  decision\n  decision D, E F');
    assert.deepEqual(codes(r), []);
    assert.equal(r.statements.at(-1)?.platform, platform);
    assert.deepEqual([...r.statements.at(-1)!.citations], ['D', 'E', 'F']);
  }
  assert.deepEqual(codes(read('req R "r"\n  on\nnote trailing')), ['P033', 'P050']);
});

test('REQ-SY-010: malformed examples still read their bodies and raw restrictions take precedence', () => {
  const r = read('req R "r"\n  example f []\n    expect result =\n    input x.y\n      data\n    input x.y.z\n      more\n  example raw \'bad\'\n    request []\n    omit\n    input bad.path\n      skipped\n    input x from "missing"\n      no text');
  assert.deepEqual(codes(r), ['P012', 'P009', 'P049', 'P022', 'P022', 'P022', 'P022', 'P006']);
  assert.deepEqual(codes(read('req R "r"\n  example raw "a\\nb"\n  example raw plain\n  example\n  example f null\n  example f nope')), ['P026', 'P004', 'P012', 'P012', 'P009']);
  const requests = read('req R "r"\n  example f\n    request []\n    request {}\n    request {"id":1}\n    omit ,\n    something\n     expect result = 1\n    expect x~1+-0\n    expect x≈1±-1');
  assert.deepEqual(codes(requests), ['P009', 'P052', 'P011', 'P011', 'P006', 'P010']);
});

test('REQ-SY-011: text blocks, quoted paths, from grammar and diagnostic precedence', () => {
  const r = read('req R "r"\n  example f {"num":1}\n    input files."a.b"\n\n      start\n#ignored\n  #ignored\n \tignored\n      end\n\n    input files."a.b" from "d/../t.txt/"\n    input x..y from "missing"\n    input num.deep from "missing"\n    input num.deep from "t.txt"\n    input empty\n    input q from"t.txt"\n    input q from "\\q"\n      block', { 't.txt': '\uFEFFa\r\nb' });
  assert.deepEqual(codes(r), ['P001', 'P049', 'P048', 'P049', 'P049', 'P049', 'P049']);
  assert.equal(r.statements.at(-1)?.examples[0].input.files['a.b'], '\uFEFFa\r\nb');
  const text = read('req R "r"\n  example f\n    input a\n\n      first\n      #literal\n\n    expect result = ?').statements.at(-1)!.examples[0].input.a;
  assert.equal(text, '\nfirst\n#literal\n');
  const outside = parseRecord({ 'r/s.duramen': preamble + 'req R "r"\n  example f {}\n    input a from "../r/t.txt"\n    input b from "../t.txt"\n', 'r/t.txt': 'yes', 't.txt': 'no' }, 'r');
  assert.deepEqual(codes(outside), ['P048']);
  assert.equal(outside.statements.at(-1)?.examples[0].input.a, 'yes');
});

test('REQ-SY-012: table error precedence, separator rows, escaped pipes and tolerance cells', () => {
  assert.deepEqual(codes(read('req R "r"\n  table f g\n    nonrow\n    | x |\n    | bad |')), ['P006', 'P013']);
  assert.deepEqual(codes(read('req R "r"\n  table f\n    | x ± 1 | bad! | result ± bad |\n    | nope | nope | nope |')), ['P010', 'P013']);
  assert.deepEqual(codes(read('req R "r"\n  table f\n    | x | result ± -1 |\n    | 1 | "accepted JSON" |\n    | 2 |\n    | { | bad |')), ['P010', 'P014', 'P009', 'P009']);
  const r = read('req R "r"\n  table f\n    | - | : |\n    | x | result.=~ |\n    | "a\\|b" | ?\n    |\n    | 2 | 2 |');
  assert.deepEqual(codes(r), []);
  assert.equal(r.statements.at(-1)?.examples[0].input.x, 'a|b');
  assert.equal(r.statements.at(-1)?.examples[0].expectations[0].path, 'result.=~');
  assert.deepEqual(codes(read('req R "r"\n  table f\n    | result | result |\n    | 1 | 1 |')), ['P013']);
});

test('REQ-SY-013: nonfinite JSON wins over object and reserved-member errors', () => {
  assert.deepEqual(codes(read('  request {"id":1e999}\nreq R "r"\n  example f 1e400\n  example f [1e400]\n  example f {}\n    expect result = {"x":-1e400}\n    expect result≈1e400±0\n    request {"input":1e400}\nop f\n  tolerance p 1e400')), ['P009', 'P009', 'P009', 'P009', 'P010', 'P009', 'P018']);
  assert.deepEqual(codes(read('req R "r"\n  example raw \'{"x":1e999}\'')), []);
});
