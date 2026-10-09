import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { handleLine } from "../driver.ts";
import { parseJson } from "../json.ts";
import { compileIRegexp } from "../regex.ts";

const root = join(import.meta.dirname, "..");

function q(query: string, document: string): { values: unknown; paths: string[] } | string {
  const line = `{"id":"1","op":"query","input":{"query":${JSON.stringify(query)},"document":${document}}}`;
  const r = JSON.parse(handleLine(line)!);
  return r.error ?? r.result;
}
const vals = (query: string, doc: string) => JSON.parse(JSON.stringify((q(query, doc) as any).values));
const paths = (query: string, doc: string) => (q(query, doc) as any).paths;
const bad = (query: string, doc = "null") => assert.strictEqual(q(query, doc), "invalid_query", query);

const BOOKS = `{"store":{"book":[{"category":"reference","author":"Nigel Rees","price":8.95},
{"category":"fiction","author":"Evelyn Waugh","price":12.99},
{"category":"fiction","author":"Herman Melville","isbn":"0-553","price":8.99}],"bicycle":{"color":"red","price":399}}}`;

test("REQ-BU-001 REGEN.json shape", () => {
  const r = JSON.parse(readFileSync(join(root, "REGEN.json"), "utf8"));
  assert.deepStrictEqual(Object.keys(r).sort(), ["build", "driver", "lang", "test"]);
  assert.ok(["ts", "py"].includes(r.lang));
  for (const k of ["build", "test", "driver"]) assert.strictEqual(typeof r[k], "string");
  assert.match(r.driver, /^[\w.\-]+( [\w.\-]+)*$/);
});

test("REQ-BU-003 no dependencies", () => {
  for (const f of ["node_modules", "package-lock.json", "requirements.txt", "Pipfile", "poetry.lock"]) {
    assert.ok(!existsSync(join(root, f)), f);
  }
  assert.doesNotMatch(readFileSync(join(root, "package.json"), "utf8"), /"(dev|peer|optional)?[dD]ependencies"/);
});

test("REQ-BU-004 size limit", () => {
  let n = 0;
  for (const f of readdirSync(root)) {
    if (!/\.(ts|mts|mjs|js|py)$/.test(f) || /\.test\./.test(f)) continue;
    if (statSync(join(root, f)).isFile()) n += readFileSync(join(root, f), "utf8").split("\n").filter((l) => l.trim()).length;
  }
  assert.ok(n <= 3000, String(n));
});

test("driver protocol over stdin/stdout", () => {
  const input = [
    '{"id":"a","op":"query","input":{"query":"$.a","document":{"a":[1,2]}}}',
    "",
    "   \t",
    "not json",
    '{"id":"b","op":"nope","input":{}}',
    '{"id":"c","op":"query","input":{"query":"$.a"}}',
    '{"id":"d","op":"query","input":{"query":"a","document":1}}',
    '{"id":7,"op":"query"}',
    "[1]",
  ].join("\n");
  const r = spawnSync("node", ["driver.ts"], { cwd: root, input, encoding: "utf8" });
  assert.strictEqual(r.status, 0);
  assert.ok(!r.stdout.includes("\r"));
  assert.ok(r.stdout.endsWith("\n"));
  const lines = r.stdout.trimEnd().split("\n").map((l) => JSON.parse(l));
  assert.deepStrictEqual(lines, [
    { id: "a", result: { values: [[1, 2]], paths: ["$['a']"] } },
    { id: null, error: "bad_request" },
    { id: "b", error: "unknown_op" },
    { id: "c", error: "bad_request" },
    { id: "d", error: "invalid_query" },
    { id: null, error: "bad_request" },
    { id: null, error: "bad_request" },
  ]);
});

test("error ordering", () => {
  assert.deepStrictEqual(JSON.parse(handleLine('{"id":"x","op":5,"input":3}')!), { id: "x", error: "unknown_op" });
  assert.deepStrictEqual(JSON.parse(handleLine('{"id":"x","op":"query","input":{"query":5}}')!), { id: "x", error: "bad_request" });
  assert.deepStrictEqual(JSON.parse(handleLine('{"id":"x","op":"query","input":{"query":"$","document":null}}')!).result, { values: [null], paths: ["$"] });
});

