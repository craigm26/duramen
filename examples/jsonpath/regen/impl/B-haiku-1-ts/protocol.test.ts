// SPEC.md R1 (request handling) and the driver protocol, through handleLine and through the real driver.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleLine } from './protocol.ts';

const DRIVER = fileURLToPath(new URL('driver.ts', import.meta.url));

function drive(input: string): { stdout: string; status: number | null } {
  const r = spawnSync(process.execPath, [DRIVER], { input, encoding: 'utf8' });
  return { stdout: r.stdout, status: r.status };
}

test('R1 responses, one per request, in order', () => {
  assert.equal(
    handleLine('{"id":"r1","op":"query","input":{"query":"$.a","document":{"a":1}}}'),
    '{"id":"r1","result":{"values":[1],"paths":["$[\'a\']"]}}',
  );
  assert.equal(
    handleLine('{"id":"r2","op":"query","input":{"query":"$","document":null}}'),
    '{"id":"r2","result":{"values":[null],"paths":["$"]}}',
  );
  assert.equal(handleLine('{"id":"r3","op":"query","input":{"query":"$"}}'), '{"id":"r3","error":"bad_request"}');
  assert.equal(handleLine('{"id":"r4","op":"evaluate","input":{"query":"$","document":1}}'), '{"id":"r4","error":"unknown_op"}');
  assert.equal(handleLine('{"id":"r5"}'), '{"id":"r5","error":"unknown_op"}');
  assert.equal(handleLine('{"id":"r6","op":"nope","input":{"query":"$[","document":1}}'), '{"id":"r6","error":"unknown_op"}');
  assert.equal(handleLine('hello'), '{"id":null,"error":"bad_request"}');
  assert.equal(handleLine('[1,2]'), '{"id":null,"error":"bad_request"}');
  assert.equal(handleLine('{"id":7,"op":"query","input":{"query":"$","document":1}}'), '{"id":null,"error":"bad_request"}');
  assert.equal(handleLine('{"id":"r8","op":"query","input":{"query":42,"document":1}}'), '{"id":"r8","error":"bad_request"}');
  assert.equal(handleLine('{"id":"r9","op":"query","input":"$"}'), '{"id":"r9","error":"bad_request"}');
  assert.equal(handleLine('{"id":"r10","op":"query","input":{"query":"$[","document":{}}}'), '{"id":"r10","error":"invalid_query"}');
  assert.equal(
    handleLine('{"id":"r11","op":"query","input":{"query":"$.a","document":1,"extra":true},"x":0}'),
    '{"id":"r11","result":{"values":[],"paths":[]}}',
  );
  assert.equal(handleLine('{"id":"r12","op":"query","input":{"query":"$.a.b.c","document":[1,2]}}'), '{"id":"r12","result":{"values":[],"paths":[]}}');
});

test('R1.3 document is accepted whatever its value; only absence is an error', () => {
  for (const doc of ['null', 'false', '0', '""', '[]', '{}']) {
    assert.equal(
      handleLine(`{"id":"d","op":"query","input":{"query":"$","document":${doc}}}`),
      `{"id":"d","result":{"values":[${doc}],"paths":["$"]}}`,
    );
  }
});

test('R1.2 checks run in order: id, op, input, then query', () => {
  // Bad id wins over everything else.
  assert.equal(handleLine('{"op":"nope","input":{"query":"$["}}'), '{"id":null,"error":"bad_request"}');
  // A bad op wins over a bad input and a bad query.
  assert.equal(handleLine('{"id":"o","op":5,"input":[1,"$["]}'), '{"id":"o","error":"unknown_op"}');
  // A bad input wins over a bad query.
  assert.equal(handleLine('{"id":"i","op":"query","input":{"query":"$["}}'), '{"id":"i","error":"bad_request"}');
});

test('R1.5 a response holds only id and result, or only id and error', () => {
  const ok = JSON.parse(handleLine('{"id":"k","op":"query","input":{"query":"$","document":1}}')) as object;
  assert.deepStrictEqual(Object.keys(ok), ['id', 'result']);
  const bad = JSON.parse(handleLine('{"id":"k","op":"query","input":{"query":"$x","document":1}}')) as object;
  assert.deepStrictEqual(Object.keys(bad), ['id', 'error']);
});

test('R1.1 the id may be any string; it is echoed exactly', () => {
  assert.equal(
    handleLine('{"id":"é\\n\\"","op":"query","input":{"query":"$","document":1}}'),
    '{"id":"é\\n\\"","result":{"values":[1],"paths":["$"]}}',
  );
});

test('R1.2 invalid JSON and a non-object request are bad_request with a null id', () => {
  assert.equal(handleLine('{"id":"x",'), '{"id":null,"error":"bad_request"}');
  assert.equal(handleLine(''), '{"id":null,"error":"bad_request"}');
  assert.equal(handleLine('{"id":"x","op":"query","input":{"query":"$","document":01}}'), '{"id":null,"error":"bad_request"}');
});

test('R1.1 driver: blank lines get no response; one response for the one request (r12)', () => {
  const r = drive('\n  \t\n{"id":"r12","op":"query","input":{"query":"$","document":0}}\n');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '{"id":"r12","result":{"values":[0],"paths":["$"]}}\n');
});

test('R1.1 driver: whitespace-only lines with CR are blank; other white space is a request', () => {
  assert.equal(drive(' \r\n\t\r\n\r\n').stdout, '');
  assert.equal(drive('\f\n').stdout, '{"id":null,"error":"bad_request"}\n');
});

test('R1.1 driver: CRLF line endings work and every output line ends with LF only', () => {
  const r = drive('{"id":"a","op":"query","input":{"query":"$","document":1}}\r\n{"id":"b","op":"query","input":{"query":"$x","document":1}}\r\n');
  assert.equal(r.status, 0);
  assert.equal(
    r.stdout,
    '{"id":"a","result":{"values":[1],"paths":["$"]}}\n{"id":"b","error":"invalid_query"}\n',
  );
  assert.ok(!r.stdout.includes('\r'));
});

test('R1 driver: requests answered in order; last line without LF is still answered; exit 0', () => {
  const r = drive(
    '{"id":"a","op":"query","input":{"query":"$","document":1}}\n' +
      '{"id":"b","op":"query","input":{"query":"$x","document":1}}\n' +
      '{"id":"c","op":"query","input":{"query":"$.a","document":{"a":[]}}}',
  );
  assert.equal(r.status, 0);
  assert.equal(
    r.stdout,
    '{"id":"a","result":{"values":[1],"paths":["$"]}}\n' +
      '{"id":"b","error":"invalid_query"}\n' +
      '{"id":"c","result":{"values":[[]],"paths":["$[\'a\']"]}}\n',
  );
});

test('R1.7 output is UTF-8 with LF line endings and nothing else on stdout', () => {
  const r = drive('{"id":"😀","op":"query","input":{"query":"$","document":"é"}}\n');
  assert.equal(r.stdout, '{"id":"😀","result":{"values":["é"],"paths":["$"]}}\n');
});

test('R1.3 driver with no requests produces no output and exits 0', () => {
  const r = drive('');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
