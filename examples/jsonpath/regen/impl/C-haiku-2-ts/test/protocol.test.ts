// The driver protocol (SPEC.md, Driver protocol, Errors, REQ-RQ-001 to REQ-RQ-004), checked
// line by line, and then through the driver process itself.

import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { respondLine } from '../protocol.ts';

function ask(line: string): unknown {
  const out = respondLine(line);
  assert.notStrictEqual(out, undefined, `no response for ${line}`);
  return JSON.parse(out as string);
}

test('REQ-RQ-001: a line that is not a JSON object gets bad_request with id null', () => {
  assert.deepStrictEqual(ask('{not json'), { id: null, error: 'bad_request' });
  assert.deepStrictEqual(ask('[1]'), { id: null, error: 'bad_request' });
  assert.deepStrictEqual(ask('"text"'), { id: null, error: 'bad_request' });
});

test('REQ-RQ-001: a missing or non-string id gets bad_request with id null', () => {
  assert.deepStrictEqual(ask('{"op":"query","input":{"query":"$","document":1}}'), {
    id: null,
    error: 'bad_request',
  });
  assert.deepStrictEqual(ask('{"id":7,"op":"query","input":{"query":"$","document":1}}'), {
    id: null,
    error: 'bad_request',
  });
});

test('REQ-RQ-001: a missing or unknown op gets unknown_op, with the id', () => {
  assert.deepStrictEqual(ask('{"id":"r1","input":{"query":"$","document":1}}'), {
    id: 'r1',
    error: 'unknown_op',
  });
  assert.deepStrictEqual(ask('{"id":"r1","op":"select","input":{"query":"$","document":1}}'), {
    id: 'r1',
    error: 'unknown_op',
  });
  assert.deepStrictEqual(ask('{"id":"r1","op":5,"input":{"query":"$","document":1}}'), {
    id: 'r1',
    error: 'unknown_op',
  });
});

test('REQ-RQ-001: input that is missing or not an object gets bad_request', () => {
  assert.deepStrictEqual(ask('{"id":"r1","op":"query"}'), { id: 'r1', error: 'bad_request' });
  assert.deepStrictEqual(ask('{"id":"r1","op":"query","input":[]}'), { id: 'r1', error: 'bad_request' });
  assert.deepStrictEqual(ask('{"id":"r1","op":"query","input":null}'), { id: 'r1', error: 'bad_request' });
});

test('REQ-RQ-001: a query that is missing, not a string, or a document that is missing is bad_request', () => {
  assert.deepStrictEqual(ask('{"id":"r","op":"query","input":{"document":1}}'), { id: 'r', error: 'bad_request' });
  assert.deepStrictEqual(ask('{"id":"r","op":"query","input":{"query":5,"document":1}}'), {
    id: 'r',
    error: 'bad_request',
  });
  assert.deepStrictEqual(ask('{"id":"r","op":"query","input":{"query":"$"}}'), { id: 'r', error: 'bad_request' });
});

test('REQ-RQ-001: the checks run in order, so a bad id beats a bad op and a bad input', () => {
  assert.deepStrictEqual(ask('{"op":"select","input":[]}'), { id: null, error: 'bad_request' });
  assert.deepStrictEqual(ask('{"id":"r","op":"select","input":[]}'), { id: 'r', error: 'unknown_op' });
});

test('REQ-RQ-002: the result holds values and paths of the nodelist, in its order', () => {
  assert.deepStrictEqual(ask('{"id":"r","op":"query","input":{"query":"$","document":{"k":"v"}}}'), {
    id: 'r',
    result: { values: [{ k: 'v' }], paths: ['$'] },
  });
  assert.deepStrictEqual(ask('{"id":"r","op":"query","input":{"query":"$.x","document":{"k":"v"}}}'), {
    id: 'r',
    result: { values: [], paths: [] },
  });
  assert.deepStrictEqual(ask('{"id":"r","op":"query","input":{"query":"$[0,0]","document":["a"]}}'), {
    id: 'r',
    result: { values: ['a', 'a'], paths: ['$[0]', '$[0]'] },
  });
});