test("root, name, wildcard, index (RFC 2.2-2.3.3)", () => {
  assert.deepStrictEqual(vals("$", '{"k":"v"}'), [{ k: "v" }]);
  const d = `{"o":{"j j":{"k.k":3}},"'":{"@":2}}`;
  assert.deepStrictEqual(paths(`$.o["j j"]["k.k"]`, d), ["$['o']['j j']['k.k']"]);
  assert.deepStrictEqual(paths(`$["'"]["@"]`, d), ["$['\\'']['@']"]);
  assert.deepStrictEqual(vals("$[*]", `{"o":{"j":1},"a":[5,3]}`), [{ j: 1 }, [5, 3]]);
  assert.deepStrictEqual(paths("$.a[*]", `{"a":[5,3]}`), ["$['a'][0]", "$['a'][1]"]);
  assert.deepStrictEqual(vals("$[-2]", '["a","b"]'), ["a"]);
  assert.deepStrictEqual(paths("$[-2]", '["a","b"]'), ["$[0]"]);
  assert.deepStrictEqual(vals("$[5]", '["a","b"]'), []);
  assert.deepStrictEqual(vals("$.a", "[1]"), []);
  assert.deepStrictEqual(vals("$[*]", "1"), []);
});

test("slices (RFC 2.3.4)", () => {
  const d = '["a","b","c","d","e","f","g"]';
  assert.deepStrictEqual(vals("$[1:3]", d), ["b", "c"]);
  assert.deepStrictEqual(vals("$[5:]", d), ["f", "g"]);
  assert.deepStrictEqual(vals("$[1:5:2]", d), ["b", "d"]);
  assert.deepStrictEqual(vals("$[5:1:-2]", d), ["f", "d"]);
  assert.deepStrictEqual(vals("$[::-1]", d), ["g", "f", "e", "d", "c", "b", "a"]);
  assert.deepStrictEqual(vals("$[::0]", d), []);
  assert.deepStrictEqual(vals("$[ 1 : 3 : 1 ]", d), ["b", "c"]);
  assert.deepStrictEqual(vals("$[-100:100]", d).length, 7);
  assert.deepStrictEqual(vals("$[0,3]", d), ["a", "d"]);
  assert.deepStrictEqual(vals("$[0,0]", d), ["a", "a"]);
});

test("filters and comparisons (RFC 2.3.5)", () => {
  assert.deepStrictEqual(vals("$.store.book[?@.price<10].author", BOOKS), ["Nigel Rees", "Herman Melville"]);
  assert.deepStrictEqual(vals("$..book[?@.isbn].author", BOOKS), ["Herman Melville"]);
  assert.deepStrictEqual(vals("$..book[?(@.price>10)].author", BOOKS), ["Evelyn Waugh"]);
  assert.deepStrictEqual(vals("$..book[?!@.isbn].author", BOOKS), ["Nigel Rees", "Evelyn Waugh"]);
  assert.deepStrictEqual(vals("$..book[?!(@.isbn || @.price>10)].author", BOOKS), ["Nigel Rees"]);
  const d = `{"a":[3,5,1,2,4,6,{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}],"o":{"p":1,"q":2,"r":3,"s":5,"t":{"u":6}},"e":"f"}`;
  assert.deepStrictEqual(vals("$.a[?@.b == $.x]", d), [3, 5, 1, 2, 4, 6]);
  assert.deepStrictEqual(vals("$.a[?@ == @]", d).length, 10);
  assert.deepStrictEqual(vals("$.o[?@>1 && @<4]", d), [2, 3]);
  assert.deepStrictEqual(vals("$.a[?@<2 || @.b == \"k\"]", d), [1, { b: "k" }]);
  assert.deepStrictEqual(paths("$[?@.*]", d), ["$['a']", "$['o']"]);
  assert.deepStrictEqual(paths("$[?@[?@.b]]", d), ["$['a']"]);
  const c = '{"obj":{"x":"y"},"arr":[2,3]}';
  const t = (e: string) => (vals(`$[?${e}]`, `[0]`).length === 1);
  assert.ok(t("$.absent1 == $.absent2"));
  assert.ok(t("$.absent1 <= $.absent2"));
  assert.ok(!t("$.absent == 'g'"));
  assert.ok(t("$.absent != 'g'"));
  assert.ok(!t("13 == '13'"));
  assert.ok(t("'a' <= 'b'"));
  assert.ok(!t("true > true"));
  assert.ok(t("true <= true"));
  assert.ok(t("1.0 == 1"));
  assert.ok(t("1e2 == 100"));
  assert.ok(t("-0 == 0"));
  assert.ok(t("null == null"));
  assert.ok(t("$.obj == $.obj")); // both Nothing
  void c;
  const co = (e: string) => vals(`$[?${e}]`, `{"x":${c}}`).length === 1;
  assert.ok(co("@.obj == @.obj"));
  assert.ok(!co("@.obj == @.arr"));
  assert.ok(co("@.obj != @.arr"));
  assert.ok(!co("@.obj < @.arr"));
  assert.ok(co("@.arr <= @.arr"));
  assert.ok(!co("1 <= @.arr"));
});

