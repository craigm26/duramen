// Statements and their clauses: spec, oracle, op, errors, requirements, open items, decisions,
// sections, notes, examples, input texts, tables and big numbers (REQ-SY-004, REQ-SY-007 to
// REQ-SY-013).

import { test } from "node:test";
import assert from "node:assert/strict";
import { ECHO, diagsOf, withEcho } from "./testkit.ts";

const one = (text: string) => diagsOf({ "s.duramen": text });

test("REQ-SY-004: duramen takes no clauses; spec takes two words; a missing spec name or version is P021", async () => {
  assert.deepEqual(await one('duramen 0.1\n  title "x"\nspec s 1\n'), ["s.duramen:2: error P015"]);
  assert.deepEqual(await one("duramen 0.1\nspec s\n"), ["s.duramen:2: error P021"]);
  assert.deepEqual(await one("duramen 0.1\nspec s 1 2\n"), ["s.duramen:2: error P021"]);
});

test("REQ-SY-004: spec takes title, text, contract and request; a valid one is clean", async () => {
  assert.deepEqual(
    await one(
      'duramen 0.1\nspec s 1.0.0-beta\n  title "The s program"\n  contract s-out-2\n  request {"clock": "2026-01-01T00:00:00Z", "n": 1}\n  text\n    What s is.\n',
    ),
    [],
  );
});

test("REQ-SY-004: a request that is not JSON or not an object gets P009; one that sets id, op or input gets P051", async () => {
  assert.deepEqual(await one('duramen 0.1\nspec s 1\n  request {"clock":\n'), ["s.duramen:3: error P009"]);
  assert.deepEqual(await one('duramen 0.1\nspec s 1\n  request ["clock"]\n'), ["s.duramen:3: error P009"]);
  assert.deepEqual(await one('duramen 0.1\nspec s 1\n  request {"op": "x"}\n'), ["s.duramen:3: error P051"]);
  assert.deepEqual(await one('duramen 0.1\nspec s 1\n  request {"x": 1e400}\nop f\n  input a int\n'), ["s.duramen:3: error P009"]);
});

test("REQ-SY-004: oracle with nothing after it is P028; its source clause is read, its other clauses are P015", async () => {
  assert.deepEqual(await one("duramen 0.1\nspec s 1\noracle\n"), ["s.duramen:3: error P028"]);
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\noracle node model.mjs --quiet\n  source model.mjs, lib/a.mjs lib/b.mjs\n  timeout 5\n"),
    ["s.duramen:5: error P015"],
  );
});

test("REQ-SY-007: op takes one word for its name, else P031; its clauses are still read", async () => {
  assert.deepEqual(await one("duramen 0.1\nspec s 1\nop f g\n"), ["s.duramen:3: error P031"]);
  assert.deepEqual(await one("duramen 0.1\nspec s 1\nop\n"), ["s.duramen:3: error P031"]);
});

test("REQ-SY-007: a valid op with inputs, result, tolerance, audit and request is clean", async () => {
  assert.deepEqual(
    await one(
      "duramen 0.1\nspec s 1\nop f\n  input a number, b? {x: number, y: string}, c \"one, two\" | [1, 2], d-e (f, g)\n  result the sum\n  tolerance result.sum 0.005\n  tolerance result.count 0\n  audit text\n  request {}\n",
    ),
    [],
  );
});

test("REQ-SY-007: input fields: a field needs a name and a type; a repeated name is P052; audit takes text only", async () => {
  const text = [
    "duramen 0.1",
    "spec s 1",
    "op f",
    "  input a",
    "  input a.b number",
    "  input b?number",
    "  input",
    "  input c number, , d number,",
    "  input e 'x, y'",
    "  input c number",
    "  input é number",
    "op g",
    "  audit json",
    "op",
    "  input x",
    "  tolerance result.y",
    "",
  ].join("\n");
  assert.deepEqual(await one(text), [
    "s.duramen:4: error P017",
    "s.duramen:5: error P017",
    "s.duramen:6: error P017",
    "s.duramen:7: error P017",
    "s.duramen:8: error P017",
    "s.duramen:8: error P017",
    "s.duramen:9: error P017",
    "s.duramen:10: error P052",
    "s.duramen:11: error P017",
    "s.duramen:13: error P050",
    "s.duramen:14: error P031",
    "s.duramen:15: error P017",
    "s.duramen:16: error P018",
  ]);
});

