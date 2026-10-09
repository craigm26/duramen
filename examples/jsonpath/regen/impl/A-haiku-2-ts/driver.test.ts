import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';

// Runs the driver the way REGEN.json says to: the folder is its working directory.
const drive = (input: string) =>
  spawnSync(process.execPath, ['driver.ts'], { cwd: import.meta.dirname, input, encoding: 'utf8' });

test('the driver answers each request in order and exits with status 0', () => {
  const input = [
    '{"id":"1","op":"query","input":{"query":"$.a","document":{"a":[1]}}}',
    '{"id":"2","op":"query","input":{"query":"$[","document":1}}',
    '',
    '   ',
    'not json',
    '{"id":"4","op":"query","input":{"query":"$[0]","document":[7,8]}}',
  ].join('\n') + '\n';
  const r = drive(input);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.stdout.split('\n').slice(0, -1), [
    '{"id":"1","result":{"values":[[1]],"paths":["$[\'a\']"]}}',
    '{"id":"2","error":"invalid_query"}',
    '{"id":null,"error":"bad_request"}',
    '{"id":"4","result":{"values":[7],"paths":["$[0]"]}}',
  ]);
});

test('a last request with no line end is still answered, and a CRLF line ends like LF', () => {
  const r = drive('{"id":"a","op":"query","input":{"query":"$","document":1}}\r\n{"id":"b","op":"x"}');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.stdout, '{"id":"a","result":{"values":[1],"paths":["$"]}}\n{"id":"b","error":"unknown_op"}\n');
});

test('an empty input gives no output and status 0', () => {
  const r = drive('');
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('each LF ends a request, even inside what would have been one JSON object', () => {
  const r = drive('{"id":"x","op":"query",\n"input":{"query":"$","document":2}}\n');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '{"id":null,"error":"bad_request"}\n{"id":null,"error":"bad_request"}\n');
});