test('REQ-RQ-003: any JSON value is a document, and unnamed members are ignored', () => {
  assert.deepStrictEqual(
    ask('{"id":"r1","op":"query","trace":true,"input":{"query":"$.a","document":{"a":1},"flags":"x"}}'),
    { id: 'r1', result: { values: [1], paths: ["$['a']"] } },
  );
  for (const [document, value] of [
    ['null', null],
    ['false', false],
    ['"abc"', 'abc'],
    ['1.5', 1.5],
    ['[]', []],
  ] as const) {
    assert.deepStrictEqual(
      ask(`{"id":"r","op":"query","input":{"query":"$","document":${document}}}`),
      { id: 'r', result: { values: [value], paths: ['$'] } },
    );
  }
  assert.deepStrictEqual(ask('{"id":"r","op":"query","input":{"query":"$.*","document":1}}'), {
    id: 'r',
    result: { values: [], paths: [] },
  });
});

test('REQ-RQ-004: a query that is not well formed or valid is invalid_query, whatever the document', () => {
  for (const document of ['null', '[]', '{"a": 1}', '1']) {
    assert.deepStrictEqual(
      ask(`{"id":"r","op":"query","input":{"query":"$[","document":${document}}}`),
      { id: 'r', error: 'invalid_query' },
    );
  }
});

test('REQ-RQ-004: a valid query never gets an error, even where it selects nothing', () => {
  assert.deepStrictEqual(ask('{"id":"r","op":"query","input":{"query":"$.a.b.c[5][\'x\']","document":{"a":1}}}'), {
    id: 'r',
    result: { values: [], paths: [] },
  });
});

test('Driver protocol: a blank line gets no response; a CRLF line is read without its CR', () => {
  assert.strictEqual(respondLine(''), undefined);
  assert.strictEqual(respondLine(' \t '), undefined);
  assert.strictEqual(respondLine('\r'), undefined);
  assert.deepStrictEqual(
    JSON.parse(respondLine('{"id":"r","op":"query","input":{"query":"$","document":1}}\r') as string),
    { id: 'r', result: { values: [1], paths: ['$'] } },
  );
});

test('Driver protocol: the driver answers each non-blank line in order, one LF-ended line each, and exits 0', () => {
  const driver = fileURLToPath(new URL('../driver.ts', import.meta.url));
  const input = [
    '{"id":"a","op":"query","input":{"query":"$[1]","document":["x","y"]}}',
    '',
    '{not json',
    '   ',
    '{"id":"c","op":"query","input":{"query":"$[","document":1}}',
    '{"id":"d","op":"query","input":{"query":"$.a","document":{"a":[1,2]}}}',
  ].join('\n');
  const run = spawnSync(process.execPath, [driver], { input, encoding: 'utf8' });
  assert.strictEqual(run.status, 0, run.stderr);
  assert.ok(run.stdout.endsWith('\n'));
  assert.ok(!run.stdout.includes('\r'));
  assert.deepStrictEqual(run.stdout.split('\n').slice(0, -1).map((line) => JSON.parse(line)), [
    { id: 'a', result: { values: ['y'], paths: ['$[1]'] } },
    { id: null, error: 'bad_request' },
    { id: 'c', error: 'invalid_query' },
    { id: 'd', result: { values: [[1, 2]], paths: ["$['a']"] } },
  ]);
});

test('Driver protocol: a last line without its LF is still answered', () => {
  const driver = fileURLToPath(new URL('../driver.ts', import.meta.url));
  const run = spawnSync(process.execPath, [driver], {
    input: '{"id":"z","op":"query","input":{"query":"$","document":true}}',
    encoding: 'utf8',
  });
  assert.strictEqual(run.status, 0, run.stderr);
  assert.strictEqual(run.stdout, '{"id":"z","result":{"values":[true],"paths":["$"]}}\n');
});