test("REQ-SY-007: tolerance needs a path and a JSON number of 0 or more; a repeated path is P052", async () => {
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\nop f\n  tolerance result.x\n  tolerance result.x -1\n  tolerance result.x 0x10\n  tolerance result.x 1 2\n  tolerance result.x 1e-3\n"),
    ["s.duramen:4: error P018", "s.duramen:5: error P018", "s.duramen:6: error P018", "s.duramen:7: error P018"],
  );
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\nop f\n  tolerance foo 0.1\n  tolerance result.x -0\n  tolerance result.y 1e400\n"),
    ["s.duramen:6: error P018"],
  );
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\nop h\n  tolerance result.x 1\n  tolerance result.y 1\n  tolerance result.x 2\n"),
    ["s.duramen:6: error P052"],
  );
});

test("REQ-SY-008: errors takes nothing after its keyword; a clause is <code> when <condition>, continued by indented lines", async () => {
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\nerrors\n  bad_input when the input is not an object, or\n    when it lacks a field\n  not_found when there is no such thing\n"),
    [],
  );
  assert.deepEqual(await one("duramen 0.1\nspec s 1\nerrors first\n  e when x\n"), ["s.duramen:3: error P050"]);
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\nerrors\n  e if x\n  e when\n    the input is bad\n  when x\n  f when y\n   and z\n  g is\n   wrong\n"),
    ["s.duramen:4: error P019", "s.duramen:5: error P019", "s.duramen:7: error P019", "s.duramen:9: error P006", "s.duramen:10: error P019", "s.duramen:11: error P006"],
  );
});

test("REQ-SY-008: a line of an error condition that starts with # is part of the condition (T004 applies)", async () => {
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\nerrors\n  e when x\n    # It MUST be read.\n"),
    ["s.duramen:4: error T004"],
  );
});

test("REQ-SY-009: req takes text, decision, on, example and table; open takes text; decision takes source, status, text, rejected", async () => {
  assert.deepEqual(
    await one(
      "duramen 0.1\nspec s 1\nsection S \"Things\"\n  text\n    About things.\nnote\n  text\n    A note.\nopen S-1 \"Unsaid\"\n  text\n    Left open.\ndecision D-1 \"Why\"\n  source the author\n  status accepted\n  text\n    Because.\n  rejected \"Another way, because no.\"\n  rejected \"A third way.\"\n",
    ),
    ["s.duramen:12: warning T012"],
  );
});

test("REQ-SY-009: a clause that is not taken by its statement is P015; on takes any, posix or windows; note takes nothing", async () => {
  assert.deepEqual(
    await one(
      'duramen 0.1\nspec s 1\nreq A "a"\n  on mac\n  status accepted\n  example f {}\nnote x\nsection S "s"\n  example f {}\ndecision D "d"\n  title "x"\nopen O "o"\n  decision D\n',
    ),
    ["s.duramen:4: error P033", "s.duramen:5: error P015", "s.duramen:7: error P050", "s.duramen:9: error P015", "s.duramen:11: error P015", "s.duramen:13: error P015"],
  );
});

