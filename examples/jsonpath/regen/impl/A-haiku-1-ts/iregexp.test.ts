import test from 'node:test';
import assert from 'node:assert';
import { compileIRegexp } from './iregexp.ts';

function full(pattern: string, s: string): boolean {
  const rx = compileIRegexp(pattern);
  assert.ok(rx !== null, `${pattern} should be an I-Regexp`);
  return rx.full(s);
}

function search(pattern: string, s: string): boolean {
  const rx = compileIRegexp(pattern);
  assert.ok(rx !== null, `${pattern} should be an I-Regexp`);
  return rx.search(s);
}

test('RFC 9485 section 3: well-formed I-Regexps are accepted', () => {
  for (const p of ['', 'abc', 'a|b', '(a)', '()', 'a*', 'a+', 'a?', 'a{2}', 'a{2,}', 'a{2,3}', '.', '\\.', '\\n', '\\p{Lu}', '\\P{L}', '[jk]', '[a-]', '[-a]', '[-]', '[--]', '[^a-z]', '[a\\]]', '[\\p{L}\\P{Nd}]', '^$', '-,']) {
    assert.ok(compileIRegexp(p) !== null, `should accept ${p}`);
  }
});

test('RFC 9485 section 3: non-I-Regexps are rejected', () => {
  for (const p of ['a{', 'a{3,2}', '*a', 'a**', 'a{,3}', '[]', '[^]', '(a', 'a)', '\\d', '\\s', '\\$', '\\p{Foo}', '\\p{l}', '[z-a]', '[a-z-0]', '[a-\\p{L}]', 'a]', 'a}', '{', '[a[]', '\\\u0000']) {
    assert.strictEqual(compileIRegexp(p), null, `should reject ${JSON.stringify(p)}`);
  }
});

test('a surrogate code point is not an I-Regexp character', () => {
  assert.strictEqual(compileIRegexp('\uD800'), null);
});

test('match is a whole-string test and search finds a substring', () => {
  assert.strictEqual(full('[jk]', 'j'), true);
  assert.strictEqual(full('[jk]', 'kilo'), false);
  assert.strictEqual(search('[jk]', 'kilo'), true);
  assert.strictEqual(search('[jk]', 'xyz'), false);
});

test('quantifiers, alternation and grouping', () => {
  assert.strictEqual(full('a{2,3}', 'a'), false);
  assert.strictEqual(full('a{2,3}', 'aa'), true);
  assert.strictEqual(full('a{2,3}', 'aaa'), true);
  assert.strictEqual(full('a{2,3}', 'aaaa'), false);
  assert.strictEqual(full('a{2,}', 'aaaaa'), true);
  assert.strictEqual(full('a{2}', 'aaa'), false);
  assert.strictEqual(full('(ab)?c', 'c'), true);
  assert.strictEqual(full('(ab)?c', 'abc'), true);
  assert.strictEqual(full('ab|cd', 'cd'), true);
  assert.strictEqual(full('ab|cd', 'abcd'), false);
  assert.strictEqual(full('', ''), true);
  assert.strictEqual(full('', 'a'), false);
  assert.strictEqual(search('', 'abc'), true);
});

test('dot matches anything except CR and LF', () => {
  assert.strictEqual(full('a.c', 'abc'), true);
  assert.strictEqual(full('a.c', 'a\nc'), false);
  assert.strictEqual(full('a.c', 'a\rc'), false);
});

test('character classes, negation and ranges', () => {
  assert.strictEqual(full('[^a]', 'b'), true);
  assert.strictEqual(full('[^a]', 'a'), false);
  assert.strictEqual(full('[a-c]+', 'abc'), true);
  assert.strictEqual(full('[a-c]+', 'abcd'), false);
  assert.strictEqual(full('[a-]', '-'), true);
  assert.strictEqual(full('[-a]', '-'), true);
  assert.strictEqual(full('--', '--'), true);
  assert.strictEqual(full('\\-', '-'), true);
  assert.strictEqual(full('\\(\\)', '()'), true);
});

test('Unicode general categories', () => {
  assert.strictEqual(full('\\p{Lu}+', 'ABC'), true);
  assert.strictEqual(full('\\p{Lu}+', 'AbC'), false);
  assert.strictEqual(full('\\p{L}', 'é'), true);
  assert.strictEqual(full('\\P{L}', '1'), true);
  assert.strictEqual(full('[\\p{Nd}x]', 'x'), true);
  assert.strictEqual(full('\\p{Cn}', '͸'), true);
});

test('escapes map to their characters', () => {
  assert.strictEqual(full('a\\tb', 'a\tb'), true);
  assert.strictEqual(full('a\\nb', 'a\nb'), true);
  assert.strictEqual(full('a\\rb', 'a\rb'), true);
  assert.strictEqual(full('\\\\', '\\'), true);
});

test('matching stays fast on patterns that backtrack in other engines', () => {
  const started = Date.now();
  assert.strictEqual(full('(a*)*b', 'a'.repeat(3000)), false);
  assert.strictEqual(search('(a|a)*c', 'a'.repeat(3000)), false);
  assert.ok(Date.now() - started < 5000);
});

test('patterns whose automaton would be too large are not matched', () => {
  assert.strictEqual(compileIRegexp('((a{100}){100}){100}'), null);
  assert.strictEqual(compileIRegexp('a{30000}'), null);
});
