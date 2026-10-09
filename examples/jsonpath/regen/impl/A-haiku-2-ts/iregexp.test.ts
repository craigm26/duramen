import { test } from 'node:test';
import assert from 'node:assert';
import { compileIRegexp, iregexpToJs } from './iregexp.ts';

test('accepts the I-Regexps that Figure 1 allows', () => {
  const valid = ['', 'a', '[jk]', 'a|b', '(a)', '()', 'a|', 'a{2,3}', 'a{2,}', 'a{2}', 'a*', 'a+', 'a?',
    '[-a]', '[a-]', '[-]', '[--]', '[a-z]', '[^a]', '[^-]', '\\.', '\\(\\)\\*\\+\\-\\.\\?\\[\\\\\\]\\^\\{\\|\\}',
    '\\n\\r\\t', '.', '$', '^', '~', 'é', '[\\]]', '\\p{L}', '\\P{Lu}', '[\\p{N}x]', '[a\\-z]', '[^^]'];
  for (const re of valid) assert.notStrictEqual(iregexpToJs(re), undefined, JSON.stringify(re));
});

test('rejects the I-Regexps that Figure 1 does not allow', () => {
  const invalid = ['*a', 'a**', 'a*?', 'a{3,2}', '{1}', 'a}', '{', '(a', 'a)', '[]', '[^]', '[', '\\d', '\\s',
    '\\$', '\\/', '\\p{Lx}', '\\p{Cs}', '\\p{L', '[z-a]', '[\\p{L}-a]', '[a--]', '[--a]', 'a{}', 'a{,3}',
    'a{1,2', '[a-b-c]', '\\', 'a\uD800', '\uDC00'];
  for (const re of invalid) assert.strictEqual(iregexpToJs(re), undefined, JSON.stringify(re));
});

test('match() is a whole-string match; search() finds a substring', () => {
  assert.ok(compileIRegexp('[jk]', true)!.test('j'));
  assert.ok(!compileIRegexp('[jk]', true)!.test('jk'));
  assert.ok(compileIRegexp('[jk]', false)!.test('kilo'));
  assert.ok(compileIRegexp('a{2,3}', true)!.test('aa'));
  assert.ok(!compileIRegexp('a{2,3}', true)!.test('aaaa'));
});

test('a dot matches anything except CR and LF (Section 5.3)', () => {
  const re = compileIRegexp('a.c', true)!;
  assert.ok(re.test('abc'));
  assert.ok(!re.test('a\nc'));
  assert.ok(!re.test('a\rc'));
});

test('a negated class also matches a line feed', () => {
  assert.ok(compileIRegexp('[^a]', true)!.test('\n'));
});

test('Unicode property classes and non-ASCII members work', () => {
  assert.ok(compileIRegexp('\\p{Lu}', true)!.test('A'));
  assert.ok(!compileIRegexp('\\p{Lu}', true)!.test('a'));
  assert.ok(compileIRegexp('[é]', true)!.test('é'));
  assert.ok(compileIRegexp('\\P{L}', true)!.test('1'));
  assert.ok(compileIRegexp('\\p{Cn}', true)!.test('͸'));
});

test('escapes and ranges match their characters', () => {
  assert.ok(compileIRegexp('\\n', true)!.test('\n'));
  assert.ok(compileIRegexp('[a-c]+', true)!.test('bca'));
  assert.ok(compileIRegexp('\\(', true)!.test('('));
  assert.ok(compileIRegexp('[\\]]', true)!.test(']'));
});

test('the empty I-Regexp matches only the empty string as a whole', () => {
  assert.ok(compileIRegexp('', true)!.test(''));
  assert.ok(!compileIRegexp('', true)!.test('a'));
  assert.ok(compileIRegexp('', false)!.test('a'));
});