test("exact number comparison", () => {
  const d = "[12345678901234567890, 12345678901234567891]";
  assert.deepStrictEqual(paths("$[?@ == 12345678901234567891]", d), ["$[1]"]);
  assert.deepStrictEqual(paths("$[?@ < 12345678901234567891]", d), ["$[0]"]);
  const r = handleLine('{"id":"n","op":"query","input":{"query":"$[0]","document":[12345678901234567890.5e0]}}')!;
  assert.match(r, /12345678901234567890\.5e0/);
});

test("descendant segments (RFC 2.5.2)", () => {
  const d = `{"o":{"j":1,"k":2},"a":[5,3,[{"j":4},{"k":6}]]}`;
  assert.deepStrictEqual(vals("$..j", d), [1, 4]);
  assert.deepStrictEqual(paths("$..[0]", d), ["$['a'][0]", "$['a'][2][0]"]);
  assert.deepStrictEqual(vals("$..*", d).length, 11);
  assert.deepStrictEqual(paths("$.a..[0, 1]", d), ["$['a'][0]", "$['a'][1]", "$['a'][2][0]", "$['a'][2][1]"]);
  assert.deepStrictEqual(paths("$..o", d), ["$['o']"]);
  assert.deepStrictEqual(paths("$.a..[0,1]", d).length, 4);
});

test("functions (RFC 2.4)", () => {
  const d = `[{"a":"abc","n":[1,2,3]},{"a":"ab\\ud83d\\ude00","n":{"x":1}},{"a":5}]`;
  assert.deepStrictEqual(paths("$[?length(@.a) == 3]", d), ["$[0]", "$[1]"]);
  assert.deepStrictEqual(paths("$[?length(@.n) == 3]", d), ["$[0]"]);
  assert.deepStrictEqual(paths("$[?length(@.n) == 1]", d), ["$[1]"]);
  assert.deepStrictEqual(paths("$[?count(@.*) == 2]", d), ["$[0]", "$[1]"]);
  assert.deepStrictEqual(paths("$[?match(@.a, 'a.c')]", d), ["$[0]"]);
  assert.deepStrictEqual(paths("$[?match(@.a, 'a.')]", d), []);
  assert.deepStrictEqual(paths("$[?search(@.a, 'b.')]", d), ["$[0]", "$[1]"]);
  assert.deepStrictEqual(paths("$[?match(@.a, 'ab.')]", d), ["$[0]", "$[1]"]);
  assert.deepStrictEqual(paths("$[?value(@.n[0]) == 1]", d), ["$[0]"]);
  assert.deepStrictEqual(paths("$[?match(@.a, '(')]", d), []);
  assert.deepStrictEqual(paths("$[?match(1, 'a')]", d), []);
  assert.deepStrictEqual(paths("$[?length(@.zz) == 1]", d), []);
});