test("REQ-SY-010: a first line that is not an example gets P012 or P009; raw needs a quoted line without a line break", async () => {
  assert.deepEqual(
    await one('duramen 0.1\nspec s 1\nreq A "a"\n  example\n  example f [1]\n  example f {"x": 1\n  example f 2\n  example raw "{\\"id\\": \\"1\\",\\n\\"op\\": \\"f\\"}"\n'),
    ["s.duramen:4: error P012", "s.duramen:5: error P012", "s.duramen:6: error P009", "s.duramen:7: error P012", "s.duramen:8: error P026"],
  );
  assert.deepEqual(
    await one(
      'duramen 0.1\nspec s 1\nreq A "a"\n  example raw\n  example raw {"id": "x"}\n  example raw "unclosed\n  example raw "a" "b"\n  example raw "carriage\\rreturn"\n  example f [1]\n    expect result\n     expect result = 1\n    expect result ≈ 1\n    expect result~1+-0.5\n    expect result="~"\n    expect result =\n    expect = 1\n    request {"a": 1}\n    request {"b": 1}\n    omit\n    omit a, b c\n    omit d\n',
    ),
    ["s.duramen:4: error P004", "s.duramen:5: error P004", "s.duramen:6: error P004", "s.duramen:7: error P004", "s.duramen:8: error P026", "s.duramen:9: error P012", "s.duramen:10: error P011", "s.duramen:11: error P006", "s.duramen:12: error P010", "s.duramen:15: error P009", "s.duramen:16: error P011", "s.duramen:18: error P052", "s.duramen:19: error P011"],
  );
});

test("REQ-SY-010: a raw example takes no request, omit or input lines: each is P022 and nothing else", async () => {
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\nreq A \"a\"\n  example raw '{\"id\": \"x\"}'\n    omit\n    request\n    input\n  example f {}\n    request\n    input\n    omit ,\n"),
    ["s.duramen:5: error P022", "s.duramen:6: error P022", "s.duramen:7: error P022", "s.duramen:9: error P009", "s.duramen:10: error P049", "s.duramen:11: error P011"],
  );
});

test("REQ-SY-010: a dropped raw example still has its lines read as a raw example's", async () => {
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\nop f\nreq A \"a\"\n  text\n    T.\n  example raw '{\"id\":\"1\",\"op\":\"f\"}'\n    input files.\"a\" from \"nofile\"\n    input files.\"b\"\n      hello\n  example raw x\n    input files.\"c\" from \"nofile\"\n"),
    ["s.duramen:8: error P022", "s.duramen:9: error P022", "s.duramen:11: error P004", "s.duramen:12: error P022"],
  );
});

test("REQ-SY-010: expect lines, a request line after a read one (P052), and the lines of an example", async () => {
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\nop f\nreq A \"a\"\n  example f {}\n    expect result ≈ 1 ± -1\n    expect result ~ 1 +- x\n    expect result ≈ 0x10 ± 1\n    expect result = {nope}\n    expect result\n    result = 1\n     expect result = 1\n      expect result = 1\n    request [1]\n    request {\"input\": {}}\n"),
    [
      "s.duramen:6: error P010",
      "s.duramen:7: error P010",
      "s.duramen:8: error P010",
      "s.duramen:9: error P009",
      "s.duramen:10: error P011",
      "s.duramen:11: error P011",
      "s.duramen:12: error P006",
      "s.duramen:13: error P006",
      "s.duramen:14: error P009",
      "s.duramen:15: error P051",
    ],
  );
});

test("REQ-SY-010: a request line after one that was read is P052 only, and each further one likewise", async () => {
  assert.deepEqual(
    await one('duramen 0.1\nspec s 1\nop f\nreq A "a"\n  text\n    T.\n  example f {}\n    request {"a": 1}\n    request [2]\n    request {"id": 3}\n    request {"b": 4}\n'),
    ["s.duramen:9: error P052", "s.duramen:10: error P052", "s.duramen:11: error P052"],
  );
});

test("REQ-SY-011: an input path takes its text from the lines under it; a bad path is P049; a missing file is P048", async () => {
  const text = [
    "duramen 0.1",
    "spec s 1",
    "req A \"a\"",
    "  example f {\"x\": 1}",
    "    input files.",
    "    input files..\"a\"",
    "    input \"a",
    "    input x.y",
    "      text",
    "    input z",
    "    input y from \"missing.txt\"",
    "",
  ].join("\n");
  assert.deepEqual(await one(text), [
    "s.duramen:5: error P049",
    "s.duramen:6: error P049",
    "s.duramen:7: error P049",
    "s.duramen:8: error P049",
    "s.duramen:10: error P049",
    "s.duramen:11: error P048",
  ]);
});

