import { test } from 'node:test';
import assert from 'node:assert';
import { respond } from './protocol.ts';

const DOC = '{"a":[1,2]}';
const request = (fields: string) => `{"id":"r1",${fields}}`;
const query = (q: string, doc = DOC) => request(`"op":"query","input":{"query":${JSON.stringify(q)},"document":${doc}}`);
const error = (line: string) => JSON.parse(respond(line) as string);

test('a blank line, of spaces, tabs or a CR, gets no response (SPEC: Interface)', () => {
  assert.strictEqual(respond(''), null);
  assert.strictEqual(respond('   \t  '), null);
  assert.strictEqual(respond('\r'), null);
  assert.strictEqual(respond(' \t\r'), null);
});

test('a line that is not a JSON object gets bad_request with a null id (check 1)', () => {
  for (const line of ['not json', '[]', '"query"', '42', 'null', '{"id":"a"', '{"op":"query"}']) {
    assert.deepStrictEqual(error(line), { id: null, error: 'bad_request' }, line);
  }
});

test('a missing or non-string id gets bad_request with a null id (check 1)', () => {
  assert.deepStrictEqual(error('{"op":"query","input":{}}'), { id: null, error: 'bad_request' });
  assert.deepStrictEqual(error('{"id":5,"op":"query","input":{}}'), { id: null, error: 'bad_request' });
  assert.deepStrictEqual(error('{"id":null,"op":"query","input":{}}'), { id: null, error: 'bad_request' });
});

test('a missing, non-string or other op gets unknown_op (check 2)', () => {
  assert.deepStrictEqual(error(request('"input":{}')), { id: 'r1', error: 'unknown_op' });
  assert.deepStrictEqual(error(request('"op":1,"input":{}')), { id: 'r1', error: 'unknown_op' });
  assert.deepStrictEqual(error(request('"op":"Query","input":{}')), { id: 'r1', error: 'unknown_op' });
});

test('input that is missing or not an object, or lacks query or document, gets bad_request (check 3)', () => {
  assert.deepStrictEqual(error(request('"op":"query"')), { id: 'r1', error: 'bad_request' });
  assert.deepStrictEqual(error(request('"op":"query","input":[]')), { id: 'r1', error: 'bad_request' });
  assert.deepStrictEqual(error(request('"op":"query","input":{"document":1}')), { id: 'r1', error: 'bad_request' });
  assert.deepStrictEqual(error(request('"op":"query","input":{"query":5,"document":1}')), { id: 'r1', error: 'bad_request' });
  assert.deepStrictEqual(error(request('"op":"query","input":{"query":"$"}')), { id: 'r1', error: 'bad_request' });
});

test('a query that is not well-formed and valid gets invalid_query (check 4)', () => {
  assert.deepStrictEqual(error(query('a', '1')), { id: 'r1', error: 'invalid_query' });
  assert.deepStrictEqual(error(query('$[?length(@.*) < 3]', '1')), { id: 'r1', error: 'invalid_query' });
});

test('the checks run in the order the spec gives, so the first that applies decides', () => {
  // Check 2 before check 4: an unknown op with an invalid query is unknown_op.
  assert.deepStrictEqual(error(request('"op":"nope","input":{"query":"!!","document":1}')),
    { id: 'r1', error: 'unknown_op' });
  // Check 3 before check 4: a non-string query is bad_request, not invalid_query.
  assert.deepStrictEqual(error(request('"op":"query","input":{"query":"!!"}')), { id: 'r1', error: 'bad_request' });
  // Check 1 before check 2: a line without a string id is bad_request even with an unknown op.
  assert.deepStrictEqual(error('{"id":1,"op":"nope"}'), { id: null, error: 'bad_request' });
});

test('a successful query responds with exactly id and result, values and paths in order', () => {
  const line = query('$.a[*]', '{"a":[1.0,"x"]}');
  const out = respond(line) as string;
  assert.deepStrictEqual(JSON.parse(out), {
    id: 'r1',
    result: { values: [1, 'x'], paths: ["$['a'][0]", "$['a'][1]"] },
  });
  assert.strictEqual(out.includes('1.0'), true, 'the number keeps its text');
});

test('an empty result is still a result', () => {
  assert.deepStrictEqual(JSON.parse(respond(query('$.b')) as string), { id: 'r1', result: { values: [], paths: [] } });
});

test('the id is echoed as given, and other members are ignored', () => {
  const line = '{"id":"caf\\u00e9 \\"q\\"","op":"query","extra":[1],"input":{"query":"$","document":null}}';
  assert.deepStrictEqual(JSON.parse(respond(line) as string), {
    id: 'café "q"',
    result: { values: [null], paths: ['$'] },
  });
});

test('a query whose overflow is reached gets overflow', () => {
  assert.deepStrictEqual(error(query('$[?@ == 1]', '[9007199254740993]')), { id: 'r1', error: 'overflow' });
});

test('a request nested past the stack limit gets overflow with a null id', () => {
  const deep = '['.repeat(100000) + ']'.repeat(100000);
  assert.deepStrictEqual(error(request(`"op":"query","input":{"query":"$","document":${deep}}`)),
    { id: null, error: 'overflow' });
});

test('every response is a single line with no CR or LF (SPEC: Interface)', () => {
  const lines = [query('$'), query('$[?@.a != "x"]', '[{"a":"a\\r\\nb"}]'), 'junk'];
  for (const line of lines) {
    const out = respond(line) as string;
    assert.ok(!out.includes('\r') && !out.includes('\n'), out);
  }
});