test("well-typedness (RFC 2.4.3, 2.4.9)", () => {
  bad("$[?length(@) < 3]".replace("length(@)", "length(@.*)"));
  bad("$[?count(1) == 1]");
  bad("$[?match(@.t, 'a') == true]");
  bad("$[?value(@..color)]");
  bad("$[?length(@.a)]");
  bad("$[?foo(@.a)]");
  bad("$[?length()]");
  bad("$[?length(@, @)]");
  bad("$[?count(@.a) == length(@.*)]");
  bad("$[?match(@.a)]");
  bad("$[?1]");
  bad("$[?@.a == @.*]");
  bad("$[?@..a == 1]");
  assert.notStrictEqual(q("$[?length(@) < 3]", "[]"), "invalid_query");
  assert.notStrictEqual(q("$[?count(@.*) == 1]", "[]"), "invalid_query");
  assert.notStrictEqual(q("$[?value(@..color) == 'red']", "[]"), "invalid_query");
  assert.notStrictEqual(q("$[?match(@.t, 'Europe/.*')]", "[]"), "invalid_query");
});

test("syntax errors (RFC ABNF)", () => {
  for (const s of [
    "", "a", "@", " $", "$ ", "$.", "$..", "$.[a]", "$.a b", "$[", "$[]", "$[,]", "$['a'", "$[01]", "$[-0]",
    "$[1:2:3:4]", "$[9007199254740992]", "$[-9007199254740992]", "$[::9007199254740992]", "$['a\\x']",
    "$['\\u12']", "$['\\ud800']", "$['\\udc00']", "$['\\ud800\\u0041']", "$[\"a']", "$['a\\\"']", "$[\"a\\'\"]",
    "$[?]", "$[?@.a ==]", "$[?(@.a]", "$[?@.a && ]", "$[?!!@.a]", "$[?!@.a == 1]", "$[?01 == 1]", "$[?1. == 1]",
    "$[?.5 == 1]", "$[?True == 1]", "$[?'a' == 'b' == 'c']", "$[?@.a=1]", "$...a", "$. a", "$.1a", "$['a'\n 'b']",
    "$[?@.a == 1e]", "$[?@. a]", "$.a\u0001", "$['a\u0001']", "$['\ud800']",
  ]) bad(s);
});

test("syntax accepted", () => {
  for (const s of [
    "$ .a", "$\t\n\r.a", "$[ 'a' , 'b' ]", "$.a  [0]", "$[?  @.a  ]", "$[?(@.a)&&(@.b)]", "$[?@.a==1]",
    "$['\\u0041']", "$['\\ud83d\\ude00']", "$[\"it's\"]", "$['it\\'s']", "$..[*]", "$..a", "$.*", "$..*", "$[:]",
    "$[::]", "$[1:]", "$[?-0 == 0]", "$[?1E2 == 100]", "$[?1e+2 == 100]", "$[?! @.a]", "$[?!(@.a)]", "$.é", "$._a1",
    "$[9007199254740991]", "$[?length( @ ) > 1 ]", "$[?match(@.a,'x')]", "$[?$.a]",
  ]) assert.notStrictEqual(q(s, "{}"), "invalid_query", s);
});

test("normalized paths (RFC 2.7)", () => {
  assert.deepStrictEqual(paths('$["\\u000B"]', '{"\\u000b":1}'), ["$['\\u000b']"]);
  assert.deepStrictEqual(paths("$[*]", '{"a\\nb\\\\c\'":1,"\\u001f\\u007f":2}'), ["$['a\\nb\\\\c\\'']", "$['\\u001f\x7f']"]);
  assert.deepStrictEqual(paths("$.a.b[1:2]", '{"a":{"b":[0,1]}}'), ["$['a']['b'][1]"]);
});