test("REQ-SY-011: a text under an input line that is indented three is P006; an input with no text is P049", async () => {
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\nreq A \"a\"\n  example f {}\n    input a\n     not six\n      six, but after the line that ended the text\n"),
    ["s.duramen:5: error P049", "s.duramen:6: error P006", "s.duramen:7: error P006"],
  );
});

test("REQ-SY-011: a from-file input reads a file of the record's folder only; outside is P048", async () => {
  const files = {
    "r/s.duramen": 'duramen 0.1\nspec s 1\nreq A "a"\n  example f {}\n    input a from "../outside.txt"\n    input b from "t.txt"\n      not its text\n    input c from "unclosed\n  example f {\n    input d from "../outside.txt"\n',
    "r/t.txt": "t",
    "outside.txt": "x",
  };
  assert.deepEqual(await diagsOf(files, "r"), [
    "r/s.duramen:5: error P048",
    "r/s.duramen:7: error P006",
    "r/s.duramen:8: error P049",
    "r/s.duramen:9: error P009",
    "r/s.duramen:10: error P048",
  ]);
});

test("REQ-SY-011 with the echo oracle: input texts build the example's input; a from-file text is the file's", async () => {
  const text = [
    "duramen 0.1",
    "spec s 1",
    "oracle node echo.mjs",
    "op f",
    "  input files object, n? number",
    "req A \"a\"",
    "  example f {\"n\": 1}",
    "    input files.\"a b\"",
    "      one",
    "        two",
    "",
    "    input files.x",
    "      three",
    "",
    "",
    "    expect result = {\"n\": 1, \"files\": {\"a b\": \"one\\n  two\\n\", \"x\": \"three\\n\"}}",
    "",
  ].join("\n");
  assert.deepEqual(await diagsOf(withEcho({ "s.duramen": text })), []);
  const from = "duramen 0.1\nspec s 1\noracle node echo.mjs\nop f\n  input t? string\nreq A \"a\"\n  example f {}\n    input t from \"data/t.txt\"\n    expect result = {\"t\": \"hello,\\r\\nworld\"}\n";
  // The oracle runs in the folder of the file that holds its statement, so it sits beside it.
  const files = { "sub/s.duramen": from, "sub/data/t.txt": "hello,\r\nworld", "sub/echo.mjs": ECHO };
  assert.deepEqual(await diagsOf(files), []);
});

test("REQ-SY-012: a table's rows are examples; header and row problems are reported at the table or the row", async () => {
  const text = [
    "duramen 0.1",
    "spec s 1",
    "req A \"a\"",
    "  table f",
    "  table f g",
    "    | x |",
    "    | 1 |",
    "  table f",
    "    | x |",
    "  table f",
    "    | x | result ± -1 |",
    "    | 1 | 2           |",
    "  table f",
    "    | x | result ± 0.5 |",
    "    | 1 | \"2\"          |",
    "  table f",
    "    | x | y |",
    "    | 1 |",
    "    | {  | 2 |",
    "    x | 1",
    "  table f",
    "    | x | |",
    "    | 1 | 2 |",
    "  table f",
    "    | x ± 1 |",
    "    | 1     |",
    "",
  ].join("\n");
  assert.deepEqual(await one(text), [
    "s.duramen:4: error P013",
    "s.duramen:5: error P013",
    "s.duramen:8: error P013",
    "s.duramen:11: error P010",
    "s.duramen:15: error P010",
    "s.duramen:18: error P014",
    "s.duramen:19: error P009",
    "s.duramen:20: error P006",
    "s.duramen:22: error P013",
    "s.duramen:25: error P010",
  ]);
});

