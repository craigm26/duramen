// Behaviour that SPEC.md leaves open or does not pin, as CHOICES.md records it. Each test names
// the choice it checks.

import { test } from 'node:test';
import assert from 'node:assert';
import { compileIRegexp, translate } from '../iregexp.ts';
import { respondLine } from '../protocol.ts';

function ask(text: string, doc: unknown): unknown {
  const line = respondLine(JSON.stringify({ id: 'c', op: 'query', input: { query: text, document: doc } }));
  return JSON.parse(line as string);
}

test('C-9: an I-Regexp range out of order is not an I-Regexp (OPEN-OP-006)', () => {
  assert.strictEqual(translate('[z-a]'), undefined);
  assert.deepStrictEqual(ask("$[?match(@, '[z-a]')]", ['b']), { id: 'c', result: { values: [], paths: [] } });
});

test('C-10: a repeat range whose bounds are out of order is not an I-Regexp (OPEN-OP-006)', () => {
  assert.strictEqual(translate('a{3,2}'), undefined);
  assert.notStrictEqual(translate('a{2,2}'), undefined);
});

test('C-11: a repeat count the engine refuses matches nothing rather than failing (OPEN-OP-004)', () => {
  const huge = `a{${'9'.repeat(40)}}`;
  assert.strictEqual(compileIRegexp(huge), undefined);
  assert.deepStrictEqual(ask(`$[?match(@, '${huge}')]`, ['a']), { id: 'c', result: { values: [], paths: [] } });
});

test('C-8: a number literal beyond the binary64 range is an infinity (OPEN-OP-003)', () => {
  assert.deepStrictEqual(ask('$[?@ < 1e400]', [1e308, 3]), {
    id: 'c',
    result: { values: [1e308, 3], paths: ['$[0]', '$[1]'] },
  });
  assert.deepStrictEqual(ask('$[?@ == -1e400]', [1]), { id: 'c', result: { values: [], paths: [] } });
});

test('C-14: a lone surrogate escape is invalid (REQ-SY-003); a raw one in the query is kept as it is (OPEN-OP-002)', () => {
  const doc = { '\ud800': 1 };
  assert.deepStrictEqual(ask('$["\\ud800"]', doc), { id: 'c', error: 'invalid_query' });
  assert.deepStrictEqual(ask(`$['\ud800']`, doc), {
    id: 'c',
    result: { values: [1], paths: ["$['\ud800']"] },
  });
});

test('C-13: a function argument that is a comparison is parsed, then rejected by the typing rules', () => {
  assert.deepStrictEqual(ask('$[?length(@ == 1) == 1]', [1]), { id: 'c', error: 'invalid_query' });
});

test('C-3: a trailing CR on a request line is a CRLF line ending and is not part of the request', () => {
  const line = respondLine('{"id":"a","op":"query","input":{"query":"$","document":1}}\r');
  assert.deepStrictEqual(JSON.parse(line as string), { id: 'a', result: { values: [1], paths: ['$'] } });
});

test('C-4: only space, tab and a CRLF CR make a line blank; other white space does not', () => {
  assert.strictEqual(respondLine(' \t'), undefined);
  assert.notStrictEqual(respondLine('\f'), undefined);
});
