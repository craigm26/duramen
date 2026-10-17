import assert from 'node:assert/strict';
import test from 'node:test';
import { checkRecord } from './checker.ts';
import { commandWords } from './oracle.ts';
import { check, checkedCodes, codes, oracleSource, preamble } from './test-support.ts';
import { judge } from './comparison.ts';

test('REQ-OR-001: examples need an oracle even when other semantic errors exist', () => {
  assert.deepEqual(checkedCodes('op f\nreq Empty "empty"\nreq R "r"\n  example f {}'), ['T019', 'T001']);
  assert.deepEqual(checkedCodes('oracle no-such-program\nop f'), []);
});

test('REQ-OR-002: command words join quoted parts and preserve every other backslash', () => {
  assert.deepEqual(commandWords('node\t"a b"\'c d\' "" \'\' "x\\\"y" "a\\qb" c\\d'), ['node', 'a bc d', '', '', 'x"y', 'a\\qb', 'c\\d']);
  assert.equal(commandWords('node "open'), undefined);
  assert.equal(commandWords("node 'open"), undefined);
});

test('REQ-OR-002: oracle cwd, input order, matching by id, and solo isolation', () => {
  const model = `import {readFileSync} from 'node:fs';
import {basename} from 'node:path';
const lines=readFileSync(0,'utf8').split('\\n').filter(Boolean);
for(const line of lines.reverse()) {
const q=JSON.parse(line);
console.log(JSON.stringify({id:q.id??'different',result:{count:lines.length,cwd:basename(process.cwd()),input:q.input}}));
}`;
  const r = checkRecord({ 'nested/record.duramen': preamble + 'oracle node mo"del file".mjs\nop f\n  input n? number\nreq R "r"\n  example f {"n":1}\n  example raw \'{"input":{"n":2}}\'\n  example f {"n":3}\n    omit id\n  example f {"n":4}\n', 'nested/model file.mjs': model });
  assert.deepEqual(r.result.diagnostics, []);
  assert.deepEqual(r.cases.map(c => c.full.result), [
    { count: 2, cwd: 'nested', input: { n: 1 } }, { count: 1, cwd: 'nested', input: { n: 2 } },
    { count: 1, cwd: 'nested', input: { n: 3 } }, { count: 2, cwd: 'nested', input: { n: 4 } },
  ]);
  assert.deepEqual(r.cases.map(c => c.solo), [undefined, true, true, undefined]);
});

test('REQ-OR-002: normal responses ignore invalid IDs and nonfinite values; first valid duplicate wins', () => {
  const output = '\n \u2028\t\nnot json\n[]\n{"id":7}\n{"id":"R#1","result":1e400}\n{"id":"R#1","result":7}\n{"id":"R#1","result":8}\n{"id":"R#2","result":2}\r\n';
  const r = check('oracle node model.mjs\nop f\n  input say? string\nreq R "r"\n  example f ' + JSON.stringify({ say: output }) + '\n    expect result = 7\n  example f {}\n    expect result = 2');
  assert.deepEqual(r.result.diagnostics, []);
});

test('REQ-OR-002: raw UTF-8 replaces lone surrogates, and solo output must have exactly one object line', () => {
  const r = check('oracle node model.mjs\nop f\nreq R "r"\n  example raw ' + JSON.stringify('{"input":{"x":"\uD800"}}') + '\n    expect result.x = "�"\n  example raw \'{"input":{"say":"{\\"result\\":1}\\r{\\"result\\":2}"}}\'\n  example raw \'{"input":{"say":"{\\"result\\":1}\\nnull\\n"}}\'');
  assert.deepEqual(codes(r.model), ['T021', 'T021']);
});

test('REQ-OR-003: equality, absence, audit JSON and binary64 tolerance comparisons', () => {
  const r = check('oracle node model.mjs\nop f\n  input response json\nreq R "r"\n  example f {"response":{"result":{"x":1,"a":[4],"":null},"audit":"{\\"x\\":3}"}}\n    expect result = {"":null,"a":[4.0],"x":1.0}\n    expect result. = null\n    expect result.a.00 = 4\n    expect result.a.length = 1\n    expect result.missing = null\n    expect result.x = true\n    expect audit.x = 3\n    expect result.x ≈ 1.1 ± 0.1\n    expect result.x ≈ 1.1 ± 0.10000000000000009');
  assert.equal(r.result.errors, 5);
  assert.ok(r.model.diagnostics.every(d => d.code === 'T002'));
});

