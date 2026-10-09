// REQ-RX-001 to REQ-RX-006: which patterns are I-Regexps, and what they match. Rows are
// taken from SPEC.md; each pattern sits inside a JSONPath string literal, as the spec writes it.

import assert from "node:assert";
import { test } from "node:test";
import { translate } from "../regex.ts";
import { valuesOf } from "./support.ts";

type Row = [string, unknown[], unknown[]];

// Line separators, built from code points so that this file holds none of them raw.
const NEL = String.fromCharCode(0x85);
const LS = String.fromCharCode(0x2028);

function check(rows: Row[]): void {
  for (const [query, doc, expected] of rows) {
    assert.deepStrictEqual(valuesOf(query, doc), expected, query);
  }
}

test("REQ-RX-001: the grammar of an I-Regexp, and what is not one", () => {
  check([
    ["$[?match(@, 'a')]", ["a", "b"], ["a"]],
    ["$[?match(@, '')]", ["", "a"], [""]],
    ["$[?match(@, 'a|')]", ["a", "", "b"], ["a", ""]],
    ["$[?match(@, '()')]", ["", "a"], [""]],
    ["$[?match(@, '(a|b)c')]", ["ac", "bc", "c"], ["ac", "bc"]],
    ["$[?match(@, ',-/>@Z^z~')]", [",-/>@Z^z~", "x"], [",-/>@Z^z~"]],
    ["$[?match(@, \"'\")]", ["'", "a"], ["'"]],
    ["$[?match(@, '\\\\d')]", ["1", "d"], []],
    ["$[?match(@, '\\\\w')]", ["a"], []],
    ["$[?match(@, '\\\\s')]", [" "], []],
    ["$[?match(@, 'a*?')]", ["a", ""], []],
    ["$[?match(@, '(?:a)')]", ["a"], []],
    ["$[?match(@, 'a]')]", ["a]"], []],
    ["$[?match(@, 'a\\\\]')]", ["a]"], ["a]"]],
    ["$[?match(@, 'a{')]", ["a{"], []],
    ["$[?match(@, 'a}')]", ["a}"], []],
    ["$[?match(@, '[]')]", ["]", ""], []],
    ["$[?match(@, '[^]')]", ["^", "a"], []],
    ["$[?match(@, '*a')]", ["a", "*a"], []],
    ["$[?match(@, 'a**')]", ["aa"], []],
    ["$[?match(@, '(a')]", ["a", "(a"], []],
    ["$[?match(@, 'a)')]", ["a", "a)"], []],
    ["$[?match(@, '\\\\')]", ["\\"], []],
    ["$[?match(@, '\\\\1')]", ["1"], []],
  ]);
  assert.strictEqual(translate("a*?"), null);
  assert.strictEqual(translate("(?:a)"), null);
  // ^ is an ordinary character, written as a code point escape.
  assert.ok(translate("^a")?.startsWith("\\u{5e}"));
});

test("REQ-RX-002: match is case-sensitive, . matches one code point but not LF or CR", () => {
  check([
    ["$[?match(@, '.')]", ["\n", "\r", LS, NEL, "\u{1F600}", "ab", ""], [LS, NEL, "\u{1F600}"]],
    ["$[?match(@, '..')]", ["\u{1F600}", "ab"], ["ab"]],
    ["$[?match(@, '^a')]", ["^a", "a"], ["^a"]],
    ["$[?match(@, 'a$')]", ["a$", "a"], ["a$"]],
    ["$[?match(@, 'a')]", ["A", "a"], ["a"]],
    ["$[?search(@, 'b')]", ["abc", "B"], ["abc"]],
    ["$[?match(@, 'b')]", ["abc", "b"], ["b"]],
    ["$[?match(@, 'a|bc')]", ["a", "bc", "abc"], ["a", "bc"]],
    ["$[?search(@, 'a|bc')]", ["xa", "xbcx", "b"], ["xa", "xbcx"]],
  ]);
});

test("REQ-RX-003: character classes, ranges and the characters that stand for themselves", () => {
  check([
    ["$[?match(@, '[a-c]+')]", ["abc", "abd", ""], ["abc"]],
    ["$[?match(@, '[^a]')]", ["a", "b", "\u{1F600}", "\n"], ["b", "\u{1F600}", "\n"]],
    ["$[?match(@, '[-a]')]", ["-", "a", "b"], ["-", "a"]],
    ["$[?match(@, '[a-]')]", ["-", "a", "b"], ["-", "a"]],
    ["$[?match(@, '[^-]')]", ["-", "a"], ["a"]],
    ["$[?match(@, '[a^]')]", ["^", "a", "b"], ["^", "a"]],
    ["$[?match(@, '[.]')]", [".", "a"], ["."]],
    ["$[?match(@, '[$]')]", ["$", "a"], ["$"]],
    ["$[?match(@, '[\\\\]]')]", ["]", "\\"], ["]"]],
    ["$[?match(@, '[\\\\\\\\]')]", ["\\", "a"], ["\\"]],
    ["$[?match(@, '[\\\\-a]')]", ["-", "a", "b"], ["-", "a"]],
    ["$[?match(@, '[a-c-e]')]", ["a", "-"], []],
    ["$[?match(@, '[\\\\n]')]", ["\n", "n"], ["\n"]],
    ["$[?match(@, '[\u{1F600}-\u{1F602}]')]", ["\u{1F601}", "a"], ["\u{1F601}"]],
    ["$[?match(@, '[a')]", ["a"], []],
    ["$[?match(@, '[\\\\P{L}]')]", ["a", "1"], ["1"]],
    ["$[?match(@, '[,.Z^]+')]", [",.Z^", "a"], [",.Z^"]],
  ]);
  assert.strictEqual(translate("[z-a]"), null);
  assert.strictEqual(translate("[\\p{L}-a]"), null);
});

