// Scenarios for SPEC R27 (I-Regexp syntax) and R28 (I-Regexp semantics), used through match()
// and search(). Queries are written as the spec shows them, so backslashes are raw text.

import { test } from 'node:test';
import { assertInvalid, assertResult, r } from './helpers.ts';

test('R27 valid and invalid I-Regexps', () => {
  assertResult(r`$[?match(@, 'a\\.b')]`, '["a.b","axb"]', '["a.b"]', '["$[0]"]');
  assertResult(r`$[?match(@, '\\d')]`, '["1"]', '[]', '[]');
  assertResult(r`$[?match(@, '\\w')]`, '["a"]', '[]', '[]');
  assertResult(r`$[?search(@, '\\s')]`, '["a b"]', '[]', '[]');
  assertResult(r`$[?match(@, '\\u0041')]`, '["A"]', '[]', '[]');
  assertResult(r`$[?match(@, '\\$')]`, '["$"]', '[]', '[]');
  assertResult(r`$[?match(@, 'a$')]`, '["a","a$"]', '["a$"]', '["$[1]"]');
  assertResult(r`$[?search(@, '^a')]`, '["ab","^ab","b^a"]', '["^ab","b^a"]', r`["$[1]","$[2]"]`);
  assertResult(r`$[?match(@, '[]')]`, '["[]",""]', '[]', '[]');
  assertResult(r`$[?match(@, '[^]')]`, '["^","a"]', '[]', '[]');
  assertResult(r`$[?match(@, '[a-]')]`, '["-","a","b"]', '["-","a"]', r`["$[0]","$[1]"]`);
  assertResult(r`$[?match(@, '[-a]')]`, '["-","a","b"]', '["-","a"]', r`["$[0]","$[1]"]`);
  assertResult(r`$[?match(@, '[^^]')]`, '["^","x"]', '["x"]', '["$[1]"]');
  assertResult(r`$[?match(@, '[a-c-e]')]`, '["a","-","e"]', '[]', '[]');
  assertResult(r`$[?match(@, '[z-a]')]`, '["m"]', '[]', '[]');
  assertResult(r`$[?match(@, '[\\[\\]]')]`, '["[","]","a"]', '["[","]"]', r`["$[0]","$[1]"]`);
  assertResult(r`$[?match(@, 'a]')]`, '["a]"]', '[]', '[]');
  assertResult(r`$[?match(@, 'a\\]')]`, '["a]"]', '["a]"]', '["$[0]"]');
  assertResult(r`$[?match(@, 'a}')]`, '["a}"]', '[]', '[]');
  assertResult(r`$[?match(@, 'a{')]`, '["a{"]', '[]', '[]');
  assertResult(r`$[?match(@, 'a**')]`, '["aa"]', '[]', '[]');
  assertResult(r`$[?match(@, 'a*?')]`, '["aa"]', '[]', '[]');
  assertResult(r`$[?match(@, '(?:a)')]`, '["a"]', '[]', '[]');
  assertResult(r`$[?match(@, '*a')]`, '["a"]', '[]', '[]');
  assertResult(r`$[?match(@, '(a')]`, '["a"]', '[]', '[]');
  assertResult(r`$[?match(@, 'a)')]`, '["a"]', '[]', '[]');
  assertResult(r`$[?match(@, 'a{,2}')]`, '["a"]', '[]', '[]');
  assertResult(r`$[?match(@, 'a{2,1}')]`, '["a","aa"]', '[]', '[]');
  assertResult(r`$[?match(@, '\\p{IsBasicLatin}')]`, '["a"]', '[]', '[]');
  assertResult(r`$[?match(@, '\\p{Lx}')]`, '["a"]', '[]', '[]');
  assertResult(r`$[?match(@, '\\p{l}')]`, '["a"]', '[]', '[]');
  assertResult(r`$[?match(@, 'a\\-b')]`, '["a-b"]', '["a-b"]', '["$[0]"]');
  assertResult(r`$[?match(@, '[\\p{Lu}]')]`, '["A"]', '["A"]', '["$[0]"]');
  assertResult(r`$[?match(@, '()')]`, '["","a"]', '[""]', '["$[0]"]');
  assertResult(r`$[?match(@, 'a{02}')]`, '["aa"]', '["aa"]', '["$[0]"]');
  assertInvalid(r`$[?match(@, 'a\.b')]`);
});

test('R27 pattern with a quantifier far above the 2^53 range is still a valid pattern', () => {
  assertResult(r`$[?match(@, 'a{99999999999999999999}')]`, '["a"]', '[]', '[]');
  assertResult(r`$[?search(@, 'a{0,99999999999999999999}')]`, '["b"]', '["b"]', '["$[0]"]');
});

test('R27 invalid patterns give LogicalFalse, from a literal or from the document', () => {
  assertResult(r`$[?match(@.s, @.p)]`,
    '[{"s":"aaa","p":"a+"},{"s":"b","p":"a+"},{"s":"a","p":1},{"s":"a","p":"("},{"s":"a"}]',
    '[{"s":"aaa","p":"a+"}]', '["$[0]"]');
});