test("REQ-SY-012: a table with a bad op, a header with a tolerance on a column that is not a number, and rows", async () => {
  const text = [
    "duramen 0.1",
    "spec s 1",
    "req A \"a\"",
    "  table f g",
    "    | x |",
    "    | {bad |",
    "  table f",
    "   | x |",
    "    | 1 |",
    "  table f",
    "    | a.b | result |",
    "    | 1   | 2      |",
    "  table f",
    "    | x | result ± lots |",
    "    | 1 | \"two\"         |",
    "  table f",
    "    | x | result ± 1 2 | result.y+-0.5 |",
    "    | 1 | 2            | 3             |",
    "  table f",
    "    | x | x |",
    "    | 1 | 2 |",
    "  table f",
    "    | x | result ± 0.5 |",
    "    | 1 | 2.25 [       |",
    "    | { | ?            |",
    "",
  ].join("\n");
  assert.deepEqual(await one(text), [
    "s.duramen:4: error P013",
    "s.duramen:7: error P013",
    "s.duramen:8: error P006",
    "s.duramen:11: error P013",
    "s.duramen:14: error P010",
    "s.duramen:17: error P010",
    "s.duramen:20: error P013",
    "s.duramen:24: error P010",
    "s.duramen:25: error P009",
  ]);
});

test("REQ-SY-012 with the echo oracle: a table that is correct is clean, and a row with no input cell sends {}", async () => {
  const text = [
    "duramen 0.1",
    "spec s 1",
    "oracle node echo.mjs",
    "op f",
    "  input x? json, y? json",
    "req A \"a\"",
    "  table f",
    "    | x        | y | result.x | result.y ± 0.5 |",
    "    |----------|---|:--------:|----------------|",
    "    | \"a\\|b\"   |   | \"a\\|b\"   |                |",
    "    | 1        | 2 | ?        | 2.4            |",
    "",
  ].join("\n");
  assert.deepEqual(await diagsOf(withEcho({ "s.duramen": text })), []);
});

test("REQ-SY-013: JSON with a number too large for binary64 is P009; such a number where a number is wanted is P010", async () => {
  const text = [
    "duramen 0.1",
    "spec s 1",
    "  request {\"x\": 1e400}",
    "op f",
    "  input a int",
    "req A \"a\"",
    "  text",
    "    T.",
    "  example f {\"a\": 1e400}",
    "  example f {\"a\": 1}",
    "    expect result.a = [1, -1e400]",
    "    request {\"y\": 1e999}",
    "  table f",
    "    | a | result |",
    "    | 1e999 | 1 |",
    "  example raw '{\"id\":\"r\",\"op\":\"f\",\"input\":{\"a\":1e400}}'",
    "",
  ].join("\n");
  assert.deepEqual(await one(text), [
    "s.duramen:3: error P009",
    "s.duramen:9: error P009",
    "s.duramen:11: error P009",
    "s.duramen:12: error P009",
    "s.duramen:15: error P009",
  ]);
});

test("REQ-SY-013: a tolerance or a number that is too large is P018 or P010", async () => {
  const text = [
    "duramen 0.1",
    "spec s 1",
    "op f",
    "  input a int",
    "  tolerance result.x 1e400",
    "req A \"a\"",
    "  text",
    "    T.",
    "  example f {\"a\": 1}",
    "    expect result ≈ 1e400 ± 1",
    "    expect result ≈ 1 ± 1e400",
    "  table f",
    "    | a | result ± 1e400 |",
    "    | 1 | 2 |",
    "  table f",
    "    | a | result ± 1 |",
    "    | 1 | 1e400 |",
    "",
  ].join("\n");
  assert.deepEqual(await one(text), [
    "s.duramen:5: error P018",
    "s.duramen:10: error P010",
    "s.duramen:11: error P010",
    "s.duramen:13: error P010",
    "s.duramen:17: error P010",
  ]);
});

test("REQ-SY-009: a decision clause with nothing after it names none, and contract with nothing states none", async () => {
  assert.deepEqual(
    await one("duramen 0.1\nspec s 1\n  contract\nreq A \"a\"\n  decision\n  text\n    Words.\n"),
    ["s.duramen:4: error T001"],
  );
});