test("REQ-RX-004: Unicode categories by name, and only the listed names", () => {
  check([
    ["$[?match(@, '\\\\p{Lu}')]", ["A", "a", "É", "1", "ǅ"], ["A", "É"]],
    ["$[?match(@, '\\\\p{Lt}')]", ["ǅ", "A"], ["ǅ"]],
    ["$[?match(@, '\\\\p{L}+')]", ["abc", "ab1", "é\u{1F600}", "日本"], ["abc", "日本"]],
    ["$[?match(@, '\\\\p{Nd}+')]", ["123", "١٢٣", "12a", "Ⅻ"], ["123", "١٢٣"]],
    ["$[?match(@, '\\\\p{N}')]", ["1", "Ⅻ", "½", "a"], ["1", "Ⅻ", "½"]],
    ["$[?match(@, '\\\\P{L}')]", ["a", "1", " ", "\u{1F600}"], ["1", " ", "\u{1F600}"]],
    ["$[?match(@, '\\\\p{So}')]", ["\u{1F600}", "a"], ["\u{1F600}"]],
    ["$[?match(@, '\\\\p{Zs}')]", [" ", " ", "\t"], [" ", " "]],
    ["$[?match(@, '\\\\p{Cc}')]", ["\t", NEL, "a"], ["\t", NEL]],
    ["$[?match(@, '[\\\\p{Lu}0-9]+')]", ["A1", "a1"], ["A1"]],
    ["$[?match(@, '[^\\\\p{L}]')]", ["a", "1"], ["1"]],
    ["$[?match(@, '\\\\p{IsBasicLatin}')]", ["a"], []],
    ["$[?match(@, '\\\\p{Greek}')]", ["α"], []],
    ["$[?match(@, '\\\\p{lu}')]", ["A"], []],
    ["$[?match(@, '\\\\p{Cs}')]", ["a"], []],
    ["$[?match(@, '\\\\p{Lu')]", ["A"], []],
    ["$[?match(@, '\\\\pL')]", ["A"], []],
  ]);
});

test("REQ-RX-005: escapes are the listed single characters, n, r and t", () => {
  check([
    ["$[?match(@, 'a\\\\.b')]", ["a.b", "axb"], ["a.b"]],
    ["$[?match(@, '\\\\-')]", ["-"], ["-"]],
    ["$[?match(@, '\\\\^')]", ["^"], ["^"]],
    ["$[?match(@, '\\\\{')]", ["{"], ["{"]],
    ["$[?match(@, '\\\\t')]", ["\t", "t"], ["\t"]],
    ["$[?match(@, '\\\\n')]", ["\n", "n"], ["\n"]],
    ["$[?match(@, '\\\\\\\\')]", ["\\"], ["\\"]],
    ["$[?match(@, '\\\\$')]", ["$"], []],
    ["$[?match(@, '\\\\/')]", ["/"], []],
    ["$[?match(@, '\\\\u0041')]", ["A"], []],
    ["$[?match(@, '\\\\b')]", ["b"], []],
    ["$[?match(@, '\\\\x41')]", ["A"], []],
  ]);
});

test("REQ-RX-006: quantifiers, one per atom, with the bounds written in digits", () => {
  check([
    ["$[?match(@, 'a{2}')]", ["a", "aa", "aaa"], ["aa"]],
    ["$[?match(@, 'a{2,}')]", ["a", "aa", "aaa"], ["aa", "aaa"]],
    ["$[?match(@, 'a{1,2}')]", ["", "a", "aa", "aaa"], ["a", "aa"]],
    ["$[?match(@, 'a{0}')]", ["", "a"], [""]],
    ["$[?match(@, 'a{02}')]", ["aa"], ["aa"]],
    ["$[?match(@, '(ab)*')]", ["", "ab", "abab", "aba"], ["", "ab", "abab"]],
    ["$[?match(@, '[ab]+')]", ["abba", "abc"], ["abba"]],
    ["$[?match(@, 'a?b')]", ["b", "ab", "aab"], ["b", "ab"]],
    ["$[?match(@, 'a{,2}')]", ["a"], []],
    ["$[?match(@, 'a{2}{3}')]", ["aaaaaa"], []],
    ["$[?match(@, 'a+?')]", ["a"], []],
    ["$[?match(@, '{2}')]", [""], []],
    ["$[?match(@, 'a{x}')]", ["a"], []],
    ["$[?match(@, 'a{2')]", ["aa"], []],
  ]);
  // The grammar allows a{3,2}, but a minimum above the maximum is not usable: it matches nothing (C-8).
  check([["$[?match(@, 'a{3,2}')]", ["aaa"], []]]);
});
