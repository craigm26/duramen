import { test } from 'node:test';
import assert from 'node:assert';
import { compile } from '../src/iregexp.ts';

const m = (p: string, s: string) => compile(p, true)!.test(s);
const se = (p: string, s: string) => compile(p, false)!.test(s);
const ok = (p: string) => assert.notStrictEqual(compile(p, true), null, `should be valid: ${p}`);
const bad = (p: string) => assert.strictEqual(compile(p, true), null, `should be invalid: ${p}`);

test('I-Regexp (RFC 9485) syntax: valid expressions', () => {
  for (const p of [
    '', 'a', 'a|b', 'a|', '|a', '(a|b)c', '()', 'a*', 'a+', 'a?', 'a{2}', 'a{2,}', 'a{2,5}', 'a{0}', '.', '\\.', '\\(', '\\)',
    '\\*', '\\+', '\\-', '\\?', '\\[', '\\\\', '\\]', '\\^', '\\{', '\\|', '\\}', '\\n', '\\r', '\\t', '[abc]', '[^abc]', '[a-z]',
    '[-a]', '[a-]', '[a-z-]', '[^-a]', '[\\n\\]]', '[\\p{L}]', '[\\P{Nd}x]', '[a-c\\p{N}]', '\\p{L}', '\\P{L}', '\\p{Lu}',
    '\\p{Zs}', '[.]', '[$]', '[^^]', '[a^]', '$', ',', '-', '/', '=', '[\\-a]', '[\\.-\\]]', 'é', '\u{1F600}', '(a(b)c)*',
    '(a|b){2,3}', '[^\\n]', '[a-a]', '^a', '[+*?{}()|]'.replace('[+*?{}()|]', '[+*?()]'), '\\p{Cn}', '\\p{Sc}', '\\p{Pf}', '\\p{Mn}',
  ]) ok(p);
});

test('I-Regexp syntax: invalid expressions', () => {
  for (const p of [
    '(', ')', 'a)', '(a', '*', '+', '?', 'a**', 'a+*', 'a{', 'a{}', 'a{,2}', 'a{2', 'a{2,3', 'a{x}', 'a{3,2}', '{2}', '[', ']', '[]',
    '[^]', '[a', '[b-a]', '[a-z-9]', '[a-\\p{L}]', '[[]', '[a-]]', '\\', '\\d', '\\w', '\\s', '\\D', '\\S', '\\W', '\\a', '\\b',
    '\\0', '\\1', '\\x41', '\\u0041', '\\/', '\\p', '\\p{}', '\\p{X}', '\\p{IsBasicLatin}', '\\p{Lx}', '\\pL', '\\p{l}', '\\p{LU}', '\\p{Cs}',
    '\\p{L', '[a-z-[aeiou]]', '[\\d]', '[\\w]', '[a-', '(?:a)', '(?=a)', 'a{1}{2}', 'a{1}*', '[--a]', '}', '{', 'a|*', '(|*)', 'a}',
  ]) bad(p);
});

test('I-Regexp semantics: whole-string match vs search', () => {
  assert.ok(m('abc', 'abc'));
  assert.ok(!m('abc', 'xabcx'));
  assert.ok(se('abc', 'xabcx'));
  assert.ok(!se('abc', 'ab'));
  assert.ok(m('a|b', 'b'));
  assert.ok(!m('a|b', 'ab'));
  assert.ok(m('', ''));
  assert.ok(!m('', 'a'));
  assert.ok(se('', 'anything'));
  assert.ok(m('a{2,3}', 'aaa'));
  assert.ok(!m('a{2,3}', 'aaaa'));
  assert.ok(m('a{2,}', 'aaaaa'));
  assert.ok(m('(ab)+', 'abab'));
  assert.ok(m('a$b', 'a$b'));
  assert.ok(m('^a', '^a'));
  assert.ok(!m('$', ''));
  assert.ok(!m('a', 'a\n'));
  assert.ok(m('\\p{Lu}\\p{Ll}+', 'Hello'));
  assert.ok(!m('\\p{Lu}\\p{Ll}+', 'hello'));
  assert.ok(m('\\P{L}', '1'));
  assert.ok(m('\\p{Nd}', '٣'));
  assert.ok(m('[^\\p{L}]', '1'));
  assert.ok(m('[a-c\\p{N}]+', 'a1c'));
  assert.ok(m('[-a]+', '-a-'));
  assert.ok(m('[a-]+', 'a-'));
});

test('I-Regexp semantics: dot, newlines, astral characters', () => {
  assert.ok(m('.', 'x'));
  assert.ok(!m('.', '\n'));
  assert.ok(!m('.', '\r'));
  assert.ok(m('.', ' '));
  assert.ok(m('.', '\u{1F600}'));
  assert.ok(!m('..', '\u{1F600}'));
  assert.ok(m('[^a]', '\n'));
  assert.ok(m('[\\n]', '\n'));
  assert.ok(m('\\t', '\t'));
  assert.ok(m('[\u{1F600}-\u{1F64F}]', '\u{1F601}'));
  assert.ok(m('é', 'é'));
  assert.ok(!m('é', 'é')); // no normalization
  assert.ok(m('\\p{So}', '\u{1F600}'));
});