test('R28 I-Regexp semantics', () => {
  assertResult(r`$[?match(@, 'a.c')]`, '["abc","a\\nc","a\\rc","abcd","a😀c"]', '["abc","a😀c"]', r`["$[0]","$[4]"]`);
  assertResult(r`$[?match(@, '.')]`, '["😀","ab",""]', '["😀"]', '["$[0]"]');
  assertResult(r`$[?match(@, '[a-c]+')]`, '["abc","abd","","cab"]', '["abc","cab"]', r`["$[0]","$[3]"]`);
  assertResult(r`$[?match(@, '[^a-c]')]`, '["a","d","\\n","dd"]', '["d","\\n"]', r`["$[1]","$[2]"]`);
  assertResult(r`$[?match(@, 'a\\nb')]`, '["a\\nb","anb"]', '["a\\nb"]', '["$[0]"]');
  assertResult(r`$[?match(@, 'a\nb')]`, '["a\\nb","anb"]', '["a\\nb"]', '["$[0]"]');
  assertResult(r`$[?match(@, 'a\\tb')]`, '["a\\tb","atb"]', '["a\\tb"]', '["$[0]"]');
  assertResult(r`$[?match(@, 'A')]`, '["a","A"]', '["A"]', '["$[1]"]');
  assertResult(r`$[?match(@, '\\p{Lu}+')]`, '["ABC","AbC","ÀÉ",""]', '["ABC","ÀÉ"]', r`["$[0]","$[2]"]`);
  assertResult(r`$[?match(@, '\\P{L}+')]`, '["a1","12"," !"]', '["12"," !"]', r`["$[1]","$[2]"]`);
  assertResult(r`$[?match(@, '\\p{Nd}')]`, '["3","٣","x","Ⅻ"]', '["3","٣"]', r`["$[0]","$[1]"]`);
  assertResult(r`$[?match(@, '\\p{N}')]`, '["3","٣","x","Ⅻ"]', '["3","٣","Ⅻ"]', r`["$[0]","$[1]","$[3]"]`);
  assertResult(r`$[?match(@, '[\\p{Lu}0-9]+')]`, '["A1","a1","Z9Z"]', '["A1","Z9Z"]', r`["$[0]","$[2]"]`);
  assertResult(r`$[?match(@, '[^\\p{L}]')]`, '["a","1"]', '["1"]', '["$[1]"]');
  assertResult(r`$[?match(@, 'a{2}')]`, '["a","aa","aaa"]', '["aa"]', '["$[1]"]');
  assertResult(r`$[?match(@, 'a{2,}')]`, '["a","aa","aaa"]', '["aa","aaa"]', r`["$[1]","$[2]"]`);
  assertResult(r`$[?match(@, 'a{1,2}')]`, '["a","aa","aaa"]', '["a","aa"]', r`["$[0]","$[1]"]`);
  assertResult(r`$[?match(@, 'a{0}')]`, '["","a"]', '[""]', '["$[0]"]');
  assertResult(r`$[?match(@, 'ab?c')]`, '["ac","abc","abbc"]', '["ac","abc"]', r`["$[0]","$[1]"]`);
  assertResult(r`$[?match(@, '(ab)+')]`, '["abab","aba",""]', '["abab"]', '["$[0]"]');
  assertResult(r`$[?match(@, 'a|')]`, '["","a","b"]', '["","a"]', r`["$[0]","$[1]"]`);
  assertResult(r`$[?match(@, 'x(a|b)*y')]`, '["xy","xabbay","xacy"]', '["xy","xabbay"]', r`["$[0]","$[1]"]`);
  assertResult(r`$[?match(@, '')]`, '["","a"]', '[""]', '["$[0]"]');
  assertResult(r`$[?match(@, '[\\p{Lu}]')]`, '["Q"]', '["Q"]', '["$[0]"]');
});

test('R27/R28 \\p{Cs} is not in the grammar, so a pattern using it is invalid; \\p{Cn} is accepted', () => {
  // Choice C-7: the R27 grammar has no Cs, so the whole pattern is invalid and gives LogicalFalse.
  assertResult(r`$[?match(@, '\\p{Cs}|a')]`, '["a"]', '[]', '[]');
  assertResult(r`$[?match(@, '\\p{Cn}')]`, '["\\u0378"]', '["\\u0378"]', '["$[0]"]');
});

test('R28.9 search is true when some substring matches', () => {
  assertResult(r`$[?search(@, 'a.c')]`, '["abc","abcd","a\\nc","xabc",1]', '["abc","abcd","xabc"]', r`["$[0]","$[1]","$[3]"]`);
  assertResult(r`$[?search(@, '[BR]ob')]`, '["Bob","Rob Roy","bob","Mr. Robinson"]', '["Bob","Rob Roy","Mr. Robinson"]', r`["$[0]","$[1]","$[3]"]`);
  assertResult(r`$[?search(@, 'a|bc')]`, '["a","bc","abc","ac","x"]', '["a","bc","abc","ac"]', r`["$[0]","$[1]","$[2]","$[3]"]`);
  assertResult(r`$[?search(@, '')]`, '["","a",1]', '["","a"]', r`["$[0]","$[1]"]`);
  assertResult(r`$[?search(@, 'x*')]`, '["","abc"]', '["","abc"]', r`["$[0]","$[1]"]`);
  assertResult(r`$[?search(@, '.')]`, '["","\\n","a"]', '["a"]', '["$[2]"]');
});
