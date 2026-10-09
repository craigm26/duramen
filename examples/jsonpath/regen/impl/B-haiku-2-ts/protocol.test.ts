// Scenarios for SPEC R1 (request handling) and the driver protocol, checked on exact response text,
// and an end-to-end run of driver.ts as a child process.

import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { respond } from './protocol.ts';

const root = dirname(fileURLToPath(import.meta.url));

test('R1.1 blank lines get no response; a trailing CR is ignored', () => {
  assert.equal(respond(''), null);
  assert.equal(respond('  \t'), null);
  assert.equal(respond('\r'), null);
  assert.equal(respond('   \r'), null);
  const line = '{"id":"c","op":"query","input":{"query":"$","document":1}}';
  assert.equal(respond(`${line}\r`), respond(line));
  assert.equal(respond(line), '{"id":"c","result":{"values":[1],"paths":["$"]}}');
});

test('R1.1 a line of other white space is processed as a request', () => {
  assert.equal(respond('\f'), '{"id":null,"error":"bad_request"}');
});

test('R1 spec scenarios, exact response text', () => {
  const cases: [string, string][] = [
    ['{"id":"r1","op":"query","input":{"query":"$.a","document":{"a":1}}}', '{"id":"r1","result":{"values":[1],"paths":["$[\'a\']"]}}'],
    ['{"id":"r2","op":"query","input":{"query":"$","document":null}}', '{"id":"r2","result":{"values":[null],"paths":["$"]}}'],
    ['{"id":"r3","op":"query","input":{"query":"$"}}', '{"id":"r3","error":"bad_request"}'],
    ['{"id":"r4","op":"evaluate","input":{"query":"$","document":1}}', '{"id":"r4","error":"unknown_op"}'],
    ['{"id":"r5"}', '{"id":"r5","error":"unknown_op"}'],
    ['{"id":"r6","op":"nope","input":{"query":"$[","document":1}}', '{"id":"r6","error":"unknown_op"}'],
    ['hello', '{"id":null,"error":"bad_request"}'],
    ['[1,2]', '{"id":null,"error":"bad_request"}'],
    ['{"id":7,"op":"query","input":{"query":"$","document":1}}', '{"id":null,"error":"bad_request"}'],
    ['{"id":"r8","op":"query","input":{"query":42,"document":1}}', '{"id":"r8","error":"bad_request"}'],
    ['{"id":"r9","op":"query","input":"$"}', '{"id":"r9","error":"bad_request"}'],
    ['{"id":"r10","op":"query","input":{"query":"$[","document":{}}}', '{"id":"r10","error":"invalid_query"}'],
    ['{"id":"r11","op":"query","input":{"query":"$.a","document":1,"extra":true},"x":0}', '{"id":"r11","result":{"values":[],"paths":[]}}'],
    ['{"id":"r12","op":"query","input":{"query":"$","document":0}}', '{"id":"r12","result":{"values":[0],"paths":["$"]}}'],
    ['{"id":"b","op":"query","input":{"query":"$x","document":1}}', '{"id":"b","error":"invalid_query"}'],
  ];
  for (const [line, expected] of cases) assert.equal(respond(line), expected, line);
});

test('R1.2 the error checks run in order', () => {
  // op is checked before input, so a bad op wins over a missing input.
  assert.equal(respond('{"id":"x","op":"evaluate"}'), '{"id":"x","error":"unknown_op"}');
  // id is checked before everything else.
  assert.equal(respond('{"op":"evaluate","id":3}'), '{"id":null,"error":"bad_request"}');
  // A bad query is reported only after the input shape is accepted.
  assert.equal(respond('{"id":"x","op":"query","input":{"query":"$[","document":1}}'), '{"id":"x","error":"invalid_query"}');
  assert.equal(respond('{"id":"x","op":"query","input":{"query":"$[","document":1}'), '{"id":null,"error":"bad_request"}');
});

test('R1.3 any document value is accepted, including falsy ones', () => {
  for (const document of ['false', '0', '""', '[]', '{}', 'null']) {
    assert.equal(respond(`{"id":"d","op":"query","input":{"query":"$","document":${document}}}`),
      `{"id":"d","result":{"values":[${document}],"paths":["$"]}}`);
  }
});

test('R1.4 extra members are ignored', () => {
  assert.equal(respond('{"id":"e","op":"query","input":{"query":"$","document":1,"x":2},"y":3}'),
    '{"id":"e","result":{"values":[1],"paths":["$"]}}');
});

test('R1.6 a well-formed query never errors on the document', () => {
  assert.equal(respond('{"id":"w","op":"query","input":{"query":"$.a.b.c","document":[1,2]}}'),
    '{"id":"w","result":{"values":[],"paths":[]}}');
});

test('R1.7 output is one line, with LF and without CR', () => {
  const line = respond('{"id":"n","op":"query","input":{"query":"$","document":"a\\r\\nb"}}') ?? '';
  assert.ok(!line.includes('\r') && !line.includes('\n'));
  assert.equal(line, '{"id":"n","result":{"values":["a\\r\\nb"],"paths":["$"]}}');
});

test('R31.3 duplicate member names: last value, first position', () => {
  assert.equal(respond('{"id":"u","op":"query","input":{"query":"$.*","document":{"a":1,"b":2,"a":3}}}'),
    '{"id":"u","result":{"values":[3,2],"paths":["$[\'a\']","$[\'b\']"]}}');
});

test('R1 through the driver process: a stream of lines, in order, exit status 0', () => {
  const input = [
    '',
    ' \t',
    '{"id":"r12","op":"query","input":{"query":"$","document":0}}',
    '{"id":"a","op":"query","input":{"query":"$","document":1}}',
    '{"id":"b","op":"query","input":{"query":"$x","document":1}}',
    '{"id":"c","op":"query","input":{"query":"$","document":2}}\r',
  ].join('\n');
  const result = spawnSync(process.execPath, ['driver.ts'], { cwd: root, input, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, [
    '{"id":"r12","result":{"values":[0],"paths":["$"]}}',
    '{"id":"a","result":{"values":[1],"paths":["$"]}}',
    '{"id":"b","error":"invalid_query"}',
    '{"id":"c","result":{"values":[2],"paths":["$"]}}',
    '',
  ].join('\n'));
});
