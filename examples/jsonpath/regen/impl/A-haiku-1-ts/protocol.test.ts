import test from 'node:test';
import assert from 'node:assert';
import { handleLine } from './protocol.ts';

function req(id: string, op: string, input: string): string {
  return `{"id":${JSON.stringify(id)},"op":${JSON.stringify(op)},"input":${input}}`;
}

test('a blank line, or one of only spaces and tabs (and CR), gets no response', () => {
  assert.strictEqual(handleLine(''), null);
  assert.strictEqual(handleLine('   \t '), null);
  assert.strictEqual(handleLine('\r'), null);
  assert.strictEqual(handleLine('  \r'), null);
});

test('a line that is not a JSON object, or has no string id, is bad_request with id null', () => {
  assert.strictEqual(handleLine('not json'), '{"id":null,"error":"bad_request"}');
  assert.strictEqual(handleLine('[1]'), '{"id":null,"error":"bad_request"}');
  assert.strictEqual(handleLine('"x"'), '{"id":null,"error":"bad_request"}');
  assert.strictEqual(handleLine('{"op":"query","input":{}}'), '{"id":null,"error":"bad_request"}');
  assert.strictEqual(
    handleLine('{"id":7,"op":"query","input":{"query":"$","document":1}}'),
    '{"id":null,"error":"bad_request"}',
  );
});

test('a trailing CR (CRLF line ends) is not part of the request', () => {
  assert.strictEqual(
    handleLine(req('a', 'query', '{"query":"$","document":[1]}') + '\r'),
    '{"id":"a","result":{"values":[[1]],"paths":["$"]}}',
  );
});

test('unknown_op comes before bad_request for the input', () => {
  assert.strictEqual(handleLine(req('a', 'nope', '5')), '{"id":"a","error":"unknown_op"}');
  assert.strictEqual(handleLine('{"id":"a","input":5}'), '{"id":"a","error":"unknown_op"}');
  assert.strictEqual(handleLine('{"id":"a","op":5,"input":{}}'), '{"id":"a","error":"unknown_op"}');
});

test('bad_request for input that is missing, not an object, or lacks query or document', () => {
  assert.strictEqual(handleLine('{"id":"a","op":"query"}'), '{"id":"a","error":"bad_request"}');
  assert.strictEqual(handleLine(req('a', 'query', '[]')), '{"id":"a","error":"bad_request"}');
  assert.strictEqual(handleLine(req('a', 'query', '{"document":1}')), '{"id":"a","error":"bad_request"}');
  assert.strictEqual(handleLine(req('a', 'query', '{"query":5,"document":1}')), '{"id":"a","error":"bad_request"}');
  assert.strictEqual(handleLine(req('a', 'query', '{"query":"$"}')), '{"id":"a","error":"bad_request"}');
});

test('bad input checks come before query validity', () => {
  assert.strictEqual(handleLine(req('a', 'query', '{"query":"@","document":1}')), '{"id":"a","error":"invalid_query"}');
  assert.strictEqual(handleLine(req('a', 'query', '{"query":"@"}')), '{"id":"a","error":"bad_request"}');
});

test('invalid_query for a query that is not well-formed and valid', () => {
  assert.strictEqual(handleLine(req('a', 'query', '{"query":"$[?length(@.*) < 3]","document":[]}')), '{"id":"a","error":"invalid_query"}');
  assert.strictEqual(handleLine(req('a', 'query', '{"query":"$[9007199254740992]","document":[]}')), '{"id":"a","error":"invalid_query"}');
});

test('a successful query returns values and normalized paths in nodelist order', () => {
  assert.strictEqual(
    handleLine(req('q1', 'query', '{"query":"$.a[*]","document":{"a":[1.50,"x",{"b":null}]}}')),
    '{"id":"q1","result":{"values":[1.50,"x",{"b":null}],"paths":["$[\'a\'][0]","$[\'a\'][1]","$[\'a\'][2]"]}}',
  );
});

test('the id is echoed exactly, including characters that need escaping', () => {
  assert.strictEqual(
    handleLine(req('é"\\\n', 'query', '{"query":"$","document":null}')),
    '{"id":"é\\"\\\\\\n","result":{"values":[null],"paths":["$"]}}',
  );
});

test('a response is a single line with no CR and no raw control characters', () => {
  const out = handleLine(req('a', 'query', '{"query":"$..*","document":{"k\\r\\n":"v\\u0001"}}'));
  assert.ok(out !== null);
  assert.ok(!out.includes('\n'));
  assert.ok(!out.includes('\r'));
  assert.ok(!/[\u0000-\u001f]/.test(out));
});

test('a query matching nothing is an empty result, not an error', () => {
  assert.strictEqual(
    handleLine(req('a', 'query', '{"query":"$.missing","document":{}}')),
    '{"id":"a","result":{"values":[],"paths":[]}}',
  );
});

test('a leading byte order mark is not skipped: the line is bad_request', () => {
  assert.strictEqual(handleLine('﻿' + req('a', 'query', '{"query":"$","document":1}')), '{"id":null,"error":"bad_request"}');
});

test('documents nested several hundred levels deep are handled', () => {
  const depth = 500;
  const doc = '['.repeat(depth) + '1' + ']'.repeat(depth);
  const out = handleLine(req('a', 'query', `{"query":"$..[0]","document":${doc}}`));
  assert.ok(out !== null && out.startsWith('{"id":"a","result":{"values":['));
});