test('REQ-OR-004: failed startup and nonzero exit report failure and retain usable answers', () => {
  assert.deepEqual(checkedCodes('oracle command-that-does-not-exist-xyz\nop f\nreq R "r"\n  example f {}'), ['T020', 'T021']);
  assert.deepEqual(checkedCodes('oracle node model.mjs\nop f\n  input exit? number\nreq R "r"\n  example f {"exit":5}\n    expect result.exit = 5\n  example raw \'{"input":{"exit":6}}\''), ['T020', 'T020']);
  assert.deepEqual(checkedCodes('oracle node "unclosed\nop f\nreq R "r"\n  example f {}'), ['T020', 'T021']);
});

test('REQ-OR-004: a signal still permits responses emitted before termination', () => {
  const model = 'import {readFileSync} from "node:fs"; const q=JSON.parse(readFileSync(0,"utf8")); process.stdout.write(JSON.stringify({id:q.id,result:1})+"\\n"); process.kill(process.pid,"SIGTERM");';
  const r = check('oracle node killed.mjs\nop f\nreq R "r"\n  example f {}\n    expect result = 1', { 'killed.mjs': model });
  assert.deepEqual(codes(r.model), ['T020']);
});

test('REQ-OR-004: timeout stops a hung oracle and preserves its earlier response', () => {
  const model = 'import {readFileSync} from "node:fs"; const q=JSON.parse(readFileSync(0,"utf8")); process.stdout.write(JSON.stringify({id:q.id,result:1})+"\\n"); setInterval(()=>{},1000);';
  const r = check('oracle node hung.mjs\nop f\nreq R "r"\n  example f {}\n    expect result = 1', { 'hung.mjs': model });
  assert.deepEqual(codes(r.model), ['T020']);
});

test('REQ-RQ-001 / REQ-OR-002: the oracle receives the request files with their exact texts', () => {
  const text = '\uFEFFé\r\nline\rfinal';
  const model = 'import {readFileSync} from "node:fs"; const q=JSON.parse(readFileSync(0,"utf8")); console.log(JSON.stringify({id:q.id,result:readFileSync("data.txt","utf8")}));';
  const r = check('oracle node files.mjs\nop f\nreq R "r"\n  example f {}\n    expect result = ' + JSON.stringify(text), { 'data.txt': text, 'files.mjs': model });
  assert.deepEqual(r.result.diagnostics, []);
});

test('REQ-OR-005: absent, invalid and nonfinite answers are each no answer', () => {
  const r = check('oracle node model.mjs\nop f\n  input silent? boolean, say? string\nreq R "r"\n  example f {"silent":true}\n  example f {"say":"not-json\\n"}\n  example f {"say":"{\\"id\\":\\"R#3\\",\\"result\\":1e400}\\n"}\n  example f {}');
  assert.deepEqual(codes(r.model), ['T021', 'T021', 'T021']);
});

test('REQ-OR-006: oracle_error presence suppresses expectation checking and unexpected-error warnings', () => {
  const r = check('oracle node model.mjs\nop f\n  input response json\nreq R "r"\n  example f {"response":{"oracle_error":null,"error":"x"}}\n    expect result = 4\n    expect absent = ?\n  example f {"response":{"oracle_error":false,"error":null}}');
  assert.deepEqual(codes(r.model), ['T022', 'T022']);
});

test('REQ-OR-007: only zero-expectation error responses get T024, including null errors', () => {
  const r = check('oracle node model.mjs\nop f\n  input response json\nreq R "r"\n  example f {"response":{"error":null}}\n  example f {"response":{"error":"x"}}\n    expect id = "R#2"\n  table f\n    | response | id |\n    | {"error":"x"} | "R#3" |');
  assert.deepEqual(codes(r.model), ['T024']);
  assert.equal(r.result.warnings, 1);
  assert.equal(r.cases.length, 3);
});

test('REQ-OR-008: oracle expectations accept null and reject missing paths', () => {
  const r = check('oracle node model.mjs\nop f\n  input x? json\nreq R "r"\n  example f {"x":null}\n    expect result.x = ?\n    expect result.y = ?');
  assert.deepEqual(codes(r.model), ['T025']);
});

test('REQ-SU-001: errors suppress cases and warnings do not', () => {
  assert.deepEqual(check('req R "r"').cases, []);
  const r = check('oracle node model.mjs\nop f\nreq R "r"\n  example f {"unknown":1}');
  assert.equal(r.result.errors, 0);
  assert.equal(r.result.warnings, 1);
  assert.equal(r.cases.length, 1);
});