test("names compare without normalization; null semantics", () => {
  assert.deepStrictEqual(vals("$['\u00e9']", '{"e\\u0301":1,"\\u00e9":2}'), [2]);
  const d = '{"a":null,"b":[null],"c":[{}],"null":1}';
  assert.deepStrictEqual(vals("$.a", d), [null]);
  assert.deepStrictEqual(vals("$.a[0]", d), []);
  assert.deepStrictEqual(vals("$.b[?@==null]", d), [null]);
  assert.deepStrictEqual(vals("$.c[?@.d==null]", d), []);
  assert.deepStrictEqual(vals("$.null", d), [1]);
});

test("document keys: __proto__ and integer-like order", () => {
  assert.deepStrictEqual(vals("$.__proto__", '{"__proto__":1}'), [1]);
  assert.deepStrictEqual(paths("$.*", '{"b":1,"2":2,"a":3,"1":4}'), ["$['b']", "$['2']", "$['a']", "$['1']"]);
});

test("I-Regexp (RFC 9485)", () => {
  const m = (p: string, s: string) => compileIRegexp(p)?.full.test(s);
  const se = (p: string, s: string) => compileIRegexp(p)?.partial.test(s);
  assert.ok(m("[jk]", "j") && !m("[jk]", "jk"));
  assert.ok(se("[jk]", "kilo"));
  assert.ok(m("a|b", "b") && m("", "") && !m("", "a"));
  assert.ok(m("a{2,3}", "aaa") && !m("a{2,3}", "a") && m("a{2,}", "aaaaa") && m("a{2}", "aa"));
  assert.ok(m("(ab)+c?", "abab"));
  assert.ok(m("\\p{Lu}\\P{Lu}", "Ab") && !m("\\p{Lu}", "a"));
  assert.ok(m("[\\p{L}\\p{N}]+", "ab12"));
  assert.ok(m("[^a-c]", "d") && !m("[^a-c]", "b"));
  assert.ok(m("[a-]", "-") && m("[-a]", "-") && m("a-b", "a-b") && m("$^", "$^"));
  assert.ok(m("\\(\\)\\.\\|", "().|") && m("\\n\\r\\t", "\n\r\t"));
  assert.ok(m(".", "\u{1F600}") && !m(".", "\n") && !m(".", "\r"));
  assert.ok(m("[\\u{0}-\\u{10}]".replace("\\u{0}-\\u{10}", "\u0000-\u0010"), "\u0005"));
  assert.ok(m("\u00e9", "\u00e9") && m("[\u{10000}-\u{10FFFF}]", "\u{1F600}"));
  for (const bad of ["[^]", "[]", "(", ")", "a**", "*", "a{2,1}", "a{", "a{,2}", "\\d", "\\s", "\\w", "\\x", "[a-\\d]", "\\p{Foo}", "\\p{IsBasicLatin}", "[z-a]", "[a-z-9]", "a{1}{2}", "[[]", "a]", "a}", "{", "\\", "\\p", "\\p{L", "\\$"]) {
    assert.strictEqual(compileIRegexp(bad), null, bad);
  }
});

test("JSON parser strictness", () => {
  for (const b of ["01", "1.", ".5", "+1", "[1,]", '{"a":1,}', "'a'", "[1 2]", '{"a" 1}', "nul", '"\\x"', '"a\nb"', "", "1 2", '{"a":1}}']) {
    assert.throws(() => parseJson(b), b);
  }
  assert.doesNotThrow(() => parseJson(" [1, {\"a\" : [ ] , \"b\":{}} ] \r\n"));
  // deep nesting does not overflow the stack
  const deep = "[".repeat(100000) + "]".repeat(100000);
  assert.doesNotThrow(() => parseJson(deep));
});

test("blank lines get no response; CRLF input", () => {
  assert.strictEqual(handleLine(""), null);
  assert.strictEqual(handleLine("  \t "), null);
  const r = handleLine('{"id":"z","op":"query","input":{"query":"$","document":1}}\r');
  assert.deepStrictEqual(JSON.parse(r!), { id: "z", result: { values: [1], paths: ["$"] } });
});
