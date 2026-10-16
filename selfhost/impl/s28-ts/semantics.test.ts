import assert from 'node:assert/strict';
import test from 'node:test';
import { obligation } from './checker.ts';
import { check, checkedCodes, codes } from './test-support.ts';

test('REQ-CK-001: only requirements without examples get T001', () => {
  assert.deepEqual(checkedCodes('req Empty "empty"\nopen Open "open"\nsection S "s"'), ['T001']);
  assert.deepEqual(checkedCodes('oracle node model.mjs\nop f\nreq Rows "rows"\n  table f\n    | result |\n    | {} |'), []);
});

test('REQ-CK-002: uniqueness is per kind and the first operation governs every example', () => {
  const r = check('oracle node model.mjs\nop same\n  input a number\nop same\n  input b number\nreq ID "one"\n  example same {"a":1}\nreq ID "two"\n  example same {"b":1}\nopen ID "open"\nopen ID "duplicate"\ndecision ID "decision"\n  source here\ndecision ID "duplicate"\n  source here');
  assert.deepEqual(codes(r.model), ['T007', 'T007', 'T010', 'T011', 'T007', 'T012', 'T007', 'T012']);
});

test('REQ-CK-003: each missing cited decision is reported once per requirement', () => {
  const r = check('req R "r"\n  decision missing, missing other\n  decision missing\ndecision REQ-R "another kind"\n  source here');
  assert.equal(r.result.errors, 3);
  assert.equal(r.result.diagnostics.filter((d: string) => d.endsWith('T008')).length, 2);
});

test('REQ-CK-004: normal examples require operations and fields; error and raw examples bypass them', () => {
  const r = check('oracle node model.mjs\nop f\n  input required number, optional? string\nerrors\n  e when bad\nreq R "r"\n  example f {"extra":1}\n  example nonexistent {}\n  example nonexistent {"response":{"error":"e"}}\n    expect error = "e"\n  example raw \'{"input":{}}\'\n  table f\n    | optional |\n    | "yes" |\n  example nonexistent {}\n    expect error.code = ?');
  assert.deepEqual(codes(r.model), ['T010', 'T011', 'T009', 'T010', 'T009']);
  assert.equal(r.model.statements.find(s => s.key === 'req')!.examples.at(-1)?.response, undefined);
});

test('REQ-CK-005: error expectations require declared string codes, and oracle values name no code', () => {
  const r = check('oracle node model.mjs\nop f\n  input response? json\nerrors\n  known when refused\nreq R "r"\n  example f {"response":{"error":null}}\n    expect error = null\n  example f {"response":{"error":2}}\n    expect error ~ 2 +- 0\n  table f\n    | response | error |\n    | {"error":"unknown"} | "unknown" |\n    | {"error":"unknown"} | ? |');
  assert.equal(r.result.diagnostics.filter((d: string) => d.endsWith('T023')).length, 3);
  assert.equal(r.result.errors, 3);
});

test('REQ-CK-006: every checked text has one obligation diagnostic, with line-local quotation boundaries', () => {
  for (const text of ['MUST', 'SHALL NOT', 'REQUIRED', 'MUSTé', 'MUST-have', 'x`q`MUST', '"unfinished\rMUST"']) assert.equal(obligation(text), true, text);
  for (const text of ['must', 'MUSTARD', 'MUST_1', '1SHALL', '`MUST`', '“REQUIRED”', '"SHALL"', 'MU`x`ST']) assert.equal(obligation(text), false, text);
  const r = check('  text\n    MUST MUST REQUIRED\nop f\n  result SHALL return\nerrors\n  e when MUST fail\nsection S "MUST title"\n  text\n    REQUIRED\nnote\n  text\n    SHALL\nopen O "o"\n  text\n    MUST\ndecision D "d"\n  source here\n  text\n    MUST\n  rejected "SHALL"\n  rejected "REQUIRED"\nreq R "r"\n  text\n    MUST');
  assert.equal(r.result.diagnostics.filter((d: string) => d.endsWith('T004')).length, 8);
  assert.equal(r.result.diagnostics.filter((d: string) => d.endsWith('warning T014')).length, 1);
});

test('REQ-CK-007: open examples and tables are rejected without reading their malformed contents', () => {
  const r = check('open O "o"\n  example raw nope\n    invalid\n  table too many words\n    | bad |\n  example f {not json');
  assert.deepEqual(codes(r.model), ['T003', 'T003', 'T003']);
});

test('REQ-CK-008: order heuristics use distinct whole codes and whitespace-separated phrases', () => {
  for (const phrase of ['in this\n    order', 'IN THE ORDER', 'first that applies', 'first match', 'precede', 'precedes', 'preceded', 'before-hand', 'after', 'take precedence', 'takes precedence']) {
    const r = check('errors\n  e_1 when bad\n  e-2 when worse\nreq R "r"\n  text\n    e_1é e-2 ' + phrase);
    assert.ok(codes(r.model).includes('T005'), phrase);
  }
  assert.deepEqual(checkedCodes('errors\n  e when x\n  f when y\nreq R "r"\n  text\n    xe f_ e-x before'), ['T001']);
});

test('REQ-CK-009: decision lifecycle, source warnings, duplicate citations and first-declaration status', () => {
  const r = check('req R "r"\n  decision A A B C D E F G H I J\ndecision A "a"\n  source here\n  status observed\ndecision A "duplicate"\n  status rejected\ndecision B "b"\n  source here\n  status inferred\ndecision C "c"\n  source here\n  status proposed\ndecision D "d"\n  source here\n  status accepted extra words\ndecision E "e"\n  source here\n  status contested\ndecision F "f"\n  source here\n  status superseded by D\ndecision G "g"\n  source here\n  status rejected\ndecision H "h"\n  source here\n  status superseded  by D\ndecision I "i"\n  source here\n  status accepted,\ndecision J "j"\n  source\n  status\ndecision Uncited "u"\ndecision Uncited "u again"');
  const ds = r.model.diagnostics;
  assert.equal(ds.filter(d => d.code === 'T028' && d.level === 'warning').length, 3);
  assert.equal(ds.filter(d => d.code === 'T028' && d.level === 'error').length, 4);
  assert.equal(ds.filter(d => d.code === 'T027').length, 3);
  assert.equal(ds.filter(d => d.code === 'T012').length, 2);
  assert.equal(ds.filter(d => d.code === 'T013').length, 4);
  assert.equal(ds.filter(d => d.code === 'T007').length, 2);
});