test('REQ-SU-002: cases preserve requirement/file/row order and platform metadata', () => {
  const r = checkRecord({ 'b.duramen': 'duramen 0.1\nreq B "b"\n  on windows\n  table f\n    | result |\n    | {} |\n', 'a.duramen': preamble + 'oracle node model.mjs\nop f\nreq A "a"\n  on posix\n  example f {}\n  table f\n    | result |\n    | ? |\n  example f {}', 'model.mjs': oracleSource });
  assert.deepEqual(r.result.diagnostics, []);
  assert.deepEqual(r.cases.map(c => [c.id, c.reqs, c.platform, c.kind]), [['A#1', ['REQ-A'], 'posix', 'example'], ['A#2', ['REQ-A'], 'posix', 'example'], ['A#3', ['REQ-A'], 'posix', 'example'], ['B#1', ['REQ-B'], 'windows', 'example']]);
});

test('REQ-SU-003: request overlay, omissions, integer member order, and exact input spelling', () => {
  const r = check('  request {"s":1,"replace":1}\noracle node model.mjs\nop f\n  input x? json\nop g\n  input x? json\n  request {"g":1}\nreq R "r"\n  example f { "x" : -0.00e2 }\n    request {"replace":2,"0":0,"later":{"8":8,"2":2,"z":0}}\n    omit s\n  example g\n  example g {}\n    omit id op input\n  example raw \' {"id":"custom"} \'\n  table f\n    | x |\n    | 2.00e1 |');
  assert.deepEqual(r.result.diagnostics, []);
  assert.deepEqual(r.cases.map(c => c.line), ['{"id":"R#1","op":"f","0":0,"replace":2,"later":{"2":2,"8":8,"z":0},"input":{ "x" : -0.00e2 }}', '{"id":"R#2","op":"g","g":1}', '{"g":1}', ' {"id":"custom"} ', '{"id":"R#5","op":"f","s":1,"replace":1,"input":{"x":2.00e1}}']);
});

test('REQ-SU-003: input blocks switch only that example to compact ECMAScript JSON', () => {
  const r = check('oracle node model.mjs\nop f\n  input a? json, b? json, __proto__? json\nreq R "r"\n  example f {"a" : 2.00, "b":"old"}\n    input b\n      new\n    input __proto__.constructor\n      safe\n  example f\n    input a\n      hello');
  assert.deepEqual(r.result.diagnostics, []);
  assert.equal(r.cases[0].line, '{"id":"R#1","op":"f","input":{"a":2,"b":"new\\n","__proto__":{"constructor":"safe\\n"}}}');
  assert.equal(r.cases[1].line, '{"id":"R#2","op":"f","input":{"a":"hello\\n"}}');
  assert.equal(({} as any).safe, undefined);
});

test('REQ-SU-004: checks retain expectation order, kinds, tolerance and oracle provenance', () => {
  const r = check('oracle node model.mjs\nop f\n  input n number\nreq R "r"\n  example f {"n":4}\n    expect id = "R#1"\n    expect result.n ~ 4.25 +- 0.5\n    expect result = ?\n  table f\n    | n | result.n ± 1 |\n    | 3 | ? |');
  assert.deepEqual(r.result.diagnostics, []);
  assert.deepEqual(r.cases[0].checks, [{ path: 'id', kind: 'eq', value: 'R#1' }, { path: 'result.n', kind: 'approx', value: 4.25, tol: 0.5 }, { path: 'result', kind: 'eq', value: { n: 4 }, from: 'oracle' }]);
  assert.deepEqual(r.cases[1].checks, [{ path: 'result.n', kind: 'eq', value: 3, from: 'oracle' }]);
});

test('REQ-SU-005: full answers preserve members, error/result presence, declared audit and tolerances', () => {
  const r = check('oracle node model.mjs\nop f\n  input response json\n  audit\n  tolerance result.x 0.5\n  tolerance __proto__ 0\nreq R "r"\n  example f {"response":{"result":null,"audit":"A","extra":1}}\n  example f {"response":{"error":null,"result":1,"audit":3}}\n  example raw \'{"input":{"response":{"result":2,"audit":"B"}}}\'');
  assert.equal(r.result.errors, 0);
  assert.deepEqual(r.cases[0].full, { members: ['audit', 'extra', 'id', 'result'], result: null, audit: 'A', tolerances: JSON.parse('{"result.x":0.5,"__proto__":0}') });
  assert.deepEqual(r.cases[1].full, { members: ['audit', 'error', 'id', 'result'], error: null, result: 1, tolerances: JSON.parse('{"result.x":0.5,"__proto__":0}') });
  assert.deepEqual(r.cases[2].full, { members: ['audit', 'id', 'result'], result: 2, tolerances: {} });
  for (const [i, answer] of [{ id: 'R#1', result: null, audit: 'A', extra: 1 }, { id: 'R#2', error: null, result: 8, audit: 3 }, { id: 'raw', result: 2, audit: 'anything' }].entries()) assert.deepEqual(judge(r.cases[i], answer), { pass: true });
});
